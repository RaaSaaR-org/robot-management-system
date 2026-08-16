/**
 * @file RobotManager.peers.test.ts
 * @description The server's half of "robots see each other" (TASK-207): peers
 *              are the OTHER connected robots, poses are refreshed on demand
 *              from the agents rather than served from the 30 s health copy,
 *              frames pass through untouched (the consumer decides), the
 *              footprint comes from the agent's metadata with an honest default,
 *              and a location diff notices heading/place/frame changes.
 * @feature core
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const httpGet = vi.fn();
vi.mock('../HttpClient.js', () => {
  class HttpClientError extends Error {}
  return {
    HTTP_TIMEOUTS: { SHORT: 5000, MEDIUM: 10000, LONG: 30000 },
    HttpClientError,
    HttpClient: class {
      get = httpGet;
      post = vi.fn();
    },
  };
});
vi.mock('../A2AClient.js', () => ({ agentCardResolver: { fetchAgentCard: vi.fn(), clearCache: vi.fn() } }));
vi.mock('../ConversationManager.js', () => ({
  conversationManager: { registerAgent: vi.fn(), unregisterAgent: vi.fn() },
}));
vi.mock('../../repositories/index.js', () => ({
  robotRepository: {
    getAllRegisteredRobots: vi.fn(),
    getRegisteredRobot: vi.fn(),
    upsertWithRegistration: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
    updateHealthCheck: vi.fn(),
  },
}));

import { RobotManager, locationDiffers, type RegisteredRobot, type Robot } from '../RobotManager.js';
import { robotRepository as _repo } from '../../repositories/index.js';
const robotRepository = vi.mocked(_repo, true);

const SIM = { kind: 'sim' as const, id: 'g1_dex3_room_scene' };

function registered(id: string, over: Partial<Robot> = {}, reg: Partial<RegisteredRobot> = {}): RegisteredRobot {
  return {
    robot: {
      id,
      name: id.toUpperCase(),
      model: 'g1_edu',
      status: 'online',
      batteryLevel: 90,
      location: { x: 1, y: 2, heading: 90, frame: SIM, place: 'DESK', zone: 'Lab' },
      lastSeen: '2026-08-15T10:00:00.000Z',
      capabilities: [],
      createdAt: '2026-08-15T09:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
      metadata: { footprintRadiusM: 0.4 },
      ...over,
    },
    endpoints: {
      robot: `http://${id}.local/api/v1/robots/${id}`,
      command: '', telemetry: '', telemetryWs: '',
    },
    agentCard: { name: id } as never,
    baseUrl: `http://${id}.local`,
    lastHealthCheck: '2026-08-15T10:00:00.000Z',
    isConnected: true,
    registeredAt: '2026-08-15T09:00:00.000Z',
    ...reg,
  };
}

async function manager(...robots: RegisteredRobot[]) {
  robotRepository.getAllRegisteredRobots.mockResolvedValue(robots);
  const mgr = new RobotManager();
  await mgr.initialize();
  return mgr;
}

beforeEach(() => {
  httpGet.mockReset();
});

describe('locationDiffers', () => {
  it('sees a heading, place or frame change, not just x/y/zone — and ignores sim jitter', () => {
    const base = { x: 1, y: 2, heading: 0, place: 'A', frame: SIM };
    expect(locationDiffers(base, { ...base })).toBe(false);
    expect(locationDiffers(base, { ...base, x: 1.000000001, heading: 0.09 })).toBe(false); // jitter
    expect(locationDiffers(base, { ...base, x: 1.02 })).toBe(true);
    expect(locationDiffers(base, { ...base, heading: 5 })).toBe(true);
    expect(locationDiffers(base, { ...base, heading: undefined })).toBe(true);
    expect(locationDiffers(base, { ...base, place: 'B' })).toBe(true);
    expect(locationDiffers(base, { ...base, frame: { kind: 'odom', id: 'boot' } })).toBe(true);
    expect(locationDiffers(base, { ...base, frame: null })).toBe(true);
    expect(locationDiffers(undefined, base)).toBe(true);
  });
});

describe('RobotManager peers', () => {
  it('lists every OTHER connected robot with frame, footprint and pose age; never itself, never the offline', async () => {
    const mgr = await manager(
      registered('a', {}, { poseSyncedAt: '2026-08-15T10:00:00.000Z' }),
      registered('b', { metadata: {} }, { poseSyncedAt: '2026-08-15T10:00:01.000Z' }),
      registered('c', {}, { isConnected: false }),
    );
    const peers = mgr.getPeers('a');
    expect(peers.map((p) => p.robotId)).toEqual(['b']);
    expect(peers[0]).toEqual({
      robotId: 'b',
      name: 'B',
      x: 1,
      y: 2,
      headingDeg: 90,
      frame: SIM,
      place: 'DESK',
      zone: 'Lab',
      updatedAt: '2026-08-15T10:00:01.000Z',
      footprintRadiusM: 0.35, // no metadata → the honest default
    });
    expect(mgr.getPeers('b')[0].footprintRadiusM).toBe(0.4); // from the agent's metadata
  });

  it('passes a missing frame through as null — the consumer decides, the server never invents one', async () => {
    const mgr = await manager(registered('a'), registered('b', { location: { x: 0, y: 0 } }));
    expect(mgr.getPeers('a')[0]).toMatchObject({ frame: null, headingDeg: null, place: null, zone: null, updatedAt: null });
  });

  it('refreshes stale poses from the agents in parallel, adopts changes, and emits the fleet event', async () => {
    const mgr = await manager(
      registered('a', {}, { poseSyncedAt: new Date().toISOString() }), // fresh: not refetched
      registered('b'), // never synced: refetched
      registered('c', {}, { isConnected: false }), // offline: left alone
    );
    httpGet.mockResolvedValue({ location: { x: 5, y: 6, heading: 45, frame: SIM } });
    const events: string[] = [];
    mgr.onRobotEvent((e) => events.push(`${e.type}:${e.robotId}`));

    await mgr.refreshPoses(1000);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledWith('http://b.local/api/v1/robots/b');
    expect(mgr.getPeers('a')[0]).toMatchObject({ x: 5, y: 6, headingDeg: 45 });
    expect(mgr.getPeers('a')[0].updatedAt).not.toBeNull();
    expect(events).toEqual(['robot_status_changed:b']);

    // Now fresh: a second refresh inside the window fetches nothing.
    await mgr.refreshPoses(1000);
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('keeps the last pose when an agent does not answer, and coalesces concurrent refreshes', async () => {
    const mgr = await manager(registered('a'), registered('b'));
    let resolve!: (v: unknown) => void;
    httpGet.mockImplementation(
      (url: string) =>
        url.includes('/b') ? Promise.reject(new Error('ECONNREFUSED')) : new Promise((r) => (resolve = r)),
    );
    const p1 = mgr.refreshPoses(0);
    const p2 = mgr.refreshPoses(0);
    resolve({ location: { x: 9, y: 9 } });
    await Promise.all([p1, p2]);
    expect(httpGet).toHaveBeenCalledTimes(2); // two robots, ONE refresh — the second call rode the first
    expect(mgr.getPeers('a')[0]).toMatchObject({ x: 1, y: 2, updatedAt: null }); // b: unchanged, still unsynced
    expect(mgr.getPeers('b')[0]).toMatchObject({ x: 9, y: 9 });
  });
});

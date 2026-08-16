/**
 * @file RobotManager.peers.test.ts
 * @description The server's half of "robots see each other" (TASK-207): peers
 *              are the OTHER connected robots, poses are refreshed on demand
 *              from the agents rather than served from the 30 s health copy,
 *              frames pass through untouched (the consumer decides), the
 *              footprint comes from the agent's metadata with an honest default,
 *              and a location diff notices heading/place/frame changes.
 *              Plus the two things that bit afterwards: a refreshed pose must
 *              reach the ROW (the health check can no longer see it change),
 *              and the peer list must never enumerate another tenant's fleet.
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
    update: vi.fn(),
    updateHealthCheck: vi.fn(),
  },
  agentRepository: { upsertByRobotId: vi.fn(), delete: vi.fn(), deleteByRobotId: vi.fn() },
}));
// The tenant the CALLER is in — `getTenantId()` returns undefined with
// multi-tenancy off or outside a request, which is the single-tenant default.
let tenantId: string | undefined;
vi.mock('../../middleware/tenantContext.js', () => ({ getTenantId: () => tenantId }));

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
  tenantId = undefined;
  robotRepository.update.mockReset();
  robotRepository.update.mockResolvedValue({ id: 'ok' } as never);
  robotRepository.findAll.mockReset();
  robotRepository.updateHealthCheck.mockReset();
  robotRepository.updateHealthCheck.mockResolvedValue(undefined as never);
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
      poseAgeMs: expect.any(Number),
      footprintRadiusM: 0.35, // no metadata → the honest default
    });
    expect(mgr.getPeers('b')[0].footprintRadiusM).toBe(0.4); // from the agent's metadata
  });

  it('passes a missing frame through as null — the consumer decides, the server never invents one', async () => {
    const mgr = await manager(registered('a'), registered('b', { location: { x: 0, y: 0 } }));
    expect(mgr.getPeers('a')[0]).toMatchObject({
      frame: null, headingDeg: null, place: null, zone: null, updatedAt: null, poseAgeMs: null,
    });
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

  it('reports how old each peer pose is, measured on the server clock', async () => {
    const mgr = await manager(
      registered('a'),
      registered('b', {}, { poseSyncedAt: new Date(Date.now() - 1500).toISOString() }),
    );
    // The agent cannot derive this from `updatedAt` without importing clock
    // skew — and it needs it to tell a live colleague from a frozen one.
    const age = mgr.getPeers('a')[0].poseAgeMs;
    expect(age).toBeGreaterThanOrEqual(1400);
    expect(age).toBeLessThan(3000);
  });

  it('persists a pose it adopted — the health check can no longer see it change', async () => {
    const mgr = await manager(registered('b'));
    httpGet.mockResolvedValue({ location: { x: 5, y: 6, heading: 45, frame: SIM } });

    await mgr.refreshPoses(0);
    // Without this write nothing reaches `Robot.location` again: the health
    // check diffs against the very cache this refresh just updated, so
    // `GET /api/robots` (and zone-scoped E-stop) keep serving the old row.
    expect(robotRepository.update).toHaveBeenCalledWith('b', {
      location: { x: 5, y: 6, heading: 45, frame: SIM },
    });

    // The same pose again is not written again — a 1 s refresh cadence must
    // not become a write per poll.
    robotRepository.update.mockClear();
    await mgr.refreshPoses(0);
    expect(robotRepository.update).not.toHaveBeenCalled();
  });

  it('lets the health check retry the pose write after the refresh write failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const mgr = await manager(registered('a'));
      robotRepository.update.mockResolvedValue(null as never); // the row write fails
      httpGet.mockResolvedValue({ location: { x: 5, y: 6, heading: 45, frame: SIM } });
      await mgr.refreshPoses(0);
      await vi.advanceTimersByTimeAsync(0); // let the fire-and-forget write settle

      httpGet.mockImplementation(async (url: string) =>
        url.includes('/health')
          ? { status: 'ok', robotStatus: 'online', batteryLevel: 90 }
          : { location: { x: 5, y: 6, heading: 45, frame: SIM } },
      );
      mgr.startHealthChecks(1000);
      await vi.advanceTimersByTimeAsync(0);
      mgr.stopHealthChecks();

      // The cache already holds (5,6): diffing against it (what the health
      // check used to do) finds no change and writes nothing, and the robot
      // stays at its registration pose in the database forever.
      expect(robotRepository.updateHealthCheck).toHaveBeenCalledWith(
        'a',
        true,
        undefined,
        90,
        expect.objectContaining({ x: 5, y: 6 }),
      );
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('never enumerates another tenant\'s fleet — the peer set is what the caller\'s tenant can see', async () => {
    const mgr = await manager(registered('acme-1'), registered('acme-2'), registered('globex-1'));
    httpGet.mockResolvedValue({});
    tenantId = 'acme'; // authMiddleware put us in Acme's scope

    // `robotCache` is process-wide: `initialize()` runs at startup, outside any
    // request, so the Prisma tenant extension is a passthrough and every
    // tenant's robots share one map. The repository read below is the only
    // tenant-honest answer to "which robots exist for this caller".
    robotRepository.findAll.mockResolvedValue([{ id: 'acme-1' }, { id: 'acme-2' }] as never);
    await mgr.refreshPoses(0); // the route always refreshes before listing

    expect(mgr.getPeers('acme-1').map((p) => p.robotId)).toEqual(['acme-2']);
    // …and asking for a foreign robot's peers does not hand out Acme's fleet
    // either — nor Globex's, which we cannot see.
    expect(mgr.getPeers('globex-1').map((p) => p.robotId)).toEqual(['acme-1', 'acme-2']);
  });

  it('fails closed: a tenant whose scope was never read sees no peers at all', async () => {
    const mgr = await manager(registered('acme-1'), registered('globex-1'));
    tenantId = 'globex';
    expect(mgr.getPeers('globex-1')).toEqual([]);
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

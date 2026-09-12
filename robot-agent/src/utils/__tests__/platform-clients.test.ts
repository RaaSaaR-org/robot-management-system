/**
 * @file platform-clients.test.ts
 * @description Platform credentials and rejected delivery across real robot HTTP clients.
 * @feature core
 * @status test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lastPlatformAuthRejection,
  platformAuthHeaders,
  resetPlatformAuthRejection,
} from '../platform-auth.js';
import { reportRobotIdentity } from '../platform-registration.js';
import { ServerMirror } from '../../agent-mode/server-mirror.js';
import type { AgentModeEvent } from '../../agent-mode/types.js';
import { ComplianceLogClient } from '../../compliance/ComplianceLogClient.js';
import { PatrolRouteSource } from '../../agent-mode/patrol.js';
import { PlaceGraphSource } from '../../agent-mode/place-graph-source.js';
import { SecureUpdateClient } from '../../updates/SecureUpdateClient.js';
import { PeerTracker } from '../../agent-mode/peers.js';
import { TaskQueue } from '../../robot/TaskQueue.js';
import type { PushedTask, SimulatedRobotState } from '../../robot/types.js';
import type { RobotStateManager } from '../../robot/state.js';
import { config } from '../../config/config.js';
import {
  clearZoneCache,
  getChargingStationLocation,
  getHomeLocation,
  getNamedLocation,
  moveToLocation,
  setRobotStateManager,
} from '../../tools/navigation.js';

/**
 * The navigation tools are Genkit tools, and the only thing this test needs
 * from Genkit is the handler it was given. Stubbing it keeps the AI stack (and
 * its API keys) out of a test about HTTP headers.
 */
vi.mock('../../agent/genkit.js', () => {
  const chain = (): unknown => ({ optional: () => chain(), describe: () => chain() });
  return {
    z: { object: () => ({}), number: chain, string: chain },
    ai: { defineTool: (_def: unknown, handler: unknown) => handler },
  };
});

const token = 'ndsa_test-platform-token';
let server: Server;
let baseUrl: string;
let cacheDir: string;
let rejectRequests: boolean;
let calls: { url: string; auth?: string; method?: string }[];
const originalServerUrl = config.serverUrl;

const zone = {
  id: 'zone-1',
  name: 'Warehouse A',
  type: 'storage',
  floor: '1',
  bounds: { x: 10, y: 10, width: 20, height: 20 },
};

beforeEach(async () => {
  vi.stubEnv('NEODEM_SERVICE_TOKEN', token);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  calls = [];
  rejectRequests = false;
  resetPlatformAuthRejection();
  clearZoneCache();
  cacheDir = mkdtempSync(join(tmpdir(), 'platform-clients-'));
  server = createServer((req, res) => {
    calls.push({ url: req.url!, auth: req.headers.authorization, method: req.method });
    req.resume();
    if (rejectRequests || (process.env.NEODEM_SERVICE_TOKEN && req.headers.authorization !== `Bearer ${token}`)) {
      res.writeHead(401).end('Unauthorized');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/compliance/sessions') {
      res.end(JSON.stringify({ sessionId: 'session-1', robotId: 'robot-1' }));
    } else if (req.url === '/api/patrol/routes/route-1') {
      res.end(JSON.stringify({ id: 'route-1', name: 'Demo', checkpoints: [{ id: 'cp-1', placeId: 'hall', checklist: [] }] }));
    } else if (req.url === '/api/digital-twins/twin-1/places/_index.json') {
      res.end(JSON.stringify({ version: 1, frame: { id: 'twin-1', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+', twinId: 'twin-1' }, places: [] }));
    } else if (req.url === '/api/updates?status=approved') {
      res.end(JSON.stringify([{ id: 'pkg-1', version: '1.1.0', status: 'approved' }]));
    } else if (req.url === '/api/zones') {
      res.end(JSON.stringify({ data: [zone] }));
    } else if (req.url === '/api/robots/robot-1/peers') {
      res.end(JSON.stringify({ peers: [] }));
    } else {
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // navigation.ts and TaskQueue.ts read the platform URL off `config` at call
  // time, which is the only seam either of them has.
  config.serverUrl = baseUrl;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
  config.serverUrl = originalServerUrl;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const event: AgentModeEvent = { type: 'agent:state:changed', robotId: 'robot-1', timestamp: new Date().toISOString() };
const photo = { runId: 'run-1', key: 'cp-1.jpg', jpeg: Buffer.from('jpeg'), kind: 'control' as const, checkpointId: 'cp-1', routeId: 'route-1', capturedAt: new Date().toISOString() };
const safety = { payload: { description: 'Stopped', actionType: 'stop', triggerReason: 'test' } };
function mirror() {
  return new ServerMirror({ serverUrl: baseUrl, robotId: 'robot-1', journal: null, retryDelayMs: 0, logCommandExecution: async () => {} });
}

function peerTracker(): PeerTracker {
  // No `fetchImpl`: this one must go out over the real socket, headers and all.
  return new PeerTracker({
    enabled: true,
    serverUrl: baseUrl,
    robotId: 'robot-1',
    pollMs: 2000,
    getFrame: () => ({ kind: 'sim', id: 'scene-1' }),
    log: () => {},
  });
}

const task: PushedTask = {
  id: 'task-1',
  actionType: 'wait',
  actionConfig: { durationMs: 0 },
  instruction: 'Wait',
  priority: 'normal',
  source: 'command',
};

/** Push one task through a TaskQueue and wait for both status reports. */
async function runOneTask(): Promise<void> {
  const state = { status: 'online' } as unknown as SimulatedRobotState;
  const ok = async () => ({ success: true, message: 'ok' });
  const queue = new TaskQueue(
    () => state,
    (update) => update(state),
    () => {},
    { moveTo: ok, pickup: ok, drop: ok, goToCharge: ok, returnHome: ok, stop: ok }
  );
  await queue.accept(task);
  await vi.waitFor(() =>
    expect(calls.filter((call) => call.method === 'PUT').length).toBeGreaterThanOrEqual(2)
  );
}

function stubStateManager(): RobotStateManager {
  return {
    getState: () => ({ location: { x: 1, y: 1, floor: '1' } }),
    moveTo: async () => ({ success: true, message: 'moving' }),
    setZoneCache: () => {},
  } as unknown as RobotStateManager;
}

it('authenticates identity, events and photos to the configured platform', async () => {
  await reportRobotIdentity(baseUrl, 'http://robot-agent:41243');
  await mirror().push(event);
  expect(await mirror().pushPatrolPhoto(photo)).toBe(true);
  expect(calls.map((call) => call.url)).toEqual([
    '/api/robots/register', '/api/robots/robot-1/agent-mode/events', '/api/robots/robot-1/patrol-runs/run-1/photos/cp-1.jpg',
  ]);
  expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
});

it('reports rejected identity and events, and retries rejected photos without claiming delivery', async () => {
  rejectRequests = true;
  await expect(reportRobotIdentity(baseUrl, 'http://robot-agent:41243')).rejects.toThrow('HTTP 401');
  await mirror().push(event);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('event push failed'));
  expect(await mirror().pushPatrolPhoto(photo)).toBe(false);
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(3);
});

it('authenticates compliance session creation, immediate logs, queued logs and session shutdown', async () => {
  const client = new ComplianceLogClient(baseUrl, 'robot-1');
  try {
    expect(await client.startSession()).toBe('session-1');
    await client.logSafetyAction(safety);
    await client.logAIDecision({ payload: { description: 'Test decision' } });
    await client.flush();
    expect(client.getQueueSize()).toBe(0);
  } finally {
    await client.endSession();
  }
  expect(calls.map((call) => call.method)).toEqual(['POST', 'POST', 'POST', 'DELETE']);
  expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
});

it('keeps rejected compliance logs queued for retry and reports rejected shutdown', async () => {
  const client = new ComplianceLogClient(baseUrl, 'robot-1');
  await client.startSession();
  try {
    rejectRequests = true;
    await client.logSafetyAction(safety);
    expect(client.getQueueSize()).toBe(1);
    await client.flush();
    expect(client.getQueueSize()).toBe(1);
    rejectRequests = false;
    await client.flush();
    expect(client.getQueueSize()).toBe(0);
  } finally {
    rejectRequests = true;
    await client.endSession();
  }
  expect(console.error).toHaveBeenCalledWith('[ComplianceLogClient] Failed to end session:', expect.any(Error));
  expect(console.log).not.toHaveBeenCalledWith('[ComplianceLogClient] Session ended: session-1');
});

it('authenticates patrol and place graph reads, preserving the cache on authorization rejection', async () => {
  const patrol = new PatrolRouteSource({ serverUrl: baseUrl, cachePath: join(cacheDir, 'patrol.json') });
  const places = new PlaceGraphSource({ serverUrl: baseUrl, twinId: 'twin-1', cachePath: join(cacheDir, 'places.json') });
  expect((await patrol.fetch('route-1')).origin).toBe('server');
  expect((await places.refresh()).origin).toBe('server');
  rejectRequests = true;
  expect(await patrol.fetch('route-1')).toMatchObject({ origin: 'cache', error: 'HTTP 401' });
  expect(await places.refresh()).toMatchObject({ origin: 'cache', error: 'HTTP 401' });
  expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
});

it('authenticates the update check, the zone fetch, the peer poll and the task status report', async () => {
  const updates = new SecureUpdateClient('robot-1', baseUrl);
  expect(await updates.checkForUpdates()).toHaveLength(1);

  expect(await getNamedLocation('Warehouse A')).toMatchObject({ zone: 'Warehouse A', x: 20, y: 20 });

  const peers = peerTracker();
  await peers.pollOnce();
  expect(peers.status().lastError).toBeNull();

  await runOneTask();

  expect(calls.map((call) => call.url)).toEqual(
    expect.arrayContaining([
      '/api/updates?status=approved',
      '/api/zones',
      '/api/robots/robot-1/peers',
      '/api/processes/tasks/task-1/status',
    ])
  );
  expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
  expect(lastPlatformAuthRejection()).toBeNull();
});

it('says so out loud when the platform refuses the update check, the peer poll or the task report', async () => {
  rejectRequests = true;
  const updates = new SecureUpdateClient('robot-1', baseUrl);

  // The periodic path must not throw — it logs, records, and answers "none".
  expect(await updates.checkForUpdates()).toEqual([]);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Update check rejected: HTTP 401'));

  // The caller-driven path keeps throwing, but names the cause.
  await expect(updates.downloadUpdate('pkg-1')).rejects.toThrow('HTTP 401');

  const peers = peerTracker();
  await peers.pollOnce();
  expect(peers.status().lastError).toBe('HTTP 401');
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[Peers] poll rejected: HTTP 401'));

  await runOneTask();
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining('Task task-1 status report rejected: HTTP 401')
  );

  // Everything the agent's /api/v1/health renders as `platformAuth`.
  expect(lastPlatformAuthRejection()).toMatchObject({
    client: 'TaskQueue',
    status: 401,
    url: `${baseUrl}/api/processes/tasks/task-1/status`,
    tokenConfigured: true,
  });
});

it('refuses to invent a destination when the zone list cannot be read, and still knows home', async () => {
  rejectRequests = true;
  setRobotStateManager(stubStateManager());

  const result = (await moveToLocation({ zone: 'Warehouse A' })) as unknown as {
    success: boolean;
    message?: string;
    targetLocation?: { x: number; y: number };
  };

  expect(result.success).toBe(false);
  expect(result.message).toContain('zone list could not be read');
  // The fabricated (25, 25) this replaced: the robot drove there and reported
  // that it had arrived at "Warehouse A".
  expect(result.targetLocation).toBeUndefined();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Zone list rejected: HTTP 401'));
  expect(lastPlatformAuthRejection()).toMatchObject({ client: 'navigation', status: 401 });

  // The two locations the robot must always be able to reach are fallbacks,
  // not zone lookups, and a rejected zone list may not take them away.
  expect(await getHomeLocation()).toMatchObject({ x: 0, y: 0, zone: 'Home Base' });
  expect(await getChargingStationLocation()).toMatchObject({ x: 5, y: 20, zone: 'Charging Bay' });
});

it('preserves development requests without credentials and never changes unrelated fetch headers', async () => {
  vi.stubEnv('NEODEM_SERVICE_TOKEN', '');
  expect(platformAuthHeaders()).toEqual({});
  await reportRobotIdentity(baseUrl, 'http://robot-agent:41243');
  await mirror().push(event);
  const client = new ComplianceLogClient(baseUrl, 'robot-1');
  await client.startSession();
  await client.endSession();
  expect(calls.every((call) => call.auth === undefined)).toBe(true);
  vi.stubEnv('NEODEM_SERVICE_TOKEN', token);
  await fetch(`${baseUrl}/sidecar/camera`);
  expect(calls.at(-1)?.auth).toBeUndefined();
});

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
import { platformAuthHeaders } from '../platform-auth.js';
import { reportRobotIdentity } from '../platform-registration.js';
import { ServerMirror } from '../../agent-mode/server-mirror.js';
import type { AgentModeEvent } from '../../agent-mode/types.js';
import { ComplianceLogClient } from '../../compliance/ComplianceLogClient.js';
import { PatrolRouteSource } from '../../agent-mode/patrol.js';
import { PlaceGraphSource } from '../../agent-mode/place-graph-source.js';

const token = 'ndsa_test-platform-token';
let server: Server;
let baseUrl: string;
let cacheDir: string;
let rejectRequests: boolean;
let calls: { url: string; auth?: string; method?: string }[];

beforeEach(async () => {
  vi.stubEnv('NEODEM_SERVICE_TOKEN', token);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  calls = [];
  rejectRequests = false;
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
    } else {
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const event: AgentModeEvent = { type: 'agent:state:changed', robotId: 'robot-1', timestamp: new Date().toISOString() };
const photo = { runId: 'run-1', key: 'cp-1.jpg', jpeg: Buffer.from('jpeg'), kind: 'control' as const, checkpointId: 'cp-1', routeId: 'route-1', capturedAt: new Date().toISOString() };
const safety = { payload: { description: 'Stopped', actionType: 'stop', triggerReason: 'test' } };
function mirror() {
  return new ServerMirror({ serverUrl: baseUrl, robotId: 'robot-1', journal: null, retryDelayMs: 0, logCommandExecution: async () => {} });
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

/**
 * @file robot-bringup-routes.test.ts
 * @description Readiness + robot-side Start/Stop routes (TASK-409) against a
 *              fake supervisor and a fake agent: roles (a viewer gets 403 and
 *              still leaves an audit entry), confirm and lease for arm_sdk,
 *              one compliance entry per POST, registration after Start, and
 *              `bringup: null` / 404 `no_supervisor` without ROBOT_SUPERVISORS.
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import {
  bringupDenialAudit,
  createRobotBringupRoutes,
  type BringupAuditEntry,
  type RobotVisibility,
} from '../routes/robot-bringup.routes.js';
import { writeRoleGuard } from '../middleware/auth.middleware.js';
import { RobotReadinessService } from '../services/robot-supervisor/RobotReadinessService.js';
import { SupervisorClient } from '../services/robot-supervisor/SupervisorClient.js';
import { readAgentReadiness, readSupervisorStatus } from '../services/robot-supervisor/index.js';
import {
  agentReadiness,
  fakeAgent,
  fakeSupervisor,
  step,
  supStatus,
  TOKEN,
  type FakeHttp,
} from '../services/robot-supervisor/__tests__/fakes.js';

const USERS: Record<string, { id: string; role: string; tenantId: string; name: string; email: string }> = {
  alice: { id: 'alice', role: 'member', tenantId: 'tenant-a', name: 'Alice', email: 'a@x' },
  olga: { id: 'olga', role: 'owner', tenantId: 'tenant-a', name: 'Olga', email: 'o@x' },
  vera: { id: 'vera', role: 'viewer', tenantId: 'tenant-a', name: 'Vera', email: 'v@x' },
};

function fakeAuth(req: Request, _res: Response, next: NextFunction) {
  const who = req.header('x-test-user');
  if (who && USERS[who]) (req as Request & { user?: unknown }).user = USERS[who];
  next();
}

const ROBOT = 'sim-g1';
const LEASE = { leaseId: 'raw-lease-secret', generation: 3 };

let servers: FakeHttp[] = [];
let audits: BringupAuditEntry[] = [];
let sup: FakeHttp;
let agent: FakeHttp;
let supState: { status: ReturnType<typeof supStatus>; answer?: { status: number; body: unknown } };
let registered: Set<string>;
let registerCalls: Array<{ url: string; tenantId: string | null }>;
let service: RobotReadinessService;

interface Rig {
  supervised?: boolean;
  visibility?: RobotVisibility;
  /** The server's supervisor token (default: the one the fake accepts). */
  token?: string;
}

function buildApp(rig: Rig = {}) {
  const supervised = rig.supervised ?? true;
  const client = new SupervisorClient(sup.url, rig.token ?? TOKEN);
  service = new RobotReadinessService({
    supervisedRobots: () => (supervised ? [ROBOT] : []),
    readSupervisor: () => readSupervisorStatus(client),
    registeredAgentUrl: async (id) => (registered.has(id) ? agent.url : null),
    supervisorAgentUrl: (_id, status) => (supervised ? client.agentUrlFor(status) : null),
    readAgent: readAgentReadiness,
    register: async (url, tenantId) => {
      registerCalls.push({ url, tenantId });
      registered.add(ROBOT);
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/robots', bringupDenialAudit((e) => void audits.push(e)));
  app.use(
    '/api/robots',
    fakeAuth,
    writeRoleGuard,
    createRobotBringupRoutes({
      service,
      supervisorFor: (id) => (supervised && id === ROBOT ? client : undefined),
      visibility: async (id) => (id === ROBOT ? (rig.visibility ?? 'visible') : 'absent'),
      holdsLease: async (userId, robotId, leaseId, generation) =>
        userId === 'alice' && robotId === ROBOT && leaseId === LEASE.leaseId && generation === LEASE.generation,
      audit: (e) => void audits.push(e),
    }),
  );
  return app;
}

/** Wait for the fire-and-forget audit. */
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', 'false');
  audits = [];
  registered = new Set([ROBOT]);
  registerCalls = [];
  supState = { status: supStatus('ready', 'ok') };
  sup = await fakeSupervisor(supState);
  // The fake agent's agentPort must be the one the supervisor status names.
  const agentState = { readiness: agentReadiness(ROBOT, { code: 'following', severity: 'ok' as const, text: 'Following.' }) };
  agent = await fakeAgent(agentState);
  supState.status = supStatus('ready', 'ok', {}, agent.port);
  servers = [sup, agent];
});

afterEach(async () => {
  service?.stop();
  vi.unstubAllEnvs();
  await Promise.all(servers.map((s) => s.close()));
});

const base = `/api/robots/${ROBOT}`;

describe('GET /:id/readiness', () => {
  it('lets a viewer read the merged snapshot', async () => {
    const res = await request(buildApp()).get(`${base}/readiness`).set('x-test-user', 'vera');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      robotId: ROBOT,
      agent: { reachable: true, error: null },
      bringup: { overall: 'ready' },
      reason: { code: 'following', source: 'agent' },
    });
    expect(service.isWatched(ROBOT)).toBe(true);
  });

  it('works without a supervisor: bringup null, the agent line', async () => {
    const res = await request(buildApp({ supervised: false })).get(`${base}/readiness`).set('x-test-user', 'vera');
    expect(res.status).toBe(200);
    expect(res.body.bringup).toBeNull();
    expect(res.body.reason).toMatchObject({ code: 'following', source: 'agent' });
  });

  it('404s a robot of another tenant, and an unknown unsupervised one', async () => {
    let res = await request(buildApp({ visibility: 'foreign' })).get(`${base}/readiness`).set('x-test-user', 'vera');
    expect(res.status).toBe(404);
    res = await request(buildApp()).get('/api/robots/nope/readiness').set('x-test-user', 'vera');
    expect(res.status).toBe(404);
  });

  it('answers for a supervised robot that has no record yet', async () => {
    registered.clear();
    supState.status = supStatus('stopped', 'idle');
    const res = await request(buildApp({ visibility: 'absent' })).get(`${base}/readiness`).set('x-test-user', 'vera');
    expect(res.status).toBe(200);
    expect(res.body.reason.code).toBe('bringup_stopped');
  });
});

describe('GET /:id/bringup', () => {
  it('passes the supervisor status through', async () => {
    const res = await request(buildApp()).get(`${base}/bringup`).set('x-test-user', 'vera');
    expect(res.status).toBe(200);
    expect(res.body.overall).toBe('ready');
    expect(res.body.steps).toHaveLength(6);
  });

  it('404 no_supervisor without ROBOT_SUPERVISORS', async () => {
    const res = await request(buildApp({ supervised: false })).get(`${base}/bringup`).set('x-test-user', 'vera');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('no_supervisor');
  });

  it('502 supervisor_auth_failed when the supervisor refuses the server token', async () => {
    const res = await request(buildApp({ token: 'wrong-token' })).get(`${base}/bringup`).set('x-test-user', 'vera');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('supervisor_auth_failed');
  });

  it('503 when the supervisor does not answer', async () => {
    const app = buildApp();
    await sup.close();
    servers = [agent];
    const res = await request(app).get(`${base}/bringup`).set('x-test-user', 'vera');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('supervisor_unreachable');
  });
});

describe('POST /:id/bringup/start', () => {
  it('starts read_only for a member, one audit entry, no lease needed', async () => {
    const res = await request(buildApp()).post(`${base}/bringup/start`).set('x-test-user', 'olga').send({ mode: 'read_only' });
    expect(res.status).toBe(202);
    await settle();
    expect(sup.requests.filter((r) => r.method === 'POST')).toEqual([
      expect.objectContaining({ path: '/start', body: { mode: 'read_only' } }),
    ]);
    expect(audits).toEqual([
      expect.objectContaining({ action: 'bringup_start', mode: 'read_only', result: 'ok', status: 202, userId: 'olga', robotId: ROBOT }),
    ]);
  });

  it('refuses a viewer with 403 and audits it once', async () => {
    const res = await request(buildApp()).post(`${base}/bringup/start`).set('x-test-user', 'vera').send({ mode: 'read_only' });
    expect(res.status).toBe(403);
    await settle();
    expect(sup.requests.filter((r) => r.method === 'POST')).toEqual([]);
    expect(audits).toEqual([expect.objectContaining({ action: 'bringup_start', result: 'denied', status: 403, code: 'forbidden' })]);
  });

  it('arm_sdk without confirm → 400', async () => {
    const res = await request(buildApp()).post(`${base}/bringup/start`).set('x-test-user', 'alice').send({ mode: 'arm_sdk', ...LEASE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('confirm_required');
    await settle();
    expect(audits).toEqual([expect.objectContaining({ result: 'denied', code: 'confirm_required', status: 400 })]);
  });

  it("arm_sdk without the caller's lease → 409 lease_required", async () => {
    const app = buildApp();
    let res = await request(app).post(`${base}/bringup/start`).set('x-test-user', 'alice').send({ mode: 'arm_sdk', confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('lease_required');
    // Someone else's lease (olga presents alice's secret) is not hers.
    res = await request(app).post(`${base}/bringup/start`).set('x-test-user', 'olga').send({ mode: 'arm_sdk', confirm: true, ...LEASE });
    expect(res.status).toBe(409);
    res = await request(app)
      .post(`${base}/bringup/start`)
      .set('x-test-user', 'alice')
      .send({ mode: 'arm_sdk', confirm: true, leaseId: LEASE.leaseId, generation: 2 });
    expect(res.status).toBe(409);
    await settle();
    expect(sup.requests.filter((r) => r.method === 'POST')).toEqual([]);
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => a.code === 'lease_required')).toBe(true);
  });

  it('arm_sdk with confirm and the lease reaches the supervisor', async () => {
    const res = await request(buildApp())
      .post(`${base}/bringup/start`)
      .set('x-test-user', 'alice')
      .send({ mode: 'arm_sdk', confirm: true, ...LEASE });
    expect(res.status).toBe(202);
    await settle();
    expect(sup.requests.find((r) => r.method === 'POST')?.body).toEqual({ mode: 'arm_sdk' });
    expect(audits).toEqual([expect.objectContaining({ result: 'ok', mode: 'arm_sdk' })]);
    expect(JSON.stringify(audits)).not.toContain(LEASE.leaseId);
  });

  it('400s an unknown mode', async () => {
    const res = await request(buildApp()).post(`${base}/bringup/start`).set('x-test-user', 'alice').send({ mode: 'full' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_mode');
  });

  it('passes a supervisor refusal through, audited as denied', async () => {
    supState.answer = { status: 409, body: { ok: false, code: 'busy', error: 'the supervisor is starting' } };
    const res = await request(buildApp()).post(`${base}/bringup/start`).set('x-test-user', 'alice').send({ mode: 'read_only' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('busy');
    await settle();
    expect(audits).toEqual([expect.objectContaining({ result: 'denied', code: 'busy', status: 409 })]);
  });

  it('maps a refused server token to 502, never a 401 the app would retry', async () => {
    const res = await request(buildApp({ token: 'wrong-token' }))
      .post(`${base}/bringup/start`)
      .set('x-test-user', 'alice')
      .send({ mode: 'read_only' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('supervisor_auth_failed');
    await settle();
    expect(audits).toEqual([expect.objectContaining({ action: 'bringup_start', code: 'supervisor_auth_failed', status: 502 })]);
  });

  it('registers a missing robot once the agent step is ok', async () => {
    registered.clear();
    supState.status = supStatus('starting', 'ok', { agent: step('agent', 'running') }, agent.port);
    const app = buildApp({ visibility: 'absent' });
    const res = await request(app).post(`${base}/bringup/start`).set('x-test-user', 'alice').send({ mode: 'read_only' });
    expect(res.status).toBe(202);
    await service.poll(ROBOT);
    expect(registerCalls).toEqual([]);
    supState.status = supStatus('ready', 'ok', {}, agent.port);
    await service.poll(ROBOT);
    expect(registerCalls).toEqual([{ url: `http://127.0.0.1:${agent.port}`, tenantId: 'tenant-a' }]);
    await service.poll(ROBOT);
    expect(registerCalls).toHaveLength(1);
  });

  it('404 no_supervisor without ROBOT_SUPERVISORS, still audited', async () => {
    const res = await request(buildApp({ supervised: false })).post(`${base}/bringup/start`).set('x-test-user', 'alice').send({ mode: 'read_only' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('no_supervisor');
    await settle();
    expect(audits).toEqual([expect.objectContaining({ code: 'no_supervisor', status: 404 })]);
  });
});

describe('POST /:id/bringup/stop', () => {
  it('answers {status, baseMode} and never touches the base mode', async () => {
    const app = buildApp();
    await request(app).get(`${base}/readiness`).set('x-test-user', 'alice'); // caches the agent's base
    const res = await request(app).post(`${base}/bringup/stop`).set('x-test-user', 'alice').send({});
    expect(res.status).toBe(202);
    expect(res.body.status.overall).toBe('ready');
    expect(res.body.baseMode).toEqual({ mode: 'limp', fsmId: 1, source: 'agent' });
    expect(agent.requests.every((r) => r.method === 'GET')).toBe(true);
    await settle();
    expect(audits).toEqual([expect.objectContaining({ action: 'bringup_stop', result: 'ok' })]);
  });

  it("falls back to the supervisor's last base reading", async () => {
    const res = await request(buildApp()).post(`${base}/bringup/stop`).set('x-test-user', 'alice').send({});
    expect(res.body.baseMode).toEqual({ mode: 'damp', fsmId: 1, source: 'supervisor' });
  });

  it('refuses a viewer', async () => {
    const res = await request(buildApp()).post(`${base}/bringup/stop`).set('x-test-user', 'vera').send({});
    expect(res.status).toBe(403);
    await settle();
    expect(audits).toEqual([expect.objectContaining({ action: 'bringup_stop', status: 403 })]);
  });
});

describe('the other writes', () => {
  it('sidecar-mode needs confirm, and the lease for arm_sdk', async () => {
    const app = buildApp();
    let res = await request(app).post(`${base}/bringup/sidecar-mode`).set('x-test-user', 'alice').send({ mode: 'read_only' });
    expect(res.status).toBe(400);
    res = await request(app).post(`${base}/bringup/sidecar-mode`).set('x-test-user', 'alice').send({ mode: 'arm_sdk', confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('lease_required');
    res = await request(app).post(`${base}/bringup/sidecar-mode`).set('x-test-user', 'alice').send({ mode: 'read_only', confirm: true });
    expect(res.status).toBe(202);
    res = await request(app)
      .post(`${base}/bringup/sidecar-mode`)
      .set('x-test-user', 'alice')
      .send({ mode: 'arm_sdk', confirm: true, ...LEASE });
    expect(res.status).toBe(202);
    await settle();
    expect(sup.requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      { mode: 'read_only', confirm: true },
      { mode: 'arm_sdk', confirm: true },
    ]);
    expect(audits).toHaveLength(4);
  });

  it('adopt/leave a step, 404 for an unknown step; lan-up', async () => {
    const app = buildApp();
    expect((await request(app).post(`${base}/bringup/steps/bridge/adopt`).set('x-test-user', 'alice').send({})).status).toBe(202);
    expect((await request(app).post(`${base}/bringup/steps/sidecar/leave`).set('x-test-user', 'alice').send({})).status).toBe(202);
    const bad = await request(app).post(`${base}/bringup/steps/wifi/adopt`).set('x-test-user', 'alice').send({});
    expect(bad.status).toBe(404);
    expect(bad.body.code).toBe('no_step');
    expect((await request(app).post(`${base}/bringup/lan-up`).set('x-test-user', 'alice').send({})).status).toBe(202);
    const viewer = await request(app).post(`${base}/bringup/steps/bridge/adopt`).set('x-test-user', 'vera').send({});
    expect(viewer.status).toBe(403);
    await settle();
    expect(sup.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual([
      '/steps/bridge/adopt',
      '/steps/sidecar/leave',
      '/lan/up',
    ]);
    expect(audits.map((a) => `${a.action}:${a.step ?? ''}:${a.status}`)).toEqual([
      'bringup_adopt:bridge:202',
      'bringup_leave:sidecar:202',
      'bringup_adopt:wifi:404',
      'bringup_lan_up::202',
      'bringup_adopt:bridge:403',
    ]);
  });
});

describe('logs', () => {
  it('tail for a member, 403 for a viewer, 404 for an unknown process', async () => {
    const app = buildApp();
    const res = await request(app).get(`${base}/bringup/logs/agent?tail=5`).set('x-test-user', 'alice');
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual(['a', 'b']);
    expect(sup.requests.at(-1)?.path).toBe('/logs/agent?tail=5');
    expect((await request(app).get(`${base}/bringup/logs/agent`).set('x-test-user', 'vera')).status).toBe(403);
    expect((await request(app).get(`${base}/bringup/logs/kernel`).set('x-test-user', 'alice')).status).toBe(404);
  });

  it('passes the SSE stream through', async () => {
    const res = await request(buildApp()).get(`${base}/bringup/logs/sidecar/stream`).set('x-test-user', 'alice');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toBe('data: "line one"\n\ndata: "line two"\n\n');
  });
});

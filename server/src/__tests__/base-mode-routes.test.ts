/**
 * @file base-mode-routes.test.ts
 * @description The robot-mode proxy (TASK-398): role guards, body validation,
 *              the agent's status and body passed through verbatim, 503 when
 *              the agent is unreachable, and one compliance entry per attempt
 *              that never carries the lease id.
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import {
  createBaseModeRoutes,
  type AgentAnswer,
  type BaseModeAuditEntry,
} from '../routes/base-mode.routes.js';
import { writeRoleGuard } from '../middleware/auth.middleware.js';

const USERS: Record<string, { id: string; role: string; tenantId: string; name: string; email: string }> = {
  alice: { id: 'alice', role: 'member', tenantId: 'tenant-a', name: 'Alice', email: 'a@x' },
  vera: { id: 'vera', role: 'viewer', tenantId: 'tenant-a', name: 'Vera', email: 'v@x' },
};

function fakeAuth(req: Request, _res: Response, next: NextFunction) {
  const who = req.header('x-test-user');
  if (who && USERS[who]) (req as Request & { user?: unknown }).user = USERS[who];
  next();
}

let audits: BaseModeAuditEntry[] = [];
let postAnswer: AgentAnswer | Error = { status: 200, body: { ok: true } };
let getAnswer: AgentAnswer | Error = { status: 200, body: {} };
let posted: Array<{ baseUrl: string; robotId: string; body: Record<string, unknown> }> = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/robots',
    fakeAuth,
    writeRoleGuard,
    createBaseModeRoutes({
      resolveRobot: async (id) => (id === 'robot-1' ? { baseUrl: 'http://agent:41245' } : null),
      agent: {
        get: async () => {
          if (getAnswer instanceof Error) throw getAnswer;
          return getAnswer;
        },
        post: async (baseUrl, robotId, body) => {
          posted.push({ baseUrl, robotId, body });
          if (postAnswer instanceof Error) throw postAnswer;
          return postAnswer;
        },
      },
      audit: (e) => {
        audits.push(e);
      },
    }),
  );
  return app;
}

beforeEach(() => {
  vi.stubEnv('AUTH_DISABLED', 'false');
  audits = [];
  posted = [];
  postAnswer = { status: 200, body: { ok: true, mode: 'stand', fsm_id: 4, confirmed: true, fromMode: 'limp' } };
  getAnswer = { status: 200, body: { capability: { gate: 'fsm' }, base: { mode: 'limp', fsmId: 1 } } };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const URL = '/api/robots/robot-1/base-mode';
const LEASE = { leaseId: 'raw-lease-secret', generation: 3 };

/** Wait for the fire-and-forget audit. */
const settle = () => new Promise((r) => setImmediate(r));

describe('GET /:id/base-mode', () => {
  it('lets a viewer read the mode, passed through', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-user', 'vera');
    expect(res.status).toBe(200);
    expect(res.body.base).toEqual({ mode: 'limp', fsmId: 1 });
  });

  it('answers 503 agent_unreachable when the agent does not answer', async () => {
    getAnswer = new Error('ECONNREFUSED');
    const res = await request(buildApp()).get(URL).set('x-test-user', 'vera');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('agent_unreachable');
  });

  it('404s a robot the caller cannot see', async () => {
    const res = await request(buildApp()).get('/api/robots/robot-x/base-mode').set('x-test-user', 'vera');
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/base-mode', () => {
  it('refuses a viewer', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-user', 'vera').send({ mode: 'limp', ...LEASE });
    expect(res.status).toBe(403);
    expect(posted).toEqual([]);
  });

  it('400s a mode outside the allowlist and a missing lease', async () => {
    const app = buildApp();
    let res = await request(app).post(URL).set('x-test-user', 'alice').send({ mode: 'walk', ...LEASE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_mode');
    res = await request(app).post(URL).set('x-test-user', 'alice').send({ mode: 'stand' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('lease_required');
    res = await request(app).post(URL).set('x-test-user', 'alice').send({ mode: 'stand', leaseId: 'x', generation: 0 });
    expect(res.status).toBe(400);
    expect(posted).toEqual([]);
  });

  it('forwards mode and lease to the agent and passes a success through', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-user', 'alice').send({ mode: 'stand', ...LEASE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, fsm_id: 4, confirmed: true });
    expect(posted).toEqual([{
      baseUrl: 'http://agent:41245', robotId: 'robot-1', body: { mode: 'stand', ...LEASE },
    }]);
  });

  it('passes a refusal through with its status and code', async () => {
    postAnswer = { status: 409, body: { ok: false, code: 'bad_transition', from: 'limp', allowed_from: ['stand'] } };
    const res = await request(buildApp()).post(URL).set('x-test-user', 'alice').send({ mode: 'balance', ...LEASE });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, code: 'bad_transition', from: 'limp', allowed_from: ['stand'] });
  });

  it('answers 503 agent_unreachable when the agent does not answer', async () => {
    postAnswer = new Error('timeout');
    const res = await request(buildApp()).post(URL).set('x-test-user', 'alice').send({ mode: 'limp', ...LEASE });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('agent_unreachable');
  });

  it('writes one compliance entry per attempt — ok, denied, failed — never with the lease id', async () => {
    const app = buildApp();
    await request(app).post(URL).set('x-test-user', 'alice').send({ mode: 'stand', ...LEASE });
    postAnswer = { status: 409, body: { ok: false, code: 'not_settled' } };
    await request(app).post(URL).set('x-test-user', 'alice').send({ mode: 'balance', ...LEASE });
    postAnswer = { status: 504, body: { ok: false, code: 'unconfirmed', measured: { mode: 'stand' } } };
    await request(app).post(URL).set('x-test-user', 'alice').send({ mode: 'balance', ...LEASE });
    await settle();

    expect(audits.map((a) => [a.mode, a.result, a.code])).toEqual([
      ['stand', 'ok', null],
      ['balance', 'denied', 'not_settled'],
      ['balance', 'failed', 'unconfirmed'],
    ]);
    expect(audits[0]).toMatchObject({ robotId: 'robot-1', userId: 'alice', fromMode: 'limp', fsmId: 4 });
    expect(JSON.stringify(audits)).not.toContain('raw-lease-secret');
  });
});

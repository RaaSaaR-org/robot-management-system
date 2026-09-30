/**
 * @file control-lease-routes.test.ts
 * @description The control-lease HTTP surface (TASK-317): the flag, the role
 *              guards, tenant 404s, status codes, and that no secret leaks.
 * @feature robots
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createControlLeaseRoutes, controlLeaseDenialAudit } from '../routes/control-lease.routes.js';
import { writeRoleGuard } from '../middleware/auth.middleware.js';
import {
  ControlLeaseService,
  hashLeaseId,
  type AgentInstallResult,
  type ControlLeaseAgentPort,
  type ControlLeaseAuditEvent,
} from '../services/ControlLeaseService.js';

const USERS: Record<string, { id: string; role: string; tenantId: string; name: string; email: string }> = {
  alice: { id: 'alice', role: 'member', tenantId: 'tenant-a', name: 'Alice', email: 'a@x' },
  bob: { id: 'bob', role: 'owner', tenantId: 'tenant-a', name: 'Bob', email: 'b@x' },
  vera: { id: 'vera', role: 'viewer', tenantId: 'tenant-a', name: 'Vera', email: 'v@x' },
  mallory: { id: 'mallory', role: 'owner', tenantId: 'tenant-b', name: 'Mallory', email: 'm@x' },
};

/** Stand-in for authMiddleware: the user named in a test header. */
function fakeAuth(req: Request, _res: Response, next: NextFunction) {
  const who = req.header('x-test-user');
  if (who && USERS[who]) (req as Request & { user?: unknown }).user = USERS[who];
  next();
}

let tmpDir: string;
let db: PrismaClient;
let enabled = true;
let audits: ControlLeaseAuditEvent[] = [];
let installResult: AgentInstallResult = { ok: true };

const agent: ControlLeaseAgentPort = {
  install: async () => installResult,
  renew: async () => ({ ok: true, bound: true }),
  release: async () => true,
  observe: async () => ({ state: 'held', generation: 1 }),
};

function buildApp() {
  const audit = (e: ControlLeaseAuditEvent) => {
    audits.push(e);
  };
  const service = new ControlLeaseService({
    db,
    agent,
    audit,
    resolveRobot: async (id) => (id === 'robot-1' ? { robotId: id, tenantId: 'tenant-a', baseUrl: 'http://agent' } : null),
    readUser: async (id) => (USERS[id] ? { role: USERS[id].role, isActive: true } : null),
    ttlMs: () => 5000,
    renewEveryMs: () => 1000,
  });
  const app = express();
  app.use(express.json());
  // The production mount shape: denial audit, auth, writeRoleGuard, router.
  app.use(
    '/api/robots',
    controlLeaseDenialAudit(audit),
    fakeAuth,
    writeRoleGuard,
    createControlLeaseRoutes({ service, enabled: () => enabled, audit })
  );
  return app;
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'control-lease-routes-'));
  const url = `file:${join(tmpDir, 'test.db')}`;
  execSync(
    `npx prisma db push --schema=${join(__dirname, '..', '..', 'prisma', 'schema.prisma')} --skip-generate --accept-data-loss`,
    { env: { ...process.env, DATABASE_URL: url }, cwd: join(__dirname, '..', '..'), stdio: 'pipe' }
  );
  db = new PrismaClient({ datasources: { db: { url } }, log: [] });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Auth ON: the shipped dev default (AUTH_DISABLED=true) waves every role through.
  vi.stubEnv('AUTH_DISABLED', 'false');
  await db.robotControlLease.deleteMany({});
  enabled = true;
  audits = [];
  installResult = { ok: true };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const BASE = '/api/robots/robot-1/control-lease';

describe('control-lease routes, flag off', () => {
  it('GET advertises enabled:false; both POSTs are 404 control_leases_disabled', async () => {
    enabled = false;
    const app = buildApp();
    const got = await request(app).get(BASE).set('x-test-user', 'vera');
    expect(got.status).toBe(200);
    expect(got.body).toEqual({
      capability: { version: 1, enabled: false, ttlMs: 5000, renewEveryMs: 1000 },
      holder: null,
    });
    const acquire = await request(app).post(BASE).set('x-test-user', 'alice').send({});
    expect(acquire.status).toBe(404);
    expect(acquire.body).toEqual({ code: 'control_leases_disabled' });
    const release = await request(app)
      .post(`${BASE}/release`)
      .set('x-test-user', 'alice')
      .send({ leaseId: 'x', generation: 1 });
    expect(release.status).toBe(404);
    const renew = await request(app)
      .post(`${BASE}/renew`)
      .set('x-test-user', 'alice')
      .send({ leaseId: 'x', generation: 1 });
    expect(renew.status).toBe(404);
    expect(renew.body).toEqual({ code: 'control_leases_disabled' });
    expect(await db.robotControlLease.count()).toBe(0);
  });
});

describe('control-lease routes, flag on', () => {
  it('a member acquires (201) and the secret appears only in that answer', async () => {
    const app = buildApp();
    const acquired = await request(app).post(BASE).set('x-test-user', 'alice').send({ displayName: 'Alice @ VR' });
    expect(acquired.status).toBe(201);
    expect(acquired.body).toMatchObject({ generation: 1, ttlMs: 5000, renewEveryMs: 1000 });
    expect(typeof acquired.body.leaseId).toBe('string');
    expect(typeof acquired.body.sessionId).toBe('string');
    expect(typeof acquired.body.expiresAt).toBe('string');

    const got = await request(app).get(BASE).set('x-test-user', 'vera');
    expect(got.status).toBe(200);
    expect(got.body.capability.enabled).toBe(true);
    expect(got.body.holder).toMatchObject({ userId: 'alice', displayName: 'Alice @ VR', state: 'held', generation: 1 });

    const leaseId: string = acquired.body.leaseId;
    const everywhere = JSON.stringify({ get: got.body, audits });
    expect(everywhere).not.toContain(leaseId);
    expect(everywhere).not.toContain(hashLeaseId(leaseId));
  });

  it('a second acquire is 409 with the holder', async () => {
    const app = buildApp();
    await request(app).post(BASE).set('x-test-user', 'alice').send({});
    const second = await request(app).post(BASE).set('x-test-user', 'bob').send({});
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'lease_held', holder: { userId: 'alice', displayName: 'Alice' } });
  });

  it('a viewer is 403 on acquire and release, and the refusal is audited once', async () => {
    const app = buildApp();
    const res = await request(app).post(BASE).set('x-test-user', 'vera').send({});
    expect(res.status).toBe(403);
    const rel = await request(app).post(`${BASE}/release`).set('x-test-user', 'vera').send({ leaseId: 'x', generation: 1 });
    expect(rel.status).toBe(403);
    await vi.waitFor(() => expect(audits).toHaveLength(2));
    expect(audits[0]).toMatchObject({ action: 'deny', result: 'denied', robotId: 'robot-1', userId: 'vera', reason: 'forbidden' });
    expect(await db.robotControlLease.count()).toBe(0);
  });

  it('a user of another tenant gets 404 on every route', async () => {
    const app = buildApp();
    expect((await request(app).get(BASE).set('x-test-user', 'mallory')).status).toBe(404);
    const acquire = await request(app).post(BASE).set('x-test-user', 'mallory').send({});
    expect(acquire.status).toBe(404);
    expect(acquire.body).toEqual({ code: 'robot_not_found' });
    expect((await request(app).post('/api/robots/nope/control-lease').set('x-test-user', 'alice')).status).toBe(404);
  });

  it('an agent that does not ack the install is 503 agent_unconfirmed', async () => {
    installResult = { ok: false, reason: 'unreachable' };
    const app = buildApp();
    const res = await request(app).post(BASE).set('x-test-user', 'alice').send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'agent_unconfirmed' });
    // The mock agent still reports a held lease, so the recheck keeps it blocked.
    installResult = { ok: true };
    const next = await request(app).post(BASE).set('x-test-user', 'bob').send({});
    expect(next.status).toBe(409);
    expect(next.body.code).toBe('lease_unconfirmed');
  });

  it('release validates its body, then releases the holder only', async () => {
    const app = buildApp();
    const acquired = await request(app).post(BASE).set('x-test-user', 'alice').send({});
    const bad = await request(app).post(`${BASE}/release`).set('x-test-user', 'alice').send({ leaseId: acquired.body.leaseId });
    expect(bad.status).toBe(400);
    const stale = await request(app)
      .post(`${BASE}/release`)
      .set('x-test-user', 'bob')
      .send({ leaseId: acquired.body.leaseId, generation: acquired.body.generation });
    expect(stale.body).toEqual({ released: false });
    const ok = await request(app)
      .post(`${BASE}/release`)
      .set('x-test-user', 'alice')
      .send({ leaseId: acquired.body.leaseId, generation: acquired.body.generation });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ released: true });
    expect((await request(app).get(BASE).set('x-test-user', 'vera')).body.holder).toBeNull();
  });

  it('renew validates its body, then extends the holder\'s lease', async () => {
    const app = buildApp();
    const acquired = await request(app).post(BASE).set('x-test-user', 'alice').send({});
    const bad = await request(app).post(`${BASE}/renew`).set('x-test-user', 'alice').send({ generation: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_renew');
    const ok = await request(app)
      .post(`${BASE}/renew`)
      .set('x-test-user', 'alice')
      .send({ leaseId: acquired.body.leaseId, generation: acquired.body.generation });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ generation: 1, ttlMs: 5000, renewEveryMs: 1000 });
    expect(typeof ok.body.expiresAt).toBe('string');
    expect(JSON.stringify(ok.body)).not.toContain(acquired.body.leaseId);
    const stranger = await request(app)
      .post(`${BASE}/renew`)
      .set('x-test-user', 'bob')
      .send({ leaseId: acquired.body.leaseId, generation: acquired.body.generation });
    expect(stranger.status).toBe(409);
    expect(stranger.body).toEqual({ code: 'lease_lost' });
  });

  it('a viewer is 403 on renew, and the refusal is audited', async () => {
    const app = buildApp();
    const res = await request(app).post(`${BASE}/renew`).set('x-test-user', 'vera').send({ leaseId: 'x', generation: 1 });
    expect(res.status).toBe(403);
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(audits[0]).toMatchObject({ action: 'deny', userId: 'vera', reason: 'forbidden' });
  });
});

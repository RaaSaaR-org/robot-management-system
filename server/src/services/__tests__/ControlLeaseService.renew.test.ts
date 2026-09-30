/**
 * @file ControlLeaseService.renew.test.ts
 * @description Control-lease renewal, fencing and the expiry sweeper against a
 *              real SQLite database (TASK-318): a renew extends only the live
 *              generation, re-checks the user's role, needs a bound socket
 *              after the first TTL window, and every transition reaches
 *              observers without the secret.
 * @feature robots
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ControlLeaseError,
  ControlLeaseService,
  hashLeaseId,
  type AgentInstallBody,
  type AgentInstallResult,
  type AgentRenewResult,
  type ControlLeaseAgentPort,
  type ControlLeaseAuditEvent,
  type ControlLeaseRobot,
  type ControlLeaseTransition,
  type ControlLeaseUser,
} from '../ControlLeaseService.js';

const TTL = 5000;
const ROBOT: ControlLeaseRobot = { robotId: 'robot-1', tenantId: 'tenant-a', baseUrl: 'http://agent' };
const ALICE: ControlLeaseUser = { id: 'alice', role: 'member', tenantId: 'tenant-a', name: 'Alice' };
const BOB: ControlLeaseUser = { id: 'bob', role: 'member', tenantId: 'tenant-a', name: 'Bob' };

/** A scriptable robot agent that records every call. */
class MockAgent implements ControlLeaseAgentPort {
  releases: number[] = [];
  renews: Array<{ generation: number; ttlMs: number }> = [];
  renewResult: AgentRenewResult = { ok: true, bound: true };
  releaseAnswers = true;

  async install(_robot: ControlLeaseRobot, _body: AgentInstallBody): Promise<AgentInstallResult> {
    return { ok: true };
  }
  async renew(_robot: ControlLeaseRobot, generation: number, ttlMs: number): Promise<AgentRenewResult> {
    this.renews.push({ generation, ttlMs });
    return this.renewResult;
  }
  async release(_robot: ControlLeaseRobot, generation: number): Promise<boolean> {
    this.releases.push(generation);
    return this.releaseAnswers;
  }
  async observe() {
    return { state: 'none', generation: null };
  }
}

let tmpDir: string;
let dbA: PrismaClient;
let dbB: PrismaClient;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'control-lease-renew-'));
  const url = `file:${join(tmpDir, 'test.db')}`;
  execSync(
    `npx prisma db push --schema=${join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma')} --skip-generate --accept-data-loss`,
    { env: { ...process.env, DATABASE_URL: url }, cwd: join(__dirname, '..', '..', '..'), stdio: 'pipe' }
  );
  // Two clients on one file: two server replicas sharing the database.
  dbA = new PrismaClient({ datasources: { db: { url } }, log: [] });
  dbB = new PrismaClient({ datasources: { db: { url } }, log: [] });
}, 120_000);

afterAll(async () => {
  await dbA?.$disconnect();
  await dbB?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

let agent: MockAgent;
let audits: ControlLeaseAuditEvent[];
let published: ControlLeaseTransition[];
/** The shared test clock — both replicas read it. */
let clock: number;

function service(db: PrismaClient): ControlLeaseService {
  return new ControlLeaseService({
    db,
    agent,
    audit: (e) => {
      audits.push(e);
    },
    publish: (t) => {
      published.push(t);
    },
    resolveRobot: async (id) => (id === ROBOT.robotId ? ROBOT : null),
    now: () => clock,
    ttlMs: () => TTL,
    renewEveryMs: () => 1000,
  });
}

async function refusal(p: Promise<unknown>): Promise<ControlLeaseError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof ControlLeaseError) return error;
    throw error;
  }
  throw new Error('expected a ControlLeaseError');
}

async function row() {
  return dbA.robotControlLease.findUnique({ where: { robotId: ROBOT.robotId } });
}

beforeEach(async () => {
  await dbA.robotControlLease.deleteMany({});
  await dbA.user.deleteMany({});
  for (const u of [ALICE, BOB]) {
    await dbA.user.create({
      data: { id: u.id, email: `${u.id}@test.local`, passwordHash: 'x', name: u.name ?? u.id, role: 'member' },
    });
  }
  agent = new MockAgent();
  audits = [];
  published = [];
  clock = Date.parse('2026-09-30T10:00:00Z');
});

describe('ControlLeaseService.renew — the live generation only', () => {
  it('extends expiresAt for the current generation and tells the agent the TTL', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    clock += 1000;
    const renewed = await service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation);
    expect(renewed).toEqual({
      generation: grant.generation,
      expiresAt: new Date(clock + TTL).toISOString(),
      ttlMs: TTL,
      renewEveryMs: 1000,
    });
    expect((await row())?.expiresAt?.getTime()).toBe(clock + TTL);
    expect(agent.renews).toEqual([{ generation: grant.generation, ttlMs: TTL }]);
  });

  it('a renew after expiry is 409 lease_lost and never resurrects the row', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    clock += TTL + 1;
    expect(await service(dbA).sweepExpired()).toBe(1);
    expect((await row())?.state).toBe('expired');

    const error = await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.status).toBe(409);
    expect(error.body.code).toBe('lease_lost');
    expect((await row())?.state).toBe('expired');
    expect(agent.renews).toHaveLength(0);
  });

  it('a renew past the deadline but before the sweep is lost too, and extends nothing', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    const deadline = (await row())?.expiresAt?.getTime();
    clock += TTL + 1;
    const error = await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.body.code).toBe('lease_lost');
    expect((await row())?.expiresAt?.getTime()).toBe(deadline);
    expect(agent.renews).toHaveLength(0);
  });

  it('a wrong secret, an old generation or another user cannot renew — or fence — the lease', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    for (const [user, leaseId, generation] of [
      [ALICE, 'not-the-secret', grant.generation],
      [ALICE, grant.leaseId, grant.generation - 1],
      [BOB, grant.leaseId, grant.generation],
    ] as const) {
      const error = await refusal(service(dbA).renew(user, ROBOT.robotId, leaseId, generation));
      expect(error.status).toBe(409);
      expect(error.body.code).toBe('lease_lost');
    }
    expect((await row())?.state).toBe('held');
    expect(agent.releases).toHaveLength(0);
  });
});

describe('ControlLeaseService.renew — the role is re-read from the database', () => {
  it('a user demoted to viewer gets 403 not_authorized and the lease is fenced on the agent', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    await dbA.user.update({ where: { id: ALICE.id }, data: { role: 'viewer' } });

    // The JWT still says `member` — the database wins.
    const error = await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.status).toBe(403);
    expect(error.body.code).toBe('not_authorized');
    expect(agent.releases).toEqual([grant.generation]);
    expect((await row())?.state).toBe('released');
    expect(audits.at(-1)).toMatchObject({ action: 'fence', reason: 'not_authorized', userId: ALICE.id });
  });

  it('a disabled or deleted user is refused the same way', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    await dbA.user.update({ where: { id: ALICE.id }, data: { isActive: false } });
    expect((await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation))).status).toBe(403);

    const second = await service(dbA).acquire(BOB, ROBOT.robotId);
    await dbA.user.delete({ where: { id: BOB.id } });
    expect((await refusal(service(dbA).renew(BOB, ROBOT.robotId, second.leaseId, second.generation))).status).toBe(403);
    expect(agent.releases).toEqual([grant.generation, second.generation]);
  });
});

describe('ControlLeaseService.renew — the agent decides whether the lease is live', () => {
  it('bound:false within the first TTL window is allowed (the socket is still connecting)', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    agent.renewResult = { ok: true, bound: false };
    clock += 1000;
    const renewed = await service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation);
    expect(renewed.generation).toBe(grant.generation);
  });

  it('bound:false past the first TTL is 409 transport_lost and releases the lease on the agent', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    // Kept alive through the first window with a bound socket...
    for (let i = 0; i < 5; i++) {
      clock += 1000;
      await service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation);
    }
    // ...then the socket goes away.
    agent.renewResult = { ok: true, bound: false };
    clock += 1001;
    const error = await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.status).toBe(409);
    expect(error.body.code).toBe('transport_lost');
    expect(agent.releases).toEqual([grant.generation]);
    expect((await row())?.state).toBe('released');
    expect(audits.at(-1)).toMatchObject({ action: 'fence', reason: 'transport_lost' });
  });

  it('an agent that answers 409 (it restarted) fences the row: 409 lease_lost', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    agent.renewResult = { ok: false, reason: 'rejected' };
    const error = await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.status).toBe(409);
    expect(error.body.code).toBe('lease_lost');
    expect(agent.releases).toEqual([grant.generation]);
    expect((await row())?.state).toBe('released');
  });

  it('an unreachable agent is 503 agent_unconfirmed and leaves the DB deadline as it was', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    const deadline = (await row())?.expiresAt?.getTime();
    agent.renewResult = { ok: false, reason: 'unreachable' };
    clock += 1000;
    const error = await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.status).toBe(503);
    expect(error.body.code).toBe('agent_unconfirmed');
    const after = await row();
    expect(after?.state).toBe('held');
    expect(after?.expiresAt?.getTime()).toBe(deadline);
    expect(agent.releases).toHaveLength(0);
  });

  it('a fence whose release the agent does not ack leaves the row unconfirmed (fail closed)', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    agent.renewResult = { ok: false, reason: 'rejected' };
    agent.releaseAnswers = false;
    await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect((await row())?.state).toBe('unconfirmed');
    expect(audits.at(-1)?.reason).toBe('lease_lost_release_unreachable');
  });
});

describe('ControlLeaseService.sweepExpired — exactly once across replicas', () => {
  it('fences a lease nobody renews, on either of two instances, exactly once', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    clock += TTL - 1;
    expect(await service(dbA).sweepExpired()).toBe(0);
    clock += 2;

    const counts = await Promise.all([service(dbA).sweepExpired(), service(dbB).sweepExpired()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(agent.releases).toEqual([grant.generation]);
    expect((await row())?.state).toBe('expired');
    expect(audits.filter((a) => a.action === 'expire')).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ action: 'expire', reason: 'expired', userId: ALICE.id });

    // Swept rows stay swept.
    expect(await service(dbB).sweepExpired()).toBe(0);
    expect(agent.releases).toHaveLength(1);
  });

  it('an expired row is takeable again by the next acquisition', async () => {
    await service(dbA).acquire(ALICE, ROBOT.robotId);
    clock += TTL + 1;
    await service(dbB).sweepExpired();
    const next = await service(dbA).acquire(BOB, ROBOT.robotId);
    expect(next.generation).toBe(2);
  });
});

describe('ControlLeaseService — observer transitions', () => {
  it('publishes held → stopping → released with the holder, tenant-routed, never the secret', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    agent.renewResult = { ok: false, reason: 'rejected' };
    await refusal(service(dbA).renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));

    expect(published.map((t) => t.event.state)).toEqual(['held', 'stopping', 'released']);
    for (const t of published) {
      expect(t.tenantId).toBe(ROBOT.tenantId);
      expect(t.event).toMatchObject({
        type: 'control_lease',
        robotId: ROBOT.robotId,
        generation: grant.generation,
        holder: { userId: ALICE.id, displayName: 'Alice' },
      });
      const wire = JSON.stringify(t);
      expect(wire).not.toContain(grant.leaseId);
      expect(wire).not.toContain(hashLeaseId(grant.leaseId));
      expect(wire).not.toContain(grant.sessionId);
    }
  });

  it('publishes the sweep (expired) and a voluntary release', async () => {
    const first = await service(dbA).acquire(ALICE, ROBOT.robotId);
    await service(dbA).release(ALICE, ROBOT.robotId, first.leaseId, first.generation);
    await service(dbA).acquire(BOB, ROBOT.robotId);
    clock += TTL + 1;
    await service(dbA).sweepExpired();
    expect(published.map((t) => `${t.event.state}:${t.event.holder.userId}`)).toEqual([
      'held:alice',
      'released:alice',
      'held:bob',
      'stopping:bob',
      'expired:bob',
    ]);
  });

  it('a throwing observer changes nothing about the lease', async () => {
    const svc = new ControlLeaseService({
      db: dbA,
      agent,
      publish: () => {
        throw new Error('observer down');
      },
      resolveRobot: async () => ROBOT,
      now: () => clock,
      ttlMs: () => TTL,
      renewEveryMs: () => 1000,
    });
    const grant = await svc.acquire(ALICE, ROBOT.robotId);
    await expect(svc.renew(ALICE, ROBOT.robotId, grant.leaseId, grant.generation)).resolves.toBeTruthy();
  });
});

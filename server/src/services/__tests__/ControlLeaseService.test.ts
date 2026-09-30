/**
 * @file ControlLeaseService.test.ts
 * @description The server's control-lease authority against a real SQLite
 *              database (TASK-317): one winner across replicas, generations,
 *              fail-closed installs, stale releases, and no secret leakage.
 * @feature robots
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
  type ControlLeaseAgentPort,
  type ControlLeaseAuditEvent,
  type ControlLeaseRobot,
  type ControlLeaseUser,
} from '../ControlLeaseService.js';

const ROBOT: ControlLeaseRobot = { robotId: 'robot-1', tenantId: 'tenant-a', baseUrl: 'http://agent' };
const ALICE: ControlLeaseUser = { id: 'alice', role: 'member', tenantId: 'tenant-a', name: 'Alice' };
const BOB: ControlLeaseUser = { id: 'bob', role: 'member', tenantId: 'tenant-a', name: 'Bob' };
const MALLORY: ControlLeaseUser = { id: 'mallory', role: 'owner', tenantId: 'tenant-b', name: 'M' };

/** A scriptable robot agent. Records every install body it is sent. */
class MockAgent implements ControlLeaseAgentPort {
  installs: AgentInstallBody[] = [];
  releases: number[] = [];
  installResult: AgentInstallResult = { ok: true };
  releaseAnswers = true;
  observed: { state: string; generation: number | null } | null = { state: 'none', generation: null };

  async install(_robot: ControlLeaseRobot, body: AgentInstallBody): Promise<AgentInstallResult> {
    this.installs.push(body);
    return this.installResult;
  }
  async release(_robot: ControlLeaseRobot, generation: number): Promise<boolean> {
    this.releases.push(generation);
    return this.releaseAnswers;
  }
  async observe() {
    return this.observed;
  }
}

let tmpDir: string;
let dbA: PrismaClient;
let dbB: PrismaClient;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'control-lease-'));
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

function service(db: PrismaClient, now: () => number = Date.now): ControlLeaseService {
  return new ControlLeaseService({
    db,
    agent,
    audit: (e) => {
      audits.push(e);
    },
    resolveRobot: async (id) => (id === ROBOT.robotId ? ROBOT : null),
    now,
    ttlMs: () => 5000,
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

beforeEach(async () => {
  await dbA.robotControlLease.deleteMany({});
  agent = new MockAgent();
  audits = [];
});

describe('ControlLeaseService — one winner', () => {
  it('two replicas racing for a robot with no row yet: exactly one wins', async () => {
    const results = await Promise.allSettled([
      service(dbA).acquire(ALICE, ROBOT.robotId),
      service(dbB).acquire(BOB, ROBOT.robotId),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const error = lost[0].reason as ControlLeaseError;
    expect(error).toBeInstanceOf(ControlLeaseError);
    expect(error.status).toBe(409);
    expect(error.body.code).toBe('lease_held');
    expect(error.body.holder?.state).toMatch(/installing|held/);
    expect(agent.installs).toHaveLength(1);
  });

  it('two replicas racing over an existing released row: exactly one wins', async () => {
    const first = await service(dbA).acquire(ALICE, ROBOT.robotId);
    await service(dbA).release(ALICE, ROBOT.robotId, first.leaseId, first.generation);

    for (let round = 0; round < 5; round++) {
      const results = await Promise.allSettled([
        service(dbA).acquire(ALICE, ROBOT.robotId),
        service(dbB).acquire(BOB, ROBOT.robotId),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
        leaseId: string;
        generation: number;
      }>[];
      expect(won).toHaveLength(1);
      const winner = (results[0].status === 'fulfilled' ? ALICE : BOB) as ControlLeaseUser;
      const holder = await service(dbA).observe(ALICE, ROBOT.robotId);
      expect(holder?.userId).toBe(winner.id);
      expect(holder?.state).toBe('held');
      await service(dbB).release(winner, ROBOT.robotId, won[0].value.leaseId, won[0].value.generation);
    }
  });

  it('the same user in a second session is refused with the holder', async () => {
    await service(dbA).acquire(ALICE, ROBOT.robotId, 'Alice (tab 1)');
    const error = await refusal(service(dbB).acquire(ALICE, ROBOT.robotId, 'Alice (tab 2)'));
    expect(error.status).toBe(409);
    expect(error.body).toMatchObject({
      code: 'lease_held',
      holder: { userId: 'alice', displayName: 'Alice (tab 1)', state: 'held', generation: 1 },
    });
    expect(typeof error.body.holder?.expiresAt).toBe('string');
    expect(audits.at(-1)).toMatchObject({ action: 'deny', result: 'denied', reason: 'lease_held' });
  });

  it('a robot in another tenant, or no robot at all, is 404', async () => {
    expect((await refusal(service(dbA).acquire(MALLORY, ROBOT.robotId))).body.code).toBe('robot_not_found');
    expect((await refusal(service(dbA).acquire(ALICE, 'nope'))).status).toBe(404);
    expect((await refusal(service(dbA).observe(MALLORY, ROBOT.robotId))).status).toBe(404);
    expect(agent.installs).toHaveLength(0);
  });

  it('a lease whose deadline lapsed can be taken, at a higher generation', async () => {
    let now = Date.now();
    const clock = () => now;
    const first = await service(dbA, clock).acquire(ALICE, ROBOT.robotId);
    now += 5001;
    expect(await service(dbA, clock).observe(ALICE, ROBOT.robotId)).toBeNull();
    const second = await service(dbB, clock).acquire(BOB, ROBOT.robotId);
    expect(second.generation).toBe(first.generation + 1);
  });
});

describe('ControlLeaseService — generations and the agent', () => {
  it('generation strictly increases and is exactly what the agent received', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const user = i % 2 === 0 ? ALICE : BOB;
      const grant = await service(i % 2 === 0 ? dbA : dbB).acquire(user, ROBOT.robotId);
      seen.push(grant.generation);
      await service(dbA).release(user, ROBOT.robotId, grant.leaseId, grant.generation);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(agent.installs.map((b) => b.generation)).toEqual(seen);
    expect(agent.releases).toEqual(seen);
    expect(agent.installs[0]).toMatchObject({ userId: 'alice', tenantId: 'tenant-a', ttlMs: 5000 });
  });

  it('the grant carries the secret once; the agent only ever sees its hash', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    expect(grant).toMatchObject({ generation: 1, ttlMs: 5000, renewEveryMs: 1000 });
    expect(grant.leaseId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(agent.installs[0].leaseIdHash).toBe(hashLeaseId(grant.leaseId));
    expect(agent.installs[0].sessionId).toBe(grant.sessionId);
    expect(JSON.stringify(agent.installs)).not.toContain(grant.leaseId);
  });

  it.each([
    ['refused', { ok: false, reason: 'refused' } as AgentInstallResult],
    ['unreachable', { ok: false, reason: 'unreachable' } as AgentInstallResult],
  ])('an agent that %s the install fails closed until a recheck clears it', async (_label, result) => {
    agent.installResult = result;
    const error = await refusal(service(dbA).acquire(ALICE, ROBOT.robotId));
    expect(error.status).toBe(503);
    expect(error.body).toEqual({ code: 'agent_unconfirmed' });
    expect((await dbA.robotControlLease.findUnique({ where: { robotId: ROBOT.robotId } }))?.state).toBe(
      'unconfirmed'
    );
    expect(audits.at(-1)).toMatchObject({ action: 'unconfirmed', result: 'denied' });

    // The agent says it holds something, or cannot be asked: still blocked.
    agent.installResult = { ok: true };
    agent.observed = { state: 'held', generation: 1 };
    expect((await refusal(service(dbB).acquire(BOB, ROBOT.robotId))).body.code).toBe('lease_unconfirmed');
    agent.observed = null;
    expect((await refusal(service(dbB).acquire(BOB, ROBOT.robotId))).body.code).toBe('lease_unconfirmed');
    agent.observed = { state: 'weird', generation: null };
    expect((await refusal(service(dbB).acquire(BOB, ROBOT.robotId))).status).toBe(409);

    // A positive "nothing installed" clears it, and the next one wins.
    agent.observed = { state: 'none', generation: null };
    const grant = await service(dbB).acquire(BOB, ROBOT.robotId);
    expect(grant.generation).toBe(2);
  });

  it('a stale-generation refusal lifts the row to the agent high-water', async () => {
    agent.installResult = { ok: false, reason: 'stale_generation', highWater: 7 };
    await refusal(service(dbA).acquire(ALICE, ROBOT.robotId));
    agent.installResult = { ok: true };
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    expect(grant.generation).toBe(8);
  });
});

describe('ControlLeaseService — release', () => {
  it('a stale release does not touch the current holder', async () => {
    const old = await service(dbA).acquire(ALICE, ROBOT.robotId);
    await service(dbA).release(ALICE, ROBOT.robotId, old.leaseId, old.generation);
    const current = await service(dbB).acquire(BOB, ROBOT.robotId);

    expect(await service(dbA).release(ALICE, ROBOT.robotId, old.leaseId, old.generation)).toEqual({
      released: false,
    });
    // Right generation, wrong secret; right secret, wrong user.
    expect(await service(dbA).release(BOB, ROBOT.robotId, old.leaseId, current.generation)).toEqual({
      released: false,
    });
    expect(await service(dbA).release(ALICE, ROBOT.robotId, current.leaseId, current.generation)).toEqual({
      released: false,
    });

    const holder = await service(dbA).observe(BOB, ROBOT.robotId);
    expect(holder).toMatchObject({ userId: 'bob', state: 'held', generation: current.generation });
    expect(agent.releases).toEqual([old.generation]);
  });

  it('an agent that cannot be reached on release leaves the row unconfirmed; the holder can retry', async () => {
    const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
    agent.releaseAnswers = false;
    const error = await refusal(service(dbA).release(ALICE, ROBOT.robotId, grant.leaseId, grant.generation));
    expect(error.status).toBe(503);
    expect((await service(dbA).observe(ALICE, ROBOT.robotId))?.state).toBe('unconfirmed');

    agent.releaseAnswers = true;
    expect(await service(dbA).release(ALICE, ROBOT.robotId, grant.leaseId, grant.generation)).toEqual({
      released: true,
    });
    expect(await service(dbA).observe(ALICE, ROBOT.robotId)).toBeNull();
  });
});

describe('ControlLeaseService — no secret leaves', () => {
  it('neither the lease secret nor its hash reaches observe, audit, or logs', async () => {
    const logged: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    try {
      const grant = await service(dbA).acquire(ALICE, ROBOT.robotId);
      await refusal(service(dbB).acquire(BOB, ROBOT.robotId));
      const observed = await service(dbA).observe(BOB, ROBOT.robotId);
      await service(dbA).release(ALICE, ROBOT.robotId, grant.leaseId, grant.generation);

      const hash = hashLeaseId(grant.leaseId);
      const surfaces = JSON.stringify({ observed, audits, logged });
      expect(surfaces).not.toContain(grant.leaseId);
      expect(surfaces).not.toContain(hash);
      expect(audits.map((a) => a.action)).toEqual(['acquire', 'deny', 'release']);
      expect(audits[0]).toMatchObject({
        robotId: ROBOT.robotId,
        tenantId: 'tenant-a',
        userId: 'alice',
        sessionId: grant.sessionId,
        generation: grant.generation,
      });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

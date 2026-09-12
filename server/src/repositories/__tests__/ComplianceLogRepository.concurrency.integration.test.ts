/**
 * @file ComplianceLogRepository.concurrency.integration.test.ts
 * @description Real-database proof that concurrent compliance appends cannot fork
 *   the hash chain (TASK-291)
 * @feature compliance
 *
 * Every other test around this repository mocks the Prisma seam, so none of them
 * can see the defect this file exists for: two overlapping `create` calls used to
 * read the same chain head and persist the same `previousHash`, and
 * `verifyHashChain` then reported that link broken forever — a false tamper report
 * in the EU AI Act Art. 12 audit trail. Measured on a real SQLite database before
 * the fix, `Promise.all` of 10 creates produced only 2 distinct `previousHash`
 * values: 8 rows forked in one shot.
 *
 * So this test uses a real temporary SQLite database and the real repository
 * singleton. Bootstrap follows multi-tenancy.integration.test.ts: `prisma db push`
 * into a temp file, then a PrismaClient pointed at it, handed to the repository by
 * mocking the database module. Real `encrypt()` works because vitest sets
 * NODE_ENV=test, which takes the dev-key branch in security/encryption.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Bootstrap a real temp database BEFORE the repository module is imported, so
// the singleton binds to this client. `vi.hoisted` is what runs ahead of the
// imports; `db push` is synchronous, so the client is ready by the time the
// module factory below is asked for it.
// ---------------------------------------------------------------------------

const { testPrisma, tmpDir } = await vi.hoisted(async () => {
  const { execSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { PrismaClient } = await import('@prisma/client');

  const serverRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const schemaPath = join(serverRoot, 'prisma', 'schema.prisma');

  const dir = mkdtempSync(join(tmpdir(), 'neodem-chain-'));
  // SQLite takes one writer and Prisma's SQLite pool is 1, so 25 simultaneous
  // appends queue — that queueing is the point of the test. The connector's
  // default 5s socket_timeout is a budget for a contention-free query and the
  // tail of the queue blows straight through it, failing the run for a reason
  // that has nothing to do with the chain. These are raised to cover the wait.
  const url = `file:${join(dir, 'chain.db')}?connection_limit=1&socket_timeout=60&pool_timeout=60`;

  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: url },
    cwd: serverRoot,
    stdio: 'pipe',
  });

  return {
    tmpDir: dir,
    testPrisma: new PrismaClient({ datasources: { db: { url } }, log: [] }),
  };
});

vi.mock('../../database/index.js', () => ({ prisma: testPrisma }));

import { rmSync } from 'node:fs';
import { complianceLogRepository } from '../ComplianceLogRepository.js';
import type { CompliancePayload } from '../../types/compliance.types.js';

const CONCURRENT_WRITES = 25;

function payload(i: number): CompliancePayload {
  return {
    description: `concurrent append ${i}`,
    outputAction: 'move',
    confidence: 0.5,
  } as CompliancePayload;
}

beforeAll(async () => {
  await testPrisma.$connect();
}, 60_000);

afterAll(async () => {
  await testPrisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ComplianceLogRepository — concurrent appends (real database)', () => {
  it('keeps the hash chain intact and unforked under 25 simultaneous creates', async () => {
    const written = await Promise.all(
      Array.from({ length: CONCURRENT_WRITES }, (_, i) =>
        complianceLogRepository.create({
          sessionId: `sess-${i}`,
          robotId: `robot-${i % 3}`,
          eventType: 'ai_decision',
          payload: payload(i),
        }),
      ),
    );

    expect(written).toHaveLength(CONCURRENT_WRITES);

    // The user-visible assertion: the audit page must not report tampering.
    const verification = await complianceLogRepository.verifyHashChain();
    expect(verification.brokenLinks).toEqual([]);
    expect(verification.isValid).toBe(true);
    expect(verification.totalLogs).toBe(CONCURRENT_WRITES);
    expect(verification.verifiedLogs).toBe(CONCURRENT_WRITES);

    const rows = await testPrisma.complianceLog.findMany({
      orderBy: { seq: 'asc' },
      select: { id: true, seq: true, previousHash: true, currentHash: true },
    });

    // Every row numbered, strictly increasing, no gaps and no duplicates.
    expect(rows.map((r) => r.seq)).toEqual(
      Array.from({ length: CONCURRENT_WRITES }, (_, i) => i + 1),
    );

    // The fork signature: before the fix, `previousHash` repeated across rows
    // because several writers chained onto the same head. Each value may now be
    // claimed by exactly one successor.
    const previousHashes = rows.map((r) => r.previousHash);
    expect(new Set(previousHashes).size).toBe(previousHashes.length);

    // And each link actually points at its predecessor's hash.
    expect(rows[0].previousHash).toBe('');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].previousHash).toBe(rows[i - 1].currentHash);
    }
  }, 120_000);

  it('continues the existing chain when a second burst appends to it', async () => {
    const before = await testPrisma.complianceLog.count();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        complianceLogRepository.create({
          sessionId: `second-${i}`,
          robotId: 'robot-9',
          eventType: 'safety_action',
          payload: payload(100 + i),
        }),
      ),
    );

    const verification = await complianceLogRepository.verifyHashChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalLogs).toBe(before + 10);

    // getLatestLog reads the head by seq, so it must be the highest-numbered row.
    const head = await complianceLogRepository.getLatestLog();
    const maxSeq = await testPrisma.complianceLog.aggregate({ _max: { seq: true } });
    expect(head?.seq).toBe(maxSeq._max.seq);
    expect(head?.seq).toBe(before + 10);
  }, 120_000);
});

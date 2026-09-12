/**
 * @file backfill-compliance-seq.ts
 * @description Fill ComplianceLog.seq for rows written before TASK-291
 * @feature compliance
 *
 * Run: npm run backfill:compliance-seq   (from server/)
 *
 * Why a script and not just the migration: local development goes through
 * `npm run db:push`, which applies the schema directly and never executes the
 * checked-in migration SQL — so the `row_number()` backfill inside
 * `20260912160000_task_291_compliance_chain_seq` runs on PostgreSQL deployments
 * only. On a pushed SQLite database the column arrives empty and this script is
 * what populates it.
 *
 * This script writes ONLY `seq`. It never touches `previousHash` or
 * `currentHash`: rows that were already forked by the pre-fix concurrent-write
 * defect stay visibly forked, because recomputing their hashes would destroy the
 * tamper evidence the chain exists to provide.
 *
 * It is idempotent — rows that already have a `seq` are skipped, and numbering
 * resumes above the current maximum — so it is safe to re-run after new logs
 * have been written.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Rows per transaction. Keeps a large backfill off a single long-running tx. */
const CHUNK_SIZE = 500;

async function main(): Promise<void> {
  const total = await prisma.complianceLog.count();
  const missing = await prisma.complianceLog.count({ where: { seq: null } });

  console.log(`[backfill-compliance-seq] ${total} logs, ${missing} without a seq`);

  if (missing === 0) {
    console.log('[backfill-compliance-seq] Nothing to do');
    return;
  }

  // Resume above whatever is already numbered so re-runs cannot collide with
  // rows the unique index is already holding.
  const highest = await prisma.complianceLog.aggregate({ _max: { seq: true } });
  let next = (highest._max.seq ?? 0) + 1;

  // (timestamp, id) is the same order the migration's row_number() uses, so a
  // database that took the SQL path and one that took this path agree.
  const rows = await prisma.complianceLog.findMany({
    where: { seq: null },
    select: { id: true },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });

  let written = 0;
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.complianceLog.update({
          where: { id: row.id },
          data: { seq: next++ },
        }),
      ),
    );
    written += chunk.length;
    console.log(`[backfill-compliance-seq] ${written}/${rows.length}`);
  }

  const remaining = await prisma.complianceLog.count({ where: { seq: null } });
  if (remaining > 0) {
    throw new Error(
      `[backfill-compliance-seq] ${remaining} rows still have a null seq — the unique index cannot be trusted to order the chain`,
    );
  }

  console.log(`[backfill-compliance-seq] Done — assigned seq to ${written} rows`);
}

main()
  .catch((error) => {
    console.error('[backfill-compliance-seq] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

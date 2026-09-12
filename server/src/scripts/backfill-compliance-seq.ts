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
 * tamper evidence the chain exists to provide. Renumbering is safe precisely
 * because `seq` is not a hash input — the hash stays
 * `previousHash|timestamp|payloadHash|eventType`.
 *
 * Numbering goes BELOW whatever is already numbered, never above it. On a
 * `db:push` database the column lands empty, so appends made after the fix take
 * seq 1..N while the historical rows still have none. Resuming at `max(seq)+1`
 * would stamp the whole history above those appends and stand the chain on its
 * head: the genesis row would sort last, and an export — which must reproduce
 * the chain in the order it was built — would emit it backwards. So the history
 * is numbered `min(seq) - missing .. min(seq) - 1`, or `1..missing` when nothing
 * is numbered yet. Negative numbers are fine: `seq` orders the chain, it does
 * not count it.
 *
 * Guarantees, precisely:
 * - Rows that already carry a `seq` are never touched. The number they claimed
 *   under the unique index IS their chain position; rewriting it would throw
 *   that witness away.
 * - Unnumbered rows are numbered in `(timestamp, id)` order, the same order the
 *   migration's `row_number()` uses, so a database that took the SQL path and
 *   one that took this path agree.
 * - A re-run with nothing left unnumbered is a no-op.
 */

import { PrismaClient } from '@prisma/client';

/** Rows per transaction. Keeps a large backfill off a single long-running tx. */
const CHUNK_SIZE = 500;

export interface BackfillResult {
  /** Rows in the table. */
  total: number;
  /** Rows that had no `seq` when the run started. */
  missing: number;
  /** Rows this run numbered. */
  written: number;
  /** Lowest `seq` assigned, or null when there was nothing to do. */
  firstSeq: number | null;
  /** Highest `seq` assigned, or null when there was nothing to do. */
  lastSeq: number | null;
}

/**
 * Number every `seq`-less compliance log, below the rows that already have one.
 *
 * Takes the client so the numbering can be exercised without a database.
 */
export async function backfillComplianceSeq(client: PrismaClient): Promise<BackfillResult> {
  const total = await client.complianceLog.count();

  // (timestamp, id) is the same order the migration's row_number() uses.
  const rows = await client.complianceLog.findMany({
    where: { seq: null },
    select: { id: true },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
  const missing = rows.length;

  console.log(`[backfill-compliance-seq] ${total} logs, ${missing} without a seq`);

  if (missing === 0) {
    console.log('[backfill-compliance-seq] Nothing to do');
    return { total, missing, written: 0, firstSeq: null, lastSeq: null };
  }

  // History belongs below everything already numbered — the rows that have a
  // seq were appended after these ones, whatever their number happens to be.
  const lowest = await client.complianceLog.aggregate({ _min: { seq: true } });
  const firstSeq = lowest._min.seq === null ? 1 : lowest._min.seq - missing;

  let written = 0;
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    await client.$transaction(
      chunk.map((row, index) =>
        client.complianceLog.update({
          where: { id: row.id },
          data: { seq: firstSeq + offset + index },
        }),
      ),
    );
    written += chunk.length;
    console.log(`[backfill-compliance-seq] ${written}/${rows.length}`);
  }

  const remaining = await client.complianceLog.count({ where: { seq: null } });
  if (remaining > 0) {
    throw new Error(
      `[backfill-compliance-seq] ${remaining} rows still have a null seq — the unique index cannot be trusted to order the chain`,
    );
  }

  const lastSeq = firstSeq + written - 1;
  console.log(
    `[backfill-compliance-seq] Done — assigned seq ${firstSeq}..${lastSeq} to ${written} rows`,
  );

  return { total, missing, written, firstSeq, lastSeq };
}

// Run directly (`npm run backfill:compliance-seq`), never on import: importing
// this module must not open a database connection.
if (process.argv[1] && process.argv[1].endsWith('backfill-compliance-seq.ts')) {
  const prisma = new PrismaClient();
  backfillComplianceSeq(prisma)
    .catch((error: unknown) => {
      console.error('[backfill-compliance-seq] Failed:', error);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}

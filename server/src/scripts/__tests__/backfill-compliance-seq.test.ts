/**
 * @file backfill-compliance-seq.test.ts
 * @description Unit tests for the ComplianceLog.seq backfill — numbering order and
 *   placement relative to rows that already carry a seq (TASK-291)
 * @feature compliance
 *
 * The script is exercised against a fake Prisma client rather than a database:
 * what has to be pinned is which numbers it hands out, and to which rows.
 */

import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { backfillComplianceSeq } from '../backfill-compliance-seq.js';

interface FakeRow {
  id: string;
  timestamp: Date;
  seq: number | null;
}

interface FakeClient {
  client: PrismaClient;
  rows: FakeRow[];
  /** Every `seq` written, in the order it was written. */
  writes: Array<{ id: string; seq: number }>;
}

/**
 * A Prisma stand-in over an in-memory row list. `update` applies the write, so
 * the trailing "any nulls left?" count sees the same table the script wrote.
 */
function makeClient(rows: FakeRow[]): FakeClient {
  const writes: Array<{ id: string; seq: number }> = [];

  const client = {
    complianceLog: {
      count: ({ where }: { where?: { seq?: null } } = {}) =>
        Promise.resolve(
          where?.seq === null ? rows.filter((r) => r.seq === null).length : rows.length,
        ),
      findMany: () =>
        Promise.resolve(
          rows
            .filter((r) => r.seq === null)
            .sort((a, b) =>
              a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id),
            )
            .map((r) => ({ id: r.id })),
        ),
      // Both bounds, so a run that resumes from the wrong end of the numbered
      // rows is a wrong answer here rather than an undefined one.
      aggregate: () => {
        const numbered = rows.filter((r) => r.seq !== null).map((r) => r.seq as number);
        return Promise.resolve({
          _min: { seq: numbered.length > 0 ? Math.min(...numbered) : null },
          _max: { seq: numbered.length > 0 ? Math.max(...numbered) : null },
        });
      },
      update: ({ where, data }: { where: { id: string }; data: { seq: number } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error(`no such row: ${where.id}`);
        row.seq = data.seq;
        writes.push({ id: where.id, seq: data.seq });
        return Promise.resolve(row);
      },
    },
    $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
  } as unknown as PrismaClient;

  return { client, rows, writes };
}

function legacyRow(id: string, iso: string): FakeRow {
  return { id, timestamp: new Date(iso), seq: null };
}

describe('backfillComplianceSeq', () => {
  it('numbers history BELOW rows that already have a seq, so the genesis row still leads', async () => {
    // The mixed state a db:push database lands in: the column arrived empty, so
    // the first appends after the fix took seq 1 and 2 while the historical rows
    // still have none. Resuming at max(seq)+1 would stamp the history 3..5 and
    // sort the whole chain backwards — genesis last.
    const { client, rows, writes } = makeClient([
      { id: 'new-a', timestamp: new Date('2026-03-01T00:00:00.000Z'), seq: 1 },
      { id: 'new-b', timestamp: new Date('2026-03-01T00:00:01.000Z'), seq: 2 },
      legacyRow('old-genesis', '2026-01-01T00:00:00.000Z'),
      legacyRow('old-second', '2026-01-02T00:00:00.000Z'),
      legacyRow('old-third', '2026-01-03T00:00:00.000Z'),
    ]);

    const result = await backfillComplianceSeq(client);

    expect(result).toEqual({
      total: 5,
      missing: 3,
      written: 3,
      firstSeq: -2,
      lastSeq: 0,
    });

    // History occupies min(seq) - missing .. min(seq) - 1, in chain order.
    expect(writes).toEqual([
      { id: 'old-genesis', seq: -2 },
      { id: 'old-second', seq: -1 },
      { id: 'old-third', seq: 0 },
    ]);

    // Rows that already claimed a number under the unique index keep it.
    expect(rows.find((r) => r.id === 'new-a')?.seq).toBe(1);
    expect(rows.find((r) => r.id === 'new-b')?.seq).toBe(2);

    // The whole point: read back in seq order, the chain starts at genesis and
    // the post-fix appends come last.
    const order = [...rows].sort((a, b) => (a.seq as number) - (b.seq as number)).map((r) => r.id);
    expect(order).toEqual(['old-genesis', 'old-second', 'old-third', 'new-a', 'new-b']);
  });

  it('numbers from 1 when nothing is numbered yet', async () => {
    const { client, writes } = makeClient([
      legacyRow('b', '2026-01-02T00:00:00.000Z'),
      legacyRow('a', '2026-01-01T00:00:00.000Z'),
    ]);

    const result = await backfillComplianceSeq(client);

    expect(result.firstSeq).toBe(1);
    expect(result.lastSeq).toBe(2);
    expect(writes).toEqual([
      { id: 'a', seq: 1 },
      { id: 'b', seq: 2 },
    ]);
  });

  it('orders a same-timestamp pair by id, as the migration row_number() does', async () => {
    const { client, writes } = makeClient([
      legacyRow('zz', '2026-01-01T00:00:00.000Z'),
      legacyRow('aa', '2026-01-01T00:00:00.000Z'),
    ]);

    await backfillComplianceSeq(client);

    expect(writes).toEqual([
      { id: 'aa', seq: 1 },
      { id: 'zz', seq: 2 },
    ]);
  });

  it('is a no-op when every row is already numbered', async () => {
    const { client, writes } = makeClient([
      { id: 'a', timestamp: new Date('2026-01-01T00:00:00.000Z'), seq: 1 },
    ]);

    const result = await backfillComplianceSeq(client);

    expect(result).toEqual({ total: 1, missing: 0, written: 0, firstSeq: null, lastSeq: null });
    expect(writes).toEqual([]);
  });
});

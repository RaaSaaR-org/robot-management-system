/**
 * @file ComplianceLogRepository.test.ts
 * @description Unit tests for ComplianceLogRepository — append-only compliance logging,
 *   hash-chain creation/verification, metrics aggregation, and access auditing. Mocks the
 *   Prisma client at the I/O boundary while running the real encryption/hash mappers.
 * @feature compliance
 *
 * The create tests assert against the transaction client, not the singleton: since
 * TASK-291 the head read and the insert both happen inside `prisma.$transaction`,
 * and a head read that escaped back onto the singleton would be the exact defect
 * that forked the chain. The concurrency this protects is covered for real in
 * ComplianceLogRepository.concurrency.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock for the singleton Prisma client (repo imports `prisma`)
// ---------------------------------------------------------------------------

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  });

  // The interactive-transaction client the repository must do its chain work on.
  const tx = { complianceLog: model() };

  return {
    mockTx: tx,
    mockPrisma: {
      complianceLog: model(),
      complianceLogAccess: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
});

vi.mock('../../database/index.js', () => ({ prisma: mockPrisma }));

// Real encryption + hash helpers run for real (not mocked) — they back the mappers.
import { encrypt, sha256, generateLogHash } from '../../security/encryption.js';
import { DEFAULT_RETENTION_DAYS } from '../../types/retention.types.js';
import { ComplianceLogRepository, complianceLogRepository } from '../ComplianceLogRepository.js';
import type {
  CreateComplianceLogInput,
  CompliancePayload,
  ComplianceEventType,
} from '../../types/compliance.types.js';

// The chain order the repository must use (TASK-291). `seq` leads: `timestamp`
// alone is non-unique, so ties came back in arbitrary order and read as breaks.
// Rows that predate the backfill have no `seq` and fall back to
// (timestamp, id) — timestamp FIRST, because `id` is a random uuid and an
// id-led tie-break shuffles an unnumbered chain into false tamper reports.
const CHAIN_ORDER_ASC = [
  { seq: { sort: 'asc', nulls: 'first' } },
  { timestamp: 'asc' },
  { id: 'asc' },
];
const CHAIN_ORDER_DESC = [
  { seq: { sort: 'desc', nulls: 'last' } },
  { timestamp: 'desc' },
  { id: 'desc' },
];

type OrderTerm = Record<string, string | { sort: string; nulls?: string }>;

/**
 * Sort fixture rows the way the database would for a given Prisma `orderBy`.
 *
 * Lets a chain-order regression be caught by the walk itself — feed the rows in
 * a scrambled order and let the repository's own `orderBy` impose the chain —
 * rather than only by asserting the shape of the query.
 */
function applyOrderBy<T extends Record<string, unknown>>(rows: T[], orderBy: OrderTerm[]): T[] {
  const terms = orderBy.map((term) => {
    const [field, spec] = Object.entries(term)[0];
    return typeof spec === 'string'
      ? { field, sort: spec, nulls: 'first' }
      : { field, sort: spec.sort, nulls: spec.nulls ?? 'first' };
  });

  return [...rows].sort((a, b) => {
    for (const { field, sort, nulls } of terms) {
      const av = a[field] as string | number | Date | null;
      const bv = b[field] as string | number | Date | null;
      if (av === null && bv === null) continue;
      if (av === null) return nulls === 'first' ? -1 : 1;
      if (bv === null) return nulls === 'first' ? 1 : -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return sort === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Fixtures — build DB rows whose encrypted payload is produced by REAL encrypt()
// so that the real dbToDomain mapper can decrypt them.
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOAD: CompliancePayload = {
  description: 'AI decided to move',
  outputAction: 'move',
  confidence: 0.92,
} as CompliancePayload;

/**
 * Build a complete ComplianceLog DB row. The payload is encrypted with the real
 * encryption module so dbToDomain can decrypt it and the mapping runs for real.
 */
function makeLogRow(overrides: Record<string, unknown> = {}) {
  const payload = (overrides.payload as CompliancePayload) ?? SAMPLE_PAYLOAD;
  const payloadJson = JSON.stringify(payload);
  const { ciphertext, iv } = encrypt(payloadJson);
  const payloadHash = sha256(payloadJson);
  const timestamp = (overrides.timestamp as Date) ?? new Date('2026-01-01T00:00:00.000Z');
  const previousHash = (overrides.previousHash as string) ?? '';
  const eventType = (overrides.eventType as string) ?? 'ai_decision';
  const currentHash =
    (overrides.currentHash as string) ??
    generateLogHash(previousHash, timestamp.toISOString(), payloadHash, eventType);

  // strip helper-only key
  const { payload: _omit, ...rest } = overrides;
  void _omit;

  return {
    id: 'log-1',
    sessionId: 'sess-1',
    robotId: 'robot-1',
    operatorId: null,
    eventType,
    severity: 'info',
    payloadEncrypted: ciphertext,
    payloadIv: iv,
    payloadHash,
    modelVersion: null,
    modelHash: null,
    inputHash: null,
    outputHash: null,
    previousHash,
    currentHash,
    seq: 1,
    decisionId: null,
    timestamp,
    immutable: true,
    retentionExpiresAt: new Date('2036-01-01T00:00:00.000Z'),
    ...rest,
  };
}

function makeAccessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'access-1',
    logId: 'log-1',
    userId: 'user-1',
    accessType: 'view',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<CreateComplianceLogInput> = {}): CreateComplianceLogInput {
  return {
    sessionId: 'sess-1',
    robotId: 'robot-1',
    eventType: 'ai_decision',
    payload: SAMPLE_PAYLOAD,
    ...overrides,
  };
}

/** Prisma's P2002, as the client raises it when the `seq` unique index is hit. */
function uniqueSeqViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`seq`)',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['seq'] } },
  );
}

describe('ComplianceLogRepository', () => {
  let repo: ComplianceLogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // Interactive transaction: hand the callback the tx client.
    mockPrisma.$transaction.mockImplementation(
      async (cb: (client: typeof mockTx) => unknown) => cb(mockTx),
    );
    repo = new ComplianceLogRepository();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('builds the hash chain off the latest log and persists an immutable row', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue({ seq: 7, currentHash: 'prev-hash' });
      mockTx.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      const input = makeCreateInput({ severity: 'warning', operatorId: 'op-9' });
      const result = await repo.create(input);

      // The whole chain operation runs in one transaction, at the only
      // isolation level the sqlite-generated client exposes.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Budgets are explicit: a queued append must wait its turn rather than
      // be dropped, since a lost compliance log is worse than a slow one.
      expect(mockPrisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 20_000,
        timeout: 20_000,
      });

      // Head read happens on the transaction client, in chain order — never on
      // the singleton, which is what let two creates read the same head.
      expect(mockTx.complianceLog.findFirst).toHaveBeenCalledWith({
        orderBy: CHAIN_ORDER_DESC,
        select: { seq: true, currentHash: true },
      });
      expect(mockPrisma.complianceLog.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.complianceLog.create).not.toHaveBeenCalled();

      // create payload shape
      const createArg = mockTx.complianceLog.create.mock.calls[0][0];
      const data = createArg.data;
      expect(data.sessionId).toBe('sess-1');
      expect(data.robotId).toBe('robot-1');
      expect(data.operatorId).toBe('op-9');
      expect(data.eventType).toBe('ai_decision');
      expect(data.severity).toBe('warning');
      expect(data.previousHash).toBe('prev-hash');
      expect(data.immutable).toBe(true);
      // next chain position, claimed under the unique index
      expect(data.seq).toBe(8);

      // payloadHash is sha256 of the serialized payload
      expect(data.payloadHash).toBe(sha256(JSON.stringify(input.payload)));

      // currentHash matches the real chain hash computation — seq is NOT an input
      const expectedHash = generateLogHash(
        'prev-hash',
        (data.timestamp as Date).toISOString(),
        data.payloadHash as string,
        'ai_decision',
      );
      expect(data.currentHash).toBe(expectedHash);

      // retention window: ai_decision = 3650 days from timestamp
      const ts = data.timestamp as Date;
      const expectedRetention = new Date(ts);
      expectedRetention.setDate(expectedRetention.getDate() + DEFAULT_RETENTION_DAYS.ai_decision);
      expect((data.retentionExpiresAt as Date).getTime()).toBe(expectedRetention.getTime());

      // returned domain object is decrypted by the real mapper
      expect(result.payload).toEqual(input.payload);
      // row is built from the create data, so severity round-trips through the mapper
      expect(result.severity).toBe('warning');
      expect(result.seq).toBe(8);
    });

    it('uses empty previousHash and seq 1 when there is no prior log, and defaults severity to info', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue(null);
      mockTx.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      await repo.create(makeCreateInput());

      const data = mockTx.complianceLog.create.mock.calls[0][0].data;
      expect(data.previousHash).toBe('');
      expect(data.severity).toBe('info');
      expect(data.seq).toBe(1);
    });

    it('starts a chain at seq 1 when the head predates the backfill and has a null seq', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue({ seq: null, currentHash: 'legacy-hash' });
      mockTx.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      await repo.create(makeCreateInput());

      const data = mockTx.complianceLog.create.mock.calls[0][0].data;
      expect(data.seq).toBe(1);
      expect(data.previousHash).toBe('legacy-hash');
    });

    it('falls back to 365-day retention for unknown event types', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue(null);
      mockTx.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      await repo.create(makeCreateInput({ eventType: 'unknown_type' as ComplianceEventType }));

      const data = mockTx.complianceLog.create.mock.calls[0][0].data;
      const ts = data.timestamp as Date;
      const expected = new Date(ts);
      expected.setDate(expected.getDate() + 365);
      expect((data.retentionExpiresAt as Date).getTime()).toBe(expected.getTime());
    });

    it('retries against a freshly read head when the insert loses the seq race (P2002)', async () => {
      // First attempt sees head seq 4; a concurrent writer takes seq 5 and the
      // unique index rejects ours. The retry must re-read — reusing the stale
      // head would persist the duplicate previousHash this whole task exists
      // to prevent.
      mockTx.complianceLog.findFirst
        .mockResolvedValueOnce({ seq: 4, currentHash: 'hash-4' })
        .mockResolvedValueOnce({ seq: 5, currentHash: 'hash-5' });
      mockTx.complianceLog.create
        .mockRejectedValueOnce(uniqueSeqViolation())
        .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(makeLogRow(data)),
        );

      const result = await repo.create(makeCreateInput());

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockTx.complianceLog.findFirst).toHaveBeenCalledTimes(2);
      expect(mockTx.complianceLog.create).toHaveBeenCalledTimes(2);

      const first = mockTx.complianceLog.create.mock.calls[0][0].data;
      const second = mockTx.complianceLog.create.mock.calls[1][0].data;
      expect(first.seq).toBe(5);
      expect(first.previousHash).toBe('hash-4');
      // the retry chains onto the winner, not onto the head it first read
      expect(second.seq).toBe(6);
      expect(second.previousHash).toBe('hash-5');
      expect(second.currentHash).toBe(
        generateLogHash(
          'hash-5',
          (second.timestamp as Date).toISOString(),
          second.payloadHash as string,
          'ai_decision',
        ),
      );
      expect(result.seq).toBe(6);
    });

    it('retries a serializable conflict (P2034)', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue({ seq: 1, currentHash: 'h1' });
      mockTx.complianceLog.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('write conflict', {
            code: 'P2034',
            clientVersion: 'test',
          }),
        )
        .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(makeLogRow(data)),
        );

      await expect(repo.create(makeCreateInput())).resolves.toBeDefined();
      expect(mockTx.complianceLog.create).toHaveBeenCalledTimes(2);
    });

    it('gives up after a bounded number of lost races rather than looping forever', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue({ seq: 1, currentHash: 'h1' });
      mockTx.complianceLog.create.mockRejectedValue(uniqueSeqViolation());

      await expect(repo.create(makeCreateInput())).rejects.toMatchObject({ code: 'P2002' });
      // MAX_CHAIN_ATTEMPTS
      expect(mockTx.complianceLog.create).toHaveBeenCalledTimes(5);
    });

    it('does not retry an unrelated failure', async () => {
      mockTx.complianceLog.findFirst.mockResolvedValue(null);
      mockTx.complianceLog.create.mockRejectedValue(new Error('database is gone'));

      await expect(repo.create(makeCreateInput())).rejects.toThrow('database is gone');
      expect(mockTx.complianceLog.create).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe('findById', () => {
    it('returns the decrypted log without recording access when no accessor is given', async () => {
      mockPrisma.complianceLog.findUnique.mockResolvedValue(makeLogRow());

      const result = await repo.findById('log-1');

      expect(mockPrisma.complianceLog.findUnique).toHaveBeenCalledWith({ where: { id: 'log-1' } });
      expect(mockPrisma.complianceLogAccess.create).not.toHaveBeenCalled();
      expect(result?.id).toBe('log-1');
      expect(result?.payload).toEqual(SAMPLE_PAYLOAD);
    });

    it('returns null when the log does not exist', async () => {
      mockPrisma.complianceLog.findUnique.mockResolvedValue(null);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
      expect(mockPrisma.complianceLogAccess.create).not.toHaveBeenCalled();
    });

    it('records a view-access audit entry when an accessor user id is provided', async () => {
      mockPrisma.complianceLog.findUnique.mockResolvedValue(makeLogRow());
      mockPrisma.complianceLogAccess.create.mockResolvedValue(makeAccessRow());

      await repo.findById('log-1', 'user-1', '10.0.0.1', 'agent');

      expect(mockPrisma.complianceLogAccess.create).toHaveBeenCalledWith({
        data: {
          logId: 'log-1',
          userId: 'user-1',
          accessType: 'view',
          ipAddress: '10.0.0.1',
          userAgent: 'agent',
        },
      });
    });

    it('records access when only an ip address is provided', async () => {
      mockPrisma.complianceLog.findUnique.mockResolvedValue(makeLogRow());
      mockPrisma.complianceLogAccess.create.mockResolvedValue(makeAccessRow());

      await repo.findById('log-1', undefined, '10.0.0.2');

      expect(mockPrisma.complianceLogAccess.create).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // findByIdEncrypted
  // -------------------------------------------------------------------------
  describe('findByIdEncrypted', () => {
    it('returns the encrypted row without decrypting it', async () => {
      const row = makeLogRow();
      mockPrisma.complianceLog.findUnique.mockResolvedValue(row);

      const result = await repo.findByIdEncrypted('log-1');

      expect(mockPrisma.complianceLog.findUnique).toHaveBeenCalledWith({ where: { id: 'log-1' } });
      expect(result?.payloadEncrypted).toBe(row.payloadEncrypted);
      expect(result?.payloadIv).toBe(row.payloadIv);
      expect(result?.seq).toBe(row.seq);
      // encrypted mapper does not add a decrypted payload field
      expect((result as unknown as { payload?: unknown }).payload).toBeUndefined();
    });

    it('returns null when not found', async () => {
      mockPrisma.complianceLog.findUnique.mockResolvedValue(null);
      expect(await repo.findByIdEncrypted('missing')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------
  describe('findAll', () => {
    it('applies defaults (page 1, limit 50, timestamp desc) and computes pagination', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([makeLogRow()]);
      mockPrisma.complianceLog.count.mockResolvedValue(120);

      const result = await repo.findAll();

      // findAll is the browsing query, not a chain walk — timestamp stays.
      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 50,
        orderBy: { timestamp: 'desc' },
      });
      expect(mockPrisma.complianceLog.count).toHaveBeenCalledWith({ where: {} });
      expect(result.total).toBe(120);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.totalPages).toBe(3); // ceil(120/50)
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].payload).toEqual(SAMPLE_PAYLOAD);
    });

    it('builds the where clause from all filters including a date range, and honors sort/pagination', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([]);
      mockPrisma.complianceLog.count.mockResolvedValue(0);

      const start = new Date('2026-01-01T00:00:00.000Z');
      const end = new Date('2026-02-01T00:00:00.000Z');

      await repo.findAll({
        page: 2,
        limit: 10,
        sessionId: 'sess-1',
        robotId: 'robot-1',
        operatorId: 'op-1',
        eventType: 'safety_action',
        severity: 'critical',
        decisionId: 'dec-1',
        startDate: start,
        endDate: end,
        sortBy: 'severity',
        sortOrder: 'asc',
      });

      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {
          sessionId: 'sess-1',
          robotId: 'robot-1',
          operatorId: 'op-1',
          eventType: 'safety_action',
          severity: 'critical',
          decisionId: 'dec-1',
          timestamp: { gte: start, lte: end },
        },
        skip: 10, // (2-1)*10
        take: 10,
        orderBy: { severity: 'asc' },
      });
    });

    it('returns an empty result set with zero total pages', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([]);
      mockPrisma.complianceLog.count.mockResolvedValue(0);

      const result = await repo.findAll();
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // findBySessionId / findByDecisionId
  // -------------------------------------------------------------------------
  describe('findBySessionId', () => {
    it('queries by session id ordered ascending and maps results', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([makeLogRow()]);

      const result = await repo.findBySessionId('sess-1');

      // Display order for one session's events — deliberately still timestamp.
      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1' },
        orderBy: { timestamp: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].payload).toEqual(SAMPLE_PAYLOAD);
    });

    it('returns an empty array when there are no logs', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([]);
      expect(await repo.findBySessionId('sess-x')).toEqual([]);
    });
  });

  describe('findByDecisionId', () => {
    it('queries by decision id ordered ascending', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([makeLogRow({ decisionId: 'dec-1' })]);

      const result = await repo.findByDecisionId('dec-1');

      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: { decisionId: 'dec-1' },
        orderBy: { timestamp: 'asc' },
      });
      expect(result[0].decisionId).toBe('dec-1');
    });
  });

  // -------------------------------------------------------------------------
  // verifyHashChain
  // -------------------------------------------------------------------------
  describe('verifyHashChain', () => {
    it('reports a valid chain when each link is consistent, walking in seq order', async () => {
      // build a real 2-link chain
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const log1 = makeLogRow({ id: 'l1', previousHash: '', timestamp: t1, seq: 1 });
      const t2 = new Date('2026-01-02T00:00:00.000Z');
      const log2 = makeLogRow({ id: 'l2', previousHash: log1.currentHash, timestamp: t2, seq: 2 });

      mockPrisma.complianceLog.findMany.mockResolvedValue([log1, log2]);

      const result = await repo.verifyHashChain();

      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: CHAIN_ORDER_ASC,
      });
      expect(result.isValid).toBe(true);
      expect(result.totalLogs).toBe(2);
      expect(result.verifiedLogs).toBe(2);
      expect(result.brokenLinks).toEqual([]);
      expect(result.firstLogTimestamp).toEqual(t1);
      expect(result.lastLogTimestamp).toEqual(t2);
    });

    it('verifies a chain whose two links share a timestamp — the case timestamp ordering broke', async () => {
      // Same millisecond, so `orderBy: timestamp` could return these in either
      // order and one link always looked broken. seq disambiguates.
      const t = new Date('2026-01-01T00:00:00.000Z');
      const log1 = makeLogRow({ id: 'l1', previousHash: '', timestamp: t, seq: 1 });
      const log2 = makeLogRow({
        id: 'l2',
        previousHash: log1.currentHash,
        timestamp: t,
        seq: 2,
        payload: { description: 'second', outputAction: 'stop' } as CompliancePayload,
      });

      mockPrisma.complianceLog.findMany.mockResolvedValue([log1, log2]);

      const result = await repo.verifyHashChain();
      expect(result.isValid).toBe(true);
      expect(result.brokenLinks).toEqual([]);
    });

    it('walks unnumbered legacy rows in timestamp order, not by their random uuid', async () => {
      // Rows written before the backfill have seq = null, so the tie-break IS
      // the whole order. `id` is @default(uuid()) — a random v4 — so an id-led
      // tie-break returns an intact legacy chain shuffled and reports nearly
      // every link broken: a false tamper report in the Art. 12 evidence chain.
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const t2 = new Date('2026-01-02T00:00:00.000Z');
      const t3 = new Date('2026-01-03T00:00:00.000Z');

      // Ids deliberately run opposite to the chain, as random uuids may.
      const l1 = makeLogRow({
        id: 'ffffffff-0000-4000-8000-000000000001',
        seq: null,
        previousHash: '',
        timestamp: t1,
      });
      const l2 = makeLogRow({
        id: '77777777-0000-4000-8000-000000000002',
        seq: null,
        previousHash: l1.currentHash,
        timestamp: t2,
        payload: { description: 'second', outputAction: 'stop' } as CompliancePayload,
      });
      const l3 = makeLogRow({
        id: '00000000-0000-4000-8000-000000000003',
        seq: null,
        previousHash: l2.currentHash,
        timestamp: t3,
        payload: { description: 'third', outputAction: 'wait' } as CompliancePayload,
      });

      // Stored order is arbitrary; the query's orderBy has to impose the chain.
      mockPrisma.complianceLog.findMany.mockImplementation(
        ({ orderBy }: { orderBy: OrderTerm[] }) =>
          Promise.resolve(applyOrderBy([l3, l1, l2], orderBy)),
      );

      const result = await repo.verifyHashChain();

      expect(result.brokenLinks).toEqual([]);
      expect(result.isValid).toBe(true);
      expect(result.totalLogs).toBe(3);
      expect(result.firstLogTimestamp).toEqual(t1);
      expect(result.lastLogTimestamp).toEqual(t3);
    });

    it('flags a broken previousHash link', async () => {
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const log1 = makeLogRow({ id: 'l1', previousHash: '', timestamp: t1, seq: 1 });
      const t2 = new Date('2026-01-02T00:00:00.000Z');
      // wrong previousHash but recompute currentHash so only the link breaks
      const log2 = makeLogRow({ id: 'l2', previousHash: 'WRONG', timestamp: t2, seq: 2 });

      mockPrisma.complianceLog.findMany.mockResolvedValue([log1, log2]);

      const result = await repo.verifyHashChain();

      expect(result.isValid).toBe(false);
      expect(result.brokenLinks).toHaveLength(1);
      expect(result.brokenLinks[0]).toMatchObject({
        logId: 'l2',
        expectedHash: log1.currentHash,
        actualPreviousHash: 'WRONG',
      });
      expect(result.verifiedLogs).toBe(1);
    });

    it('flags a tampered currentHash', async () => {
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const log1 = makeLogRow({ id: 'l1', previousHash: '', timestamp: t1, currentHash: 'TAMPERED' });

      mockPrisma.complianceLog.findMany.mockResolvedValue([log1]);

      const result = await repo.verifyHashChain();

      expect(result.isValid).toBe(false);
      expect(result.brokenLinks).toHaveLength(1);
      expect(result.brokenLinks[0].logId).toBe('l1');
      // the tampered currentHash is reported in actualPreviousHash field
      expect(result.brokenLinks[0].actualPreviousHash).toBe('TAMPERED');
    });

    it('applies a date-range where clause when bounds are given, and handles empty chains', async () => {
      mockPrisma.complianceLog.findMany.mockResolvedValue([]);
      const start = new Date('2026-01-01T00:00:00.000Z');
      const end = new Date('2026-02-01T00:00:00.000Z');

      const result = await repo.verifyHashChain(start, end);

      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: { timestamp: { gte: start, lte: end } },
        orderBy: CHAIN_ORDER_ASC,
      });
      expect(result.isValid).toBe(true);
      expect(result.totalLogs).toBe(0);
      expect(result.firstLogTimestamp).toBeUndefined();
      expect(result.lastLogTimestamp).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getEventTypeCounts
  // -------------------------------------------------------------------------
  describe('getEventTypeCounts', () => {
    it('groups by eventType and maps counts + last occurrence', async () => {
      const last = new Date('2026-01-05T00:00:00.000Z');
      mockPrisma.complianceLog.groupBy.mockResolvedValue([
        { eventType: 'ai_decision', _count: { eventType: 7 }, _max: { timestamp: last } },
      ]);

      const result = await repo.getEventTypeCounts();

      expect(mockPrisma.complianceLog.groupBy).toHaveBeenCalledWith({
        by: ['eventType'],
        where: {},
        _count: { eventType: true },
        _max: { timestamp: true },
      });
      expect(result).toEqual([
        { eventType: 'ai_decision', count: 7, lastOccurrence: last },
      ]);
    });

    it('passes a date-range where clause through to groupBy', async () => {
      mockPrisma.complianceLog.groupBy.mockResolvedValue([]);
      const start = new Date('2026-01-01T00:00:00.000Z');

      await repo.getEventTypeCounts(start);

      expect(mockPrisma.complianceLog.groupBy).toHaveBeenCalledWith({
        by: ['eventType'],
        where: { timestamp: { gte: start } },
        _count: { eventType: true },
        _max: { timestamp: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // getMetricsSummary
  // -------------------------------------------------------------------------
  describe('getMetricsSummary', () => {
    it('aggregates totals, severities, unique sessions/robots and date range', async () => {
      const minTs = new Date('2026-01-01T00:00:00.000Z');
      const maxTs = new Date('2026-01-31T00:00:00.000Z');

      mockPrisma.complianceLog.count.mockResolvedValue(42);
      // getEventTypeCounts uses groupBy(by eventType); severity uses groupBy(by severity).
      mockPrisma.complianceLog.groupBy
        .mockResolvedValueOnce([
          { eventType: 'ai_decision', _count: { eventType: 40 }, _max: { timestamp: maxTs } },
        ])
        .mockResolvedValueOnce([
          { severity: 'info', _count: { severity: 30 } },
          { severity: 'critical', _count: { severity: 12 } },
          { severity: 'bogus', _count: { severity: 99 } }, // unknown severity ignored
        ]);
      mockPrisma.complianceLog.findMany
        .mockResolvedValueOnce([{ sessionId: 'a' }, { sessionId: 'b' }])
        .mockResolvedValueOnce([{ robotId: 'r1' }]);
      mockPrisma.complianceLog.aggregate.mockResolvedValue({
        _min: { timestamp: minTs },
        _max: { timestamp: maxTs },
      });

      const result = await repo.getMetricsSummary();

      expect(result.totalLogs).toBe(42);
      expect(result.eventTypeCounts).toEqual([
        { eventType: 'ai_decision', count: 40, lastOccurrence: maxTs },
      ]);
      expect(result.severityCounts).toEqual({
        debug: 0,
        info: 30,
        warning: 0,
        error: 0,
        critical: 12,
      });
      expect(result.uniqueSessions).toBe(2);
      expect(result.uniqueRobots).toBe(1);
      expect(result.dateRange).toEqual({ start: minTs, end: maxTs });

      // distinct queries
      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        select: { sessionId: true },
        distinct: ['sessionId'],
      });
      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        select: { robotId: true },
        distinct: ['robotId'],
      });
      expect(mockPrisma.complianceLog.aggregate).toHaveBeenCalledWith({
        where: {},
        _min: { timestamp: true },
        _max: { timestamp: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // recordAccess
  // -------------------------------------------------------------------------
  describe('recordAccess', () => {
    it('persists the access record and maps it to a domain object', async () => {
      mockPrisma.complianceLogAccess.create.mockResolvedValue(makeAccessRow());

      const result = await repo.recordAccess({
        logId: 'log-1',
        userId: 'user-1',
        accessType: 'export',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      });

      expect(mockPrisma.complianceLogAccess.create).toHaveBeenCalledWith({
        data: {
          logId: 'log-1',
          userId: 'user-1',
          accessType: 'export',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
      });
      expect(result.id).toBe('access-1');
      expect(result.accessType).toBe('view'); // from mapped row
    });
  });

  // -------------------------------------------------------------------------
  // getAccessHistory
  // -------------------------------------------------------------------------
  describe('getAccessHistory', () => {
    it('returns access rows ordered by timestamp desc', async () => {
      mockPrisma.complianceLogAccess.findMany.mockResolvedValue([makeAccessRow()]);

      const result = await repo.getAccessHistory('log-1');

      expect(mockPrisma.complianceLogAccess.findMany).toHaveBeenCalledWith({
        where: { logId: 'log-1' },
        orderBy: { timestamp: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].logId).toBe('log-1');
    });

    it('returns an empty array when there is no access history', async () => {
      mockPrisma.complianceLogAccess.findMany.mockResolvedValue([]);
      expect(await repo.getAccessHistory('log-x')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // count
  // -------------------------------------------------------------------------
  describe('count', () => {
    it('counts with no filters', async () => {
      mockPrisma.complianceLog.count.mockResolvedValue(5);
      const result = await repo.count();
      expect(mockPrisma.complianceLog.count).toHaveBeenCalledWith({ where: {} });
      expect(result).toBe(5);
    });

    it('counts with sessionId/robotId/eventType filters', async () => {
      mockPrisma.complianceLog.count.mockResolvedValue(3);
      const result = await repo.count({
        sessionId: 'sess-1',
        robotId: 'robot-1',
        eventType: 'safety_action',
      });
      expect(mockPrisma.complianceLog.count).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1', robotId: 'robot-1', eventType: 'safety_action' },
      });
      expect(result).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // getLatestLog
  // -------------------------------------------------------------------------
  describe('getLatestLog', () => {
    it('returns the chain head in seq order, not the newest timestamp', async () => {
      mockPrisma.complianceLog.findFirst.mockResolvedValue(makeLogRow());

      const result = await repo.getLatestLog();

      expect(mockPrisma.complianceLog.findFirst).toHaveBeenCalledWith({
        orderBy: CHAIN_ORDER_DESC,
      });
      expect(result?.id).toBe('log-1');
      expect(result?.payload).toEqual(SAMPLE_PAYLOAD);
      expect(result?.seq).toBe(1);
    });

    it('returns null when there are no logs', async () => {
      mockPrisma.complianceLog.findFirst.mockResolvedValue(null);
      expect(await repo.getLatestLog()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // singleton sanity
  // -------------------------------------------------------------------------
  describe('exported singleton', () => {
    it('shares the mocked prisma client', async () => {
      mockPrisma.complianceLog.count.mockResolvedValue(1);
      expect(await complianceLogRepository.count()).toBe(1);
    });
  });
});

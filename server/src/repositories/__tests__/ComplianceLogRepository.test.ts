/**
 * @file ComplianceLogRepository.test.ts
 * @description Unit tests for ComplianceLogRepository — append-only compliance logging,
 *   hash-chain creation/verification, metrics aggregation, and access auditing. Mocks the
 *   Prisma client at the I/O boundary while running the real encryption/hash mappers.
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the singleton Prisma client (repo imports `prisma`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    complianceLog: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    complianceLogAccess: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as {
    complianceLog: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    complianceLogAccess: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  },
}));

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

describe('ComplianceLogRepository', () => {
  let repo: ComplianceLogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ComplianceLogRepository();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('builds the hash chain off the latest log and persists an immutable row', async () => {
      mockPrisma.complianceLog.findFirst.mockResolvedValue({ currentHash: 'prev-hash' });
      mockPrisma.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      const input = makeCreateInput({ severity: 'warning', operatorId: 'op-9' });
      const result = await repo.create(input);

      // previous hash lookup
      expect(mockPrisma.complianceLog.findFirst).toHaveBeenCalledWith({
        orderBy: { timestamp: 'desc' },
        select: { currentHash: true },
      });

      // create payload shape
      const createArg = mockPrisma.complianceLog.create.mock.calls[0][0];
      const data = createArg.data;
      expect(data.sessionId).toBe('sess-1');
      expect(data.robotId).toBe('robot-1');
      expect(data.operatorId).toBe('op-9');
      expect(data.eventType).toBe('ai_decision');
      expect(data.severity).toBe('warning');
      expect(data.previousHash).toBe('prev-hash');
      expect(data.immutable).toBe(true);

      // payloadHash is sha256 of the serialized payload
      expect(data.payloadHash).toBe(sha256(JSON.stringify(input.payload)));

      // currentHash matches the real chain hash computation
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
    });

    it('uses empty previousHash when there is no prior log, and defaults severity to info', async () => {
      mockPrisma.complianceLog.findFirst.mockResolvedValue(null);
      mockPrisma.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      await repo.create(makeCreateInput());

      const data = mockPrisma.complianceLog.create.mock.calls[0][0].data;
      expect(data.previousHash).toBe('');
      expect(data.severity).toBe('info');
    });

    it('falls back to 365-day retention for unknown event types', async () => {
      mockPrisma.complianceLog.findFirst.mockResolvedValue(null);
      mockPrisma.complianceLog.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeLogRow(data)),
      );

      await repo.create(makeCreateInput({ eventType: 'unknown_type' as ComplianceEventType }));

      const data = mockPrisma.complianceLog.create.mock.calls[0][0].data;
      const ts = data.timestamp as Date;
      const expected = new Date(ts);
      expected.setDate(expected.getDate() + 365);
      expect((data.retentionExpiresAt as Date).getTime()).toBe(expected.getTime());
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
    it('reports a valid chain when each link is consistent', async () => {
      // build a real 2-link chain
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const log1 = makeLogRow({ id: 'l1', previousHash: '', timestamp: t1 });
      const t2 = new Date('2026-01-02T00:00:00.000Z');
      const log2 = makeLogRow({ id: 'l2', previousHash: log1.currentHash, timestamp: t2 });

      mockPrisma.complianceLog.findMany.mockResolvedValue([log1, log2]);

      const result = await repo.verifyHashChain();

      expect(mockPrisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'asc' },
      });
      expect(result.isValid).toBe(true);
      expect(result.totalLogs).toBe(2);
      expect(result.verifiedLogs).toBe(2);
      expect(result.brokenLinks).toEqual([]);
      expect(result.firstLogTimestamp).toEqual(t1);
      expect(result.lastLogTimestamp).toEqual(t2);
    });

    it('flags a broken previousHash link', async () => {
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const log1 = makeLogRow({ id: 'l1', previousHash: '', timestamp: t1 });
      const t2 = new Date('2026-01-02T00:00:00.000Z');
      // wrong previousHash but recompute currentHash so only the link breaks
      const log2 = makeLogRow({ id: 'l2', previousHash: 'WRONG', timestamp: t2 });

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
        orderBy: { timestamp: 'asc' },
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
    it('returns the most recent decrypted log', async () => {
      mockPrisma.complianceLog.findFirst.mockResolvedValue(makeLogRow());

      const result = await repo.getLatestLog();

      expect(mockPrisma.complianceLog.findFirst).toHaveBeenCalledWith({
        orderBy: { timestamp: 'desc' },
      });
      expect(result?.id).toBe('log-1');
      expect(result?.payload).toEqual(SAMPLE_PAYLOAD);
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

/**
 * @file DataRestrictionService.test.ts
 * @description Unit tests for DataRestrictionService — GDPR Art. 18 processing restrictions
 *              (create/lift restrictions, lookups, restriction checks, stats).
 * @feature gdpr
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataRestriction } from '../../types/gdpr.types.js';

// ---------------------------------------------------------------------------
// Mock prisma (the only external boundary) before importing the service
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    dataRestriction: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import { DataRestrictionService } from '../DataRestrictionService.js';
import { prisma as _prisma } from '../../database/index.js';

const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type DbRestriction = {
  id: string;
  userId: string;
  scope: string;
  reason: string;
  gdprRequestId: string | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function makeDbRestriction(overrides: Partial<DbRestriction> = {}): DbRestriction {
  return {
    id: 'res1',
    userId: 'user1',
    scope: 'all',
    reason: 'accuracy_disputed',
    gdprRequestId: null,
    startDate: new Date('2024-01-01'),
    endDate: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

let service: DataRestrictionService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new DataRestrictionService();
});

// ===========================================================================
// createRestriction
// ===========================================================================

describe('createRestriction', () => {
  it('creates an active restriction and maps the result', async () => {
    const db = makeDbRestriction({ scope: 'ai_processing', reason: 'objection_pending' });
    prisma.dataRestriction.create.mockResolvedValue(db as never);

    const result: DataRestriction = await service.createRestriction({
      userId: 'user1',
      scope: 'ai_processing',
      reason: 'objection_pending',
      gdprRequestId: 'req1',
    });

    expect(prisma.dataRestriction.create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        scope: 'ai_processing',
        reason: 'objection_pending',
        gdprRequestId: 'req1',
        isActive: true,
      },
    });
    expect(result.id).toBe('res1');
    expect(result.scope).toBe('ai_processing');
    expect(result.reason).toBe('objection_pending');
    expect(result.isActive).toBe(true);
  });

  it('propagates errors from the database', async () => {
    prisma.dataRestriction.create.mockRejectedValue(new Error('db down') as never);

    await expect(
      service.createRestriction({ userId: 'u', scope: 'all', reason: 'accuracy_disputed' }),
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// liftRestriction
// ===========================================================================

describe('liftRestriction', () => {
  it('deactivates the restriction and sets an end date', async () => {
    const db = makeDbRestriction({ isActive: false, endDate: new Date('2024-02-01') });
    prisma.dataRestriction.update.mockResolvedValue(db as never);

    const result = await service.liftRestriction('res1', 'admin1');

    expect(prisma.dataRestriction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res1' },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    const updateArg = prisma.dataRestriction.update.mock.calls[0][0] as {
      data: { endDate: Date };
    };
    expect(updateArg.data.endDate).toBeInstanceOf(Date);
    expect(result.isActive).toBe(false);
  });

  it('works without an admin id', async () => {
    prisma.dataRestriction.update.mockResolvedValue(
      makeDbRestriction({ isActive: false }) as never,
    );

    const result = await service.liftRestriction('res1');
    expect(result.id).toBe('res1');
  });

  it('propagates errors when the restriction does not exist', async () => {
    prisma.dataRestriction.update.mockRejectedValue(new Error('not found') as never);
    await expect(service.liftRestriction('missing')).rejects.toThrow('not found');
  });
});

// ===========================================================================
// getUserRestrictions
// ===========================================================================

describe('getUserRestrictions', () => {
  it('queries only active restrictions by default', async () => {
    prisma.dataRestriction.findMany.mockResolvedValue([makeDbRestriction()] as never);

    const result = await service.getUserRestrictions('user1');

    expect(prisma.dataRestriction.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1', isActive: true },
      orderBy: { startDate: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user1');
  });

  it('includes inactive restrictions when activeOnly is false', async () => {
    prisma.dataRestriction.findMany.mockResolvedValue([] as never);

    await service.getUserRestrictions('user1', false);

    expect(prisma.dataRestriction.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { startDate: 'desc' },
    });
  });
});

// ===========================================================================
// isProcessingRestricted
// ===========================================================================

describe('isProcessingRestricted', () => {
  it('returns true when a matching active restriction exists', async () => {
    prisma.dataRestriction.findFirst.mockResolvedValue(makeDbRestriction() as never);

    const result = await service.isProcessingRestricted('user1', 'ai_processing');

    expect(result).toBe(true);
    expect(prisma.dataRestriction.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user1',
        isActive: true,
        OR: [{ scope: 'all' }, { scope: 'ai_processing' }],
      },
    });
  });

  it('returns false when no restriction matches', async () => {
    prisma.dataRestriction.findFirst.mockResolvedValue(null as never);

    const result = await service.isProcessingRestricted('user1', 'marketing');
    expect(result).toBe(false);
  });
});

// ===========================================================================
// getActiveRestrictions
// ===========================================================================

describe('getActiveRestrictions', () => {
  it('returns all active restrictions mapped', async () => {
    prisma.dataRestriction.findMany.mockResolvedValue([
      makeDbRestriction({ id: 'a' }),
      makeDbRestriction({ id: 'b' }),
    ] as never);

    const result = await service.getActiveRestrictions();

    expect(prisma.dataRestriction.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { startDate: 'desc' },
    });
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when there are none', async () => {
    prisma.dataRestriction.findMany.mockResolvedValue([] as never);
    expect(await service.getActiveRestrictions()).toEqual([]);
  });
});

// ===========================================================================
// getRestriction
// ===========================================================================

describe('getRestriction', () => {
  it('returns a mapped restriction when found', async () => {
    prisma.dataRestriction.findUnique.mockResolvedValue(makeDbRestriction() as never);

    const result = await service.getRestriction('res1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('res1');
    expect(prisma.dataRestriction.findUnique).toHaveBeenCalledWith({
      where: { id: 'res1' },
    });
  });

  it('returns null when not found', async () => {
    prisma.dataRestriction.findUnique.mockResolvedValue(null as never);
    expect(await service.getRestriction('missing')).toBeNull();
  });
});

// ===========================================================================
// liftAllRestrictions
// ===========================================================================

describe('liftAllRestrictions', () => {
  it('deactivates all active restrictions for a user and returns the count', async () => {
    prisma.dataRestriction.updateMany.mockResolvedValue({ count: 3 } as never);

    const count = await service.liftAllRestrictions('user1', 'objection resolved');

    expect(count).toBe(3);
    expect(prisma.dataRestriction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1', isActive: true },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });

  it('returns zero when there is nothing to lift', async () => {
    prisma.dataRestriction.updateMany.mockResolvedValue({ count: 0 } as never);
    expect(await service.liftAllRestrictions('user1')).toBe(0);
  });
});

// ===========================================================================
// getRestrictionsByRequest
// ===========================================================================

describe('getRestrictionsByRequest', () => {
  it('queries by gdprRequestId and maps results', async () => {
    prisma.dataRestriction.findMany.mockResolvedValue([
      makeDbRestriction({ gdprRequestId: 'req9' }),
    ] as never);

    const result = await service.getRestrictionsByRequest('req9');

    expect(prisma.dataRestriction.findMany).toHaveBeenCalledWith({
      where: { gdprRequestId: 'req9' },
      orderBy: { startDate: 'desc' },
    });
    expect(result[0].gdprRequestId).toBe('req9');
  });
});

// ===========================================================================
// getRestrictionStats
// ===========================================================================

describe('getRestrictionStats', () => {
  it('aggregates active count and groupings by scope and reason', async () => {
    prisma.dataRestriction.count.mockResolvedValue(5 as never);
    prisma.dataRestriction.groupBy.mockResolvedValueOnce([
      { scope: 'all', _count: 3 },
      { scope: 'marketing', _count: 2 },
    ] as never);
    prisma.dataRestriction.groupBy.mockResolvedValueOnce([
      { reason: 'accuracy_disputed', _count: 4 },
      { reason: 'objection_pending', _count: 1 },
    ] as never);

    const stats = await service.getRestrictionStats();

    expect(stats.activeRestrictions).toBe(5);
    expect(stats.restrictionsByScope).toEqual({ all: 3, marketing: 2 });
    expect(stats.restrictionsByReason).toEqual({
      accuracy_disputed: 4,
      objection_pending: 1,
    });
  });

  it('returns empty groupings when there are no restrictions', async () => {
    prisma.dataRestriction.count.mockResolvedValue(0 as never);
    prisma.dataRestriction.groupBy.mockResolvedValue([] as never);

    const stats = await service.getRestrictionStats();
    expect(stats.activeRestrictions).toBe(0);
    expect(stats.restrictionsByScope).toEqual({});
    expect(stats.restrictionsByReason).toEqual({});
  });
});

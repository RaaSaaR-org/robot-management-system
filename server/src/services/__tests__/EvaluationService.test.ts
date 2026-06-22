/**
 * @file EvaluationService.test.ts
 * @description Unit tests for EvaluationService — episode recording, success rate, pagination,
 *   error breakdown, and model comparison over a mocked prisma client.
 * @feature evaluation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for external boundaries — the service only touches the prisma client.
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    evaluationEpisode: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { evaluationService } from '../EvaluationService.js';
import { prisma as _prisma } from '../../database/index.js';

const prisma = vi.mocked(_prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// recordEpisode
// ===========================================================================

describe('recordEpisode', () => {
  it('creates an episode, coercing dates and serializing metadata', async () => {
    const created = { id: 'e1', robotId: 'r1' };
    prisma.evaluationEpisode.create.mockResolvedValue(created as never);

    const result = await evaluationService.recordEpisode({
      robotId: 'r1',
      modelVersion: 'v1',
      taskPrompt: 'pick cube',
      startedAt: '2024-01-01T00:00:00.000Z',
      endedAt: '2024-01-01T00:00:10.000Z',
      durationMs: 10000,
      success: true,
      metadata: { foo: 'bar' },
    });

    expect(result).toBe(created);
    const arg = prisma.evaluationEpisode.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
      include: unknown;
    };
    expect(arg.data.robotId).toBe('r1');
    expect(arg.data.startedAt).toBeInstanceOf(Date);
    expect(arg.data.endedAt).toBeInstanceOf(Date);
    expect(arg.data.metadata).toBe(JSON.stringify({ foo: 'bar' }));
    expect(arg.data.errorType).toBeNull();
    expect(arg.data.videoUrl).toBeNull();
    expect(arg.include).toEqual({ robot: true });
  });

  it('defaults metadata to "{}" when not provided', async () => {
    prisma.evaluationEpisode.create.mockResolvedValue({ id: 'e2' } as never);

    await evaluationService.recordEpisode({
      robotId: 'r1',
      modelVersion: 'v1',
      taskPrompt: 'task',
      startedAt: new Date(),
      endedAt: new Date(),
      durationMs: 100,
      success: false,
      errorType: 'collision',
    });

    const arg = prisma.evaluationEpisode.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.metadata).toBe('{}');
    expect(arg.data.errorType).toBe('collision');
  });

  it('propagates prisma errors', async () => {
    prisma.evaluationEpisode.create.mockRejectedValue(new Error('db down') as never);

    await expect(
      evaluationService.recordEpisode({
        robotId: 'r1',
        modelVersion: 'v1',
        taskPrompt: 't',
        startedAt: new Date(),
        endedAt: new Date(),
        durationMs: 1,
        success: true,
      })
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// getSuccessRate
// ===========================================================================

describe('getSuccessRate', () => {
  it('computes the success rate as a percentage', async () => {
    // first count() = total, second count() = successful
    prisma.evaluationEpisode.count
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(7 as never);

    const result = await evaluationService.getSuccessRate('r1', 'v1', '7d');

    expect(result).toEqual({
      successRate: 70,
      totalEpisodes: 10,
      successfulEpisodes: 7,
      period: '7d',
    });

    // total count uses the built where without forcing success
    const totalWhere = prisma.evaluationEpisode.count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(totalWhere.where.robotId).toBe('r1');
    expect(totalWhere.where.modelVersion).toBe('v1');
    expect(totalWhere.where.startedAt).toMatchObject({ gte: expect.any(Date) });

    const successWhere = prisma.evaluationEpisode.count.mock.calls[1][0] as {
      where: Record<string, unknown>;
    };
    expect(successWhere.where.success).toBe(true);
  });

  it('returns 0 success rate when there are no episodes', async () => {
    prisma.evaluationEpisode.count
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never);

    const result = await evaluationService.getSuccessRate();
    expect(result.successRate).toBe(0);
    expect(result.totalEpisodes).toBe(0);
    expect(result.period).toBe('24h'); // default
  });
});

// ===========================================================================
// getEpisodes
// ===========================================================================

describe('getEpisodes', () => {
  it('paginates with defaults and reports totalPages', async () => {
    const episodes = [{ id: 'a' }, { id: 'b' }];
    prisma.evaluationEpisode.findMany.mockResolvedValue(episodes as never);
    prisma.evaluationEpisode.count.mockResolvedValue(45 as never);

    const result = await evaluationService.getEpisodes({});

    expect(result.episodes).toBe(episodes);
    expect(result.total).toBe(45);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(3); // ceil(45/20)

    const findArg = prisma.evaluationEpisode.findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
      orderBy: unknown;
    };
    expect(findArg.skip).toBe(0);
    expect(findArg.take).toBe(20);
    expect(findArg.orderBy).toEqual({ startedAt: 'desc' });
  });

  it('honors explicit page/limit and applies filters to the where clause', async () => {
    prisma.evaluationEpisode.findMany.mockResolvedValue([] as never);
    prisma.evaluationEpisode.count.mockResolvedValue(0 as never);

    const result = await evaluationService.getEpisodes({
      page: 3,
      limit: 5,
      robotId: 'rX',
      success: false,
    });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(5);
    expect(result.totalPages).toBe(0);

    const findArg = prisma.evaluationEpisode.findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
      where: Record<string, unknown>;
    };
    expect(findArg.skip).toBe(10); // (3-1)*5
    expect(findArg.take).toBe(5);
    expect(findArg.where.robotId).toBe('rX');
    expect(findArg.where.success).toBe(false);
  });
});

// ===========================================================================
// getEpisodeById
// ===========================================================================

describe('getEpisodeById', () => {
  it('returns the found episode', async () => {
    const ep = { id: 'e1' };
    prisma.evaluationEpisode.findUnique.mockResolvedValue(ep as never);

    const result = await evaluationService.getEpisodeById('e1');
    expect(result).toBe(ep);
    expect(prisma.evaluationEpisode.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e1' } })
    );
  });

  it('returns null when not found', async () => {
    prisma.evaluationEpisode.findUnique.mockResolvedValue(null as never);
    const result = await evaluationService.getEpisodeById('nope');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// getErrorBreakdown
// ===========================================================================

describe('getErrorBreakdown', () => {
  it('aggregates error types sorted by count desc with percentages', async () => {
    prisma.evaluationEpisode.findMany.mockResolvedValue([
      { errorType: 'collision' },
      { errorType: 'collision' },
      { errorType: 'timeout' },
      { errorType: null }, // -> 'unknown'
    ] as never);

    const result = await evaluationService.getErrorBreakdown('r1', 'v1', '30d');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ errorType: 'collision', count: 2, percentage: 50 });
    expect(result.find((r) => r.errorType === 'timeout')).toEqual({
      errorType: 'timeout',
      count: 1,
      percentage: 25,
    });
    expect(result.find((r) => r.errorType === 'unknown')).toMatchObject({ count: 1 });

    // queries only failed episodes
    const findArg = prisma.evaluationEpisode.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findArg.where.success).toBe(false);
  });

  it('returns an empty array when there are no failures', async () => {
    prisma.evaluationEpisode.findMany.mockResolvedValue([] as never);
    const result = await evaluationService.getErrorBreakdown();
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// compareModels
// ===========================================================================

describe('compareModels', () => {
  it('returns aggregated stats for both versions', async () => {
    // getModelStats calls findMany once per version; two parallel calls.
    prisma.evaluationEpisode.findMany
      .mockResolvedValueOnce([
        { success: true, durationMs: 100, errorType: null },
        { success: false, durationMs: 300, errorType: 'collision' },
      ] as never)
      .mockResolvedValueOnce([
        { success: true, durationMs: 200, errorType: null },
      ] as never);

    const result = await evaluationService.compareModels('vA', 'vB', '7d');

    expect(result.versionA.modelVersion).toBe('vA');
    expect(result.versionA.totalEpisodes).toBe(2);
    expect(result.versionA.successRate).toBe(50);
    expect(result.versionA.avgDurationMs).toBe(200); // round((100+300)/2)
    expect(result.versionA.errorBreakdown).toEqual([
      { errorType: 'collision', count: 1, percentage: 100 },
    ]);

    expect(result.versionB.modelVersion).toBe('vB');
    expect(result.versionB.totalEpisodes).toBe(1);
    expect(result.versionB.successRate).toBe(100);
    expect(result.versionB.avgDurationMs).toBe(200);
    expect(result.versionB.errorBreakdown).toEqual([]);
  });

  it('returns zeroed stats for versions with no episodes', async () => {
    prisma.evaluationEpisode.findMany.mockResolvedValue([] as never);

    const result = await evaluationService.compareModels('vA', 'vB');
    expect(result.versionA.totalEpisodes).toBe(0);
    expect(result.versionA.successRate).toBe(0);
    expect(result.versionA.avgDurationMs).toBe(0);
    expect(result.versionA.errorBreakdown).toEqual([]);
    expect(result.versionB.totalEpisodes).toBe(0);
  });
});

// ===========================================================================
// getInstance — singleton
// ===========================================================================

describe('getInstance', () => {
  it('returns the same singleton as the exported instance', async () => {
    const { EvaluationService } = await import('../EvaluationService.js');
    expect(EvaluationService.getInstance()).toBe(evaluationService);
  });
});

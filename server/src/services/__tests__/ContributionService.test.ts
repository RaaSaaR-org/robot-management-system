/**
 * @file ContributionService.test.ts
 * @description Unit tests for ContributionService — submit/approve mutations and
 *   query/aggregation operations (credits, leaderboard, impact stats). The prisma
 *   client is the only I/O boundary and is fully mocked; credit math runs for real.
 * @feature Data Contribution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the prisma client (the sole I/O boundary)
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  dataContribution: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  contributionCredit: {
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

import {
  ContributionService,
  contributionService,
  type ContributionRecord,
} from '../ContributionService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ContributionRecord> = {}): ContributionRecord {
  return {
    id: 'c1',
    userId: 'u1',
    robotId: 'r1',
    episodeCount: 100,
    frameCount: 5000,
    sizeBytes: BigInt(1024),
    status: 'pending',
    creditAwarded: 0,
    impactScore: 0,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// submitContribution
// ===========================================================================

describe('submitContribution', () => {
  it('creates a pending contribution with mapped fields and returns it', async () => {
    const created = makeRecord({ id: 'new' });
    prismaMock.dataContribution.create.mockResolvedValue(created);

    const result = await contributionService.submitContribution({
      userId: 'u1',
      robotId: 'r1',
      episodeCount: 100,
      frameCount: 5000,
      sizeBytes: BigInt(1024),
      metadata: '{"k":1}',
    });

    expect(result).toBe(created);
    expect(prismaMock.dataContribution.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        robotId: 'r1',
        episodeCount: 100,
        frameCount: 5000,
        sizeBytes: BigInt(1024),
        metadata: '{"k":1}',
        status: 'pending',
      },
    });
  });

  it('defaults metadata to null when omitted', async () => {
    prismaMock.dataContribution.create.mockResolvedValue(makeRecord());

    await contributionService.submitContribution({
      userId: 'u1',
      robotId: 'r1',
      episodeCount: 1,
      frameCount: 1,
      sizeBytes: BigInt(0),
    });

    expect(prismaMock.dataContribution.create.mock.calls[0][0].data.metadata).toBeNull();
  });

  it('propagates DB errors', async () => {
    prismaMock.dataContribution.create.mockRejectedValue(new Error('db down'));
    await expect(
      contributionService.submitContribution({
        userId: 'u1',
        robotId: 'r1',
        episodeCount: 1,
        frameCount: 1,
        sizeBytes: BigInt(0),
      })
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// approveContribution
// ===========================================================================

describe('approveContribution', () => {
  it('approves a pending contribution and awards 1 credit per 10 episodes', async () => {
    prismaMock.dataContribution.findUnique.mockResolvedValue(
      makeRecord({ episodeCount: 100, status: 'pending' })
    );
    const updated = makeRecord({ status: 'approved', creditAwarded: 10 });
    // create() returns marker tokens; service destructures index 0 of the result array
    prismaMock.dataContribution.update.mockReturnValue('update-token');
    prismaMock.contributionCredit.create.mockReturnValue('credit-token');
    prismaMock.$transaction.mockResolvedValue([updated, {}]);

    const result = await contributionService.approveContribution('c1');

    expect(result).toBe(updated);
    // credits = floor(100/10) = 10
    expect(prismaMock.dataContribution.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'approved', creditAwarded: 10 },
    });
    expect(prismaMock.contributionCredit.create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: 10, reason: 'Approved contribution c1' },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(['update-token', 'credit-token']);
  });

  it('awards a minimum of 1 credit for small contributions (<10 episodes)', async () => {
    prismaMock.dataContribution.findUnique.mockResolvedValue(
      makeRecord({ episodeCount: 3, status: 'pending' })
    );
    prismaMock.dataContribution.update.mockReturnValue('u');
    prismaMock.contributionCredit.create.mockReturnValue('c');
    prismaMock.$transaction.mockResolvedValue([makeRecord({ status: 'approved' }), {}]);

    await contributionService.approveContribution('c1');

    expect(prismaMock.dataContribution.update.mock.calls[0][0].data.creditAwarded).toBe(1);
    expect(prismaMock.contributionCredit.create.mock.calls[0][0].data.amount).toBe(1);
  });

  it('allows approving a contribution in processing status', async () => {
    prismaMock.dataContribution.findUnique.mockResolvedValue(
      makeRecord({ episodeCount: 50, status: 'processing' })
    );
    prismaMock.dataContribution.update.mockReturnValue('u');
    prismaMock.contributionCredit.create.mockReturnValue('c');
    prismaMock.$transaction.mockResolvedValue([makeRecord({ status: 'approved' }), {}]);

    await expect(contributionService.approveContribution('c1')).resolves.toBeDefined();
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('throws when the contribution does not exist', async () => {
    prismaMock.dataContribution.findUnique.mockResolvedValue(null);
    await expect(contributionService.approveContribution('missing')).rejects.toThrow(
      'Contribution not found'
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('throws when the contribution is already approved', async () => {
    prismaMock.dataContribution.findUnique.mockResolvedValue(
      makeRecord({ status: 'approved' })
    );
    await expect(contributionService.approveContribution('c1')).rejects.toThrow(
      'Cannot approve contribution in status: approved'
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getContribution
// ===========================================================================

describe('getContribution', () => {
  it('returns the contribution by id', async () => {
    const rec = makeRecord();
    prismaMock.dataContribution.findUnique.mockResolvedValue(rec);
    await expect(contributionService.getContribution('c1')).resolves.toBe(rec);
    expect(prismaMock.dataContribution.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
  });

  it('returns null when not found', async () => {
    prismaMock.dataContribution.findUnique.mockResolvedValue(null);
    await expect(contributionService.getContribution('x')).resolves.toBeNull();
  });
});

// ===========================================================================
// getContributions
// ===========================================================================

describe('getContributions', () => {
  it('applies userId and status filters with default pagination', async () => {
    const recs = [makeRecord({ id: 'a' }), makeRecord({ id: 'b' })];
    prismaMock.dataContribution.findMany.mockResolvedValue(recs);
    prismaMock.dataContribution.count.mockResolvedValue(2);

    const result = await contributionService.getContributions({
      userId: 'u1',
      status: 'pending',
    });

    expect(result).toEqual({ contributions: recs, total: 2 });
    expect(prismaMock.dataContribution.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
    expect(prismaMock.dataContribution.count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'pending' },
    });
  });

  it('uses an empty filter and custom limit/offset when no filters given', async () => {
    prismaMock.dataContribution.findMany.mockResolvedValue([]);
    prismaMock.dataContribution.count.mockResolvedValue(0);

    const result = await contributionService.getContributions({ limit: 5, offset: 10 });

    expect(result).toEqual({ contributions: [], total: 0 });
    expect(prismaMock.dataContribution.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 5,
      skip: 10,
    });
  });

  it('works with no options argument', async () => {
    prismaMock.dataContribution.findMany.mockResolvedValue([]);
    prismaMock.dataContribution.count.mockResolvedValue(0);
    await expect(contributionService.getContributions()).resolves.toEqual({
      contributions: [],
      total: 0,
    });
    expect(prismaMock.dataContribution.findMany.mock.calls[0][0].take).toBe(50);
  });
});

// ===========================================================================
// getUserCredits
// ===========================================================================

describe('getUserCredits', () => {
  it('returns the summed credit amount', async () => {
    prismaMock.contributionCredit.aggregate.mockResolvedValue({ _sum: { amount: 42 } });
    await expect(contributionService.getUserCredits('u1')).resolves.toBe(42);
    expect(prismaMock.contributionCredit.aggregate).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      _sum: { amount: true },
    });
  });

  it('returns 0 when the user has no credits', async () => {
    prismaMock.contributionCredit.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await expect(contributionService.getUserCredits('u1')).resolves.toBe(0);
  });
});

// ===========================================================================
// getLeaderboard
// ===========================================================================

describe('getLeaderboard', () => {
  it('joins credit groups with approved-episode totals per user', async () => {
    prismaMock.contributionCredit.groupBy.mockResolvedValue([
      { userId: 'u1', _sum: { amount: 30 } },
      { userId: 'u2', _sum: { amount: 10 } },
    ]);
    prismaMock.dataContribution.aggregate.mockImplementation(async (args: { where: { userId: string } }) => {
      if (args.where.userId === 'u1') return { _sum: { episodeCount: 300 } };
      return { _sum: { episodeCount: 100 } };
    });

    const result = await contributionService.getLeaderboard(5);

    expect(result).toEqual([
      { userId: 'u1', totalCredits: 30, totalEpisodes: 300 },
      { userId: 'u2', totalCredits: 10, totalEpisodes: 100 },
    ]);
    expect(prismaMock.contributionCredit.groupBy).toHaveBeenCalledWith({
      by: ['userId'],
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });
    // only approved contributions count toward episodes
    expect(prismaMock.dataContribution.aggregate).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'approved' },
      _sum: { episodeCount: true },
    });
  });

  it('defaults limit to 10 and coerces null sums to 0', async () => {
    prismaMock.contributionCredit.groupBy.mockResolvedValue([
      { userId: 'u1', _sum: { amount: null } },
    ]);
    prismaMock.dataContribution.aggregate.mockResolvedValue({ _sum: { episodeCount: null } });

    const result = await contributionService.getLeaderboard();

    expect(result).toEqual([{ userId: 'u1', totalCredits: 0, totalEpisodes: 0 }]);
    expect(prismaMock.contributionCredit.groupBy.mock.calls[0][0].take).toBe(10);
  });

  it('returns an empty array when there are no contributors', async () => {
    prismaMock.contributionCredit.groupBy.mockResolvedValue([]);
    await expect(contributionService.getLeaderboard()).resolves.toEqual([]);
    expect(prismaMock.dataContribution.aggregate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getImpactStats
// ===========================================================================

describe('getImpactStats', () => {
  it('aggregates episodes/frames/size, credits and contribution count', async () => {
    prismaMock.dataContribution.aggregate.mockResolvedValue({
      _sum: { episodeCount: 200, frameCount: 9000, sizeBytes: BigInt(2048) },
    });
    prismaMock.contributionCredit.aggregate.mockResolvedValue({ _sum: { amount: 20 } });
    prismaMock.dataContribution.count.mockResolvedValue(3);

    const result = await contributionService.getImpactStats('u1');

    expect(result).toEqual({
      totalEpisodes: 200,
      totalFrames: 9000,
      totalSizeBytes: BigInt(2048),
      totalCredits: 20,
      contributionCount: 3,
    });
  });

  it('falls back to zero/BigInt(0) when aggregates are null', async () => {
    prismaMock.dataContribution.aggregate.mockResolvedValue({
      _sum: { episodeCount: null, frameCount: null, sizeBytes: null },
    });
    prismaMock.contributionCredit.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaMock.dataContribution.count.mockResolvedValue(0);

    const result = await contributionService.getImpactStats('u1');

    expect(result.totalEpisodes).toBe(0);
    expect(result.totalFrames).toBe(0);
    expect(result.totalSizeBytes).toBe(BigInt(0));
    expect(result.totalCredits).toBe(0);
    expect(result.contributionCount).toBe(0);
  });
});

// ===========================================================================
// class export sanity
// ===========================================================================

describe('ContributionService class', () => {
  it('is constructable and the singleton is an instance of it', () => {
    expect(contributionService).toBeInstanceOf(ContributionService);
    expect(new ContributionService()).toBeInstanceOf(ContributionService);
  });
});

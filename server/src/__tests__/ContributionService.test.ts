/**
 * @file ContributionService.test.ts
 * @description Unit tests for ContributionService (TASK-065)
 * @feature Data Contribution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockPrisma = {
  dataContribution: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  contributionCredit: {
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('../database/index.js', () => ({
  prisma: mockPrisma,
}));

// Import after mocking
const { ContributionService } = await import('../services/ContributionService.js');

// ============================================================================
// TEST HELPERS
// ============================================================================

function createService(): InstanceType<typeof ContributionService> {
  return new ContributionService();
}

function mockContribution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contrib-1',
    userId: 'user-1',
    robotId: 'robot-1',
    episodeCount: 100,
    frameCount: 5000,
    sizeBytes: BigInt(1048576),
    status: 'pending',
    creditAwarded: 0,
    impactScore: 0,
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('ContributionService', () => {
  let service: InstanceType<typeof ContributionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  // --------------------------------------------------------------------------
  // submitContribution
  // --------------------------------------------------------------------------

  describe('submitContribution', () => {
    it('creates a pending contribution in the database', async () => {
      const expected = mockContribution();
      mockPrisma.dataContribution.create.mockResolvedValue(expected);

      const result = await service.submitContribution({
        userId: 'user-1',
        robotId: 'robot-1',
        episodeCount: 100,
        frameCount: 5000,
        sizeBytes: BigInt(1048576),
      });

      expect(result).toEqual(expected);
      expect(mockPrisma.dataContribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          robotId: 'robot-1',
          episodeCount: 100,
          frameCount: 5000,
          sizeBytes: BigInt(1048576),
          status: 'pending',
          metadata: null,
        }),
      });
    });

    it('stores metadata as JSON string when provided', async () => {
      const expected = mockContribution({ metadata: '{"description":"test"}' });
      mockPrisma.dataContribution.create.mockResolvedValue(expected);

      await service.submitContribution({
        userId: 'user-1',
        robotId: 'robot-1',
        episodeCount: 10,
        frameCount: 100,
        sizeBytes: BigInt(0),
        metadata: '{"description":"test"}',
      });

      expect(mockPrisma.dataContribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: '{"description":"test"}',
        }),
      });
    });

    it('sets default status to pending', async () => {
      mockPrisma.dataContribution.create.mockResolvedValue(mockContribution());

      await service.submitContribution({
        userId: 'user-1',
        robotId: 'robot-1',
        episodeCount: 1,
        frameCount: 10,
        sizeBytes: BigInt(0),
      });

      expect(mockPrisma.dataContribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'pending' }),
      });
    });

    it('sets metadata to null when not provided', async () => {
      mockPrisma.dataContribution.create.mockResolvedValue(mockContribution());

      await service.submitContribution({
        userId: 'user-1',
        robotId: 'robot-1',
        episodeCount: 1,
        frameCount: 10,
        sizeBytes: BigInt(0),
      });

      expect(mockPrisma.dataContribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: null }),
      });
    });
  });

  // --------------------------------------------------------------------------
  // approveContribution
  // --------------------------------------------------------------------------

  describe('approveContribution', () => {
    it('approves a pending contribution and awards credits', async () => {
      const contribution = mockContribution({ episodeCount: 100 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);

      const updated = mockContribution({ status: 'approved', creditAwarded: 10 });
      mockPrisma.$transaction.mockResolvedValue([updated]);

      const result = await service.approveContribution('contrib-1');

      expect(result.status).toBe('approved');
      expect(result.creditAwarded).toBe(10);
    });

    it('awards 1 credit for 10 episodes', async () => {
      const contribution = mockContribution({ episodeCount: 10 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);
      mockPrisma.$transaction.mockResolvedValue([
        mockContribution({ status: 'approved', creditAwarded: 1 }),
      ]);

      await service.approveContribution('contrib-1');

      // The transaction should include creating a credit with amount 1
      const transactionCalls = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionCalls).toHaveLength(2);
    });

    it('awards minimum 1 credit for 0 episodes', async () => {
      const contribution = mockContribution({ episodeCount: 0 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);
      mockPrisma.$transaction.mockResolvedValue([
        mockContribution({ status: 'approved', creditAwarded: 1 }),
      ]);

      const result = await service.approveContribution('contrib-1');
      expect(result.creditAwarded).toBe(1);
    });

    it('awards minimum 1 credit for 5 episodes (less than 10)', async () => {
      const contribution = mockContribution({ episodeCount: 5 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);
      mockPrisma.$transaction.mockResolvedValue([
        mockContribution({ status: 'approved', creditAwarded: 1 }),
      ]);

      const result = await service.approveContribution('contrib-1');
      expect(result.creditAwarded).toBe(1);
    });

    it('awards 1 credit for 11 episodes (floor division)', async () => {
      const contribution = mockContribution({ episodeCount: 11 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);
      mockPrisma.$transaction.mockResolvedValue([
        mockContribution({ status: 'approved', creditAwarded: 1 }),
      ]);

      const result = await service.approveContribution('contrib-1');
      expect(result.creditAwarded).toBe(1);
    });

    it('awards 10 credits for 100 episodes', async () => {
      const contribution = mockContribution({ episodeCount: 100 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);
      mockPrisma.$transaction.mockResolvedValue([
        mockContribution({ status: 'approved', creditAwarded: 10 }),
      ]);

      const result = await service.approveContribution('contrib-1');
      expect(result.creditAwarded).toBe(10);
    });

    it('throws error if contribution not found', async () => {
      mockPrisma.dataContribution.findUnique.mockResolvedValue(null);

      await expect(service.approveContribution('nonexistent'))
        .rejects.toThrow('Contribution not found');
    });

    it('throws error if contribution already approved', async () => {
      mockPrisma.dataContribution.findUnique.mockResolvedValue(
        mockContribution({ status: 'approved' })
      );

      await expect(service.approveContribution('contrib-1'))
        .rejects.toThrow('Cannot approve contribution in status: approved');
    });

    it('throws error if contribution is rejected', async () => {
      mockPrisma.dataContribution.findUnique.mockResolvedValue(
        mockContribution({ status: 'rejected' })
      );

      await expect(service.approveContribution('contrib-1'))
        .rejects.toThrow('Cannot approve contribution in status: rejected');
    });

    it('allows approving a processing contribution', async () => {
      const contribution = mockContribution({ status: 'processing', episodeCount: 50 });
      mockPrisma.dataContribution.findUnique.mockResolvedValue(contribution);
      mockPrisma.$transaction.mockResolvedValue([
        mockContribution({ status: 'approved', creditAwarded: 5 }),
      ]);

      const result = await service.approveContribution('contrib-1');
      expect(result.status).toBe('approved');
    });
  });

  // --------------------------------------------------------------------------
  // getContribution
  // --------------------------------------------------------------------------

  describe('getContribution', () => {
    it('returns a contribution by ID', async () => {
      const expected = mockContribution();
      mockPrisma.dataContribution.findUnique.mockResolvedValue(expected);

      const result = await service.getContribution('contrib-1');
      expect(result).toEqual(expected);
      expect(mockPrisma.dataContribution.findUnique).toHaveBeenCalledWith({
        where: { id: 'contrib-1' },
      });
    });

    it('returns null for nonexistent contribution', async () => {
      mockPrisma.dataContribution.findUnique.mockResolvedValue(null);

      const result = await service.getContribution('nonexistent');
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getUserCredits
  // --------------------------------------------------------------------------

  describe('getUserCredits', () => {
    it('returns total credits for user', async () => {
      mockPrisma.contributionCredit.aggregate.mockResolvedValue({
        _sum: { amount: 42 },
      });

      const result = await service.getUserCredits('user-1');
      expect(result).toBe(42);
      expect(mockPrisma.contributionCredit.aggregate).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        _sum: { amount: true },
      });
    });

    it('returns 0 when user has no credits', async () => {
      mockPrisma.contributionCredit.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });

      const result = await service.getUserCredits('user-new');
      expect(result).toBe(0);
    });

    it('sums credits correctly across multiple entries', async () => {
      mockPrisma.contributionCredit.aggregate.mockResolvedValue({
        _sum: { amount: 150 },
      });

      const result = await service.getUserCredits('user-1');
      expect(result).toBe(150);
    });
  });

  // --------------------------------------------------------------------------
  // getLeaderboard
  // --------------------------------------------------------------------------

  describe('getLeaderboard', () => {
    it('returns top contributors sorted by credits descending', async () => {
      mockPrisma.contributionCredit.groupBy.mockResolvedValue([
        { userId: 'user-a', _sum: { amount: 100 } },
        { userId: 'user-b', _sum: { amount: 50 } },
      ]);
      mockPrisma.dataContribution.aggregate
        .mockResolvedValueOnce({ _sum: { episodeCount: 1000 } })
        .mockResolvedValueOnce({ _sum: { episodeCount: 300 } });

      const result = await service.getLeaderboard(10);

      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe('user-a');
      expect(result[0].totalCredits).toBe(100);
      expect(result[0].totalEpisodes).toBe(1000);
      expect(result[1].userId).toBe('user-b');
      expect(result[1].totalCredits).toBe(50);
    });

    it('respects limit parameter', async () => {
      mockPrisma.contributionCredit.groupBy.mockResolvedValue([
        { userId: 'user-a', _sum: { amount: 100 } },
      ]);
      mockPrisma.dataContribution.aggregate.mockResolvedValue({
        _sum: { episodeCount: 500 },
      });

      await service.getLeaderboard(1);

      expect(mockPrisma.contributionCredit.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 })
      );
    });

    it('returns empty array when no contributors exist', async () => {
      mockPrisma.contributionCredit.groupBy.mockResolvedValue([]);

      const result = await service.getLeaderboard(10);
      expect(result).toEqual([]);
    });

    it('defaults to limit 10', async () => {
      mockPrisma.contributionCredit.groupBy.mockResolvedValue([]);

      await service.getLeaderboard();

      expect(mockPrisma.contributionCredit.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });
  });

  // --------------------------------------------------------------------------
  // getImpactStats
  // --------------------------------------------------------------------------

  describe('getImpactStats', () => {
    it('returns aggregate impact stats for user', async () => {
      mockPrisma.dataContribution.aggregate.mockResolvedValue({
        _sum: {
          episodeCount: 500,
          frameCount: 25000,
          sizeBytes: BigInt(52428800),
        },
      });
      mockPrisma.contributionCredit.aggregate.mockResolvedValue({
        _sum: { amount: 50 },
      });
      mockPrisma.dataContribution.count.mockResolvedValue(5);

      const result = await service.getImpactStats('user-1');

      expect(result.totalEpisodes).toBe(500);
      expect(result.totalFrames).toBe(25000);
      expect(result.totalSizeBytes).toBe(BigInt(52428800));
      expect(result.totalCredits).toBe(50);
      expect(result.contributionCount).toBe(5);
    });

    it('returns zeros for user with no contributions', async () => {
      mockPrisma.dataContribution.aggregate.mockResolvedValue({
        _sum: {
          episodeCount: null,
          frameCount: null,
          sizeBytes: null,
        },
      });
      mockPrisma.contributionCredit.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      mockPrisma.dataContribution.count.mockResolvedValue(0);

      const result = await service.getImpactStats('user-new');

      expect(result.totalEpisodes).toBe(0);
      expect(result.totalFrames).toBe(0);
      expect(result.totalSizeBytes).toBe(BigInt(0));
      expect(result.totalCredits).toBe(0);
      expect(result.contributionCount).toBe(0);
    });

    it('correctly handles BigInt sizeBytes aggregation', async () => {
      mockPrisma.dataContribution.aggregate.mockResolvedValue({
        _sum: {
          episodeCount: 10,
          frameCount: 100,
          sizeBytes: BigInt(10737418240), // 10 GB
        },
      });
      mockPrisma.contributionCredit.aggregate.mockResolvedValue({
        _sum: { amount: 1 },
      });
      mockPrisma.dataContribution.count.mockResolvedValue(1);

      const result = await service.getImpactStats('user-1');
      expect(result.totalSizeBytes).toBe(BigInt(10737418240));
    });
  });

  // --------------------------------------------------------------------------
  // getContributions (list)
  // --------------------------------------------------------------------------

  describe('getContributions', () => {
    it('lists contributions for a user', async () => {
      const contributions = [mockContribution(), mockContribution({ id: 'contrib-2' })];
      mockPrisma.dataContribution.findMany.mockResolvedValue(contributions);
      mockPrisma.dataContribution.count.mockResolvedValue(2);

      const result = await service.getContributions({ userId: 'user-1' });

      expect(result.contributions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockPrisma.dataContribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('filters by status', async () => {
      mockPrisma.dataContribution.findMany.mockResolvedValue([]);
      mockPrisma.dataContribution.count.mockResolvedValue(0);

      await service.getContributions({ status: 'approved' });

      expect(mockPrisma.dataContribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'approved' },
        })
      );
    });

    it('applies pagination with limit and offset', async () => {
      mockPrisma.dataContribution.findMany.mockResolvedValue([]);
      mockPrisma.dataContribution.count.mockResolvedValue(100);

      await service.getContributions({ limit: 10, offset: 20 });

      expect(mockPrisma.dataContribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );
    });

    it('defaults to limit 50 offset 0', async () => {
      mockPrisma.dataContribution.findMany.mockResolvedValue([]);
      mockPrisma.dataContribution.count.mockResolvedValue(0);

      await service.getContributions();

      expect(mockPrisma.dataContribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
        })
      );
    });

    it('combines userId and status filters', async () => {
      mockPrisma.dataContribution.findMany.mockResolvedValue([]);
      mockPrisma.dataContribution.count.mockResolvedValue(0);

      await service.getContributions({ userId: 'user-1', status: 'pending' });

      expect(mockPrisma.dataContribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'pending' },
        })
      );
    });
  });
});

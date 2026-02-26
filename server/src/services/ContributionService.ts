/**
 * @file ContributionService.ts
 * @description Prisma-backed service for customer data contributions
 * @feature Data Contribution
 */

import { prisma } from '../database/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ContributionInput {
  userId: string;
  robotId: string;
  episodeCount: number;
  frameCount: number;
  sizeBytes: bigint;
  metadata?: string;
}

export interface ContributionRecord {
  id: string;
  userId: string;
  robotId: string;
  episodeCount: number;
  frameCount: number;
  sizeBytes: bigint;
  status: string;
  creditAwarded: number;
  impactScore: number;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeaderboardEntry {
  userId: string;
  totalCredits: number;
  totalEpisodes: number;
}

export interface ImpactStats {
  totalEpisodes: number;
  totalFrames: number;
  totalSizeBytes: bigint;
  totalCredits: number;
  contributionCount: number;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * ContributionService — Prisma-backed data contribution management
 */
export class ContributionService {
  // ============================================================================
  // MUTATION OPERATIONS
  // ============================================================================

  /**
   * Submit a new data contribution
   */
  async submitContribution(input: ContributionInput): Promise<ContributionRecord> {
    const contribution = await prisma.dataContribution.create({
      data: {
        userId: input.userId,
        robotId: input.robotId,
        episodeCount: input.episodeCount,
        frameCount: input.frameCount,
        sizeBytes: input.sizeBytes,
        metadata: input.metadata ?? null,
        status: 'pending',
      },
    });

    console.log(
      `[ContributionService] Contribution submitted: ${contribution.id} by user ${input.userId}`
    );

    return contribution;
  }

  /**
   * Approve a contribution and award credits
   * Credits: 1 credit per 10 episodes, minimum 1
   */
  async approveContribution(id: string): Promise<ContributionRecord> {
    const contribution = await prisma.dataContribution.findUnique({
      where: { id },
    });

    if (!contribution) {
      throw new Error('Contribution not found');
    }

    if (contribution.status !== 'pending' && contribution.status !== 'processing') {
      throw new Error(`Cannot approve contribution in status: ${contribution.status}`);
    }

    // Calculate credits: 1 per 10 episodes, minimum 1
    const credits = Math.max(1, Math.floor(contribution.episodeCount / 10));

    // Update contribution and create credit record in a transaction
    const [updated] = await prisma.$transaction([
      prisma.dataContribution.update({
        where: { id },
        data: {
          status: 'approved',
          creditAwarded: credits,
        },
      }),
      prisma.contributionCredit.create({
        data: {
          userId: contribution.userId,
          amount: credits,
          reason: `Approved contribution ${id}`,
        },
      }),
    ]);

    console.log(
      `[ContributionService] Contribution ${id} approved, ${credits} credits awarded`
    );

    return updated;
  }

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  /**
   * Get a single contribution by ID
   */
  async getContribution(id: string): Promise<ContributionRecord | null> {
    return prisma.dataContribution.findUnique({
      where: { id },
    });
  }

  /**
   * List contributions with optional filters
   */
  async getContributions(options?: {
    userId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ contributions: ContributionRecord[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (options?.userId) {
      where.userId = options.userId;
    }
    if (options?.status) {
      where.status = options.status;
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [contributions, total] = await Promise.all([
      prisma.dataContribution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.dataContribution.count({ where }),
    ]);

    return { contributions, total };
  }

  /**
   * Get total credits for a user
   */
  async getUserCredits(userId: string): Promise<number> {
    const result = await prisma.contributionCredit.aggregate({
      where: { userId },
      _sum: { amount: true },
    });

    return result._sum.amount ?? 0;
  }

  /**
   * Get leaderboard — top contributors by total credits
   */
  async getLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    const creditGroups = await prisma.contributionCredit.groupBy({
      by: ['userId'],
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    });

    // For each user, get episode totals
    const entries: LeaderboardEntry[] = [];
    for (const group of creditGroups) {
      const episodeResult = await prisma.dataContribution.aggregate({
        where: { userId: group.userId, status: 'approved' },
        _sum: { episodeCount: true },
      });

      entries.push({
        userId: group.userId,
        totalCredits: group._sum.amount ?? 0,
        totalEpisodes: episodeResult._sum.episodeCount ?? 0,
      });
    }

    return entries;
  }

  /**
   * Get aggregate impact stats for a user
   */
  async getImpactStats(userId: string): Promise<ImpactStats> {
    const [aggregates, creditTotal, countResult] = await Promise.all([
      prisma.dataContribution.aggregate({
        where: { userId },
        _sum: {
          episodeCount: true,
          frameCount: true,
          sizeBytes: true,
        },
      }),
      prisma.contributionCredit.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
      prisma.dataContribution.count({
        where: { userId },
      }),
    ]);

    return {
      totalEpisodes: aggregates._sum.episodeCount ?? 0,
      totalFrames: aggregates._sum.frameCount ?? 0,
      totalSizeBytes: aggregates._sum.sizeBytes ?? BigInt(0),
      totalCredits: creditTotal._sum.amount ?? 0,
      contributionCount: countResult,
    };
  }
}

// Singleton instance
export const contributionService = new ContributionService();

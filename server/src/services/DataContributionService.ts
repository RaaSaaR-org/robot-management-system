/**
 * @file DataContributionService.ts
 * @description Service for customer data contribution management
 * @feature datasets
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import type {
  DataContribution,
  ContributionStatus,
  ContributionLicenseType,
  ContributionMetadata,
  ContributionCredit,
  CreditBalance,
  CreditReason,
  ContributionImpact,
  ImpactSummary,
  ContributorStats,
  ContributorTier,
  LeaderboardEntry,
  Reward,
  Redemption,
  RewardType,
  InitiateContributionRequest,
  UploadContributionDataRequest,
  ReviewContributionRequest,
  ContributionEvent,
  CreditMultipliers,
} from '../types/contribution.types.js';
import {
  DEFAULT_CREDIT_MULTIPLIERS,
  getTierForCredits,
} from '../types/contribution.types.js';

// ============================================================================
// DATA CONTRIBUTION SERVICE
// ============================================================================

/**
 * Service for managing customer data contributions
 */
export class DataContributionService extends EventEmitter {
  private static instance: DataContributionService;

  // In-memory stores (would be database in production)
  private contributions: Map<string, DataContribution> = new Map();
  private credits: Map<string, ContributionCredit> = new Map();
  private impacts: Map<string, ContributionImpact> = new Map();
  private rewards: Map<string, Reward> = new Map();
  private redemptions: Map<string, Redemption> = new Map();

  // Credit multipliers
  private creditMultipliers: CreditMultipliers = DEFAULT_CREDIT_MULTIPLIERS;

  private constructor() {
    super();
    this.initializeDefaultRewards();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DataContributionService {
    if (!DataContributionService.instance) {
      DataContributionService.instance = new DataContributionService();
    }
    return DataContributionService.instance;
  }

  /**
   * Initialize default rewards
   */
  private initializeDefaultRewards(): void {
    const defaultRewards: Reward[] = [
      {
        id: 'service-credit-100',
        name: '$100 Service Credit',
        description: 'Apply $100 credit to your next invoice',
        type: 'service_credit',
        creditCost: 10000,
        available: true,
        redeemedCount: 0,
      },
      {
        id: 'priority-training',
        name: 'Priority Training Queue',
        description: 'Skip the training job queue for 1 month',
        type: 'training_priority',
        creditCost: 5000,
        available: true,
        limitPerUser: 1,
        redeemedCount: 0,
      },
      {
        id: 'premium-support',
        name: 'Premium Support Access',
        description: '3 months of premium support access',
        type: 'priority_support',
        creditCost: 15000,
        available: true,
        redeemedCount: 0,
      },
      {
        id: 'feature-beta-access',
        name: 'Beta Feature Access',
        description: 'Early access to new features',
        type: 'feature_unlock',
        creditCost: 2500,
        available: true,
        redeemedCount: 0,
      },
    ];

    for (const reward of defaultRewards) {
      this.rewards.set(reward.id, reward);
    }
  }

  // ============================================================================
  // CONTRIBUTION MANAGEMENT
  // ============================================================================

  /**
   * Initiate a new contribution
   */
  initiateContribution(
    userId: string,
    request: InitiateContributionRequest
  ): DataContribution {
    const id = crypto.randomUUID();

    const contribution: DataContribution = {
      id,
      userId,
      organizationId: request.organizationId,
      status: 'draft',
      trajectoryCount: 0,
      licenseType: request.licenseType,
      consentGrantedAt: new Date(),
      metadata: request.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.contributions.set(id, contribution);

    this.emitEvent({
      type: 'contribution:initiated',
      contributionId: id,
      userId,
      timestamp: new Date(),
    });

    return contribution;
  }

  /**
   * Upload contribution data
   */
  uploadContributionData(
    contributionId: string,
    request: UploadContributionDataRequest
  ): DataContribution {
    const contribution = this.contributions.get(contributionId);
    if (!contribution) {
      throw new Error('Contribution not found');
    }

    if (contribution.status !== 'draft') {
      throw new Error(`Cannot upload data in status: ${contribution.status}`);
    }

    contribution.trajectoryCount = request.trajectoryCount;
    contribution.status = 'uploaded';
    contribution.updatedAt = new Date();

    this.emitEvent({
      type: 'contribution:uploaded',
      contributionId,
      userId: contribution.userId,
      data: { trajectoryCount: request.trajectoryCount },
      timestamp: new Date(),
    });

    return contribution;
  }

  /**
   * Submit contribution for review
   */
  submitForReview(contributionId: string): DataContribution {
    const contribution = this.contributions.get(contributionId);
    if (!contribution) {
      throw new Error('Contribution not found');
    }

    if (contribution.status !== 'uploaded') {
      throw new Error(`Cannot submit for review in status: ${contribution.status}`);
    }

    // Simulate validation
    contribution.status = 'validating';
    contribution.updatedAt = new Date();

    this.emitEvent({
      type: 'contribution:validating',
      contributionId,
      userId: contribution.userId,
      timestamp: new Date(),
    });

    // Simulate async validation completing
    setTimeout(() => {
      const c = this.contributions.get(contributionId);
      if (c && c.status === 'validating') {
        // Compute quality score
        c.qualityScore = 60 + Math.random() * 30; // 60-90 range
        c.status = 'reviewing';
        c.updatedAt = new Date();

        this.emitEvent({
          type: 'contribution:reviewing',
          contributionId,
          userId: c.userId,
          data: { qualityScore: c.qualityScore },
          timestamp: new Date(),
        });
      }
    }, 2000);

    return contribution;
  }

  /**
   * Review a contribution (admin)
   */
  reviewContribution(
    contributionId: string,
    reviewerId: string,
    request: ReviewContributionRequest
  ): DataContribution {
    const contribution = this.contributions.get(contributionId);
    if (!contribution) {
      throw new Error('Contribution not found');
    }

    if (contribution.status !== 'reviewing') {
      throw new Error(`Cannot review in status: ${contribution.status}`);
    }

    contribution.reviewedBy = reviewerId;
    contribution.reviewedAt = new Date();
    contribution.updatedAt = new Date();

    if (request.qualityOverride !== undefined) {
      contribution.qualityScore = request.qualityOverride;
    }

    if (request.decision === 'accept') {
      contribution.status = 'accepted';
      contribution.datasetId = `dataset_${contributionId}`;

      // Award credits
      const creditsAwarded = this.awardCreditsForContribution(contribution);
      contribution.creditsAwarded = creditsAwarded;

      this.emitEvent({
        type: 'contribution:accepted',
        contributionId,
        userId: contribution.userId,
        data: { creditsAwarded },
        timestamp: new Date(),
      });
    } else {
      contribution.status = 'rejected';
      contribution.rejectionReason = request.rejectionReason || 'Did not meet quality standards';

      this.emitEvent({
        type: 'contribution:rejected',
        contributionId,
        userId: contribution.userId,
        data: { reason: contribution.rejectionReason },
        timestamp: new Date(),
      });
    }

    return contribution;
  }

  /**
   * Revoke a contribution (user consent revocation)
   */
  revokeContribution(
    contributionId: string,
    reason: string
  ): DataContribution {
    const contribution = this.contributions.get(contributionId);
    if (!contribution) {
      throw new Error('Contribution not found');
    }

    if (contribution.status === 'revoked') {
      return contribution;
    }

    contribution.status = 'revoked';
    contribution.revokedAt = new Date();
    contribution.revocationReason = reason;
    contribution.updatedAt = new Date();

    this.emitEvent({
      type: 'contribution:revoked',
      contributionId,
      userId: contribution.userId,
      data: { reason },
      timestamp: new Date(),
    });

    return contribution;
  }

  /**
   * Get a contribution
   */
  getContribution(contributionId: string): DataContribution | undefined {
    return this.contributions.get(contributionId);
  }

  /**
   * List contributions
   */
  listContributions(options?: {
    userId?: string;
    status?: ContributionStatus;
    licenseType?: ContributionLicenseType;
    limit?: number;
    offset?: number;
  }): { contributions: DataContribution[]; total: number } {
    let contributions = Array.from(this.contributions.values());

    if (options?.userId) {
      contributions = contributions.filter((c) => c.userId === options.userId);
    }
    if (options?.status) {
      contributions = contributions.filter((c) => c.status === options.status);
    }
    if (options?.licenseType) {
      contributions = contributions.filter(
        (c) => c.licenseType === options.licenseType
      );
    }

    // Sort by creation date descending
    contributions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = contributions.length;

    if (options?.offset) {
      contributions = contributions.slice(options.offset);
    }
    if (options?.limit) {
      contributions = contributions.slice(0, options.limit);
    }

    return { contributions, total };
  }

  // ============================================================================
  // CREDIT MANAGEMENT
  // ============================================================================

  /**
   * Calculate credits for a contribution
   */
  calculateCredits(contribution: DataContribution): number {
    const { trajectoryCount, qualityScore } = contribution;

    // Base credits
    let credits = trajectoryCount * this.creditMultipliers.baseCreditsPerTrajectory;

    // Quality bonus (0-100 score)
    if (qualityScore !== undefined) {
      const qualityBonus = qualityScore * this.creditMultipliers.qualityMultiplier;
      credits *= 1 + qualityBonus;
    }

    // Large dataset bonus
    if (trajectoryCount >= this.creditMultipliers.largeDatasetThreshold) {
      credits *= this.creditMultipliers.largeDatasetMultiplier;
    }

    // First contribution bonus
    const userContributions = Array.from(this.contributions.values()).filter(
      (c) => c.userId === contribution.userId && c.status === 'accepted'
    );
    if (userContributions.length === 0) {
      credits += this.creditMultipliers.firstContributionBonus;
    }

    // Rarity bonus for underrepresented tasks would be computed here
    // (requires access to dataset statistics)

    return Math.floor(credits);
  }

  /**
   * Award credits for a contribution
   */
  private awardCreditsForContribution(contribution: DataContribution): number {
    const amount = this.calculateCredits(contribution);

    const credit: ContributionCredit = {
      id: crypto.randomUUID(),
      userId: contribution.userId,
      amount,
      reason: 'contribution',
      contributionId: contribution.id,
      description: `Credits for contribution ${contribution.id}`,
      awardedAt: new Date(),
    };

    this.credits.set(credit.id, credit);

    this.emitEvent({
      type: 'credits:awarded',
      userId: contribution.userId,
      contributionId: contribution.id,
      data: { amount },
      timestamp: new Date(),
    });

    return amount;
  }

  /**
   * Award bonus credits
   */
  awardBonusCredits(
    userId: string,
    amount: number,
    reason: CreditReason,
    description?: string
  ): ContributionCredit {
    const credit: ContributionCredit = {
      id: crypto.randomUUID(),
      userId,
      amount,
      reason,
      description,
      awardedAt: new Date(),
    };

    this.credits.set(credit.id, credit);

    this.emitEvent({
      type: 'credits:awarded',
      userId,
      data: { amount, reason },
      timestamp: new Date(),
    });

    return credit;
  }

  /**
   * Get credit balance for a user
   */
  getCreditBalance(userId: string): CreditBalance {
    const userCredits = Array.from(this.credits.values()).filter(
      (c) => c.userId === userId
    );

    let totalEarned = 0;
    let totalRedeemed = 0;

    for (const credit of userCredits) {
      if (credit.reason === 'redemption') {
        totalRedeemed += Math.abs(credit.amount);
      } else if (credit.amount > 0) {
        totalEarned += credit.amount;
      }
    }

    const available = totalEarned - totalRedeemed;

    // Compute pending (from contributions still being reviewed)
    const pendingContributions = Array.from(this.contributions.values()).filter(
      (c) =>
        c.userId === userId &&
        (c.status === 'validating' || c.status === 'reviewing')
    );
    const pending = pendingContributions.reduce(
      (sum, c) => sum + this.calculateCredits(c),
      0
    );

    return {
      userId,
      totalEarned,
      totalRedeemed,
      available,
      pending,
      expiringSoon: 0, // Would compute from expiration dates
    };
  }

  /**
   * Get credit history for a user
   */
  getCreditHistory(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): ContributionCredit[] {
    let credits = Array.from(this.credits.values()).filter(
      (c) => c.userId === userId
    );

    // Sort by date descending
    credits.sort((a, b) => b.awardedAt.getTime() - a.awardedAt.getTime());

    if (options?.offset) {
      credits = credits.slice(options.offset);
    }
    if (options?.limit) {
      credits = credits.slice(0, options.limit);
    }

    return credits;
  }

  // ============================================================================
  // REWARDS & REDEMPTION
  // ============================================================================

  /**
   * Get all available rewards
   */
  getRewards(): Reward[] {
    return Array.from(this.rewards.values()).filter((r) => r.available);
  }

  /**
   * Get a reward by ID
   */
  getReward(rewardId: string): Reward | undefined {
    return this.rewards.get(rewardId);
  }

  /**
   * Redeem credits for a reward
   */
  redeemCredits(userId: string, rewardId: string): Redemption {
    const reward = this.rewards.get(rewardId);
    if (!reward) {
      throw new Error('Reward not found');
    }

    if (!reward.available) {
      throw new Error('Reward is not available');
    }

    const balance = this.getCreditBalance(userId);
    if (balance.available < reward.creditCost) {
      throw new Error(
        `Insufficient credits. Need ${reward.creditCost}, have ${balance.available}`
      );
    }

    // Check per-user limit
    if (reward.limitPerUser) {
      const userRedemptions = Array.from(this.redemptions.values()).filter(
        (r) => r.userId === userId && r.rewardId === rewardId && r.status !== 'cancelled'
      );
      if (userRedemptions.length >= reward.limitPerUser) {
        throw new Error('You have reached the limit for this reward');
      }
    }

    // Deduct credits
    const deduction: ContributionCredit = {
      id: crypto.randomUUID(),
      userId,
      amount: -reward.creditCost,
      reason: 'redemption',
      description: `Redeemed for: ${reward.name}`,
      awardedAt: new Date(),
    };
    this.credits.set(deduction.id, deduction);

    // Create redemption
    const redemption: Redemption = {
      id: crypto.randomUUID(),
      userId,
      rewardId,
      creditCost: reward.creditCost,
      status: 'pending',
      redeemedAt: new Date(),
    };
    this.redemptions.set(redemption.id, redemption);

    reward.redeemedCount++;

    this.emitEvent({
      type: 'credits:redeemed',
      userId,
      data: { rewardId, creditCost: reward.creditCost },
      timestamp: new Date(),
    });

    return redemption;
  }

  /**
   * Get redemption history for a user
   */
  getRedemptionHistory(userId: string): Redemption[] {
    return Array.from(this.redemptions.values())
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.redeemedAt.getTime() - a.redeemedAt.getTime());
  }

  // ============================================================================
  // IMPACT TRACKING
  // ============================================================================

  /**
   * Record contribution impact
   */
  recordImpact(
    contributionId: string,
    modelVersionId: string,
    trajectoriesUsed: number,
    impactScore: number,
    improvements?: { metric: string; before: number; after: number; attributionPercent: number }[]
  ): ContributionImpact {
    const impact: ContributionImpact = {
      id: crypto.randomUUID(),
      contributionId,
      modelVersionId,
      trajectoriesUsed,
      impactScore,
      performanceImprovement: improvements,
      recordedAt: new Date(),
    };

    this.impacts.set(impact.id, impact);

    this.emitEvent({
      type: 'impact:recorded',
      contributionId,
      data: { modelVersionId, impactScore },
      timestamp: new Date(),
    });

    return impact;
  }

  /**
   * Get impact summary for a contribution
   */
  getImpactSummary(contributionId: string): ImpactSummary {
    const impacts = Array.from(this.impacts.values()).filter(
      (i) => i.contributionId === contributionId
    );

    const totalModelsUsedIn = new Set(impacts.map((i) => i.modelVersionId)).size;
    const totalTrajectoriesUsed = impacts.reduce(
      (sum, i) => sum + i.trajectoriesUsed,
      0
    );
    const averageImpactScore =
      impacts.length > 0
        ? impacts.reduce((sum, i) => sum + i.impactScore, 0) / impacts.length
        : 0;

    // Aggregate improvements
    const improvementMap = new Map<string, { before: number; after: number; count: number }>();
    for (const impact of impacts) {
      for (const improvement of impact.performanceImprovement || []) {
        const existing = improvementMap.get(improvement.metric);
        if (existing) {
          existing.before += improvement.before;
          existing.after += improvement.after;
          existing.count++;
        } else {
          improvementMap.set(improvement.metric, {
            before: improvement.before,
            after: improvement.after,
            count: 1,
          });
        }
      }
    }

    const improvements = Array.from(improvementMap.entries()).map(
      ([metric, data]) => ({
        metric,
        before: data.before / data.count,
        after: data.after / data.count,
        attributionPercent: 0, // Would compute properly
      })
    );

    const lastUsedAt =
      impacts.length > 0
        ? new Date(Math.max(...impacts.map((i) => i.recordedAt.getTime())))
        : undefined;

    return {
      contributionId,
      totalModelsUsedIn,
      totalTrajectoriesUsed,
      averageImpactScore,
      improvements,
      lastUsedAt,
    };
  }

  // ============================================================================
  // LEADERBOARD
  // ============================================================================

  /**
   * Get contributor stats
   */
  getContributorStats(userId: string): ContributorStats | undefined {
    const contributions = Array.from(this.contributions.values()).filter(
      (c) => c.userId === userId
    );

    if (contributions.length === 0) {
      return undefined;
    }

    const acceptedContributions = contributions.filter(
      (c) => c.status === 'accepted'
    );
    const totalCredits = this.getCreditBalance(userId).totalEarned;

    const qualityScores = acceptedContributions
      .filter((c) => c.qualityScore !== undefined)
      .map((c) => c.qualityScore!);

    const averageQuality =
      qualityScores.length > 0
        ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
        : 0;

    const acceptanceRate =
      contributions.length > 0
        ? acceptedContributions.length / contributions.length
        : 0;

    return {
      userId,
      totalContributions: acceptedContributions.length,
      totalTrajectories: acceptedContributions.reduce(
        (sum, c) => sum + c.trajectoryCount,
        0
      ),
      totalCredits,
      averageQuality,
      acceptanceRate,
      rank: 0, // Computed in leaderboard
      tier: getTierForCredits(totalCredits),
      joinedAt: contributions[0]?.createdAt || new Date(),
      lastContributionAt: contributions[contributions.length - 1]?.createdAt,
    };
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(options?: {
    limit?: number;
    organizationId?: string;
  }): LeaderboardEntry[] {
    // Get all unique users with contributions
    const userIds = new Set<string>();
    for (const contribution of this.contributions.values()) {
      if (contribution.status === 'accepted') {
        if (!options?.organizationId || contribution.organizationId === options.organizationId) {
          userIds.add(contribution.userId);
        }
      }
    }

    // Get stats for each user
    const entries: LeaderboardEntry[] = [];
    for (const userId of userIds) {
      const stats = this.getContributorStats(userId);
      if (stats) {
        entries.push({
          rank: 0,
          userId: stats.userId,
          totalCredits: stats.totalCredits,
          totalContributions: stats.totalContributions,
          totalTrajectories: stats.totalTrajectories,
          tier: stats.tier,
          averageQuality: stats.averageQuality,
        });
      }
    }

    // Sort by credits descending
    entries.sort((a, b) => b.totalCredits - a.totalCredits);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    // Apply limit
    if (options?.limit) {
      return entries.slice(0, options.limit);
    }

    return entries;
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: ContributionEvent): void {
    this.emit('contribution:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const dataContributionService = DataContributionService.getInstance();

/**
 * @file contribution.types.ts
 * @description Type definitions for Customer Data Contribution Portal
 * @feature datasets
 */

// ============================================================================
// CONTRIBUTION STATUS TYPES
// ============================================================================

/**
 * Contribution status
 */
export type ContributionStatus =
  | 'draft'
  | 'uploaded'
  | 'validating'
  | 'reviewing'
  | 'accepted'
  | 'rejected'
  | 'revoked';

/**
 * License type for contributions
 */
export type ContributionLicenseType =
  | 'exclusive'
  | 'non_exclusive'
  | 'limited'
  | 'research_only';

// ============================================================================
// CONTRIBUTION TYPES
// ============================================================================

/**
 * Contribution metadata
 */
export interface ContributionMetadata {
  /** Robot type/model used for collection */
  robotType: string;
  /** Task categories covered */
  taskCategories: string[];
  /** Collection method */
  collectionMethod: 'teleoperation' | 'autonomous' | 'kinesthetic' | 'simulation';
  /** Description of the data */
  description: string;
  /** Environment description */
  environment?: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Data contribution
 */
export interface DataContribution {
  id: string;
  userId: string;
  organizationId?: string;
  status: ContributionStatus;
  datasetId?: string;
  trajectoryCount: number;
  qualityScore?: number;
  licenseType: ContributionLicenseType;
  consentGrantedAt: Date;
  metadata: ContributionMetadata;
  creditsAwarded?: number;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  revokedAt?: Date;
  revocationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CREDIT TYPES
// ============================================================================

/**
 * Credit reason types
 */
export type CreditReason =
  | 'contribution'
  | 'bonus'
  | 'referral'
  | 'redemption'
  | 'adjustment'
  | 'expiration';

/**
 * Contribution credit record
 */
export interface ContributionCredit {
  id: string;
  userId: string;
  amount: number;
  reason: CreditReason;
  contributionId?: string;
  description?: string;
  awardedAt: Date;
  expiresAt?: Date;
}

/**
 * Credit balance
 */
export interface CreditBalance {
  userId: string;
  totalEarned: number;
  totalRedeemed: number;
  available: number;
  pending: number;
  expiringSoon: number;
  expirationDate?: Date;
}

/**
 * Credit multipliers
 */
export interface CreditMultipliers {
  /** Base credits per trajectory */
  baseCreditsPerTrajectory: number;
  /** Quality score multiplier (applied to score 0-100) */
  qualityMultiplier: number;
  /** Rarity bonus for underrepresented tasks */
  rarityBonusMax: number;
  /** First contribution bonus */
  firstContributionBonus: number;
  /** Large dataset bonus threshold */
  largeDatasetThreshold: number;
  /** Large dataset bonus multiplier */
  largeDatasetMultiplier: number;
}

/**
 * Default credit multipliers
 */
export const DEFAULT_CREDIT_MULTIPLIERS: CreditMultipliers = {
  baseCreditsPerTrajectory: 10,
  qualityMultiplier: 0.02, // 2% bonus per quality point
  rarityBonusMax: 50,
  firstContributionBonus: 100,
  largeDatasetThreshold: 1000,
  largeDatasetMultiplier: 1.2,
};

// ============================================================================
// IMPACT TYPES
// ============================================================================

/**
 * Contribution impact record
 */
export interface ContributionImpact {
  id: string;
  contributionId: string;
  modelVersionId: string;
  trajectoriesUsed: number;
  impactScore: number;
  performanceImprovement?: PerformanceImprovement[];
  recordedAt: Date;
}

/**
 * Performance improvement detail
 */
export interface PerformanceImprovement {
  metric: string;
  before: number;
  after: number;
  attributionPercent: number;
}

/**
 * Impact summary
 */
export interface ImpactSummary {
  contributionId: string;
  totalModelsUsedIn: number;
  totalTrajectoriesUsed: number;
  averageImpactScore: number;
  improvements: PerformanceImprovement[];
  lastUsedAt?: Date;
}

// ============================================================================
// LEADERBOARD TYPES
// ============================================================================

/**
 * Contributor stats
 */
export interface ContributorStats {
  userId: string;
  organizationId?: string;
  displayName?: string;
  totalContributions: number;
  totalTrajectories: number;
  totalCredits: number;
  averageQuality: number;
  acceptanceRate: number;
  rank: number;
  tier: ContributorTier;
  joinedAt: Date;
  lastContributionAt?: Date;
}

/**
 * Contributor tier
 */
export type ContributorTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond';

/**
 * Tier thresholds
 */
export const TIER_THRESHOLDS: Record<ContributorTier, number> = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 20000,
  diamond: 100000,
};

/**
 * Get tier for credits
 */
export function getTierForCredits(credits: number): ContributorTier {
  if (credits >= TIER_THRESHOLDS.diamond) return 'diamond';
  if (credits >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (credits >= TIER_THRESHOLDS.gold) return 'gold';
  if (credits >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName?: string;
  totalCredits: number;
  totalContributions: number;
  totalTrajectories: number;
  tier: ContributorTier;
  averageQuality: number;
}

// ============================================================================
// REWARD TYPES
// ============================================================================

/**
 * Reward types
 */
export type RewardType =
  | 'service_credit'
  | 'feature_unlock'
  | 'priority_support'
  | 'training_priority'
  | 'merchandise';

/**
 * Redeemable reward
 */
export interface Reward {
  id: string;
  name: string;
  description: string;
  type: RewardType;
  creditCost: number;
  available: boolean;
  limitPerUser?: number;
  totalLimit?: number;
  redeemedCount: number;
}

/**
 * Redemption record
 */
export interface Redemption {
  id: string;
  userId: string;
  rewardId: string;
  creditCost: number;
  status: 'pending' | 'fulfilled' | 'cancelled';
  redeemedAt: Date;
  fulfilledAt?: Date;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Initiate contribution request
 */
export interface InitiateContributionRequest {
  licenseType: ContributionLicenseType;
  metadata: ContributionMetadata;
  organizationId?: string;
}

/**
 * Upload contribution data request
 */
export interface UploadContributionDataRequest {
  trajectoryCount: number;
  dataPath?: string;
  checksum?: string;
}

/**
 * Review contribution request
 */
export interface ReviewContributionRequest {
  decision: 'accept' | 'reject';
  rejectionReason?: string;
  qualityOverride?: number;
}

/**
 * Redeem credits request
 */
export interface RedeemCreditsRequest {
  rewardId: string;
}

/**
 * List contributions params
 */
export interface ListContributionsParams {
  userId?: string;
  status?: ContributionStatus;
  licenseType?: ContributionLicenseType;
  limit?: number;
  offset?: number;
}

/**
 * List leaderboard params
 */
export interface ListLeaderboardParams {
  period?: 'all_time' | 'monthly' | 'weekly';
  limit?: number;
  organizationId?: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Contribution event types
 */
export type ContributionEventType =
  | 'contribution:initiated'
  | 'contribution:uploaded'
  | 'contribution:validating'
  | 'contribution:reviewing'
  | 'contribution:accepted'
  | 'contribution:rejected'
  | 'contribution:revoked'
  | 'credits:awarded'
  | 'credits:redeemed'
  | 'impact:recorded';

/**
 * Contribution event
 */
export interface ContributionEvent {
  type: ContributionEventType;
  contributionId?: string;
  userId?: string;
  data?: unknown;
  timestamp: Date;
}

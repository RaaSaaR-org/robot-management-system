/**
 * @file contributions.types.ts
 * @description Type definitions for customer data contributions
 * @feature contributions
 * @dependencies None
 */

// ============================================================================
// STATUS TYPES
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

/**
 * Collection method
 */
export type CollectionMethod =
  | 'teleoperation'
  | 'autonomous'
  | 'kinesthetic'
  | 'simulation';

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
 * Contributor tier
 */
export type ContributorTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond';

/**
 * Reward type
 */
export type RewardType =
  | 'service_credit'
  | 'feature_unlock'
  | 'priority_support'
  | 'training_priority'
  | 'merchandise';

// ============================================================================
// STATUS LABELS AND COLORS
// ============================================================================

export const CONTRIBUTION_STATUS_LABELS: Record<ContributionStatus, string> = {
  draft: 'Draft',
  uploaded: 'Uploaded',
  validating: 'Validating',
  reviewing: 'Under Review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  revoked: 'Revoked',
};

export const CONTRIBUTION_STATUS_COLORS: Record<ContributionStatus, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'default',
  uploaded: 'secondary',
  validating: 'primary',
  reviewing: 'primary',
  accepted: 'success',
  rejected: 'destructive',
  revoked: 'warning',
};

export const LICENSE_TYPE_LABELS: Record<ContributionLicenseType, string> = {
  exclusive: 'Exclusive License',
  non_exclusive: 'Non-Exclusive License',
  limited: 'Limited License',
  research_only: 'Research Only',
};

export const LICENSE_TYPE_DESCRIPTIONS: Record<ContributionLicenseType, string> = {
  exclusive: 'You grant exclusive rights to use your data. Higher credit rewards.',
  non_exclusive: 'You retain the right to use your data elsewhere. Standard rewards.',
  limited: 'Your data can only be used for specific purposes. Moderate rewards.',
  research_only: 'Data used only for research purposes. Lower rewards.',
};

export const TIER_LABELS: Record<ContributorTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
};

export const TIER_COLORS: Record<ContributorTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#E5E4E2',
  diamond: '#B9F2FF',
};

export const TIER_THRESHOLDS: Record<ContributorTier, number> = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 20000,
  diamond: 100000,
};

// ============================================================================
// ENTITY TYPES
// ============================================================================

/**
 * Contribution metadata
 */
export interface ContributionMetadata {
  robotType: string;
  taskCategories: string[];
  collectionMethod: CollectionMethod;
  description: string;
  environment?: string;
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
  consentGrantedAt: string;
  metadata: ContributionMetadata;
  creditsAwarded?: number;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  revokedAt?: string;
  revocationReason?: string;
  createdAt: string;
  updatedAt: string;
}

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
  awardedAt: string;
  expiresAt?: string;
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
  expirationDate?: string;
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
  lastUsedAt?: string;
}

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
  joinedAt: string;
  lastContributionAt?: string;
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
  redeemedAt: string;
  fulfilledAt?: string;
}

// ============================================================================
// REQUEST/RESPONSE TYPES
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
 * Upload contribution response
 */
export interface UploadContributionResponse {
  contribution: DataContribution;
  estimatedCredits: number;
  message: string;
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
 * List contributions response
 */
export interface ListContributionsResponse {
  contributions: DataContribution[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * List leaderboard params
 */
export interface ListLeaderboardParams {
  period?: 'all_time' | 'monthly' | 'weekly';
  limit?: number;
  organizationId?: string;
}

/**
 * List leaderboard response
 */
export interface ListLeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  count: number;
}

/**
 * Rewards list response
 */
export interface RewardsListResponse {
  rewards: Reward[];
  count: number;
}

/**
 * Credit history response
 */
export interface CreditHistoryResponse {
  history: ContributionCredit[];
  count: number;
}

/**
 * Redemption history response
 */
export interface RedemptionHistoryResponse {
  redemptions: Redemption[];
  count: number;
}

/**
 * Impact response
 */
export interface ImpactResponse {
  contributionId: string;
  impact: ImpactSummary;
  message: string;
}

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Contribution filters
 */
export interface ContributionFilters {
  status?: ContributionStatus;
  licenseType?: ContributionLicenseType;
  search?: string;
}

/**
 * Contribution pagination
 */
export interface ContributionPagination {
  limit: number;
  offset: number;
  total: number;
}

export const DEFAULT_PAGINATION: ContributionPagination = {
  limit: 20,
  offset: 0,
  total: 0,
};

// ============================================================================
// STORE TYPES
// ============================================================================

/**
 * Error codes for contributions
 */
export type ContributionErrorCode =
  | 'CONTRIBUTION_NOT_FOUND'
  | 'INVALID_STATUS'
  | 'INSUFFICIENT_CREDITS'
  | 'REWARD_NOT_AVAILABLE'
  | 'ALREADY_REDEEMED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Contributions state
 */
export interface ContributionsState {
  /** User contributions */
  contributions: DataContribution[];
  /** Selected contribution for detail view */
  selectedContribution: DataContribution | null;
  /** Credit balance */
  creditBalance: CreditBalance | null;
  /** Credit history */
  creditHistory: ContributionCredit[];
  /** Contributor stats */
  stats: ContributorStats | null;
  /** Leaderboard entries */
  leaderboard: LeaderboardEntry[];
  /** Available rewards */
  rewards: Reward[];
  /** Redemption history */
  redemptions: Redemption[];
  /** Filters */
  filters: ContributionFilters;
  /** Pagination */
  pagination: ContributionPagination;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Wizard state */
  wizardStep: number;
  wizardData: Partial<InitiateContributionRequest & UploadContributionDataRequest>;
}

/**
 * Contributions actions
 */
export interface ContributionsActions {
  // Contributions
  fetchContributions: () => Promise<void>;
  fetchContribution: (id: string) => Promise<void>;
  initiateContribution: (data: InitiateContributionRequest) => Promise<DataContribution>;
  uploadContributionData: (id: string, data: UploadContributionDataRequest) => Promise<UploadContributionResponse>;
  submitForReview: (id: string) => Promise<DataContribution>;
  revokeContribution: (id: string, reason?: string) => Promise<DataContribution>;
  selectContribution: (contribution: DataContribution | null) => void;
  // Credits
  fetchCreditBalance: () => Promise<void>;
  fetchCreditHistory: () => Promise<void>;
  redeemCredits: (rewardId: string) => Promise<Redemption>;
  // Rewards
  fetchRewards: () => Promise<void>;
  fetchRedemptionHistory: () => Promise<void>;
  // Leaderboard & Stats
  fetchLeaderboard: (params?: ListLeaderboardParams) => Promise<void>;
  fetchStats: () => Promise<void>;
  // Impact
  fetchImpact: (contributionId: string) => Promise<ImpactSummary>;
  // Filters
  setFilters: (filters: Partial<ContributionFilters>) => void;
  clearFilters: () => void;
  setPage: (offset: number) => void;
  // Wizard
  setWizardStep: (step: number) => void;
  setWizardData: (data: Partial<InitiateContributionRequest & UploadContributionDataRequest>) => void;
  resetWizard: () => void;
  // Error handling
  clearError: () => void;
  reset: () => void;
}

/**
 * Contributions store type
 */
export type ContributionsStore = ContributionsState & ContributionsActions;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get tier for credits amount
 */
export function getTierForCredits(credits: number): ContributorTier {
  if (credits >= TIER_THRESHOLDS.diamond) return 'diamond';
  if (credits >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (credits >= TIER_THRESHOLDS.gold) return 'gold';
  if (credits >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

/**
 * Get next tier threshold
 */
export function getNextTierThreshold(currentCredits: number): number | null {
  const tier = getTierForCredits(currentCredits);
  const tiers: ContributorTier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  const currentIndex = tiers.indexOf(tier);
  if (currentIndex === tiers.length - 1) return null;
  return TIER_THRESHOLDS[tiers[currentIndex + 1]];
}

/**
 * Check if contribution can be submitted
 */
export function canSubmitContribution(contribution: DataContribution): boolean {
  return contribution.status === 'uploaded' && contribution.trajectoryCount > 0;
}

/**
 * Check if contribution can be revoked
 */
export function canRevokeContribution(contribution: DataContribution): boolean {
  return !['revoked', 'draft'].includes(contribution.status);
}

/**
 * Format credits with thousands separator
 */
export function formatCredits(credits: number): string {
  return new Intl.NumberFormat().format(credits);
}

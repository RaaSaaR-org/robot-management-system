/**
 * @file contributionsApi.ts
 * @description API calls for customer data contribution endpoints
 * @feature contributions
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  DataContribution,
  CreditBalance,
  ContributorStats,
  Reward,
  Redemption,
  InitiateContributionRequest,
  UploadContributionDataRequest,
  UploadContributionResponse,
  RedeemCreditsRequest,
  ListContributionsParams,
  ListContributionsResponse,
  ListLeaderboardParams,
  ListLeaderboardResponse,
  RewardsListResponse,
  CreditHistoryResponse,
  RedemptionHistoryResponse,
  ImpactResponse,
} from '../types/contributions.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  // Contributions
  list: '/contributions',
  create: '/contributions',
  get: (id: string) => `/contributions/${id}`,
  upload: (id: string) => `/contributions/${id}/upload`,
  submit: (id: string) => `/contributions/${id}/submit`,
  review: (id: string) => `/contributions/${id}/review`,
  revoke: (id: string) => `/contributions/${id}/revoke`,
  impact: (id: string) => `/contributions/${id}/impact`,
  // Credits
  credits: '/contributions/credits',
  creditHistory: '/contributions/credits/history',
  redeem: '/contributions/credits/redeem',
  // Rewards
  rewards: '/contributions/rewards',
  redemptions: '/contributions/redemptions',
  // Leaderboard & Stats
  leaderboard: '/contributions/leaderboard',
  stats: '/contributions/stats',
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const contributionsApi = {
  // --------------------------------------------------------------------------
  // Contribution Management
  // --------------------------------------------------------------------------

  /**
   * List contributions with optional filters
   * @param params - Filter and pagination parameters
   * @returns Paginated list of contributions
   */
  async listContributions(params?: ListContributionsParams): Promise<ListContributionsResponse> {
    const response = await apiClient.get<ListContributionsResponse>(ENDPOINTS.list, {
      params: {
        userId: params?.userId,
        status: params?.status,
        licenseType: params?.licenseType,
        limit: params?.limit,
        offset: params?.offset,
      },
    });
    return response.data;
  },

  /**
   * Get a single contribution by ID
   * @param id - Contribution ID
   * @returns Contribution details
   */
  async getContribution(id: string): Promise<DataContribution> {
    const response = await apiClient.get<DataContribution>(ENDPOINTS.get(id));
    return response.data;
  },

  /**
   * Initiate a new contribution
   * @param data - Contribution metadata and license info
   * @returns Created contribution
   */
  async initiateContribution(data: InitiateContributionRequest): Promise<DataContribution> {
    const response = await apiClient.post<DataContribution>(ENDPOINTS.create, data);
    return response.data;
  },

  /**
   * Upload data for a contribution
   * @param id - Contribution ID
   * @param data - Upload data with trajectory count
   * @returns Updated contribution with estimated credits
   */
  async uploadContributionData(
    id: string,
    data: UploadContributionDataRequest
  ): Promise<UploadContributionResponse> {
    const response = await apiClient.post<UploadContributionResponse>(
      ENDPOINTS.upload(id),
      data
    );
    return response.data;
  },

  /**
   * Submit contribution for review
   * @param id - Contribution ID
   * @returns Updated contribution
   */
  async submitForReview(id: string): Promise<{ contribution: DataContribution; message: string }> {
    const response = await apiClient.post<{ contribution: DataContribution; message: string }>(
      ENDPOINTS.submit(id)
    );
    return response.data;
  },

  /**
   * Revoke a contribution (consent withdrawal)
   * @param id - Contribution ID
   * @param reason - Revocation reason
   * @returns Updated contribution
   */
  async revokeContribution(
    id: string,
    reason?: string
  ): Promise<{ contribution: DataContribution; message: string }> {
    const response = await apiClient.post<{ contribution: DataContribution; message: string }>(
      ENDPOINTS.revoke(id),
      { reason }
    );
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Impact
  // --------------------------------------------------------------------------

  /**
   * Get impact report for a contribution
   * @param id - Contribution ID
   * @returns Impact summary
   */
  async getImpact(id: string): Promise<ImpactResponse> {
    const response = await apiClient.get<ImpactResponse>(ENDPOINTS.impact(id));
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Credits
  // --------------------------------------------------------------------------

  /**
   * Get credit balance for current user
   * @returns Credit balance
   */
  async getCreditBalance(): Promise<CreditBalance> {
    const response = await apiClient.get<CreditBalance>(ENDPOINTS.credits);
    return response.data;
  },

  /**
   * Get credit history for current user
   * @param params - Pagination parameters
   * @returns Credit history
   */
  async getCreditHistory(params?: { limit?: number; offset?: number }): Promise<CreditHistoryResponse> {
    const response = await apiClient.get<CreditHistoryResponse>(ENDPOINTS.creditHistory, {
      params,
    });
    return response.data;
  },

  /**
   * Redeem credits for a reward
   * @param data - Redemption request with reward ID
   * @returns Redemption record
   */
  async redeemCredits(data: RedeemCreditsRequest): Promise<{
    redemption: Redemption;
    reward: Reward;
    message: string;
  }> {
    const response = await apiClient.post<{
      redemption: Redemption;
      reward: Reward;
      message: string;
    }>(ENDPOINTS.redeem, data);
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Rewards
  // --------------------------------------------------------------------------

  /**
   * Get available rewards
   * @returns List of rewards
   */
  async getRewards(): Promise<RewardsListResponse> {
    const response = await apiClient.get<RewardsListResponse>(ENDPOINTS.rewards);
    return response.data;
  },

  /**
   * Get redemption history for current user
   * @returns Redemption history
   */
  async getRedemptionHistory(): Promise<RedemptionHistoryResponse> {
    const response = await apiClient.get<RedemptionHistoryResponse>(ENDPOINTS.redemptions);
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Leaderboard & Stats
  // --------------------------------------------------------------------------

  /**
   * Get contributor leaderboard
   * @param params - Leaderboard filter parameters
   * @returns Leaderboard entries
   */
  async getLeaderboard(params?: ListLeaderboardParams): Promise<ListLeaderboardResponse> {
    const response = await apiClient.get<ListLeaderboardResponse>(ENDPOINTS.leaderboard, {
      params: {
        period: params?.period,
        limit: params?.limit,
        organizationId: params?.organizationId,
      },
    });
    return response.data;
  },

  /**
   * Get contributor stats for current user
   * @returns Contributor stats
   */
  async getContributorStats(): Promise<ContributorStats | { message: string; stats: null }> {
    const response = await apiClient.get<ContributorStats | { message: string; stats: null }>(
      ENDPOINTS.stats
    );
    return response.data;
  },
};

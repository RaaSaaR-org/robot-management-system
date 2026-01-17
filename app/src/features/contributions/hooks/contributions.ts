/**
 * @file contributions.ts
 * @description React hooks for contribution feature functionality
 * @feature contributions
 * @dependencies @/features/contributions/store
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useContributionsStore,
  selectContributions,
  selectSelectedContribution,
  selectCreditBalance,
  selectCreditHistory,
  selectStats,
  selectLeaderboard,
  selectRewards,
  selectRedemptions,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectWizardStep,
  selectWizardData,
} from '../store/contributionsStore';
import type {
  DataContribution,
  ContributionFilters,
  InitiateContributionRequest,
  UploadContributionDataRequest,
  ListLeaderboardParams,
  ImpactSummary,
  Reward,
} from '../types/contributions.types';

// ============================================================================
// RETURN TYPE INTERFACES
// ============================================================================

export interface UseContributionsReturn {
  contributions: DataContribution[];
  filters: ContributionFilters;
  pagination: ReturnType<typeof selectPagination>;
  isLoading: boolean;
  error: string | null;
  fetchContributions: () => Promise<void>;
  setFilters: (filters: Partial<ContributionFilters>) => void;
  clearFilters: () => void;
  setPage: (offset: number) => void;
  clearError: () => void;
}

export interface UseContributionReturn {
  contribution: DataContribution | null;
  isLoading: boolean;
  error: string | null;
  fetchContribution: () => Promise<void>;
  submitForReview: () => Promise<DataContribution>;
  revokeContribution: (reason?: string) => Promise<DataContribution>;
  fetchImpact: () => Promise<ImpactSummary>;
}

export interface UseContributionCreditsReturn {
  balance: ReturnType<typeof selectCreditBalance>;
  history: ReturnType<typeof selectCreditHistory>;
  isLoading: boolean;
  error: string | null;
  fetchBalance: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  redeemCredits: (rewardId: string) => Promise<void>;
}

export interface UseContributionWizardReturn {
  step: number;
  data: ReturnType<typeof selectWizardData>;
  isLoading: boolean;
  error: string | null;
  setStep: (step: number) => void;
  setData: (data: Partial<InitiateContributionRequest & UploadContributionDataRequest>) => void;
  resetWizard: () => void;
  initiateContribution: () => Promise<DataContribution>;
  uploadData: (id: string) => Promise<void>;
  submit: (id: string) => Promise<DataContribution>;
}

export interface UseLeaderboardReturn {
  leaderboard: ReturnType<typeof selectLeaderboard>;
  stats: ReturnType<typeof selectStats>;
  isLoading: boolean;
  error: string | null;
  fetchLeaderboard: (params?: ListLeaderboardParams) => Promise<void>;
  fetchStats: () => Promise<void>;
}

export interface UseRewardsReturn {
  rewards: ReturnType<typeof selectRewards>;
  affordableRewards: Reward[];
  redemptions: ReturnType<typeof selectRedemptions>;
  isLoading: boolean;
  error: string | null;
  fetchRewards: () => Promise<void>;
  fetchRedemptionHistory: () => Promise<void>;
  redeemCredits: (rewardId: string) => Promise<void>;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for managing contributions list with filters and pagination
 */
export function useContributions(): UseContributionsReturn {
  // Selectors
  const contributions = useContributionsStore(selectContributions);
  const filters = useContributionsStore(selectFilters);
  const pagination = useContributionsStore(selectPagination);
  const isLoading = useContributionsStore(selectIsLoading);
  const error = useContributionsStore(selectError);

  // Actions
  const storeFetchContributions = useContributionsStore((state) => state.fetchContributions);
  const storeSetFilters = useContributionsStore((state) => state.setFilters);
  const storeClearFilters = useContributionsStore((state) => state.clearFilters);
  const storeSetPage = useContributionsStore((state) => state.setPage);
  const storeClearError = useContributionsStore((state) => state.clearError);

  // Wrapped actions
  const fetchContributions = useCallback(async () => {
    await storeFetchContributions();
  }, [storeFetchContributions]);

  const setFilters = useCallback(
    (newFilters: Partial<ContributionFilters>) => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  const clearFilters = useCallback(() => {
    storeClearFilters();
  }, [storeClearFilters]);

  const setPage = useCallback(
    (offset: number) => {
      storeSetPage(offset);
    },
    [storeSetPage]
  );

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  // Fetch on mount
  useEffect(() => {
    fetchContributions();
  }, [fetchContributions]);

  return useMemo(
    () => ({
      contributions,
      filters,
      pagination,
      isLoading,
      error,
      fetchContributions,
      setFilters,
      clearFilters,
      setPage,
      clearError,
    }),
    [
      contributions,
      filters,
      pagination,
      isLoading,
      error,
      fetchContributions,
      setFilters,
      clearFilters,
      setPage,
      clearError,
    ]
  );
}

/**
 * Hook for managing a single contribution
 */
export function useContribution(id: string): UseContributionReturn {
  // Selectors
  const selectedContribution = useContributionsStore(selectSelectedContribution);
  const contributions = useContributionsStore(selectContributions);
  const isLoading = useContributionsStore(selectIsLoading);
  const error = useContributionsStore(selectError);

  // Use selected or find from list - memoize to avoid new reference on every render
  const contribution = useMemo(() => {
    if (selectedContribution?.id === id) {
      return selectedContribution;
    }
    return contributions.find((c) => c.id === id) ?? null;
  }, [id, selectedContribution, contributions]);

  // Actions
  const storeFetchContribution = useContributionsStore((state) => state.fetchContribution);
  const storeSubmitForReview = useContributionsStore((state) => state.submitForReview);
  const storeRevokeContribution = useContributionsStore((state) => state.revokeContribution);
  const storeFetchImpact = useContributionsStore((state) => state.fetchImpact);

  // Wrapped actions
  const fetchContribution = useCallback(async () => {
    await storeFetchContribution(id);
  }, [id, storeFetchContribution]);

  const submitForReview = useCallback(async () => {
    return storeSubmitForReview(id);
  }, [id, storeSubmitForReview]);

  const revokeContribution = useCallback(
    async (reason?: string) => {
      return storeRevokeContribution(id, reason);
    },
    [id, storeRevokeContribution]
  );

  const fetchImpact = useCallback(async () => {
    return storeFetchImpact(id);
  }, [id, storeFetchImpact]);

  // Fetch on mount if not already loaded
  useEffect(() => {
    if (!contribution) {
      fetchContribution();
    }
  }, [contribution, fetchContribution]);

  return useMemo(
    () => ({
      contribution,
      isLoading,
      error,
      fetchContribution,
      submitForReview,
      revokeContribution,
      fetchImpact,
    }),
    [
      contribution,
      isLoading,
      error,
      fetchContribution,
      submitForReview,
      revokeContribution,
      fetchImpact,
    ]
  );
}

/**
 * Hook for managing contribution credits
 */
export function useContributionCredits(): UseContributionCreditsReturn {
  // Selectors
  const balance = useContributionsStore(selectCreditBalance);
  const history = useContributionsStore(selectCreditHistory);
  const isLoading = useContributionsStore(selectIsLoading);
  const error = useContributionsStore(selectError);

  // Actions
  const storeFetchBalance = useContributionsStore((state) => state.fetchCreditBalance);
  const storeFetchHistory = useContributionsStore((state) => state.fetchCreditHistory);
  const storeRedeemCredits = useContributionsStore((state) => state.redeemCredits);

  // Wrapped actions
  const fetchBalance = useCallback(async () => {
    await storeFetchBalance();
  }, [storeFetchBalance]);

  const fetchHistory = useCallback(async () => {
    await storeFetchHistory();
  }, [storeFetchHistory]);

  const redeemCredits = useCallback(
    async (rewardId: string) => {
      await storeRedeemCredits(rewardId);
    },
    [storeRedeemCredits]
  );

  // Fetch on mount
  useEffect(() => {
    fetchBalance();
    fetchHistory();
  }, [fetchBalance, fetchHistory]);

  return useMemo(
    () => ({
      balance,
      history,
      isLoading,
      error,
      fetchBalance,
      fetchHistory,
      redeemCredits,
    }),
    [balance, history, isLoading, error, fetchBalance, fetchHistory, redeemCredits]
  );
}

/**
 * Hook for contribution wizard flow
 */
export function useContributionWizard(): UseContributionWizardReturn {
  // Selectors
  const step = useContributionsStore(selectWizardStep);
  const data = useContributionsStore(selectWizardData);
  const isLoading = useContributionsStore(selectIsLoading);
  const error = useContributionsStore(selectError);

  // Actions
  const storeSetStep = useContributionsStore((state) => state.setWizardStep);
  const storeSetData = useContributionsStore((state) => state.setWizardData);
  const storeResetWizard = useContributionsStore((state) => state.resetWizard);
  const storeInitiateContribution = useContributionsStore((state) => state.initiateContribution);
  const storeUploadData = useContributionsStore((state) => state.uploadContributionData);
  const storeSubmitForReview = useContributionsStore((state) => state.submitForReview);

  // Wrapped actions
  const setStep = useCallback(
    (newStep: number) => {
      storeSetStep(newStep);
    },
    [storeSetStep]
  );

  const setData = useCallback(
    (newData: Partial<InitiateContributionRequest & UploadContributionDataRequest>) => {
      storeSetData(newData);
    },
    [storeSetData]
  );

  const resetWizard = useCallback(() => {
    storeResetWizard();
  }, [storeResetWizard]);

  const initiateContribution = useCallback(async () => {
    if (!data.licenseType || !data.metadata) {
      throw new Error('Missing required contribution data');
    }
    return storeInitiateContribution({
      licenseType: data.licenseType,
      metadata: data.metadata,
      organizationId: data.organizationId,
    });
  }, [data, storeInitiateContribution]);

  const uploadData = useCallback(
    async (id: string) => {
      if (!data.trajectoryCount) {
        throw new Error('Missing trajectory count');
      }
      await storeUploadData(id, {
        trajectoryCount: data.trajectoryCount,
        dataPath: data.dataPath,
        checksum: data.checksum,
      });
    },
    [data, storeUploadData]
  );

  const submit = useCallback(
    async (id: string) => {
      return storeSubmitForReview(id);
    },
    [storeSubmitForReview]
  );

  return useMemo(
    () => ({
      step,
      data,
      isLoading,
      error,
      setStep,
      setData,
      resetWizard,
      initiateContribution,
      uploadData,
      submit,
    }),
    [
      step,
      data,
      isLoading,
      error,
      setStep,
      setData,
      resetWizard,
      initiateContribution,
      uploadData,
      submit,
    ]
  );
}

/**
 * Hook for leaderboard and contributor stats
 */
export function useLeaderboard(): UseLeaderboardReturn {
  // Selectors
  const leaderboard = useContributionsStore(selectLeaderboard);
  const stats = useContributionsStore(selectStats);
  const isLoading = useContributionsStore(selectIsLoading);
  const error = useContributionsStore(selectError);

  // Actions
  const storeFetchLeaderboard = useContributionsStore((state) => state.fetchLeaderboard);
  const storeFetchStats = useContributionsStore((state) => state.fetchStats);

  // Wrapped actions
  const fetchLeaderboard = useCallback(
    async (params?: ListLeaderboardParams) => {
      await storeFetchLeaderboard(params);
    },
    [storeFetchLeaderboard]
  );

  const fetchStats = useCallback(async () => {
    await storeFetchStats();
  }, [storeFetchStats]);

  // Fetch on mount
  useEffect(() => {
    fetchLeaderboard();
    fetchStats();
  }, [fetchLeaderboard, fetchStats]);

  return useMemo(
    () => ({
      leaderboard,
      stats,
      isLoading,
      error,
      fetchLeaderboard,
      fetchStats,
    }),
    [leaderboard, stats, isLoading, error, fetchLeaderboard, fetchStats]
  );
}

/**
 * Hook for rewards and redemptions
 */
export function useRewards(): UseRewardsReturn {
  // Selectors
  const rewards = useContributionsStore(selectRewards);
  const creditBalance = useContributionsStore(selectCreditBalance);
  const redemptions = useContributionsStore(selectRedemptions);
  const isLoading = useContributionsStore(selectIsLoading);
  const error = useContributionsStore(selectError);

  // Compute affordable rewards - memoize to avoid new reference on every render
  const affordableRewards = useMemo(() => {
    if (!creditBalance) return [];
    return rewards.filter((r) => r.available && r.creditCost <= creditBalance.available);
  }, [rewards, creditBalance]);

  // Actions
  const storeFetchRewards = useContributionsStore((state) => state.fetchRewards);
  const storeFetchRedemptionHistory = useContributionsStore(
    (state) => state.fetchRedemptionHistory
  );
  const storeRedeemCredits = useContributionsStore((state) => state.redeemCredits);

  // Wrapped actions
  const fetchRewards = useCallback(async () => {
    await storeFetchRewards();
  }, [storeFetchRewards]);

  const fetchRedemptionHistory = useCallback(async () => {
    await storeFetchRedemptionHistory();
  }, [storeFetchRedemptionHistory]);

  const redeemCredits = useCallback(
    async (rewardId: string) => {
      await storeRedeemCredits(rewardId);
    },
    [storeRedeemCredits]
  );

  // Fetch on mount
  useEffect(() => {
    fetchRewards();
    fetchRedemptionHistory();
  }, [fetchRewards, fetchRedemptionHistory]);

  return useMemo(
    () => ({
      rewards,
      affordableRewards,
      redemptions,
      isLoading,
      error,
      fetchRewards,
      fetchRedemptionHistory,
      redeemCredits,
    }),
    [
      rewards,
      affordableRewards,
      redemptions,
      isLoading,
      error,
      fetchRewards,
      fetchRedemptionHistory,
      redeemCredits,
    ]
  );
}

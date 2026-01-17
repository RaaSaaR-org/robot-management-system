/**
 * @file fleetlearning.ts
 * @description Custom hooks for fleet learning feature
 * @feature fleetlearning
 * @dependencies useFleetLearningStore
 */

import { useCallback, useEffect } from 'react';
import {
  useFleetLearningStore,
  selectRounds,
  selectSelectedRound,
  selectParticipants,
  selectPrivacyBudgets,
  selectROHEMetrics,
  selectConvergenceData,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectActiveRounds,
  selectCompletedRounds,
} from '../store/fleetlearningStore';
import type {
  FederatedRound,
  RoundFilters,
  CreateFederatedRoundRequest,
  GetROHEParams,
} from '../types/fleetlearning.types';

// ============================================================================
// HOOK TYPES
// ============================================================================

export interface UseFederatedRoundsReturn {
  rounds: FederatedRound[];
  activeRounds: FederatedRound[];
  completedRounds: FederatedRound[];
  filters: RoundFilters;
  pagination: { limit: number; offset: number; total: number };
  isLoading: boolean;
  error: string | null;
  fetchRounds: () => Promise<void>;
  setFilters: (filters: Partial<RoundFilters>) => void;
  clearFilters: () => void;
  setPage: (offset: number) => void;
}

export interface UseRoundDetailReturn {
  round: FederatedRound | null;
  participants: ReturnType<typeof selectParticipants>;
  isLoading: boolean;
  error: string | null;
  fetchRound: () => Promise<void>;
  startRound: () => Promise<void>;
  cancelRound: () => Promise<void>;
}

export interface UseCreateRoundReturn {
  isLoading: boolean;
  error: string | null;
  createRound: (data: CreateFederatedRoundRequest) => Promise<FederatedRound>;
}

export interface UsePrivacyBudgetsReturn {
  budgets: ReturnType<typeof selectPrivacyBudgets>;
  isLoading: boolean;
  error: string | null;
  fetchBudgets: () => Promise<void>;
}

export interface UseROHEMetricsReturn {
  metrics: ReturnType<typeof selectROHEMetrics>;
  isLoading: boolean;
  error: string | null;
  fetchMetrics: (params?: GetROHEParams) => Promise<void>;
}

export interface UseConvergenceDataReturn {
  data: ReturnType<typeof selectConvergenceData>;
  isLoading: boolean;
  error: string | null;
  fetchData: (modelVersion?: string) => Promise<void>;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for managing federated rounds list
 */
export function useFederatedRounds(): UseFederatedRoundsReturn {
  const rounds = useFleetLearningStore(selectRounds);
  const activeRounds = useFleetLearningStore(selectActiveRounds);
  const completedRounds = useFleetLearningStore(selectCompletedRounds);
  const filters = useFleetLearningStore(selectFilters);
  const pagination = useFleetLearningStore(selectPagination);
  const isLoading = useFleetLearningStore(selectIsLoading);
  const error = useFleetLearningStore(selectError);

  const storeFetchRounds = useFleetLearningStore((state) => state.fetchRounds);
  const storeSetFilters = useFleetLearningStore((state) => state.setFilters);
  const storeClearFilters = useFleetLearningStore((state) => state.clearFilters);
  const storeSetPage = useFleetLearningStore((state) => state.setPage);

  const fetchRounds = useCallback(async () => {
    await storeFetchRounds();
  }, [storeFetchRounds]);

  const setFilters = useCallback(
    (newFilters: Partial<RoundFilters>) => {
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

  // Fetch rounds on mount
  useEffect(() => {
    fetchRounds();
  }, [fetchRounds]);

  // Refetch when filters or pagination change
  useEffect(() => {
    fetchRounds();
  }, [filters, pagination.offset, pagination.limit, fetchRounds]);

  return {
    rounds,
    activeRounds,
    completedRounds,
    filters,
    pagination,
    isLoading,
    error,
    fetchRounds,
    setFilters,
    clearFilters,
    setPage,
  };
}

/**
 * Hook for managing a single round detail
 */
export function useRoundDetail(roundId: string): UseRoundDetailReturn {
  const round = useFleetLearningStore(selectSelectedRound);
  const participants = useFleetLearningStore(selectParticipants);
  const isLoading = useFleetLearningStore(selectIsLoading);
  const error = useFleetLearningStore(selectError);

  const storeFetchRound = useFleetLearningStore((state) => state.fetchRound);
  const storeStartRound = useFleetLearningStore((state) => state.startRound);
  const storeCancelRound = useFleetLearningStore((state) => state.cancelRound);

  const fetchRound = useCallback(async () => {
    await storeFetchRound(roundId);
  }, [storeFetchRound, roundId]);

  const startRound = useCallback(async () => {
    await storeStartRound(roundId);
  }, [storeStartRound, roundId]);

  const cancelRound = useCallback(async () => {
    await storeCancelRound(roundId);
  }, [storeCancelRound, roundId]);

  // Fetch round on mount
  useEffect(() => {
    if (roundId) {
      fetchRound();
    }
  }, [roundId, fetchRound]);

  return {
    round,
    participants,
    isLoading,
    error,
    fetchRound,
    startRound,
    cancelRound,
  };
}

/**
 * Hook for creating a new round
 */
export function useCreateRound(): UseCreateRoundReturn {
  const isLoading = useFleetLearningStore(selectIsLoading);
  const error = useFleetLearningStore(selectError);
  const storeCreateRound = useFleetLearningStore((state) => state.createRound);

  const createRound = useCallback(
    async (data: CreateFederatedRoundRequest) => {
      return await storeCreateRound(data);
    },
    [storeCreateRound]
  );

  return {
    isLoading,
    error,
    createRound,
  };
}

/**
 * Hook for managing privacy budgets
 */
export function usePrivacyBudgets(): UsePrivacyBudgetsReturn {
  const budgets = useFleetLearningStore(selectPrivacyBudgets);
  const isLoading = useFleetLearningStore(selectIsLoading);
  const error = useFleetLearningStore(selectError);
  const storeFetchBudgets = useFleetLearningStore((state) => state.fetchPrivacyBudgets);

  const fetchBudgets = useCallback(async () => {
    await storeFetchBudgets();
  }, [storeFetchBudgets]);

  // Fetch on mount
  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  return {
    budgets,
    isLoading,
    error,
    fetchBudgets,
  };
}

/**
 * Hook for ROHE metrics
 */
export function useROHEMetrics(initialParams?: GetROHEParams): UseROHEMetricsReturn {
  const metrics = useFleetLearningStore(selectROHEMetrics);
  const isLoading = useFleetLearningStore(selectIsLoading);
  const error = useFleetLearningStore(selectError);
  const storeFetchMetrics = useFleetLearningStore((state) => state.fetchROHEMetrics);

  const fetchMetrics = useCallback(
    async (params?: GetROHEParams) => {
      await storeFetchMetrics(params);
    },
    [storeFetchMetrics]
  );

  // Fetch on mount with initial params
  useEffect(() => {
    fetchMetrics(initialParams);
  }, [fetchMetrics, initialParams]);

  return {
    metrics,
    isLoading,
    error,
    fetchMetrics,
  };
}

/**
 * Hook for convergence data visualization
 */
export function useConvergenceData(modelVersion?: string): UseConvergenceDataReturn {
  const data = useFleetLearningStore(selectConvergenceData);
  const isLoading = useFleetLearningStore(selectIsLoading);
  const error = useFleetLearningStore(selectError);
  const storeFetchData = useFleetLearningStore((state) => state.fetchConvergenceData);

  const fetchData = useCallback(
    async (version?: string) => {
      await storeFetchData(version);
    },
    [storeFetchData]
  );

  // Fetch on mount
  useEffect(() => {
    fetchData(modelVersion);
  }, [fetchData, modelVersion]);

  return {
    data,
    isLoading,
    error,
    fetchData,
  };
}

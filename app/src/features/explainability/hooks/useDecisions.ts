/**
 * @file useDecisions.ts
 * @description React hook for managing AI decisions
 * @feature explainability
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useExplainabilityStore,
  selectDecisions,
  selectSelectedDecision,
  selectFormattedExplanation,
  selectPagination,
  selectIsLoading,
  selectIsLoadingExplanation,
  selectError,
} from '../store';
import type { DecisionType, DecisionExplanation, FormattedExplanation } from '../types';

export interface UseDecisionsOptions {
  robotId?: string;
  decisionType?: DecisionType;
  autoFetch?: boolean;
}

export interface UseDecisionsReturn {
  decisions: DecisionExplanation[];
  selectedDecision: DecisionExplanation | null;
  formattedExplanation: FormattedExplanation | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  isLoading: boolean;
  isLoadingExplanation: boolean;
  error: string | null;
  fetchDecisions: (page?: number) => Promise<void>;
  selectDecision: (id: string) => Promise<void>;
  fetchExplanation: (id: string) => Promise<void>;
  clearSelection: () => void;
}

/**
 * Hook for fetching and managing AI decisions
 *
 * @example
 * ```tsx
 * const { decisions, isLoading, fetchDecisions } = useDecisions({ autoFetch: true });
 * ```
 */
export function useDecisions(options: UseDecisionsOptions = {}): UseDecisionsReturn {
  const { robotId, decisionType, autoFetch = false } = options;

  const decisions = useExplainabilityStore(selectDecisions);
  const selectedDecision = useExplainabilityStore(selectSelectedDecision);
  const formattedExplanation = useExplainabilityStore(selectFormattedExplanation);
  const pagination = useExplainabilityStore(selectPagination);
  const isLoading = useExplainabilityStore(selectIsLoading);
  const isLoadingExplanation = useExplainabilityStore(selectIsLoadingExplanation);
  const error = useExplainabilityStore(selectError);

  const storeFetchDecisions = useExplainabilityStore((state) => state.fetchDecisions);
  const storeFetchDecision = useExplainabilityStore((state) => state.fetchDecision);
  const storeFetchExplanation = useExplainabilityStore((state) => state.fetchExplanation);
  const storeClearSelection = useExplainabilityStore((state) => state.clearSelectedDecision);

  const fetchDecisions = useCallback(
    async (page?: number) => {
      await storeFetchDecisions({
        page: page ?? 1,
        robotId,
        decisionType,
      });
    },
    [storeFetchDecisions, robotId, decisionType]
  );

  const selectDecision = useCallback(
    async (id: string) => {
      await storeFetchDecision(id);
    },
    [storeFetchDecision]
  );

  const fetchExplanation = useCallback(
    async (id: string) => {
      await storeFetchExplanation(id);
    },
    [storeFetchExplanation]
  );

  const clearSelection = useCallback(() => {
    storeClearSelection();
  }, [storeClearSelection]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchDecisions();
    }
  }, [autoFetch, fetchDecisions]);

  return useMemo(
    () => ({
      decisions,
      selectedDecision,
      formattedExplanation,
      pagination,
      isLoading,
      isLoadingExplanation,
      error,
      fetchDecisions,
      selectDecision,
      fetchExplanation,
      clearSelection,
    }),
    [
      decisions,
      selectedDecision,
      formattedExplanation,
      pagination,
      isLoading,
      isLoadingExplanation,
      error,
      fetchDecisions,
      selectDecision,
      fetchExplanation,
      clearSelection,
    ]
  );
}

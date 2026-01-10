/**
 * @file useMetrics.ts
 * @description React hook for managing AI performance metrics
 * @feature explainability
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useExplainabilityStore,
  selectMetrics,
  selectIsLoadingMetrics,
  selectError,
} from '../store';
import type { MetricsPeriod, AIPerformanceMetrics } from '../types';

export interface UseMetricsOptions {
  period?: MetricsPeriod;
  robotId?: string;
  autoFetch?: boolean;
}

export interface UseMetricsReturn {
  metrics: AIPerformanceMetrics | null;
  isLoading: boolean;
  error: string | null;
  fetchMetrics: (period?: MetricsPeriod, robotId?: string) => Promise<void>;
}

/**
 * Hook for fetching AI performance metrics
 *
 * @example
 * ```tsx
 * const { metrics, isLoading, fetchMetrics } = useMetrics({
 *   period: 'weekly',
 *   autoFetch: true
 * });
 * ```
 */
export function useMetrics(options: UseMetricsOptions = {}): UseMetricsReturn {
  const { period = 'weekly', robotId, autoFetch = false } = options;

  const metrics = useExplainabilityStore(selectMetrics);
  const isLoading = useExplainabilityStore(selectIsLoadingMetrics);
  const error = useExplainabilityStore(selectError);

  const storeFetchMetrics = useExplainabilityStore((state) => state.fetchMetrics);

  const fetchMetrics = useCallback(
    async (fetchPeriod?: MetricsPeriod, fetchRobotId?: string) => {
      await storeFetchMetrics(fetchPeriod ?? period, fetchRobotId ?? robotId);
    },
    [storeFetchMetrics, period, robotId]
  );

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchMetrics();
    }
  }, [autoFetch, fetchMetrics]);

  return useMemo(
    () => ({
      metrics,
      isLoading,
      error,
      fetchMetrics,
    }),
    [metrics, isLoading, error, fetchMetrics]
  );
}

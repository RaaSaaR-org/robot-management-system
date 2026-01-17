/**
 * @file useDeploymentMetrics.ts
 * @description React hook for deployment metrics polling
 * @feature deployment
 */

import { useCallback, useEffect, useRef, useMemo } from 'react';
import { useDeploymentStore, selectMetricsForDeployment } from '../store';
import type { AggregatedDeploymentMetrics } from '../types';

const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds

export interface UseDeploymentMetricsReturn {
  metrics: AggregatedDeploymentMetrics | undefined;
  isLoading: boolean;
  isPolling: boolean;
  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

/**
 * Hook for polling deployment metrics
 */
export function useDeploymentMetrics(
  deploymentId: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL
): UseDeploymentMetricsReturn {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);

  const metrics = useDeploymentStore(selectMetricsForDeployment(deploymentId));
  const fetchMetrics = useDeploymentStore((state) => state.fetchDeploymentMetrics);

  const refresh = useCallback(async () => {
    await fetchMetrics(deploymentId);
  }, [deploymentId, fetchMetrics]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    isPollingRef.current = true;
    refresh(); // Initial fetch

    intervalRef.current = setInterval(() => {
      refresh();
    }, pollInterval);
  }, [refresh, pollInterval]);

  const stopPolling = useCallback(() => {
    isPollingRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return useMemo(
    () => ({
      metrics,
      isLoading: !metrics && isPollingRef.current,
      isPolling: isPollingRef.current,
      refresh,
      startPolling,
      stopPolling,
    }),
    [metrics, refresh, startPolling, stopPolling]
  );
}

/**
 * Hook for auto-polling deployment metrics on mount
 */
export function useDeploymentMetricsAutoPolling(
  deploymentId: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL
): UseDeploymentMetricsReturn {
  const result = useDeploymentMetrics(deploymentId, pollInterval);
  const { startPolling, stopPolling } = result;

  useEffect(() => {
    startPolling();
    return () => {
      stopPolling();
    };
  }, [deploymentId, startPolling, stopPolling]);

  return result;
}

/**
 * @file useGpuAvailability.ts
 * @description React hook for GPU availability and queue stats
 * @feature training
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useTrainingStore,
  selectGpuAvailability,
  selectGpuLoading,
  selectQueueStats,
  selectQueueLoading,
} from '../store';
import type { GpuAvailability, QueueStats } from '../types';

export interface UseGpuAvailabilityReturn {
  gpuAvailability: GpuAvailability | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook for accessing GPU availability
 */
export function useGpuAvailability(): UseGpuAvailabilityReturn {
  const gpuAvailability = useTrainingStore(selectGpuAvailability);
  const isLoading = useTrainingStore(selectGpuLoading);

  const storeFetch = useTrainingStore((state) => state.fetchGpuAvailability);

  const refresh = useCallback(async () => {
    await storeFetch();
  }, [storeFetch]);

  return useMemo(
    () => ({
      gpuAvailability,
      isLoading,
      refresh,
    }),
    [gpuAvailability, isLoading, refresh]
  );
}

export interface UseQueueStatsReturn {
  queueStats: QueueStats | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook for accessing queue statistics
 */
export function useQueueStats(): UseQueueStatsReturn {
  const queueStats = useTrainingStore(selectQueueStats);
  const isLoading = useTrainingStore(selectQueueLoading);

  const storeFetch = useTrainingStore((state) => state.fetchQueueStats);

  const refresh = useCallback(async () => {
    await storeFetch();
  }, [storeFetch]);

  return useMemo(
    () => ({
      queueStats,
      isLoading,
      refresh,
    }),
    [queueStats, isLoading, refresh]
  );
}

/**
 * Hook for auto-fetching GPU availability on mount with optional polling
 */
export function useGpuAvailabilityAutoFetch(pollInterval?: number): UseGpuAvailabilityReturn {
  const result = useGpuAvailability();
  const { refresh } = result;

  useEffect(() => {
    refresh();

    if (pollInterval && pollInterval > 0) {
      const interval = setInterval(() => {
        refresh();
      }, pollInterval);

      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollInterval]);

  return result;
}

/**
 * Hook for auto-fetching queue stats on mount with optional polling
 */
export function useQueueStatsAutoFetch(pollInterval?: number): UseQueueStatsReturn {
  const result = useQueueStats();
  const { refresh } = result;

  useEffect(() => {
    refresh();

    if (pollInterval && pollInterval > 0) {
      const interval = setInterval(() => {
        refresh();
      }, pollInterval);

      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollInterval]);

  return result;
}

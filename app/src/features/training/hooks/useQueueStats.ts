/**
 * @file useQueueStats.ts
 * @description React hook for training queue statistics
 * @feature training
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useTrainingStore,
  selectQueueStats,
  selectQueueLoading,
} from '../store';
import type { QueueStats } from '../types';

export interface UseQueueStatsReturn {
  queueStats: QueueStats | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useQueueStats(): UseQueueStatsReturn {
  const queueStats = useTrainingStore(selectQueueStats);
  const isLoading = useTrainingStore(selectQueueLoading);
  const storeFetch = useTrainingStore((state) => state.fetchQueueStats);

  const refresh = useCallback(async () => {
    await storeFetch();
  }, [storeFetch]);

  return useMemo(
    () => ({ queueStats, isLoading, refresh }),
    [queueStats, isLoading, refresh]
  );
}

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

/**
 * @file useWorkers.ts
 * @description React hook for the training worker registry
 * @feature training
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useTrainingStore,
  selectWorkers,
  selectWorkersLoading,
} from '../store';
import type { WorkerStatusListResponse } from '../types';

export interface UseWorkersReturn {
  workers: WorkerStatusListResponse | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook for accessing the training worker registry.
 * Backed by GET /api/training/workers (TASK-145).
 */
export function useWorkers(): UseWorkersReturn {
  const workers = useTrainingStore(selectWorkers);
  const isLoading = useTrainingStore(selectWorkersLoading);
  const storeFetch = useTrainingStore((state) => state.fetchWorkers);

  const refresh = useCallback(async () => {
    await storeFetch();
  }, [storeFetch]);

  return useMemo(
    () => ({ workers, isLoading, refresh }),
    [workers, isLoading, refresh]
  );
}

/**
 * Auto-fetching variant. Polls every `pollInterval` ms (default: no polling).
 * The training worker heartbeats every 30s; polling at 10s lets the
 * staleness window flip from busy → stale within ~70s of a worker dying.
 */
export function useWorkersAutoFetch(pollInterval?: number): UseWorkersReturn {
  const result = useWorkers();
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

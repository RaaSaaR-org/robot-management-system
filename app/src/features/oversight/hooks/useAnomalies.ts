/**
 * @file useAnomalies.ts
 * @description Hook for anomaly management
 * @feature oversight
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useOversightStore,
  selectAnomalies,
  selectActiveAnomalies,
  selectAnomaliesLoading,
  selectAnomaliesTotal,
} from '../store';
import type { AnomalyRecord, AnomalyQueryParams } from '../types';

export interface UseAnomaliesOptions {
  robotId?: string;
  activeOnly?: boolean;
  autoFetch?: boolean;
}

export interface UseAnomaliesReturn {
  anomalies: AnomalyRecord[];
  activeAnomalies: AnomalyRecord[];
  total: number;
  isLoading: boolean;
  isAcknowledging: boolean;
  isResolving: boolean;
  error: string | null;
  criticalCount: number;
  highCount: number;
  unacknowledgedCount: number;
  fetchAnomalies: (params?: AnomalyQueryParams) => Promise<void>;
  fetchActiveAnomalies: (robotId?: string) => Promise<void>;
  acknowledgeAnomaly: (anomalyId: string) => Promise<void>;
  resolveAnomaly: (anomalyId: string, resolution: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing anomalies
 */
export function useAnomalies(options: UseAnomaliesOptions = {}): UseAnomaliesReturn {
  const { robotId, activeOnly = false, autoFetch = false } = options;

  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anomalies = useOversightStore(selectAnomalies);
  const activeAnomalies = useOversightStore(selectActiveAnomalies);
  const isLoading = useOversightStore(selectAnomaliesLoading);
  const total = useOversightStore(selectAnomaliesTotal);

  const storeFetchAnomalies = useOversightStore((state) => state.fetchAnomalies);
  const storeFetchActiveAnomalies = useOversightStore((state) => state.fetchActiveAnomalies);
  const storeAcknowledge = useOversightStore((state) => state.acknowledgeAnomaly);
  const storeResolve = useOversightStore((state) => state.resolveAnomaly);

  const fetchAnomalies = useCallback(
    async (params?: AnomalyQueryParams) => {
      const queryParams = { ...params };
      if (robotId) queryParams.robotId = robotId;
      if (activeOnly) queryParams.isActive = true;
      await storeFetchAnomalies(queryParams);
    },
    [storeFetchAnomalies, robotId, activeOnly]
  );

  const fetchActiveAnomalies = useCallback(
    async (id?: string) => {
      await storeFetchActiveAnomalies(id ?? robotId);
    },
    [storeFetchActiveAnomalies, robotId]
  );

  const acknowledgeAnomaly = useCallback(
    async (anomalyId: string) => {
      setIsAcknowledging(true);
      setError(null);

      try {
        await storeAcknowledge(anomalyId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to acknowledge anomaly';
        setError(message);
        throw err;
      } finally {
        setIsAcknowledging(false);
      }
    },
    [storeAcknowledge]
  );

  const resolveAnomaly = useCallback(
    async (anomalyId: string, resolution: string) => {
      setIsResolving(true);
      setError(null);

      try {
        await storeResolve(anomalyId, resolution);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to resolve anomaly';
        setError(message);
        throw err;
      } finally {
        setIsResolving(false);
      }
    },
    [storeResolve]
  );

  const refresh = useCallback(async () => {
    if (activeOnly) {
      await fetchActiveAnomalies();
    } else {
      await fetchAnomalies();
    }
  }, [activeOnly, fetchAnomalies, fetchActiveAnomalies]);

  // Computed counts
  const criticalCount = useMemo(() => {
    return activeAnomalies.filter((a) => a.severity === 'critical').length;
  }, [activeAnomalies]);

  const highCount = useMemo(() => {
    return activeAnomalies.filter((a) => a.severity === 'high').length;
  }, [activeAnomalies]);

  const unacknowledgedCount = useMemo(() => {
    return activeAnomalies.filter((a) => !a.acknowledgedAt).length;
  }, [activeAnomalies]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, refresh]);

  return useMemo(
    () => ({
      anomalies,
      activeAnomalies,
      total,
      isLoading,
      isAcknowledging,
      isResolving,
      error,
      criticalCount,
      highCount,
      unacknowledgedCount,
      fetchAnomalies,
      fetchActiveAnomalies,
      acknowledgeAnomaly,
      resolveAnomaly,
      refresh,
    }),
    [
      anomalies,
      activeAnomalies,
      total,
      isLoading,
      isAcknowledging,
      isResolving,
      error,
      criticalCount,
      highCount,
      unacknowledgedCount,
      fetchAnomalies,
      fetchActiveAnomalies,
      acknowledgeAnomaly,
      resolveAnomaly,
      refresh,
    ]
  );
}

/**
 * @file useDeployment.ts
 * @description React hook for single deployment detail operations
 * @feature deployment
 */

import { useCallback, useMemo, useEffect, useState } from 'react';
import { useDeploymentStore, selectDeploymentById, selectMetricsForDeployment } from '../store';
import type {
  Deployment,
  DeploymentResponse,
  AggregatedDeploymentMetrics,
} from '../types';

export interface UseDeploymentReturn {
  deployment: Deployment | undefined;
  metrics: AggregatedDeploymentMetrics | undefined;
  currentStage: number;
  totalStages: number;
  eligibleRobotCount: number;
  deployedCount: number;
  failedCount: number;
  nextStageTime: string | undefined;
  isLoading: boolean;
  error: string | null;
  fetchDeployment: () => Promise<void>;
  startDeployment: () => Promise<void>;
  advanceStage: () => Promise<void>;
  promote: () => Promise<void>;
  rollback: (reason: string) => Promise<void>;
  cancel: () => Promise<void>;
  promoteDeployment: () => Promise<void>;
  rollbackDeployment: (reason: string) => Promise<void>;
  cancelDeployment: () => Promise<void>;
  refreshMetrics: () => Promise<void>;
}

/**
 * Hook for accessing a single deployment detail
 */
export function useDeployment(deploymentId: string): UseDeploymentReturn {
  const [detailData, setDetailData] = useState<Omit<DeploymentResponse, 'deployment' | 'metrics'>>({
    currentStage: 0,
    totalStages: 0,
    eligibleRobotCount: 0,
    deployedCount: 0,
    failedCount: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deployment = useDeploymentStore(selectDeploymentById(deploymentId));
  const metrics = useDeploymentStore(selectMetricsForDeployment(deploymentId));

  const storeFetchDeployment = useDeploymentStore((state) => state.fetchDeployment);
  const storeFetchMetrics = useDeploymentStore((state) => state.fetchDeploymentMetrics);
  const storeStartDeployment = useDeploymentStore((state) => state.startDeployment);
  const storeAdvanceStage = useDeploymentStore((state) => state.advanceStage);
  const storePromoteDeployment = useDeploymentStore((state) => state.promoteDeployment);
  const storeRollbackDeployment = useDeploymentStore((state) => state.rollbackDeployment);
  const storeCancelDeployment = useDeploymentStore((state) => state.cancelDeployment);

  const fetchDeployment = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await storeFetchDeployment(deploymentId);
      setDetailData({
        currentStage: response.currentStage,
        totalStages: response.totalStages,
        eligibleRobotCount: response.eligibleRobotCount,
        deployedCount: response.deployedCount,
        failedCount: response.failedCount,
        nextStageTime: response.nextStageTime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch deployment');
    } finally {
      setIsLoading(false);
    }
  }, [deploymentId, storeFetchDeployment]);

  const refreshMetrics = useCallback(async () => {
    await storeFetchMetrics(deploymentId);
  }, [deploymentId, storeFetchMetrics]);

  const startDeployment = useCallback(async () => {
    await storeStartDeployment(deploymentId);
    await fetchDeployment();
  }, [deploymentId, storeStartDeployment, fetchDeployment]);

  const advanceStage = useCallback(async () => {
    await storeAdvanceStage(deploymentId);
    await fetchDeployment();
  }, [deploymentId, storeAdvanceStage, fetchDeployment]);

  const promoteDeployment = useCallback(async () => {
    await storePromoteDeployment(deploymentId);
    await fetchDeployment();
  }, [deploymentId, storePromoteDeployment, fetchDeployment]);

  const rollbackDeployment = useCallback(
    async (reason: string) => {
      await storeRollbackDeployment(deploymentId, reason);
      await fetchDeployment();
    },
    [deploymentId, storeRollbackDeployment, fetchDeployment]
  );

  const cancelDeployment = useCallback(async () => {
    await storeCancelDeployment(deploymentId);
    await fetchDeployment();
  }, [deploymentId, storeCancelDeployment, fetchDeployment]);

  return useMemo(
    () => ({
      deployment,
      metrics,
      currentStage: detailData.currentStage,
      totalStages: detailData.totalStages,
      eligibleRobotCount: detailData.eligibleRobotCount,
      deployedCount: detailData.deployedCount,
      failedCount: detailData.failedCount,
      nextStageTime: detailData.nextStageTime,
      isLoading,
      error,
      fetchDeployment,
      startDeployment,
      advanceStage,
      promote: promoteDeployment,
      rollback: rollbackDeployment,
      cancel: cancelDeployment,
      promoteDeployment,
      rollbackDeployment,
      cancelDeployment,
      refreshMetrics,
    }),
    [
      deployment,
      metrics,
      detailData,
      isLoading,
      error,
      fetchDeployment,
      startDeployment,
      advanceStage,
      promoteDeployment,
      rollbackDeployment,
      cancelDeployment,
      refreshMetrics,
    ]
  );
}

/**
 * Hook for auto-fetching deployment on mount
 */
export function useDeploymentAutoFetch(deploymentId: string): UseDeploymentReturn {
  const result = useDeployment(deploymentId);
  const { fetchDeployment } = result;

  useEffect(() => {
    fetchDeployment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]);

  return result;
}

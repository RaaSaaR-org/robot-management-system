/**
 * @file useDeployments.ts
 * @description React hook for deployment operations
 * @feature deployment
 */

import { useMemo, useEffect } from 'react';
import {
  useDeploymentStore,
  selectDeployments,
  selectDeploymentsLoading,
  selectDeploymentsError,
  selectDeploymentsPagination,
  selectDeploymentFilters,
  selectSelectedDeployment,
} from '../store';
import type {
  Deployment,
  CreateDeploymentInput,
  DeploymentQueryParams,
  DeploymentFilters,
  PaginationInfo,
} from '../types';

export interface UseDeploymentsReturn {
  deployments: Deployment[];
  activeDeployments: Deployment[];
  completedDeployments: Deployment[];
  selectedDeployment: Deployment | undefined;
  isLoading: boolean;
  error: string | null;
  pagination: PaginationInfo;
  filters: DeploymentFilters;
  fetchDeployments: (params?: DeploymentQueryParams) => Promise<void>;
  fetchActiveDeployments: () => Promise<void>;
  createDeployment: (input: CreateDeploymentInput) => Promise<Deployment>;
  startDeployment: (id: string) => Promise<void>;
  advanceStage: (id: string) => Promise<void>;
  promoteDeployment: (id: string) => Promise<void>;
  rollback: (id: string, reason: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  rollbackDeployment: (id: string, reason: string) => Promise<void>;
  cancelDeployment: (id: string) => Promise<void>;
  selectDeployment: (id: string | null) => void;
  setFilters: (filters: Partial<DeploymentFilters>) => void;
}

/**
 * Hook for accessing deployments list
 */
export function useDeployments(): UseDeploymentsReturn {
  // Select state values
  const deployments = useDeploymentStore(selectDeployments);
  const isLoading = useDeploymentStore(selectDeploymentsLoading);
  const error = useDeploymentStore(selectDeploymentsError);
  const pagination = useDeploymentStore(selectDeploymentsPagination);
  const filters = useDeploymentStore(selectDeploymentFilters);
  const selectedDeployment = useDeploymentStore(selectSelectedDeployment);

  // Select actions directly from store
  const fetchDeployments = useDeploymentStore((s) => s.fetchDeployments);
  const fetchActiveDeployments = useDeploymentStore((s) => s.fetchActiveDeployments);
  const createDeployment = useDeploymentStore((s) => s.createDeployment);
  const startDeployment = useDeploymentStore((s) => s.startDeployment);
  const advanceStage = useDeploymentStore((s) => s.advanceStage);
  const promoteDeployment = useDeploymentStore((s) => s.promoteDeployment);
  const rollbackDeployment = useDeploymentStore((s) => s.rollbackDeployment);
  const cancelDeployment = useDeploymentStore((s) => s.cancelDeployment);
  const selectDeploymentAction = useDeploymentStore((s) => s.selectDeployment);
  const setFilters = useDeploymentStore((s) => s.setDeploymentFilters);

  // Compute derived state with useMemo
  const activeDeployments = useMemo(
    () => deployments.filter(
      (d) => d.status === 'pending' || d.status === 'deploying' || d.status === 'canary'
    ),
    [deployments]
  );

  const completedDeployments = useMemo(
    () => deployments.filter(
      (d) => d.status === 'production' || d.status === 'failed'
    ),
    [deployments]
  );

  return {
    deployments,
    activeDeployments,
    completedDeployments,
    selectedDeployment: selectedDeployment || undefined,
    isLoading,
    error,
    pagination,
    filters,
    fetchDeployments,
    fetchActiveDeployments,
    createDeployment,
    startDeployment,
    advanceStage,
    promoteDeployment,
    rollback: rollbackDeployment,
    cancel: cancelDeployment,
    rollbackDeployment,
    cancelDeployment,
    selectDeployment: selectDeploymentAction,
    setFilters,
  };
}

/**
 * Hook for auto-fetching deployments on mount
 */
export function useDeploymentsAutoFetch(params?: DeploymentQueryParams): UseDeploymentsReturn {
  const result = useDeployments();
  const { fetchDeployments } = result;

  useEffect(() => {
    fetchDeployments(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}

/**
 * @file useModelVersions.ts
 * @description React hook for model version selection (deployment)
 * @feature deployment
 */

import { useEffect } from 'react';
import {
  useDeploymentStore,
  selectModelVersions,
  selectModelVersionsLoading,
  selectStagingVersions,
  selectProductionVersions,
} from '../store';
import type { ModelVersion } from '../types';

export interface UseModelVersionsReturn {
  modelVersions: ModelVersion[];
  versions: ModelVersion[];
  stagingVersions: ModelVersion[];
  productionVersions: ModelVersion[];
  isLoading: boolean;
  fetchModelVersions: (params?: { skillId?: string; deploymentStatus?: string }) => Promise<void>;
  fetchVersions: (params?: { skillId?: string; deploymentStatus?: string }) => Promise<void>;
}

/**
 * Hook for accessing model versions
 */
export function useModelVersions(): UseModelVersionsReturn {
  const versions = useDeploymentStore(selectModelVersions);
  const isLoading = useDeploymentStore(selectModelVersionsLoading);
  const stagingVersions = useDeploymentStore(selectStagingVersions);
  const productionVersions = useDeploymentStore(selectProductionVersions);
  const fetchVersions = useDeploymentStore((s) => s.fetchModelVersions);

  return {
    modelVersions: versions,
    versions,
    stagingVersions,
    productionVersions,
    isLoading,
    fetchModelVersions: fetchVersions,
    fetchVersions,
  };
}

/**
 * Hook for auto-fetching model versions on mount
 */
export function useModelVersionsAutoFetch(
  params?: { skillId?: string; deploymentStatus?: string }
): UseModelVersionsReturn {
  const result = useModelVersions();
  const { fetchVersions } = result;

  useEffect(() => {
    fetchVersions(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.skillId, params?.deploymentStatus]);

  return result;
}

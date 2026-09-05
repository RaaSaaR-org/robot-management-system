/**
 * @file useModelVersions.ts
 * @description React hook for model version selection (deployment)
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import {
  useDeploymentStore,
  selectModelVersions,
  selectModelVersionsLoading,
  selectStagingVersions,
  selectProductionVersions,
} from '../store';
import { deploymentApi } from '../api';
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
 * Look up a model version already in the store. Returns null when the id is
 * unset or the list has not been fetched — callers render a fallback rather
 * than a request per card. (TASK-238)
 */
export function useModelVersionFromStore(id?: string | null): ModelVersion | null {
  const versions = useDeploymentStore(selectModelVersions);
  if (!id) return null;
  return versions.find((v) => v.id === id) ?? null;
}

/**
 * Resolve a single model version by id, fetching it when the store does not
 * already hold it.
 *
 * The Skill Library shows a linked model's name on every skill card, and the
 * skills endpoint does not populate the relation — so the id has to be
 * resolved on its own. Results are cached per id for the life of the tab so a
 * page of skills pointing at the same model issues one request. (TASK-238)
 */
const modelVersionCache = new Map<string, Promise<ModelVersion | null>>();

export function useModelVersionById(id?: string | null): ModelVersion | null {
  const fromStore = useModelVersionFromStore(id);
  const [fetched, setFetched] = useState<ModelVersion | null>(null);

  useEffect(() => {
    if (!id || fromStore) return;

    let cancelled = false;
    let pending = modelVersionCache.get(id);
    if (!pending) {
      pending = deploymentApi.getModelVersion(id).catch(() => null);
      modelVersionCache.set(id, pending);
    }
    void pending.then((version) => {
      if (!cancelled) setFetched(version);
    });

    return () => {
      cancelled = true;
    };
  }, [id, fromStore]);

  return fromStore ?? fetched;
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

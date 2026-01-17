/**
 * @file useModels.ts
 * @description React hook for MLflow model registry operations
 * @feature training
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useTrainingStore,
  selectRegisteredModels,
  selectModelsLoading,
  selectSelectedModel,
  selectModelVersions,
  selectModelComparison,
} from '../store';
import type { RegisteredModel, ModelVersion, RunComparison } from '../types';

export interface UseModelsReturn {
  models: RegisteredModel[];
  isLoading: boolean;
  error: string | null;
  selectedModel: RegisteredModel | null;
  modelVersions: ModelVersion[];
  comparison: RunComparison | null;
  fetchModels: () => Promise<void>;
  fetchModelVersions: (modelName: string) => Promise<void>;
  selectModel: (model: RegisteredModel | null) => void;
  compareRuns: (runIds: string[]) => Promise<void>;
  promoteVersion: (modelName: string, version: string, stage: string) => Promise<void>;
}

/**
 * Hook for accessing MLflow model registry
 *
 * @example
 * ```tsx
 * function ModelsPage() {
 *   const { models, isLoading, fetchModels } = useModels();
 *
 *   useEffect(() => {
 *     fetchModels();
 *   }, [fetchModels]);
 *
 *   return <ModelList models={models} isLoading={isLoading} />;
 * }
 * ```
 */
export function useModels(): UseModelsReturn {
  const models = useTrainingStore(selectRegisteredModels);
  const isLoading = useTrainingStore(selectModelsLoading);
  const selectedModel = useTrainingStore(selectSelectedModel);
  const modelVersions = useTrainingStore(selectModelVersions);
  const comparison = useTrainingStore(selectModelComparison);

  const storeFetchModels = useTrainingStore((state) => state.fetchRegisteredModels);
  const storeFetchVersions = useTrainingStore((state) => state.fetchModelVersions);
  const storeSelectModel = useTrainingStore((state) => state.selectModel);
  const storeCompareRuns = useTrainingStore((state) => state.compareRuns);
  const storePromoteVersion = useTrainingStore((state) => state.promoteModelVersion);

  const fetchModels = useCallback(async () => {
    await storeFetchModels();
  }, [storeFetchModels]);

  const fetchModelVersions = useCallback(
    async (modelName: string) => {
      await storeFetchVersions(modelName);
    },
    [storeFetchVersions]
  );

  const selectModel = useCallback(
    (model: RegisteredModel | null) => {
      storeSelectModel(model);
    },
    [storeSelectModel]
  );

  const compareRuns = useCallback(
    async (runIds: string[]) => {
      await storeCompareRuns(runIds);
    },
    [storeCompareRuns]
  );

  const promoteVersion = useCallback(
    async (modelName: string, version: string, stage: string) => {
      await storePromoteVersion(modelName, version, stage);
    },
    [storePromoteVersion]
  );

  return useMemo(
    () => ({
      models,
      isLoading,
      error: null,
      selectedModel,
      modelVersions,
      comparison,
      fetchModels,
      fetchModelVersions,
      selectModel,
      compareRuns,
      promoteVersion,
    }),
    [
      models,
      isLoading,
      selectedModel,
      modelVersions,
      comparison,
      fetchModels,
      fetchModelVersions,
      selectModel,
      compareRuns,
      promoteVersion,
    ]
  );
}

/**
 * Hook for auto-fetching models on mount
 */
export function useModelsAutoFetch(): UseModelsReturn {
  const result = useModels();
  const { fetchModels } = result;

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}

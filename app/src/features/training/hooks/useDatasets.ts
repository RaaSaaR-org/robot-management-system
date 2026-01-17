/**
 * @file useDatasets.ts
 * @description React hook for dataset operations
 * @feature training
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useTrainingStore,
  selectDatasets,
  selectDatasetsLoading,
  selectDatasetsError,
  selectDatasetsPagination,
} from '../store';
import type { CreateDatasetInput, DatasetQueryParams, Dataset } from '../types';

export interface UseDatasetReturn {
  datasets: Dataset[];
  readyDatasets: Dataset[];
  isLoading: boolean;
  error: string | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  fetchDatasets: (params?: DatasetQueryParams) => Promise<void>;
  createDataset: (input: CreateDatasetInput) => Promise<Dataset>;
  deleteDataset: (id: string) => Promise<void>;
  setFilters: (filters: Partial<DatasetQueryParams>) => void;
}

/**
 * Hook for accessing dataset state and operations
 *
 * @example
 * ```tsx
 * function DatasetsPage() {
 *   const { datasets, isLoading, fetchDatasets } = useDatasets();
 *
 *   useEffect(() => {
 *     fetchDatasets();
 *   }, [fetchDatasets]);
 *
 *   return <DatasetList datasets={datasets} isLoading={isLoading} />;
 * }
 * ```
 */
export function useDatasets(): UseDatasetReturn {
  const datasets = useTrainingStore(selectDatasets);
  const isLoading = useTrainingStore(selectDatasetsLoading);
  const error = useTrainingStore(selectDatasetsError);
  const pagination = useTrainingStore(selectDatasetsPagination);

  // Compute derived state with useMemo to avoid creating new arrays on every render
  const readyDatasets = useMemo(
    () => datasets.filter((d) => d.status === 'ready'),
    [datasets]
  );

  const storeFetchDatasets = useTrainingStore((state) => state.fetchDatasets);
  const storeCreateDataset = useTrainingStore((state) => state.createDataset);
  const storeDeleteDataset = useTrainingStore((state) => state.deleteDataset);
  const storeSetFilters = useTrainingStore((state) => state.setDatasetFilters);

  const fetchDatasets = useCallback(
    async (params?: DatasetQueryParams) => {
      await storeFetchDatasets(params);
    },
    [storeFetchDatasets]
  );

  const createDataset = useCallback(
    async (input: CreateDatasetInput) => {
      return await storeCreateDataset(input);
    },
    [storeCreateDataset]
  );

  const deleteDataset = useCallback(
    async (id: string) => {
      await storeDeleteDataset(id);
    },
    [storeDeleteDataset]
  );

  const setFilters = useCallback(
    (filters: Partial<DatasetQueryParams>) => {
      storeSetFilters(filters);
    },
    [storeSetFilters]
  );

  return useMemo(
    () => ({
      datasets,
      readyDatasets,
      isLoading,
      error,
      pagination,
      fetchDatasets,
      createDataset,
      deleteDataset,
      setFilters,
    }),
    [
      datasets,
      readyDatasets,
      isLoading,
      error,
      pagination,
      fetchDatasets,
      createDataset,
      deleteDataset,
      setFilters,
    ]
  );
}

/**
 * Hook for auto-fetching datasets on mount
 */
export function useDatasetsAutoFetch(params?: DatasetQueryParams): UseDatasetReturn {
  const result = useDatasets();
  const { fetchDatasets } = result;

  useEffect(() => {
    fetchDatasets(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}

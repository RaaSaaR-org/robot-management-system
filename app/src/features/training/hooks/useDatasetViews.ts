/**
 * @file useDatasetViews.ts
 * @description Views derived from one dataset, and the three things you can do
 *   to one (TASK-240).
 * @feature training
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '@/shared/utils';
import { datasetViewsApi } from '../api/datasetViewsApi';
import type { CreateDatasetViewInput, DatasetViewSummary } from '../types';

export interface UseDatasetViewsReturn {
  views: DatasetViewSummary[];
  isLoading: boolean;
  /** Why the last list/create/delete/materialize did not happen. */
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  createView: (input: CreateDatasetViewInput) => Promise<DatasetViewSummary>;
  deleteView: (viewId: string) => Promise<void>;
  /** Resolves to the directory the bytes were written to, when the server says. */
  materializeView: (viewId: string) => Promise<string | null>;
}

/**
 * Load and mutate the views derived from `datasetId`.
 *
 * Pass `undefined` while the id is still unknown (a route param mid-resolve)
 * and nothing is fetched.
 */
export function useDatasetViews(datasetId: string | undefined): UseDatasetViewsReturn {
  const [views, setViews] = useState<DatasetViewSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!datasetId) return;
    setIsLoading(true);
    try {
      setViews(await datasetViewsApi.listViews(datasetId));
      setError(null);
    } catch (err) {
      // A dataset with no views and a server that could not answer look the
      // same in an empty list, so the reason has to be said out loud.
      setError(getErrorMessage(err, 'Could not load the views of this dataset'));
    } finally {
      setIsLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    let cancelled = false;
    if (!datasetId) {
      setViews([]);
      return;
    }
    setIsLoading(true);
    datasetViewsApi
      .listViews(datasetId)
      .then((rows) => {
        if (cancelled) return;
        setViews(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Could not load the views of this dataset'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      // A slow answer for the previous dataset must not land on this one.
      cancelled = true;
    };
  }, [datasetId]);

  const createView = useCallback(
    async (input: CreateDatasetViewInput): Promise<DatasetViewSummary> => {
      if (!datasetId) throw new Error('No dataset to create a view of');
      const created = await datasetViewsApi.createView(datasetId, input);
      setViews((prev) => [created, ...prev]);
      setError(null);
      return created;
    },
    [datasetId],
  );

  const deleteView = useCallback(async (viewId: string): Promise<void> => {
    // Deliberately not optimistic: the server answers 409 for a frozen view
    // and the whole point of that answer is that the row is still there.
    await datasetViewsApi.deleteView(viewId);
    setViews((prev) => prev.filter((view) => view.id !== viewId));
  }, []);

  const materializeView = useCallback(async (viewId: string): Promise<string | null> => {
    const materializedPath = await datasetViewsApi.materializeView(viewId);
    // Patch the one field the answer changes rather than refetching the list:
    // materializing writes bytes, it does not re-select episodes.
    setViews((prev) =>
      prev.map((view) => (view.id === viewId ? { ...view, materializedPath } : view)),
    );
    return materializedPath;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ views, isLoading, error, clearError, refresh, createView, deleteView, materializeView }),
    [views, isLoading, error, clearError, refresh, createView, deleteView, materializeView],
  );
}

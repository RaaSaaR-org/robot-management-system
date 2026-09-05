/**
 * @file datasetViewsApi.ts
 * @description API calls for dataset views — forks that select episodes
 *   instead of copying bytes (TASK-240).
 * @feature training
 *
 * Only the create/list/materialize/delete endpoints live here. The server's
 * `from-flags` and `from-rewards` conveniences are for callers that cannot see
 * the evidence; this UI can — the episode page already holds every flag and
 * every reward score — so it resolves the selection there and posts it, which
 * is what "stored resolved, never a live query" means from the client side.
 */

import { apiClient } from '@/api/client';
import type { CreateDatasetViewInput, DatasetViewSummary } from '../types';

const ENDPOINTS = {
  /** Views derived from one dataset — create (POST) and list (GET). */
  views: (datasetId: string) => `/datasets/${datasetId}/views`,
  /** One view, addressed without its parent. */
  view: (viewId: string) => `/datasets/views/${viewId}`,
  materialize: (viewId: string) => `/datasets/views/${viewId}/materialize`,
} as const;

/**
 * The view out of a response body that may wrap it under `view` or `dataset`.
 *
 * Both spellings exist in this API (`{ dataset }` from the dataset routes,
 * `{ view }` reads better on a view route), and a row that renders
 * `undefined.name` is a worse outcome than four characters of tolerance.
 */
function unwrapView(body: unknown): DatasetViewSummary {
  const wrapper = body as { view?: DatasetViewSummary; dataset?: DatasetViewSummary };
  return wrapper?.view ?? wrapper?.dataset ?? (body as DatasetViewSummary);
}

export const datasetViewsApi = {
  /**
   * Create a view of `datasetId` from an already-resolved selection.
   *
   * Writes no files: the new row carries an empty `storagePath` and the
   * episode list, and the bytes stay where they are.
   */
  async createView(datasetId: string, input: CreateDatasetViewInput): Promise<DatasetViewSummary> {
    const response = await apiClient.post<unknown>(ENDPOINTS.views(datasetId), input);
    return unwrapView(response.data);
  },

  /** Views derived from this dataset, newest first as the server orders them. */
  async listViews(datasetId: string): Promise<DatasetViewSummary[]> {
    const response = await apiClient.get<{
      views?: DatasetViewSummary[];
      datasets?: DatasetViewSummary[];
    }>(ENDPOINTS.views(datasetId));
    return response.data.views ?? response.data.datasets ?? [];
  },

  /**
   * Force a view onto disk. The escape hatch for a consumer that genuinely
   * cannot take an episode filter — idempotent server-side, so calling it
   * twice writes one directory.
   */
  async materializeView(viewId: string): Promise<string | null> {
    const response = await apiClient.post<{
      path?: string;
      materializedPath?: string;
      view?: { materializedPath?: string | null };
    }>(ENDPOINTS.materialize(viewId), undefined, {
      // Writing a materialized copy re-encodes video. The shared client aborts
      // at 30 s, which is shorter than any real dataset takes.
      timeout: 0,
    });
    // The server's own method answers with the directory it wrote; whichever
    // key the route puts it under, THAT string is the answer and the caller
    // only needs to know the bytes exist now.
    const body = response.data;
    return body?.path ?? body?.materializedPath ?? body?.view?.materializedPath ?? null;
  },

  /**
   * Delete a view. The server answers 409 when a training job froze it, and
   * the message names the job — surface it rather than swallowing it.
   */
  async deleteView(viewId: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.view(viewId));
  },
};

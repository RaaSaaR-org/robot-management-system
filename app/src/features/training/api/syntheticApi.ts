/**
 * @file syntheticApi.ts
 * @description API client for Cosmos 3 synthetic-episode generation (TASK-178).
 * @feature training
 */

import { apiClient } from '@/api/client';
import type {
  CosmosSyntheticConfig,
  CosmosSyntheticJob,
  GenerateSyntheticInput,
} from '../types';

const BASE = '/synthetic-cosmos';

export const syntheticApi = {
  /** Whether the generator can run and an HF PRO token is configured. */
  async getConfig(): Promise<CosmosSyntheticConfig> {
    const response = await apiClient.get<CosmosSyntheticConfig>(`${BASE}/config`);
    return response.data;
  },

  /** Start a generation job. Returns the initial job record. */
  async generate(input: GenerateSyntheticInput): Promise<CosmosSyntheticJob> {
    const response = await apiClient.post<{ job: CosmosSyntheticJob }>(
      `${BASE}/generate`,
      input,
    );
    return response.data.job;
  },

  /** Poll a single job's progress. */
  async getJob(id: string): Promise<CosmosSyntheticJob> {
    const response = await apiClient.get<{ job: CosmosSyntheticJob }>(`${BASE}/jobs/${id}`);
    return response.data.job;
  },

  /** List all generation jobs (newest first). */
  async listJobs(): Promise<CosmosSyntheticJob[]> {
    const response = await apiClient.get<{ jobs: CosmosSyntheticJob[] }>(`${BASE}/jobs`);
    return response.data.jobs;
  },

  /** Cancel a running job. */
  async cancelJob(id: string): Promise<CosmosSyntheticJob> {
    const response = await apiClient.post<{ job: CosmosSyntheticJob }>(
      `${BASE}/jobs/${id}/cancel`,
    );
    return response.data.job;
  },
};

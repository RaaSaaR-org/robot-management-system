/**
 * @file simulationApi.ts
 * @description API calls for simulation job management
 * @feature simulation
 */

import { apiClient } from '@/api/client';
import type { SimJob, SimEnvironment, SimToRealComparison, SubmitSimJobInput } from '../types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const ENDPOINTS = {
  jobs: '/simulation/jobs',
  job: (id: string) => `/simulation/jobs/${id}`,
  environments: '/simulation/environments',
  comparison: (modelId: string) => `/simulation/comparison/${modelId}`,
  frame: (jobId: string, filename: string) => `/simulation/jobs/${jobId}/frames/${filename}`,
  preview: (envId: string) => `/simulation/preview/${envId}`,
} as const;

// ============================================================================
// API MODULE
// ============================================================================

export const simulationApi = {
  /**
   * Submit a new simulation job
   */
  async submitJob(input: SubmitSimJobInput): Promise<SimJob> {
    const response = await apiClient.post<{ job: SimJob; message: string }>(
      ENDPOINTS.jobs,
      input
    );
    return response.data.job;
  },

  /**
   * List simulation jobs with optional filtering
   */
  async listJobs(params?: {
    modelId?: string;
    environment?: string;
    status?: string;
  }): Promise<SimJob[]> {
    const queryParams: Record<string, string | undefined> = {};
    if (params?.modelId) queryParams.modelId = params.modelId;
    if (params?.environment) queryParams.environment = params.environment;
    if (params?.status) queryParams.status = params.status;

    const response = await apiClient.get<{ jobs: SimJob[] }>(ENDPOINTS.jobs, {
      params: queryParams,
    });
    return response.data.jobs;
  },

  /**
   * Get a specific simulation job by ID
   */
  async getJob(jobId: string): Promise<SimJob> {
    const response = await apiClient.get<{ job: SimJob }>(ENDPOINTS.job(jobId));
    return response.data.job;
  },

  /**
   * Cancel a simulation job
   */
  async cancelJob(jobId: string): Promise<SimJob> {
    const response = await apiClient.delete<{ job: SimJob; message: string }>(
      ENDPOINTS.job(jobId)
    );
    return response.data.job;
  },

  /**
   * Get available simulation environments
   */
  async getEnvironments(): Promise<SimEnvironment[]> {
    const response = await apiClient.get<{ environments: SimEnvironment[] }>(
      ENDPOINTS.environments
    );
    return response.data.environments;
  },

  /**
   * Get sim-to-real comparison data for a model
   */
  async getComparison(modelId: string): Promise<SimToRealComparison[]> {
    const response = await apiClient.get<{ comparisons: SimToRealComparison[] }>(
      ENDPOINTS.comparison(modelId)
    );
    return response.data.comparisons;
  },

  /**
   * Get the URL for a captured simulation frame
   */
  getFrameUrl(jobId: string, filename: string): string {
    return `${API_BASE}${ENDPOINTS.frame(jobId, filename)}`;
  },

  /**
   * Get the URL for an environment preview image
   */
  getPreviewUrl(envId: string): string {
    return `${API_BASE}${ENDPOINTS.preview(envId)}`;
  },
};

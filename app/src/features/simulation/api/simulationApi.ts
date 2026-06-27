/**
 * @file simulationApi.ts
 * @description API calls for simulation job management
 * @feature simulation
 */

import { apiClient } from '@/api/client';
import type {
  SimJob,
  SimEnvironment,
  SimToRealComparison,
  SubmitSimJobInput,
  SimScene,
  SimToRealValidation,
  CreateSimValidationInput,
} from '../types';

// ============================================================================
// ENDPOINTS
// ============================================================================

// Keep in sync with the axios client (src/api/client.ts): default to a
// relative '/api' path so <img> src URLs route through the Vite proxy when
// the app is served from a different origin than the backend.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const ENDPOINTS = {
  jobs: '/simulation/jobs',
  job: (id: string) => `/simulation/jobs/${id}`,
  environments: '/simulation/environments',
  scenes: '/simulation/scenes',
  generateScene: '/simulation/scenes/generate',
  comparison: (modelId: string) => `/simulation/comparison/${modelId}`,
  validations: (modelVersionId: string) => `/simulation/validations/${modelVersionId}`,
  validationsBase: '/simulation/validations',
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
   * Get the sim-scene registry — built-in environments AND twin-derived rooms.
   */
  async getScenes(): Promise<SimScene[]> {
    const response = await apiClient.get<{ scenes: SimScene[] }>(ENDPOINTS.scenes);
    return response.data.scenes;
  },

  /**
   * Generate (or refresh) a MuJoCo sim scene for a twin from its REAL occupancy
   * floor-plan + zones, registering it as a SimScene. Works for any ready twin —
   * including those scanned without a pre-baked scene (TASK-171).
   */
  async generateTwinScene(twinId: string): Promise<SimScene> {
    const response = await apiClient.post<{ scene: SimScene }>(ENDPOINTS.generateScene, {
      twinId,
    });
    return response.data.scene;
  },

  /**
   * Get sim-to-real comparison data for a model. The server returns the REAL
   * measured gap; an empty array means "not validated against a real robot yet".
   */
  async getComparison(modelId: string): Promise<SimToRealComparison[]> {
    const response = await apiClient.get<{ comparisons: SimToRealComparison[] }>(
      ENDPOINTS.comparison(modelId)
    );
    return response.data.comparisons;
  },

  /**
   * List sim-to-real validation records for a model version.
   */
  async listValidations(modelVersionId: string): Promise<SimToRealValidation[]> {
    const response = await apiClient.get<{ validations: SimToRealValidation[] }>(
      ENDPOINTS.validations(modelVersionId)
    );
    return response.data.validations;
  },

  /**
   * Create a sim-to-real validation record.
   */
  async createValidation(input: CreateSimValidationInput): Promise<SimToRealValidation> {
    const response = await apiClient.post<{ validation: SimToRealValidation }>(
      ENDPOINTS.validationsBase,
      input
    );
    return response.data.validation;
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

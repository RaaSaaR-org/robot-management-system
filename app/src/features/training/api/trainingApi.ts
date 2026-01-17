/**
 * @file trainingApi.ts
 * @description API calls for VLA training feature
 * @feature training
 */

import { apiClient } from '@/api/client';
import type {
  Dataset,
  CreateDatasetInput,
  DatasetQueryParams,
  DatasetsListResponse,
  TrainingJob,
  SubmitTrainingJobInput,
  TrainingJobQueryParams,
  TrainingJobsListResponse,
  TrainingJobResponse,
  QueueStats,
  GpuAvailability,
  TrainingDurationEstimate,
  UploadInitiateResponse,
  RegisteredModel,
  ModelVersion,
  RunComparison,
} from '../types';

const ENDPOINTS = {
  // Datasets
  datasets: '/datasets',
  dataset: (id: string) => `/datasets/${id}`,
  datasetUploadInitiate: (id: string) => `/datasets/${id}/upload/initiate`,
  datasetUploadComplete: (id: string) => `/datasets/${id}/upload/complete`,

  // Training Jobs
  trainingJobs: '/training/jobs',
  trainingJob: (id: string) => `/training/jobs/${id}`,
  trainingJobCancel: (id: string) => `/training/jobs/${id}/cancel`,
  trainingJobRetry: (id: string) => `/training/jobs/${id}/retry`,
  trainingJobEstimate: (id: string) => `/training/jobs/${id}/estimate`,
  activeJobs: '/training/active',

  // GPU & Queue
  gpuAvailability: '/training/gpu/availability',
  queueStats: '/training/queue/stats',

  // Models (MLflow)
  modelsRegistry: '/models/registry',
  modelVersions: (name: string) => `/models/registry/${encodeURIComponent(name)}/versions`,
  modelVersionStage: (name: string, version: string) => `/models/registry/${encodeURIComponent(name)}/versions/${version}/stage`,
  modelsCompare: '/models/compare',
} as const;

export const trainingApi = {
  // ============================================================================
  // DATASETS
  // ============================================================================

  /**
   * List datasets with optional filtering and pagination
   */
  async listDatasets(params?: DatasetQueryParams): Promise<DatasetsListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.robotTypeId) queryParams.robotTypeId = params.robotTypeId;
    if (params?.skillId) queryParams.skillId = params.skillId;
    if (params?.minQualityScore !== undefined) queryParams.minQuality = String(params.minQualityScore);
    if (params?.page) queryParams.page = String(params.page);
    if (params?.pageSize) queryParams.limit = String(params.pageSize);

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    const response = await apiClient.get<DatasetsListResponse>(ENDPOINTS.datasets, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get a single dataset by ID
   */
  async getDataset(id: string): Promise<Dataset> {
    const response = await apiClient.get<{ dataset: Dataset }>(ENDPOINTS.dataset(id));
    return response.data.dataset;
  },

  /**
   * Create a new dataset record
   */
  async createDataset(input: CreateDatasetInput): Promise<Dataset> {
    const response = await apiClient.post<{ dataset: Dataset }>(ENDPOINTS.datasets, input);
    return response.data.dataset;
  },

  /**
   * Delete a dataset
   */
  async deleteDataset(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.dataset(id));
  },

  /**
   * Initiate dataset file upload (get presigned URL)
   */
  async initiateUpload(
    datasetId: string,
    contentType: string,
    size: number
  ): Promise<UploadInitiateResponse> {
    const response = await apiClient.post<UploadInitiateResponse>(
      ENDPOINTS.datasetUploadInitiate(datasetId),
      { contentType, size }
    );
    return response.data;
  },

  /**
   * Mark dataset upload as complete, trigger validation
   */
  async completeUpload(datasetId: string): Promise<void> {
    await apiClient.post(ENDPOINTS.datasetUploadComplete(datasetId));
  },

  // ============================================================================
  // TRAINING JOBS
  // ============================================================================

  /**
   * List training jobs with filtering and pagination
   */
  async listTrainingJobs(params?: TrainingJobQueryParams): Promise<TrainingJobsListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.datasetId) queryParams.datasetId = params.datasetId;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.pageSize) queryParams.pageSize = String(params.pageSize);

    if (params?.baseModel) {
      queryParams.baseModel = Array.isArray(params.baseModel)
        ? params.baseModel.join(',')
        : params.baseModel;
    }

    if (params?.fineTuneMethod) {
      queryParams.fineTuneMethod = Array.isArray(params.fineTuneMethod)
        ? params.fineTuneMethod.join(',')
        : params.fineTuneMethod;
    }

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    const response = await apiClient.get<TrainingJobsListResponse>(ENDPOINTS.trainingJobs, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get a single training job with progress
   */
  async getTrainingJob(id: string): Promise<TrainingJobResponse> {
    const response = await apiClient.get<TrainingJobResponse>(ENDPOINTS.trainingJob(id));
    return response.data;
  },

  /**
   * Submit a new training job
   */
  async submitTrainingJob(input: SubmitTrainingJobInput): Promise<TrainingJob> {
    const response = await apiClient.post<{ job: TrainingJob }>(ENDPOINTS.trainingJobs, input);
    return response.data.job;
  },

  /**
   * Cancel a training job
   */
  async cancelTrainingJob(id: string): Promise<TrainingJob> {
    const response = await apiClient.post<{ job: TrainingJob }>(ENDPOINTS.trainingJobCancel(id));
    return response.data.job;
  },

  /**
   * Retry a failed training job
   */
  async retryTrainingJob(id: string): Promise<TrainingJob> {
    const response = await apiClient.post<{ job: TrainingJob }>(ENDPOINTS.trainingJobRetry(id));
    return response.data.job;
  },

  /**
   * Get training duration estimate for a job
   */
  async getTrainingEstimate(jobId: string): Promise<TrainingDurationEstimate> {
    const response = await apiClient.get<TrainingDurationEstimate>(
      ENDPOINTS.trainingJobEstimate(jobId)
    );
    return response.data;
  },

  /**
   * Get active training jobs
   */
  async getActiveJobs(): Promise<TrainingJob[]> {
    const response = await apiClient.get<{ jobs: TrainingJob[] }>(ENDPOINTS.activeJobs);
    return response.data.jobs;
  },

  // ============================================================================
  // GPU & QUEUE
  // ============================================================================

  /**
   * Get GPU availability status
   */
  async getGpuAvailability(): Promise<GpuAvailability> {
    const response = await apiClient.get<GpuAvailability>(ENDPOINTS.gpuAvailability);
    return response.data;
  },

  /**
   * Get training queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const response = await apiClient.get<QueueStats>(ENDPOINTS.queueStats);
    return response.data;
  },

  // ============================================================================
  // MODELS (MLflow)
  // ============================================================================

  /**
   * List registered models from MLflow
   */
  async listRegisteredModels(): Promise<RegisteredModel[]> {
    const response = await apiClient.get<{ registeredModels: RegisteredModel[] }>(
      ENDPOINTS.modelsRegistry
    );
    return response.data.registeredModels;
  },

  /**
   * Get versions for a registered model
   */
  async getModelVersions(modelName: string): Promise<ModelVersion[]> {
    const response = await apiClient.get<{ versions: ModelVersion[] }>(
      ENDPOINTS.modelVersions(modelName)
    );
    return response.data.versions;
  },

  /**
   * Compare runs by metrics
   */
  async compareRuns(runIds: string[]): Promise<RunComparison> {
    const response = await apiClient.get<RunComparison>(ENDPOINTS.modelsCompare, {
      params: {
        runIds: runIds.join(','),
      },
    });
    return response.data;
  },

  /**
   * Promote a model version to a new stage
   */
  async promoteModelVersion(modelName: string, version: string, stage: string): Promise<void> {
    await apiClient.post(ENDPOINTS.modelVersionStage(modelName, version), { stage });
  },
};

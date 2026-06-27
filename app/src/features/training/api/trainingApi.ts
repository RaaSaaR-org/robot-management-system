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
  SubmitSimRlJobInput,
  TrainingJobQueryParams,
  TrainingJobsListResponse,
  TrainingJobResponse,
  QueueStats,
  WorkerStatusListResponse,
  TrainingDurationEstimate,
  UploadInitiateResponse,
  HFDataset,
  EpisodeMeta,
  FrameData,
  CurationResult,
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

  // Queue & Workers
  queueStats: '/training/queue/stats',
  workers: '/training/workers',

  // Episodes
  datasetEpisodes: (id: string) => `/datasets/${id}/episodes`,
  datasetEpisodeFrames: (id: string, index: number) => `/datasets/${id}/episodes/${index}/frames`,
  datasetEpisodeFlag: (id: string, index: number) => `/datasets/${id}/episodes/${index}/flag`,

  // Curation (interactive episode trim / delete)
  curationEpisodesDelete: (id: string) => `/curation/${id}/episodes/delete`,
  curationEpisodeTrim: (id: string, index: number) => `/curation/${id}/episodes/${index}/trim`,

  // HuggingFace Import & Push
  huggingFaceImport: '/datasets/import/huggingface',
  datasetPushToHub: (id: string) => `/datasets/${id}/push-to-hub`,
  datasetPushStatus: (id: string) => `/datasets/${id}/push-status`,
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
  // EPISODES
  // ============================================================================

  /**
   * List episodes for a dataset
   */
  async getEpisodes(datasetId: string): Promise<EpisodeMeta[]> {
    const response = await apiClient.get<{ episodes: EpisodeMeta[] }>(
      ENDPOINTS.datasetEpisodes(datasetId)
    );
    return response.data.episodes;
  },

  /**
   * Get frame data for an episode
   */
  async getEpisodeFrames(
    datasetId: string,
    episodeIndex: number,
    offset?: number,
    limit?: number
  ): Promise<{ frames: FrameData[]; total: number }> {
    const params: Record<string, string> = {};
    if (offset !== undefined) params.offset = String(offset);
    if (limit !== undefined) params.limit = String(limit);

    const response = await apiClient.get<{ frames: FrameData[]; total: number }>(
      ENDPOINTS.datasetEpisodeFrames(datasetId, episodeIndex),
      { params }
    );
    return response.data;
  },

  /**
   * Flag or unflag an episode
   */
  async flagEpisode(datasetId: string, episodeIndex: number, flagged: boolean): Promise<void> {
    await apiClient.patch(
      ENDPOINTS.datasetEpisodeFlag(datasetId, episodeIndex),
      { flagged }
    );
  },

  /**
   * Get video URL for an episode camera
   */
  getEpisodeVideoUrl(datasetId: string, episodeIndex: number, camera: string): string {
    const baseUrl = apiClient.defaults.baseURL ?? '';
    return `${baseUrl}/datasets/${datasetId}/episodes/${episodeIndex}/video/${camera}`;
  },

  /**
   * Delete whole episodes, producing a new (non-destructive) dataset revision.
   */
  async deleteEpisodes(datasetId: string, episodes: number[]): Promise<CurationResult> {
    const response = await apiClient.post<CurationResult>(
      ENDPOINTS.curationEpisodesDelete(datasetId),
      { episodes }
    );
    return response.data;
  },

  /**
   * Trim one episode to the frame range [start, end), producing a new revision.
   */
  async trimEpisode(
    datasetId: string,
    episodeIndex: number,
    start: number,
    end: number | null
  ): Promise<CurationResult> {
    const response = await apiClient.post<CurationResult>(
      ENDPOINTS.curationEpisodeTrim(datasetId, episodeIndex),
      { start, end }
    );
    return response.data;
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
   * Submit a new training job — supervised VLA fine-tune or a sim_rl policy
   * (same endpoint; the server branches on `kind`). (TASK-172.C)
   */
  async submitTrainingJob(
    input: SubmitTrainingJobInput | SubmitSimRlJobInput
  ): Promise<TrainingJob> {
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
  // QUEUE & WORKERS
  // ============================================================================

  /**
   * Get training queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const response = await apiClient.get<QueueStats>(ENDPOINTS.queueStats);
    return response.data;
  },

  /**
   * Get active training workers + queue summary.
   * Backed by the in-memory worker registry on the server (TASK-145).
   */
  async getWorkers(): Promise<WorkerStatusListResponse> {
    const response = await apiClient.get<WorkerStatusListResponse>(ENDPOINTS.workers);
    return response.data;
  },

  // ============================================================================
  // HUGGINGFACE
  // ============================================================================

  /**
   * Import a dataset from HuggingFace Hub
   */
  async importFromHuggingFace(repoId: string, includeVideos?: boolean): Promise<{ datasetId: string }> {
    const response = await apiClient.post<{ datasetId: string }>(
      ENDPOINTS.huggingFaceImport,
      { repoId, includeVideos }
    );
    return response.data;
  },

  /**
   * Push a dataset to HuggingFace Hub
   */
  async pushToHub(datasetId: string, config: { token: string; repoId: string; private?: boolean }): Promise<{ jobId: string }> {
    const response = await apiClient.post<{ jobId: string }>(
      ENDPOINTS.datasetPushToHub(datasetId),
      config
    );
    return response.data;
  },

  /**
   * Get push-to-hub job status
   */
  async getPushStatus(datasetId: string): Promise<{ status: string; progress?: string; url?: string; error?: string }> {
    const response = await apiClient.get<{ status: string; progress?: string; url?: string; error?: string }>(
      ENDPOINTS.datasetPushStatus(datasetId)
    );
    return response.data;
  },

  /**
   * Search HuggingFace Hub for LeRobot datasets (public API, no backend proxy)
   */
  async searchHuggingFace(query: string): Promise<HFDataset[]> {
    const params = new URLSearchParams({
      search: query,
      filter: 'lerobot',
      limit: '20',
    });
    const response = await fetch(
      `https://huggingface.co/api/datasets?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(`HuggingFace API error: ${response.status}`);
    }
    return response.json() as Promise<HFDataset[]>;
  },
};

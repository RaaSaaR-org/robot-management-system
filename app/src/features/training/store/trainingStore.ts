/**
 * @file trainingStore.ts
 * @description Zustand store for VLA training state management
 * @feature training
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { trainingApi } from '../api';
import type {
  TrainingState,
  TrainingActions,
  Dataset,
  CreateDatasetInput,
  DatasetQueryParams,
  TrainingJob,
  SubmitTrainingJobInput,
  TrainingJobQueryParams,
  JobProgress,
  TrainingJobEvent,
  UploadInitiateResponse,
  RegisteredModel,
} from '../types';

type TrainingStore = TrainingState & TrainingActions;

const initialState: TrainingState = {
  // Datasets
  datasets: [],
  datasetsLoading: false,
  datasetsError: null,
  datasetsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },

  // Training Jobs
  trainingJobs: [],
  trainingJobsLoading: false,
  trainingJobsError: null,
  trainingJobsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },

  // Active Job
  activeJob: null,
  activeJobProgress: null,
  activeJobLoading: false,

  // GPU & Queue
  gpuAvailability: null,
  gpuLoading: false,
  queueStats: null,
  queueLoading: false,

  // Upload
  uploadProgress: 0,
  uploadError: null,

  // Models
  registeredModels: [],
  modelsLoading: false,
  selectedModel: null,
  modelVersions: [],
  modelComparison: null,

  // Filters
  datasetFilters: {},
  jobFilters: {},
};

export const useTrainingStore = create<TrainingStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // ========================================================================
      // DATASETS
      // ========================================================================

      fetchDatasets: async (params?: DatasetQueryParams) => {
        set((state) => {
          state.datasetsLoading = true;
          state.datasetsError = null;
        });

        try {
          const mergedParams = { ...get().datasetFilters, ...params };
          const response = await trainingApi.listDatasets(mergedParams);

          set((state) => {
            state.datasets = response.datasets;
            state.datasetsPagination = response.pagination;
            state.datasetsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch datasets';
          set((state) => {
            state.datasetsError = message;
            state.datasetsLoading = false;
          });
        }
      },

      createDataset: async (input: CreateDatasetInput): Promise<Dataset> => {
        const dataset = await trainingApi.createDataset(input);

        set((state) => {
          state.datasets.unshift(dataset);
        });

        return dataset;
      },

      deleteDataset: async (id: string) => {
        await trainingApi.deleteDataset(id);

        set((state) => {
          state.datasets = state.datasets.filter((d) => d.id !== id);
        });
      },

      initiateUpload: async (
        datasetId: string,
        contentType: string,
        size: number
      ): Promise<UploadInitiateResponse> => {
        set((state) => {
          state.uploadProgress = 0;
          state.uploadError = null;
        });

        return await trainingApi.initiateUpload(datasetId, contentType, size);
      },

      completeUpload: async (datasetId: string) => {
        await trainingApi.completeUpload(datasetId);

        // Update the dataset status in the list
        set((state) => {
          const index = state.datasets.findIndex((d) => d.id === datasetId);
          if (index !== -1) {
            state.datasets[index].status = 'validating';
          }
        });
      },

      setDatasetFilters: (filters: Partial<DatasetQueryParams>) => {
        set((state) => {
          state.datasetFilters = { ...state.datasetFilters, ...filters };
        });
      },

      // ========================================================================
      // TRAINING JOBS
      // ========================================================================

      fetchTrainingJobs: async (params?: TrainingJobQueryParams) => {
        set((state) => {
          state.trainingJobsLoading = true;
          state.trainingJobsError = null;
        });

        try {
          const mergedParams = { ...get().jobFilters, ...params };
          const response = await trainingApi.listTrainingJobs(mergedParams);

          set((state) => {
            state.trainingJobs = response.jobs;
            state.trainingJobsPagination = response.pagination;
            state.trainingJobsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch training jobs';
          set((state) => {
            state.trainingJobsError = message;
            state.trainingJobsLoading = false;
          });
        }
      },

      submitTrainingJob: async (input: SubmitTrainingJobInput): Promise<TrainingJob> => {
        const job = await trainingApi.submitTrainingJob(input);

        set((state) => {
          state.trainingJobs.unshift(job);
        });

        return job;
      },

      getTrainingJob: async (id: string) => {
        set((state) => {
          state.activeJobLoading = true;
        });

        try {
          const response = await trainingApi.getTrainingJob(id);

          set((state) => {
            state.activeJob = response.job;
            state.activeJobProgress = response.progress || null;
            state.activeJobLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch training job:', error);
          set((state) => {
            state.activeJobLoading = false;
          });
        }
      },

      cancelTrainingJob: async (id: string) => {
        const job = await trainingApi.cancelTrainingJob(id);

        set((state) => {
          // Update in list
          const index = state.trainingJobs.findIndex((j) => j.id === id);
          if (index !== -1) {
            state.trainingJobs[index] = job;
          }

          // Update active job if same
          if (state.activeJob?.id === id) {
            state.activeJob = job;
          }
        });
      },

      retryTrainingJob: async (id: string) => {
        const job = await trainingApi.retryTrainingJob(id);

        set((state) => {
          // Update in list
          const index = state.trainingJobs.findIndex((j) => j.id === id);
          if (index !== -1) {
            state.trainingJobs[index] = job;
          }

          // Update active job if same
          if (state.activeJob?.id === id) {
            state.activeJob = job;
          }
        });
      },

      setJobFilters: (filters: Partial<TrainingJobQueryParams>) => {
        set((state) => {
          state.jobFilters = { ...state.jobFilters, ...filters };
        });
      },

      // ========================================================================
      // REAL-TIME UPDATES
      // ========================================================================

      updateJobProgress: (jobId: string, progress: JobProgress) => {
        set((state) => {
          // Update job in list
          const index = state.trainingJobs.findIndex((j) => j.id === jobId);
          if (index !== -1) {
            state.trainingJobs[index].status = progress.status;
            state.trainingJobs[index].progress = progress.progress;
            state.trainingJobs[index].currentEpoch = progress.currentEpoch;
            if (progress.metrics) {
              state.trainingJobs[index].metrics = progress.metrics;
            }
          }

          // Update active job if same
          if (state.activeJob?.id === jobId) {
            state.activeJob.status = progress.status;
            state.activeJob.progress = progress.progress;
            state.activeJob.currentEpoch = progress.currentEpoch;
            if (progress.metrics) {
              state.activeJob.metrics = progress.metrics;
            }
            state.activeJobProgress = progress;
          }
        });
      },

      handleTrainingEvent: (event: TrainingJobEvent) => {
        const { type, jobId, job, progress } = event;

        set((state) => {
          switch (type) {
            case 'training:job:created':
              if (job && !state.trainingJobs.find((j) => j.id === jobId)) {
                state.trainingJobs.unshift(job);
              }
              break;

            case 'training:job:started':
            case 'training:job:progress':
              if (progress) {
                // Update job in list
                const index = state.trainingJobs.findIndex((j) => j.id === jobId);
                if (index !== -1) {
                  state.trainingJobs[index].status = progress.status;
                  state.trainingJobs[index].progress = progress.progress;
                  state.trainingJobs[index].currentEpoch = progress.currentEpoch;
                  if (progress.metrics) {
                    state.trainingJobs[index].metrics = progress.metrics;
                  }
                }

                // Update active job if same
                if (state.activeJob?.id === jobId) {
                  state.activeJob.status = progress.status;
                  state.activeJob.progress = progress.progress;
                  state.activeJob.currentEpoch = progress.currentEpoch;
                  if (progress.metrics) {
                    state.activeJob.metrics = progress.metrics;
                  }
                  state.activeJobProgress = progress;
                }
              }
              break;

            case 'training:job:completed':
            case 'training:job:failed':
            case 'training:job:cancelled':
              if (job) {
                const index = state.trainingJobs.findIndex((j) => j.id === jobId);
                if (index !== -1) {
                  state.trainingJobs[index] = job;
                }

                if (state.activeJob?.id === jobId) {
                  state.activeJob = job;
                  state.activeJobProgress = null;
                }
              }
              break;
          }
        });
      },

      // ========================================================================
      // GPU & QUEUE
      // ========================================================================

      fetchGpuAvailability: async () => {
        set((state) => {
          state.gpuLoading = true;
        });

        try {
          const availability = await trainingApi.getGpuAvailability();

          set((state) => {
            state.gpuAvailability = availability;
            state.gpuLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch GPU availability:', error);
          set((state) => {
            state.gpuLoading = false;
          });
        }
      },

      fetchQueueStats: async () => {
        set((state) => {
          state.queueLoading = true;
        });

        try {
          const stats = await trainingApi.getQueueStats();

          set((state) => {
            state.queueStats = stats;
            state.queueLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch queue stats:', error);
          set((state) => {
            state.queueLoading = false;
          });
        }
      },

      // ========================================================================
      // MODELS
      // ========================================================================

      fetchRegisteredModels: async () => {
        set((state) => {
          state.modelsLoading = true;
        });

        try {
          const models = await trainingApi.listRegisteredModels();

          set((state) => {
            state.registeredModels = models;
            state.modelsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch registered models:', error);
          set((state) => {
            state.modelsLoading = false;
          });
        }
      },

      fetchModelVersions: async (modelName: string) => {
        try {
          const versions = await trainingApi.getModelVersions(modelName);

          set((state) => {
            state.modelVersions = versions;
          });
        } catch (error) {
          console.error('Failed to fetch model versions:', error);
        }
      },

      selectModel: (model: RegisteredModel | null) => {
        set((state) => {
          state.selectedModel = model;
          if (!model) {
            state.modelVersions = [];
          }
        });
      },

      compareRuns: async (runIds: string[]) => {
        try {
          const comparison = await trainingApi.compareRuns(runIds);

          set((state) => {
            state.modelComparison = comparison;
          });
        } catch (error) {
          console.error('Failed to compare runs:', error);
        }
      },

      promoteModelVersion: async (modelName: string, version: string, stage: string) => {
        await trainingApi.promoteModelVersion(modelName, version, stage);

        // Refresh versions after promotion
        const versions = await trainingApi.getModelVersions(modelName);
        set((state) => {
          state.modelVersions = versions;
        });
      },

      // ========================================================================
      // RESET
      // ========================================================================

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    { name: 'training-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

// Datasets
export const selectDatasets = (state: TrainingStore) => state.datasets;
export const selectDatasetsLoading = (state: TrainingStore) => state.datasetsLoading;
export const selectDatasetsError = (state: TrainingStore) => state.datasetsError;
export const selectDatasetsPagination = (state: TrainingStore) => state.datasetsPagination;
export const selectDatasetFilters = (state: TrainingStore) => state.datasetFilters;
export const selectReadyDatasets = (state: TrainingStore) =>
  state.datasets.filter((d) => d.status === 'ready');

// Training Jobs
export const selectTrainingJobs = (state: TrainingStore) => state.trainingJobs;
export const selectTrainingJobsLoading = (state: TrainingStore) => state.trainingJobsLoading;
export const selectTrainingJobsError = (state: TrainingStore) => state.trainingJobsError;
export const selectTrainingJobsPagination = (state: TrainingStore) => state.trainingJobsPagination;
export const selectJobFilters = (state: TrainingStore) => state.jobFilters;
export const selectActiveJobs = (state: TrainingStore) =>
  state.trainingJobs.filter((j) => j.status === 'running' || j.status === 'queued');
export const selectCompletedJobs = (state: TrainingStore) =>
  state.trainingJobs.filter((j) => j.status === 'completed');

// Active Job
export const selectActiveJob = (state: TrainingStore) => state.activeJob;
export const selectActiveJobProgress = (state: TrainingStore) => state.activeJobProgress;
export const selectActiveJobLoading = (state: TrainingStore) => state.activeJobLoading;

// GPU & Queue
export const selectGpuAvailability = (state: TrainingStore) => state.gpuAvailability;
export const selectGpuLoading = (state: TrainingStore) => state.gpuLoading;
export const selectQueueStats = (state: TrainingStore) => state.queueStats;
export const selectQueueLoading = (state: TrainingStore) => state.queueLoading;

// Upload
export const selectUploadProgress = (state: TrainingStore) => state.uploadProgress;
export const selectUploadError = (state: TrainingStore) => state.uploadError;

// Models
export const selectRegisteredModels = (state: TrainingStore) => state.registeredModels;
export const selectModelsLoading = (state: TrainingStore) => state.modelsLoading;
export const selectSelectedModel = (state: TrainingStore) => state.selectedModel;
export const selectModelVersions = (state: TrainingStore) => state.modelVersions;
export const selectModelComparison = (state: TrainingStore) => state.modelComparison;

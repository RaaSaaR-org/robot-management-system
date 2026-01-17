/**
 * @file useTrainingJobs.ts
 * @description React hook for training job operations
 * @feature training
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useTrainingStore,
  selectTrainingJobs,
  selectTrainingJobsLoading,
  selectTrainingJobsError,
  selectTrainingJobsPagination,
  selectActiveJob,
  selectActiveJobProgress,
  selectActiveJobLoading,
} from '../store';
import type {
  TrainingJob,
  TrainingJobQueryParams,
  SubmitTrainingJobInput,
  JobProgress,
} from '../types';

export interface UseTrainingJobsReturn {
  jobs: TrainingJob[];
  activeJobs: TrainingJob[];
  completedJobs: TrainingJob[];
  isLoading: boolean;
  error: string | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  fetchJobs: (params?: TrainingJobQueryParams) => Promise<void>;
  submitJob: (input: SubmitTrainingJobInput) => Promise<TrainingJob>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  setFilters: (filters: Partial<TrainingJobQueryParams>) => void;
}

/**
 * Hook for accessing training jobs list
 */
export function useTrainingJobs(): UseTrainingJobsReturn {
  const jobs = useTrainingStore(selectTrainingJobs);
  const isLoading = useTrainingStore(selectTrainingJobsLoading);
  const error = useTrainingStore(selectTrainingJobsError);
  const pagination = useTrainingStore(selectTrainingJobsPagination);

  // Compute derived state with useMemo to avoid creating new arrays on every render
  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === 'running' || j.status === 'queued'),
    [jobs]
  );
  const completedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'completed'),
    [jobs]
  );

  const storeFetchJobs = useTrainingStore((state) => state.fetchTrainingJobs);
  const storeSubmitJob = useTrainingStore((state) => state.submitTrainingJob);
  const storeCancelJob = useTrainingStore((state) => state.cancelTrainingJob);
  const storeRetryJob = useTrainingStore((state) => state.retryTrainingJob);
  const storeSetFilters = useTrainingStore((state) => state.setJobFilters);

  const fetchJobs = useCallback(
    async (params?: TrainingJobQueryParams) => {
      await storeFetchJobs(params);
    },
    [storeFetchJobs]
  );

  const submitJob = useCallback(
    async (input: SubmitTrainingJobInput) => {
      return await storeSubmitJob(input);
    },
    [storeSubmitJob]
  );

  const cancelJob = useCallback(
    async (id: string) => {
      await storeCancelJob(id);
    },
    [storeCancelJob]
  );

  const retryJob = useCallback(
    async (id: string) => {
      await storeRetryJob(id);
    },
    [storeRetryJob]
  );

  const setFilters = useCallback(
    (filters: Partial<TrainingJobQueryParams>) => {
      storeSetFilters(filters);
    },
    [storeSetFilters]
  );

  return useMemo(
    () => ({
      jobs,
      activeJobs,
      completedJobs,
      isLoading,
      error,
      pagination,
      fetchJobs,
      submitJob,
      cancelJob,
      retryJob,
      setFilters,
    }),
    [
      jobs,
      activeJobs,
      completedJobs,
      isLoading,
      error,
      pagination,
      fetchJobs,
      submitJob,
      cancelJob,
      retryJob,
      setFilters,
    ]
  );
}

export interface UseTrainingJobDetailReturn {
  job: TrainingJob | null;
  progress: JobProgress | null;
  isLoading: boolean;
  fetchJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
}

/**
 * Hook for accessing a single training job detail
 */
export function useTrainingJobDetail(): UseTrainingJobDetailReturn {
  const job = useTrainingStore(selectActiveJob);
  const progress = useTrainingStore(selectActiveJobProgress);
  const isLoading = useTrainingStore(selectActiveJobLoading);

  const storeGetJob = useTrainingStore((state) => state.getTrainingJob);
  const storeCancelJob = useTrainingStore((state) => state.cancelTrainingJob);
  const storeRetryJob = useTrainingStore((state) => state.retryTrainingJob);

  const fetchJob = useCallback(
    async (id: string) => {
      await storeGetJob(id);
    },
    [storeGetJob]
  );

  const cancelJob = useCallback(
    async (id: string) => {
      await storeCancelJob(id);
    },
    [storeCancelJob]
  );

  const retryJob = useCallback(
    async (id: string) => {
      await storeRetryJob(id);
    },
    [storeRetryJob]
  );

  return useMemo(
    () => ({
      job,
      progress,
      isLoading,
      fetchJob,
      cancelJob,
      retryJob,
    }),
    [job, progress, isLoading, fetchJob, cancelJob, retryJob]
  );
}

/**
 * Hook for auto-fetching training jobs on mount
 */
export function useTrainingJobsAutoFetch(params?: TrainingJobQueryParams): UseTrainingJobsReturn {
  const result = useTrainingJobs();
  const { fetchJobs } = result;

  useEffect(() => {
    fetchJobs(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}

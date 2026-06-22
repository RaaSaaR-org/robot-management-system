/**
 * @file trainingStore.test.ts
 * @description Tests for the training Zustand store
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useTrainingStore,
  selectDatasets,
  selectReadyDatasets,
  selectActiveJobs,
  selectCompletedJobs,
  selectActiveJob,
  selectQueueStats,
  selectWorkers,
} from '../trainingStore';
import type {
  Dataset,
  TrainingJob,
  JobProgress,
  PaginationInfo,
  QueueStats,
  WorkerStatusListResponse,
  UploadInitiateResponse,
  TrainingJobEvent,
} from '../../types';

// Mock the api barrel the store imports
vi.mock('../../api', () => ({
  trainingApi: {
    listDatasets: vi.fn(),
    createDataset: vi.fn(),
    deleteDataset: vi.fn(),
    initiateUpload: vi.fn(),
    completeUpload: vi.fn(),
    listTrainingJobs: vi.fn(),
    submitTrainingJob: vi.fn(),
    getTrainingJob: vi.fn(),
    cancelTrainingJob: vi.fn(),
    retryTrainingJob: vi.fn(),
    getQueueStats: vi.fn(),
    getWorkers: vi.fn(),
  },
}));

import { trainingApi } from '../../api';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: 'Pick Cube',
    robotTypeId: 'so101',
    storagePath: 's3://x',
    lerobotVersion: 'v2',
    fps: 30,
    totalFrames: 100,
    totalDuration: 10,
    demonstrationCount: 5,
    // minimal shape for json fields — store never inspects them
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<TrainingJob> = {}): TrainingJob {
  return {
    id: 'job-1',
    datasetId: 'ds-1',
    baseModel: 'smolvla',
    fineTuneMethod: 'lora',
    hyperparameters: {} as TrainingJob['hyperparameters'],
    gpuRequirements: {} as TrainingJob['gpuRequirements'],
    status: 'queued',
    progress: 0,
    metrics: {} as TrainingJob['metrics'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const PAGINATION: PaginationInfo = { page: 2, pageSize: 20, total: 1, totalPages: 1 };

const INITIAL_PAGINATION: PaginationInfo = { page: 1, pageSize: 20, total: 0, totalPages: 0 };

function resetStore() {
  useTrainingStore.setState({
    datasets: [],
    datasetsLoading: false,
    datasetsError: null,
    datasetsPagination: { ...INITIAL_PAGINATION },
    trainingJobs: [],
    trainingJobsLoading: false,
    trainingJobsError: null,
    trainingJobsPagination: { ...INITIAL_PAGINATION },
    activeJob: null,
    activeJobProgress: null,
    activeJobLoading: false,
    queueStats: null,
    queueLoading: false,
    workers: null,
    workersLoading: false,
    uploadProgress: 0,
    uploadError: null,
    datasetFilters: {},
    jobFilters: {},
  });
}

describe('trainingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('starts with the expected initial state', () => {
    const s = useTrainingStore.getState();
    expect(s.datasets).toEqual([]);
    expect(s.trainingJobs).toEqual([]);
    expect(s.activeJob).toBeNull();
    expect(s.queueStats).toBeNull();
    expect(s.workers).toBeNull();
    expect(s.uploadProgress).toBe(0);
    expect(s.datasetFilters).toEqual({});
    expect(s.jobFilters).toEqual({});
    expect(s.datasetsPagination).toEqual(INITIAL_PAGINATION);
  });

  // --------------------------------------------------------------------------
  // DATASETS
  // --------------------------------------------------------------------------

  describe('fetchDatasets', () => {
    it('loads datasets and merges stored filters with params (success)', async () => {
      const ds = makeDataset();
      vi.mocked(trainingApi.listDatasets).mockResolvedValue({
        datasets: [ds],
        pagination: PAGINATION,
      });

      useTrainingStore.getState().setDatasetFilters({ robotTypeId: 'so101' });
      await useTrainingStore.getState().fetchDatasets({ page: 2 });

      expect(trainingApi.listDatasets).toHaveBeenCalledWith({ robotTypeId: 'so101', page: 2 });
      const s = useTrainingStore.getState();
      expect(s.datasets).toEqual([ds]);
      expect(s.datasetsPagination).toEqual(PAGINATION);
      expect(s.datasetsLoading).toBe(false);
      expect(s.datasetsError).toBeNull();
    });

    it('sets loading true while in flight', async () => {
      let resolveFn: (v: { datasets: Dataset[]; pagination: PaginationInfo }) => void = () => {};
      vi.mocked(trainingApi.listDatasets).mockReturnValue(
        new Promise((res) => {
          resolveFn = res;
        })
      );

      const promise = useTrainingStore.getState().fetchDatasets();
      expect(useTrainingStore.getState().datasetsLoading).toBe(true);
      expect(useTrainingStore.getState().datasetsError).toBeNull();

      resolveFn({ datasets: [], pagination: INITIAL_PAGINATION });
      await promise;
      expect(useTrainingStore.getState().datasetsLoading).toBe(false);
    });

    it('records the error message and clears loading (error)', async () => {
      vi.mocked(trainingApi.listDatasets).mockRejectedValue(new Error('boom'));

      await useTrainingStore.getState().fetchDatasets();

      const s = useTrainingStore.getState();
      expect(s.datasetsError).toBe('boom');
      expect(s.datasetsLoading).toBe(false);
      expect(s.datasets).toEqual([]);
    });

    it('uses fallback message for non-Error throws', async () => {
      vi.mocked(trainingApi.listDatasets).mockRejectedValue('weird');
      await useTrainingStore.getState().fetchDatasets();
      expect(useTrainingStore.getState().datasetsError).toBe('Failed to fetch datasets');
    });
  });

  describe('createDataset', () => {
    it('prepends the created dataset and returns it', async () => {
      useTrainingStore.setState({ datasets: [makeDataset({ id: 'ds-old' })] });
      const created = makeDataset({ id: 'ds-new', name: 'New' });
      vi.mocked(trainingApi.createDataset).mockResolvedValue(created);

      const result = await useTrainingStore
        .getState()
        .createDataset({ name: 'New', robotTypeId: 'so101' });

      expect(result).toEqual(created);
      const ids = useTrainingStore.getState().datasets.map((d) => d.id);
      expect(ids).toEqual(['ds-new', 'ds-old']);
    });

    it('propagates errors without mutating the list', async () => {
      useTrainingStore.setState({ datasets: [makeDataset({ id: 'ds-old' })] });
      vi.mocked(trainingApi.createDataset).mockRejectedValue(new Error('nope'));

      await expect(
        useTrainingStore.getState().createDataset({ name: 'x', robotTypeId: 'so101' })
      ).rejects.toThrow('nope');
      expect(useTrainingStore.getState().datasets.map((d) => d.id)).toEqual(['ds-old']);
    });
  });

  describe('deleteDataset', () => {
    it('removes the dataset from the list', async () => {
      useTrainingStore.setState({
        datasets: [makeDataset({ id: 'a' }), makeDataset({ id: 'b' })],
      });
      vi.mocked(trainingApi.deleteDataset).mockResolvedValue(undefined);

      await useTrainingStore.getState().deleteDataset('a');

      expect(trainingApi.deleteDataset).toHaveBeenCalledWith('a');
      expect(useTrainingStore.getState().datasets.map((d) => d.id)).toEqual(['b']);
    });
  });

  describe('initiateUpload', () => {
    it('resets upload progress/error and returns the response', async () => {
      useTrainingStore.setState({ uploadProgress: 50, uploadError: 'old' });
      const resp: UploadInitiateResponse = {
        uploadUrl: 'http://up',
        expiresIn: 60,
        storagePath: 's3://p',
        message: 'ok',
      };
      vi.mocked(trainingApi.initiateUpload).mockResolvedValue(resp);

      const result = await useTrainingStore
        .getState()
        .initiateUpload('ds-1', 'application/zip', 1234);

      expect(result).toEqual(resp);
      expect(trainingApi.initiateUpload).toHaveBeenCalledWith('ds-1', 'application/zip', 1234);
      const s = useTrainingStore.getState();
      expect(s.uploadProgress).toBe(0);
      expect(s.uploadError).toBeNull();
    });
  });

  describe('completeUpload', () => {
    it('sets the matching dataset status to validating', async () => {
      useTrainingStore.setState({
        datasets: [makeDataset({ id: 'ds-1', status: 'uploading' })],
      });
      vi.mocked(trainingApi.completeUpload).mockResolvedValue(undefined);

      await useTrainingStore.getState().completeUpload('ds-1');

      expect(useTrainingStore.getState().datasets[0].status).toBe('validating');
    });

    it('is a no-op on the list when dataset id is unknown', async () => {
      useTrainingStore.setState({
        datasets: [makeDataset({ id: 'ds-1', status: 'uploading' })],
      });
      vi.mocked(trainingApi.completeUpload).mockResolvedValue(undefined);

      await useTrainingStore.getState().completeUpload('missing');

      expect(useTrainingStore.getState().datasets[0].status).toBe('uploading');
    });
  });

  describe('setDatasetFilters', () => {
    it('merges filters incrementally', () => {
      useTrainingStore.getState().setDatasetFilters({ robotTypeId: 'so101' });
      useTrainingStore.getState().setDatasetFilters({ skillId: 'pick' });
      expect(useTrainingStore.getState().datasetFilters).toEqual({
        robotTypeId: 'so101',
        skillId: 'pick',
      });
    });
  });

  // --------------------------------------------------------------------------
  // TRAINING JOBS
  // --------------------------------------------------------------------------

  describe('fetchTrainingJobs', () => {
    it('loads jobs and merges job filters (success)', async () => {
      const job = makeJob();
      vi.mocked(trainingApi.listTrainingJobs).mockResolvedValue({
        jobs: [job],
        pagination: PAGINATION,
      });

      useTrainingStore.getState().setJobFilters({ datasetId: 'ds-1' });
      await useTrainingStore.getState().fetchTrainingJobs({ page: 3 });

      expect(trainingApi.listTrainingJobs).toHaveBeenCalledWith({ datasetId: 'ds-1', page: 3 });
      const s = useTrainingStore.getState();
      expect(s.trainingJobs).toEqual([job]);
      expect(s.trainingJobsPagination).toEqual(PAGINATION);
      expect(s.trainingJobsLoading).toBe(false);
    });

    it('records error and clears loading (error)', async () => {
      vi.mocked(trainingApi.listTrainingJobs).mockRejectedValue(new Error('fail jobs'));
      await useTrainingStore.getState().fetchTrainingJobs();
      const s = useTrainingStore.getState();
      expect(s.trainingJobsError).toBe('fail jobs');
      expect(s.trainingJobsLoading).toBe(false);
    });
  });

  describe('submitTrainingJob', () => {
    it('prepends the new job and returns it', async () => {
      useTrainingStore.setState({ trainingJobs: [makeJob({ id: 'old' })] });
      const job = makeJob({ id: 'new' });
      vi.mocked(trainingApi.submitTrainingJob).mockResolvedValue(job);

      const result = await useTrainingStore.getState().submitTrainingJob({
        datasetId: 'ds-1',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      });

      expect(result).toEqual(job);
      expect(useTrainingStore.getState().trainingJobs.map((j) => j.id)).toEqual(['new', 'old']);
    });
  });

  describe('getTrainingJob', () => {
    it('sets active job and progress (success)', async () => {
      const job = makeJob({ id: 'job-x' });
      const progress: JobProgress = {
        status: 'running',
        progress: 0.5,
        updatedAt: '2026-01-02T00:00:00.000Z',
      };
      vi.mocked(trainingApi.getTrainingJob).mockResolvedValue({ job, progress });

      await useTrainingStore.getState().getTrainingJob('job-x');

      const s = useTrainingStore.getState();
      expect(s.activeJob).toEqual(job);
      expect(s.activeJobProgress).toEqual(progress);
      expect(s.activeJobLoading).toBe(false);
    });

    it('defaults activeJobProgress to null when missing', async () => {
      const job = makeJob({ id: 'job-y' });
      vi.mocked(trainingApi.getTrainingJob).mockResolvedValue({ job });

      await useTrainingStore.getState().getTrainingJob('job-y');

      expect(useTrainingStore.getState().activeJobProgress).toBeNull();
    });

    it('clears loading and keeps activeJob on error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(trainingApi.getTrainingJob).mockRejectedValue(new Error('x'));

      await useTrainingStore.getState().getTrainingJob('job-z');

      expect(useTrainingStore.getState().activeJobLoading).toBe(false);
      expect(useTrainingStore.getState().activeJob).toBeNull();
      errSpy.mockRestore();
    });
  });

  describe('cancelTrainingJob', () => {
    it('updates job in list and active job when ids match', async () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1', status: 'running' })],
        activeJob: makeJob({ id: 'job-1', status: 'running' }),
      });
      const cancelled = makeJob({ id: 'job-1', status: 'cancelled' });
      vi.mocked(trainingApi.cancelTrainingJob).mockResolvedValue(cancelled);

      await useTrainingStore.getState().cancelTrainingJob('job-1');

      const s = useTrainingStore.getState();
      expect(s.trainingJobs[0].status).toBe('cancelled');
      expect(s.activeJob?.status).toBe('cancelled');
    });

    it('leaves active job untouched when ids differ', async () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1', status: 'running' })],
        activeJob: makeJob({ id: 'other', status: 'running' }),
      });
      vi.mocked(trainingApi.cancelTrainingJob).mockResolvedValue(
        makeJob({ id: 'job-1', status: 'cancelled' })
      );

      await useTrainingStore.getState().cancelTrainingJob('job-1');

      expect(useTrainingStore.getState().activeJob?.status).toBe('running');
    });
  });

  describe('retryTrainingJob', () => {
    it('updates job in list and matching active job', async () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1', status: 'failed' })],
        activeJob: makeJob({ id: 'job-1', status: 'failed' }),
      });
      const retried = makeJob({ id: 'job-1', status: 'queued' });
      vi.mocked(trainingApi.retryTrainingJob).mockResolvedValue(retried);

      await useTrainingStore.getState().retryTrainingJob('job-1');

      const s = useTrainingStore.getState();
      expect(s.trainingJobs[0].status).toBe('queued');
      expect(s.activeJob?.status).toBe('queued');
    });
  });

  describe('setJobFilters', () => {
    it('merges job filters incrementally', () => {
      useTrainingStore.getState().setJobFilters({ datasetId: 'ds-1' });
      useTrainingStore.getState().setJobFilters({ baseModel: 'pi0' });
      expect(useTrainingStore.getState().jobFilters).toEqual({
        datasetId: 'ds-1',
        baseModel: 'pi0',
      });
    });
  });

  // --------------------------------------------------------------------------
  // REAL-TIME UPDATES
  // --------------------------------------------------------------------------

  describe('updateJobProgress', () => {
    it('updates a job in the list', () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1', status: 'queued', progress: 0 })],
      });
      const progress: JobProgress = {
        status: 'running',
        progress: 0.42,
        currentEpoch: 3,
        metrics: { loss: 0.1 } as JobProgress['metrics'],
        updatedAt: 'now',
      };

      useTrainingStore.getState().updateJobProgress('job-1', progress);

      const j = useTrainingStore.getState().trainingJobs[0];
      expect(j.status).toBe('running');
      expect(j.progress).toBe(0.42);
      expect(j.currentEpoch).toBe(3);
      expect(j.metrics).toEqual({ loss: 0.1 });
    });

    it('mirrors progress onto the active job and sets activeJobProgress', () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1' })],
        activeJob: makeJob({ id: 'job-1' }),
      });
      const progress: JobProgress = { status: 'running', progress: 0.9, updatedAt: 'now' };

      useTrainingStore.getState().updateJobProgress('job-1', progress);

      const s = useTrainingStore.getState();
      expect(s.activeJob?.progress).toBe(0.9);
      expect(s.activeJobProgress).toEqual(progress);
    });

    it('does not touch active job when id differs', () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1' })],
        activeJob: makeJob({ id: 'other', progress: 0 }),
      });

      useTrainingStore
        .getState()
        .updateJobProgress('job-1', { status: 'running', progress: 0.5, updatedAt: 'now' });

      expect(useTrainingStore.getState().activeJob?.progress).toBe(0);
      expect(useTrainingStore.getState().activeJobProgress).toBeNull();
    });
  });

  describe('handleTrainingEvent', () => {
    it('created: prepends new job, ignores duplicates', () => {
      const job = makeJob({ id: 'job-1' });
      const event: TrainingJobEvent = {
        type: 'training:job:created',
        jobId: 'job-1',
        job,
        timestamp: 't',
      };

      useTrainingStore.getState().handleTrainingEvent(event);
      expect(useTrainingStore.getState().trainingJobs.map((j) => j.id)).toEqual(['job-1']);

      // duplicate should not be added again
      useTrainingStore.getState().handleTrainingEvent(event);
      expect(useTrainingStore.getState().trainingJobs).toHaveLength(1);
    });

    it('progress: updates list + active job', () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1' })],
        activeJob: makeJob({ id: 'job-1' }),
      });
      const progress: JobProgress = { status: 'running', progress: 0.3, updatedAt: 'now' };

      useTrainingStore.getState().handleTrainingEvent({
        type: 'training:job:progress',
        jobId: 'job-1',
        progress,
        timestamp: 't',
      });

      const s = useTrainingStore.getState();
      expect(s.trainingJobs[0].progress).toBe(0.3);
      expect(s.activeJobProgress).toEqual(progress);
    });

    it('completed: replaces job and clears active progress', () => {
      useTrainingStore.setState({
        trainingJobs: [makeJob({ id: 'job-1', status: 'running' })],
        activeJob: makeJob({ id: 'job-1', status: 'running' }),
        activeJobProgress: { status: 'running', progress: 0.9, updatedAt: 'now' },
      });
      const done = makeJob({ id: 'job-1', status: 'completed' });

      useTrainingStore.getState().handleTrainingEvent({
        type: 'training:job:completed',
        jobId: 'job-1',
        job: done,
        timestamp: 't',
      });

      const s = useTrainingStore.getState();
      expect(s.trainingJobs[0].status).toBe('completed');
      expect(s.activeJob?.status).toBe('completed');
      expect(s.activeJobProgress).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // QUEUE & WORKERS
  // --------------------------------------------------------------------------

  describe('fetchQueueStats', () => {
    it('stores stats on success', async () => {
      const stats: QueueStats = {
        pending: 1,
        queued: 2,
        running: 3,
        completed: 4,
        completed_24h: 1,
        failed: 0,
      };
      vi.mocked(trainingApi.getQueueStats).mockResolvedValue(stats);

      await useTrainingStore.getState().fetchQueueStats();

      const s = useTrainingStore.getState();
      expect(s.queueStats).toEqual(stats);
      expect(s.queueLoading).toBe(false);
    });

    it('clears loading and leaves stats null on error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(trainingApi.getQueueStats).mockRejectedValue(new Error('x'));

      await useTrainingStore.getState().fetchQueueStats();

      expect(useTrainingStore.getState().queueLoading).toBe(false);
      expect(useTrainingStore.getState().queueStats).toBeNull();
      errSpy.mockRestore();
    });
  });

  describe('fetchWorkers', () => {
    it('stores workers on success', async () => {
      const workers: WorkerStatusListResponse = {
        workers: [],
        queuedJobs: 2,
        runningJobs: 1,
      };
      vi.mocked(trainingApi.getWorkers).mockResolvedValue(workers);

      await useTrainingStore.getState().fetchWorkers();

      expect(useTrainingStore.getState().workers).toEqual(workers);
      expect(useTrainingStore.getState().workersLoading).toBe(false);
    });

    it('clears loading on error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(trainingApi.getWorkers).mockRejectedValue(new Error('x'));

      await useTrainingStore.getState().fetchWorkers();

      expect(useTrainingStore.getState().workersLoading).toBe(false);
      expect(useTrainingStore.getState().workers).toBeNull();
      errSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // RESET
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('restores initial state', () => {
      useTrainingStore.setState({
        datasets: [makeDataset()],
        trainingJobs: [makeJob()],
        activeJob: makeJob(),
        datasetsError: 'err',
        datasetFilters: { robotTypeId: 'so101' },
      });

      useTrainingStore.getState().reset();

      const s = useTrainingStore.getState();
      expect(s.datasets).toEqual([]);
      expect(s.trainingJobs).toEqual([]);
      expect(s.activeJob).toBeNull();
      expect(s.datasetsError).toBeNull();
      expect(s.datasetFilters).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // SELECTORS
  // --------------------------------------------------------------------------

  describe('selectors', () => {
    it('selectReadyDatasets filters by ready status', () => {
      useTrainingStore.setState({
        datasets: [
          makeDataset({ id: 'a', status: 'ready' }),
          makeDataset({ id: 'b', status: 'uploading' }),
          makeDataset({ id: 'c', status: 'ready' }),
        ],
      });
      const s = useTrainingStore.getState();
      expect(selectDatasets(s)).toHaveLength(3);
      expect(selectReadyDatasets(s).map((d) => d.id)).toEqual(['a', 'c']);
    });

    it('selectActiveJobs returns running or queued jobs', () => {
      useTrainingStore.setState({
        trainingJobs: [
          makeJob({ id: 'r', status: 'running' }),
          makeJob({ id: 'q', status: 'queued' }),
          makeJob({ id: 'd', status: 'completed' }),
        ],
      });
      const s = useTrainingStore.getState();
      expect(selectActiveJobs(s).map((j) => j.id)).toEqual(['r', 'q']);
    });

    it('selectCompletedJobs returns only completed jobs', () => {
      useTrainingStore.setState({
        trainingJobs: [
          makeJob({ id: 'd', status: 'completed' }),
          makeJob({ id: 'f', status: 'failed' }),
        ],
      });
      expect(selectCompletedJobs(useTrainingStore.getState()).map((j) => j.id)).toEqual(['d']);
    });

    it('plain selectors read straight through', () => {
      const job = makeJob({ id: 'job-1' });
      const stats: QueueStats = {
        pending: 0,
        queued: 0,
        running: 0,
        completed: 0,
        completed_24h: 0,
        failed: 0,
      };
      const workers: WorkerStatusListResponse = { workers: [], queuedJobs: 0, runningJobs: 0 };
      useTrainingStore.setState({ activeJob: job, queueStats: stats, workers });
      const s = useTrainingStore.getState();
      expect(selectActiveJob(s)).toEqual(job);
      expect(selectQueueStats(s)).toEqual(stats);
      expect(selectWorkers(s)).toEqual(workers);
    });
  });
});

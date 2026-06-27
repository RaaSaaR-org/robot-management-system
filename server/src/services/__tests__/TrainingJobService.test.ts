/**
 * @file TrainingJobService.test.ts
 * @description Unit tests for TrainingJobService — VLA training job submission,
 *   lifecycle (cancel/retry), listing, queue stats, progress watching and event
 *   emission. All external boundaries (repositories, NATS messaging, job queue,
 *   uuid) are mocked so no real DB/network/filesystem access occurs.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  TrainingJob,
  TrainingJobStatus,
  Dataset,
  PaginatedResult,
} from '../../types/vla.types.js';
import type { JobProgress, QueueStats } from '../../types/training.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'uuid-fixed'),
}));

vi.mock('../../repositories/index.js', () => ({
  trainingJobRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
  },
  datasetRepository: {
    findById: vi.fn(),
  },
  simSceneRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: {
    isConnected: vi.fn(() => false),
  },
  getJobQueue: vi.fn(),
}));

import { trainingJobService, TrainingJobService } from '../TrainingJobService.js';
import {
  trainingJobRepository as _trainingJobRepository,
  datasetRepository as _datasetRepository,
  simSceneRepository as _simSceneRepository,
} from '../../repositories/index.js';
import { natsClient as _natsClient, getJobQueue as _getJobQueue } from '../../messaging/index.js';

const trainingJobRepository = vi.mocked(_trainingJobRepository, true);
const datasetRepository = vi.mocked(_datasetRepository, true);
const simSceneRepository = vi.mocked(_simSceneRepository, true);
const natsClient = vi.mocked(_natsClient, true);
const getJobQueue = vi.mocked(_getJobQueue, true);

// ---------------------------------------------------------------------------
// Mock job queue helper
// ---------------------------------------------------------------------------

function makeJobQueue() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    addJob: vi.fn().mockResolvedValue(undefined),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    getJobProgress: vi.fn().mockResolvedValue(null),
    getQueueStats: vi.fn().mockResolvedValue(null),
    watchJobProgress: vi.fn().mockResolvedValue(() => {}),
  };
}

// Access the private jobQueue field for deterministic queue-presence control.
type ServiceInternals = {
  jobQueue: ReturnType<typeof makeJobQueue> | null;
  initialized: boolean;
  progressWatchers: Map<string, () => void>;
};

function setJobQueue(q: ReturnType<typeof makeJobQueue> | null): void {
  (trainingJobService as unknown as ServiceInternals).jobQueue = q;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds1',
    name: 'Dataset One',
    robotTypeId: 'rt1',
    storagePath: '/data/ds1',
    lerobotVersion: 'v3',
    fps: 30,
    totalFrames: 1000,
    totalDuration: 33,
    demonstrationCount: 10,
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<TrainingJob> = {}): TrainingJob {
  return {
    id: 'job1',
    kind: 'supervised',
    datasetId: 'ds1',
    baseModel: 'smolvla',
    fineTuneMethod: 'lora',
    sceneId: null,
    twinId: null,
    hyperparameters: { learning_rate: 1e-4, batch_size: 32, epochs: 100 },
    gpuRequirements: { count: 1, memory: 40 },
    status: 'pending',
    progress: 0,
    metrics: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePaginated(data: TrainingJob[]): PaginatedResult<TrainingJob> {
  return {
    data,
    pagination: { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  natsClient.isConnected.mockReturnValue(false);
  setJobQueue(null);
});

// ===========================================================================
// getInstance / singleton
// ===========================================================================

describe('getInstance', () => {
  it('returns the same singleton instance and matches the exported singleton', () => {
    const a = TrainingJobService.getInstance();
    const b = TrainingJobService.getInstance();
    expect(a).toBe(b);
    expect(a).toBe(trainingJobService);
  });
});

// ===========================================================================
// initialize / isInitialized
// ===========================================================================

describe('initialize', () => {
  it('skips initialization when NATS is not connected', async () => {
    natsClient.isConnected.mockReturnValue(false);
    await trainingJobService.initialize();
    expect(getJobQueue).not.toHaveBeenCalled();
    expect(trainingJobService.isInitialized()).toBe(false);
  });

  it('initializes the job queue when NATS is connected', async () => {
    natsClient.isConnected.mockReturnValue(true);
    const queue = makeJobQueue();
    getJobQueue.mockReturnValue(queue as never);

    await trainingJobService.initialize();

    expect(getJobQueue).toHaveBeenCalled();
    expect(queue.initialize).toHaveBeenCalled();
    expect(trainingJobService.isInitialized()).toBe(true);

    // second initialize is a no-op (idempotent)
    getJobQueue.mockClear();
    await trainingJobService.initialize();
    expect(getJobQueue).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// submitJob
// ===========================================================================

describe('submitJob', () => {
  it('throws when the dataset does not exist', async () => {
    datasetRepository.findById.mockResolvedValue(null);
    await expect(
      trainingJobService.submitJob({
        datasetId: 'missing',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      })
    ).rejects.toThrow('Dataset not found: missing');
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
  });

  it('throws when the dataset is not ready', async () => {
    datasetRepository.findById.mockResolvedValue(makeDataset({ status: 'validating' }));
    await expect(
      trainingJobService.submitJob({
        datasetId: 'ds1',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      })
    ).rejects.toThrow('Dataset not ready: ds1 (status: validating)');
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
  });

  it('merges defaults, creates the job and emits a created event (no queue)', async () => {
    setJobQueue(null);
    datasetRepository.findById.mockResolvedValue(makeDataset({ status: 'ready' }));
    const job = makeJob({ id: 'job-created' });
    trainingJobRepository.create.mockResolvedValue(job);

    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.submitJob({
      datasetId: 'ds1',
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
      hyperparameters: { batch_size: 8 },
      gpuRequirements: { count: 2 },
    });

    expect(result).toBe(job);
    expect(trainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: 'ds1',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
        // merged hyperparameters: default learning_rate/epochs + overridden batch_size
        hyperparameters: { learning_rate: 1e-4, batch_size: 8, epochs: 100 },
        gpuRequirements: { count: 2, memory: 40 },
        totalEpochs: 100,
      })
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'training:job:created', jobId: 'job-created' })
    );
    unsub();
  });

  it('enqueues the job in NATS when a job queue is present', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    datasetRepository.findById.mockResolvedValue(makeDataset({ status: 'ready' }));
    const job = makeJob({ id: 'job-q', datasetId: 'ds1' });
    trainingJobRepository.create.mockResolvedValue(job);

    await trainingJobService.submitJob({
      datasetId: 'ds1',
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
      priority: 9,
    });

    expect(queue.addJob).toHaveBeenCalledWith(
      'finetune',
      expect.objectContaining({ jobId: 'job-q', datasetId: 'ds1', priority: 9 }),
      { msgID: 'job-q' }
    );
  });
});

// ===========================================================================
// submitSimRlJob (TASK-172.C)
// ===========================================================================

describe('submitSimRlJob', () => {
  it('throws when the scene does not exist', async () => {
    simSceneRepository.findById.mockResolvedValue(null);
    await expect(
      trainingJobService.submitSimRlJob({ kind: 'sim_rl', sceneId: 'missing' })
    ).rejects.toThrow('Sim scene not found: missing');
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
  });

  it('creates a sim_rl job (kind/sceneId/twinId, null dataset) and never enqueues NATS', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    simSceneRepository.findById.mockResolvedValue({
      id: 'scene-1',
      twinId: 'twin-1',
      embodimentTag: 'g1',
      mjcfKey: 'twins/twin-1/scene.xml',
    } as never);
    const job = makeJob({ id: 'sim-created', kind: 'sim_rl', datasetId: null, sceneId: 'scene-1' });
    trainingJobRepository.create.mockResolvedValue(job);

    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.submitSimRlJob({ kind: 'sim_rl', sceneId: 'scene-1' });

    expect(result).toBe(job);
    expect(trainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sim_rl', sceneId: 'scene-1', twinId: 'twin-1' })
    );
    // sim_rl is claimed over HTTP — it must NOT be enqueued in NATS.
    expect(queue.addJob).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'training:job:created', jobId: 'sim-created' })
    );
    unsub();
  });
});

// ===========================================================================
// getJob / getJobWithProgress
// ===========================================================================

describe('getJob', () => {
  it('delegates to the repository', async () => {
    const job = makeJob();
    trainingJobRepository.findById.mockResolvedValue(job);
    await expect(trainingJobService.getJob('job1')).resolves.toBe(job);
    expect(trainingJobRepository.findById).toHaveBeenCalledWith('job1');
  });

  it('returns null when not found', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    await expect(trainingJobService.getJob('x')).resolves.toBeNull();
  });
});

describe('getJobWithProgress', () => {
  it('returns null when the job is not found', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    await expect(trainingJobService.getJobWithProgress('x')).resolves.toBeNull();
  });

  it('returns the job with null progress when no queue', async () => {
    setJobQueue(null);
    const job = makeJob();
    trainingJobRepository.findById.mockResolvedValue(job);
    await expect(trainingJobService.getJobWithProgress('job1')).resolves.toEqual({
      job,
      progress: null,
    });
  });

  it('fetches progress from the queue when present', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    const job = makeJob();
    trainingJobRepository.findById.mockResolvedValue(job);
    const progress: JobProgress = {
      status: 'running',
      progress: 50,
      updatedAt: new Date().toISOString(),
    };
    queue.getJobProgress.mockResolvedValue(progress);

    const result = await trainingJobService.getJobWithProgress('job1');
    expect(result).toEqual({ job, progress });
    expect(queue.getJobProgress).toHaveBeenCalledWith('job1');
  });
});

// ===========================================================================
// cancelJob
// ===========================================================================

describe('cancelJob', () => {
  it('returns null when the job is not found', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    await expect(trainingJobService.cancelJob('x')).resolves.toBeNull();
    expect(trainingJobRepository.update).not.toHaveBeenCalled();
  });

  it('throws when the job is in a non-cancellable status', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'completed' }));
    await expect(trainingJobService.cancelJob('job1')).rejects.toThrow(
      'Cannot cancel job with status: completed'
    );
  });

  it('cancels a running job, updates status and emits a cancelled event', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    const updated = makeJob({ status: 'cancelled' });
    trainingJobRepository.update.mockResolvedValue(updated);

    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.cancelJob('job1');

    expect(result).toBe(updated);
    expect(trainingJobRepository.update).toHaveBeenCalledWith('job1', { status: 'cancelled' });
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'training:job:cancelled', jobId: 'job1' })
    );
    unsub();
  });

  it('signals cancellation to the queue when present', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'queued' }));
    trainingJobRepository.update.mockResolvedValue(makeJob({ status: 'cancelled' }));

    await trainingJobService.cancelJob('job1');
    expect(queue.cancelJob).toHaveBeenCalledWith('job1');
  });
});

// ===========================================================================
// retryJob
// ===========================================================================

describe('retryJob', () => {
  it('returns null when the job is not found', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    await expect(trainingJobService.retryJob('x')).resolves.toBeNull();
  });

  it('throws when the job is not failed or cancelled', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    await expect(trainingJobService.retryJob('job1')).rejects.toThrow(
      'Cannot retry job with status: running'
    );
  });

  it('resets a failed job, re-enqueues and emits a created event', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'failed' }));
    const updated = makeJob({ id: 'job1', status: 'pending', progress: 0 });
    trainingJobRepository.update.mockResolvedValue(updated);

    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.retryJob('job1');

    expect(result).toBe(updated);
    expect(trainingJobRepository.update).toHaveBeenCalledWith(
      'job1',
      expect.objectContaining({ status: 'pending', progress: 0 })
    );
    expect(queue.addJob).toHaveBeenCalledWith(
      'finetune',
      expect.objectContaining({ jobId: 'job1' }),
      expect.objectContaining({ msgID: expect.stringContaining('job1-retry-') })
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'training:job:created', jobId: 'job1' })
    );
    unsub();
  });

  it('returns the updated job without enqueueing when no queue is present', async () => {
    setJobQueue(null);
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'cancelled' }));
    const updated = makeJob({ status: 'pending' });
    trainingJobRepository.update.mockResolvedValue(updated);

    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.retryJob('job1');
    expect(result).toBe(updated);
    // no queue -> no created event emitted
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('returns null without enqueueing when the update fails', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'failed' }));
    trainingJobRepository.update.mockResolvedValue(null);

    const result = await trainingJobService.retryJob('job1');
    expect(result).toBeNull();
    expect(queue.addJob).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getJobs / getActiveJobs
// ===========================================================================

describe('getJobs', () => {
  it('passes query params through to the repository', async () => {
    const page = makePaginated([makeJob()]);
    trainingJobRepository.findAll.mockResolvedValue(page);
    await expect(trainingJobService.getJobs({ datasetId: 'ds1' })).resolves.toBe(page);
    expect(trainingJobRepository.findAll).toHaveBeenCalledWith({ datasetId: 'ds1' });
  });
});

describe('getActiveJobs', () => {
  it('queries for active statuses and returns the data array', async () => {
    const jobs = [makeJob({ status: 'running' })];
    trainingJobRepository.findAll.mockResolvedValue(makePaginated(jobs));
    const result = await trainingJobService.getActiveJobs();
    expect(result).toEqual(jobs);
    expect(trainingJobRepository.findAll).toHaveBeenCalledWith({
      status: ['pending', 'queued', 'running'],
      pageSize: 100,
    });
  });
});

// ===========================================================================
// getQueueStats
// ===========================================================================

describe('getQueueStats', () => {
  it('returns null when no queue is present', async () => {
    setJobQueue(null);
    await expect(trainingJobService.getQueueStats()).resolves.toBeNull();
  });

  it('delegates to the queue when present', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    const stats: QueueStats = {
      pending: 1,
      running: 2,
      completed: 3,
      failed: 0,
      streamInfo: { messages: 6, bytes: 100, firstSeq: 1, lastSeq: 6, consumerCount: 1 },
    };
    queue.getQueueStats.mockResolvedValue(stats);
    await expect(trainingJobService.getQueueStats()).resolves.toBe(stats);
  });
});

// ===========================================================================
// watchJobProgress
// ===========================================================================

describe('watchJobProgress', () => {
  it('throws when the service has no queue', async () => {
    setJobQueue(null);
    await expect(
      trainingJobService.watchJobProgress('job1', () => {})
    ).rejects.toThrow('TrainingJobService not initialized');
  });

  it('registers a watcher and returns a stop function that cleans up', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    const stopInner = vi.fn();
    queue.watchJobProgress.mockResolvedValue(stopInner);

    const cb = vi.fn();
    const stop = await trainingJobService.watchJobProgress('job1', cb);

    expect(queue.watchJobProgress).toHaveBeenCalledWith('job1', cb);
    const watchers = (trainingJobService as unknown as ServiceInternals).progressWatchers;
    expect(watchers.has('job1')).toBe(true);

    stop();
    expect(stopInner).toHaveBeenCalled();
    expect(watchers.has('job1')).toBe(false);
  });

  it('stops an existing watcher before registering a new one for the same job', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    queue.watchJobProgress
      .mockResolvedValueOnce(stopFirst)
      .mockResolvedValueOnce(stopSecond);

    await trainingJobService.watchJobProgress('job1', vi.fn());
    await trainingJobService.watchJobProgress('job1', vi.fn());

    expect(stopFirst).toHaveBeenCalled();
    trainingJobService.stopAllWatchers();
  });
});

// ===========================================================================
// updateJobStatus
// ===========================================================================

describe('updateJobStatus', () => {
  it('returns null and emits nothing when the update returns null', async () => {
    trainingJobRepository.update.mockResolvedValue(null);
    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.updateJobStatus('job1', 'running');
    expect(result).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it.each<[TrainingJobStatus, string]>([
    ['running', 'training:job:started'],
    ['completed', 'training:job:completed'],
    ['failed', 'training:job:failed'],
    ['cancelled', 'training:job:cancelled'],
    ['queued', 'training:job:progress'],
  ])('maps status %s to event %s', async (status, eventType) => {
    const updated = makeJob({ status });
    trainingJobRepository.update.mockResolvedValue(updated);
    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    const result = await trainingJobService.updateJobStatus('job1', status);
    expect(result).toBe(updated);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ type: eventType, jobId: 'job1' }));
    unsub();
  });

  it('forwards errorMessage updates into the emitted event', async () => {
    trainingJobRepository.update.mockResolvedValue(makeJob({ status: 'failed' }));
    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    await trainingJobService.updateJobStatus('job1', 'failed', { errorMessage: 'boom' });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ error: 'boom' }));
    unsub();
  });
});

// ===========================================================================
// emitProgressEvent
// ===========================================================================

describe('emitProgressEvent', () => {
  it('emits a progress event with the supplied progress', () => {
    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);
    const progress: JobProgress = {
      status: 'running',
      progress: 25,
      updatedAt: new Date().toISOString(),
    };

    trainingJobService.emitProgressEvent('job1', progress);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'training:job:progress', jobId: 'job1', progress })
    );
    unsub();
  });
});

// ===========================================================================
// onJobEvent subscription handling
// ===========================================================================

describe('onJobEvent', () => {
  it('unsubscribes so the callback stops receiving events', () => {
    const cb = vi.fn();
    const unsub = trainingJobService.onJobEvent(cb);

    trainingJobService.emitProgressEvent('job1', {
      status: 'running',
      progress: 1,
      updatedAt: new Date().toISOString(),
    });
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    trainingJobService.emitProgressEvent('job1', {
      status: 'running',
      progress: 2,
      updatedAt: new Date().toISOString(),
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// stopAllWatchers
// ===========================================================================

describe('stopAllWatchers', () => {
  it('invokes every registered stop function and clears the map', async () => {
    const queue = makeJobQueue();
    setJobQueue(queue);
    const stopA = vi.fn();
    const stopB = vi.fn();
    queue.watchJobProgress
      .mockResolvedValueOnce(stopA)
      .mockResolvedValueOnce(stopB);

    await trainingJobService.watchJobProgress('a', vi.fn());
    await trainingJobService.watchJobProgress('b', vi.fn());

    trainingJobService.stopAllWatchers();

    expect(stopA).toHaveBeenCalled();
    expect(stopB).toHaveBeenCalled();
    expect((trainingJobService as unknown as ServiceInternals).progressWatchers.size).toBe(0);
  });
});

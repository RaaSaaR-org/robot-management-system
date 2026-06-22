/**
 * @file TrainingOrchestrator.test.ts
 * @description Unit tests for TrainingOrchestrator — VLA training job lifecycle:
 *   hyperparameter validation, duration estimation, job claim/start/progress/
 *   complete/fail, checkpoints, heartbeat + worker registry, and ETA tracking.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  TrainingJob,
  Dataset,
  Hyperparameters,
} from '../../types/vla.types.js';
import type {
  WorkerProgressRequest,
  WorkerCompleteRequest,
  WorkerFailedRequest,
  WorkerCheckpointRequest,
  WorkerHeartbeatRequest,
} from '../../types/training.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

vi.mock('../../repositories/index.js', () => ({
  trainingJobRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
    findByStatus: vi.fn(),
    findRunning: vi.fn(),
    update: vi.fn(),
  },
  modelVersionRepository: {
    create: vi.fn(),
  },
  datasetRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: {
    isConnected: vi.fn(() => false),
  },
  getJobQueue: vi.fn(() => ({
    updateJobProgress: vi.fn(),
  })),
}));

vi.mock('../TrainingJobService.js', () => ({
  trainingJobService: {
    updateJobStatus: vi.fn(),
    emitProgressEvent: vi.fn(),
  },
}));

import {
  TrainingOrchestrator,
  trainingOrchestrator,
  hyperparametersSchema,
} from '../TrainingOrchestrator.js';
import {
  trainingJobRepository as _trainingJobRepository,
  modelVersionRepository as _modelVersionRepository,
  datasetRepository as _datasetRepository,
} from '../../repositories/index.js';
import { natsClient as _natsClient, getJobQueue as _getJobQueue } from '../../messaging/index.js';
import { trainingJobService as _trainingJobService } from '../TrainingJobService.js';

const trainingJobRepository = vi.mocked(_trainingJobRepository, true);
const modelVersionRepository = vi.mocked(_modelVersionRepository, true);
const datasetRepository = vi.mocked(_datasetRepository, true);
const natsClient = vi.mocked(_natsClient, true);
const getJobQueue = vi.mocked(_getJobQueue, true);
const trainingJobService = vi.mocked(_trainingJobService, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<TrainingJob> = {}): TrainingJob {
  return {
    id: 'job1',
    datasetId: 'ds1',
    baseModel: 'smolvla' as TrainingJob['baseModel'],
    fineTuneMethod: 'lora' as TrainingJob['fineTuneMethod'],
    hyperparameters: {} as Hyperparameters,
    gpuRequirements: {} as TrainingJob['gpuRequirements'],
    status: 'pending',
    progress: 0,
    currentEpoch: 0,
    totalEpochs: 100,
    metrics: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds1',
    totalFrames: 5000,
    skillId: 'skill1',
    ...overrides,
  } as Dataset;
}

// Reset the singleton's in-memory state between tests by reaching into its
// private maps. Runtime-only; keeps tests isolated without rebuilding the
// shared singleton (constructor is private).
function resetOrchestratorState(): void {
  const o = trainingOrchestrator as unknown as {
    etaStates: Map<string, unknown>;
    checkpoints: Map<string, unknown>;
    workers: Map<string, unknown>;
    initialized: boolean;
    workerCleanupTimer: NodeJS.Timeout | null;
  };
  o.etaStates.clear();
  o.checkpoints.clear();
  o.workers.clear();
  if (o.workerCleanupTimer) {
    clearInterval(o.workerCleanupTimer);
    o.workerCleanupTimer = null;
  }
  o.initialized = false;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOrchestratorState();
  natsClient.isConnected.mockReturnValue(false);
  // Default: updateJobStatus echoes back a running job
  trainingJobService.updateJobStatus.mockResolvedValue(makeJob({ status: 'running' }));
  // Default queue/run counts so listWorkers() is safe everywhere.
  trainingJobRepository.findByStatus.mockResolvedValue([]);
  trainingJobRepository.findRunning.mockResolvedValue([]);
});

// ===========================================================================
// getInstance / singleton
// ===========================================================================

describe('getInstance', () => {
  it('returns the same singleton instance', () => {
    expect(TrainingOrchestrator.getInstance()).toBe(TrainingOrchestrator.getInstance());
    expect(TrainingOrchestrator.getInstance()).toBe(trainingOrchestrator);
  });
});

// ===========================================================================
// hyperparametersSchema + validateHyperparameters
// ===========================================================================

describe('hyperparametersSchema', () => {
  it('accepts valid hyperparameters', () => {
    expect(() =>
      hyperparametersSchema.parse({ learning_rate: 1e-4, batch_size: 32, epochs: 10 })
    ).not.toThrow();
  });

  it('rejects a non-power-of-2 batch size', () => {
    expect(() =>
      hyperparametersSchema.parse({ learning_rate: 1e-4, batch_size: 30, epochs: 10 })
    ).toThrow(/power of 2/);
  });

  it('rejects an out-of-range learning rate', () => {
    expect(() =>
      hyperparametersSchema.parse({ learning_rate: 1, batch_size: 32, epochs: 10 })
    ).toThrow();
  });

  it('rejects an invalid lora_rank', () => {
    expect(() =>
      hyperparametersSchema.parse({ learning_rate: 1e-4, batch_size: 32, epochs: 10, lora_rank: 5 })
    ).toThrow(/lora_rank/);
  });
});

describe('validateHyperparameters', () => {
  it('applies defaults when fields are omitted (full method)', () => {
    const result = trainingOrchestrator.validateHyperparameters({}, 'full');
    expect(result.learning_rate).toBe(1e-4);
    expect(result.batch_size).toBe(32);
    expect(result.epochs).toBe(100);
  });

  it('requires lora_rank for the lora method', () => {
    expect(() =>
      trainingOrchestrator.validateHyperparameters({ batch_size: 16 }, 'lora')
    ).toThrow('lora_rank is required for LoRA fine-tuning method');
  });

  it('keeps lora_rank for the lora method when valid', () => {
    const result = trainingOrchestrator.validateHyperparameters(
      { batch_size: 16, lora_rank: 8 },
      'lora'
    );
    expect(result.lora_rank).toBe(8);
  });

  it('strips lora_rank for non-lora methods', () => {
    const result = trainingOrchestrator.validateHyperparameters(
      { batch_size: 16, lora_rank: 8 },
      'full'
    );
    expect(result.lora_rank).toBeUndefined();
  });

  it('throws a ZodError on invalid input', () => {
    expect(() =>
      trainingOrchestrator.validateHyperparameters({ batch_size: 7 }, 'full')
    ).toThrow();
  });
});

// ===========================================================================
// estimateTrainingDuration
// ===========================================================================

describe('estimateTrainingDuration', () => {
  const hp = { batch_size: 32, epochs: 10 } as Hyperparameters;

  it('throws when the dataset is not found', async () => {
    datasetRepository.findById.mockResolvedValue(null);
    await expect(
      trainingOrchestrator.estimateTrainingDuration('missing', hp)
    ).rejects.toThrow('Dataset not found: missing');
  });

  it('computes steps and high confidence for a large dataset', async () => {
    datasetRepository.findById.mockResolvedValue(makeDataset({ totalFrames: 20000 }));
    const est = await trainingOrchestrator.estimateTrainingDuration('ds1', hp);
    // stepsPerEpoch = ceil(20000/32)=625, totalSteps = 625*10 = 6250
    expect(est.estimatedSteps).toBe(6250);
    expect(est.confidence).toBe('high');
    expect(est.stepsPerSecond).toBeCloseTo(0.2);
    expect(est.estimatedMinutes).toBe(Math.ceil((6250 * 5) / 60));
  });

  it('reports low confidence for a small dataset', async () => {
    datasetRepository.findById.mockResolvedValue(makeDataset({ totalFrames: 500 }));
    const est = await trainingOrchestrator.estimateTrainingDuration('ds1', hp);
    expect(est.confidence).toBe('low');
  });

  it('reports medium confidence for a mid-size dataset', async () => {
    datasetRepository.findById.mockResolvedValue(makeDataset({ totalFrames: 5000 }));
    const est = await trainingOrchestrator.estimateTrainingDuration('ds1', hp);
    expect(est.confidence).toBe('medium');
  });
});

// ===========================================================================
// initialize / reapStaleRunningJobs / isInitialized
// ===========================================================================

describe('initialize', () => {
  it('reaps orphaned running jobs and marks initialized', async () => {
    const stale = makeJob({
      id: 'old',
      status: 'running',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    trainingJobRepository.findByStatus.mockResolvedValue([stale]);

    expect(trainingOrchestrator.isInitialized()).toBe(false);
    await trainingOrchestrator.initialize();

    expect(trainingJobService.updateJobStatus).toHaveBeenCalledWith(
      'old',
      'failed',
      expect.objectContaining({ errorMessage: expect.stringContaining('worker timeout') })
    );
    expect(trainingOrchestrator.isInitialized()).toBe(true);
  });

  it('is idempotent (second call is a no-op)', async () => {
    trainingJobRepository.findByStatus.mockResolvedValue([]);
    await trainingOrchestrator.initialize();
    trainingJobRepository.findByStatus.mockClear();
    await trainingOrchestrator.initialize();
    expect(trainingJobRepository.findByStatus).not.toHaveBeenCalled();
  });

  it('swallows reap errors and still initializes', async () => {
    trainingJobRepository.findByStatus.mockRejectedValue(new Error('db down'));
    await expect(trainingOrchestrator.initialize()).resolves.toBeUndefined();
    expect(trainingOrchestrator.isInitialized()).toBe(true);
  });
});

describe('reapStaleRunningJobs', () => {
  it('only reaps jobs older than the threshold', async () => {
    const fresh = makeJob({ id: 'fresh', status: 'running', updatedAt: new Date() });
    const stale = makeJob({
      id: 'stale',
      status: 'running',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    trainingJobRepository.findByStatus.mockResolvedValue([fresh, stale]);

    const reaped = await trainingOrchestrator.reapStaleRunningJobs();

    expect(reaped).toBe(1);
    expect(trainingJobService.updateJobStatus).toHaveBeenCalledTimes(1);
    expect(trainingJobService.updateJobStatus).toHaveBeenCalledWith(
      'stale',
      'failed',
      expect.any(Object)
    );
  });

  it('returns 0 when nothing is stale', async () => {
    trainingJobRepository.findByStatus.mockResolvedValue([
      makeJob({ status: 'running', updatedAt: new Date() }),
    ]);
    expect(await trainingOrchestrator.reapStaleRunningJobs()).toBe(0);
  });
});

// ===========================================================================
// startJob
// ===========================================================================

describe('startJob', () => {
  it('returns null when the job is not found', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    expect(await trainingOrchestrator.startJob('nope')).toBeNull();
    expect(trainingJobService.updateJobStatus).not.toHaveBeenCalled();
  });

  it('marks the job running and seeds ETA state', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ id: 'job1' }));
    const running = makeJob({ id: 'job1', status: 'running' });
    trainingJobService.updateJobStatus.mockResolvedValue(running);

    const result = await trainingOrchestrator.startJob('job1');

    expect(result).toBe(running);
    expect(trainingJobService.updateJobStatus).toHaveBeenCalledWith(
      'job1',
      'running',
      expect.objectContaining({ startedAt: expect.any(Date) })
    );
    expect(trainingOrchestrator.getEta('job1')).not.toBeNull();
  });
});

// ===========================================================================
// claimNextPendingJob
// ===========================================================================

describe('claimNextPendingJob', () => {
  it('returns null and registers an idle worker when no jobs are queued', async () => {
    trainingJobRepository.findAll.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    });

    const result = await trainingOrchestrator.claimNextPendingJob('w1', 'cuda');

    expect(result).toBeNull();
    const workers = await trainingOrchestrator.listWorkers();
    expect(workers.workers.map((w) => w.workerId)).toContain('w1');
    expect(workers.workers[0].status).toBe('idle');
  });

  it('claims the oldest candidate and starts it', async () => {
    const newest = makeJob({ id: 'newest' });
    const oldest = makeJob({ id: 'oldest' });
    // findAll returns newest-first; service picks the last (oldest)
    trainingJobRepository.findAll.mockResolvedValue({
      data: [newest, oldest],
      pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
    });
    trainingJobRepository.findById.mockResolvedValue(oldest);
    const started = makeJob({ id: 'oldest', status: 'running' });
    trainingJobService.updateJobStatus.mockResolvedValue(started);

    const result = await trainingOrchestrator.claimNextPendingJob('w2', 'mps');

    expect(result?.id).toBe('oldest');
    expect(trainingJobRepository.findById).toHaveBeenCalledWith('oldest');
  });

  it('registers the worker as idle when startJob fails to claim', async () => {
    const cand = makeJob({ id: 'gone' });
    trainingJobRepository.findAll.mockResolvedValue({
      data: [cand],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });
    // startJob -> findById returns null -> startJob returns null
    trainingJobRepository.findById.mockResolvedValue(null);

    const result = await trainingOrchestrator.claimNextPendingJob('w3');

    expect(result).toBeNull();
    const workers = await trainingOrchestrator.listWorkers();
    expect(workers.workers.find((w) => w.workerId === 'w3')?.status).toBe('idle');
  });
});

// ===========================================================================
// updateProgress
// ===========================================================================

describe('updateProgress', () => {
  const baseReq: WorkerProgressRequest = {
    jobId: 'job1',
    epoch: 2,
    step: 50,
    totalSteps: 200,
    trainLoss: 0.4,
    valLoss: 0.5,
    learningRate: 1e-4,
  };

  it('signals cancel when the job is gone', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    const res = await trainingOrchestrator.updateProgress(baseReq);
    expect(res).toEqual({ job: null, eta: null, cancel: true });
  });

  it('signals cancel when the job status is cancelled', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'cancelled' }));
    const res = await trainingOrchestrator.updateProgress(baseReq);
    expect(res.cancel).toBe(true);
    expect(res.job?.status).toBe('cancelled');
  });

  it('computes progress and appends metrics', async () => {
    trainingJobRepository.findById.mockResolvedValue(
      makeJob({ status: 'running', metrics: { training_loss: [0.9] } })
    );
    const updated = makeJob({ status: 'running', progress: 25 });
    trainingJobRepository.update.mockResolvedValue(updated);

    const res = await trainingOrchestrator.updateProgress(baseReq);

    expect(res.cancel).toBe(false);
    expect(res.job).toBe(updated);
    // progress = round(50/200*100) = 25
    expect(trainingJobRepository.update).toHaveBeenCalledWith(
      'job1',
      expect.objectContaining({
        progress: 25,
        currentEpoch: 2,
        metrics: expect.objectContaining({
          training_loss: [0.9, 0.4],
          validation_loss: [0.5],
          learning_rate: [1e-4],
        }),
      })
    );
    expect(trainingJobService.emitProgressEvent).toHaveBeenCalledWith(
      'job1',
      expect.objectContaining({ status: 'running', progress: 25 })
    );
  });

  it('pushes to the KV store when NATS is connected', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    trainingJobRepository.update.mockResolvedValue(makeJob({ status: 'running' }));
    natsClient.isConnected.mockReturnValue(true);
    const updateJobProgress = vi.fn().mockResolvedValue(undefined);
    getJobQueue.mockReturnValue({ updateJobProgress } as never);

    await trainingOrchestrator.updateProgress(baseReq);

    expect(updateJobProgress).toHaveBeenCalledWith('job1', expect.objectContaining({ progress: 25 }));
  });

  it('does not throw when the KV update fails', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    trainingJobRepository.update.mockResolvedValue(makeJob({ status: 'running' }));
    natsClient.isConnected.mockReturnValue(true);
    getJobQueue.mockReturnValue({
      updateJobProgress: vi.fn().mockRejectedValue(new Error('kv down')),
    } as never);

    await expect(trainingOrchestrator.updateProgress(baseReq)).resolves.toBeDefined();
  });
});

// ===========================================================================
// completeJob
// ===========================================================================

describe('completeJob', () => {
  const req: WorkerCompleteRequest = {
    jobId: 'job1',
    artifactUri: 's3://bucket/model',
    finalMetrics: {
      finalLoss: 0.1,
      validationLoss: 0.2,
      trainingTimeSeconds: 100,
      bestEpoch: 7,
    },
  };

  it('returns nulls when the job is not found', async () => {
    trainingJobRepository.findById.mockResolvedValue(null);
    const res = await trainingOrchestrator.completeJob(req);
    expect(res).toEqual({ job: null, modelVersionId: null });
  });

  it('completes the job and creates a model version', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    const completed = makeJob({ status: 'completed', progress: 100 });
    trainingJobService.updateJobStatus.mockResolvedValue(completed);
    datasetRepository.findById.mockResolvedValue(makeDataset({ skillId: 'skillX' }));
    modelVersionRepository.create.mockResolvedValue({ id: 'mv1' } as never);

    const res = await trainingOrchestrator.completeJob(req);

    expect(res.job).toBe(completed);
    expect(res.modelVersionId).toBe('mv1');
    expect(trainingJobService.updateJobStatus).toHaveBeenCalledWith(
      'job1',
      'completed',
      expect.objectContaining({ progress: 100 })
    );
    expect(modelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'skillX',
        trainingJobId: 'job1',
        artifactUri: 's3://bucket/model',
        deploymentStatus: 'staging',
        validationMetrics: { final_loss: 0.2 },
      })
    );
  });

  it('still completes the job when ModelVersion creation fails', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    const completed = makeJob({ status: 'completed' });
    trainingJobService.updateJobStatus.mockResolvedValue(completed);
    datasetRepository.findById.mockResolvedValue(makeDataset());
    modelVersionRepository.create.mockRejectedValue(new Error('mv boom'));

    const res = await trainingOrchestrator.completeJob(req);

    expect(res.job).toBe(completed);
    expect(res.modelVersionId).toBeNull();
  });

  it('uses a null skillId when the dataset is missing', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    trainingJobService.updateJobStatus.mockResolvedValue(makeJob({ status: 'completed' }));
    datasetRepository.findById.mockResolvedValue(null);
    modelVersionRepository.create.mockResolvedValue({ id: 'mv2' } as never);

    await trainingOrchestrator.completeJob(req);

    expect(modelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: null })
    );
  });
});

// ===========================================================================
// failJob
// ===========================================================================

describe('failJob', () => {
  it('marks the job failed with the error message', async () => {
    const req: WorkerFailedRequest = { jobId: 'job1', error: 'OOM' };
    const failed = makeJob({ status: 'failed', errorMessage: 'OOM' });
    trainingJobService.updateJobStatus.mockResolvedValue(failed);

    const res = await trainingOrchestrator.failJob(req);

    expect(res).toBe(failed);
    expect(trainingJobService.updateJobStatus).toHaveBeenCalledWith(
      'job1',
      'failed',
      { errorMessage: 'OOM' }
    );
  });

  it('records the last checkpoint when provided', async () => {
    const req: WorkerFailedRequest = {
      jobId: 'job1',
      error: 'crash',
      lastCheckpoint: 's3://ckpt/last',
    };
    trainingJobRepository.findById.mockResolvedValue(makeJob({ currentEpoch: 5 }));
    trainingJobService.updateJobStatus.mockResolvedValue(makeJob({ status: 'failed' }));

    await trainingOrchestrator.failJob(req);

    expect(trainingOrchestrator.getCheckpoints('job1')).toEqual([
      { epoch: 5, uri: 's3://ckpt/last' },
    ]);
  });

  it('does not record a checkpoint when the job is gone', async () => {
    const req: WorkerFailedRequest = {
      jobId: 'job1',
      error: 'crash',
      lastCheckpoint: 's3://ckpt/last',
    };
    trainingJobRepository.findById.mockResolvedValue(null);
    trainingJobService.updateJobStatus.mockResolvedValue(makeJob({ status: 'failed' }));

    await trainingOrchestrator.failJob(req);
    expect(trainingOrchestrator.getCheckpoints('job1')).toEqual([]);
  });
});

// ===========================================================================
// recordCheckpoint / getCheckpoints
// ===========================================================================

describe('checkpoints', () => {
  it('records and accumulates checkpoints for a job', async () => {
    const c1: WorkerCheckpointRequest = { jobId: 'job1', epoch: 1, checkpointUri: 'a' };
    const c2: WorkerCheckpointRequest = { jobId: 'job1', epoch: 2, checkpointUri: 'b' };

    await trainingOrchestrator.recordCheckpoint(c1);
    await trainingOrchestrator.recordCheckpoint(c2);

    expect(trainingOrchestrator.getCheckpoints('job1')).toEqual([
      { epoch: 1, uri: 'a' },
      { epoch: 2, uri: 'b' },
    ]);
  });

  it('returns an empty array for an unknown job', () => {
    expect(trainingOrchestrator.getCheckpoints('unknown')).toEqual([]);
  });
});

// ===========================================================================
// recordHeartbeat
// ===========================================================================

describe('recordHeartbeat', () => {
  it('returns stop when the job is not found', async () => {
    const req: WorkerHeartbeatRequest = { jobId: 'job1', gpuUtil: 10, memoryUtil: 20 };
    trainingJobRepository.findById.mockResolvedValue(null);
    expect(await trainingOrchestrator.recordHeartbeat(req)).toBe('stop');
  });

  it('returns stop when the job is cancelled', async () => {
    const req: WorkerHeartbeatRequest = { jobId: 'job1', gpuUtil: 10, memoryUtil: 20 };
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'cancelled' }));
    expect(await trainingOrchestrator.recordHeartbeat(req)).toBe('stop');
  });

  it('returns ok and registers the worker when running', async () => {
    const req: WorkerHeartbeatRequest = {
      jobId: 'job1',
      gpuUtil: 55,
      memoryUtil: 60,
      workerId: 'hw1',
      device: 'cuda',
    };
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));

    expect(await trainingOrchestrator.recordHeartbeat(req)).toBe('ok');

    const workers = await trainingOrchestrator.listWorkers();
    const w = workers.workers.find((x) => x.workerId === 'hw1');
    expect(w?.gpuUtil).toBe(55);
    expect(w?.memoryUtil).toBe(60);
    expect(w?.device).toBe('cuda');
  });

  it('does not register a worker when workerId is missing but still checks cancel', async () => {
    const req: WorkerHeartbeatRequest = { jobId: 'job1', gpuUtil: 1, memoryUtil: 2 };
    trainingJobRepository.findById.mockResolvedValue(makeJob({ status: 'running' }));
    expect(await trainingOrchestrator.recordHeartbeat(req)).toBe('ok');
    const workers = await trainingOrchestrator.listWorkers();
    expect(workers.workers).toHaveLength(0);
  });
});

// ===========================================================================
// listWorkers
// ===========================================================================

describe('listWorkers', () => {
  beforeEach(() => {
    trainingJobRepository.findByStatus.mockResolvedValue([]);
    trainingJobRepository.findRunning.mockResolvedValue([]);
  });

  it('reports queue and run counts from the DB', async () => {
    trainingJobRepository.findByStatus.mockResolvedValue([makeJob(), makeJob()]);
    trainingJobRepository.findRunning.mockResolvedValue([makeJob()]);

    const res = await trainingOrchestrator.listWorkers();
    expect(res.queuedJobs).toBe(2);
    expect(res.runningJobs).toBe(1);
    expect(res.workers).toHaveLength(0);
  });

  it('marks a worker busy and embeds running-job info', async () => {
    await trainingOrchestrator.recordHeartbeat({
      jobId: 'job1',
      gpuUtil: 30,
      memoryUtil: 40,
      workerId: 'busy1',
      device: 'cuda',
    });
    // recordHeartbeat called findById once; reset and provide the running job
    // for both that lookup and the listWorkers enrichment.
    trainingJobRepository.findById.mockResolvedValue(
      makeJob({ id: 'job1', status: 'running', baseModel: 'smolvla' as TrainingJob['baseModel'] })
    );

    const res = await trainingOrchestrator.listWorkers();
    const w = res.workers.find((x) => x.workerId === 'busy1');
    expect(w?.status).toBe('busy');
    expect(w?.currentJob?.id).toBe('job1');
    expect(w?.currentJob?.ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it('keeps a worker idle when its current job is not running', async () => {
    await trainingOrchestrator.recordHeartbeat({
      jobId: 'job1',
      gpuUtil: 0,
      memoryUtil: 0,
      workerId: 'idle1',
      device: 'cpu',
    });
    trainingJobRepository.findById.mockResolvedValue(makeJob({ id: 'job1', status: 'completed' }));

    const res = await trainingOrchestrator.listWorkers();
    const w = res.workers.find((x) => x.workerId === 'idle1');
    expect(w?.status).toBe('idle');
    expect(w?.currentJob).toBeNull();
  });
});

// ===========================================================================
// getEta
// ===========================================================================

describe('getEta', () => {
  it('returns null for an unknown job', () => {
    expect(trainingOrchestrator.getEta('nope')).toBeNull();
  });

  it('returns the ETA state after a job starts', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ id: 'job1' }));
    await trainingOrchestrator.startJob('job1');
    const eta = trainingOrchestrator.getEta('job1');
    expect(eta).not.toBeNull();
    expect(eta?.currentStep).toBe(0);
  });

  it('clears ETA state when a job completes', async () => {
    trainingJobRepository.findById.mockResolvedValue(makeJob({ id: 'job1' }));
    await trainingOrchestrator.startJob('job1');
    expect(trainingOrchestrator.getEta('job1')).not.toBeNull();

    trainingJobRepository.findById.mockResolvedValue(makeJob({ id: 'job1', status: 'running' }));
    trainingJobService.updateJobStatus.mockResolvedValue(makeJob({ status: 'completed' }));
    datasetRepository.findById.mockResolvedValue(makeDataset());
    modelVersionRepository.create.mockResolvedValue({ id: 'mv' } as never);

    await trainingOrchestrator.completeJob({
      jobId: 'job1',
      artifactUri: 'uri',
      finalMetrics: { finalLoss: 0.1, trainingTimeSeconds: 1, bestEpoch: 1 },
    });

    expect(trainingOrchestrator.getEta('job1')).toBeNull();
  });
});

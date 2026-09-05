/**
 * @file training-init-from.test.ts
 * @description TASK-239: a run that starts from an existing model instead of a
 *   foundation checkpoint. Covers the two refusals (a base model the weights
 *   cannot load into, and a submission naming two starting points), the
 *   `initFrom` the worker is handed on claim, the lineage edge the produced
 *   ModelVersion inherits, the manifest field that makes such a run
 *   reproducible — and, on its own, that a run naming NEITHER field goes
 *   through exactly as it did before.
 * @feature vla
 *
 * Only the I/O boundary is mocked (repositories, prisma, NATS); the service,
 * the orchestrator, the export service and the route all run for real, because
 * the thing under test is precisely how they hand this field to each other.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockTrainingJobRepository,
  mockDatasetRepository,
  mockSimSceneRepository,
  mockModelVersionRepository,
  mockModelCheckpointRepository,
  mockEpisodeRewardRepository,
  mockPrisma,
} = vi.hoisted(() => ({
  mockTrainingJobRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    findByStatus: vi.fn(),
    findRunning: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockDatasetRepository: { findById: vi.fn(), update: vi.fn() },
  mockSimSceneRepository: { findById: vi.fn() },
  mockModelVersionRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdWithRelations: vi.fn(),
  },
  mockModelCheckpointRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    listByJob: vi.fn(async () => []),
    attachToModelVersion: vi.fn(async () => 0),
  },
  mockEpisodeRewardRepository: { upsertMany: vi.fn() },
  mockPrisma: {
    trainingJobDataset: { findMany: vi.fn(async () => []), createMany: vi.fn() },
    dataset: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../repositories/index.js', () => ({
  trainingJobRepository: mockTrainingJobRepository,
  datasetRepository: mockDatasetRepository,
  simSceneRepository: mockSimSceneRepository,
  modelVersionRepository: mockModelVersionRepository,
  modelCheckpointRepository: mockModelCheckpointRepository,
  episodeRewardRepository: mockEpisodeRewardRepository,
}));

vi.mock('../messaging/index.js', () => ({
  natsClient: { isConnected: vi.fn(() => false) },
  getJobQueue: vi.fn(() => {
    throw new Error('NATS not available in tests');
  }),
}));

vi.mock('../database/index.js', () => ({ prisma: mockPrisma }));

import { trainingJobService } from '../services/TrainingJobService.js';
import { trainingOrchestrator } from '../services/TrainingOrchestrator.js';
import { trainingRunExportService } from '../services/TrainingRunExportService.js';
import { trainingRoutes } from '../routes/training.routes.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The registered GR00T fine-tune a second run wants to improve on. */
const GROOT_MODEL = {
  id: 'mv-groot',
  skillId: null,
  trainingJobId: 'job-groot',
  name: 'GR00T-N1.7 AppleToPlate',
  sourceKind: 'training' as const,
  parentModelVersionId: null,
  modelType: 'vla' as const,
  version: 'v1757000000',
  artifactUri: 's3://vla-models/g1-apple-pnp/v1757000000/',
  trainingMetrics: {},
  validationMetrics: {},
  deploymentStatus: 'staging' as const,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  trainingJob: { id: 'job-groot', baseModel: 'groot_n1_7' },
};

const CHECKPOINT = {
  id: 'ckpt-14',
  modelVersionId: null,
  trainingJobId: 'job-groot',
  epoch: 14,
  uri: 's3://vla-models/job-groot/epoch-14/',
  metrics: { loss: 0.21 },
  createdAt: new Date('2026-09-02T00:00:00Z'),
};

const READY_DATASET = {
  id: 'ds-apple',
  name: 'g1_apple_pnp',
  status: 'ready',
  skillId: 'skill-1',
};

function submission(over: Record<string, unknown> = {}) {
  return {
    datasetId: 'ds-apple',
    baseModel: 'groot_n1_7' as const,
    fineTuneMethod: 'lora' as const,
    ...over,
  };
}

/** A job row as the repositories hand it back. */
function jobRow(over: Record<string, unknown> = {}) {
  return {
    id: 'job-new',
    kind: 'supervised',
    datasetId: 'ds-apple',
    baseModel: 'groot_n1_7',
    fineTuneMethod: 'lora',
    sceneId: null,
    twinId: null,
    hyperparameters: { learning_rate: 1e-4, batch_size: 32, epochs: 100 },
    gpuRequirements: { count: 1, memory: 40 },
    status: 'pending',
    progress: 0,
    metrics: {},
    createdAt: new Date('2026-09-05T00:00:00Z'),
    updatedAt: new Date('2026-09-05T00:00:00Z'),
    initFromModelVersionId: null,
    initFromCheckpointId: null,
    ...over,
  };
}

/** A Dataset row shaped as the export service reads it. */
function datasetRow() {
  return {
    id: 'ds-apple',
    name: 'g1_apple_pnp',
    status: 'ready',
    fps: 30,
    lerobotVersion: 'v2.1',
    robotTypeId: 'rt-g1',
    storagePath: 'a1b2/',
    huggingFaceRepoId: 'neodem/g1_apple_pnp',
    sourceRevision: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    sourceLicense: 'cc-by-4.0',
    infoJson: JSON.stringify({ robot_type: 'unitree_g1', features: {} }),
    validationJson: null,
    totalFrames: 1000,
    demonstrationCount: 10,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/training', trainingRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockDatasetRepository.findById.mockResolvedValue(READY_DATASET);
  mockTrainingJobRepository.create.mockImplementation(async (input: Record<string, unknown>) =>
    jobRow(input)
  );
  mockTrainingJobRepository.update.mockImplementation(
    async (id: string, patch: Record<string, unknown>) => jobRow({ id, ...patch })
  );
  mockPrisma.trainingJobDataset.findMany.mockResolvedValue([]);
  mockModelCheckpointRepository.listByJob.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Submission: the two refusals
// ---------------------------------------------------------------------------

describe('submitJob — starting from an existing model', () => {
  it('refuses a model whose base model is not this run\'s, in one quotable sentence', async () => {
    mockModelVersionRepository.findByIdWithRelations.mockResolvedValue(GROOT_MODEL);

    await expect(
      trainingJobService.submitJob(
        submission({ baseModel: 'pi0', initFromModelVersionId: 'mv-groot' })
      )
    ).rejects.toThrow(
      'This run trains pi0 but "GR00T-N1.7 AppleToPlate" holds groot_n1_7 weights, '
        + 'so it cannot start from that model.'
    );

    // Refused before anything is written — the point of checking at submission.
    expect(mockTrainingJobRepository.create).not.toHaveBeenCalled();
  });

  it('refuses a submission that names both a model and a checkpoint', async () => {
    await expect(
      trainingJobService.submitJob(
        submission({ initFromModelVersionId: 'mv-groot', initFromCheckpointId: 'ckpt-14' })
      )
    ).rejects.toThrow(
      'A run starts from one set of weights: pass either initFromModelVersionId or '
        + 'initFromCheckpointId, not both.'
    );
    expect(mockTrainingJobRepository.create).not.toHaveBeenCalled();
    // Neither row is even read: the pair is refused on its shape.
    expect(mockModelVersionRepository.findByIdWithRelations).not.toHaveBeenCalled();
    expect(mockModelCheckpointRepository.findById).not.toHaveBeenCalled();
  });

  it('refuses a checkpoint written by a run of another base model', async () => {
    mockModelCheckpointRepository.findById.mockResolvedValue(CHECKPOINT);
    mockTrainingJobRepository.findById.mockResolvedValue(
      jobRow({ id: 'job-groot', baseModel: 'groot_n1_7' })
    );

    await expect(
      trainingJobService.submitJob(
        submission({ baseModel: 'smolvla', initFromCheckpointId: 'ckpt-14' })
      )
    ).rejects.toThrow(
      'This run trains smolvla but checkpoint epoch 14 was written by a groot_n1_7 run, '
        + 'so it cannot start from that checkpoint.'
    );
    expect(mockTrainingJobRepository.create).not.toHaveBeenCalled();
  });

  it('refuses a field that is not an id string', async () => {
    await expect(
      trainingJobService.submitJob(submission({ initFromModelVersionId: 42 }))
    ).rejects.toThrow(
      'initFromModelVersionId must be an id string, or null to start from the base model.'
    );
  });

  it('refuses an id that names no model', async () => {
    mockModelVersionRepository.findByIdWithRelations.mockResolvedValue(null);
    await expect(
      trainingJobService.submitJob(submission({ initFromModelVersionId: 'mv-gone' }))
    ).rejects.toThrow('Model version not found: mv-gone');
  });

  it('persists the model id when the base models agree', async () => {
    mockModelVersionRepository.findByIdWithRelations.mockResolvedValue(GROOT_MODEL);

    const job = await trainingJobService.submitJob(
      submission({ initFromModelVersionId: 'mv-groot' })
    );

    expect(mockTrainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseModel: 'groot_n1_7',
        initFromModelVersionId: 'mv-groot',
        initFromCheckpointId: null,
      })
    );
    expect(job.initFromModelVersionId).toBe('mv-groot');
  });

  it('accepts an imported model the registry cannot attribute to a base model', async () => {
    // No TrainingJob on this server, so nothing records the architecture. The
    // check compares what is recorded rather than inventing a verdict — this
    // is the hand-registered GR00T checkpoint the feature exists to continue.
    mockModelVersionRepository.findByIdWithRelations.mockResolvedValue({
      ...GROOT_MODEL,
      sourceKind: 'imported' as const,
      trainingJobId: null,
      trainingJob: undefined,
    });

    await trainingJobService.submitJob(submission({ initFromModelVersionId: 'mv-groot' }));

    expect(mockTrainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ initFromModelVersionId: 'mv-groot' })
    );
  });
});

// ---------------------------------------------------------------------------
// A run that names neither field — its own acceptance criterion
// ---------------------------------------------------------------------------

describe('a job with neither field set', () => {
  it('is submitted exactly as before, and reads no registry row at all', async () => {
    const job = await trainingJobService.submitJob(submission());

    expect(mockTrainingJobRepository.create).toHaveBeenCalledWith({
      datasetId: 'ds-apple',
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
      hyperparameters: { learning_rate: 1e-4, batch_size: 32, epochs: 100 },
      gpuRequirements: { count: 1, memory: 40 },
      totalEpochs: 100,
      initFromModelVersionId: null,
      initFromCheckpointId: null,
    });
    // The lookups are skipped entirely, not merely ignored.
    expect(mockModelVersionRepository.findByIdWithRelations).not.toHaveBeenCalled();
    expect(mockModelCheckpointRepository.findById).not.toHaveBeenCalled();
    expect(await trainingJobService.resolveInitFrom(job)).toBeNull();
  });

  it('produces a ModelVersion with no parent and sourceKind "training"', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue(jobRow());
    mockDatasetRepository.findById.mockResolvedValue(READY_DATASET);
    mockModelVersionRepository.create.mockImplementation(
      async (input: Record<string, unknown>) => ({ id: 'mv-new', ...input })
    );

    await trainingOrchestrator.completeJob({
      jobId: 'job-new',
      artifactUri: 's3://vla-models/job-new/final/',
      finalMetrics: { finalLoss: 0.1, bestEpoch: 9 },
    });

    expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentModelVersionId: null, sourceKind: 'training' })
    );
  });

  it('is claimed with initFrom: null and an otherwise unchanged payload', async () => {
    vi.spyOn(trainingOrchestrator, 'claimNextPendingJob').mockResolvedValue(jobRow() as never);
    mockDatasetRepository.findById.mockResolvedValue({
      id: 'ds-apple',
      name: 'g1_apple_pnp',
      storagePath: 'a1b2/',
      lerobotVersion: 'v2.1',
    });

    const res = await request(createApp())
      .post('/api/training/workers/claim')
      .send({ workerId: 'gpu-1' });

    expect(res.status).toBe(200);
    expect(res.body.initFrom).toBeNull();
    expect(res.body.dataset).toEqual({
      id: 'ds-apple',
      storagePath: 'a1b2/',
      lerobotVersion: 'v2.1',
    });
  });

  it('exports a manifest whose job.initFrom is null', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue(jobRow());
    mockPrisma.dataset.findUnique.mockResolvedValue(datasetRow());

    const manifest = await trainingRunExportService.buildManifest('job-new');

    expect(manifest?.job.initFrom).toBeNull();
    expect(manifest?.job.baseModel).toBe('groot_n1_7');
  });
});

// ---------------------------------------------------------------------------
// The worker payload
// ---------------------------------------------------------------------------

describe('the worker payload', () => {
  it('resolves a model to its artifact URI', async () => {
    mockModelVersionRepository.findById.mockResolvedValue(GROOT_MODEL);

    expect(
      await trainingJobService.resolveInitFrom({ initFromModelVersionId: 'mv-groot' })
    ).toEqual({
      artifactUri: 's3://vla-models/g1-apple-pnp/v1757000000/',
      kind: 'model',
      id: 'mv-groot',
    });
  });

  it('resolves a checkpoint to its URI and epoch', async () => {
    mockModelCheckpointRepository.findById.mockResolvedValue(CHECKPOINT);

    expect(
      await trainingJobService.resolveInitFrom({ initFromCheckpointId: 'ckpt-14' })
    ).toEqual({
      artifactUri: 's3://vla-models/job-groot/epoch-14/',
      kind: 'checkpoint',
      id: 'ckpt-14',
      epoch: 14,
    });
  });

  it('resolves to null when the row it names is gone, rather than refusing the claim', async () => {
    mockModelVersionRepository.findById.mockResolvedValue(null);
    expect(
      await trainingJobService.resolveInitFrom({ initFromModelVersionId: 'mv-gone' })
    ).toBeNull();
  });

  it('carries initFrom beside the dataset on /workers/claim', async () => {
    vi.spyOn(trainingOrchestrator, 'claimNextPendingJob').mockResolvedValue(
      jobRow({ initFromCheckpointId: 'ckpt-14' }) as never
    );
    mockModelCheckpointRepository.findById.mockResolvedValue(CHECKPOINT);
    mockDatasetRepository.findById.mockResolvedValue({
      id: 'ds-apple',
      name: 'g1_apple_pnp',
      storagePath: 'a1b2/',
      lerobotVersion: 'v2.1',
    });

    const res = await request(createApp())
      .post('/api/training/workers/claim')
      .send({ workerId: 'gpu-1' });

    expect(res.status).toBe(200);
    expect(res.body.initFrom).toEqual({
      artifactUri: 's3://vla-models/job-groot/epoch-14/',
      kind: 'checkpoint',
      id: 'ckpt-14',
      epoch: 14,
    });
    // Everything a worker already read is untouched beside it.
    expect(res.body.job.id).toBe('job-new');
    expect(res.body.dataset.storagePath).toBe('a1b2/');
  });
});

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

describe('completeJob lineage', () => {
  it('makes the starting model the parent of the model the run produced', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue(
      jobRow({ initFromModelVersionId: 'mv-groot' })
    );
    mockDatasetRepository.findById.mockResolvedValue(READY_DATASET);
    mockModelVersionRepository.create.mockImplementation(
      async (input: Record<string, unknown>) => ({ id: 'mv-new', ...input })
    );

    const result = await trainingOrchestrator.completeJob({
      jobId: 'job-new',
      artifactUri: 's3://vla-models/job-new/final/',
      finalMetrics: { finalLoss: 0.08, bestEpoch: 12 },
    });

    expect(result.modelVersionId).toBe('mv-new');
    expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trainingJobId: 'job-new',
        parentModelVersionId: 'mv-groot',
        // A run off another model produces a derived model, not a fresh one.
        sourceKind: 'derived',
      })
    );
  });

  it('sets no parent for a run resumed from a checkpoint', async () => {
    // The checkpoint belongs to a run whose own ModelVersion may not exist
    // yet; claiming a parent that is not where the weights came from would be
    // worse than the gap.
    mockTrainingJobRepository.findById.mockResolvedValue(
      jobRow({ initFromCheckpointId: 'ckpt-14' })
    );
    mockDatasetRepository.findById.mockResolvedValue(READY_DATASET);
    mockModelVersionRepository.create.mockImplementation(
      async (input: Record<string, unknown>) => ({ id: 'mv-new', ...input })
    );

    await trainingOrchestrator.completeJob({
      jobId: 'job-new',
      artifactUri: 's3://vla-models/job-new/final/',
      finalMetrics: { finalLoss: 0.08, bestEpoch: 12 },
    });

    expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentModelVersionId: null, sourceKind: 'training' })
    );
  });
});

// ---------------------------------------------------------------------------
// Export manifest
// ---------------------------------------------------------------------------

describe('the export manifest', () => {
  it('states what the run started from', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue(
      jobRow({ initFromCheckpointId: 'ckpt-14', status: 'running' })
    );
    mockPrisma.dataset.findUnique.mockResolvedValue(datasetRow());
    mockModelCheckpointRepository.findById.mockResolvedValue(CHECKPOINT);

    const manifest = await trainingRunExportService.buildManifest('job-new');

    expect(manifest?.job.initFrom).toEqual({
      artifactUri: 's3://vla-models/job-groot/epoch-14/',
      kind: 'checkpoint',
      id: 'ckpt-14',
      epoch: 14,
    });
    // baseModel is the architecture, not the origin: it still says groot_n1_7.
    expect(manifest?.job.baseModel).toBe('groot_n1_7');
  });

  it('warns when the weights the run named can no longer be located', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue(
      jobRow({ initFromModelVersionId: 'mv-gone' })
    );
    mockPrisma.dataset.findUnique.mockResolvedValue(datasetRow());
    mockModelVersionRepository.findById.mockResolvedValue(null);

    const manifest = await trainingRunExportService.buildManifest('job-new');

    expect(manifest?.job.initFrom).toBeNull();
    expect(
      manifest?.warnings.some((w) => w.includes('no longer exists'))
    ).toBe(true);
  });
});

/**
 * @file SyntheticDataService.test.ts
 * @description Unit tests for SyntheticDataService — synthetic data job lifecycle
 *   (submit/get/list/cancel/progress/complete/fail), sim-to-real validation,
 *   domain randomization presets, Isaac Lab status, and job statistics.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  CreateSyntheticJobRequest,
  ValidateSimToRealRequest,
} from '../../types/synthetic.types.js';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client (the service does `new PrismaClient()`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    syntheticJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    simToRealValidation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    syntheticJob = mockPrisma.syntheticJob;
    simToRealValidation = mockPrisma.simToRealValidation;
  },
}));

import { SyntheticDataService } from '../SyntheticDataService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type JobRow = {
  id: string;
  task: string;
  embodiment: string;
  trajectoryCount: number;
  config: unknown;
  status: string;
  progress: number;
  generatedCount: number;
  successfulCount: number;
  failedCount: number;
  processingRate: number | null;
  estimatedTimeRemaining: number | null;
  outputDatasetId: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    task: 'pick_place',
    embodiment: 'so101',
    trajectoryCount: 100,
    config: {},
    status: 'pending',
    progress: 0,
    generatedCount: 0,
    successfulCount: 0,
    failedCount: 0,
    processingRate: null,
    estimatedTimeRemaining: null,
    outputDatasetId: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

type ValidationRow = {
  id: string;
  syntheticJobId: string;
  modelVersionId: string;
  validationDate: Date;
  simSuccessRate: number;
  realSuccessRate: number;
  domainGapScore: number;
  realTestCount: number;
  taskCategories: unknown;
  perTaskMetrics: unknown;
  notes: string | null;
};

function makeValidationRow(overrides: Partial<ValidationRow> = {}): ValidationRow {
  return {
    id: 'val-1',
    syntheticJobId: 'job-1',
    modelVersionId: 'mv-1',
    validationDate: new Date('2026-01-02T00:00:00Z'),
    simSuccessRate: 0.9,
    realSuccessRate: 0.7,
    domainGapScore: 0.2,
    realTestCount: 50,
    taskCategories: ['pick_place'],
    perTaskMetrics: null,
    notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fresh instance helper — SyntheticDataService has a private constructor and is
// a singleton, but we want fresh in-memory EventEmitter state per test.
// ---------------------------------------------------------------------------

function freshService(): SyntheticDataService {
  // The constructor is private at the TS level; bypass via getInstance reset is
  // not exposed, so we reflectively construct a new instance for isolation.
  const Ctor = SyntheticDataService as unknown as { new (): SyntheticDataService };
  return new Ctor();
}

beforeEach(() => {
  vi.clearAllMocks();
  // Fake timers prevent the simulateJobExecution setInterval (2s) from firing
  // and keep the test file from hanging on a live interval.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ===========================================================================
// submitJob
// ===========================================================================

describe('submitJob', () => {
  const baseRequest: CreateSyntheticJobRequest = {
    task: 'pick_place',
    embodiment: 'so101',
    trajectoryCount: 100,
  };

  it('creates a job with merged defaults and emits job:created', async () => {
    const svc = freshService();
    const row = makeJobRow();
    mockPrisma.syntheticJob.create.mockResolvedValue(row);
    // simulateJobExecution looks the job up then updates it
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(row);
    mockPrisma.syntheticJob.update.mockResolvedValue(row);

    const created = vi.fn();
    svc.on('job:created', created);

    const result = await svc.submitJob(baseRequest);

    expect(result.id).toBe('job-1');
    expect(result.task).toBe('pick_place');
    expect(created).toHaveBeenCalledTimes(1);

    // The persisted config must merge defaults
    expect(mockPrisma.syntheticJob.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.syntheticJob.create.mock.calls[0][0] as {
      data: { config: { outputFormat: string; headless: boolean; simulation: unknown } };
    };
    expect(arg.data.config.outputFormat).toBe('lerobot_v3');
    expect(arg.data.config.headless).toBe(true);
    expect(arg.data.config.simulation).toMatchObject({ timestep: 0.01, numEnvs: 16 });
  });

  it('honors explicit outputFormat, headless and domain randomization overrides', async () => {
    const svc = freshService();
    const row = makeJobRow();
    mockPrisma.syntheticJob.create.mockResolvedValue(row);
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(row);
    mockPrisma.syntheticJob.update.mockResolvedValue(row);

    await svc.submitJob({
      ...baseRequest,
      outputFormat: 'hdf5',
      headless: false,
      domainRandomization: {
        physics: { massRange: [0.1, 0.2], frictionRange: [1, 1], dampingRange: [1, 1] },
      },
    });

    const arg = mockPrisma.syntheticJob.create.mock.calls[0][0] as {
      data: {
        config: {
          outputFormat: string;
          headless: boolean;
          domainRandomization: { physics: { massRange: [number, number] } };
        };
      };
    };
    expect(arg.data.config.outputFormat).toBe('hdf5');
    expect(arg.data.config.headless).toBe(false);
    expect(arg.data.config.domainRandomization.physics.massRange).toEqual([0.1, 0.2]);
  });
});

// ===========================================================================
// getJob
// ===========================================================================

describe('getJob', () => {
  it('returns a mapped job when found', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(
      makeJobRow({ id: 'abc', status: 'running', processingRate: 1.5 })
    );

    const job = await svc.getJob('abc');
    expect(job?.id).toBe('abc');
    expect(job?.status).toBe('running');
    expect(job?.processingRate).toBe(1.5);
  });

  it('returns undefined when not found', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(null);
    expect(await svc.getJob('missing')).toBeUndefined();
  });
});

// ===========================================================================
// listJobs
// ===========================================================================

describe('listJobs', () => {
  it('applies filters and returns jobs with total', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findMany.mockResolvedValue([makeJobRow(), makeJobRow({ id: 'job-2' })]);
    mockPrisma.syntheticJob.count.mockResolvedValue(2);

    const result = await svc.listJobs({
      status: 'pending',
      task: 'pick_place',
      embodiment: 'so101',
      limit: 10,
      offset: 5,
    });

    expect(result.total).toBe(2);
    expect(result.jobs).toHaveLength(2);
    const findArg = mockPrisma.syntheticJob.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
    };
    expect(findArg.where).toEqual({
      status: 'pending',
      task: 'pick_place',
      embodiment: 'so101',
    });
    expect(findArg.skip).toBe(5);
    expect(findArg.take).toBe(10);
  });

  it('uses an empty where clause when no filters given', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findMany.mockResolvedValue([]);
    mockPrisma.syntheticJob.count.mockResolvedValue(0);

    const result = await svc.listJobs();
    expect(result.total).toBe(0);
    const findArg = mockPrisma.syntheticJob.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findArg.where).toEqual({});
  });
});

// ===========================================================================
// cancelJob
// ===========================================================================

describe('cancelJob', () => {
  it('returns undefined when the job does not exist', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(null);
    expect(await svc.cancelJob('nope')).toBeUndefined();
  });

  it('returns the job unchanged (no update) when already completed', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'completed' }));

    const result = await svc.cancelJob('job-1');
    expect(result?.status).toBe('completed');
    expect(mockPrisma.syntheticJob.update).not.toHaveBeenCalled();
  });

  it('returns the job unchanged when already failed', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'failed' }));

    const result = await svc.cancelJob('job-1');
    expect(result?.status).toBe('failed');
    expect(mockPrisma.syntheticJob.update).not.toHaveBeenCalled();
  });

  it('cancels a running job and emits job:cancelled', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'running' }));
    mockPrisma.syntheticJob.update.mockResolvedValue(makeJobRow({ status: 'cancelled' }));

    const cancelled = vi.fn();
    svc.on('job:cancelled', cancelled);

    const result = await svc.cancelJob('job-1');
    expect(result?.status).toBe('cancelled');
    expect(mockPrisma.syntheticJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'cancelled' },
    });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// updateJobProgress
// ===========================================================================

describe('updateJobProgress', () => {
  it('returns undefined when the job is missing', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(null);
    const result = await svc.updateJobProgress({
      jobId: 'x',
      progress: 10,
      generatedCount: 1,
      successfulCount: 1,
      failedCount: 0,
    });
    expect(result).toBeUndefined();
  });

  it('computes a processing rate when generatedCount > 0 and emits job:progress', async () => {
    const svc = freshService();
    const startedAt = new Date(Date.now() - 10_000); // 10s ago
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'running', startedAt }));
    mockPrisma.syntheticJob.update.mockResolvedValue(makeJobRow({ status: 'running', progress: 50 }));

    const progress = vi.fn();
    svc.on('job:progress', progress);

    await svc.updateJobProgress({
      jobId: 'job-1',
      progress: 50,
      generatedCount: 20,
      successfulCount: 19,
      failedCount: 1,
    });

    const updateArg = mockPrisma.syntheticJob.update.mock.calls[0][0] as {
      data: { processingRate?: number; progress: number };
    };
    expect(updateArg.data.progress).toBe(50);
    expect(updateArg.data.processingRate).toBeGreaterThan(0);
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('leaves processingRate undefined when generatedCount is 0', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'running' }));
    mockPrisma.syntheticJob.update.mockResolvedValue(makeJobRow({ status: 'running' }));

    await svc.updateJobProgress({
      jobId: 'job-1',
      progress: 0,
      generatedCount: 0,
      successfulCount: 0,
      failedCount: 0,
    });

    const updateArg = mockPrisma.syntheticJob.update.mock.calls[0][0] as {
      data: { processingRate?: number };
    };
    expect(updateArg.data.processingRate).toBeUndefined();
  });
});

// ===========================================================================
// completeJob
// ===========================================================================

describe('completeJob', () => {
  it('returns undefined when the job is missing', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(null);
    expect(await svc.completeJob('x', 'ds-1', 10)).toBeUndefined();
  });

  it('marks the job completed with 100 progress and emits job:completed', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'running' }));
    mockPrisma.syntheticJob.update.mockResolvedValue(
      makeJobRow({ status: 'completed', progress: 100, outputDatasetId: 'ds-1', successfulCount: 95 })
    );

    const completed = vi.fn();
    svc.on('job:completed', completed);

    const result = await svc.completeJob('job-1', 'ds-1', 95);
    expect(result?.status).toBe('completed');
    expect(result?.progress).toBe(100);
    expect(result?.outputDatasetId).toBe('ds-1');

    const updateArg = mockPrisma.syntheticJob.update.mock.calls[0][0] as {
      data: { status: string; progress: number; outputDatasetId: string; successfulCount: number };
    };
    expect(updateArg.data.status).toBe('completed');
    expect(updateArg.data.progress).toBe(100);
    expect(updateArg.data.successfulCount).toBe(95);
    expect(completed).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// failJob
// ===========================================================================

describe('failJob', () => {
  it('returns undefined when the job is missing', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(null);
    expect(await svc.failJob('x', 'boom')).toBeUndefined();
  });

  it('marks the job failed with the error message and emits job:failed', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findUnique.mockResolvedValue(makeJobRow({ status: 'running' }));
    mockPrisma.syntheticJob.update.mockResolvedValue(
      makeJobRow({ status: 'failed', errorMessage: 'out of memory' })
    );

    const failed = vi.fn();
    svc.on('job:failed', failed);

    const result = await svc.failJob('job-1', 'out of memory');
    expect(result?.status).toBe('failed');
    expect(result?.errorMessage).toBe('out of memory');

    const updateArg = mockPrisma.syntheticJob.update.mock.calls[0][0] as {
      data: { status: string; errorMessage: string };
    };
    expect(updateArg.data.errorMessage).toBe('out of memory');
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// recordSimToRealValidation
// ===========================================================================

describe('recordSimToRealValidation', () => {
  const baseValidationReq: ValidateSimToRealRequest = {
    syntheticJobId: 'job-1',
    modelVersionId: 'mv-1',
    simSuccessRate: 0.9,
    realSuccessRate: 0.7,
    realTestCount: 50,
    taskCategories: ['pick_place'],
  };

  it('computes the domain gap score and emits validation:recorded', async () => {
    const svc = freshService();
    mockPrisma.simToRealValidation.create.mockResolvedValue(
      makeValidationRow({ domainGapScore: 0.2 })
    );

    const recorded = vi.fn();
    svc.on('validation:recorded', recorded);

    const result = await svc.recordSimToRealValidation(baseValidationReq);
    expect(result.domainGapScore).toBeCloseTo(0.2);

    const createArg = mockPrisma.simToRealValidation.create.mock.calls[0][0] as {
      data: { domainGapScore: number };
    };
    expect(createArg.data.domainGapScore).toBeCloseTo(0.2);
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('computes per-task gaps when perTaskMetrics provided', async () => {
    const svc = freshService();
    mockPrisma.simToRealValidation.create.mockResolvedValue(
      makeValidationRow({
        perTaskMetrics: { pick_place: { simSuccess: 0.9, realSuccess: 0.6, gap: 0.3 } },
      })
    );

    await svc.recordSimToRealValidation({
      ...baseValidationReq,
      perTaskMetrics: { pick_place: { simSuccess: 0.9, realSuccess: 0.6 } },
    });

    const createArg = mockPrisma.simToRealValidation.create.mock.calls[0][0] as {
      data: { perTaskMetrics: Record<string, { gap: number }> };
    };
    expect(createArg.data.perTaskMetrics.pick_place.gap).toBeCloseTo(0.3);
  });
});

// ===========================================================================
// getValidationsForJob / getValidation / listValidations
// ===========================================================================

describe('validation queries', () => {
  it('getValidationsForJob maps all rows', async () => {
    const svc = freshService();
    mockPrisma.simToRealValidation.findMany.mockResolvedValue([
      makeValidationRow({ id: 'v1' }),
      makeValidationRow({ id: 'v2' }),
    ]);

    const result = await svc.getValidationsForJob('job-1');
    expect(result.map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('getValidation returns mapped row or undefined', async () => {
    const svc = freshService();
    mockPrisma.simToRealValidation.findUnique.mockResolvedValueOnce(makeValidationRow({ id: 'v9' }));
    expect((await svc.getValidation('v9'))?.id).toBe('v9');

    mockPrisma.simToRealValidation.findUnique.mockResolvedValueOnce(null);
    expect(await svc.getValidation('missing')).toBeUndefined();
  });

  it('listValidations builds where filters for model/minReal/maxGap', async () => {
    const svc = freshService();
    mockPrisma.simToRealValidation.findMany.mockResolvedValue([makeValidationRow()]);

    await svc.listValidations({
      modelVersionId: 'mv-1',
      minRealSuccessRate: 0.5,
      maxDomainGap: 0.3,
    });

    const findArg = mockPrisma.simToRealValidation.findMany.mock.calls[0][0] as {
      where: { modelVersionId: string; realSuccessRate: unknown; domainGapScore: unknown };
    };
    expect(findArg.where.modelVersionId).toBe('mv-1');
    expect(findArg.where.realSuccessRate).toEqual({ gte: 0.5 });
    expect(findArg.where.domainGapScore).toEqual({ lte: 0.3 });
  });

  it('listValidations uses an empty where clause without options', async () => {
    const svc = freshService();
    mockPrisma.simToRealValidation.findMany.mockResolvedValue([]);
    await svc.listValidations();
    const findArg = mockPrisma.simToRealValidation.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findArg.where).toEqual({});
  });
});

// ===========================================================================
// Domain randomization presets
// ===========================================================================

describe('domain randomization presets', () => {
  it('getDRPresets returns the built-in presets', () => {
    const svc = freshService();
    const presets = svc.getDRPresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.map((p) => p.id)).toContain('moderate');
  });

  it('getDRPreset returns a known preset and undefined for unknown', () => {
    const svc = freshService();
    expect(svc.getDRPreset('conservative')?.id).toBe('conservative');
    expect(svc.getDRPreset('does-not-exist')).toBeUndefined();
  });

  it('getRecommendedPreset returns a task-specific preset', () => {
    const svc = freshService();
    // open_drawer is only recommended by the aggressive preset
    expect(svc.getRecommendedPreset('open_drawer').id).toBe('aggressive');
  });

  it('getRecommendedPreset falls back to moderate when no preset matches', () => {
    const svc = freshService();
    // insert_peg is not in any preset's recommendedFor list
    expect(svc.getRecommendedPreset('insert_peg').id).toBe('moderate');
  });
});

// ===========================================================================
// checkIsaacLabStatus
// ===========================================================================

describe('checkIsaacLabStatus', () => {
  it('reports available with queue/active counts on success', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.count
      .mockResolvedValueOnce(2) // active
      .mockResolvedValueOnce(3); // queue

    const status = await svc.checkIsaacLabStatus();
    expect(status.available).toBe(true);
    expect(status.activeJobs).toBe(2);
    expect(status.queueLength).toBe(3);
    expect(status.version).toBe('0.4.0');
  });

  it('reports unavailable when a count query throws', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.count.mockRejectedValue(new Error('db down'));

    const status = await svc.checkIsaacLabStatus();
    expect(status.available).toBe(false);
    expect(status.activeJobs).toBe(0);
    expect(status.queueLength).toBe(0);
  });
});

// ===========================================================================
// getJobStatistics
// ===========================================================================

describe('getJobStatistics', () => {
  it('aggregates counts by status and computes success rate over completed jobs', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findMany.mockResolvedValue([
      makeJobRow({ id: 'a', status: 'completed', generatedCount: 100, successfulCount: 90 }),
      makeJobRow({ id: 'b', status: 'completed', generatedCount: 100, successfulCount: 80 }),
      makeJobRow({ id: 'c', status: 'running', generatedCount: 50, successfulCount: 50 }),
      makeJobRow({ id: 'd', status: 'failed' }),
    ]);

    const stats = await svc.getJobStatistics();
    expect(stats.total).toBe(4);
    expect(stats.byStatus.completed).toBe(2);
    expect(stats.byStatus.running).toBe(1);
    expect(stats.byStatus.failed).toBe(1);
    // only completed jobs contribute to totals: 170/200
    expect(stats.totalTrajectories).toBe(200);
    expect(stats.successRate).toBeCloseTo(0.85);
  });

  it('returns a zero success rate when there are no completed trajectories', async () => {
    const svc = freshService();
    mockPrisma.syntheticJob.findMany.mockResolvedValue([makeJobRow({ status: 'pending' })]);

    const stats = await svc.getJobStatistics();
    expect(stats.totalTrajectories).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.byStatus.pending).toBe(1);
  });
});

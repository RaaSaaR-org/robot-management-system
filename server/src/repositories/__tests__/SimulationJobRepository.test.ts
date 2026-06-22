/**
 * @file SimulationJobRepository.test.ts
 * @description Unit tests for SimulationJobRepository — the Prisma-backed data
 *   access layer for simulation jobs and their captured frames. Mocks only the
 *   prisma singleton (the I/O boundary) and lets the pure dbToDomain mapper run
 *   for real to cover db-row -> domain mapping.
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimJob, SimFrame, SimMetrics } from '../../services/SimulationService.js';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma singleton (repo imports `prisma` from
// '../database/index.js'). Mock only the models/methods the repo touches.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    simulationJob: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    simulationFrame: {
      createMany: vi.fn(),
    },
  } as {
    simulationJob: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    simulationFrame: {
      createMany: ReturnType<typeof vi.fn>;
    };
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { SimulationJobRepository, simulationJobRepository } from '../SimulationJobRepository.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2026-06-22T10:00:00.000Z');
const later = new Date('2026-06-22T11:00:00.000Z');

function makeDomainJob(overrides: Partial<SimJob> = {}): SimJob {
  return {
    jobId: 'job-1',
    modelId: 'model-1',
    environment: 'kitchen',
    rolloutCount: 5,
    backend: 'mujoco',
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** A full db-row shape that dbToDomain accepts. */
function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    modelId: 'model-1',
    environment: 'kitchen',
    backend: 'mujoco',
    rolloutCount: 5,
    status: 'completed',
    progress: 100,
    successRate: 0.9,
    avgSteps: 42,
    collisionCount: 1,
    avgDuration: 12.5,
    simToRealGap: 0.05,
    totalEpisodes: 10,
    successfulEpisodes: 9,
    framesDir: '/frames/job-1',
    failureReason: null,
    createdAt: now,
    updatedAt: later,
    frames: [{ episode: 0, step: 0, filename: 'f0.png' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('SimulationJobRepository.create', () => {
  it('maps the domain job onto the prisma create data shape', async () => {
    mockPrisma.simulationJob.create.mockResolvedValue({});
    const repo = new SimulationJobRepository();

    await repo.create(
      makeDomainJob({ framesDir: '/frames/job-1', status: 'running', progress: 30 })
    );

    expect(mockPrisma.simulationJob.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.simulationJob.create).toHaveBeenCalledWith({
      data: {
        id: 'job-1',
        modelId: 'model-1',
        environment: 'kitchen',
        backend: 'mujoco',
        rolloutCount: 5,
        status: 'running',
        progress: 30,
        framesDir: '/frames/job-1',
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  it('coerces an undefined framesDir to null', async () => {
    mockPrisma.simulationJob.create.mockResolvedValue({});

    await simulationJobRepository.create(makeDomainJob());

    const arg = mockPrisma.simulationJob.create.mock.calls[0][0];
    expect(arg.data.framesDir).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('SimulationJobRepository.update', () => {
  it('only includes patch fields that are explicitly provided', async () => {
    mockPrisma.simulationJob.update.mockResolvedValue({});
    const repo = new SimulationJobRepository();

    await repo.update('job-1', { status: 'running', progress: 50 });

    expect(mockPrisma.simulationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'running', progress: 50 },
    });
  });

  it('passes through framesDir and failureReason including explicit nulls', async () => {
    mockPrisma.simulationJob.update.mockResolvedValue({});

    await simulationJobRepository.update('job-1', {
      framesDir: null,
      failureReason: 'boom',
    });

    expect(mockPrisma.simulationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { framesDir: null, failureReason: 'boom' },
    });
  });

  it('expands a metrics object into the flat db columns', async () => {
    mockPrisma.simulationJob.update.mockResolvedValue({});
    const metrics: SimMetrics & {
      totalEpisodes?: number;
      successfulEpisodes?: number;
    } = {
      successRate: 0.8,
      avgStepsToCompletion: 30,
      collisionCount: 2,
      avgEpisodeDuration: 9,
      simToRealGap: 0.1,
      totalEpisodes: 20,
      successfulEpisodes: 16,
    };

    await simulationJobRepository.update('job-1', { metrics });

    expect(mockPrisma.simulationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        successRate: 0.8,
        avgSteps: 30,
        collisionCount: 2,
        avgDuration: 9,
        simToRealGap: 0.1,
        totalEpisodes: 20,
        successfulEpisodes: 16,
      },
    });
  });

  it('defaults missing metrics extras (simToRealGap/totalEpisodes/...) to null', async () => {
    mockPrisma.simulationJob.update.mockResolvedValue({});

    await simulationJobRepository.update('job-1', {
      metrics: {
        successRate: 0.5,
        avgStepsToCompletion: 10,
        collisionCount: 0,
        avgEpisodeDuration: 4,
      },
    });

    expect(mockPrisma.simulationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        successRate: 0.5,
        avgSteps: 10,
        collisionCount: 0,
        avgDuration: 4,
        simToRealGap: null,
        totalEpisodes: null,
        successfulEpisodes: null,
      },
    });
  });

  it('nulls out every metric column when metrics is explicitly null', async () => {
    mockPrisma.simulationJob.update.mockResolvedValue({});

    await simulationJobRepository.update('job-1', { metrics: null });

    expect(mockPrisma.simulationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        successRate: null,
        avgSteps: null,
        collisionCount: null,
        avgDuration: null,
        simToRealGap: null,
        totalEpisodes: null,
        successfulEpisodes: null,
      },
    });
  });

  it('sends an empty data object when no patch fields are provided', async () => {
    mockPrisma.simulationJob.update.mockResolvedValue({});

    await simulationJobRepository.update('job-1', {});

    expect(mockPrisma.simulationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {},
    });
  });
});

// ---------------------------------------------------------------------------
// createFrames
// ---------------------------------------------------------------------------

describe('SimulationJobRepository.createFrames', () => {
  it('maps frames to createMany rows with the jobId attached', async () => {
    mockPrisma.simulationFrame.createMany.mockResolvedValue({ count: 2 });
    const frames: SimFrame[] = [
      { episode: 0, step: 1, file: 'a.png' },
      { episode: 1, step: 2, file: 'b.png' },
    ];

    await simulationJobRepository.createFrames('job-1', frames);

    expect(mockPrisma.simulationFrame.createMany).toHaveBeenCalledWith({
      data: [
        { jobId: 'job-1', episode: 0, step: 1, filename: 'a.png' },
        { jobId: 'job-1', episode: 1, step: 2, filename: 'b.png' },
      ],
    });
  });

  it('is a no-op when the frame list is empty', async () => {
    await simulationJobRepository.createFrames('job-1', []);
    expect(mockPrisma.simulationFrame.createMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('SimulationJobRepository.findAll', () => {
  it('queries with frame ordering + createdAt desc and maps every row', async () => {
    mockPrisma.simulationJob.findMany.mockResolvedValue([makeDbRow()]);

    const result = await simulationJobRepository.findAll();

    expect(mockPrisma.simulationJob.findMany).toHaveBeenCalledWith({
      include: { frames: { orderBy: [{ episode: 'asc' }, { step: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      jobId: 'job-1',
      modelId: 'model-1',
      environment: 'kitchen',
      rolloutCount: 5,
      backend: 'mujoco',
      status: 'completed',
      progress: 100,
      metrics: {
        successRate: 0.9,
        avgStepsToCompletion: 42,
        collisionCount: 1,
        avgEpisodeDuration: 12.5,
        simToRealGap: 0.05,
        totalEpisodes: 10,
        successfulEpisodes: 9,
      },
      frames: [{ episode: 0, step: 0, file: 'f0.png' }],
      framesDir: '/frames/job-1',
      createdAt: now,
      updatedAt: later,
    });
  });

  it('returns an empty array when there are no jobs', async () => {
    mockPrisma.simulationJob.findMany.mockResolvedValue([]);
    expect(await simulationJobRepository.findAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('SimulationJobRepository.findById', () => {
  it('queries findUnique by id with ordered frames and maps the row', async () => {
    mockPrisma.simulationJob.findUnique.mockResolvedValue(makeDbRow());

    const result = await simulationJobRepository.findById('job-1');

    expect(mockPrisma.simulationJob.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      include: { frames: { orderBy: [{ episode: 'asc' }, { step: 'asc' }] } },
    });
    expect(result?.jobId).toBe('job-1');
    expect(result?.metrics?.successRate).toBe(0.9);
  });

  it('returns null when the job does not exist', async () => {
    mockPrisma.simulationJob.findUnique.mockResolvedValue(null);
    expect(await simulationJobRepository.findById('missing')).toBeNull();
  });

  it('omits metrics when the row has no successRate/totalEpisodes', async () => {
    mockPrisma.simulationJob.findUnique.mockResolvedValue(
      makeDbRow({ successRate: null, totalEpisodes: null })
    );

    const result = await simulationJobRepository.findById('job-1');

    expect(result?.metrics).toBeUndefined();
  });

  it('omits frames when the row has an empty frame list', async () => {
    mockPrisma.simulationJob.findUnique.mockResolvedValue(makeDbRow({ frames: [] }));

    const result = await simulationJobRepository.findById('job-1');

    expect(result?.frames).toBeUndefined();
  });

  it('coerces a null framesDir to undefined in the domain object', async () => {
    mockPrisma.simulationJob.findUnique.mockResolvedValue(makeDbRow({ framesDir: null }));

    const result = await simulationJobRepository.findById('job-1');

    expect(result?.framesDir).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// markFailedOnBoot
// ---------------------------------------------------------------------------

describe('SimulationJobRepository.markFailedOnBoot', () => {
  it('updates queued/running jobs to failed and returns the affected count', async () => {
    mockPrisma.simulationJob.updateMany.mockResolvedValue({ count: 3 });

    const count = await simulationJobRepository.markFailedOnBoot();

    expect(mockPrisma.simulationJob.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'failed', failureReason: 'server restart' },
    });
    expect(count).toBe(3);
  });

  it('returns 0 when no jobs were in-flight', async () => {
    mockPrisma.simulationJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await simulationJobRepository.markFailedOnBoot()).toBe(0);
  });
});

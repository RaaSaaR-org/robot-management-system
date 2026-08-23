/**
 * @file TrainingJobService.mixture.test.ts
 * @description Submitting a job that names more than one dataset (TASK-220):
 *              the rows it writes, the mixture it refuses, and — the part that
 *              matters most — that a single-dataset submission is untouched.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../repositories/index.js', () => ({
  trainingJobRepository: { create: vi.fn(), findById: vi.fn(), update: vi.fn(), delete: vi.fn() },
  datasetRepository: { findById: vi.fn() },
  simSceneRepository: { findById: vi.fn() },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: { isConnected: vi.fn(() => false) },
  getJobQueue: vi.fn(),
}));

vi.mock('../../database/index.js', () => ({
  prisma: {
    dataset: { findMany: vi.fn(), findUnique: vi.fn() },
    trainingJobDataset: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { trainingJobService } from '../TrainingJobService.js';
import { MixtureIncompatibleError } from '../lerobot/datasetCompatibility.js';
import {
  trainingJobRepository as _trainingJobRepository,
  datasetRepository as _datasetRepository,
} from '../../repositories/index.js';
import { prisma as _prisma } from '../../database/index.js';

const trainingJobRepository = vi.mocked(_trainingJobRepository, true);
const datasetRepository = vi.mocked(_datasetRepository, true);
const prisma = _prisma as unknown as {
  dataset: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  trainingJobDataset: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function features(width: number, cameras: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    'observation.state': { dtype: 'float32', shape: [width] },
    action: { dtype: 'float32', shape: [width] },
  };
  for (const cam of cameras) out[cam] = { dtype: 'video', shape: [3, 480, 640] };
  return out;
}

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `dataset ${id}`,
    status: 'ready',
    fps: 30,
    lerobotVersion: 'v2.1',
    robotTypeId: 'rt-g1',
    robotType: { name: 'Unitree G1' },
    infoJson: JSON.stringify({
      robot_type: 'unitree_g1',
      features: features(43, ['observation.images.ego_view']),
    }),
    validationJson: null,
    ...over,
  };
}

const readyDataset = { id: 'ds-a', name: 'dataset ds-a', status: 'ready' };

function createdJob(over: Record<string, unknown> = {}) {
  return {
    id: 'job-new',
    kind: 'supervised',
    datasetId: 'ds-a',
    baseModel: 'groot_n1_7',
    fineTuneMethod: 'lora',
    hyperparameters: {},
    gpuRequirements: {},
    status: 'pending',
    progress: 0,
    metrics: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  datasetRepository.findById.mockResolvedValue(readyDataset as never);
  trainingJobRepository.create.mockResolvedValue(createdJob() as never);
  prisma.trainingJobDataset.createMany.mockResolvedValue({ count: 2 });
  prisma.trainingJobDataset.findMany.mockResolvedValue([]);
  trainingJobRepository.delete.mockResolvedValue(true as never);
});

// ===========================================================================
// The existing single-dataset path
// ===========================================================================

describe('a submission that names one dataset', () => {
  it('behaves exactly as before and writes no mixture rows', async () => {
    const job = await trainingJobService.submitJob({
      datasetId: 'ds-a',
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
    });

    expect(job.id).toBe('job-new');
    expect(trainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'ds-a', baseModel: 'smolvla' }),
    );
    // No compatibility read, no rows: the old path never touches either.
    expect(prisma.dataset.findMany).not.toHaveBeenCalled();
    expect(prisma.trainingJobDataset.createMany).not.toHaveBeenCalled();
  });

  it('still refuses a dataset that is not ready, with the same message', async () => {
    datasetRepository.findById.mockResolvedValue({ ...readyDataset, status: 'validating' } as never);
    await expect(
      trainingJobService.submitJob({
        datasetId: 'ds-a',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      }),
    ).rejects.toThrow('Dataset not ready: ds-a (status: validating)');
  });
});

// ===========================================================================
// Mixtures
// ===========================================================================

describe('a submission that names several datasets', () => {
  it('mirrors member 0 into datasetId and writes a row per member', async () => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a'), row('ds-b')]);

    await trainingJobService.submitJob({
      datasetIds: ['ds-a', 'ds-b'],
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
    });

    expect(trainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'ds-a' }),
    );
    expect(prisma.trainingJobDataset.createMany).toHaveBeenCalledWith({
      data: [
        { trainingJobId: 'job-new', datasetId: 'ds-a', weight: 1, position: 0 },
        { trainingJobId: 'job-new', datasetId: 'ds-b', weight: 1, position: 1 },
      ],
    });
  });

  it('keeps the weights the operator typed, in the order they gave', async () => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a'), row('ds-b')]);

    await trainingJobService.submitJob({
      mixture: [
        { datasetId: 'ds-b', weight: 3 },
        { datasetId: 'ds-a' },
      ],
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
    });

    expect(trainingJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'ds-b' }),
    );
    expect(prisma.trainingJobDataset.createMany).toHaveBeenCalledWith({
      data: [
        { trainingJobId: 'job-new', datasetId: 'ds-b', weight: 3, position: 0 },
        { trainingJobId: 'job-new', datasetId: 'ds-a', weight: 1, position: 1 },
      ],
    });
  });

  it('accepts a multi-embodiment mixture — different action widths are the point', async () => {
    prisma.dataset.findMany.mockResolvedValue([
      row('ds-a'),
      row('ds-b', {
        infoJson: JSON.stringify({
          robot_type: 'Unitree_G1',
          features: features(28, ['observation.images.cam_left_high']),
        }),
      }),
    ]);

    await expect(
      trainingJobService.submitJob({
        datasetIds: ['ds-a', 'ds-b'],
        baseModel: 'groot_n1_7',
        fineTuneMethod: 'lora',
      }),
    ).resolves.toMatchObject({ id: 'job-new' });
    expect(prisma.trainingJobDataset.createMany).toHaveBeenCalled();
  });

  it('refuses an incompatible mixture before writing anything, and carries the report', async () => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a', { fps: 25 }), row('ds-b', { fps: 30 })]);

    const submit = trainingJobService.submitJob({
      datasetIds: ['ds-a', 'ds-b'],
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
    });

    await expect(submit).rejects.toBeInstanceOf(MixtureIncompatibleError);
    await submit.catch((error: MixtureIncompatibleError) => {
      expect(error.message).toBe(error.report.headline);
      expect(error.report.verdict).toBe('incompatible');
    });
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
    expect(prisma.trainingJobDataset.createMany).not.toHaveBeenCalled();
  });

  it('refuses a mixture whose member is not ready', async () => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a'), row('ds-b', { status: 'failed' })]);

    await expect(
      trainingJobService.submitJob({
        datasetIds: ['ds-a', 'ds-b'],
        baseModel: 'groot_n1_7',
        fineTuneMethod: 'lora',
      }),
    ).rejects.toBeInstanceOf(MixtureIncompatibleError);
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// A mixture that could not be written
//
// The job row is created first, and a job with NO member rows is
// indistinguishable from an ordinary single-dataset job — `getJobDatasets`
// synthesises one member from `datasetId` precisely so callers never branch. So
// a half-written mixture does not look broken: it looks like a job on one
// dataset, and it would be claimed as one, trained as one, and reported as a
// success.
// ===========================================================================

describe('when the mixture rows cannot be written', () => {
  it('removes the job rather than leaving one that trains on a single dataset', async () => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a'), row('ds-b')]);
    prisma.trainingJobDataset.createMany.mockRejectedValue(new Error('deadlock detected'));

    await expect(
      trainingJobService.submitJob({
        datasetIds: ['ds-a', 'ds-b'],
        baseModel: 'groot_n1_7',
        fineTuneMethod: 'lora',
      }),
    ).rejects.toThrow('deadlock detected');

    expect(trainingJobRepository.delete).toHaveBeenCalledWith('job-new');
  });

  it('still reports the original failure when the cleanup also fails', async () => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a'), row('ds-b')]);
    prisma.trainingJobDataset.createMany.mockRejectedValue(new Error('deadlock detected'));
    trainingJobRepository.delete.mockRejectedValue(new Error('and the delete failed too'));

    await expect(
      trainingJobService.submitJob({
        datasetIds: ['ds-a', 'ds-b'],
        baseModel: 'groot_n1_7',
        fineTuneMethod: 'lora',
      }),
    ).rejects.toThrow('deadlock detected');
  });

  it('leaves a single-dataset job alone — it writes no rows to fail at', async () => {
    prisma.trainingJobDataset.createMany.mockRejectedValue(new Error('should never be called'));

    await expect(
      trainingJobService.submitJob({
        datasetId: 'ds-a',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      }),
    ).resolves.toMatchObject({ id: 'job-new' });
    expect(trainingJobRepository.delete).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Weights
//
// A weight is a sampling ratio, so finite-and-positive is the whole domain.
// The value worth testing is `Infinity`, because it needs no hostile client:
// `1e400` is a JSON number literal, `JSON.parse` yields `Infinity`, Postgres
// stores it in a `Float` without complaint, and the export manifest then
// divides by a total that excluded it and renders the result as
// `"normalizedWeight": null` — a member with no share, in a document a cluster
// is meant to execute.
// ===========================================================================

describe('mixture weights', () => {
  const submit = (weight: unknown) =>
    trainingJobService.submitJob({
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
      mixture: [
        { datasetId: 'ds-a', weight: weight as number },
        { datasetId: 'ds-b', weight: 1 },
      ],
    });

  beforeEach(() => {
    prisma.dataset.findMany.mockResolvedValue([row('ds-a'), row('ds-b')]);
  });

  it('refuses Infinity — which is what the JSON literal 1e400 parses to', async () => {
    expect(JSON.parse('{"w":1e400}').w).toBe(Infinity); // the premise, not decoration
    await expect(submit(Infinity)).rejects.toThrow(
      'Mixture weight for ds-a must be a positive number; received Infinity',
    );
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
    expect(prisma.trainingJobDataset.createMany).not.toHaveBeenCalled();
  });

  it('refuses a negative weight, which would otherwise sum plausibly', async () => {
    await expect(submit(-1)).rejects.toThrow(/received -1/);
    expect(trainingJobRepository.create).not.toHaveBeenCalled();
  });

  it('refuses zero — a member sampled never is a member left out silently', async () => {
    await expect(submit(0)).rejects.toThrow(/received 0/);
  });

  it('refuses NaN', async () => {
    await expect(submit(Number.NaN)).rejects.toThrow(/received NaN/);
  });

  it('refuses a weight that is not a number at all', async () => {
    await expect(submit('3')).rejects.toThrow(/received "3"/);
  });

  it('defaults a missing weight to 1 rather than refusing it', async () => {
    await trainingJobService.submitJob({
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
      mixture: [{ datasetId: 'ds-a' }, { datasetId: 'ds-b' }],
    });

    expect(prisma.trainingJobDataset.createMany).toHaveBeenCalledWith({
      data: [
        { trainingJobId: 'job-new', datasetId: 'ds-a', weight: 1, position: 0 },
        { trainingJobId: 'job-new', datasetId: 'ds-b', weight: 1, position: 1 },
      ],
    });
  });

  it('keeps a fractional weight exactly as given — it is not rounded or normalised here', async () => {
    await trainingJobService.submitJob({
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
      mixture: [
        { datasetId: 'ds-a', weight: 0.25 },
        { datasetId: 'ds-b', weight: 3 },
      ],
    });

    expect(prisma.trainingJobDataset.createMany).toHaveBeenCalledWith({
      data: [
        { trainingJobId: 'job-new', datasetId: 'ds-a', weight: 0.25, position: 0 },
        { trainingJobId: 'job-new', datasetId: 'ds-b', weight: 3, position: 1 },
      ],
    });
  });
});

// ===========================================================================
// Reading the mixture back
// ===========================================================================

describe('getJobDatasets', () => {
  it('synthesises one member for a job that has no mixture rows', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([]);
    datasetRepository.findById.mockResolvedValue({ id: 'ds-a', name: 'Apple to plate' } as never);

    await expect(trainingJobService.getJobDatasets('job-1', 'ds-a')).resolves.toEqual([
      { datasetId: 'ds-a', name: 'Apple to plate', weight: 1, position: 0 },
    ]);
  });

  it('maps every stored row to a member', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([
      { datasetId: 'ds-a', weight: 3, position: 0, dataset: { name: 'A' } },
      { datasetId: 'ds-b', weight: 1, position: 1, dataset: { name: 'B' } },
    ]);

    await expect(trainingJobService.getJobDatasets('job-1', 'ds-a')).resolves.toEqual([
      { datasetId: 'ds-a', name: 'A', weight: 3, position: 0 },
      { datasetId: 'ds-b', name: 'B', weight: 1, position: 1 },
    ]);
  });

  it('asks the database for them in position order', async () => {
    // The ordering is done by the QUERY, and the mock returns whatever array it
    // was handed regardless of the query object — so feeding it a pre-sorted
    // array and asserting the output is sorted proves only that `.map` keeps
    // order. Position is what decides which member becomes `job.datasetId` and
    // which weight belongs to which dataset in the export manifest, so the
    // `orderBy` is the thing worth pinning.
    prisma.trainingJobDataset.findMany.mockResolvedValue([]);
    await trainingJobService.getJobDatasets('job-1', 'ds-a');

    expect(prisma.trainingJobDataset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { trainingJobId: 'job-1' },
        orderBy: { position: 'asc' },
      }),
    );
  });

  it('returns nothing for a job with no dataset at all (sim_rl)', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([]);
    await expect(trainingJobService.getJobDatasets('job-sim', null)).resolves.toEqual([]);
  });
});

describe('getJobDatasetsForJobs', () => {
  it('answers a whole page without one query per job', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([
      { trainingJobId: 'job-2', datasetId: 'ds-a', weight: 1, position: 0, dataset: { name: 'A' } },
      { trainingJobId: 'job-2', datasetId: 'ds-b', weight: 2, position: 1, dataset: { name: 'B' } },
    ]);
    prisma.dataset.findMany.mockResolvedValue([{ id: 'ds-solo', name: 'Solo' }]);

    const result = await trainingJobService.getJobDatasetsForJobs([
      { id: 'job-1', datasetId: 'ds-solo' },
      { id: 'job-2', datasetId: 'ds-a' },
      { id: 'job-3', datasetId: null },
    ]);

    expect(prisma.trainingJobDataset.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.dataset.findMany).toHaveBeenCalledTimes(1);
    expect(result.get('job-1')).toEqual([
      { datasetId: 'ds-solo', name: 'Solo', weight: 1, position: 0 },
    ]);
    expect(result.get('job-2')?.map((m) => m.datasetId)).toEqual(['ds-a', 'ds-b']);
    expect(result.get('job-3')).toEqual([]);
  });

  it('does no work for an empty page', async () => {
    await expect(trainingJobService.getJobDatasetsForJobs([])).resolves.toEqual(new Map());
    expect(prisma.trainingJobDataset.findMany).not.toHaveBeenCalled();
  });
});

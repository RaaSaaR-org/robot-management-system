/**
 * @file dataset-views-routes.test.ts
 * @description The four things a dataset view has to get right end to end
 *   (TASK-240): a selection validated against the parent it forks, a view
 *   frozen the moment a training job cites it and a 409 that names that job,
 *   a reward-threshold selection that does NOT move when the scores are
 *   recomputed, and an export manifest that states the ROOT's uri plus the
 *   selection so a cluster elsewhere can reproduce the arm.
 * @feature datasets
 *
 * Only the I/O boundary is faked — Prisma, the repositories, object storage,
 * NATS. The routes, `DatasetService`, `DatasetViewService`, the job service and
 * the export service all run for real, because what is under test is precisely
 * how they hand a view to each other. The parent dataset is a real (tiny)
 * directory on disk, so the episode lengths a frame range is validated against
 * are read the way they are read in production.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// A stand-in for the Dataset table, shared by every mocked boundary
// ---------------------------------------------------------------------------

const { store, rewards, flags, jobs, jobDatasets } = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  rewards: [] as Array<{ episodeIndex: number; score: number }>,
  flags: [] as Array<{ episodeIndex: number; reviewDecision: string | null }>,
  jobs: new Map<string, Record<string, unknown>>(),
  jobDatasets: [] as Array<{ trainingJobId: string; datasetId: string; weight: number; position: number }>,
}));

let nextId = 0;

/** `where` support limited to what this feature's queries actually use. */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    const value = row[key];
    if (condition && typeof condition === 'object' && 'in' in (condition as object)) {
      if (!(condition as { in: unknown[] }).in.includes(value)) return false;
    } else if (condition !== value) {
      return false;
    }
  }
  return true;
}

vi.mock('../database/index.js', () => ({
  prisma: {
    dataset: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = store.get(where.id);
        return row ? { ...row } : null;
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        [...store.values()].filter((row) => matches(row, where)).map((row) => ({ ...row })),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        nextId += 1;
        const row = {
          id: `view-${nextId}`,
          description: null,
          skillId: null,
          qualityScore: null,
          infoJson: '{}',
          statsJson: '{}',
          annotationsJson: '[]',
          huggingFaceRepoId: null,
          sourceRevision: null,
          sourceLicense: null,
          importMode: null,
          importErrorJson: null,
          validationJson: null,
          kind: 'materialized',
          parentDatasetId: null,
          selectionJson: null,
          frozenAt: null,
          materializedPath: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.set(row.id as string, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.get(where.id);
        if (!row) throw new Error(`no such dataset ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = store.get(where.id);
        store.delete(where.id);
        return row;
      }),
    },
    datasetEpisodeFlag: {
      findMany: vi.fn(async () => flags.map((f) => ({ ...f }))),
    },
    trainingJob: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        [...jobs.values()].filter((row) => matches(row, where)).map((row) => ({ ...row })),
      ),
    },
    trainingJobDataset: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        jobDatasets
          .filter((row) => matches(row as unknown as Record<string, unknown>, where))
          .map((row) => ({ ...row, dataset: { ...store.get(row.datasetId)! } })),
      ),
      createMany: vi.fn(async ({ data }: { data: typeof jobDatasets }) => {
        jobDatasets.push(...data);
        return { count: data.length };
      }),
    },
  },
}));

/** The repository barrel, backed by the same store the fake Prisma uses. */
vi.mock('../repositories/index.js', () => ({
  datasetRepository: {
    findById: vi.fn(async (id: string) => {
      const row = store.get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        ...row,
        description: row.description ?? undefined,
        skillId: row.skillId ?? undefined,
        infoJson: JSON.parse(row.infoJson as string),
        statsJson: JSON.parse(row.statsJson as string),
        validation: row.validationJson ? JSON.parse(row.validationJson as string) : undefined,
      };
    }),
    create: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async (id: string) => store.delete(id)),
  },
  robotTypeRepository: { findById: vi.fn(async () => null) },
  skillDefinitionRepository: { findById: vi.fn(async () => null) },
  trainingJobRepository: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      const job = {
        id: `job-${jobs.size + 1}`,
        status: 'pending',
        kind: input.kind ?? 'supervised',
        createdAt: new Date(),
        ...input,
      };
      jobs.set(job.id, job);
      return job;
    }),
    findById: vi.fn(async (id: string) => jobs.get(id) ?? null),
    delete: vi.fn(async (id: string) => jobs.delete(id)),
  },
  simSceneRepository: { findById: vi.fn() },
  modelVersionRepository: { findById: vi.fn(), findByIdWithRelations: vi.fn(), create: vi.fn() },
  modelCheckpointRepository: { findById: vi.fn(), listByJob: vi.fn(async () => []) },
}));

vi.mock('../repositories/EpisodeRewardRepository.js', () => ({
  episodeRewardRepository: {
    // Read at the moment the view is created, and never again — the point of
    // the test below.
    findByDataset: vi.fn(async () => rewards.map((r) => ({ ...r }))),
  },
}));

vi.mock('../storage/model-storage.js', () => ({
  BUCKETS: { TRAINING_DATASETS: 'training-datasets' },
  modelStorage: { deleteDataset: vi.fn() },
}));

vi.mock('../storage/rustfs-client.js', () => ({
  isRustFSInitialized: vi.fn(() => false),
  getRustFSClient: vi.fn(),
}));

vi.mock('../messaging/index.js', () => ({
  natsClient: { isConnected: vi.fn(() => false), getKV: vi.fn(), getJetStream: vi.fn() },
  getJobQueue: vi.fn(() => null),
  JetStreamJobQueue: class {},
}));

vi.mock('../messaging/kv-stores.js', () => ({
  KV_STORE_NAMES: { JOB_PROGRESS: 'JOB_PROGRESS' },
  kvGet: vi.fn(),
  kvPut: vi.fn(),
}));

import { datasetViewRoutes } from '../routes/dataset-views.routes.js';
import { datasetService } from '../services/DatasetService.js';
import { trainingJobService } from '../services/TrainingJobService.js';
import { trainingRunExportService } from '../services/TrainingRunExportService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Four episodes of 100, 200, 300 and 400 frames, at 10 fps. */
const EPISODE_LENGTHS = [100, 200, 300, 400];
let parentPath = '';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetViewRoutes);
  return app;
}

function parentRow(): Record<string, unknown> {
  return {
    id: 'ds-parent',
    name: 'apple pick-and-place',
    description: null,
    robotTypeId: 'rt-g1',
    skillId: null,
    storagePath: parentPath,
    lerobotVersion: 'v2.1',
    fps: 10,
    totalFrames: 1000,
    totalDuration: 100,
    demonstrationCount: 4,
    qualityScore: 80,
    infoJson: JSON.stringify({
      robot_type: 'unitree_g1',
      features: {
        'observation.state': { dtype: 'float32', shape: [43] },
        action: { dtype: 'float32', shape: [43] },
      },
    }),
    statsJson: '{}',
    annotationsJson: '[]',
    status: 'ready',
    huggingFaceRepoId: null,
    sourceRevision: null,
    sourceLicense: 'apache-2.0',
    importMode: null,
    importErrorJson: null,
    validationJson: JSON.stringify({
      validatedAt: '2026-09-01T00:00:00.000Z',
      breakdown: { demonstrationCount: 40, duration: 30, diversity: 20, formatCompliance: 10, total: 100 },
      report: {
        valid: true,
        lerobotVersion: 'v2.1',
        errors: [],
        warnings: [],
        imageKeys: ['observation.images.ego_view'],
        files: [],
        observedStateWidth: 43,
        observedActionWidth: 43,
      },
    }),
    kind: 'materialized',
    parentDatasetId: null,
    selectionJson: null,
    frozenAt: null,
    materializedPath: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

beforeAll(async () => {
  parentPath = await mkdtemp(join(tmpdir(), 'view-parent-'));
  await mkdir(join(parentPath, 'meta'), { recursive: true });
  await writeFile(
    join(parentPath, 'meta', 'episodes.jsonl'),
    EPISODE_LENGTHS.map((length, i) => JSON.stringify({ episode_index: i, length })).join('\n'),
  );
  await writeFile(join(parentPath, 'meta', 'info.json'), JSON.stringify({ fps: 10 }));
});

afterAll(async () => {
  await rm(parentPath, { recursive: true, force: true });
});

beforeEach(() => {
  store.clear();
  jobs.clear();
  jobDatasets.length = 0;
  rewards.length = 0;
  flags.length = 0;
  nextId = 0;
  store.set('ds-parent', parentRow());
});

// ---------------------------------------------------------------------------
// Selection validation
// ---------------------------------------------------------------------------

describe('POST /api/datasets/:id/views', () => {
  it('creates a view that writes no bytes and derives its counts from the parent', async () => {
    const res = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'the two long ones',
        selection: { episodes: [{ episodeIndex: 2 }, { episodeIndex: 3 }], origin: { kind: 'manual' } },
      });

    expect(res.status).toBe(201);
    expect(res.body.view).toMatchObject({
      kind: 'view',
      parentDatasetId: 'ds-parent',
      rootDatasetId: 'ds-parent',
      parentDemonstrationCount: 4,
      demonstrationCount: 2,
      // 300 + 400 frames at 10 fps.
      totalFrames: 700,
      totalDuration: 70,
      frozenAt: null,
    });
    // The whole point of the feature: a fork owns no bytes.
    expect(store.get(res.body.view.id)!.storagePath).toBe('');
    expect(store.get(res.body.view.id)!.materializedPath).toBeNull();
  });

  it('serves one view on its own, and 400s for a row that is not a view', async () => {
    const created = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'just the first',
        selection: { episodes: [{ episodeIndex: 0 }], origin: { kind: 'manual' } },
      });
    const viewId = created.body.view.id as string;

    const one = await request(createApp()).get(`/api/datasets/views/${viewId}`);
    expect(one.status).toBe(200);
    expect(one.body.view).toMatchObject({ id: viewId, parentName: 'apple pick-and-place' });

    const notAView = await request(createApp()).get('/api/datasets/views/ds-parent');
    expect(notAView.status).toBe(400);
    expect(notAView.body.code).toBe('VIEW_NOT_A_VIEW');
  });

  it('refuses an episodeIndex the parent does not have', async () => {
    const res = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'off the end',
        selection: { episodes: [{ episodeIndex: 1 }, { episodeIndex: 9 }], origin: { kind: 'manual' } },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VIEW_EPISODE_OUT_OF_RANGE');
    expect(res.body.message).toContain('4 episode(s)');
    // Nothing was written — a refused selection must not leave a row behind.
    expect(store.size).toBe(1);
  });

  it('refuses a frame range that runs past the end of the episode it trims', async () => {
    const res = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'too long a trim',
        // Episode 0 is 100 frames; 0..150 is not inside it.
        selection: { episodes: [{ episodeIndex: 0, start: 0, end: 150 }], origin: { kind: 'manual' } },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VIEW_EPISODE_OUT_OF_RANGE');
    expect(res.body.message).toContain('100 frames long');
  });

  it('refuses a selection of nothing', async () => {
    const res = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({ name: 'empty', selection: { episodes: [], origin: { kind: 'manual' } } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VIEW_EMPTY_SELECTION');
  });
});

// ---------------------------------------------------------------------------
// Freeze on cite
// ---------------------------------------------------------------------------

describe('freeze on cite', () => {
  async function createView(): Promise<string> {
    const res = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'arm A',
        selection: { episodes: [{ episodeIndex: 0 }, { episodeIndex: 1 }], origin: { kind: 'manual' } },
      });
    expect(res.status).toBe(201);
    return res.body.view.id as string;
  }

  it('sets frozenAt when a training job cites the view, and stays idempotent', async () => {
    const viewId = await createView();
    expect(store.get(viewId)!.frozenAt).toBeNull();

    await trainingJobService.submitJob({
      datasetId: viewId,
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
    });

    const frozenAt = store.get(viewId)!.frozenAt as Date;
    expect(frozenAt).toBeInstanceOf(Date);

    await trainingJobService.submitJob({
      datasetId: viewId,
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
    });
    // Idempotent: the second citation does not re-stamp the first one's pin.
    expect(store.get(viewId)!.frozenAt).toBe(frozenAt);
  });

  it('refuses to delete a frozen view with a 409 that names the citing job', async () => {
    const viewId = await createView();
    const job = await trainingJobService.submitJob({
      datasetId: viewId,
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
    });

    const res = await request(createApp()).delete(`/api/datasets/views/${viewId}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain(job.id);
    expect(res.body.message).toContain('Duplicate it as a new view');
    // Still there: a refused delete that deleted anyway would be the worst of
    // both answers.
    expect(store.has(viewId)).toBe(true);

    // And the ordinary dataset delete — a view IS a dataset row, so it has its
    // own endpoint too — refuses for the same reason rather than walking past
    // the guard.
    await expect(datasetService.delete(viewId)).rejects.toThrow(job.id);
    expect(store.has(viewId)).toBe(true);
  });

  it('deletes a view nothing cites', async () => {
    const viewId = await createView();
    const res = await request(createApp()).delete(`/api/datasets/views/${viewId}`);
    expect(res.status).toBe(200);
    expect(store.has(viewId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// from-rewards: resolved once, not a live query
// ---------------------------------------------------------------------------

describe('POST /api/datasets/:id/views/from-rewards', () => {
  it('stores the episodes the threshold chose, and does not change when the scores are recomputed', async () => {
    rewards.push(
      { episodeIndex: 0, score: 0.91 },
      { episodeIndex: 1, score: 0.42 },
      { episodeIndex: 2, score: 0.77 },
      { episodeIndex: 3, score: 0.10 },
    );

    const created = await request(createApp())
      .post('/api/datasets/ds-parent/views/from-rewards')
      .send({ name: 'reward >= 0.7', rewardType: 'robometer', minScore: 0.7 });

    expect(created.status).toBe(201);
    expect(created.body.view.selection).toEqual({
      episodes: [{ episodeIndex: 0 }, { episodeIndex: 2 }],
      origin: { kind: 'reward', rewardType: 'robometer', minScore: 0.7 },
    });

    // A later reward job rewrites every score. The rule that made this view is
    // now satisfied by a completely different set of episodes.
    rewards.length = 0;
    rewards.push(
      { episodeIndex: 0, score: 0.05 },
      { episodeIndex: 1, score: 0.99 },
      { episodeIndex: 2, score: 0.01 },
      { episodeIndex: 3, score: 0.98 },
    );

    const listed = await request(createApp()).get('/api/datasets/ds-parent/views');
    expect(listed.status).toBe(200);
    expect(listed.body.views).toHaveLength(1);
    // Unmoved. `origin` still records the rule for a human; `episodes` is the
    // truth, and the truth is what the run trained on.
    expect(listed.body.views[0].selection.episodes).toEqual([
      { episodeIndex: 0 },
      { episodeIndex: 2 },
    ]);
    expect(listed.body.views[0].resolvedEpisodes).toEqual([
      { episodeIndex: 0 },
      { episodeIndex: 2 },
    ]);
  });

  it('builds a selection from operator flags, keeping everything not marked remove', async () => {
    flags.push(
      { episodeIndex: 1, reviewDecision: 'remove' },
      { episodeIndex: 3, reviewDecision: 'keep' },
    );

    const res = await request(createApp())
      .post('/api/datasets/ds-parent/views/from-flags')
      .send({ name: 'not the bad one', decision: 'remove' });

    expect(res.status).toBe(201);
    expect(res.body.view.selection).toEqual({
      episodes: [{ episodeIndex: 0 }, { episodeIndex: 2 }, { episodeIndex: 3 }],
      origin: { kind: 'flags', decision: 'remove' },
    });
  });
});

// ---------------------------------------------------------------------------
// What a view says about itself on the ordinary dataset endpoints
// ---------------------------------------------------------------------------

describe('a view in a dataset response', () => {
  it('reports derived counts and its parent validation, and never claims its own', async () => {
    const created = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'arm A',
        selection: { episodes: [{ episodeIndex: 2 }], origin: { kind: 'manual' } },
      });
    const viewId = created.body.view.id as string;

    const response = await datasetService.get(viewId);

    expect(response).toMatchObject({
      kind: 'view',
      parentDatasetId: 'ds-parent',
      parent: { id: 'ds-parent', name: 'apple pick-and-place', demonstrationCount: 4 },
      // Derived, not inherited: one episode of 300 frames at 10 fps.
      demonstrationCount: 1,
      totalFrames: 300,
      totalDuration: 30,
      frozenAt: null,
    });
    expect(response!.selection).toEqual({
      episodes: [{ episodeIndex: 2 }],
      origin: { kind: 'manual' },
    });
    // Nothing has ever validated a view — it has no files. What it shows is
    // the report for the dataset its episodes are indices into, so the number
    // it puts on screen was measured by somebody, against those same bytes.
    expect(response!.validation).toMatchObject({
      valid: true,
      validatedAt: '2026-09-01T00:00:00.000Z',
      imageKeys: ['observation.images.ego_view'],
    });
    expect(response!.qualityBreakdown).toMatchObject({ total: 100 });
    // And the row itself holds no validation of its own to have claimed.
    expect(store.get(viewId)!.validationJson).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A view as a mixture member
// ---------------------------------------------------------------------------

describe('compatibility', () => {
  it('judges a view on its ROOT axes, while still naming the view the caller cited', async () => {
    const created = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'arm A',
        selection: { episodes: [{ episodeIndex: 0 }], origin: { kind: 'manual' } },
      });
    const viewId = created.body.view.id as string;

    const report = await trainingJobService.checkMixture([
      { datasetId: viewId },
      { datasetId: 'ds-parent' },
    ]);

    // The view row itself has no fps, no widths and no cameras — every axis
    // below comes from the dataset its episodes are indices into. Judged on
    // the view's own empty columns, these two would have read as a blocking
    // mismatch with each other.
    expect(report.verdict).toBe('identical');
    expect(report.datasetIds).toEqual([viewId, 'ds-parent']);
    const fps = report.axes.find((a) => a.axis === 'fps')!;
    expect(fps.values.map((v) => v.value)).toEqual(['10 fps', '10 fps']);
    expect(fps.values[0]).toMatchObject({ datasetId: viewId, datasetName: 'arm A' });
    const action = report.axes.find((a) => a.axis === 'actionWidth')!;
    expect(action.values.map((v) => v.value)).toEqual(['43', '43']);
  });
});

// ---------------------------------------------------------------------------
// The export manifest
// ---------------------------------------------------------------------------

describe('the export manifest for a run citing a view', () => {
  it('states the root uri plus the selection, and stays honest about portability', async () => {
    const created = await request(createApp())
      .post('/api/datasets/ds-parent/views')
      .send({
        name: 'arm A',
        selection: {
          episodes: [{ episodeIndex: 1 }, { episodeIndex: 3, start: 10, end: 200 }],
          origin: { kind: 'agent', actorId: 'agent-7', rationale: 'the two cleanest grasps' },
        },
      });
    expect(created.status).toBe(201);
    const viewId = created.body.view.id as string;

    const job = await trainingJobService.submitJob({
      datasetId: viewId,
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
    });

    const manifest = await trainingRunExportService.buildManifest(job.id);
    expect(manifest).not.toBeNull();
    const member = manifest!.datasets[0];

    // The locator is the ROOT's, because that is where the bytes are.
    expect(member.uri).toBe(`file://${parentPath}`);
    expect(member.datasetId).toBe(viewId);
    expect(member.name).toBe('arm A');
    // A view of a file:// parent is not portable either.
    expect(member.portable).toBe(false);
    // The axes come from the root, which is the only row that has any.
    expect(member.fps).toBe(10);
    expect(member.actionWidth).toBe(43);
    expect(member.lerobotVersion).toBe('v2.1');
    expect(member.license).toBe('apache-2.0');
    // The counts are the view's own: what the run trained on.
    expect(member.totalEpisodes).toBe(2);
    expect(member.totalFrames).toBe(200 + 190);

    expect(member.selection).toMatchObject({
      viewDatasetId: viewId,
      rootDatasetId: 'ds-parent',
      episodes: [{ episodeIndex: 1 }, { episodeIndex: 3, start: 10, end: 200 }],
      origin: { kind: 'agent', actorId: 'agent-7', rationale: 'the two cleanest grasps' },
    });
    expect(member.selection!.frozenAt).toEqual(expect.any(String));

    // And the warning a reader who ignores `selection` most needs.
    expect(manifest!.warnings.join(' ')).toContain('is a VIEW of "apple pick-and-place"');
  });

  it('leaves an ordinary dataset manifest entry saying selection: null', async () => {
    const job = await trainingJobService.submitJob({
      datasetId: 'ds-parent',
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
    });
    const manifest = await trainingRunExportService.buildManifest(job.id);
    expect(manifest!.datasets[0].selection).toBeNull();
  });
});

/**
 * @file experiments-routes.integration.test.ts
 * @description The experiment loop (TASK-242) over HTTP against a real temp
 *   SQLite database: an agent proposes, a person approves (views frozen, one
 *   job per arm, compliance-logged), fake completed jobs and sim evaluations
 *   drive the arms to `scored`, and real Rating, EvaluationEpisode (robotId
 *   null, source 'sim') and verdict Comment rows come out — tenant-stamped.
 *   The training worker and the simulator are the only fakes.
 * @feature training
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TENANT_SCOPED_MODELS } from '../database/client.js';
import { tenantStore } from '../middleware/tenantContext.js';
import type { SimJob } from '../services/SimulationService.js';

const TENANT = 'tenant-a';
const getTenantId = (): string | undefined => tenantStore.getStore()?.tenantId;

const h = vi.hoisted(() => {
  let job = 0;
  let sim = 0;
  return {
    holder: { client: undefined as unknown },
    submitJob: vi.fn(async () => ({ id: `tj-${++job}` })),
    cancelJob: vi.fn(async () => ({})),
    submitEvaluation: vi.fn(() => ({ job: { jobId: `sim-${++sim}` }, taskPrompt: 'move the apple to the plate' })),
    logSystemEvent: vi.fn(async (_p: unknown) => ({})),
    logAIDecision: vi.fn(async (_p: unknown) => ({})),
  };
});

vi.mock('../database/index.js', () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (h.holder.client as Record<string | symbol, unknown>)[prop] }),
}));
vi.mock('../services/ComplianceLogService.js', () => ({
  complianceLogService: { logSystemEvent: h.logSystemEvent, logAIDecision: h.logAIDecision },
}));
vi.mock('../services/TrainingJobService.js', () => ({
  trainingJobService: {
    submitJob: h.submitJob,
    cancelJob: h.cancelJob,
    checkMixture: vi.fn(async (m: Array<{ datasetId: string }>) => ({
      datasetIds: m.map((x) => x.datasetId),
      verdict: 'compatible',
      headline: 'ok',
      recommendation: '',
      axes: [],
    })),
    onJobEvent: vi.fn(),
  },
  checkInitFrom: vi.fn(async () => ({})),
}));
vi.mock('../services/TrainingOrchestrator.js', () => ({ trainingOrchestrator: { on: vi.fn() } }));
vi.mock('../services/SimulationService.js', () => ({
  simulationService: { on: vi.fn(), submitEvaluation: h.submitEvaluation, cancelJob: vi.fn() },
  isKnownEnvironment: (env: string) => env === 'g1_apple_pnp',
  getEvalProfileForEnvironment: () => ({ task: 'move the apple to the plate', maxSteps: 600 }),
}));

const { experimentsRoutes } = await import('../routes/experiments.routes.js');
const { experimentService } = await import('../services/ExperimentService.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;

function buildTenantPrisma(base: PrismaClient): PrismaClient {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = getTenantId();
          if (!model || !TENANT_SCOPED_MODELS.has(model) || tenantId === undefined) return query(args);
          const a = (args ?? {}) as Record<string, unknown>;
          if (['findMany', 'findFirst', 'count', 'updateMany'].includes(operation)) {
            a.where = { ...((a.where as object) ?? {}), tenantId };
          } else if (operation === 'create') {
            a.data = { ...((a.data as object) ?? {}), tenantId };
          }
          return query(a);
        },
      },
    },
  }) as unknown as PrismaClient;
}

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = (req.headers['x-test-auth'] as string) ?? 'human';
    (req as Request & { user?: unknown }).user = {
      id: 'u-1',
      email: 'u-1@example.org',
      name: 'Ada',
      role: 'member',
      tenantId: TENANT,
      authType: auth,
    };
    tenantStore.run({ tenantId: TENANT }, () => next());
  });
  a.use('/api/experiments', experimentsRoutes);
  return a;
}

const AGENT = { 'x-test-auth': 'service', 'x-agent-name': 'planner' };

function completedSim(jobId: string, successfulEpisodes: number, totalEpisodes: number): SimJob {
  const now = new Date();
  return {
    jobId,
    modelId: 'mv',
    environment: 'g1_apple_pnp',
    rolloutCount: totalEpisodes,
    backend: 'mujoco',
    status: 'completed',
    progress: 100,
    metrics: { successRate: successfulEpisodes / totalEpisodes, avgStepsToCompletion: 1, collisionCount: 0, avgEpisodeDuration: 3 },
    createdAt: now,
    updatedAt: now,
  };
}

const DESIGN = {
  title: 'Drop the shaky tenth',
  hypothesis: 'Dropping the lowest-reward 10% raises sim success.',
  baseModel: 'groot_n1_7',
  fineTuneMethod: 'lora',
  evaluation: { environment: 'g1_apple_pnp', rolloutCount: 30 },
  arms: [
    { name: 'full dataset', isBaseline: true, datasetRefs: [{ datasetId: 'ds-a' }] },
    { name: 'drop lowest 10%', datasetRefs: [{ datasetId: 'view-a' }] },
  ],
};

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-exp-'));
  const dbPath = join(tmpDir, 'test.db');
  const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: join(__dirname, '..', '..'),
    stdio: 'pipe',
  });
  rawPrisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  h.holder.client = buildTenantPrisma(rawPrisma);

  await rawPrisma.tenant.create({ data: { id: TENANT, slug: 'tenant-a', name: 'Tenant A' } });
  await rawPrisma.robotType.create({
    data: { id: 'rt-1', name: 'G1', manufacturer: 'Unitree', model: 'G1', actionDim: 6, proprioceptionDim: 6 },
  });
  const ds = { robotTypeId: 'rt-1', storagePath: 's3://x', lerobotVersion: 'v3.0', fps: 30, totalFrames: 90, totalDuration: 3, tenantId: TENANT };
  await rawPrisma.dataset.create({ data: { ...ds, id: 'ds-a', name: 'A', demonstrationCount: 10 } });
  await rawPrisma.dataset.create({
    data: {
      ...ds,
      id: 'view-a',
      name: 'A view',
      demonstrationCount: 9,
      kind: 'view',
      parentDatasetId: 'ds-a',
      storagePath: '',
      selectionJson: JSON.stringify({
        episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((episodeIndex) => ({ episodeIndex })),
        origin: { kind: 'reward', rewardType: 'robometer', minScore: 0.2 },
      }),
    },
  });
  for (const id of ['mv-base', 'mv-arm']) {
    await rawPrisma.modelVersion.create({ data: { id, version: id, artifactUri: 's3://m', tenantId: TENANT } });
  }
  await rawPrisma.agentCard.create({ data: { name: 'planner', description: 'proposes', url: 'http://agent' } });
  app = buildApp();
}, 60000);

afterAll(async () => {
  await rawPrisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('the experiment loop over HTTP', () => {
  it('an agent proposes; nothing runs; an agent cannot approve; a person can', async () => {
    const proposed = await request(app).post('/api/experiments').set(AGENT).send(DESIGN);
    expect(proposed.status).toBe(201);
    const exp = proposed.body.experiment;
    expect(exp).toMatchObject({ status: 'proposed', actorType: 'agent', actorId: 'planner' });
    expect(exp.arms[1].varies).toEqual(['data (ds-a → view-a)']);
    expect(h.submitJob).not.toHaveBeenCalled();
    expect((await rawPrisma.experiment.findUniqueOrThrow({ where: { id: exp.id } })).tenantId).toBe(TENANT);

    const byAgent = await request(app).post(`/api/experiments/${exp.id}/approve`).set(AGENT);
    expect(byAgent.status).toBe(403);
    expect(byAgent.body.code).toBe('EXPERIMENT_APPROVER_NOT_HUMAN');

    const approved = await request(app).post(`/api/experiments/${exp.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.experiment.status).toBe('running');
    expect(h.submitJob).toHaveBeenCalledTimes(2);
    expect((await rawPrisma.dataset.findUniqueOrThrow({ where: { id: 'view-a' } })).frozenAt).not.toBeNull();
    expect(h.logSystemEvent).toHaveBeenCalledTimes(1);
    const logged = h.logSystemEvent.mock.calls[0][0] as { payload: { configuration: { approver: { actorId: string } } } };
    expect(logged.payload.configuration.approver.actorId).toBe('u-1');
  });

  it('rejects a two-axis arm at propose time with both differences named', async () => {
    const design = structuredClone(DESIGN) as typeof DESIGN & { arms: Array<Record<string, unknown>> };
    design.arms[1].hyperparameters = { learning_rate: 1e-5 };
    const res = await request(app).post('/api/experiments').set(AGENT).send(design);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EXPERIMENT_ARM_NOT_ONE_AXIS');
    expect(res.body.message).toContain('data (ds-a → view-a)');
    expect(res.body.message).toContain('learning_rate (default → 0.00001)');
  });

  it('drives both arms to scored and writes real ratings, sim episodes and the verdict', async () => {
    const proposed = await request(app).post('/api/experiments').set(AGENT).send(DESIGN);
    const id = proposed.body.experiment.id as string;
    const running = (await request(app).post(`/api/experiments/${id}/approve`)).body.experiment;
    const [base, arm] = running.arms as Array<{ id: string; trainingJobId: string }>;

    // Hooks run outside any request, as they do off the orchestrator's events.
    await experimentService.onJobCompleted({ jobId: arm.trainingJobId, modelVersionId: 'mv-arm' });
    await experimentService.onJobCompleted({ jobId: base.trainingJobId, modelVersionId: 'mv-base' });
    const evaluating = (await request(app).get(`/api/experiments/${id}/arms`)).body.arms as Array<{ id: string; status: string; simJobId: string }>;
    expect(evaluating.map((a) => a.status)).toEqual(['evaluating', 'evaluating']);

    await experimentService.onSimCompleted(completedSim(evaluating.find((a) => a.id === arm.id)!.simJobId, 17, 30));
    await experimentService.onSimCompleted(completedSim(evaluating.find((a) => a.id === base.id)!.simJobId, 15, 30));

    const done = (await request(app).get(`/api/experiments/${id}`)).body.experiment;
    expect(done.status).toBe('completed');
    expect(done.verdict.winnerArmId).toBeNull();
    expect(done.verdict.deltas[0]).toMatchObject({ episodeCount: 30, direction: 'within_noise' });
    expect(done.arms.map((a: { result: { episodeCount: number } }) => a.result.episodeCount)).toEqual([30, 30]);

    const episodes = await rawPrisma.evaluationEpisode.findMany({ where: { modelVersionId: 'mv-arm' } });
    expect(episodes).toHaveLength(30);
    expect(episodes.every((e) => e.robotId === null && e.source === 'sim')).toBe(true);

    const rating = await rawPrisma.rating.findFirstOrThrow({ where: { subjectType: 'model_version', subjectId: 'mv-arm' } });
    expect(rating).toMatchObject({ actorType: 'agent', actorId: 'experiment-runner', tenantId: TENANT });
    expect(rating.score).toBeCloseTo(17 / 30, 6);
    const evidence = JSON.parse(rating.evidenceJson) as Array<{ kind: string; ids: string[] }>;
    expect(evidence[0].kind).toBe('evaluation_episode');
    expect(new Set(evidence[0].ids)).toEqual(new Set(episodes.map((e) => e.id)));
    expect(h.logAIDecision).toHaveBeenCalled();

    const verdict = await rawPrisma.comment.findFirstOrThrow({ where: { subjectType: 'experiment', subjectId: id } });
    expect(verdict).toMatchObject({ actorId: 'experiment-runner', tenantId: TENANT });
    expect(verdict.body).toContain('No winner');
    expect(verdict.body).toContain('17/30');

    const listed = (await request(app).get('/api/experiments').query({ modelVersionId: 'mv-arm' })).body.experiments;
    expect(listed.map((e: { id: string }) => e.id)).toContain(id);
  });

  it('cancelling a running experiment cancels its outstanding training jobs', async () => {
    const proposed = await request(app).post('/api/experiments').set(AGENT).send(DESIGN);
    const id = proposed.body.experiment.id as string;
    const running = (await request(app).post(`/api/experiments/${id}/approve`)).body.experiment;
    h.cancelJob.mockClear();
    const res = await request(app).post(`/api/experiments/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.experiment.status).toBe('cancelled');
    expect(h.cancelJob.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
      running.arms.map((a: { trainingJobId: string }) => a.trainingJobId)
    );
  });

  it('the data-ablation proposer composes a valid experiment from a dataset with reward scores', async () => {
    await rawPrisma.episodeReward.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        datasetId: 'ds-a',
        episodeIndex: i,
        rewardType: 'robometer',
        score: (i + 1) / 10,
        tenantId: TENANT,
      })),
    });
    const res = await request(app)
      .post('/api/experiments/propose/data-ablation')
      .set(AGENT)
      .send({ datasetId: 'ds-a', bands: [0.2], baseModel: 'groot_n1_7', fineTuneMethod: 'lora', evaluation: { environment: 'g1_apple_pnp', rolloutCount: 20 } });
    expect(res.status).toBe(201);
    const exp = res.body.experiment;
    expect(exp.status).toBe('proposed');
    expect(exp.arms).toHaveLength(2);
    const viewId = exp.arms[1].datasetRefs[0].datasetId as string;
    const view = await rawPrisma.dataset.findUniqueOrThrow({ where: { id: viewId } });
    expect(view).toMatchObject({ kind: 'view', parentDatasetId: 'ds-a' });
    const selection = JSON.parse(view.selectionJson!) as { episodes: Array<{ episodeIndex: number }>; origin: { minScore: number } };
    expect(selection.episodes.map((e) => e.episodeIndex)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(selection.origin.minScore).toBeCloseTo(0.3, 6);
    expect(exp.arms[1].varies).toEqual([`data (ds-a → ${viewId})`]);
  });

  it('answers 404 for an unknown experiment and 400 for an unknown strategy', async () => {
    expect((await request(app).get('/api/experiments/nope')).status).toBe(404);
    expect((await request(app).post('/api/experiments/propose/random').send({})).status).toBe(400);
    expect((await request(app).get('/api/experiments').query({ status: 'weird' })).status).toBe(400);
  });
});

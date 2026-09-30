/**
 * @file social-routes.integration.test.ts
 * @description The social routes (TASK-241) end to end against a real temp
 *   SQLite database with the tenant extension in front of it: actor
 *   resolution, the agent-evidence rule, evidence existence, one rating per
 *   actor enforced by the real unique index, soft delete over HTTP, the feed,
 *   the compliance entry, and tenant isolation of subjects, evidence and rows.
 *
 * The allowlist is imported, never pasted: if `Comment` or `Rating` falls out
 * of `TENANT_SCOPED_MODELS`, the isolation cases here fail.
 *
 * @feature social
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { TENANT_SCOPED_MODELS } from '../database/client.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();
const getTenantId = (): string | undefined => tenantStore.getStore()?.tenantId;

const { holder, logAIDecision } = vi.hoisted(() => ({
  holder: { client: undefined as unknown },
  logAIDecision: vi.fn(async (_params: unknown) => ({})),
}));

vi.mock('../database/index.js', () => ({
  prisma: new Proxy(
    {},
    { get: (_t, prop) => (holder.client as Record<string | symbol, unknown>)[prop] }
  ),
}));
vi.mock('../services/ComplianceLogService.js', () => ({ complianceLogService: { logAIDecision } }));

const { socialRoutes } = await import('../routes/social.routes.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;

/** The production extension's behaviour for the operations the repository uses. */
function buildTenantPrisma(base: PrismaClient): PrismaClient {
  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = getTenantId();
          if (!model || !TENANT_SCOPED_MODELS.has(model) || tenantId === undefined) return query(args);
          const a = (args ?? {}) as Record<string, unknown>;
          switch (operation) {
            case 'findMany':
            case 'findFirst':
            case 'count':
              a.where = { ...((a.where as object) ?? {}), tenantId };
              return query(a);
            case 'findUnique': {
              const r = (await query(a)) as { tenantId?: string | null } | null;
              return r && r.tenantId !== tenantId ? null : r;
            }
            case 'create':
              a.data = { ...((a.data as object) ?? {}), tenantId };
              return query(a);
            case 'update': {
              const key = model.charAt(0).toLowerCase() + model.slice(1);
              const repo = (base as unknown as Record<string, { findUnique: (o: unknown) => Promise<{ tenantId?: string | null } | null> }>)[key];
              const found = await repo.findUnique({ where: a.where });
              if (!found || found.tenantId !== tenantId) throw new Error(`[tenant-isolation] ${model} update denied`);
              return query(a);
            }
            default:
              return query(args);
          }
        },
      },
    },
  }) as unknown as PrismaClient;
}

/**
 * Stand-in for authMiddleware + tenant context: the test names the caller in
 * headers. `x-test-auth` is 'human' | 'service' | 'dev' (dev = the
 * AUTH_DISABLED mock user, which carries no authType).
 */
function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = (req.headers['x-test-auth'] as string) ?? 'human';
    const userId = (req.headers['x-test-user'] as string) ?? 'u-1';
    const tenantId = (req.headers['x-tenant-id'] as string) ?? TENANT_A;
    (req as Request & { user?: unknown }).user = {
      id: userId,
      email: `${userId}@example.org`,
      name: `User ${userId}`,
      role: 'member',
      tenantId,
      ...(auth === 'dev' ? {} : { authType: auth }),
    };
    tenantStore.run({ tenantId }, () => next());
  });
  a.use('/api/social', socialRoutes);
  return a;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-social-'));
  const dbPath = join(tmpDir, 'test.db');
  const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: join(__dirname, '..', '..'),
    stdio: 'pipe',
  });
  rawPrisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  holder.client = buildTenantPrisma(rawPrisma);

  await rawPrisma.tenant.createMany({
    data: [
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });
  await rawPrisma.robotType.create({
    data: { id: 'rt-1', name: 'G1', manufacturer: 'Unitree', model: 'G1', actionDim: 6, proprioceptionDim: 6 },
  });
  const ds = { robotTypeId: 'rt-1', storagePath: 's3://x', lerobotVersion: 'v3.0', fps: 30, totalFrames: 90, totalDuration: 3 };
  await rawPrisma.dataset.create({ data: { ...ds, id: 'ds-a', name: 'A', demonstrationCount: 3, tenantId: TENANT_A } });
  await rawPrisma.dataset.create({
    data: { ...ds, id: 'view-a', name: 'A view', demonstrationCount: 2, kind: 'view', parentDatasetId: 'ds-a', storagePath: '', tenantId: TENANT_A },
  });
  await rawPrisma.dataset.create({ data: { ...ds, id: 'ds-b', name: 'B', demonstrationCount: 1, tenantId: TENANT_B } });
  await rawPrisma.trainingJob.create({ data: { id: 'tj-a', datasetId: 'ds-a', tenantId: TENANT_A } });
  await rawPrisma.modelVersion.create({ data: { id: 'mv-a', version: '1', artifactUri: 's3://m', trainingJobId: 'tj-a', tenantId: TENANT_A } });
  await rawPrisma.modelVersion.create({ data: { id: 'mv-b', version: '1', artifactUri: 's3://m', tenantId: TENANT_B } });
  await rawPrisma.robot.create({ data: { id: 'r-a', name: 'G1-1', model: 'G1', tenantId: TENANT_A } });
  const now = new Date();
  await rawPrisma.evaluationEpisode.create({
    data: {
      id: 'ee-1', robotId: 'r-a', modelVersion: '1', modelVersionId: 'mv-a', taskPrompt: 'pick',
      startedAt: now, endedAt: now, durationMs: 1000, success: true,
    },
  });
  await rawPrisma.agentCard.create({ data: { name: 'eval-agent', description: 'evaluates', url: 'http://agent' } });
}, 60000);

afterAll(async () => {
  await rawPrisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rawPrisma.comment.deleteMany({ where: { parentId: { not: null } } });
  await rawPrisma.comment.deleteMany();
  await rawPrisma.rating.deleteMany();
  logAIDecision.mockClear();
  app = buildApp();
});

const AGENT = { 'x-test-auth': 'service', 'x-agent-name': 'eval-agent' };

describe('actor resolution', () => {
  it('a human JWT is a user actor, even when it sets X-Agent-Name', async () => {
    const res = await request(app)
      .post('/api/social/dataset/ds-a/comments')
      .set('x-agent-name', 'eval-agent')
      .send({ body: 'hello' });
    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({ actorType: 'user', actorId: 'u-1', displayName: 'User u-1' });
  });

  it('a service token must name a registered agent', async () => {
    const missing = await request(app).post('/api/social/dataset/ds-a/comments').set('x-test-auth', 'service').send({ body: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('SOCIAL_AGENT_NAME_REQUIRED');
    const unknown = await request(app)
      .post('/api/social/dataset/ds-a/comments')
      .set({ 'x-test-auth': 'service', 'x-agent-name': 'ghost' })
      .send({ body: 'x' });
    expect(unknown.status).toBe(403);
    const ok = await request(app).post('/api/social/dataset/ds-a/comments').set(AGENT).send({ body: 'x' });
    expect(ok.status).toBe(201);
    expect(ok.body.comment).toMatchObject({ actorType: 'agent', actorId: 'eval-agent' });
  });

  it('the AUTH_DISABLED mock user is a system actor, not an invented user', async () => {
    const res = await request(app).post('/api/social/dataset/ds-a/comments').set('x-test-auth', 'dev').send({ body: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({ actorType: 'system', actorId: 'dev' });
  });
});

describe('comments and ratings over HTTP', () => {
  it('works on all five subject types', async () => {
    const subjects = [
      '/api/social/dataset/ds-a',
      '/api/social/dataset_view/view-a',
      '/api/social/model_version/mv-a',
      '/api/social/training_job/tj-a',
    ];
    for (const base of subjects) {
      expect((await request(app).post(`${base}/comments`).send({ body: 'c' })).status).toBe(201);
      expect((await request(app).put(`${base}/rating`).send({ score: 0.5 })).status).toBe(201);
    }
    const ep = await request(app).post('/api/social/episode/ds-a/comments').send({ body: 'ep', episodeIndex: 2 });
    expect(ep.status).toBe(201);
    expect((await request(app).put('/api/social/episode/ds-a/rating').send({ score: 0.5, episodeIndex: 2 })).status).toBe(201);
    const list = await request(app).get('/api/social/episode/ds-a/comments?episodeIndex=2');
    expect(list.body.threads).toHaveLength(1);
  });

  it('rejects a comment on a subject that does not exist', async () => {
    const res = await request(app).post('/api/social/dataset/nope/comments').send({ body: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SOCIAL_SUBJECT_NOT_FOUND');
    expect(await rawPrisma.comment.count()).toBe(0);
  });

  it('a second PUT updates the one rating row', async () => {
    const first = await request(app).put('/api/social/model_version/mv-a/rating').send({ score: 0.2 });
    const second = await request(app).put('/api/social/model_version/mv-a/rating').send({ score: 0.7 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.rating.id).toBe(first.body.rating.id);
    expect(await rawPrisma.rating.count()).toBe(1);
    const got = await request(app).get('/api/social/model_version/mv-a/rating');
    expect(got.body.mine.score).toBe(0.7);
  });

  it('agent ratings need evidence that exists, and are compliance-logged', async () => {
    const none = await request(app).put('/api/social/model_version/mv-a/rating').set(AGENT).send({ score: 0.9 });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('SOCIAL_AGENT_EVIDENCE_REQUIRED');
    expect(none.body.error).toMatch(/must cite evidence/);

    const ghost = await request(app)
      .put('/api/social/model_version/mv-a/rating')
      .set(AGENT)
      .send({ score: 0.9, evidence: [{ kind: 'evaluation_episode', ids: ['ee-ghost'] }] });
    expect(ghost.status).toBe(400);
    expect(ghost.body.code).toBe('SOCIAL_EVIDENCE_NOT_FOUND');
    expect(logAIDecision).not.toHaveBeenCalled();

    const evidence = [{ kind: 'evaluation_episode', ids: ['ee-1'] }, { kind: 'training_job', id: 'tj-a' }];
    const ok = await request(app).put('/api/social/model_version/mv-a/rating').set(AGENT).send({ score: 0.9, evidence });
    expect(ok.status).toBe(201);
    expect(logAIDecision).toHaveBeenCalledTimes(1);
    expect(logAIDecision.mock.calls[0][0]).toMatchObject({ payload: { metadata: { evidence, ratingId: ok.body.rating.id } } });

    await request(app).put('/api/social/model_version/mv-a/rating').send({ score: 0.3 });
    const summary = await request(app).get('/api/social/model_version/mv-a/summary');
    expect(summary.body.summary.byActorType.agent).toEqual({ count: 1, mean: 0.9 });
    expect(summary.body.summary.byActorType.user).toEqual({ count: 1, mean: 0.3 });
  });

  it('soft-deleting a comment with replies keeps the thread readable', async () => {
    const top = await request(app).post('/api/social/dataset/ds-a/comments').send({ body: 'top' });
    await request(app).post('/api/social/dataset/ds-a/comments').set('x-test-user', 'u-2').send({ body: 'reply', parentId: top.body.comment.id });
    const forbidden = await request(app).delete(`/api/social/comments/${top.body.comment.id}`).set('x-test-user', 'u-2');
    expect(forbidden.status).toBe(403);
    expect((await request(app).delete(`/api/social/comments/${top.body.comment.id}`)).status).toBe(200);
    const list = await request(app).get('/api/social/dataset/ds-a/comments');
    expect(list.body.threads).toHaveLength(1);
    expect(list.body.threads[0]).toMatchObject({ body: '', replies: [{ body: 'reply' }] });
    expect(list.body.threads[0].deletedAt).not.toBeNull();
  });

  it('the feed returns activity across subject types, newest first', async () => {
    await request(app).post('/api/social/dataset/ds-a/comments').send({ body: 'one' });
    await new Promise((r) => setTimeout(r, 5));
    await request(app).put('/api/social/training_job/tj-a/rating').send({ score: 0.4 });
    await new Promise((r) => setTimeout(r, 5));
    await request(app).post('/api/social/model_version/mv-a/comments').set(AGENT).send({ body: 'three' });
    const feed = await request(app).get('/api/social/feed');
    expect(feed.body.items.map((i: { subjectType: string }) => i.subjectType)).toEqual(['model_version', 'training_job', 'dataset']);
    const agents = await request(app).get('/api/social/feed?actorType=agent');
    expect(agents.body.items).toHaveLength(1);
    expect((await request(app).get('/api/social/feed?actorType=robot')).status).toBe(400);
  });
});

describe('tenant isolation', () => {
  it("another tenant's subject, evidence and rows read as absent", async () => {
    await request(app).post('/api/social/dataset/ds-a/comments').send({ body: 'tenant A only' });
    const asB = { 'x-tenant-id': TENANT_B };

    const subject = await request(app).get('/api/social/dataset/ds-a/comments').set(asB);
    expect(subject.status).toBe(404);

    const evidence = await request(app)
      .put('/api/social/model_version/mv-b/rating')
      .set({ ...asB, ...AGENT })
      .send({ score: 0.5, evidence: [{ kind: 'model_version', id: 'mv-a' }] });
    expect(evidence.status).toBe(400);
    expect(evidence.body.code).toBe('SOCIAL_EVIDENCE_NOT_FOUND');

    const feed = await request(app).get('/api/social/feed').set(asB);
    expect(feed.body.items).toEqual([]);

    const row = await rawPrisma.comment.findFirst();
    expect(row?.tenantId).toBe(TENANT_A);
    const edit = await request(app).patch(`/api/social/comments/${row!.id}`).set(asB).send({ body: 'hijack' });
    expect(edit.status).toBe(404);
  });
});

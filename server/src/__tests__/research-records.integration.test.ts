/**
 * @file research-records.integration.test.ts
 * @description Real SQLite + HTTP checks for attribution, isolation and immutable retries.
 * @feature research
 * @status test
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest, AuthUser } from '../middleware/auth.middleware.js';

// Explicit tenant filters must work even when the older global extension is off.
vi.mock('../config/features.js', () => ({ MULTI_TENANCY_ENABLED: false, DEFAULT_TENANT_ID: 'default' }));

let app: Express;
let raw: PrismaClient;
let tmp: string;
let previousUrl: string | undefined;
let previousAuth: string | undefined;
const users: Record<string, AuthUser> = {
  a: { id: 'researcher-a', name: 'Apple researcher', email: 'a@example.test', role: 'member', tenantId: 'tenant-a', authType: 'service' },
  colleague: { id: 'human-a', name: 'Human colleague', email: 'h@example.test', role: 'member', tenantId: 'tenant-a', authType: 'human' },
  b: { id: 'researcher-b', name: 'Other researcher', email: 'b@example.test', role: 'member', tenantId: 'tenant-b', authType: 'service' },
  viewer: { id: 'viewer-a', name: 'Viewer', email: 'v@example.test', role: 'viewer', tenantId: 'tenant-a' },
  unscoped: { id: 'platform', name: 'Platform', email: 'p@example.test', role: 'super-admin', tenantId: null },
};
const hash = 'a'.repeat(64);
const checkpoint = { uri: 's3://models/apple/checkpoint', sha256: hash };
const receipt = { uri: 's3://research/run-1/isaac.json', sha256: 'b'.repeat(64) };

function idea(overrides: Record<string, unknown> = {}) {
  return { id: 'idea-1', kind: 'idea', version: 1, idempotencyKey: 'idea-1', campaignId: 'apple',
    title: 'Change table appearance', body: { hypothesis: 'Appearance diversity improves held-out success' }, evidence: [], ...overrides };
}
function report(overrides: Record<string, unknown> = {}) {
  return idea({ id: 'report-1', kind: 'report', idempotencyKey: 'report-1', sourceRunId: 'run-1', evidence: [checkpoint, receipt],
    body: { reportType: 'scientific', executionMode: 'real', verdict: 'inconclusive', experimentHash: hash,
      checkpoint, evaluations: [{ engine: 'isaac', executionMode: 'real', engineVersion: '5.0', checkpointSha256: hash,
        protocolHash: hash, evidence: [receipt] }], comparisons: [{ metric: 'success', baseline: 0.5, candidate: 0.6 }],
      prediction: { delta: 0.1 }, limitations: ['One training seed'], ...overrides } });
}
function post(user: string, body: object) { return request(app).post('/api/research/records').set('x-test-user', user).send(body); }
function get(user: string, path = '') { return request(app).get(`/api/research/records${path}`).set('x-test-user', user); }

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'neodem-research-'));
  const url = `file:${join(tmp, 'test.db')}`;
  previousUrl = process.env.DATABASE_URL;
  previousAuth = process.env.AUTH_DISABLED;
  process.env.DATABASE_URL = url;
  process.env.AUTH_DISABLED = 'false';
  delete (globalThis as { prisma?: unknown }).prisma;
  execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['db', 'push', '--skip-generate', '--schema', join(process.cwd(), 'prisma/schema.prisma')], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  raw = new PrismaClient({ datasources: { db: { url } } });
  // Exercise the checked-in production migration, not only schema push.
  await raw.$executeRawUnsafe('DROP TABLE "ResearchRecord"');
  await raw.$executeRawUnsafe('DROP TABLE "ResearchModelPublication"');
  const migration = readFileSync(join(process.cwd(), 'prisma/migrations/20260920120000_research_publications/migration.sql'), 'utf8');
  for (const statement of migration.split(';').filter((part) => part.trim())) await raw.$executeRawUnsafe(statement);
  await raw.tenant.createMany({ data: [{ id: 'tenant-a', name: 'A', slug: 'a' }, { id: 'tenant-b', name: 'B', slug: 'b' }] });
  await raw.robotType.create({ data: { id: 'g1', name: 'G1', manufacturer: 'Unitree', model: 'G1', actionDim: 31, proprioceptionDim: 43 } });
  for (const tenantId of ['tenant-a', 'tenant-b']) {
    await raw.dataset.create({ data: { id: `data-${tenantId}`, name: 'Apple', robotTypeId: 'g1', storagePath: '/data', lerobotVersion: '2.1',
      fps: 30, totalFrames: 300, totalDuration: 10, demonstrationCount: 1, tenantId, qualityScore: 82, sourceRevision: 'd'.repeat(40) } });
  }
  const { researchRoutes } = await import('../routes/research.routes.js');
  app = express();
  app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => { req.user = users[String(req.headers['x-test-user'])]; next(); });
  app.use('/api/research', researchRoutes);
}, 120000);

beforeEach(async () => {
  await raw.researchRecord.deleteMany();
  await raw.researchModelPublication.deleteMany();
  await raw.modelVersion.deleteMany();
});
afterAll(async () => {
  await raw?.$disconnect();
  const { prisma } = await import('../database/index.js');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousAuth === undefined) delete process.env.AUTH_DISABLED; else process.env.AUTH_DISABLED = previousAuth;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('immutable research publication', () => {
  it('derives authors from authenticated identity and rejects client impersonation', async () => {
    const response = await post('a', idea()).expect(201);
    expect(response.body.record.author).toEqual({ id: 'researcher-a', name: 'Apple researcher', kind: 'service' });
    expect(response.body.record.tenantId).toBe('tenant-a');
    expect(response.body.record.contentHash).toMatch(/^[a-f0-9]{64}$/);
    await post('a', idea({ id: 'fake', author: { id: 'human-a' } })).expect(400);
    await post('a', idea({ id: 'fake', tenantId: 'tenant-b' })).expect(400);
    await post('viewer', idea()).expect(403);
    await post('missing', idea()).expect(401);
    await get('unscoped').expect(403);
  });

  it('survives duplicate concurrent requests and reconnects without duplicate records', async () => {
    const responses = await Promise.all([post('a', idea()), post('a', idea()), post('a', idea())]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 200, 201]);
    expect(await raw.researchRecord.count()).toBe(1);
    const first = responses.find((item) => item.status === 201)!.body.record;
    const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    expect((await client.researchRecord.findFirst())?.contentHash).toBe(first.contentHash);
    await client.$disconnect();
    const retry = await post('a', idea({ body: { hypothesis: 'Appearance diversity improves held-out success' } })).expect(200);
    expect(retry.body.record).toEqual(first);
    await post('a', idea({ title: 'Changed hypothesis' })).expect(409);
    await post('a', idea({ id: 'different-id' })).expect(409);
    await post('colleague', idea()).expect(409);
  });

  it('isolates IDs, listing, filters and reconciliation by tenant and actor', async () => {
    await post('a', idea()).expect(201);
    expect((await get('b')).body.records).toEqual([]);
    await get('b', '/idea-1').expect(404);
    expect((await get('colleague', '?idempotencyKey=idea-1')).body.records).toEqual([]);
    expect((await get('a', '?idempotencyKey=idea-1')).body.records).toHaveLength(1);
    await post('b', idea()).expect(201);
    expect((await get('b')).body.records[0].author.id).toBe('researcher-b');
    expect((await get('a')).body.pagination.total).toBe(1);
    await get('a', '?tenantId=tenant-b').expect(400);
    await get('a', '?page=-1').expect(400);
    await get('a', '?pageSize=201').expect(400);
  });

  it('appends corrections and refuses cross-tenant lineage or mutation endpoints', async () => {
    await post('a', idea()).expect(201);
    await post('a', idea({ id: 'correction-1', idempotencyKey: 'correction-1', supersedesId: 'idea-1', title: 'Corrected claim' })).expect(201);
    expect((await get('a', '/idea-1')).body.record.title).toBe('Change table appearance');
    expect((await get('a', '/correction-1')).body.record.supersedesId).toBe('idea-1');
    await post('b', idea({ id: 'b-child', parentId: 'correction-1' })).expect(400);
    await post('a', idea({ id: 'self', parentId: 'self' })).expect(400);
    await request(app).patch('/api/research/records/idea-1').set('x-test-user', 'a').send({ title: 'Mutated' }).expect(404);
    await request(app).delete('/api/research/records/idea-1').set('x-test-user', 'a').expect(404);
  });

  it('publishes frozen experiments linked to an existing idea in the same tenant and campaign', async () => {
    const canonicalExperiment = { id: 'exp-1', campaignId: 'apple', ideaId: 'idea-1', training: { seed: 42 } };
    const experiment = idea({ id: 'exp-1', kind: 'experiment', idempotencyKey: 'exp-1', ideaId: 'idea-1', parentId: 'idea-1',
      body: { publicationSchemaVersion: 1, ...canonicalExperiment, canonicalExperiment, experimentHash: hash } });
    await post('a', experiment).expect(400);
    await post('a', idea()).expect(201);
    const published = await post('a', experiment).expect(201);
    expect(published.body.record.body.canonicalExperiment).toEqual(canonicalExperiment);
    expect((await get('a', '?kind=experiment')).body.records.map((item: { id: string }) => item.id)).toEqual(['exp-1']);
    await post('a', experiment).expect(200);
    await post('b', experiment).expect(400);
    await post('a', { ...experiment, campaignId: 'other' }).expect(400);
    await post('a', { ...experiment, ideaId: undefined }).expect(400);
    await post('a', { ...experiment, body: { ...experiment.body as object, experimentHash: 'invalid' } }).expect(400);
    await post('a', { ...experiment, body: { ...experiment.body as object, training: { seed: 43 } } }).expect(409);
  });

  it('publishes contextual ratings without altering validator quality and denies foreign datasets', async () => {
    const assessment = idea({ id: 'assessment', kind: 'dataset-assessment', datasetId: 'data-tenant-a', datasetVersion: hash,
      evidence: [receipt], body: { datasetManifestSha256: hash, task: 'apple-pnp', model: 'groot-1.7', rubricVersion: '1', comment: 'Schema verified; usefulness unmeasured',
        dimensions: { integrity: { score: 90, rationale: 'All expected files exist' }, usefulness: { score: null, rationale: 'No controlled training yet' } },
        confidence: 0.7, limitations: ['One camera'] } });
    await post('a', assessment).expect(201);
    expect((await raw.dataset.findUnique({ where: { id: 'data-tenant-a' } }))?.qualityScore).toBe(82);
    await post('b', { ...assessment, id: 'foreign' }).expect(400);
    await post('a', { ...assessment, id: 'no-version', datasetVersion: undefined }).expect(400);
    await post('a', { ...assessment, id: 'no-rubric', body: { comment: 'Great' } }).expect(400);
    await post('a', { ...assessment, id: 'mock-rating', body: { ...assessment.body as object, backend: 'mock' } }).expect(400);
    await post('a', { ...assessment, id: 'wrong-source', idempotencyKey: 'wrong-source', body: { ...assessment.body as object, datasetSourceRevision: 'e'.repeat(40) } }).expect(400);
  });

  it('requires real engine/checkpoint receipts rather than a real label alone', async () => {
    await post('a', report()).expect(201);
    expect((await get('a', '?sourceRunId=run-1')).body.records).toHaveLength(1);
    await post('a', report({ evaluations: [] })).expect(400);
    await post('a', report({ executionMode: 'dry-run' })).expect(400);
    await post('a', report({ prediction: { mockMode: true } })).expect(400);
    await post('a', report({ comparisons: [{ backend: 'mock' }] })).expect(400);
    await post('a', report({ evaluations: [{ engine: 'isaac', executionMode: 'real', engineVersion: '5.0', checkpointSha256: 'c'.repeat(64), protocolHash: hash, evidence: [receipt] }] })).expect(400);
    const missingEvidence = report(); missingEvidence.evidence = [];
    await post('a', missingEvidence).expect(400);
    await post('a', { ...report(), evidence: [{ uri: 'https://artifacts.test/report?token=secret', sha256: hash }] }).expect(400);
    await post('a', idea({ kind: 'report', body: { reportType: 'status', status: 'failed', summary: 'Worker unavailable' } })).expect(201);
    await post('a', idea({ kind: 'report', body: { reportType: 'status', status: 'failed', summary: 'Worker unavailable', verdict: 'supported' } })).expect(400);
  });

  it('atomically registers real models, pins the full data recipe and reconciles duplicate requests', async () => {
    const model = {
      id: 'model-run-1', version: 1, idempotencyKey: 'model-run-1', campaignId: 'apple', sourceRunId: 'run-1',
      title: 'Apple candidate', experimentHash: hash, artifact: checkpoint, executionMode: 'real',
      datasetId: 'data-tenant-a', datasetVersion: 'v1', datasetManifestSha256: hash, datasetRecipeHash: hash,
      datasetSources: [{ datasetId: 'data-tenant-a', version: 'v1', manifestSha256: hash, weight: 1, episodeIds: ['episode-1'] }],
      evidence: [checkpoint, receipt],
    };
    const publishModel = (user: string, body: object) => request(app).post('/api/research/models').set('x-test-user', user).send(body);
    const concurrent = await Promise.all([publishModel('a', model), publishModel('a', model)]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
    const first = concurrent.find((response) => response.status === 201)!;
    const retry = concurrent.find((response) => response.status === 200)!;
    expect(retry.body.modelVersion.id).toBe(first.body.modelVersion.id);
    expect(retry.body.replayed).toBe(true);
    expect(first.body.publication.author.id).toBe('researcher-a');
    expect(first.body.modelVersion.trainingMetrics.datasetSources).toEqual(model.datasetSources);
    expect(await raw.modelVersion.count()).toBe(1);
    expect(await raw.researchModelPublication.count()).toBe(1);
    await publishModel('a', { ...model, title: 'Changed' }).expect(409);
    await publishModel('b', model).expect(400);
    await publishModel('viewer', model).expect(403);
    await publishModel('a', { ...model, executionMode: 'mock' }).expect(400);
    await publishModel('a', { ...model, id: 'foreign-source', idempotencyKey: 'foreign-source', datasetSources: [...model.datasetSources,
      { datasetId: 'data-tenant-b', version: 'v1', manifestSha256: hash, weight: 1, episodeIds: ['episode-1'] }] }).expect(400);
    expect(await raw.modelVersion.count()).toBe(1);
    const reconciled = await request(app).get('/api/research/models?idempotencyKey=model-run-1').set('x-test-user', 'a').expect(200);
    expect(reconciled.body.publications[0].modelVersionId).toBe(first.body.modelVersion.id);
    const otherActor = await request(app).get('/api/research/models?idempotencyKey=model-run-1').set('x-test-user', 'colleague').expect(200);
    expect(otherActor.body.publications).toEqual([]);
    await post('a', report({ modelVersionId: first.body.modelVersion.id })).expect(201);
    await post('b', report({ modelVersionId: first.body.modelVersion.id })).expect(400);
    await raw.modelVersion.update({ where: { id: first.body.modelVersion.id }, data: { artifactUri: 's3://models/wrong-checkpoint' } });
    await post('a', { ...report({ modelVersionId: first.body.modelVersion.id }), id: 'wrong-model-report', idempotencyKey: 'wrong-model-report' }).expect(400);
    await raw.modelVersion.update({ where: { id: first.body.modelVersion.id }, data: { artifactUri: checkpoint.uri } });

    // A failing operation receipt must roll back the preceding real model row.
    await raw.$executeRawUnsafe(`CREATE TRIGGER research_receipt_failure BEFORE INSERT ON "ResearchModelPublication"
      WHEN NEW.id = 'rollback-model' BEGIN SELECT RAISE(ABORT, 'test receipt write failure'); END`);
    const failure = await publishModel('a', { ...model, id: 'rollback-model', idempotencyKey: 'rollback-model' });
    expect(failure.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(failure.body)).not.toContain('test receipt write failure');
    expect(await raw.modelVersion.count()).toBe(1);
    expect(await raw.researchModelPublication.count()).toBe(1);
    await raw.$executeRawUnsafe('DROP TRIGGER research_receipt_failure');
  });
});

/**
 * @file robot-type-rename.integration.test.ts
 * @description TASK-493 over HTTP against a real temp SQLite database: an
 *   import-created robot type gets a readable name
 *   (`PATCH /api/datasets/robot-types/:id`), its datasets and its widths stay,
 *   a later import of the same robot still finds the row, a taken name and a
 *   standard type are refused, and the `rename:robot-type` script drives the
 *   same route.
 * @feature training
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ holder: { client: undefined as unknown } }));

vi.mock('../database/index.js', () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (h.holder.client as Record<string | symbol, unknown>)[prop] }),
}));

const { datasetRoutes } = await import('../routes/datasets.routes.js');
const { seedStandardRobotTypes } = await import('../database/seedStandardRobotTypes.js');
const { renameRobotType } = await import('../scripts/rename-robot-type.js');
const { matchRobotType } = await import('../services/HuggingFaceImportService.js');
const { robotTypeRepository } = await import('../repositories/index.js');

/** What the importer names a type it has to mint beside a same-named one. */
const AUTO_NAME = 'unitree_g1_dex3 (action 31, state 31)';
const NICE_NAME = 'Unitree G1 upper body + Dex3-1 hands';

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;
let server: Server;
let baseUrl: string;

async function importedType(name = AUTO_NAME) {
  return rawPrisma.robotType.create({
    data: { name, manufacturer: 'Unknown', model: 'unitree_g1_dex3', actionDim: 31, proprioceptionDim: 31 },
  });
}

async function typeNames(): Promise<string[]> {
  const res = await request(app).get('/api/datasets/robot-types');
  return res.body.robotTypes.map((t: { name: string }) => t.name);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-robot-type-rename-'));
  const dbPath = join(tmpDir, 'test.db');
  const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: join(__dirname, '..', '..'),
    stdio: 'pipe',
  });
  rawPrisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  h.holder.client = rawPrisma;

  app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await rawPrisma?.$disconnect();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rawPrisma.dataset.deleteMany({});
  await rawPrisma.robotType.deleteMany({});
});

describe('PATCH /api/datasets/robot-types/:id (TASK-493)', () => {
  it('renames the type and leaves its model, its widths and its datasets alone', async () => {
    const type = await importedType();
    const dataset = await rawPrisma.dataset.create({
      data: {
        name: 'Bottle Sorting — our G1 Dex3 simulation',
        robotTypeId: type.id,
        storagePath: 'datasets/bottle/',
        lerobotVersion: 'v3.0',
        fps: 30,
        totalFrames: 10,
        totalDuration: 1,
        demonstrationCount: 1,
      },
    });

    const res = await request(app).patch(`/api/datasets/robot-types/${type.id}`).send({ name: `  ${NICE_NAME}  ` });
    expect(res.status).toBe(200);
    expect(res.body.robotType).toMatchObject({
      id: type.id, name: NICE_NAME, model: 'unitree_g1_dex3', actionDim: 31, proprioceptionDim: 31,
    });
    expect(await typeNames()).toEqual([NICE_NAME]);
    expect((await rawPrisma.dataset.findUniqueOrThrow({ where: { id: dataset.id } })).robotTypeId).toBe(type.id);
  });

  it('keeps the row findable for the next import of the same robot', async () => {
    const type = await importedType();
    await request(app).patch(`/api/datasets/robot-types/${type.id}`).send({ name: NICE_NAME });

    const info = {
      features: { action: { shape: [31] }, 'observation.state': { shape: [31] } },
    } as unknown as Parameters<typeof matchRobotType>[2];
    const all = await robotTypeRepository.findAll();
    expect(matchRobotType(all, 'unitree_g1_dex3', info)?.id).toBe(type.id);
  });

  it('is a no-op when the type already has the name', async () => {
    const type = await importedType(NICE_NAME);
    const res = await request(app).patch(`/api/datasets/robot-types/${type.id}`).send({ name: NICE_NAME });
    expect(res.status).toBe(200);
    expect(res.body.robotType.name).toBe(NICE_NAME);
  });

  it('refuses a name another type has, whatever its case, and changes nothing', async () => {
    await seedStandardRobotTypes();
    const type = await importedType();

    for (const name of ['Unitree G1 arms + Dex3-1 hands', 'unitree g1 ARMS + dex3-1 hands']) {
      const res = await request(app).patch(`/api/datasets/robot-types/${type.id}`).send({ name });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ROBOT_TYPE_EXISTS');
    }
    expect(await typeNames()).toContain(AUTO_NAME);
  });

  it('never renames a standard robot type', async () => {
    await seedStandardRobotTypes();
    const standard = await rawPrisma.robotType.findUniqueOrThrow({ where: { name: 'Microduck' } });

    const res = await request(app).patch(`/api/datasets/robot-types/${standard.id}`).send({ name: 'Duck' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROBOT_TYPE_STANDARD');
    expect(await typeNames()).toContain('Microduck');
  });

  it('answers 400 without a usable name and 404 for an unknown type', async () => {
    const type = await importedType();
    for (const body of [{}, { name: '   ' }, { name: 7 }, { name: 'x'.repeat(81) }]) {
      const res = await request(app).patch(`/api/datasets/robot-types/${type.id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ROBOT_TYPE');
    }
    const missing = await request(app).patch('/api/datasets/robot-types/nope').send({ name: NICE_NAME });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('ROBOT_TYPE_NOT_FOUND');
    expect(await typeNames()).toEqual([AUTO_NAME]);
  });
});

describe('the rename:robot-type script against the real routes', () => {
  it('renames the named type, then reports it unchanged on a second run', async () => {
    await seedStandardRobotTypes();
    await importedType();
    const before = await typeNames();

    expect(await renameRobotType({ baseUrl, name: AUTO_NAME, to: NICE_NAME, dryRun: true })).toMatchObject({
      outcome: 'would-rename', to: NICE_NAME,
    });
    expect(await typeNames()).toEqual(before);

    expect(await renameRobotType({ baseUrl, name: AUTO_NAME, to: NICE_NAME })).toMatchObject({
      outcome: 'renamed',
      robotType: { name: AUTO_NAME, actionDim: 31 },
      to: NICE_NAME,
    });
    expect(await typeNames()).toContain(NICE_NAME);
    expect(await typeNames()).not.toContain(AUTO_NAME);
    expect(await renameRobotType({ baseUrl, name: AUTO_NAME, to: NICE_NAME })).toMatchObject({ outcome: 'unchanged' });
  });

  it('reports the server’s refusal, and matches the current name exactly', async () => {
    await seedStandardRobotTypes();
    await importedType();

    const refused = await renameRobotType({ baseUrl, name: AUTO_NAME, to: 'SO-101 Follower' });
    expect(refused.outcome).toBe('refused');
    expect(refused.reason).toContain('already exists');
    const standard = await renameRobotType({ baseUrl, name: 'Microduck', to: 'Duck' });
    expect(standard).toMatchObject({ outcome: 'refused' });
    expect(standard.reason).toContain('standard robot type');
    expect(await renameRobotType({ baseUrl, name: 'unitree_g1_dex3', to: NICE_NAME })).toEqual({ outcome: 'absent' });
    expect(await typeNames()).toContain(AUTO_NAME);
  });
});

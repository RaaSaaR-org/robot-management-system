/**
 * @file robot-type-removal.integration.test.ts
 * @description TASK-485 over HTTP against a real temp SQLite database: an
 *   unused robot type can be deleted, one that a dataset, an embodiment or a
 *   skill still uses is refused with a 409 that names them, a standard type is
 *   never deleted, the `remove:robot-type` script drives the same route, and a
 *   fleet robot resolves to its robot type (`GET /api/robots/:id/robot-type`).
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

const { robotRoutes } = await import('../routes/robot.routes.js');
const { datasetRoutes } = await import('../routes/datasets.routes.js');
const { seedStandardRobotTypes } = await import('../database/seedStandardRobotTypes.js');
const { syncDemoFleet } = await import('../scripts/demoFleet.js');
const { removeRobotType } = await import('../scripts/remove-robot-type.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;
let server: Server;
let baseUrl: string;

async function staleType(name = 'Unitree_G1') {
  return rawPrisma.robotType.create({
    data: { name, manufacturer: 'Unknown', model: 'unitree_g1', actionDim: 28, proprioceptionDim: 28 },
  });
}

async function datasetOn(robotTypeId: string, name: string) {
  return rawPrisma.dataset.create({
    data: {
      name,
      robotTypeId,
      storagePath: `datasets/${name}/`,
      lerobotVersion: 'v2.1',
      fps: 30,
      totalFrames: 10,
      totalDuration: 1,
      demonstrationCount: 1,
    },
  });
}

async function typeNames(): Promise<string[]> {
  const res = await request(app).get('/api/datasets/robot-types');
  return res.body.robotTypes.map((t: { name: string }) => t.name);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-robot-type-removal-'));
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
  app.use('/api/robots', robotRoutes);
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
  await rawPrisma.embodiment.deleteMany({});
  await rawPrisma.skillDefinition.deleteMany({});
  await rawPrisma.robot.deleteMany({});
  await rawPrisma.robotType.deleteMany({});
});

describe('DELETE /api/datasets/robot-types/:id (TASK-485)', () => {
  it('deletes a robot type nothing uses, and it leaves the picker', async () => {
    const stale = await staleType();
    expect(await typeNames()).toContain('Unitree_G1');

    const res = await request(app).delete(`/api/datasets/robot-types/${stale.id}`);
    expect(res.status).toBe(200);
    expect(res.body.robotType).toMatchObject({ id: stale.id, name: 'Unitree_G1' });
    expect(await typeNames()).not.toContain('Unitree_G1');
  });

  it('refuses with 409 while datasets use it, names them, and deletes nothing', async () => {
    const stale = await staleType();
    await datasetOn(stale.id, 'apple-to-plate');
    await datasetOn(stale.id, 'object-in-box');

    const res = await request(app).delete(`/api/datasets/robot-types/${stale.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROBOT_TYPE_IN_USE');
    expect(res.body.error).toContain('"Unitree_G1"');
    expect(res.body.error).toContain('2 datasets ("apple-to-plate", "object-in-box")');
    expect(res.body.references.datasets.map((d: { name: string }) => d.name)).toEqual(['apple-to-plate', 'object-in-box']);
    expect(await typeNames()).toContain('Unitree_G1');
    expect(await rawPrisma.dataset.count()).toBe(2);
  });

  it('refuses while an embodiment or a skill points at it, and names those', async () => {
    const stale = await staleType();
    await rawPrisma.embodiment.create({
      data: { tag: 'unitree_g1_arms', manufacturer: 'Unitree', model: 'G1', configYaml: 'x: 1', actionDim: 28, proprioceptionDim: 28, robotTypeId: stale.id },
    });
    await rawPrisma.skillDefinition.create({
      data: { name: 'pick apple', version: '1.0.0', compatibleRobotTypes: { connect: [{ id: stale.id }] } },
    });

    const res = await request(app).delete(`/api/datasets/robot-types/${stale.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('1 embodiment ("unitree_g1_arms")');
    expect(res.body.error).toContain('1 skill ("pick apple")');
    // The embodiment's link is ON DELETE SET NULL: a delete would have silently unlinked it.
    expect((await rawPrisma.embodiment.findFirst())?.robotTypeId).toBe(stale.id);
    expect(await typeNames()).toContain('Unitree_G1');
  });

  it('never deletes a standard robot type, used or not', async () => {
    await seedStandardRobotTypes();
    const standard = await rawPrisma.robotType.findUniqueOrThrow({ where: { name: 'Microduck' } });

    const res = await request(app).delete(`/api/datasets/robot-types/${standard.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROBOT_TYPE_STANDARD');
    expect(await typeNames()).toContain('Microduck');
  });

  it('answers 404 for a robot type that does not exist', async () => {
    const res = await request(app).delete('/api/datasets/robot-types/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROBOT_TYPE_NOT_FOUND');
  });
});

describe('the remove:robot-type script against the real routes', () => {
  it('removes the named type, then reports it absent on a second run', async () => {
    await seedStandardRobotTypes();
    await staleType();
    const before = await typeNames();

    expect(await removeRobotType({ baseUrl, name: 'Unitree_G1', dryRun: true })).toMatchObject({ outcome: 'would-remove' });
    expect(await typeNames()).toEqual(before);

    expect(await removeRobotType({ baseUrl, name: 'Unitree_G1' })).toMatchObject({
      outcome: 'removed',
      robotType: { name: 'Unitree_G1', actionDim: 28 },
    });
    expect(await typeNames()).toEqual(before.filter((n) => n !== 'Unitree_G1'));
    expect(await removeRobotType({ baseUrl, name: 'Unitree_G1' })).toEqual({ outcome: 'absent' });
  });

  it('reports the server’s refusal for a type in use, and matches names exactly', async () => {
    const stale = await staleType();
    await datasetOn(stale.id, 'apple-to-plate');

    const refused = await removeRobotType({ baseUrl, name: 'Unitree_G1' });
    expect(refused.outcome).toBe('refused');
    expect(refused.reason).toContain('"apple-to-plate"');
    expect(await removeRobotType({ baseUrl, name: 'unitree_g1' })).toEqual({ outcome: 'absent' });
    expect(await typeNames()).toEqual(['Unitree_G1']);
  });
});

describe('GET /api/robots/:id/robot-type (TASK-485)', () => {
  it('links each demo robot to its robot type by the name its metadata states', async () => {
    await seedStandardRobotTypes();
    await syncDemoFleet({ baseUrl });

    const duck = await request(app).get('/api/robots/demo-microduck/robot-type');
    expect(duck.status).toBe(200);
    expect(duck.body).toMatchObject({
      linkedBy: 'explicit',
      robotType: { name: 'Microduck', actionDim: 15, proprioceptionDim: 15 },
    });
    expect((await request(app).get('/api/robots/demo-so101/robot-type')).body.robotType.name).toBe('SO-101 Follower');
    expect((await request(app).get('/api/robots/demo-g1-dex3/robot-type')).body.robotType.name).toBe('Unitree G1 EDU (Dex3-1)');
  });

  it('falls back to the model string, and says nothing when no type fits', async () => {
    await seedStandardRobotTypes();
    await request(app).put('/api/robots/duck-2/expected').send({ name: 'Duck 2', model: 'Pollen Robotics Microduck' });
    await request(app).put('/api/robots/mystery/expected').send({ name: 'Mystery', model: 'Acme Walker 9' });

    expect((await request(app).get('/api/robots/duck-2/robot-type')).body).toMatchObject({
      linkedBy: 'model',
      robotType: { name: 'Microduck' },
    });
    expect((await request(app).get('/api/robots/mystery/robot-type')).body).toEqual({ robotType: null, linkedBy: null });
    expect((await request(app).get('/api/robots/absent/robot-type')).status).toBe(404);
  });
});

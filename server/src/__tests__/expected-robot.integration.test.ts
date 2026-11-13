/**
 * @file expected-robot.integration.test.ts
 * @description TASK-477 over HTTP against a real temp SQLite database: a robot
 *   can be put on the fleet before its agent exists (`PUT /api/robots/:id/expected`),
 *   the route never rewrites a robot an agent has registered, an agent that
 *   registers under the id takes the row over, and the demo-fleet sync is
 *   idempotent and leaves robots it did not create alone.
 * @feature robots
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

const { robotRoutes, NOT_AN_EXPECTED_ROBOT_ERROR } = await import('../routes/robot.routes.js');
const { datasetRoutes } = await import('../routes/datasets.routes.js');
const { robotRepository } = await import('../repositories/index.js');
const { seedStandardRobotTypes } = await import('../database/seedStandardRobotTypes.js');
const { DEMO_FLEET, missingRobotTypes, syncDemoFleet } = await import('../scripts/demoFleet.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;
let server: Server;
let baseUrl: string;

const DUCK = {
  name: 'MicroDuck',
  model: 'Pollen Robotics Microduck',
  provisioning: 'arriving',
  note: 'Not delivered yet.',
  capabilities: ['bipedal locomotion'],
  metadata: { manufacturer: 'Pollen Robotics', degreesOfFreedom: 15 },
};

/** What a robot agent reports about itself when it registers. */
function agentRobot(id: string, metadata?: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id,
    name: 'G1 (live)',
    model: 'Unitree G1 EDU',
    status: 'online' as const,
    batteryLevel: 87,
    location: { x: 0, y: 0 },
    lastSeen: now,
    capabilities: ['navigation'],
    metadata,
    createdAt: now,
    updatedAt: now,
    a2aEnabled: true,
    a2aAgentUrl: 'http://g1:41243',
  };
}

async function registerAgent(id: string, metadata?: Record<string, unknown>) {
  return robotRepository.upsertWithRegistration(
    agentRobot(id, metadata),
    { robot: 'http://g1:41243/r', command: 'http://g1:41243/c', telemetry: 'http://g1:41243/t', telemetryWs: 'ws://g1:41243/ws' },
    { name: `agent-${id}`, description: 'G1 agent', url: 'http://g1:41243', defaultInputModes: ['text'], defaultOutputModes: ['text'], skills: [] },
    'http://g1:41243',
  );
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-expected-robot-'));
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
  await rawPrisma.agentCard.deleteMany({});
  await rawPrisma.robotEndpoints.deleteMany({});
  await rawPrisma.robot.deleteMany({});
});

describe('PUT /api/robots/:id/expected (TASK-477)', () => {
  it('creates an offline robot with no agent and lists it on the fleet', async () => {
    const res = await request(app).put('/api/robots/duck-1/expected').send(DUCK);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.robot).toMatchObject({
      id: 'duck-1',
      name: 'MicroDuck',
      model: 'Pollen Robotics Microduck',
      status: 'offline',
      batteryLevel: null,
      a2aEnabled: false,
      capabilities: ['bipedal locomotion'],
      metadata: {
        manufacturer: 'Pollen Robotics',
        degreesOfFreedom: 15,
        provisioning: 'arriving',
        provisioningNote: 'Not delivered yet.',
      },
    });

    const row = await rawPrisma.robot.findUnique({ where: { id: 'duck-1' } });
    expect(row).toMatchObject({ registeredAt: null, baseUrl: null, isConnected: false });

    const list = await request(app).get('/api/robots');
    expect(list.body.robots.map((r: { id: string }) => r.id)).toEqual(['duck-1']);
    expect((await request(app).get('/api/robots/duck-1')).body.status).toBe('offline');
  });

  it('is idempotent: a second PUT updates the same row and creates no duplicate', async () => {
    await request(app).put('/api/robots/duck-1/expected').send(DUCK);
    const res = await request(app)
      .put('/api/robots/duck-1/expected')
      .send({ ...DUCK, provisioning: 'awaiting_agent', note: 'Unboxed.' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.robot.metadata).toMatchObject({ provisioning: 'awaiting_agent', provisioningNote: 'Unboxed.' });
    expect(await rawPrisma.robot.count()).toBe(1);
  });

  it('defaults to awaiting_agent and drops the note when none is given', async () => {
    const res = await request(app).put('/api/robots/arm-1/expected').send({ name: 'SO-101', model: 'SO-101 Follower' });
    expect(res.status).toBe(201);
    expect(res.body.robot.metadata).toEqual({ provisioning: 'awaiting_agent' });
  });

  it('refuses a robot an agent has registered and leaves it untouched', async () => {
    await registerAgent('g1-1', { isSimulated: false });
    const before = await rawPrisma.robot.findUnique({ where: { id: 'g1-1' } });

    const res = await request(app).put('/api/robots/g1-1/expected').send(DUCK);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(NOT_AN_EXPECTED_ROBOT_ERROR);
    expect(await rawPrisma.robot.findUnique({ where: { id: 'g1-1' } })).toEqual(before);
  });

  it('refuses an unregistered row that is not an expected robot (another seed wrote it)', async () => {
    await rawPrisma.robot.create({ data: { id: 'seeded-1', name: 'Seeded', model: 'h1', metadata: '{"origin":"eval"}' } });
    const res = await request(app).put('/api/robots/seeded-1/expected').send(DUCK);
    expect(res.status).toBe(409);
    expect((await rawPrisma.robot.findUnique({ where: { id: 'seeded-1' } }))?.name).toBe('Seeded');
  });

  it.each([
    ['no name', { model: 'm' }, /name is required/],
    ['no model', { name: 'n' }, /model is required/],
    ['an unknown provisioning state', { name: 'n', model: 'm', provisioning: 'online' }, /provisioning must be one of/],
    ['a nested metadata value', { name: 'n', model: 'm', metadata: { a: { b: 1 } } }, /metadata must be/],
    ['a provisioning key smuggled into metadata', { name: 'n', model: 'm', metadata: { provisioning: 'x' } }, /metadata\.provisioning/],
    ['capabilities that are not strings', { name: 'n', model: 'm', capabilities: [1] }, /capabilities must be/],
  ])('answers 400 for %s and writes nothing', async (_label, body, message) => {
    const res = await request(app).put('/api/robots/bad-1/expected').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await rawPrisma.robot.count()).toBe(0);
  });

  it('answers 400 for an id that is not a plain slug', async () => {
    const res = await request(app).put('/api/robots/bad%20id/expected').send(DUCK);
    expect(res.status).toBe(400);
  });

  it('can be removed again with DELETE /:id although it has no agent', async () => {
    await request(app).put('/api/robots/duck-1/expected').send(DUCK);
    const res = await request(app).delete('/api/robots/duck-1');
    expect(res.status).toBe(200);
    expect(await rawPrisma.robot.count()).toBe(0);
  });
});

describe('an agent registering under an expected robot’s id takes the row over', () => {
  it('stamps registeredAt and drops the provisioning keys when the agent sends no metadata', async () => {
    await request(app).put('/api/robots/g1-1/expected').send({ ...DUCK, name: 'G1', metadata: { manufacturer: 'Unitree' } });
    await registerAgent('g1-1');

    const row = await rawPrisma.robot.findUnique({ where: { id: 'g1-1' } });
    expect(row?.registeredAt).not.toBeNull();
    expect(row?.name).toBe('G1 (live)');
    expect(JSON.parse(row!.metadata!)).toEqual({ manufacturer: 'Unitree' });
    // …so the next server start loads it for health checks.
    expect((await robotRepository.getAllRegisteredRobots()).map((r) => r.robot.id)).toEqual(['g1-1']);
    // …and it is no longer an expected robot.
    expect((await request(app).put('/api/robots/g1-1/expected').send(DUCK)).status).toBe(409);
  });

  it('uses the agent’s own metadata when it sends some', async () => {
    await request(app).put('/api/robots/g1-1/expected').send(DUCK);
    await registerAgent('g1-1', { isSimulated: false });
    const row = await rawPrisma.robot.findUnique({ where: { id: 'g1-1' } });
    expect(JSON.parse(row!.metadata!)).toEqual({ isSimulated: false });
  });

  it('leaves registeredAt of an already registered robot alone on re-registration', async () => {
    await registerAgent('g1-1', { isSimulated: false });
    const first = (await rawPrisma.robot.findUnique({ where: { id: 'g1-1' } }))!.registeredAt;
    await registerAgent('g1-1');
    const row = await rawPrisma.robot.findUnique({ where: { id: 'g1-1' } });
    expect(row?.registeredAt).toEqual(first);
    expect(JSON.parse(row!.metadata!)).toEqual({ isSimulated: false });
  });
});

describe('the demo-fleet sync against the real routes', () => {
  it('creates the three robots, then writes nothing on a second run', async () => {
    const first = await syncDemoFleet({ baseUrl });
    expect(first.map((r) => [r.id, r.outcome])).toEqual([
      ['demo-g1-dex3', 'created'],
      ['demo-so101', 'created'],
      ['demo-microduck', 'created'],
    ]);
    const rows = await rawPrisma.robot.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.id, r.name, r.model, r.status])).toEqual([
      ['demo-g1-dex3', 'Unitree G1 with Dex3 hands', 'Unitree G1 EDU (Dex3-1)', 'offline'],
      ['demo-microduck', 'MicroDuck', 'Pollen Robotics Microduck', 'offline'],
      ['demo-so101', 'SO-101', 'SO-101 Follower', 'offline'],
    ]);
    const stamps = rows.map((r) => r.updatedAt.getTime());

    // The other spelling of the same instance.
    const second = await syncDemoFleet({ baseUrl: `${baseUrl}/api/` });
    expect(second.map((r) => r.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    const after = await rawPrisma.robot.findMany({ orderBy: { id: 'asc' } });
    expect(after).toHaveLength(3);
    expect(after.map((r) => r.updatedAt.getTime())).toEqual(stamps);
  });

  it('repairs a row of its own that drifted', async () => {
    await syncDemoFleet({ baseUrl });
    await rawPrisma.robot.update({ where: { id: 'demo-so101' }, data: { name: 'renamed' } });
    const results = await syncDemoFleet({ baseUrl });
    expect(results.find((r) => r.id === 'demo-so101')?.outcome).toBe('updated');
    expect((await rawPrisma.robot.findUnique({ where: { id: 'demo-so101' } }))?.name).toBe('SO-101');
  });

  it('skips a robot under one of its ids that an agent registered, and never removes it', async () => {
    await registerAgent('demo-g1-dex3', { isSimulated: false });
    const before = await rawPrisma.robot.findUnique({ where: { id: 'demo-g1-dex3' } });

    const results = await syncDemoFleet({ baseUrl });
    expect(results[0]).toMatchObject({ id: 'demo-g1-dex3', outcome: 'skipped' });
    expect(results.slice(1).map((r) => r.outcome)).toEqual(['created', 'created']);

    const removed = await syncDemoFleet({ baseUrl, remove: true });
    expect(removed.map((r) => r.outcome)).toEqual(['skipped', 'removed', 'removed']);
    expect(await rawPrisma.robot.findMany()).toEqual([before]);
  });

  it('leaves robots it does not know about alone when removing', async () => {
    await registerAgent('sim-robot-001', { isSimulated: true });
    await syncDemoFleet({ baseUrl });
    await syncDemoFleet({ baseUrl, remove: true });
    expect((await rawPrisma.robot.findMany()).map((r) => r.id)).toEqual(['sim-robot-001']);
    expect((await syncDemoFleet({ baseUrl, remove: true })).map((r) => r.outcome)).toEqual(['absent', 'absent', 'absent']);
  });

  it('writes nothing on a dry run', async () => {
    const results = await syncDemoFleet({ baseUrl, dryRun: true });
    expect(results.map((r) => r.outcome)).toEqual(['would-create', 'would-create', 'would-create']);
    expect(await rawPrisma.robot.count()).toBe(0);
  });

  it('every demo robot names a standard robot type the server seeds', async () => {
    await rawPrisma.robotType.deleteMany({});
    expect(await missingRobotTypes({ baseUrl })).toEqual(DEMO_FLEET.map((r) => r.robotTypeName));
    await seedStandardRobotTypes(rawPrisma as never);
    expect(await missingRobotTypes({ baseUrl })).toEqual([]);
  });
});

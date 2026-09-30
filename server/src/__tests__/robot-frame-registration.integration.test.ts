/**
 * @file robot-frame-registration.integration.test.ts
 * @description TASK-341 over HTTP against a real temp SQLite database:
 *   `GET/PUT/DELETE /api/robots/:id/frame-registration` — a place anchor
 *   computed from the robot's live odometry, a manual transform, currentness
 *   (odometry session, site), and the registration dropped with the site.
 * @feature robots
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
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
const { robotManager } = await import('../services/RobotManager.js');
const { applyTransform } = await import('../services/FrameRegistrationService.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;

/** A 2 × 2 m room centred on (3, 2). */
const ROOM = JSON.stringify([
  { x: 2, y: 1 },
  { x: 4, y: 1 },
  { x: 4, y: 3 },
  { x: 2, y: 3 },
]);

type Live = { x: number; y: number; heading: number; frame: { kind: 'odom' | 'sim'; id: string } | null } | null;

/** What the robot manager's cache says about the robot's live pose. */
function setLive(live: Live): void {
  vi.spyOn(robotManager, 'getRegisteredRobot').mockResolvedValue(
    (live === null
      ? { isConnected: false, robot: { location: { x: 0, y: 0 } } }
      : { isConnected: true, robot: { location: live } }) as never,
  );
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-frame-reg-'));
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
}, 120_000);

afterAll(async () => {
  await rawPrisma?.$disconnect();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await rawPrisma.robotFrameRegistration.deleteMany({});
  await rawPrisma.robot.deleteMany({});
  await rawPrisma.digitalTwin.deleteMany({});
  await rawPrisma.digitalTwin.create({ data: { id: 'twin-a', name: 'Hall A' } });
  await rawPrisma.digitalTwin.create({ data: { id: 'twin-b', name: 'Hall B' } });
  await rawPrisma.twinZone.create({
    data: { twinId: 'twin-a', name: 'DOCK', nameKey: 'dock', type: 'room', points: ROOM },
  });
  await rawPrisma.robot.create({
    data: { id: 'robot-1', name: 'G1', model: 'g1', twinId: 'twin-a', location: JSON.stringify({ x: 0, y: 0 }) },
  });
  setLive({ x: 1, y: 0, heading: 0, frame: { kind: 'odom', id: 'boot-1' } });
});

const ANCHOR = { method: 'place-anchor', placeId: 'dock', headingDeg: 90 };

describe('PUT /api/robots/:id/frame-registration (TASK-341)', () => {
  it('computes a place anchor from the live odometry pose and stores it', async () => {
    const res = await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      robotId: 'robot-1',
      twinId: 'twin-a',
      odomFrameId: 'boot-1',
      method: 'place-anchor',
      anchorPlaceId: 'DOCK',
      current: true,
      staleReason: null,
    });
    // odom (1, 0, 0°) → the dock's centre (3, 2), facing 90°.
    const twin = applyTransform(res.body, { x: 1, y: 0, headingDeg: 0 });
    expect(twin.x).toBeCloseTo(3, 9);
    expect(twin.y).toBeCloseTo(2, 9);
    expect(twin.headingDeg).toBeCloseTo(90, 9);
    expect(await rawPrisma.robotFrameRegistration.count({ where: { robotId: 'robot-1' } })).toBe(1);
  });

  it('stores a manual transform and replaces the previous one', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    const res = await request(app)
      .put('/api/robots/robot-1/frame-registration')
      .send({ method: 'manual', x: 1.5, y: -2, yawDeg: 45 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ method: 'manual', x: 1.5, y: -2, yawDeg: 45, anchorPlaceId: null });
    expect(await rawPrisma.robotFrameRegistration.count({ where: { robotId: 'robot-1' } })).toBe(1);
  });

  it('answers 400 for a malformed body', async () => {
    const res = await request(app).put('/api/robots/robot-1/frame-registration').send({ method: 'manual', x: 1 });
    expect(res.status).toBe(400);
  });

  it('answers 404 for an unknown robot or a place outside the site', async () => {
    expect((await request(app).put('/api/robots/nope/frame-registration').send(ANCHOR)).status).toBe(404);
    const res = await request(app)
      .put('/api/robots/robot-1/frame-registration')
      .send({ ...ANCHOR, placeId: 'no-such-place' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('no-such-place');
  });

  it('answers 409 without a site, a connection, an odometry frame — or for a sim frame', async () => {
    const put = () => request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);

    setLive(null);
    expect((await put()).status).toBe(409);

    setLive({ x: 1, y: 0, heading: 0, frame: null });
    expect((await put()).status).toBe(409);

    setLive({ x: 1, y: 0, heading: 0, frame: { kind: 'sim', id: 'warehouse' } });
    const sim = await put();
    expect(sim.status).toBe(409);
    expect(sim.body.error).toContain('needs no alignment');

    setLive({ x: 1, y: 0, heading: 0, frame: { kind: 'odom', id: 'boot-1' } });
    await rawPrisma.robot.update({ where: { id: 'robot-1' }, data: { twinId: null } });
    expect((await put()).status).toBe(409);

    expect(await rawPrisma.robotFrameRegistration.count()).toBe(0);
  });
});

describe('GET /api/robots/:id/frame-registration (TASK-341)', () => {
  it('answers 404 when there is none', async () => {
    const res = await request(app).get('/api/robots/robot-1/frame-registration');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no frame registration');
  });

  it('is current while the odometry session and the site are the ones it was measured in', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    const res = await request(app).get('/api/robots/robot-1/frame-registration');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe(true);
  });

  it('goes stale when odometry restarts (new frame id)', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    setLive({ x: 0, y: 0, heading: 0, frame: { kind: 'odom', id: 'boot-2' } });
    const res = await request(app).get('/api/robots/robot-1/frame-registration');
    expect(res.body.current).toBe(false);
    expect(res.body.staleReason).toContain('odometry restarted');
  });

  it('is not current while the robot is offline', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    setLive(null);
    const res = await request(app).get('/api/robots/robot-1/frame-registration');
    expect(res.body.current).toBe(false);
    expect(res.body.staleReason).toContain('not connected');
  });
});

describe('the registration follows the site binding (TASK-341)', () => {
  it('is deleted when the robot moves to another site', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    expect((await request(app).patch('/api/robots/robot-1').send({ twinId: 'twin-b' })).status).toBe(200);
    expect(await rawPrisma.robotFrameRegistration.count()).toBe(0);
    expect((await request(app).get('/api/robots/robot-1/frame-registration')).status).toBe(404);
  });

  it('survives re-binding the same site', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    await request(app).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
    expect(await rawPrisma.robotFrameRegistration.count()).toBe(1);
  });
});

describe('DELETE /api/robots/:id/frame-registration (TASK-341)', () => {
  it('removes it, then answers 404', async () => {
    await request(app).put('/api/robots/robot-1/frame-registration').send(ANCHOR);
    expect((await request(app).delete('/api/robots/robot-1/frame-registration')).status).toBe(204);
    expect((await request(app).delete('/api/robots/robot-1/frame-registration')).status).toBe(404);
  });
});

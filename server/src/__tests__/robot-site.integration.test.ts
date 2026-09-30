/**
 * @file robot-site.integration.test.ts
 * @description TASK-327 over HTTP against a real temp SQLite database: a robot
 *   is bound to a site (`PATCH /api/robots/:id {twinId}`), serves that twin's
 *   place graph (`GET /api/robots/:id/places`), is unbound when the twin is
 *   deleted (`onDelete: SetNull`), and the "Demo Warehouse" seed reproduces
 *   the sim's `places.warehouse.json` exactly once.
 * @feature robots
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Express, type NextFunction, type Response } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ holder: { client: undefined as unknown } }));

vi.mock('../database/index.js', () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (h.holder.client as Record<string | symbol, unknown>)[prop] }),
}));

const { robotRoutes } = await import('../routes/robot.routes.js');
const { robotManager } = await import('../services/RobotManager.js');
const { writeRoleGuard } = await import('../middleware/auth.middleware.js');
const { seedDemoWarehouse, DEMO_WAREHOUSE_NAME, DEMO_WAREHOUSE_PLACES } = await import(
  '../database/seedDemoWarehouse.js'
);

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;

const SQUARE = JSON.stringify([
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
]);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-robot-site-'));
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
  await rawPrisma.robot.deleteMany({});
  await rawPrisma.digitalTwin.deleteMany({});
  await rawPrisma.digitalTwin.create({ data: { id: 'twin-a', name: 'Hall A' } });
  await rawPrisma.twinZone.create({
    data: { twinId: 'twin-a', name: 'AISLE-1', nameKey: 'aisle-1', type: 'room', points: SQUARE },
  });
  await rawPrisma.robot.create({
    data: { id: 'robot-1', name: 'G1', model: 'g1', location: JSON.stringify({ x: 0, y: 0 }) },
  });
});

describe('PATCH /api/robots/:id binds a robot to a site (TASK-327)', () => {
  it('binds, puts twinId on the DTO, and persists it', async () => {
    const res = await request(app).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
    expect(res.status).toBe(200);
    expect(res.body.twinId).toBe('twin-a');
    expect((await rawPrisma.robot.findUnique({ where: { id: 'robot-1' } }))?.twinId).toBe('twin-a');
    expect((await request(app).get('/api/robots/robot-1')).body.twinId).toBe('twin-a');
  });

  it('unbinds with null', async () => {
    await request(app).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
    const res = await request(app).patch('/api/robots/robot-1').send({ twinId: null });
    expect(res.status).toBe(200);
    expect(res.body.twinId).toBeNull();
    expect((await rawPrisma.robot.findUnique({ where: { id: 'robot-1' } }))?.twinId).toBeNull();
  });

  it('answers 404 for an unknown twin and leaves the binding alone', async () => {
    const res = await request(app).patch('/api/robots/robot-1').send({ twinId: 'no-such-twin' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Digital twin not found');
    expect((await rawPrisma.robot.findUnique({ where: { id: 'robot-1' } }))?.twinId).toBeNull();
  });

  it('answers 404 for an unknown robot', async () => {
    const res = await request(app).patch('/api/robots/no-such-robot').send({ twinId: 'twin-a' });
    expect(res.status).toBe(404);
  });

  it('answers 400 when twinId is missing or not a string', async () => {
    expect((await request(app).patch('/api/robots/robot-1').send({})).status).toBe(400);
    expect((await request(app).patch('/api/robots/robot-1').send({ twinId: 7 })).status).toBe(400);
  });

  describe('RBAC — the global write guard, as on DELETE /:id', () => {
    function appAs(role: string) {
      const guarded = express();
      guarded.use(express.json());
      guarded.use(
        '/api/robots',
        (req: express.Request, _res: Response, next: NextFunction) => {
          (req as express.Request & { user?: unknown }).user = {
            id: 'user-1',
            userId: 'user-1',
            email: 'u@neodem.local',
            role,
            tenantId: null,
          };
          next();
        },
        writeRoleGuard,
        robotRoutes
      );
      return guarded;
    }

    beforeEach(() => {
      vi.stubEnv('AUTH_DISABLED', 'false');
      return () => vi.unstubAllEnvs();
    });

    it('refuses a viewer with 403', async () => {
      const res = await request(appAs('viewer')).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
      expect(res.status).toBe(403);
      expect((await rawPrisma.robot.findUnique({ where: { id: 'robot-1' } }))?.twinId).toBeNull();
    });

    it('lets a member bind', async () => {
      const res = await request(appAs('member')).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
      expect(res.status).toBe(200);
    });
  });
});

describe('GET /api/robots/:id/places serves the site place graph (TASK-327)', () => {
  it('404s with "robot has no site" when unbound', async () => {
    const res = await request(app).get('/api/robots/robot-1/places');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'robot has no site' });
  });

  it("returns the bound twin's place graph", async () => {
    await request(app).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
    const res = await request(app).get('/api/robots/robot-1/places');
    expect(res.status).toBe(200);
    expect(res.body.frame.twinId).toBe('twin-a');
    expect(res.body.places.map((p: { id: string }) => p.id)).toEqual(['AISLE-1']);
  });

  it('unbinds the robot when its twin is deleted (SetNull)', async () => {
    await request(app).patch('/api/robots/robot-1').send({ twinId: 'twin-a' });
    await rawPrisma.digitalTwin.delete({ where: { id: 'twin-a' } });
    robotManager.forgetSite('twin-a');

    expect((await rawPrisma.robot.findUnique({ where: { id: 'robot-1' } }))?.twinId).toBeNull();
    expect((await request(app).get('/api/robots/robot-1/places')).status).toBe(404);
    expect((await request(app).get('/api/robots/robot-1')).body.twinId).toBeNull();
  });
});

describe('the "Demo Warehouse" seed (TASK-327)', () => {
  const PLACES_JSON = join(
    __dirname, '..', '..', '..', 'robot-agent', 'hardware', 'sim_evaluator', 'places', 'places.warehouse.json'
  );
  type FilePlace = { id: string; placeType: string; floor: number; polygon: [number, number][]; keepout: boolean };
  const filePlaces = (JSON.parse(readFileSync(PLACES_JSON, 'utf8')) as { places: FilePlace[] }).places;

  it('inlines places.warehouse.json 1:1', () => {
    expect(DEMO_WAREHOUSE_PLACES).toEqual(
      filePlaces.map(({ id, placeType, floor, polygon, keepout }) => ({ id, placeType, floor, polygon, keepout }))
    );
  });

  it('seeds exactly one twin whose zones match the file; a second boot adds nothing', async () => {
    await rawPrisma.digitalTwin.deleteMany({});
    const first = await seedDemoWarehouse(rawPrisma as never);
    expect(first).toEqual(expect.any(String));
    expect(await seedDemoWarehouse(rawPrisma as never)).toBeNull();

    const twins = await rawPrisma.digitalTwin.findMany({ where: { name: DEMO_WAREHOUSE_NAME } });
    expect(twins).toHaveLength(1);
    expect(twins[0]).toMatchObject({ status: 'draft', worldOriginX: 0, worldOriginY: 0 });

    const zones = await rawPrisma.twinZone.findMany({ where: { twinId: twins[0].id } });
    expect(zones).toHaveLength(filePlaces.length);
    for (const place of filePlaces) {
      const zone = zones.find((z) => z.name === place.id);
      expect(zone, place.id).toBeDefined();
      const expectedType = place.keepout ? 'keepout' : place.id === 'CHARGING-A' ? 'charging' : 'room';
      expect(zone!.type).toBe(expectedType);
      expect(JSON.parse(zone!.points)).toEqual(place.polygon.map(([x, y]) => ({ x, y })));
      expect(JSON.parse(zone!.metadata ?? '{}').placeType).toBe(place.placeType);
    }
  });

  it("serves the file's places through a robot bound to it", async () => {
    await rawPrisma.digitalTwin.deleteMany({});
    const twinId = (await seedDemoWarehouse(rawPrisma as never))!;
    await request(app).patch('/api/robots/robot-1').send({ twinId });

    const res = await request(app).get('/api/robots/robot-1/places');
    expect(res.status).toBe(200);
    const byId = new Map(res.body.places.map((p: FilePlace) => [p.id, p]));
    expect([...byId.keys()].sort()).toEqual(filePlaces.map((p) => p.id).sort());
    for (const place of filePlaces) {
      expect(byId.get(place.id)).toMatchObject({
        placeType: place.placeType,
        floor: place.floor,
        polygon: place.polygon,
        keepout: place.keepout,
      });
    }
  });
});

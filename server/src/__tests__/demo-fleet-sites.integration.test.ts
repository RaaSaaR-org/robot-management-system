/**
 * @file demo-fleet-sites.integration.test.ts
 * @description TASK-493 against the real routes and a temp SQLite database:
 *   the demo-fleet seed puts its robots on the "Demo Warehouse" site with a
 *   planned place each, binds a named existing robot too, writes no pose,
 *   writes nothing on a dry run or a second run, and leaves alone a robot it
 *   does not own or that an operator bound elsewhere.
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

const { robotRoutes } = await import('../routes/robot.routes.js');
const { digitalTwinRoutes } = await import('../routes/twin.routes.js');
const { seedDemoWarehouse } = await import('../database/seedDemoWarehouse.js');
const { DEMO_FLEET, syncDemoFleet } = await import('../scripts/demoFleet.js');
const { assignDemoSites, keepPlannedPlaces, placeDemoRobots, resolveDemoSite } = await import(
  '../scripts/demoFleetSites.js'
);

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;
let server: Server;
let baseUrl: string;

/** What `npm run seed:demo-fleet` does, minus the printing. */
async function seed(options: { dryRun?: boolean; site?: string; also?: string[] } = {}) {
  const resolved = await resolveDemoSite({ baseUrl, wanted: options.site });
  const robots = placeDemoRobots(DEMO_FLEET, resolved.site);
  const fleet = await syncDemoFleet({ baseUrl, dryRun: options.dryRun, robots });
  const sites = resolved.site
    ? await assignDemoSites({
        baseUrl, site: resolved.site, siteIsExplicit: Boolean(options.site), also: options.also, dryRun: options.dryRun,
      })
    : [];
  return { resolved, fleet, sites };
}

async function robot(id: string) {
  return (await request(app).get(`/api/robots/${id}`)).body as {
    twinId: string | null;
    status: string;
    location: Record<string, unknown>;
    metadata: Record<string, unknown>;
  };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-demo-fleet-sites-'));
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
  app.use('/api/digital-twins', digitalTwinRoutes);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await rawPrisma?.$disconnect();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rawPrisma.robot.deleteMany({});
  await rawPrisma.digitalTwin.deleteMany({});
});

describe('the demo-fleet seed puts its robots on the site (TASK-493)', () => {
  it('binds all three to the only site, each with a planned place and no pose', async () => {
    const twinId = (await seedDemoWarehouse(rawPrisma as never))!;

    const { resolved, fleet, sites } = await seed();
    expect(resolved.site).toMatchObject({ id: twinId, name: 'Demo Warehouse' });
    expect(fleet.map((r) => r.outcome)).toEqual(['created', 'created', 'created']);
    expect(sites.map((r) => `${r.id} ${r.outcome}`)).toEqual([
      'demo-g1-dex3 assigned', 'demo-so101 assigned', 'demo-microduck assigned',
    ]);

    const g1 = await robot('demo-g1-dex3');
    expect(g1.twinId).toBe(twinId);
    expect(g1.metadata.plannedPlace).toBe('STAGING');
    expect(g1.metadata.provisioning).toBe('awaiting_agent');
    // Still an expected robot: offline, and nothing claims it stands anywhere.
    expect(g1.status).toBe('offline');
    expect(g1.location).toEqual({ x: 0, y: 0 });
    expect(g1.location.siteAligned).toBeUndefined();
    expect((await robot('demo-so101')).metadata.plannedPlace).toBe('STAGING');
    expect((await robot('demo-microduck')).metadata.plannedPlace).toBe('DOCK-1');
  });

  it('writes nothing on a second run', async () => {
    await seedDemoWarehouse(rawPrisma as never);
    await seed();
    const before = await rawPrisma.robot.findMany({ orderBy: { id: 'asc' } });

    const again = await seed();
    expect(again.fleet.map((r) => r.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(again.sites.map((r) => r.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(await rawPrisma.robot.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('reports and writes nothing on a dry run, before and after the robots exist', async () => {
    const twinId = (await seedDemoWarehouse(rawPrisma as never))!;

    const fresh = await seed({ dryRun: true });
    expect(fresh.fleet.map((r) => r.outcome)).toEqual(['would-create', 'would-create', 'would-create']);
    expect(fresh.sites.map((r) => r.outcome)).toEqual(['would-assign', 'would-assign', 'would-assign']);
    expect(await rawPrisma.robot.count()).toBe(0);

    // Robots seeded before sites were part of it: no binding, no planned place.
    await syncDemoFleet({ baseUrl });
    const upgrade = await seed({ dryRun: true });
    expect(upgrade.fleet.map((r) => r.outcome)).toEqual(['would-update', 'would-update', 'would-update']);
    expect(upgrade.sites.map((r) => r.outcome)).toEqual(['would-assign', 'would-assign', 'would-assign']);
    expect((await robot('demo-g1-dex3')).twinId).toBeNull();
    expect((await robot('demo-g1-dex3')).metadata.plannedPlace).toBeUndefined();

    const real = await seed();
    expect(real.fleet.map((r) => r.outcome)).toEqual(['updated', 'updated', 'updated']);
    expect((await robot('demo-g1-dex3')).twinId).toBe(twinId);
  });

  it('binds a named existing robot too, and only binds it', async () => {
    const twinId = (await seedDemoWarehouse(rawPrisma as never))!;
    await rawPrisma.robot.create({
      data: {
        id: 'sim-robot-001', name: 'SimBot-01', model: 'SimBot H1', status: 'online',
        location: JSON.stringify({ x: 10, y: 10, floor: '1', heading: 0 }),
        metadata: JSON.stringify({ isSimulated: true }),
      },
    });

    const dry = await seed({ dryRun: true, also: ['sim-robot-001'] });
    expect(dry.sites.at(-1)).toMatchObject({ id: 'sim-robot-001', name: 'SimBot-01', outcome: 'would-assign' });
    expect((await rawPrisma.robot.findUniqueOrThrow({ where: { id: 'sim-robot-001' } })).twinId).toBeNull();

    const { sites } = await seed({ also: ['sim-robot-001', 'no-such-robot'] });
    expect(sites.slice(3)).toEqual([
      { id: 'sim-robot-001', name: 'SimBot-01', outcome: 'assigned', reason: expect.stringContaining('not aligned') },
      { id: 'no-such-robot', name: 'no-such-robot', outcome: 'absent', reason: 'no robot with this id' },
    ]);
    const row = await rawPrisma.robot.findUniqueOrThrow({ where: { id: 'sim-robot-001' } });
    expect(row.twinId).toBe(twinId);
    expect(JSON.parse(row.location)).toEqual({ x: 10, y: 10, floor: '1', heading: 0 });
    expect(JSON.parse(row.metadata ?? '{}')).toEqual({ isSimulated: true });

    expect((await seed({ also: ['sim-robot-001'] })).sites.at(-1)).toMatchObject({ outcome: 'unchanged' });
  });

  it('leaves the robots under "No site" when there is none, and asks which when there are several', async () => {
    const none = await seed();
    expect(none.resolved).toEqual({ site: null, reason: 'this instance has no site yet' });
    expect(none.sites).toEqual([]);
    expect((await robot('demo-g1-dex3')).twinId).toBeNull();
    expect((await robot('demo-g1-dex3')).metadata.plannedPlace).toBeUndefined();

    const warehouse = (await seedDemoWarehouse(rawPrisma as never))!;
    await rawPrisma.digitalTwin.create({ data: { id: 'twin-lab', name: 'Lab' } });
    const several = await seed();
    expect(several.resolved.site).toBeNull();
    expect((several.resolved as { reason: string }).reason).toMatch(/2 sites .*pass --site/);

    const named = await seed({ site: 'Demo Warehouse' });
    expect(named.sites.map((r) => r.outcome)).toEqual(['assigned', 'assigned', 'assigned']);
    expect((await robot('demo-so101')).twinId).toBe(warehouse);
    await expect(seed({ site: 'Nowhere' })).rejects.toThrow(/No site named "Nowhere".*"Demo Warehouse"/);
  });

  it('does not move a robot an operator bound to another site, unless the site is named', async () => {
    const warehouse = (await seedDemoWarehouse(rawPrisma as never))!;
    await seed();
    await rawPrisma.digitalTwin.create({ data: { id: 'twin-lab', name: 'Lab' } });
    await request(app).patch('/api/robots/demo-so101').send({ twinId: 'twin-lab' });
    await rawPrisma.digitalTwin.deleteMany({ where: { id: { notIn: [warehouse, 'twin-lab'] } } });

    // Two sites now, so the warehouse has to be named — which is the explicit move.
    const resolved = await resolveDemoSite({ baseUrl, wanted: 'Demo Warehouse' });
    const implicit = await assignDemoSites({ baseUrl, site: resolved.site! });
    expect(implicit.find((r) => r.id === 'demo-so101')).toMatchObject({
      outcome: 'skipped', reason: expect.stringContaining('another site'),
    });
    expect((await robot('demo-so101')).twinId).toBe('twin-lab');

    const explicit = await assignDemoSites({ baseUrl, site: resolved.site!, siteIsExplicit: true });
    expect(explicit.find((r) => r.id === 'demo-so101')?.outcome).toBe('assigned');
    expect((await robot('demo-so101')).twinId).toBe(warehouse);
  });

  it('never binds a robot under a demo id that it did not create', async () => {
    await seedDemoWarehouse(rawPrisma as never);
    await rawPrisma.robot.create({
      data: { id: 'demo-g1-dex3', name: 'The real G1', model: 'g1', status: 'online', location: JSON.stringify({ x: 1, y: 1 }) },
    });

    const { fleet, sites } = await seed();
    expect(fleet[0]).toMatchObject({ id: 'demo-g1-dex3', outcome: 'skipped' });
    expect(sites[0]).toMatchObject({ id: 'demo-g1-dex3', name: 'The real G1', outcome: 'skipped' });
    expect((await rawPrisma.robot.findUniqueOrThrow({ where: { id: 'demo-g1-dex3' } })).twinId).toBeNull();
  });

  it('keeps a planned place on a run that is told to leave sites alone', async () => {
    await seedDemoWarehouse(rawPrisma as never);
    await seed();

    const kept = await keepPlannedPlaces(DEMO_FLEET, { baseUrl });
    expect(kept.map((r) => r.metadata.plannedPlace)).toEqual(['STAGING', 'STAGING', 'DOCK-1']);
    expect((await syncDemoFleet({ baseUrl, robots: kept })).map((r) => r.outcome)).toEqual([
      'unchanged', 'unchanged', 'unchanged',
    ]);
  });
});

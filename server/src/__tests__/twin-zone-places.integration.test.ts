/**
 * @file twin-zone-places.integration.test.ts
 * @description TASK-326 over HTTP against a real temp SQLite database: a
 *   TwinZone name is a valid place id and unique per twin case-insensitively
 *   (DB unique on `(twinId, nameKey)` → 409), an unsafe name is a 400, and
 *   room/workcell/charging/keepout zones all reach the place graph.
 * @feature digitaltwin
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

const { digitalTwinRoutes } = await import('../routes/twin.routes.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let app: Express;

const SQUARE = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-twinzone-'));
  const dbPath = join(tmpDir, 'test.db');
  const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: join(__dirname, '..', '..'),
    stdio: 'pipe',
  });
  rawPrisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  h.holder.client = rawPrisma;

  await rawPrisma.digitalTwin.create({ data: { id: 'twin-a', name: 'Hall A' } });
  await rawPrisma.digitalTwin.create({ data: { id: 'twin-b', name: 'Hall B' } });

  app = express();
  app.use(express.json());
  app.use('/api/digital-twins', digitalTwinRoutes);
}, 120_000);

afterAll(async () => {
  await rawPrisma?.$disconnect();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function createZone(twinId: string, name: string, type = 'room', extra: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/digital-twins/${twinId}/zones`)
    .send({ name, type, points: SQUARE, ...extra });
}

describe('TwinZone names are unique places (TASK-326)', () => {
  it('rejects a case-insensitive duplicate on the same twin with 409', async () => {
    expect((await createZone('twin-a', 'AISLE-1')).status).toBe(201);
    const dup = await createZone('twin-a', 'aisle-1');
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('A zone named "aisle-1" already exists in this twin');
  });

  it('accepts the same name on another twin', async () => {
    expect((await createZone('twin-b', 'aisle-1')).status).toBe(201);
  });

  it('rejects a rename onto a taken name with 409, not 404', async () => {
    const other = await createZone('twin-a', 'aisle-2');
    expect(other.status).toBe(201);
    const res = await request(app)
      .put(`/api/digital-twins/twin-a/zones/${other.body.id}`)
      .send({ name: 'Aisle-1' });
    expect(res.status).toBe(409);
  });

  it('rejects a name that is not a safe place id with 400', async () => {
    const res = await createZone('twin-a', 'Aisle 1 / north');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not a valid place id');
  });

  it('rejects an unsafe metadata.placeId override with 400', async () => {
    const res = await createZone('twin-a', 'aisle-9', 'room', { metadata: { placeId: 'bad id' } });
    expect(res.status).toBe(400);
  });

  it('emits room, workcell, charging and keepout zones as places; speed stays out', async () => {
    await rawPrisma.digitalTwin.create({ data: { id: 'twin-c', name: 'Hall C' } });
    for (const [name, type] of [
      ['room-1', 'room'],
      ['cell-1', 'workcell'],
      ['dock-1', 'charging'],
      ['rack-1', 'keepout'],
      ['slow-1', 'speed'],
    ]) {
      expect((await createZone('twin-c', name, type)).status).toBe(201);
    }
    const res = await request(app).get('/api/digital-twins/twin-c/places/_index.json');
    expect(res.status).toBe(200);
    const places = res.body.places as Array<{ id: string; keepout: boolean }>;
    expect(places.map((p) => [p.id, p.keepout])).toEqual([
      ['ROOM-1', false],
      ['CELL-1', false],
      ['DOCK-1', false],
      ['RACK-1', true],
    ]);
  });
});

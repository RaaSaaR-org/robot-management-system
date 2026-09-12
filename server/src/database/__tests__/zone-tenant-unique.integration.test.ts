/**
 * @file zone-tenant-unique.integration.test.ts
 * @description Two-tenant integration test for the TASK-288 zone constraint.
 * @feature multi-tenancy
 *
 * Every existing zone suite mocks the seam that carried the defect. The
 * repository unit test mocks prisma, `ZoneService.test.ts` mocks the whole
 * repository module, and `zone-routes.test.ts` mocks the service — so the
 * service could never observe that its duplicate pre-check went through a
 * compound-unique `findUnique` the tenant extension can only post-filter to
 * null. Another tenant's "Warehouse A" read back as "no duplicate", validation
 * passed, and the insert raised a raw P2002.
 *
 * This file mocks nothing below the feature flag: it pushes the real schema to
 * a temp SQLite database, binds the REAL client singleton to it (the isolation
 * extension included, not a copy of it as `client.test.ts` uses), and drives
 * the real `ZoneService` through the real `tenantStore`.
 *
 * Neither existing tenancy suite could host this:
 * `multi-tenancy.integration.test.ts` re-implements a four-model allowlist that
 * excludes Zone, and `client.test.ts` re-implements a stale copy of the
 * allowlist plus its own copy of the extension.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The flag is read at module load, so it has to be true before client.ts is
// imported. Everything below the flag — tenantContext, the extension, the
// repository and the service — is the real module.
vi.mock('../../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const BOUNDS = { x: 0, y: 0, width: 10, height: 10 };

let tmpDir: string;
let dbPath: string;
let previousDatabaseUrl: string | undefined;

let raw: PrismaClient;
let tenantStore: (typeof import('../../middleware/tenantContext.js'))['tenantStore'];
let zoneService: (typeof import('../../services/ZoneService.js'))['zoneService'];
let ZoneValidationError: (typeof import('../../services/ZoneService.js'))['ZoneValidationError'];
let zoneRepository: (typeof import('../../repositories/ZoneRepository.js'))['zoneRepository'];

/** Run a body inside a tenant's request scope, exactly as the middleware does. */
function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ tenantId }, fn);
}

function createWarehouseA() {
  return zoneService.createZone({
    name: 'Warehouse A',
    floor: '1',
    type: 'operational',
    bounds: BOUNDS,
  });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-zone-tenant-'));
  dbPath = join(tmpDir, 'test.db');

  const projectRoot = join(__dirname, '..', '..', '..');
  const schemaPath = join(projectRoot, 'prisma', 'schema.prisma');
  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: projectRoot,
    stdio: 'pipe',
  });

  // `buildPrisma()` passes no `datasources`, so the singleton reads
  // DATABASE_URL at construction — it must point at the temp database BEFORE
  // the module is imported. The cached instance on globalThis is dropped too:
  // vitest reuses a worker across files, and a client another file built would
  // still be pointing at that file's database.
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  delete (globalThis as { prisma?: unknown }).prisma;

  ({ tenantStore } = await import('../../middleware/tenantContext.js'));
  ({ zoneService, ZoneValidationError } = await import('../../services/ZoneService.js'));
  ({ zoneRepository } = await import('../../repositories/ZoneRepository.js'));

  raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.tenant.createMany({
    data: [
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });
}, 120000);

afterAll(async () => {
  await raw.$disconnect();
  const { prisma } = await import('../client.js');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Raw client: the reset must not be tenant-scoped, or it would leave the
  // other tenant's zones behind for the next test.
  await raw.zone.deleteMany();
});

// ---------------------------------------------------------------------------

describe('zone name/floor uniqueness across tenants', () => {
  it('lets both tenants create "Warehouse A" on floor 1', async () => {
    // Under the global `@@unique([name, floor])` the second call raised P2002
    // and the route turned it into a bare 500 — and "Warehouse A" is a default
    // zone name, so this was the first thing every second tenant hit.
    const a = await asTenant(TENANT_A, createWarehouseA);
    const b = await asTenant(TENANT_B, createWarehouseA);

    expect(a.name).toBe('Warehouse A');
    expect(b.name).toBe('Warehouse A');
    expect(a.id).not.toBe(b.id);

    const rows = await raw.zone.findMany({ orderBy: { tenantId: 'asc' } });
    expect(rows.map((z) => z.tenantId)).toEqual([TENANT_A, TENANT_B]);
  });

  it('rejects a same-tenant duplicate from the pre-check, not the database', async () => {
    await asTenant(TENANT_A, createWarehouseA);

    const duplicate = asTenant(TENANT_A, createWarehouseA);

    // A ZoneValidationError is the 400 path. A PrismaClientKnownRequestError
    // here would mean the pre-check missed it and the index caught it — the
    // 500 this task exists to remove.
    await expect(duplicate).rejects.toBeInstanceOf(ZoneValidationError);
    await expect(duplicate).rejects.toMatchObject({
      errors: [
        {
          field: 'name',
          message: 'Zone with name "Warehouse A" already exists on floor 1',
        },
      ],
    });
    expect(await raw.zone.count()).toBe(1);
  });

  it('scopes the duplicate pre-check to the calling tenant', async () => {
    await asTenant(TENANT_A, createWarehouseA);

    // The heart of the defect: a compound-unique findUnique returned tenant
    // A's row and the extension post-filtered it to null, so tenant B saw
    // "no duplicate" for the wrong reason. Now B genuinely has none.
    const seenByB = await asTenant(TENANT_B, () =>
      zoneRepository.findByNameAndFloor('Warehouse A', '1')
    );
    const seenByA = await asTenant(TENANT_A, () =>
      zoneRepository.findByNameAndFloor('Warehouse A', '1')
    );

    expect(seenByB).toBeNull();
    expect(seenByA?.name).toBe('Warehouse A');
  });

  it('refuses a rename onto a name already used in the same tenant and floor', async () => {
    await asTenant(TENANT_A, createWarehouseA);
    const dock = await asTenant(TENANT_A, () =>
      zoneService.createZone({
        name: 'Dock 1',
        floor: '1',
        type: 'operational',
        bounds: BOUNDS,
      })
    );

    const rename = asTenant(TENANT_A, () =>
      zoneService.updateZone(dock.id, { name: 'Warehouse A' })
    );

    await expect(rename).rejects.toBeInstanceOf(ZoneValidationError);
    const unchanged = await raw.zone.findUnique({ where: { id: dock.id } });
    expect(unchanged?.name).toBe('Dock 1');
  });

  it('allows a rename onto a name another tenant already uses', async () => {
    await asTenant(TENANT_A, createWarehouseA);
    const dock = await asTenant(TENANT_B, () =>
      zoneService.createZone({
        name: 'Dock 1',
        floor: '1',
        type: 'operational',
        bounds: BOUNDS,
      })
    );

    const renamed = await asTenant(TENANT_B, () =>
      zoneService.updateZone(dock.id, { name: 'Warehouse A' })
    );

    expect(renamed?.name).toBe('Warehouse A');
  });

  it('still allows the same name on a different floor within one tenant', async () => {
    await asTenant(TENANT_A, createWarehouseA);

    const secondFloor = await asTenant(TENANT_A, () =>
      zoneService.createZone({
        name: 'Warehouse A',
        floor: '2',
        type: 'operational',
        bounds: BOUNDS,
      })
    );

    expect(secondFloor.floor).toBe('2');
  });
});

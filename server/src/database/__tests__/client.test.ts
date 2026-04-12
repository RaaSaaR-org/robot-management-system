/**
 * @file client.test.ts
 * @description Unit tests for the tenant-isolation Prisma extension.
 * Tests verify per-operation behaviour for tenant-scoped models
 * (User, Robot, Dataset, TrainingJob) and passthrough for non-scoped models.
 * Uses a real SQLite temp DB with the full schema applied via `prisma db push`.
 * @feature multi-tenancy
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AsyncLocalStorage } from 'async_hooks';

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let prisma: PrismaClient;
let tmpDir: string;
let dbPath: string;

// We need a real ALS to drive the extension, so we mock getTenantId
// by controlling what the ALS returns.
let currentTenantId: string | undefined;

vi.mock('../../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

vi.mock('../../middleware/tenantContext.js', () => ({
  getTenantId: () => currentTenantId,
}));

// ---------------------------------------------------------------------------
// Setup: temp SQLite DB with full schema
// ---------------------------------------------------------------------------

function buildTestPrisma(): PrismaClient {
  // Replicate the extension logic from client.ts against a fresh PrismaClient
  // pointing at our temp DB. This tests the exact same algorithm. The
  // integration tests additionally verify the real module import path.
  const getTenantId = () => currentTenantId;

  const TENANT_SCOPED_MODELS = new Set<string>([
    'User',
    'Robot',
    'Dataset',
    'TrainingJob',
  ]);

  const base = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });

  const extended = base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = getTenantId();
          if (tenantId === undefined) {
            return query(args);
          }

          const a = (args ?? {}) as Record<string, unknown>;

          switch (operation) {
            case 'findMany':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'count':
            case 'aggregate':
            case 'groupBy': {
              const where = (a.where as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              return query(a);
            }

            case 'findUnique':
            case 'findUniqueOrThrow': {
              const result = (await query(a)) as
                | { tenantId?: string | null }
                | null;
              if (result && result.tenantId !== tenantId) {
                if (operation === 'findUniqueOrThrow') {
                  throw new Error(
                    `[tenant-isolation] ${model} not found in tenant ${tenantId}`
                  );
                }
                return null;
              }
              return result;
            }

            case 'create': {
              const data = (a.data as Record<string, unknown>) ?? {};
              a.data = { ...data, tenantId };
              return query(a);
            }

            case 'createMany': {
              const data = a.data;
              if (Array.isArray(data)) {
                a.data = data.map((row: Record<string, unknown>) => ({
                  ...row,
                  tenantId,
                }));
              } else if (data && typeof data === 'object') {
                a.data = { ...(data as Record<string, unknown>), tenantId };
              }
              return query(a);
            }

            case 'upsert': {
              const where = (a.where as Record<string, unknown>) ?? {};
              const create = (a.create as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              a.create = { ...create, tenantId };
              return query(a);
            }

            case 'update':
            case 'delete': {
              const where = (a.where as Record<string, unknown>) ?? {};
              const modelKey =
                model.charAt(0).toLowerCase() + model.slice(1);
              const repo = (base as unknown as Record<
                string,
                {
                  findUnique: (opts: {
                    where: Record<string, unknown>;
                  }) => Promise<{ tenantId?: string | null } | null>;
                }
              >)[modelKey];
              const found = await repo.findUnique({ where });
              if (!found || found.tenantId !== tenantId) {
                throw new Error(
                  `[tenant-isolation] ${model} ${operation} denied: not found in tenant ${tenantId}`
                );
              }
              return query(a);
            }

            case 'updateMany':
            case 'deleteMany': {
              const where = (a.where as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              return query(a);
            }

            default:
              return query(args);
          }
        },
      },
    },
  });

  return extended as unknown as PrismaClient;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-test-'));
  dbPath = join(tmpDir, 'test.db');

  // Push schema to temp DB
  const schemaPath = join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');
  execSync(
    `npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`,
    {
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      cwd: join(__dirname, '..', '..', '..'),
      stdio: 'pipe',
    }
  );

  prisma = buildTestPrisma();

  // Seed tenants
  const rawPrisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await rawPrisma.tenant.createMany({
    data: [
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });

  // Seed a RobotType for Dataset FK
  await rawPrisma.robotType.create({
    data: {
      id: 'rt-1',
      name: 'SO-101',
      manufacturer: 'NeoDEM',
      model: 'SO-101',
      actionDim: 6,
      proprioceptionDim: 6,
    },
  });

  await rawPrisma.$disconnect();
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  currentTenantId = TENANT_A;

  // Clean scoped models between tests (use raw client to bypass extension)
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await raw.trainingJob.deleteMany();
  await raw.dataset.deleteMany();
  await raw.robot.deleteMany();
  await raw.user.deleteMany();
  await raw.$disconnect();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedRobotRaw(
  id: string,
  name: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await raw.robot.create({
    data: { id, name, model: 'SO-101', tenantId },
  });
  await raw.$disconnect();
}

async function seedUserRaw(
  id: string,
  email: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await raw.user.create({
    data: {
      id,
      email,
      passwordHash: 'hashed',
      name: email,
      tenantId,
    },
  });
  await raw.$disconnect();
}

// ---------------------------------------------------------------------------
// Robot tests (representative scoped model)
// ---------------------------------------------------------------------------

describe('tenant-isolation extension — Robot', () => {
  describe('findMany', () => {
    it('returns only robots belonging to the current tenant', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      const robots = await prisma.robot.findMany();
      expect(robots).toHaveLength(1);
      expect(robots[0].id).toBe('r-a1');
    });

    it('passes through when getTenantId() returns undefined', async () => {
      currentTenantId = undefined;
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      const robots = await prisma.robot.findMany();
      expect(robots).toHaveLength(2);
    });
  });

  describe('findFirst', () => {
    it('scopes by tenantId', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      const found = await prisma.robot.findFirst({ where: { name: 'Bravo' } });
      expect(found).toBeNull();
    });
  });

  describe('count', () => {
    it('counts only current tenant robots', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      const count = await prisma.robot.count();
      expect(count).toBe(1);
    });
  });

  describe('findUnique', () => {
    it('returns null for a robot in another tenant', async () => {
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      const robot = await prisma.robot.findUnique({ where: { id: 'r-b1' } });
      expect(robot).toBeNull();
    });

    it('returns the robot if it belongs to the current tenant', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);

      const robot = await prisma.robot.findUnique({ where: { id: 'r-a1' } });
      expect(robot).not.toBeNull();
      expect(robot!.name).toBe('Alpha');
    });
  });

  describe('findUniqueOrThrow', () => {
    it('throws for a robot in another tenant', async () => {
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      await expect(
        prisma.robot.findUniqueOrThrow({ where: { id: 'r-b1' } })
      ).rejects.toThrow('[tenant-isolation]');
    });
  });

  describe('create', () => {
    it('stamps tenantId automatically', async () => {
      const robot = await prisma.robot.create({
        data: { id: 'r-new', name: 'New', model: 'SO-101' },
      });
      expect(robot.tenantId).toBe(TENANT_A);
    });

    it('overrides caller-supplied tenantId', async () => {
      const robot = await prisma.robot.create({
        data: { id: 'r-evil', name: 'Evil', model: 'X', tenantId: TENANT_B },
      });
      expect(robot.tenantId).toBe(TENANT_A);
    });
  });

  describe('createMany', () => {
    it('stamps tenantId on all rows', async () => {
      await prisma.robot.createMany({
        data: [
          { id: 'r-m1', name: 'M1', model: 'X' },
          { id: 'r-m2', name: 'M2', model: 'Y' },
        ],
      });

      currentTenantId = undefined;
      const all = await prisma.robot.findMany({
        where: { id: { in: ['r-m1', 'r-m2'] } },
      });
      expect(all).toHaveLength(2);
      expect(all.every((r) => r.tenantId === TENANT_A)).toBe(true);
    });
  });

  describe('upsert', () => {
    it('scopes where + stamps create payload', async () => {
      const robot = await prisma.robot.upsert({
        where: { id: 'r-upsert' },
        create: { id: 'r-upsert', name: 'Upserted', model: 'X' },
        update: { name: 'Updated' },
      });
      expect(robot.tenantId).toBe(TENANT_A);
    });
  });

  describe('update', () => {
    it('allows updating own-tenant robot', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);

      const updated = await prisma.robot.update({
        where: { id: 'r-a1' },
        data: { name: 'Alpha Updated' },
      });
      expect(updated.name).toBe('Alpha Updated');
    });

    it('denies updating a cross-tenant robot', async () => {
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      await expect(
        prisma.robot.update({
          where: { id: 'r-b1' },
          data: { name: 'Hacked' },
        })
      ).rejects.toThrow('[tenant-isolation]');
    });
  });

  describe('delete', () => {
    it('allows deleting own-tenant robot', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);

      await prisma.robot.delete({ where: { id: 'r-a1' } });
      currentTenantId = undefined;
      const found = await prisma.robot.findUnique({ where: { id: 'r-a1' } });
      expect(found).toBeNull();
    });

    it('denies deleting a cross-tenant robot', async () => {
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      await expect(
        prisma.robot.delete({ where: { id: 'r-b1' } })
      ).rejects.toThrow('[tenant-isolation]');

      // Verify the row still exists
      currentTenantId = undefined;
      const found = await prisma.robot.findUnique({ where: { id: 'r-b1' } });
      expect(found).not.toBeNull();
    });
  });

  describe('updateMany', () => {
    it('scopes to current tenant only', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      await prisma.robot.updateMany({
        data: { model: 'UPDATED' },
      });

      currentTenantId = undefined;
      const all = await prisma.robot.findMany();
      const updated = all.filter((r) => r.model === 'UPDATED');
      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe('r-a1');
    });
  });

  describe('deleteMany', () => {
    it('scopes to current tenant only', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      await prisma.robot.deleteMany();

      currentTenantId = undefined;
      const all = await prisma.robot.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('r-b1');
    });
  });
});

// ---------------------------------------------------------------------------
// User tests
// ---------------------------------------------------------------------------

describe('tenant-isolation extension — User', () => {
  describe('findMany', () => {
    it('filters by current tenant', async () => {
      await seedUserRaw('u-a1', 'a@test.com', TENANT_A);
      await seedUserRaw('u-b1', 'b@test.com', TENANT_B);

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe('u-a1');
    });
  });

  describe('create', () => {
    it('stamps tenantId', async () => {
      const user = await prisma.user.create({
        data: {
          id: 'u-new',
          email: 'new@test.com',
          passwordHash: 'h',
          name: 'New',
        },
      });
      expect(user.tenantId).toBe(TENANT_A);
    });
  });

  describe('findUnique', () => {
    it('blocks cross-tenant access', async () => {
      await seedUserRaw('u-b1', 'b@test.com', TENANT_B);
      const user = await prisma.user.findUnique({ where: { id: 'u-b1' } });
      expect(user).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Non-scoped model (Alert) — passthrough
// ---------------------------------------------------------------------------

describe('tenant-isolation extension — non-scoped model (Alert)', () => {
  it('passes through without tenantId injection', async () => {
    // Alert is not in TENANT_SCOPED_MODELS, so the extension should be a no-op.
    const alert = await prisma.alert.create({
      data: {
        title: 'Test',
        severity: 'warning',
        source: 'system',
        message: 'Test alert',
      },
    });
    expect(alert.id).toBeDefined();

    // Switching tenant should NOT filter alerts
    currentTenantId = TENANT_B;
    const alerts = await prisma.alert.findMany();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// runAsPlatform — extension passthrough
// ---------------------------------------------------------------------------

describe('tenant-isolation extension — platform scope', () => {
  it('sees all robots when getTenantId returns undefined', async () => {
    await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

    currentTenantId = undefined;
    const robots = await prisma.robot.findMany();
    expect(robots).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Security: caller tries to inject cross-tenant predicates
// ---------------------------------------------------------------------------

describe('tenant-isolation security', () => {
  describe('explicit tenantId in where is overridden', () => {
    it('findMany ignores caller tenantId in where', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      currentTenantId = TENANT_A;
      const robots = await prisma.robot.findMany({
        where: { tenantId: TENANT_B },
      });
      // Extension should override with TENANT_A
      expect(robots).toHaveLength(1);
      expect(robots[0].tenantId).toBe(TENANT_A);
    });
  });

  describe('explicit tenantId in create data is overridden', () => {
    it('create overrides caller-supplied tenantId', async () => {
      currentTenantId = TENANT_A;
      const robot = await prisma.robot.create({
        data: {
          id: 'r-injected',
          name: 'Injected',
          model: 'X',
          tenantId: TENANT_B,
        },
      });
      expect(robot.tenantId).toBe(TENANT_A);
    });
  });

  describe('AND/OR combinator cross-tenant predicates', () => {
    it('AND with cross-tenant tenantId is overridden', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      currentTenantId = TENANT_A;
      const robots = await prisma.robot.findMany({
        where: {
          AND: [{ tenantId: TENANT_B }],
        },
      });
      // Extension spreads tenantId at the top level, so
      // the AND clause still includes the cross-tenant filter
      // BUT the top-level tenantId = TENANT_A acts as the primary filter.
      // Result: only TENANT_A robots returned.
      expect(robots.every((r) => r.tenantId === TENANT_A)).toBe(true);
    });

    it('OR combinator cannot leak cross-tenant data', async () => {
      await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
      await seedRobotRaw('r-b1', 'Bravo', TENANT_B);

      currentTenantId = TENANT_A;
      const robots = await prisma.robot.findMany({
        where: {
          OR: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }],
        },
      });
      // Top-level tenantId override means only TENANT_A data
      expect(robots.every((r) => r.tenantId === TENANT_A)).toBe(true);
    });
  });

  describe('createMany with mixed tenantIds', () => {
    it('stamps all rows with the caller tenant regardless of input', async () => {
      currentTenantId = TENANT_A;
      await prisma.robot.createMany({
        data: [
          { id: 'r-sec1', name: 'Sec1', model: 'X', tenantId: TENANT_B },
          { id: 'r-sec2', name: 'Sec2', model: 'Y' },
        ],
      });

      currentTenantId = undefined;
      const robots = await prisma.robot.findMany({
        where: { id: { in: ['r-sec1', 'r-sec2'] } },
      });
      expect(robots.every((r) => r.tenantId === TENANT_A)).toBe(true);
    });
  });
});

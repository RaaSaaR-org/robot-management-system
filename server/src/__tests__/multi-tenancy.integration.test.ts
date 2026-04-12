/**
 * @file multi-tenancy.integration.test.ts
 * @description End-to-end integration tests for multi-tenancy isolation.
 * Spins up a real Express app with SQLite, seeds two tenants with data,
 * and verifies cross-tenant isolation via HTTP requests.
 * @feature multi-tenancy
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AsyncLocalStorage } from 'async_hooks';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

// ---------------------------------------------------------------------------
// Build Prisma with tenant extension against a temp DB
// ---------------------------------------------------------------------------

let rawPrisma: PrismaClient;
let tenantPrisma: PrismaClient;
let tmpDir: string;
let dbPath: string;
let app: Express;

const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();

function getTenantId(): string | undefined {
  return tenantStore.getStore()?.tenantId;
}

function buildTenantPrisma(base: PrismaClient): PrismaClient {
  const TENANT_SCOPED_MODELS = new Set<string>([
    'User',
    'Robot',
    'Dataset',
    'TrainingJob',
  ]);

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

// ---------------------------------------------------------------------------
// Minimal Express app that mimics the auth + tenant pipeline
// ---------------------------------------------------------------------------

function buildApp(prismaClient: PrismaClient, multiTenancyEnabled: boolean): Express {
  const a = express();
  a.use(express.json());

  // Simulate auth middleware: read X-Tenant-Id header
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    if (multiTenancyEnabled && tenantId) {
      tenantStore.run({ tenantId }, () => next());
    } else {
      next();
    }
  });

  // GET /api/robots
  a.get('/api/robots', async (_req: Request, res: Response) => {
    try {
      const robots = await prismaClient.robot.findMany();
      res.json({ robots, pagination: { total: robots.length } });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/robots/:id
  a.get('/api/robots/:id', async (req: Request, res: Response) => {
    try {
      const robot = await prismaClient.robot.findUnique({
        where: { id: req.params.id },
      });
      if (!robot) return res.status(404).json({ error: 'Robot not found' });
      res.json(robot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/robots/:id
  a.patch('/api/robots/:id', async (req: Request, res: Response) => {
    try {
      const robot = await prismaClient.robot.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.json(robot);
    } catch (err) {
      if ((err as Error).message.includes('[tenant-isolation]')) {
        return res.status(404).json({ error: 'Robot not found' });
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/robots/:id
  a.delete('/api/robots/:id', async (req: Request, res: Response) => {
    try {
      await prismaClient.robot.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (err) {
      if ((err as Error).message.includes('[tenant-isolation]')) {
        return res.status(404).json({ error: 'Robot not found' });
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/robots
  a.post('/api/robots', async (req: Request, res: Response) => {
    try {
      const robot = await prismaClient.robot.create({
        data: { name: req.body.name, model: req.body.model || 'SO-101' },
      });
      res.status(201).json(robot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/tenants/current
  a.get('/api/tenants/current', async (req: Request, res: Response) => {
    try {
      const tid = getTenantId() ?? 'default';
      const tenant = await prismaClient.tenant.findUnique({ where: { id: tid } });
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      res.json(tenant);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return a;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-integ-'));
  dbPath = join(tmpDir, 'test.db');

  const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  execSync(
    `npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`,
    {
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      cwd: join(__dirname, '..', '..'),
      stdio: 'pipe',
    }
  );

  rawPrisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });

  // Seed tenants
  await rawPrisma.tenant.createMany({
    data: [
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });

  // Seed robots: 2 per tenant
  await rawPrisma.robot.createMany({
    data: [
      { id: 'ra-1', name: 'Alpha-1', model: 'SO-101', tenantId: TENANT_A },
      { id: 'ra-2', name: 'Alpha-2', model: 'SO-101', tenantId: TENANT_A },
      { id: 'rb-1', name: 'Bravo-1', model: 'SO-101', tenantId: TENANT_B },
      { id: 'rb-2', name: 'Bravo-2', model: 'SO-101', tenantId: TENANT_B },
    ],
  });

  // Seed users: 2 per tenant
  await rawPrisma.user.createMany({
    data: [
      { id: 'ua-1', email: 'a1@test.com', passwordHash: 'h', name: 'UA1', tenantId: TENANT_A },
      { id: 'ua-2', email: 'a2@test.com', passwordHash: 'h', name: 'UA2', tenantId: TENANT_A },
      { id: 'ub-1', email: 'b1@test.com', passwordHash: 'h', name: 'UB1', tenantId: TENANT_B },
      { id: 'ub-2', email: 'b2@test.com', passwordHash: 'h', name: 'UB2', tenantId: TENANT_B },
    ],
  });

  tenantPrisma = buildTenantPrisma(rawPrisma);
  app = buildApp(tenantPrisma, true);
}, 30000);

afterAll(async () => {
  await rawPrisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Integration: cross-tenant isolation via HTTP
// ---------------------------------------------------------------------------

describe('multi-tenancy integration — HTTP', () => {
  it('GET /api/robots as tenantA returns only tenantA robots', async () => {
    const res = await request(app)
      .get('/api/robots')
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.robots).toHaveLength(2);
    expect(res.body.robots.every((r: any) => r.tenantId === TENANT_A)).toBe(true);
  });

  it('GET /api/robots/:id for tenantB robot returns 404', async () => {
    const res = await request(app)
      .get('/api/robots/rb-1')
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(404);
  });

  it('PATCH /api/robots/:id targeting tenantB robot returns 404 and row unchanged', async () => {
    const res = await request(app)
      .patch('/api/robots/rb-1')
      .set('X-Tenant-Id', TENANT_A)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);

    // Verify row unchanged
    const robot = await rawPrisma.robot.findUnique({ where: { id: 'rb-1' } });
    expect(robot!.name).toBe('Bravo-1');
  });

  it('DELETE /api/robots/:id targeting tenantB robot returns 404 and row exists', async () => {
    const res = await request(app)
      .delete('/api/robots/rb-2')
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(404);

    // Verify row still exists
    const robot = await rawPrisma.robot.findUnique({ where: { id: 'rb-2' } });
    expect(robot).not.toBeNull();
  });

  it('POST /api/robots creates robot with tenantA tenantId', async () => {
    const res = await request(app)
      .post('/api/robots')
      .set('X-Tenant-Id', TENANT_A)
      .send({ name: 'NewBot', model: 'SO-101' });

    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(TENANT_A);
  });

  it('GET /api/tenants/current returns tenantA', async () => {
    const res = await request(app)
      .get('/api/tenants/current')
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TENANT_A);
    expect(res.body.slug).toBe('tenant-a');
  });
});

// ---------------------------------------------------------------------------
// Integration: disabled multi-tenancy (no filtering)
// ---------------------------------------------------------------------------

describe('multi-tenancy integration — disabled path', () => {
  let disabledApp: Express;

  beforeAll(() => {
    // Build an app with multi-tenancy disabled — uses raw prisma, no ALS
    disabledApp = buildApp(rawPrisma, false);
  });

  it('GET /api/robots returns ALL robots when multi-tenancy disabled', async () => {
    const res = await request(disabledApp)
      .get('/api/robots')
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    // Should see all robots (at least 4 seeded + 1 from POST test above)
    expect(res.body.robots.length).toBeGreaterThanOrEqual(4);
  });

  it('GET /api/robots/:id returns tenantB robot when multi-tenancy disabled', async () => {
    const res = await request(disabledApp)
      .get('/api/robots/rb-1')
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bravo-1');
  });
});

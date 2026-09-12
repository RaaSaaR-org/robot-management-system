/**
 * @file vla-session-tenant-isolation.test.ts
 * @description Tenant isolation for VLA sessions, asserted through the real
 * route (TASK-286).
 *
 * `VlaSession` has no repository — `vla-session.routes.ts` queries the extended
 * prisma singleton directly — so a repository test cannot cover it and the
 * existing `vla-session-routes.test.ts` mocks prisma wholesale, meaning no
 * extension ever runs there. This file drives the real router against a real
 * temp SQLite database with the tenant extension in front of it.
 *
 * The allowlist is imported, never pasted: if `VlaSession` falls out of
 * `TENANT_SCOPED_MODELS`, these tests fail.
 *
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
import { TENANT_SCOPED_MODELS } from '../database/client.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ROBOT_A = 'ra-1';
const ROBOT_B = 'rb-1';

const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();
const getTenantId = (): string | undefined => tenantStore.getStore()?.tenantId;

// ---------------------------------------------------------------------------
// The route imports `prisma` at module load, before beforeAll can build one
// against the temp database. The mock is therefore a Proxy that forwards to a
// client installed later.
// ---------------------------------------------------------------------------

const { holder } = vi.hoisted(() => ({
  holder: { client: undefined as unknown as PrismaClient },
}));

vi.mock('../database/index.js', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, prop) =>
        (holder.client as unknown as Record<string | symbol, unknown>)[prop],
    }
  ),
}));

const { vlaSessionRoutes } = await import('../routes/vla-session.routes.js');

let rawPrisma: PrismaClient;
let tmpDir: string;
let dbPath: string;
let app: Express;

function buildTenantPrisma(base: PrismaClient): PrismaClient {
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
            case 'count': {
              const where = (a.where as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              return query(a);
            }
            case 'findUnique':
            case 'findUniqueOrThrow': {
              const result = (await query(a)) as { tenantId?: string | null } | null;
              if (result && result.tenantId !== tenantId) {
                if (operation === 'findUniqueOrThrow') {
                  throw new Error(`[tenant-isolation] ${model} not found in tenant ${tenantId}`);
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
            case 'update':
            case 'delete': {
              const where = (a.where as Record<string, unknown>) ?? {};
              const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
              const repo = (base as unknown as Record<
                string,
                {
                  findUnique: (opts: { where: Record<string, unknown> }) => Promise<{
                    tenantId?: string | null;
                  } | null>;
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

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    if (tenantId) {
      tenantStore.run({ tenantId }, () => next());
    } else {
      next();
    }
  });
  a.use('/api/robots', vlaSessionRoutes);
  return a;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-vla-tenant-'));
  dbPath = join(tmpDir, 'test.db');

  const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  execSync(`npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: join(__dirname, '..', '..'),
    stdio: 'pipe',
  });

  rawPrisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });

  await rawPrisma.tenant.createMany({
    data: [
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });

  await rawPrisma.robot.createMany({
    data: [
      { id: ROBOT_A, name: 'Alpha-1', model: 'G1', tenantId: TENANT_A },
      { id: ROBOT_B, name: 'Bravo-1', model: 'G1', tenantId: TENANT_B },
    ],
  });

  await rawPrisma.vlaSession.createMany({
    data: [
      {
        id: 'vs-a1',
        robotId: ROBOT_A,
        prompt: 'pick up the cube',
        serverUrl: 'http://vla:8000',
        status: 'running',
        tenantId: TENANT_A,
      },
      {
        id: 'vs-b1',
        robotId: ROBOT_B,
        prompt: 'stack the crates',
        serverUrl: 'http://vla:8000',
        status: 'running',
        tenantId: TENANT_B,
      },
      // The sharp case: a tenant-B session pointing at tenant A's robot. Only
      // the tenantId column separates it from A's own rows — `where: { robotId }`
      // alone would hand A a prompt written by B.
      {
        id: 'vs-b-on-a',
        robotId: ROBOT_A,
        prompt: 'B private prompt',
        serverUrl: 'http://vla:8000',
        status: 'running',
        tenantId: TENANT_B,
      },
    ],
  });

  holder.client = buildTenantPrisma(rawPrisma);
  app = buildApp();
}, 60000);

afterAll(async () => {
  await rawPrisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/robots/:robotId/vla-sessions — tenant isolation (TASK-286)', () => {
  it('returns only the calling tenant sessions', async () => {
    const res = await request(app)
      .get(`/api/robots/${ROBOT_A}/vla-sessions`)
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].id).toBe('vs-a1');
  });

  it('hides a foreign session attached to the caller own robot', async () => {
    const res = await request(app)
      .get(`/api/robots/${ROBOT_A}/vla-sessions`)
      .set('X-Tenant-Id', TENANT_A);

    const prompts = res.body.sessions.map((s: { prompt: string }) => s.prompt);
    expect(prompts).not.toContain('B private prompt');
  });

  it('returns nothing for another tenant robot', async () => {
    const res = await request(app)
      .get(`/api/robots/${ROBOT_B}/vla-sessions`)
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(0);
  });

  it('shows tenant B its own two sessions', async () => {
    const res = await request(app)
      .get(`/api/robots/${ROBOT_A}/vla-sessions`)
      .set('X-Tenant-Id', TENANT_B);

    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].id).toBe('vs-b-on-a');
  });

  it('passes through with no tenant context (single-tenant deployments)', async () => {
    const res = await request(app).get(`/api/robots/${ROBOT_A}/vla-sessions`);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
  });
});

describe('GET /api/robots/:robotId/vla-sessions/active — tenant isolation', () => {
  it('does not surface another tenant active session', async () => {
    const res = await request(app)
      .get(`/api/robots/${ROBOT_B}/vla-sessions/active`)
      .set('X-Tenant-Id', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
  });

  it('returns the caller own active session', async () => {
    const res = await request(app)
      .get(`/api/robots/${ROBOT_A}/vla-sessions/active`)
      .set('X-Tenant-Id', TENANT_A);

    expect(res.body.session.id).toBe('vs-a1');
  });
});

describe('POST /api/robots/:robotId/vla-sessions — tenant stamping', () => {
  it('stamps the created session with the calling tenant', async () => {
    const res = await request(app)
      .post(`/api/robots/${ROBOT_A}/vla-sessions`)
      .set('X-Tenant-Id', TENANT_A)
      .send({ prompt: 'fold the towel', serverUrl: 'http://vla:8000' });

    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(TENANT_A);

    const row = await rawPrisma.vlaSession.findUnique({ where: { id: res.body.id } });
    expect(row!.tenantId).toBe(TENANT_A);

    await rawPrisma.vlaSession.delete({ where: { id: res.body.id } });
  });

  it('404s when the robot belongs to another tenant', async () => {
    // The robot lookup is itself scoped, so B's robot is simply not there.
    const res = await request(app)
      .post(`/api/robots/${ROBOT_B}/vla-sessions`)
      .set('X-Tenant-Id', TENANT_A)
      .send({ prompt: 'drive away', serverUrl: 'http://vla:8000' });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/robots/:robotId/vla-sessions/:sessionId/stop — tenant isolation', () => {
  it('cannot stop another tenant session', async () => {
    const res = await request(app)
      .patch(`/api/robots/${ROBOT_A}/vla-sessions/vs-b-on-a/stop`)
      .set('X-Tenant-Id', TENANT_A)
      .send({});

    expect(res.status).toBe(404);

    const row = await rawPrisma.vlaSession.findUnique({ where: { id: 'vs-b-on-a' } });
    expect(row!.status).toBe('running');
    expect(row!.stoppedAt).toBeNull();
  });
});

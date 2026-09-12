/**
 * @file client.test.ts
 * @description Unit tests for the tenant-isolation Prisma extension.
 * Tests verify per-operation behaviour for tenant-scoped models
 * (User, Robot, Dataset, TrainingJob, and one block per later wave) and
 * passthrough for non-scoped models.
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
// The production allowlist — imported, never pasted (TASK-285): a model that
// drifts out of it must be able to fail a test.
import { TENANT_SCOPED_MODELS } from '../client.js';

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
  // TASK-286 (sensorScan/vlaSession cascade with their robot, but be explicit
  // — they must go before the robot delete below either way)
  await raw.sensorScan.deleteMany();
  await raw.vlaSession.deleteMany();
  await raw.motionClip.deleteMany();
  // TASK-285 (scanSession is cascade-deleted with its twin, but be explicit)
  await raw.simScene.deleteMany();
  await raw.scanSession.deleteMany();
  await raw.digitalTwin.deleteMany();
  // Wave 3e
  await raw.apiToken.deleteMany();
  // Wave 3d
  await raw.conversation.deleteMany();
  await raw.zone.deleteMany();
  // Wave 3c
  await raw.deployment.deleteMany();
  await raw.modelVersion.deleteMany();
  await raw.simulationJob.deleteMany();
  await raw.syntheticJob.deleteMany();
  // Wave 3b
  await raw.approvalRequest.deleteMany();
  await raw.processInstance.deleteMany();
  await raw.processDefinition.deleteMany();
  await raw.event.deleteMany();
  // Wave 3a
  await raw.robotCommand.deleteMany();
  await raw.robotTask.deleteMany();
  await raw.incident.deleteMany();
  await raw.alert.deleteMany();
  // Wave 1
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
// Wave 3a model tests (Alert, Incident, RobotTask, RobotCommand)
// ---------------------------------------------------------------------------

async function seedAlertRaw(
  id: string,
  title: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await raw.alert.create({
    data: { id, title, severity: 'warning', source: 'system', message: 'test', tenantId },
  });
  await raw.$disconnect();
}

async function seedIncidentRaw(
  id: string,
  title: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await raw.incident.create({
    data: {
      id,
      incidentNumber: `INC-${id}`,
      type: 'safety',
      severity: 'medium',
      title,
      description: 'test incident',
      detectedAt: new Date(),
      tenantId,
    },
  });
  await raw.$disconnect();
}

async function seedRobotTaskRaw(
  id: string,
  instruction: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  await raw.robotTask.create({
    data: { id, instruction, actionType: 'navigate', tenantId },
  });
  await raw.$disconnect();
}

async function seedRobotCommandRaw(
  id: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    log: [],
  });
  // RobotCommand requires a robot FK — seed a robot first
  await raw.robot.upsert({
    where: { id: `robot-for-${tenantId}` },
    create: { id: `robot-for-${tenantId}`, name: 'CmdBot', model: 'X', tenantId },
    update: {},
  });
  await raw.robotCommand.create({
    data: { id, robotId: `robot-for-${tenantId}`, type: 'stop', tenantId },
  });
  await raw.$disconnect();
}

describe('tenant-isolation extension — Alert (Wave 3a)', () => {
  it('scopes findMany by tenant', async () => {
    await seedAlertRaw('al-a1', 'Alert A', TENANT_A);
    await seedAlertRaw('al-b1', 'Alert B', TENANT_B);

    const alerts = await prisma.alert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('al-a1');
  });

  it('stamps tenantId on create', async () => {
    const alert = await prisma.alert.create({
      data: { title: 'New', severity: 'info', source: 'system', message: 'hi' },
    });
    expect(alert.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedAlertRaw('al-b1', 'Alert B', TENANT_B);
    const found = await prisma.alert.findUnique({ where: { id: 'al-b1' } });
    expect(found).toBeNull();
  });
});

describe('tenant-isolation extension — Incident (Wave 3a)', () => {
  it('scopes findMany by tenant', async () => {
    await seedIncidentRaw('inc-a1', 'Inc A', TENANT_A);
    await seedIncidentRaw('inc-b1', 'Inc B', TENANT_B);

    const incidents = await prisma.incident.findMany();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].id).toBe('inc-a1');
  });

  it('stamps tenantId on create', async () => {
    const incident = await prisma.incident.create({
      data: {
        incidentNumber: 'INC-NEW-1',
        type: 'security',
        severity: 'low',
        title: 'New',
        description: 'test',
        detectedAt: new Date(),
      },
    });
    expect(incident.tenantId).toBe(TENANT_A);
  });
});

describe('tenant-isolation extension — RobotTask (Wave 3a)', () => {
  it('scopes findMany by tenant', async () => {
    await seedRobotTaskRaw('rt-a1', 'Task A', TENANT_A);
    await seedRobotTaskRaw('rt-b1', 'Task B', TENANT_B);

    const tasks = await prisma.robotTask.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('rt-a1');
  });

  it('stamps tenantId on create', async () => {
    const task = await prisma.robotTask.create({
      data: { instruction: 'Go', actionType: 'navigate' },
    });
    expect(task.tenantId).toBe(TENANT_A);
  });
});

describe('tenant-isolation extension — RobotCommand (Wave 3a)', () => {
  it('scopes findMany by tenant', async () => {
    await seedRobotCommandRaw('rc-a1', TENANT_A);
    await seedRobotCommandRaw('rc-b1', TENANT_B);

    const commands = await prisma.robotCommand.findMany();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('rc-a1');
  });

  it('stamps tenantId on create', async () => {
    // Need a robot in tenant A for the FK
    const raw = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
      log: [],
    });
    await raw.robot.upsert({
      where: { id: 'robot-cmd-test' },
      create: { id: 'robot-cmd-test', name: 'CmdBot', model: 'X', tenantId: TENANT_A },
      update: {},
    });
    await raw.$disconnect();

    const cmd = await prisma.robotCommand.create({
      data: { robotId: 'robot-cmd-test', type: 'stop' },
    });
    expect(cmd.tenantId).toBe(TENANT_A);
  });
});

// ---------------------------------------------------------------------------
// Wave 3b model tests (ProcessDefinition, ProcessInstance, ApprovalRequest, Event)
// ---------------------------------------------------------------------------

async function seedProcessDefRaw(id: string, name: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.processDefinition.create({ data: { id, name, createdBy: 'test', tenantId } });
  await raw.$disconnect();
}

async function seedEventRaw(id: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.event.create({ data: { id, actor: 'system', content: '{}', tenantId } });
  await raw.$disconnect();
}

async function seedApprovalRequestRaw(id: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.approvalRequest.create({
    data: {
      id,
      requestNumber: `APR-${id}`,
      entityType: 'software_update',
      entityId: 'e1',
      approvalType: 'single_approval',
      status: 'pending',
      slaHours: 24,
      slaDeadline: new Date(Date.now() + 86400000),
      requestedBy: 'test',
      requestReason: 'test',
      tenantId,
    },
  });
  await raw.$disconnect();
}

describe('tenant-isolation extension — ProcessDefinition (Wave 3b)', () => {
  it('scopes findMany by tenant', async () => {
    await seedProcessDefRaw('pd-a1', 'Proc A', TENANT_A);
    await seedProcessDefRaw('pd-b1', 'Proc B', TENANT_B);
    const results = await prisma.processDefinition.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('pd-a1');
  });

  it('stamps tenantId on create', async () => {
    const pd = await prisma.processDefinition.create({ data: { name: 'New', createdBy: 'test' } });
    expect(pd.tenantId).toBe(TENANT_A);
  });
});

describe('tenant-isolation extension — ApprovalRequest (Wave 3b)', () => {
  it('scopes findMany by tenant', async () => {
    await seedApprovalRequestRaw('ar-a1', TENANT_A);
    await seedApprovalRequestRaw('ar-b1', TENANT_B);
    const results = await prisma.approvalRequest.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('ar-a1');
  });

  it('stamps tenantId on create', async () => {
    const ar = await prisma.approvalRequest.create({
      data: {
        requestNumber: 'APR-NEW-1',
        entityType: 'software_update',
        entityId: 'e1',
        approvalType: 'single_approval',
        slaHours: 24,
        slaDeadline: new Date(Date.now() + 86400000),
        requestedBy: 'test',
        requestReason: 'test',
      },
    });
    expect(ar.tenantId).toBe(TENANT_A);
  });
});

describe('tenant-isolation extension — Event (Wave 3b)', () => {
  it('scopes findMany by tenant', async () => {
    await seedEventRaw('ev-a1', TENANT_A);
    await seedEventRaw('ev-b1', TENANT_B);
    const results = await prisma.event.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('ev-a1');
  });

  it('stamps tenantId on create', async () => {
    const ev = await prisma.event.create({ data: { actor: 'system', content: '{}' } });
    expect(ev.tenantId).toBe(TENANT_A);
  });
});

// ---------------------------------------------------------------------------
// Wave 3c model tests (ModelVersion, Deployment, SimulationJob, SyntheticJob)
// ---------------------------------------------------------------------------

async function seedSimulationJobRaw(id: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.simulationJob.create({
    data: { id, modelId: 'm1', environment: 'test', backend: 'mujoco', rolloutCount: 10, status: 'queued', tenantId },
  });
  await raw.$disconnect();
}

async function seedSyntheticJobRaw(id: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.syntheticJob.create({
    data: { id, task: 'pick', embodiment: 'so101', trajectoryCount: 100, config: {}, tenantId },
  });
  await raw.$disconnect();
}

describe('tenant-isolation extension — SimulationJob (Wave 3c)', () => {
  it('scopes findMany by tenant', async () => {
    await seedSimulationJobRaw('sj-a1', TENANT_A);
    await seedSimulationJobRaw('sj-b1', TENANT_B);
    const results = await prisma.simulationJob.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('sj-a1');
  });

  it('stamps tenantId on create', async () => {
    const sj = await prisma.simulationJob.create({
      data: { modelId: 'm1', environment: 'test', backend: 'mujoco', rolloutCount: 5, status: 'queued' },
    });
    expect(sj.tenantId).toBe(TENANT_A);
  });
});

describe('tenant-isolation extension — SyntheticJob (Wave 3c)', () => {
  it('scopes findMany by tenant', async () => {
    await seedSyntheticJobRaw('syj-a1', TENANT_A);
    await seedSyntheticJobRaw('syj-b1', TENANT_B);
    const results = await prisma.syntheticJob.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('syj-a1');
  });

  it('stamps tenantId on create', async () => {
    const sj = await prisma.syntheticJob.create({
      data: { task: 'pick', embodiment: 'so101', trajectoryCount: 50, config: {} },
    });
    expect(sj.tenantId).toBe(TENANT_A);
  });
});

// ---------------------------------------------------------------------------
// Wave 3d model tests (Zone, Conversation)
// ---------------------------------------------------------------------------

async function seedZoneRaw(id: string, name: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.zone.create({
    data: { id, name, floor: '1', type: 'operational', bounds: '{}', tenantId },
  });
  await raw.$disconnect();
}

async function seedConversationRaw(id: string, name: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.conversation.create({ data: { id, name, tenantId } });
  await raw.$disconnect();
}

describe('tenant-isolation extension — Zone (Wave 3d)', () => {
  it('scopes findMany by tenant', async () => {
    await seedZoneRaw('z-a1', 'Zone A', TENANT_A);
    await seedZoneRaw('z-b1', 'Zone B', TENANT_B);
    const results = await prisma.zone.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('z-a1');
  });

  it('stamps tenantId on create', async () => {
    const z = await prisma.zone.create({ data: { name: 'New Zone', floor: '2', type: 'charging', bounds: '{}' } });
    expect(z.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedZoneRaw('z-b1', 'Zone B', TENANT_B);
    const found = await prisma.zone.findUnique({ where: { id: 'z-b1' } });
    expect(found).toBeNull();
  });
});

describe('tenant-isolation extension — Conversation (Wave 3d)', () => {
  it('scopes findMany by tenant', async () => {
    await seedConversationRaw('c-a1', 'Chat A', TENANT_A);
    await seedConversationRaw('c-b1', 'Chat B', TENANT_B);
    const results = await prisma.conversation.findMany();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c-a1');
  });

  it('stamps tenantId on create', async () => {
    const c = await prisma.conversation.create({ data: { name: 'New Chat' } });
    expect(c.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedConversationRaw('c-b1', 'Chat B', TENANT_B);
    const found = await prisma.conversation.findUnique({ where: { id: 'c-b1' } });
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TASK-285 model tests (DigitalTwin, ScanSession, SimScene)
// ---------------------------------------------------------------------------

async function seedDigitalTwinRaw(id: string, name: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.digitalTwin.create({ data: { id, name, tenantId } });
  await raw.$disconnect();
}

async function seedScanSessionRaw(
  id: string,
  twinId: string,
  status: string,
  tenantId: string
): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.scanSession.create({
    data: { id, twinId, robotId: `robot-${tenantId}`, status, tenantId },
  });
  await raw.$disconnect();
}

async function seedSimSceneRaw(
  id: string,
  builtinEnvId: string,
  name: string,
  tenantId: string | null
): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.simScene.create({
    data: { id, name, source: 'builtin', builtinEnvId, tenantId },
  });
  await raw.$disconnect();
}

describe('tenant-isolation extension — DigitalTwin (TASK-285)', () => {
  it('scopes findMany by tenant', async () => {
    await seedDigitalTwinRaw('dt-a1', 'Warehouse A', TENANT_A);
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);

    const twins = await prisma.digitalTwin.findMany();
    expect(twins).toHaveLength(1);
    expect(twins[0].id).toBe('dt-a1');
  });

  it('stamps tenantId on create', async () => {
    const twin = await prisma.digitalTwin.create({ data: { name: 'New Twin' } });
    expect(twin.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);
    const found = await prisma.digitalTwin.findUnique({ where: { id: 'dt-b1' } });
    expect(found).toBeNull();
  });

  it('denies a cross-tenant update and leaves the row untouched', async () => {
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);

    await expect(
      prisma.digitalTwin.update({ where: { id: 'dt-b1' }, data: { name: 'Hacked' } })
    ).rejects.toThrow('[tenant-isolation]');

    currentTenantId = undefined;
    const row = await prisma.digitalTwin.findUnique({ where: { id: 'dt-b1' } });
    expect(row!.name).toBe('Warehouse B');
  });

  it('denies a cross-tenant delete', async () => {
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);

    await expect(
      prisma.digitalTwin.delete({ where: { id: 'dt-b1' } })
    ).rejects.toThrow('[tenant-isolation]');
  });
});

describe('tenant-isolation extension — ScanSession (TASK-285)', () => {
  it('scopes findMany by tenant', async () => {
    await seedDigitalTwinRaw('dt-a1', 'Warehouse A', TENANT_A);
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);
    await seedScanSessionRaw('ss-a1', 'dt-a1', 'recording', TENANT_A);
    await seedScanSessionRaw('ss-b1', 'dt-b1', 'recording', TENANT_B);

    const sessions = await prisma.scanSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('ss-a1');
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);
    await seedScanSessionRaw('ss-b1', 'dt-b1', 'recording', TENANT_B);

    const found = await prisma.scanSession.findUnique({ where: { id: 'ss-b1' } });
    expect(found).toBeNull();
  });

  it('updateMany returns count 0 for a foreign session (completeIfProcessing shape)', async () => {
    await seedDigitalTwinRaw('dt-b1', 'Warehouse B', TENANT_B);
    await seedScanSessionRaw('ss-b1', 'dt-b1', 'processing', TENANT_B);

    const result = await prisma.scanSession.updateMany({
      where: { id: 'ss-b1', status: 'processing' },
      data: { status: 'complete' },
    });
    expect(result.count).toBe(0);

    currentTenantId = undefined;
    const row = await prisma.scanSession.findUnique({ where: { id: 'ss-b1' } });
    expect(row!.status).toBe('processing');
  });

  it('updateMany still updates the caller tenant own session', async () => {
    await seedDigitalTwinRaw('dt-a1', 'Warehouse A', TENANT_A);
    await seedScanSessionRaw('ss-a1', 'dt-a1', 'processing', TENANT_A);

    const result = await prisma.scanSession.updateMany({
      where: { id: 'ss-a1', status: 'processing' },
      data: { status: 'complete' },
    });
    expect(result.count).toBe(1);
  });
});

describe('tenant-isolation extension — SimScene (TASK-285)', () => {
  it('scopes findMany by tenant', async () => {
    await seedSimSceneRaw('sc-a1', 'env_a', 'Scene A', TENANT_A);
    await seedSimSceneRaw('sc-b1', 'env_b', 'Scene B', TENANT_B);

    const scenes = await prisma.simScene.findMany();
    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe('sc-a1');
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedSimSceneRaw('sc-b1', 'env_b', 'Scene B', TENANT_B);
    const found = await prisma.simScene.findUnique({ where: { id: 'sc-b1' } });
    expect(found).toBeNull();
  });

  it('upsert over a row stamped with the caller tenant updates it in place', async () => {
    await seedSimSceneRaw('sc-a1', 'so101_tabletop', 'Tabletop', TENANT_A);

    await prisma.simScene.upsert({
      where: { builtinEnvId: 'so101_tabletop' },
      update: { name: 'Tabletop v2' },
      create: { name: 'Tabletop', source: 'builtin', builtinEnvId: 'so101_tabletop' },
    });

    currentTenantId = undefined;
    const rows = await prisma.simScene.findMany({
      where: { builtinEnvId: 'so101_tabletop' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Tabletop v2');
  });

  it('upsert over a NULL-tenant built-in row hits P2002 — why the seed stamps tenantId', async () => {
    // The regression this task closes: `seedBuiltinScenes()` runs outside a
    // request scope, so nothing stamps the row. A later in-request upsert
    // carries `where.tenantId`, misses the null row, falls through to CREATE
    // and violates the unique builtinEnvId. SimulationService now passes
    // DEFAULT_TENANT_ID at seed time so this state cannot arise.
    await seedSimSceneRaw('sc-null', 'so101_tabletop', 'Tabletop', null);

    await expect(
      prisma.simScene.upsert({
        where: { builtinEnvId: 'so101_tabletop' },
        update: { name: 'Tabletop v2' },
        create: { name: 'Tabletop', source: 'builtin', builtinEnvId: 'so101_tabletop' },
      })
    ).rejects.toThrow();

    currentTenantId = undefined;
    const rows = await prisma.simScene.findMany({
      where: { builtinEnvId: 'so101_tabletop' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Tabletop');
  });
});

// ---------------------------------------------------------------------------
// TASK-286 model tests (SensorScan, MotionClip, VlaSession)
//
// These three had no `tenantId` column at all before TASK-286, so no allowlist
// entry could scope them. The column exists now; these cases prove the
// extension actually acts on it for each of the three.
// ---------------------------------------------------------------------------

async function seedSensorScanRaw(id: string, robotId: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.sensorScan.create({
    data: {
      id,
      robotId,
      sensorName: 'lidar-front',
      sensorType: 'lidar',
      pointCount: 1000,
      fileSize: 4096,
      storageKey: `scans/${id}.pcd`,
      tenantId,
    },
  });
  await raw.$disconnect();
}

async function seedMotionClipRaw(id: string, name: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.motionClip.create({
    data: { id, name, fps: 30, frameCount: 2, durationSec: 0.066, frames: '[]', tenantId },
  });
  await raw.$disconnect();
}

async function seedVlaSessionRaw(id: string, robotId: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.vlaSession.create({
    data: { id, robotId, prompt: `prompt-${id}`, serverUrl: 'http://vla:8000', tenantId },
  });
  await raw.$disconnect();
}

describe('tenant-isolation extension — SensorScan (TASK-286)', () => {
  it('scopes findMany by tenant', async () => {
    await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);
    await seedSensorScanRaw('sc-a1', 'r-a1', TENANT_A);
    await seedSensorScanRaw('sc-b1', 'r-b1', TENANT_B);

    const scans = await prisma.sensorScan.findMany();
    expect(scans).toHaveLength(1);
    expect(scans[0].id).toBe('sc-a1');
  });

  it('stamps tenantId on create', async () => {
    await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
    const scan = await prisma.sensorScan.create({
      data: {
        robotId: 'r-a1',
        sensorName: 'lidar-front',
        sensorType: 'lidar',
        pointCount: 10,
        fileSize: 64,
        storageKey: 'scans/new.pcd',
      },
    });
    expect(scan.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);
    await seedSensorScanRaw('sc-b1', 'r-b1', TENANT_B);

    const found = await prisma.sensorScan.findUnique({ where: { id: 'sc-b1' } });
    expect(found).toBeNull();
  });

  it('denies a cross-tenant delete and leaves the row in place', async () => {
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);
    await seedSensorScanRaw('sc-b1', 'r-b1', TENANT_B);

    await expect(
      prisma.sensorScan.delete({ where: { id: 'sc-b1' } })
    ).rejects.toThrow('[tenant-isolation]');

    currentTenantId = undefined;
    const row = await prisma.sensorScan.findUnique({ where: { id: 'sc-b1' } });
    expect(row).not.toBeNull();
  });
});

describe('tenant-isolation extension — MotionClip (TASK-286)', () => {
  it('scopes findMany by tenant', async () => {
    await seedMotionClipRaw('mc-a1', 'Wave A', TENANT_A);
    await seedMotionClipRaw('mc-b1', 'Wave B', TENANT_B);

    const clips = await prisma.motionClip.findMany();
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe('mc-a1');
  });

  it('stamps tenantId on create', async () => {
    const clip = await prisma.motionClip.create({
      data: { name: 'New Clip', fps: 30, frameCount: 1, durationSec: 0.033, frames: '[]' },
    });
    expect(clip.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedMotionClipRaw('mc-b1', 'Wave B', TENANT_B);
    const found = await prisma.motionClip.findUnique({ where: { id: 'mc-b1' } });
    expect(found).toBeNull();
  });

  it('denies a cross-tenant update and leaves the row untouched', async () => {
    await seedMotionClipRaw('mc-b1', 'Wave B', TENANT_B);

    await expect(
      prisma.motionClip.update({ where: { id: 'mc-b1' }, data: { name: 'Hacked' } })
    ).rejects.toThrow('[tenant-isolation]');

    currentTenantId = undefined;
    const row = await prisma.motionClip.findUnique({ where: { id: 'mc-b1' } });
    expect(row!.name).toBe('Wave B');
  });
});

describe('tenant-isolation extension — VlaSession (TASK-286)', () => {
  it('scopes findMany by tenant', async () => {
    await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);
    await seedVlaSessionRaw('vs-a1', 'r-a1', TENANT_A);
    await seedVlaSessionRaw('vs-b1', 'r-b1', TENANT_B);

    const sessions = await prisma.vlaSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('vs-a1');
  });

  it('scopes findFirst even when the robot belongs to the caller', async () => {
    // The prompt is the operator's own words: a foreign session hanging off the
    // caller's robot must not come back from a `where: { robotId }` lookup.
    await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
    await seedVlaSessionRaw('vs-b-on-a', 'r-a1', TENANT_B);

    const found = await prisma.vlaSession.findFirst({ where: { robotId: 'r-a1' } });
    expect(found).toBeNull();
  });

  it('stamps tenantId on create', async () => {
    await seedRobotRaw('r-a1', 'Alpha', TENANT_A);
    const session = await prisma.vlaSession.create({
      data: { robotId: 'r-a1', prompt: 'pick up the cube', serverUrl: 'http://vla:8000' },
    });
    expect(session.tenantId).toBe(TENANT_A);
  });

  it('blocks cross-tenant findUnique', async () => {
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);
    await seedVlaSessionRaw('vs-b1', 'r-b1', TENANT_B);

    const found = await prisma.vlaSession.findUnique({ where: { id: 'vs-b1' } });
    expect(found).toBeNull();
  });

  it('denies a cross-tenant update and leaves the row untouched', async () => {
    await seedRobotRaw('r-b1', 'Bravo', TENANT_B);
    await seedVlaSessionRaw('vs-b1', 'r-b1', TENANT_B);

    await expect(
      prisma.vlaSession.update({ where: { id: 'vs-b1' }, data: { status: 'stopped' } })
    ).rejects.toThrow('[tenant-isolation]');

    currentTenantId = undefined;
    const row = await prisma.vlaSession.findUnique({ where: { id: 'vs-b1' } });
    expect(row!.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// Wave 3e model tests (ApiToken)
// ---------------------------------------------------------------------------

async function seedUserRawForToken(id: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.user.upsert({
    where: { id },
    create: { id, email: `${id}@test.com`, name: id, passwordHash: 'x', tenantId },
    update: {},
  });
  await raw.$disconnect();
}

async function seedApiTokenRaw(id: string, userId: string, tenantId: string): Promise<void> {
  const raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.apiToken.create({
    data: { id, userId, name: `token-${id}`, prefix: id.slice(0, 12).padEnd(12, '0'), hash: 'h'.repeat(64), createdById: userId, tenantId },
  });
  await raw.$disconnect();
}

describe('tenant-isolation extension — ApiToken (Wave 3e)', () => {
  it('scopes findMany by tenant', async () => {
    await seedUserRawForToken('u-tok-a', TENANT_A);
    await seedUserRawForToken('u-tok-b', TENANT_B);
    await seedApiTokenRaw('tok-a1', 'u-tok-a', TENANT_A);
    await seedApiTokenRaw('tok-b1', 'u-tok-b', TENANT_B);

    const tokens = await prisma.apiToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].id).toBe('tok-a1');
  });

  it('stamps tenantId on create', async () => {
    await seedUserRawForToken('u-tok-a', TENANT_A);
    const token = await prisma.apiToken.create({
      data: { userId: 'u-tok-a', name: 'new-token', prefix: 'ndsa_newtest0', hash: 'a'.repeat(64), createdById: 'u-tok-a' },
    });
    expect(token.tenantId).toBe(TENANT_A);
  });

  it('auth lookup works without tenant context (passthrough)', async () => {
    await seedUserRawForToken('u-tok-a', TENANT_A);
    await seedUserRawForToken('u-tok-b', TENANT_B);
    await seedApiTokenRaw('tok-a1', 'u-tok-a', TENANT_A);
    await seedApiTokenRaw('tok-b1', 'u-tok-b', TENANT_B);

    // Simulate auth middleware: no tenant context set
    currentTenantId = undefined;
    const allTokens = await prisma.apiToken.findMany({ where: { prefix: 'tok-b1000000' } });
    // Should find the token regardless of tenant (passthrough when no context)
    expect(allTokens).toHaveLength(1);
    expect(allTokens[0].id).toBe('tok-b1');
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

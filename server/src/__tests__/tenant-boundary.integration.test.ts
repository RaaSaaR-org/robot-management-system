/**
 * @file tenant-boundary.integration.test.ts
 * @description Two tenant-boundary holes found on the auth-on k3d stack (TASK-365):
 * onboarding wrote the new owner into the CALLER's tenant, and the robot
 * cache answered any tenant that knew a robot id.
 * @feature multi-tenancy
 *
 * Both are invisible to a mocked prisma — the first is the isolation extension
 * overwriting an explicit `tenantId`, the second a process-wide map that never
 * asks the database. So, like `tenant-numbering.integration.test.ts`, this
 * pushes the real schema to a temp SQLite file and drives the real client
 * singleton (extension included) through the real `tenantStore`.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Read at module load, so it must be true before client.ts is imported.
vi.mock('../config/features.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/features.js')>()),
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let tmpDir: string;
let previousDatabaseUrl: string | undefined;
let raw: PrismaClient;
let tenantStore: (typeof import('../middleware/tenantContext.js'))['tenantStore'];
let tenantService: (typeof import('../services/TenantService.js'))['tenantService'];
let RobotManager: (typeof import('../services/RobotManager.js'))['RobotManager'];

function asTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  return tenantStore.run({ tenantId }, async () => fn());
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-tenant-boundary-'));
  const dbPath = join(tmpDir, 'test.db');
  const projectRoot = join(__dirname, '..', '..');
  execSync(
    `npx prisma db push --schema=${join(projectRoot, 'prisma', 'schema.prisma')} --skip-generate --accept-data-loss`,
    { env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, cwd: projectRoot, stdio: 'pipe' }
  );

  // The singleton reads DATABASE_URL at construction; drop any instance another
  // test file in this worker built against its own database.
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  delete (globalThis as { prisma?: unknown }).prisma;

  ({ tenantStore } = await import('../middleware/tenantContext.js'));
  ({ tenantService } = await import('../services/TenantService.js'));
  ({ RobotManager } = await import('../services/RobotManager.js'));

  raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.tenant.createMany({
    data: [
      { id: 'default', slug: 'default', name: 'Default Organization' },
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });
}, 120000);

afterAll(async () => {
  await raw.$disconnect();
  const { prisma } = await import('../database/client.js');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  rmSync(tmpDir, { recursive: true, force: true });
});

/** A registered robot row, written straight into a tenant. */
async function seedRegisteredRobot(id: string, tenantId: string): Promise<void> {
  await raw.robot.create({
    data: {
      id,
      name: `Robot ${id}`,
      model: 'Unitree G1',
      tenantId,
      registeredAt: new Date(),
      isConnected: true,
      baseUrl: `http://${id}.invalid:41243`,
      location: JSON.stringify({ x: 0, y: 0 }),
    },
  });
  await raw.robotEndpoints.create({
    data: {
      robotId: id,
      robot: `http://${id}.invalid:41243/api/v1/robot`,
      command: `http://${id}.invalid:41243/api/v1/robot/command`,
      telemetry: `http://${id}.invalid:41243/api/v1/robot/telemetry`,
      telemetryWs: `ws://${id}.invalid:41243/ws/telemetry`,
    },
  });
  await raw.agentCard.create({
    data: { name: `agent-${id}`, description: 'test agent', url: `http://${id}.invalid:41243`, robotId: id },
  });
}

describe('onboarding (POST /api/tenants/onboard)', () => {
  it('puts the first owner in the NEW tenant, not the super-admin caller\'s', async () => {
    // A super-admin's request runs in DEFAULT (or an impersonated tenant) —
    // exactly where the extension used to stamp the new owner.
    const result = await asTenant('default', () =>
      tenantService.onboard({
        tenant: { name: 'Acme Robotics', slug: 'acme-robotics' },
        adminUser: { email: 'Owner@Acme.test', name: 'Acme Owner', password: 'AcmeTemp2026' },
      })
    );

    const owner = await raw.user.findUniqueOrThrow({ where: { email: 'owner@acme.test' } });
    expect(owner.tenantId).toBe(result.tenant.id);
    expect(owner.role).toBe('owner');
    expect(owner.forcePasswordChange).toBe(true);
    expect(result.tenant.counts.users).toBe(1);
  });

  it('clones DEFAULT\'s robot templates into the new tenant', async () => {
    await raw.robot.create({ data: { id: 'tmpl-1', name: 'Template G1', model: 'Unitree G1', tenantId: 'default' } });

    const result = await asTenant(TENANT_A, () =>
      tenantService.onboard({
        tenant: { name: 'Beta Labs', slug: 'beta-labs' },
        adminUser: { email: 'owner@beta.test', name: 'Beta Owner', password: 'BetaTemp2026' },
        starterResources: { cloneRobots: true },
      })
    );

    const cloned = await raw.robot.findMany({ where: { name: 'Template G1' } });
    expect(cloned.map((r) => r.tenantId).sort()).toEqual(['default', result.tenant.id].sort());
    // Nothing leaked into the impersonated tenant the call ran in.
    expect(await raw.robot.count({ where: { tenantId: TENANT_A, name: 'Template G1' } })).toBe(0);
  });
});

describe('robot cache', () => {
  let manager: InstanceType<typeof RobotManager>;

  beforeEach(async () => {
    await raw.agentCard.deleteMany();
    await raw.robotEndpoints.deleteMany();
    await raw.robot.deleteMany({ where: { id: { in: ['robot-a', 'robot-b'] } } });
    await seedRegisteredRobot('robot-a', TENANT_A);
    await seedRegisteredRobot('robot-b', TENANT_B);
    manager = new RobotManager();
    // Startup runs outside any request, so the cache holds every tenant's robots.
    await manager.initialize();
  });

  it('serves a robot only to its own tenant', async () => {
    expect((await asTenant(TENANT_A, () => manager.getRobot('robot-a')))?.id).toBe('robot-a');
    expect(await asTenant(TENANT_B, () => manager.getRobot('robot-a'))).toBeUndefined();
    expect(await asTenant(TENANT_B, () => manager.getRegisteredRobot('robot-a'))).toBeUndefined();
  });

  it('refuses a command or a telemetry read for another tenant\'s robot before dialling it', async () => {
    await expect(
      asTenant(TENANT_B, () => manager.sendCommand('robot-a', { type: 'stop' } as never))
    ).rejects.toThrow(/not found/);
    await expect(asTenant(TENANT_B, () => manager.getTelemetry('robot-a'))).rejects.toThrow(/not found/);
  });

  it('does not let another tenant unregister a robot, nor drop its live entry', async () => {
    expect(await asTenant(TENANT_B, () => manager.unregisterRobot('robot-a'))).toBe(false);
    expect(await raw.robot.count({ where: { id: 'robot-a' } })).toBe(1);
    const live = await asTenant(TENANT_A, () => manager.getRegisteredRobot('robot-a'));
    expect(live?.isConnected).toBe(true);
  });

  it('lets the owning tenant unregister its robot', async () => {
    expect(await asTenant(TENANT_A, () => manager.unregisterRobot('robot-a'))).toBe(true);
    expect(await raw.robot.count({ where: { id: 'robot-a' } })).toBe(0);
  });

  it('lists only the request tenant\'s connected agents', async () => {
    const names = await asTenant(TENANT_A, () => manager.getConnectedAgents().map((c) => c.name));
    expect(names).toEqual(['agent-robot-a']);
  });
});

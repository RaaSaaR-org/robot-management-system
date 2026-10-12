/**
 * @file tenant-compliance-skills.integration.test.ts
 * @description Two-tenant integration test for TASK-384: compliance logs and
 * skills are kept per tenant.
 * @feature multi-tenancy
 *
 * Same harness as tenant-numbering.integration.test.ts: the real schema pushed
 * to a temp SQLite database, the REAL client singleton (isolation extension
 * included) bound to it, and the real repositories driven through the real
 * `tenantStore`. Only the feature flag is mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ROBOT_A = 'robot-a';
const ROBOT_B = 'robot-b';

type TenantContextModule = typeof import('../../middleware/tenantContext.js');
type ComplianceRepoModule = typeof import('../../repositories/ComplianceLogRepository.js');
type VlaRepoModule = typeof import('../../repositories/VLARepository.js');

let tmpDir: string;
let previousDatabaseUrl: string | undefined;
let raw: PrismaClient;
let tenantStore: TenantContextModule['tenantStore'];
let runAsPlatform: TenantContextModule['runAsPlatform'];
let complianceLogRepository: ComplianceRepoModule['complianceLogRepository'];
let skillDefinitionRepository: VlaRepoModule['skillDefinitionRepository'];
let skillChainRepository: VlaRepoModule['skillChainRepository'];
let logExportService: (typeof import('../../services/LogExportService.js'))['logExportService'];
let backfillComplianceLogTenants: (typeof import('../seedTenant.js'))['backfillComplianceLogTenants'];

function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ tenantId }, fn);
}

function asPlatform<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.resolve(runAsPlatform(fn));
}

function writeLog(robotId: string, extra: { operatorId?: string; tenantId?: string | null } = {}) {
  return complianceLogRepository.create({
    sessionId: 'session-1',
    robotId,
    eventType: 'access_audit',
    payload: { description: `audit for ${robotId}` } as never,
    ...extra,
  });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-tenant-384-'));
  const dbPath = join(tmpDir, 'test.db');
  const projectRoot = join(__dirname, '..', '..', '..');
  execSync(
    `npx prisma db push --schema=${join(projectRoot, 'prisma', 'schema.prisma')} --skip-generate --accept-data-loss`,
    { env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, cwd: projectRoot, stdio: 'pipe' }
  );

  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  delete (globalThis as { prisma?: unknown }).prisma;

  ({ tenantStore, runAsPlatform } = await import('../../middleware/tenantContext.js'));
  ({ complianceLogRepository } = await import('../../repositories/ComplianceLogRepository.js'));
  ({ skillDefinitionRepository, skillChainRepository } = await import(
    '../../repositories/VLARepository.js'
  ));
  ({ logExportService } = await import('../../services/LogExportService.js'));
  ({ backfillComplianceLogTenants } = await import('../seedTenant.js'));

  raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.tenant.createMany({
    data: [
      { id: TENANT_A, slug: 'tenant-a', name: 'Tenant A' },
      { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });
  await raw.robot.createMany({
    data: [
      { id: ROBOT_A, name: 'A1', model: 'g1', serialNumber: 'SN-A', tenantId: TENANT_A },
      { id: ROBOT_B, name: 'B1', model: 'g1', serialNumber: 'SN-B', tenantId: TENANT_B },
    ],
  });
}, 120000);

afterAll(async () => {
  await raw.$disconnect();
  const { prisma } = await import('../client.js');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('compliance logs are kept per tenant (TASK-384)', () => {
  let logA: string;
  let logAByRobot: string;
  let logB: string;
  let platformLog: string;

  beforeAll(async () => {
    // In tenant A's request scope: stamped from the context.
    logA = (await asTenant(TENANT_A, () => writeLog('server'))).id;
    // Outside any request (a service or job): stamped from the robot's tenant.
    logAByRobot = (await writeLog(ROBOT_A)).id;
    logB = (await asTenant(TENANT_B, () => writeLog(ROBOT_B))).id;
    // A platform event, as the impersonation audit writes it.
    platformLog = (await writeLog('platform', { tenantId: null })).id;
  });

  it('stamps each row with its owner', async () => {
    const rows = await raw.complianceLog.findMany({ select: { id: true, tenantId: true } });
    const owner = Object.fromEntries(rows.map((r) => [r.id, r.tenantId]));
    expect(owner[logA]).toBe(TENANT_A);
    expect(owner[logAByRobot]).toBe(TENANT_A);
    expect(owner[logB]).toBe(TENANT_B);
    expect(owner[platformLog]).toBeNull();
  });

  it("lists only the caller's tenant's rows", async () => {
    const a = await asTenant(TENANT_A, () => complianceLogRepository.findAll({ limit: 100 }));
    expect(a.logs.map((l) => l.id).sort()).toEqual([logA, logAByRobot].sort());
    expect(a.total).toBe(2);

    const session = await asTenant(TENANT_B, () =>
      complianceLogRepository.findBySessionId('session-1')
    );
    expect(session.map((l) => l.id)).toEqual([logB]);
  });

  it("answers another tenant's id as missing and records no access", async () => {
    const found = await asTenant(TENANT_A, () =>
      complianceLogRepository.findById(logB, 'user-a', '127.0.0.1')
    );
    expect(found).toBeNull();
    expect(await raw.complianceLogAccess.count({ where: { logId: logB } })).toBe(0);

    const history = await asTenant(TENANT_B, () => complianceLogRepository.getAccessHistory(logA));
    expect(history).toEqual([]);
  });

  it('shows platform events to the platform scope only', async () => {
    const asA = await asTenant(TENANT_A, () => complianceLogRepository.findById(platformLog));
    expect(asA).toBeNull();

    const all = await asPlatform(() => complianceLogRepository.findAll({ limit: 100 }));
    expect(all.logs.map((l) => l.id)).toContain(platformLog);
    expect(all.total).toBe(4);
  });

  it('counts metrics per tenant', async () => {
    const metrics = await asTenant(TENANT_B, () => complianceLogRepository.getMetricsSummary());
    expect(metrics.totalLogs).toBe(1);
    expect(metrics.uniqueRobots).toBe(1);
  });

  it("exports only the caller's rows", async () => {
    const result = await asTenant(TENANT_A, () => logExportService.exportToJson({}, 'user-a'));
    expect(result.data.map((l) => l.id).sort()).toEqual([logA, logAByRobot].sort());
  });

  it('verifies the one global chain, but reports only own rows to a tenant', async () => {
    const platform = await asPlatform(() => complianceLogRepository.verifyHashChain());
    expect(platform.isValid).toBe(true);
    expect(platform.totalLogs).toBe(4);

    const b = await asTenant(TENANT_B, () => complianceLogRepository.verifyHashChain());
    expect(b.isValid).toBe(true);
    expect(b.totalLogs).toBe(1);
  });

  it('backfills unowned rows from robot and operator, leaves platform events null, and the chain still verifies', async () => {
    const user = await raw.user.create({
      data: { email: 'op-b@test.dev', name: 'Op B', passwordHash: 'x', tenantId: TENANT_B },
    });
    const legacyByOperator = (await writeLog('unknown-robot', { operatorId: user.id, tenantId: null })).id;
    // Simulate a row written before the column existed.
    await raw.complianceLog.update({ where: { id: logAByRobot }, data: { tenantId: null } });

    const stamped = await backfillComplianceLogTenants();
    expect(stamped).toBe(2);

    const rows = await raw.complianceLog.findMany({ select: { id: true, tenantId: true } });
    const owner = Object.fromEntries(rows.map((r) => [r.id, r.tenantId]));
    expect(owner[logAByRobot]).toBe(TENANT_A);
    expect(owner[legacyByOperator]).toBe(TENANT_B);
    expect(owner[platformLog]).toBeNull();

    // Idempotent: a second boot stamps nothing.
    expect(await backfillComplianceLogTenants()).toBe(0);
    expect((await asPlatform(() => complianceLogRepository.verifyHashChain())).isValid).toBe(true);
  });
});

describe('skills and skill chains are kept per tenant (TASK-384)', () => {
  let skillA: string;
  let chainA: string;

  beforeEach(async () => {
    await raw.skillChainStep.deleteMany();
    await raw.skillChain.deleteMany();
    await raw.skillDefinition.deleteMany();

    skillA = (
      await asTenant(TENANT_A, () =>
        skillDefinitionRepository.create({ name: 'pick', version: '1.0.0', description: 'tenant A IP' })
      )
    ).id;
    chainA = (
      await asTenant(TENANT_A, () =>
        skillChainRepository.create({ name: 'chain-a', steps: [{ skillId: skillA }] })
      )
    ).id;
  });

  it('stamps the creating tenant', async () => {
    expect((await raw.skillDefinition.findUnique({ where: { id: skillA } }))?.tenantId).toBe(TENANT_A);
    expect((await raw.skillChain.findUnique({ where: { id: chainA } }))?.tenantId).toBe(TENANT_A);
  });

  it("does not list or find another tenant's skill or chain", async () => {
    const listed = await asTenant(TENANT_B, () => skillDefinitionRepository.findAll());
    expect(listed.data).toEqual([]);
    expect(await asTenant(TENANT_B, () => skillDefinitionRepository.findById(skillA))).toBeNull();
    expect(
      await asTenant(TENANT_B, () => skillDefinitionRepository.findByNameAndVersion('pick', '1.0.0'))
    ).toBeNull();
    expect(await asTenant(TENANT_B, () => skillChainRepository.findById(chainA))).toBeNull();
  });

  it("refuses to update or delete another tenant's skill and leaves it unchanged", async () => {
    const updated = await asTenant(TENANT_B, () =>
      skillDefinitionRepository.update(skillA, { description: 'overwritten by tenant B' })
    );
    expect(updated).toBeNull();
    expect(await asTenant(TENANT_B, () => skillDefinitionRepository.delete(skillA))).toBe(false);

    const row = await raw.skillDefinition.findUnique({ where: { id: skillA } });
    expect(row?.description).toBe('tenant A IP');
  });

  it("does not touch another tenant's chain steps", async () => {
    const updated = await asTenant(TENANT_B, () =>
      skillChainRepository.update(chainA, { steps: [] })
    );
    expect(updated).toBeNull();
    expect(await raw.skillChainStep.count({ where: { chainId: chainA } })).toBe(1);
    expect(await asTenant(TENANT_B, () => skillChainRepository.delete(chainA))).toBe(false);
  });

  it('lets two tenants each own the same name and version', async () => {
    const b = await asTenant(TENANT_B, () =>
      skillDefinitionRepository.create({ name: 'pick', version: '1.0.0' })
    );
    expect(b.id).not.toBe(skillA);
    await expect(
      asTenant(TENANT_A, () => skillDefinitionRepository.create({ name: 'pick', version: '1.0.0' }))
    ).rejects.toThrow();
  });
});

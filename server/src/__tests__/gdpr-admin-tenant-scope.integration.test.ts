/**
 * @file gdpr-admin-tenant-scope.integration.test.ts
 * @description GDPR admin queries confined to one tenant on a real database (TASK-383)
 * @feature gdpr
 *
 * GDPR rows carry no tenantId; the scope is a relation filter on the data
 * subject's `user.tenantId`, used in findMany, count and groupBy. A mocked
 * prisma would accept any shape, so this pushes the real schema to a temp
 * SQLite file and drives the real services, with multi-tenancy on, the way
 * `tenant-boundary.integration.test.ts` does.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../config/features.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/features.js')>()),
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

const A = { tenantId: 'tenant-a' };
const B = { tenantId: 'tenant-b' };

let tmpDir: string;
let previousDatabaseUrl: string | undefined;
let raw: PrismaClient;
let tenantStore: (typeof import('../middleware/tenantContext.js'))['tenantStore'];
let gdpr: (typeof import('../services/GDPRRequestService.js'))['gdprRequestService'];
let consents: (typeof import('../services/ConsentService.js'))['consentService'];
let restrictions: (typeof import('../services/DataRestrictionService.js'))['dataRestrictionService'];

function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ tenantId }, fn);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-gdpr-scope-'));
  const dbPath = join(tmpDir, 'test.db');
  const projectRoot = join(__dirname, '..', '..');
  execSync(
    `npx prisma db push --schema=${join(projectRoot, 'prisma', 'schema.prisma')} --skip-generate --accept-data-loss`,
    { env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, cwd: projectRoot, stdio: 'pipe' },
  );
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  delete (globalThis as { prisma?: unknown }).prisma;

  ({ tenantStore } = await import('../middleware/tenantContext.js'));
  ({ gdprRequestService: gdpr } = await import('../services/GDPRRequestService.js'));
  ({ consentService: consents } = await import('../services/ConsentService.js'));
  ({ dataRestrictionService: restrictions } = await import('../services/DataRestrictionService.js'));

  raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  await raw.tenant.createMany({
    data: [
      { id: 'default', slug: 'default', name: 'Default Organization' },
      { id: A.tenantId, slug: 'tenant-a', name: 'Tenant A' },
      { id: B.tenantId, slug: 'tenant-b', name: 'Tenant B' },
    ],
  });
  const overdue = new Date(Date.now() - 86_400_000);
  for (const [user, tenantId, requests] of [
    ['user-a', A.tenantId, 2],
    ['user-b', B.tenantId, 1],
  ] as const) {
    await raw.user.create({
      data: { id: user, email: `${user}@example.com`, passwordHash: 'x', name: user, tenantId },
    });
    for (let i = 0; i < requests; i++) {
      await raw.gDPRRequest.create({
        data: { userId: user, requestType: 'erasure', slaDeadline: overdue },
      });
    }
    await raw.userConsent.create({
      data: { userId: user, consentType: 'analytics', granted: true, version: '1' },
    });
    await raw.dataRestriction.create({
      data: { userId: user, scope: 'all', reason: 'objection_pending' },
    });
  }
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

describe('GDPR admin queries scoped to a tenant', () => {
  it('lists only the scoped tenant\'s requests', async () => {
    const list = await asTenant(B.tenantId, () => gdpr.getAllRequests({}, 1, 20, B));
    expect(list.total).toBe(1);
    expect(list.requests.map((r) => r.userId)).toEqual(['user-b']);
  });

  it('counts and groups only the scoped tenant in metrics and the SLA report', async () => {
    const metrics = await asTenant(A.tenantId, () => gdpr.getMetrics(A));
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.overdueRequests).toBe(2);
    expect(metrics.requestsByType).toEqual({ erasure: 2 });

    const report = await asTenant(B.tenantId, () => gdpr.getSLAReport(B));
    expect(report.totalRequests).toBe(1);
  });

  it('confines overdue requests, consent metrics and restrictions', async () => {
    const overdue = await asTenant(B.tenantId, () => gdpr.getOverdueRequests(B));
    expect(overdue.map((r) => r.userId)).toEqual(['user-b']);

    const consentMetrics = await asTenant(B.tenantId, () => consents.getConsentMetrics(B));
    expect(consentMetrics.totalUsers).toBe(1);
    expect(consentMetrics.consentsByType.analytics).toEqual({ granted: 1, revoked: 0 });

    const active = await asTenant(B.tenantId, () => restrictions.getActiveRestrictions(B));
    expect(active.map((r) => r.userId)).toEqual(['user-b']);
    const stats = await asTenant(B.tenantId, () => restrictions.getRestrictionStats(B));
    expect(stats.activeRestrictions).toBe(1);
  });

  it('sees every tenant when unscoped (super-admin)', async () => {
    const list = await gdpr.getAllRequests({}, 1, 20);
    expect(list.total).toBe(3);
    const metrics = await gdpr.getMetrics();
    expect(metrics.totalRequests).toBe(3);
  });
});

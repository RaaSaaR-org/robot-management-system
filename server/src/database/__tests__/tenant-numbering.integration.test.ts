/**
 * @file tenant-numbering.integration.test.ts
 * @description Two-tenant integration test for the TASK-287 number allocator.
 * @feature multi-tenancy
 *
 * The unit tests for the two generators mock prisma, and the old ones asserted
 * the broken seam verbatim — `orderBy: { incidentNumber: 'desc' }` — which is
 * precisely why a lexicographic sort on a globally unique column survived. This
 * file mocks nothing below the feature flag: it pushes the real schema to a
 * temp SQLite database, binds the REAL client singleton to it (the isolation
 * extension included, not a copy of it as `client.test.ts` uses), and drives
 * the real repositories through the real `tenantStore`.
 *
 * That distinction matters. `client.test.ts` re-implements the extension and
 * `multi-tenancy.integration.test.ts` re-implements a four-model allowlist that
 * excludes Incident and ApprovalRequest, so neither could host these cases.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The flag is read at module load, so it has to be true before client.ts is
// imported. Everything below the flag — tenantContext, the extension, both
// repositories — is the real module.
vi.mock('../../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const YEAR = new Date().getFullYear();

const INC = (n: string) => `INC-${YEAR}-${n}`;
const APR = (n: string) => `APR-${YEAR}-${n}`;

let tmpDir: string;
let dbPath: string;
let previousDatabaseUrl: string | undefined;

let raw: PrismaClient;
let tenantStore: (typeof import('../../middleware/tenantContext.js'))['tenantStore'];
let incidentRepository: (typeof import('../../repositories/IncidentRepository.js'))['incidentRepository'];
let approvalRequestRepository: (typeof import('../../repositories/ApprovalRepository.js'))['approvalRequestRepository'];

/** Run a body inside a tenant's request scope, exactly as the middleware does. */
function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ tenantId }, fn);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-numbering-'));
  dbPath = join(tmpDir, 'test.db');

  const projectRoot = join(__dirname, '..', '..', '..');
  const schemaPath = join(projectRoot, 'prisma', 'schema.prisma');
  execSync(
    `npx prisma db push --schema=${schemaPath} --skip-generate --accept-data-loss`,
    {
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      cwd: projectRoot,
      stdio: 'pipe',
    }
  );

  // `buildPrisma()` passes no `datasources`, so the singleton reads
  // DATABASE_URL at construction — it must point at the temp database BEFORE
  // the module is imported. The cached instance on globalThis is dropped too:
  // vitest reuses a worker across files, and a client another file built would
  // still be pointing at that file's database.
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  delete (globalThis as { prisma?: unknown }).prisma;

  ({ tenantStore } = await import('../../middleware/tenantContext.js'));
  ({ incidentRepository } = await import('../../repositories/IncidentRepository.js'));
  ({ approvalRequestRepository } = await import(
    '../../repositories/ApprovalRepository.js'
  ));

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
  // other tenant's rows behind and the next test would inherit its counter.
  await raw.approvalStatusHistory.deleteMany();
  await raw.approvalStep.deleteMany();
  await raw.approvalChain.deleteMany();
  await raw.approvalRequest.deleteMany();
  await raw.incidentNotification.deleteMany();
  await raw.incident.deleteMany();
  await raw.numberSequence.deleteMany();
});

/** Seed an incident straight into a tenant, bypassing the allocator. */
async function seedIncidentRaw(incidentNumber: string, tenantId: string): Promise<void> {
  await raw.incident.create({
    data: {
      incidentNumber,
      type: 'safety',
      severity: 'medium',
      title: `Seeded ${incidentNumber}`,
      description: 'seeded outside the allocator',
      detectedAt: new Date(),
      tenantId,
    },
  });
}

function createIncident(title: string) {
  return incidentRepository.create({
    type: 'safety',
    title,
    description: 'created through the repository',
  });
}

function createApproval() {
  return approvalRequestRepository.create({
    entityType: 'performance_evaluation',
    entityId: 'ent-1',
    requestedBy: 'user-req',
    requestReason: 'periodic review',
  });
}

// ---------------------------------------------------------------------------

describe('incident numbering across tenants', () => {
  it('gives each tenant its own INC-YYYY-001 without a unique violation', async () => {
    const a = await asTenant(TENANT_A, () => createIncident('A first'));
    // Under the old generator this threw P2002: tenant B could only ever see
    // its own (empty) rows, computed 001, and hit tenant A's globally unique
    // row — a 500 that no retry could resolve, because the number never moved.
    const b = await asTenant(TENANT_B, () => createIncident('B first'));

    expect(a.incidentNumber).toBe(INC('001'));
    expect(b.incidentNumber).toBe(INC('001'));

    const counters = await raw.numberSequence.findMany({
      where: { scope: 'incident' },
      orderBy: { tenantKey: 'asc' },
    });
    expect(counters.map((c) => c.tenantKey)).toEqual([TENANT_A, TENANT_B]);
    expect(counters.every((c) => c.value === 1)).toBe(true);
  });

  it('keeps each tenant on its own run of numbers', async () => {
    await asTenant(TENANT_A, () => createIncident('A 1'));
    await asTenant(TENANT_A, () => createIncident('A 2'));
    const b = await asTenant(TENANT_B, () => createIncident('B 1'));
    const a3 = await asTenant(TENANT_A, () => createIncident('A 3'));

    expect(b.incidentNumber).toBe(INC('001'));
    expect(a3.incidentNumber).toBe(INC('003'));
  });

  it('issues 1001 after 1000 instead of folding back onto 999', async () => {
    // The exact shape the old string `orderBy` got wrong: 'INC-…-999' sorts
    // above 'INC-…-1000', so the thousandth incident of a year recomputed a
    // number that already existed, forever.
    await seedIncidentRaw(INC('999'), TENANT_A);
    await seedIncidentRaw(INC('1000'), TENANT_A);

    const next = await asTenant(TENANT_A, () => createIncident('A 1001'));

    expect(next.incidentNumber).toBe(INC('1001'));
  });

  it('resumes from the existing numeric maximum when no counter row exists', async () => {
    // An upgraded deployment: incidents already numbered, NumberSequence empty.
    await seedIncidentRaw(INC('001'), TENANT_A);
    await seedIncidentRaw(INC('007'), TENANT_A);
    expect(await raw.numberSequence.count()).toBe(0);

    const next = await asTenant(TENANT_A, () => createIncident('A 8'));

    expect(next.incidentNumber).toBe(INC('008'));
  });

  it('seeds per tenant, so one tenant’s history does not skip another’s', async () => {
    await seedIncidentRaw(INC('042'), TENANT_A);

    const a = await asTenant(TENANT_A, () => createIncident('A next'));
    const b = await asTenant(TENANT_B, () => createIncident('B first'));

    expect(a.incidentNumber).toBe(INC('043'));
    expect(b.incidentNumber).toBe(INC('001'));
  });

  it('numbers under the "default" key outside any tenant scope', async () => {
    // Background jobs, seeds and workers run with no tenantStore scope at all.
    const first = await createIncident('no scope 1');
    const second = await createIncident('no scope 2');

    expect(first.incidentNumber).toBe(INC('001'));
    expect(second.incidentNumber).toBe(INC('002'));

    const counter = await raw.numberSequence.findUnique({
      where: {
        scope_tenantKey_year: { scope: 'incident', tenantKey: 'default', year: YEAR },
      },
    });
    expect(counter?.value).toBe(2);
  });

  it('finds an incident by number inside its tenant and not from another', async () => {
    const created = await asTenant(TENANT_A, () => createIncident('A findable'));

    const own = await asTenant(TENANT_A, () =>
      incidentRepository.findByNumber(created.incidentNumber)
    );
    const foreign = await asTenant(TENANT_B, () =>
      incidentRepository.findByNumber(created.incidentNumber)
    );

    expect(own?.id).toBe(created.id);
    expect(foreign).toBeNull();
  });
});

describe('approval numbering across tenants', () => {
  it('gives each tenant its own APR-YYYY-00001 at pad 5', async () => {
    const a = await asTenant(TENANT_A, createApproval);
    const b = await asTenant(TENANT_B, createApproval);

    expect(a.requestNumber).toBe(APR('00001'));
    expect(b.requestNumber).toBe(APR('00001'));
  });

  it('advances within a tenant and keeps the counter separate from incidents', async () => {
    await asTenant(TENANT_A, createApproval);
    const second = await asTenant(TENANT_A, createApproval);
    const incident = await asTenant(TENANT_A, () => createIncident('A inc'));

    expect(second.requestNumber).toBe(APR('00002'));
    // Separate scope, so the incident series is untouched by the approvals.
    expect(incident.incidentNumber).toBe(INC('001'));

    const scopes = await raw.numberSequence.findMany({
      where: { tenantKey: TENANT_A },
      orderBy: { scope: 'asc' },
    });
    expect(scopes.map((s) => [s.scope, s.value])).toEqual([
      ['approval', 2],
      ['incident', 1],
    ]);
  });
});

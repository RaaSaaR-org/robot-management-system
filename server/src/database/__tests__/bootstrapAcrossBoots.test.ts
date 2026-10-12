/**
 * @file bootstrapAcrossBoots.test.ts
 * @description The bootstrap super-admin (TASK-367) survives restarts under
 * multi-tenancy: the boot sequence runs `seedDefaultTenant()` and then
 * `bootstrapSuperAdmin()` every time, and the tenant backfill must not adopt
 * the platform account into `default`, where its owner could demote it.
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UserRow {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
  passwordHash: string;
  isActive: boolean;
}

/**
 * An in-memory `user` table that understands the two `where` shapes the boot
 * path uses — `{ tenantId: null }` with an optional `NOT: { role }`, and
 * `{ email }` — so a wrong filter shows up as a wrongly stamped row.
 */
const { db, mockPrisma } = vi.hoisted(() => {
  const db = { users: [] as UserRow[] };
  type Where = { tenantId?: null; NOT?: { role?: string }; email?: string };
  const matches = (row: UserRow, where: Where) =>
    (!('tenantId' in where) || row.tenantId === where.tenantId) &&
    (where.NOT?.role === undefined || row.role !== where.NOT.role) &&
    (where.email === undefined || row.email === where.email);

  const noop = () => ({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) });
  const prisma: Record<string, unknown> = {
    user: {
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<UserRow> }) => {
        const hit = db.users.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) =>
        db.users.find((r) => r.email === where.email) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<UserRow, 'id' | 'isActive'> }) => {
        const row = { id: `u${db.users.length + 1}`, isActive: true, ...data };
        db.users.push(row);
        return row;
      }),
    },
    sensorScan: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
  };
  for (const model of [
    'robot', 'dataset', 'trainingJob', 'alert', 'incident', 'robotTask', 'robotCommand',
    'processDefinition', 'processInstance', 'approvalRequest', 'event',
    'modelVersion', 'deployment', 'simulationJob', 'syntheticJob', 'conversation',
    'apiToken', 'episodeReward', 'interventionEpisode', 'digitalTwin', 'scanSession',
    'simScene', 'motionClip', 'vlaSession', 'skillDefinition', 'skillChain',
  ]) {
    prisma[model] = noop();
  }
  // TASK-384: the compliance-log backfill reads distinct owners first; none here.
  prisma.complianceLog = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() };
  return { db, mockPrisma: prisma };
});

vi.mock('../client.js', () => ({ prisma: mockPrisma }));
vi.mock('../index.js', () => ({ prisma: mockPrisma }));
vi.mock('../defaultTenant.js', () => ({ ensureDefaultTenant: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

import { seedDefaultTenant } from '../seedTenant.js';
import { bootstrapSuperAdmin } from '../bootstrapSuperAdmin.js';

const ENV = {
  AUTH_DISABLED: 'false',
  BOOTSTRAP_ADMIN_EMAIL: 'root@emai.dev',
  BOOTSTRAP_ADMIN_PASSWORD: 'RootPass2026',
};

/** The order `server/src/index.ts` runs them in. */
async function boot(): Promise<void> {
  await seedDefaultTenant();
  await bootstrapSuperAdmin(ENV);
}

beforeEach(() => {
  db.users = [];
});

describe('bootstrap super-admin across boots', () => {
  it('two boots in a row leave the bootstrap admin unchanged', async () => {
    await boot();
    const afterFirst = structuredClone(db.users.find((u) => u.email === ENV.BOOTSTRAP_ADMIN_EMAIL));
    expect(afterFirst).toMatchObject({ role: 'super-admin', tenantId: null, isActive: true });

    await boot();
    await boot();

    expect(db.users).toHaveLength(1);
    expect(db.users[0]).toEqual(afterFirst);
  });

  it('still adopts ordinary tenant-less users into default', async () => {
    db.users.push({
      id: 'legacy',
      email: 'legacy@example.com',
      role: 'viewer',
      tenantId: null,
      passwordHash: 'x',
      isActive: true,
    });

    await boot();
    await boot();

    expect(db.users.find((u) => u.id === 'legacy')?.tenantId).toBe('default');
    expect(db.users.find((u) => u.role === 'super-admin')?.tenantId).toBeNull();
  });
});

/**
 * @file TenantService.test.ts
 * @description Unit tests for TenantService — tenant CRUD, per-tenant count
 * aggregation, slug validation, delete guards, and atomic onboarding.
 * @feature multi-tenancy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (declared via vi.hoisted so they exist before
// the mocked modules are imported).
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  tenant: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    count: vi.fn(),
    create: vi.fn(),
  },
  robot: {
    count: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  dataset: {
    count: vi.fn(),
  },
  trainingJob: {
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

// runAsPlatform just invokes its callback in tests (ALS bypass is irrelevant
// against a fully-mocked prisma client).
vi.mock('../../middleware/tenantContext.js', () => ({
  runAsPlatform: <T>(fn: () => Promise<T> | T) => fn(),
  PLATFORM_TENANT: '__platform__',
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(async () => 'hashed-password') },
}));

import {
  TenantService,
  TenantNotEmptyError,
  TenantSlugTakenError,
  slugify,
} from '../TenantService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  plan: string | null;
  settings: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: 'tenant-1',
    slug: 'acme',
    name: 'Acme',
    logoUrl: null,
    plan: null,
    settings: '{}',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

/** Default: all four counts return 0. */
function setZeroCounts(): void {
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.robot.count.mockResolvedValue(0);
  prismaMock.dataset.count.mockResolvedValue(0);
  prismaMock.trainingJob.count.mockResolvedValue(0);
}

let service: TenantService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new TenantService();
  setZeroCounts();
});

// ===========================================================================
// slugify (pure helper)
// ===========================================================================

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugify('Acme Robotics!')).toBe('acme-robotics');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --Hello World--  ')).toBe('hello-world');
  });

  it('truncates to 64 characters', () => {
    expect(slugify('a'.repeat(100)).length).toBe(64);
  });
});

// ===========================================================================
// list
// ===========================================================================

describe('list', () => {
  it('returns DTOs for each tenant with computed counts', async () => {
    prismaMock.tenant.findMany.mockResolvedValue([
      makeRow({ id: 'default', slug: 'default', name: 'Default' }),
      makeRow({ id: 'tenant-2', slug: 'beta', name: 'Beta' }),
    ]);
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.robot.count.mockResolvedValue(1);

    const result = await service.list();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('default');
    expect(result[0].isDefault).toBe(true);
    expect(result[1].isDefault).toBe(false);
    expect(result[0].counts).toEqual({
      users: 3,
      robots: 1,
      datasets: 0,
      trainingJobs: 0,
    });
    expect(result[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(prismaMock.tenant.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'asc' }],
    });
  });

  it('returns an empty array when there are no tenants', async () => {
    prismaMock.tenant.findMany.mockResolvedValue([]);
    const result = await service.list();
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// get / getBySlug
// ===========================================================================

describe('get', () => {
  it('returns the DTO when the tenant exists', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow({ id: 'tenant-1' }));
    const result = await service.get('tenant-1');
    expect(result?.id).toBe('tenant-1');
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
  });

  it('returns null when the tenant does not exist', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    const result = await service.get('missing');
    expect(result).toBeNull();
  });
});

describe('getBySlug', () => {
  it('looks up by slug and returns the DTO', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow({ slug: 'acme' }));
    const result = await service.getBySlug('acme');
    expect(result?.slug).toBe('acme');
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
    });
  });

  it('returns null when no tenant has that slug', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    expect(await service.getBySlug('nope')).toBeNull();
  });
});

// ===========================================================================
// create
// ===========================================================================

describe('create', () => {
  it('creates a tenant, deriving the slug from the name', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    const created = makeRow({ id: 'new-1', slug: 'acme-robotics', name: 'Acme Robotics' });
    prismaMock.tenant.create.mockResolvedValue(created);

    const result = await service.create({ name: 'Acme Robotics' });

    expect(result.id).toBe('new-1');
    expect(prismaMock.tenant.create).toHaveBeenCalledWith({
      data: { slug: 'acme-robotics', name: 'Acme Robotics', logoUrl: null, plan: null },
    });
  });

  it('uses an explicitly provided slug (lowercased)', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    prismaMock.tenant.create.mockResolvedValue(makeRow({ slug: 'custom-slug' }));

    await service.create({ name: 'Whatever', slug: 'Custom-Slug', logoUrl: 'x', plan: 'pro' });

    expect(prismaMock.tenant.create).toHaveBeenCalledWith({
      data: { slug: 'custom-slug', name: 'Whatever', logoUrl: 'x', plan: 'pro' },
    });
  });

  it('throws when the name is empty/whitespace', async () => {
    await expect(service.create({ name: '   ' })).rejects.toThrow('name is required');
    expect(prismaMock.tenant.create).not.toHaveBeenCalled();
  });

  it('throws when the derived/provided slug is invalid', async () => {
    await expect(
      service.create({ name: 'X', slug: '-bad-' })
    ).rejects.toThrow('slug must be lowercase alphanumerics');
  });

  it('throws TenantSlugTakenError when the slug already exists', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow({ slug: 'acme' }));
    await expect(service.create({ name: 'Acme', slug: 'acme' })).rejects.toBeInstanceOf(
      TenantSlugTakenError
    );
    expect(prismaMock.tenant.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// update
// ===========================================================================

describe('update', () => {
  it('throws when the tenant does not exist', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { name: 'x' })).rejects.toThrow('Tenant not found');
  });

  it('updates name, plan, and serializes settings', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow());
    prismaMock.tenant.update.mockResolvedValue(makeRow({ name: 'Renamed' }));

    await service.update('tenant-1', {
      name: '  Renamed  ',
      plan: 'enterprise',
      settings: { theme: 'dark' },
    });

    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { name: 'Renamed', plan: 'enterprise', settings: '{"theme":"dark"}' },
    });
  });

  it('throws when name is provided but empty', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow());
    await expect(service.update('tenant-1', { name: '   ' })).rejects.toThrow(
      'name cannot be empty'
    );
  });

  it('rejects an invalid logoUrl', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow());
    await expect(
      service.update('tenant-1', { logoUrl: 'not a url' })
    ).rejects.toThrow('logoUrl must be a valid URL');
  });

  it('normalizes an empty logoUrl to null', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow());
    prismaMock.tenant.update.mockResolvedValue(makeRow());

    await service.update('tenant-1', { logoUrl: '' });

    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { logoUrl: null },
    });
  });

  it('accepts a valid logoUrl', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow());
    prismaMock.tenant.update.mockResolvedValue(makeRow({ logoUrl: 'https://x.io/l.png' }));

    await service.update('tenant-1', { logoUrl: 'https://x.io/l.png' });

    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { logoUrl: 'https://x.io/l.png' },
    });
  });
});

// ===========================================================================
// delete
// ===========================================================================

describe('delete', () => {
  it('refuses to delete the DEFAULT tenant', async () => {
    await expect(service.delete('default')).rejects.toThrow('Cannot delete the DEFAULT tenant');
    expect(prismaMock.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the tenant does not exist', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    await expect(service.delete('tenant-9')).rejects.toThrow('Tenant not found');
  });

  it('throws TenantNotEmptyError when the tenant still owns resources', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow({ id: 'tenant-9' }));
    prismaMock.user.count.mockResolvedValue(2);

    const err = await service
      .delete('tenant-9')
      .catch((e: unknown) => e as TenantNotEmptyError);

    expect(err).toBeInstanceOf(TenantNotEmptyError);
    expect((err as TenantNotEmptyError).counts.users).toBe(2);
    expect(prismaMock.tenant.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty, non-default tenant', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow({ id: 'tenant-9' }));
    prismaMock.tenant.delete.mockResolvedValue(makeRow({ id: 'tenant-9' }));

    await service.delete('tenant-9');

    expect(prismaMock.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant-9' } });
  });
});

// ===========================================================================
// onboard
// ===========================================================================

describe('onboard', () => {
  function wireTransaction(): {
    tenantCreate: ReturnType<typeof vi.fn>;
    userCreate: ReturnType<typeof vi.fn>;
    robotFindMany: ReturnType<typeof vi.fn>;
    robotCreateMany: ReturnType<typeof vi.fn>;
  } {
    const tenantCreate = vi.fn();
    const userCreate = vi.fn();
    const robotFindMany = vi.fn().mockResolvedValue([]);
    const robotCreateMany = vi.fn();
    const tx = {
      tenant: { create: tenantCreate },
      user: { create: userCreate },
      robot: { findMany: robotFindMany, createMany: robotCreateMany },
    };
    prismaMock.$transaction.mockImplementation(
      async (cb: (t: typeof tx) => unknown) => cb(tx)
    );
    return { tenantCreate, userCreate, robotFindMany, robotCreateMany };
  }

  it('creates tenant + admin user atomically and returns both', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    const { tenantCreate, userCreate } = wireTransaction();
    tenantCreate.mockResolvedValue(makeRow({ id: 'new-t', slug: 'acme', name: 'Acme' }));
    userCreate.mockResolvedValue({ id: 'user-1', email: 'admin@acme.io' });

    const result = await service.onboard({
      tenant: { name: 'Acme' },
      adminUser: { email: 'Admin@Acme.io', name: 'Admin', password: 'pw' },
    });

    expect(result.tenant.id).toBe('new-t');
    expect(result.adminUser).toEqual({ id: 'user-1', email: 'admin@acme.io' });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@acme.io',
          role: 'owner',
          tenantId: 'new-t',
          forcePasswordChange: true,
          passwordHash: 'hashed-password',
        }),
      })
    );
  });

  it('throws TenantSlugTakenError before opening a transaction', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(makeRow({ slug: 'acme' }));
    await expect(
      service.onboard({
        tenant: { name: 'Acme', slug: 'acme' },
        adminUser: { email: 'a@b.io', name: 'A', password: 'pw' },
      })
    ).rejects.toBeInstanceOf(TenantSlugTakenError);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('throws on an invalid slug', async () => {
    await expect(
      service.onboard({
        tenant: { name: 'Acme', slug: '-bad-' },
        adminUser: { email: 'a@b.io', name: 'A', password: 'pw' },
      })
    ).rejects.toThrow('slug must be lowercase alphanumerics');
  });

  it('clones robots from the DEFAULT tenant when requested', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    const { tenantCreate, userCreate, robotFindMany, robotCreateMany } = wireTransaction();
    tenantCreate.mockResolvedValue(makeRow({ id: 'new-t', slug: 'acme' }));
    userCreate.mockResolvedValue({ id: 'user-1', email: 'a@b.io' });
    robotFindMany.mockResolvedValue([
      { name: 'Bot1', model: 'so101', serialNumber: 'SN1' },
    ]);

    await service.onboard({
      tenant: { name: 'Acme' },
      adminUser: { email: 'a@b.io', name: 'A', password: 'pw' },
      starterResources: { cloneRobots: true },
    });

    expect(robotCreateMany).toHaveBeenCalledWith({
      data: [{ name: 'Bot1', model: 'so101', tenantId: 'new-t' }],
    });
  });

  it('does not call createMany when the DEFAULT tenant has no robots', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    const { tenantCreate, userCreate, robotFindMany, robotCreateMany } = wireTransaction();
    tenantCreate.mockResolvedValue(makeRow({ id: 'new-t' }));
    userCreate.mockResolvedValue({ id: 'user-1', email: 'a@b.io' });
    robotFindMany.mockResolvedValue([]);

    await service.onboard({
      tenant: { name: 'Acme' },
      adminUser: { email: 'a@b.io', name: 'A', password: 'pw' },
      starterResources: { cloneRobots: true },
    });

    expect(robotCreateMany).not.toHaveBeenCalled();
  });
});

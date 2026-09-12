/**
 * @file ensureDefaultTenant.test.ts
 * @description The on-demand DEFAULT organization row: the isolation guard that
 *   keeps it from minting any other tenant, and the two ways a unique
 *   constraint can fire through no fault of the request that triggered it.
 * @feature multi-tenancy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const create = vi.fn();

vi.mock('../index.js', () => ({
  prisma: {
    tenant: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: (...args: unknown[]) => create(...args),
    },
  },
}));

vi.mock('../../config/features.js', () => ({
  DEFAULT_TENANT_ID: 'default',
  MULTI_TENANCY_ENABLED: false,
}));

import { ensureDefaultTenant } from '../defaultTenant.js';

/** A Prisma unique-constraint violation, as the client actually throws it. */
function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
});

describe('ensureDefaultTenant', () => {
  it('never creates a tenant other than the default', async () => {
    await ensureDefaultTenant('some-other-tenant');
    await ensureDefaultTenant(null);
    await ensureDefaultTenant(undefined);

    // A caller-supplied tenantId must not be conjured into existence: that
    // would let a stale or forged claim start its own island of rows.
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('does nothing when the row already exists', async () => {
    findUnique.mockResolvedValue({ id: 'default' });

    await ensureDefaultTenant('default');

    expect(create).not.toHaveBeenCalled();
  });

  it('creates the row when it is missing', async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'default' });

    await ensureDefaultTenant('default');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ id: 'default', slug: 'default' });
  });

  it('treats a concurrent first write as success', async () => {
    // The row appeared between our check and our insert — that is the outcome
    // we wanted, so it must not fail the request that happened to trigger it.
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'default' });
    create.mockRejectedValueOnce(uniqueViolation());

    await expect(ensureDefaultTenant('default')).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('yields the slug when a real organization already owns "default"', async () => {
    // The id is still free, so the foreign key can be satisfied; only the
    // cosmetic slug is taken. Without this, every add-teammate request on such
    // a database would fail forever with a 409 about a value the caller never
    // supplied.
    findUnique.mockResolvedValue(null);
    create.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({ id: 'default' });

    await ensureDefaultTenant('default');

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].data).toMatchObject({
      id: 'default',
      slug: 'default-organization',
    });
  });

  it('rethrows anything that is not a unique violation', async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValueOnce(new Error('connection lost'));

    await expect(ensureDefaultTenant('default')).rejects.toThrow('connection lost');
  });
});

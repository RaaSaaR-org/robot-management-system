/**
 * @file defaultTenant.ts
 * @description Guarantees the DEFAULT organization row exists before anything
 * writes a row whose foreign key points at it. Dev and single-tenant
 * deployments stamp `tenantId: 'default'` (the `AUTH_DISABLED=true` mock user
 * carries it, as does every JWT issued without a real organization), but
 * `seedDefaultTenant` only creates that row when MULTI_TENANCY_ENABLED=true —
 * so on a single-tenant database the first teammate or service account failed
 * the User → Tenant foreign key with Prisma P2003.
 *
 * Only the DEFAULT organization is created on demand. A caller-supplied
 * tenantId is never conjured into existence: that would let a stale or forged
 * claim mint its own tenant and start a private, invisible island of rows.
 * @feature multi-tenancy
 */

import { prisma } from './index.js';
import { DEFAULT_TENANT_ID } from '../config/features.js';

/** Prisma's unique-constraint violation, without importing the client's types. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

const DEFAULT_TENANT_NAME = 'Default Organization';

/**
 * Ensure the DEFAULT organization exists when that is the tenant being written
 * to. Idempotent, and a no-op for every other tenantId (including null).
 *
 * @param tenantId - The tenant the caller is about to write a row for
 */
export async function ensureDefaultTenant(
  tenantId: string | null | undefined
): Promise<void> {
  if (tenantId !== DEFAULT_TENANT_ID) return;

  if (await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } })) return;

  try {
    await prisma.tenant.create({
      data: {
        id: DEFAULT_TENANT_ID,
        slug: DEFAULT_TENANT_ID,
        name: DEFAULT_TENANT_NAME,
        settings: '{}',
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Someone else holds a unique column we asked for. Two ways that happens,
    // and neither should fail the unrelated request that called us:
    //
    // 1. A concurrent first write created the row between the check and here —
    //    that is the outcome we wanted, so it is success, not an error.
    // 2. A real organization named "Default" already owns the `default` *slug*
    //    while the id is still free. `POST /api/tenants` is not gated by
    //    MULTI_TENANCY_ENABLED, so this is reachable on a single-tenant
    //    database, and retrying forever would make every add-teammate request
    //    fail with a 409 about a value the caller never supplied.
    //
    // The foreign key points at the id; the slug is cosmetic, so yield it.
    if (await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } })) return;

    await prisma.tenant.create({
      data: {
        id: DEFAULT_TENANT_ID,
        slug: `${DEFAULT_TENANT_ID}-organization`,
        name: DEFAULT_TENANT_NAME,
        settings: '{}',
      },
    });
  }
}

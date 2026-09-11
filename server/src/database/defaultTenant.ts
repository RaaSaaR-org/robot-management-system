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

/**
 * Upsert the DEFAULT organization when that is the tenant being written to.
 * Idempotent, and a no-op for every other tenantId (including null).
 *
 * @param tenantId - The tenant the caller is about to write a row for
 */
export async function ensureDefaultTenant(
  tenantId: string | null | undefined
): Promise<void> {
  if (tenantId !== DEFAULT_TENANT_ID) return;

  await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    create: {
      id: DEFAULT_TENANT_ID,
      slug: DEFAULT_TENANT_ID,
      name: 'Default Organization',
      settings: '{}',
    },
    update: {},
  });
}

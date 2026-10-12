/**
 * @file gdprTenantScope.ts
 * @description The tenant a GDPR admin query is confined to (TASK-383)
 * @feature gdpr
 *
 * GDPR requests, consents and restrictions carry no `tenantId` of their own;
 * their tenant is their data subject's. An admin query is confined by a
 * relation filter on `user.tenantId`.
 */

/**
 * The tenant an admin query may see. Omitted (`undefined`) means platform-wide,
 * which only a super-admin gets. `tenantId: null` is the single-tenant case and
 * matches users without a tenant.
 */
export interface GDPRTenantScope {
  tenantId: string | null;
}

/** The `where` fragment confining a user-owned GDPR row to `scope`. */
export function gdprScopeWhere(
  scope?: GDPRTenantScope,
): { user?: { tenantId: string | null } } {
  return scope ? { user: { tenantId: scope.tenantId } } : {};
}

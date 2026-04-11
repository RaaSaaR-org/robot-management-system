/**
 * @file tenantContext.ts
 * @description Request-scoped tenant context via AsyncLocalStorage.
 * This exists so the Prisma client extension (server/src/database/client.ts)
 * can inject `tenantId` into queries without every repository having to
 * thread it through function arguments. The middleware runs after
 * `authMiddleware`, reads `req.user.tenantId`, and calls `tenantStore.run`
 * so downstream handlers (and their Prisma calls) see the current tenant.
 * @feature multi-tenancy
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { MULTI_TENANCY_ENABLED, DEFAULT_TENANT_ID } from '../config/features.js';

interface TenantContext {
  tenantId: string;
}

/**
 * Sentinel value used to escape tenant scoping for platform-admin
 * operations that need to query across tenants (e.g. the Tenant list
 * itself, counting rows per tenant for the Organizations UI).
 *
 * The Prisma extension treats this as "no tenant" and bypasses the
 * usual where-injection, letting the caller pass any explicit
 * `tenantId` filter without it being overridden.
 */
export const PLATFORM_TENANT = '__platform__';

/**
 * Minimal shape the tenant middleware needs — just enough to read the
 * authenticated user's tenantId without importing the full
 * `AuthenticatedRequest` type (avoids a circular dep with auth.middleware).
 */
interface RequestWithMaybeUser extends Request {
  user?: { tenantId?: string | null };
}

/** AsyncLocalStorage instance — read via `getTenantId()`, not directly. */
export const tenantStore = new AsyncLocalStorage<TenantContext>();

/**
 * Returns the current request's tenantId, or `undefined` if:
 *   - multi-tenancy is disabled, OR
 *   - we're outside a request (e.g. background jobs, workers, seeds)
 *
 * The Prisma extension uses this as its enable-check: when it returns
 * undefined, the extension passes queries through untouched.
 */
export function getTenantId(): string | undefined {
  if (!MULTI_TENANCY_ENABLED) return undefined;
  const tid = tenantStore.getStore()?.tenantId;
  if (tid === PLATFORM_TENANT) return undefined;
  return tid;
}

/**
 * Run a callback as the platform admin — any Prisma queries inside the
 * callback bypass tenant scoping. Use for operator-level code paths
 * (list all tenants, compute per-tenant counts, cross-tenant reports).
 *
 * Only use when you have a legitimate platform-admin reason. Never call
 * this from a handler that a regular tenant user can reach without
 * additional authorisation.
 */
export function runAsPlatform<T>(fn: () => Promise<T> | T): Promise<T> | T {
  return tenantStore.run({ tenantId: PLATFORM_TENANT }, fn);
}

/**
 * Express middleware that wraps the rest of the request chain in an
 * ALS scope carrying the caller's tenantId. Must be mounted AFTER
 * `authMiddleware` so `req.user` is populated.
 *
 * When multi-tenancy is disabled this middleware is a pure passthrough.
 */
export function withTenantContext(
  req: RequestWithMaybeUser,
  _res: Response,
  next: NextFunction
): void {
  if (!MULTI_TENANCY_ENABLED) {
    return next();
  }

  // Prefer the JWT claim; fall back to DEFAULT for AUTH_DISABLED dev mode
  // where MOCK_USER carries the default tenantId.
  const tenantId = req.user?.tenantId ?? DEFAULT_TENANT_ID;
  tenantStore.run({ tenantId }, () => next());
}

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
  return tenantStore.getStore()?.tenantId;
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

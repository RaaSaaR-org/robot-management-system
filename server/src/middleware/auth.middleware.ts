/**
 * @file auth.middleware.ts
 * @description Express middleware for JWT authentication
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { authService, type TokenPayload } from '../services/AuthService.js';
import { authenticateServiceToken } from '../services/ServiceAccountService.js';
import { DEFAULT_TENANT_ID, MULTI_TENANCY_ENABLED } from '../config/features.js';
import { tenantStore } from './tenantContext.js';

/**
 * Unified role model (TASK-162).
 *
 * - `super-admin` is a platform-level role (`tenantId = null`); grants
 *   cross-tenant access via impersonation (TASK-160).
 * - `owner` / `member` / `viewer` are tenant-scoped roles. Owners manage
 *   their own tenant (billing, team). Members operate robots. Viewers
 *   have read-only access.
 */
export type UserRole = 'super-admin' | 'owner' | 'member' | 'viewer';

/**
 * User info attached to authenticated requests
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /**
   * Multi-tenancy (TASK-155): tenant this user belongs to. Null for
   * legacy/unscoped users and for platform `super-admin` accounts.
   * Read by `withTenantContext` middleware.
   */
  tenantId: string | null;
  /** TASK-165: 'human' for JWT auth, 'service' for API token auth. */
  authType?: 'human' | 'service';
  /** TASK-165: set only for service-account token auth. */
  tokenId?: string;
}

/**
 * Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Mock user for development mode — carries the DEFAULT tenantId so
 * multi-tenancy flows work end-to-end under AUTH_DISABLED=true.
 */
const MOCK_USER: AuthUser = {
  id: 'dev-user-id',
  email: 'dev@neodem.local',
  name: 'Dev User',
  role: 'super-admin',
  tenantId: DEFAULT_TENANT_ID,
};

/**
 * Check if auth is disabled (development mode)
 */
function isAuthDisabled(): boolean {
  return process.env.AUTH_DISABLED === 'true';
}

/**
 * Header used by super-admins to impersonate another tenant. When
 * present and the caller's role is `super-admin`, every downstream
 * Prisma query inside the request runs as if the caller belonged to
 * the named tenant. Non-super-admin callers setting the header are
 * silently ignored (we never 403 — server treats it as no-op so we
 * don't leak information about which tenants exist).
 *
 * Intentionally minimal for "future troubleshooting" — the real
 * impersonation flow with ComplianceLog entries + short-lived tokens
 * lives in TASK-160.
 */
const IMPERSONATE_HEADER = 'x-impersonate-tenant';

/**
 * Continue the request chain inside a tenant-scoped AsyncLocalStorage
 * if multi-tenancy is enabled. Pulls tenantId from `req.user` (set by
 * the caller), falling back to DEFAULT for dev/AUTH_DISABLED and for
 * users whose token predates the multi-tenancy upgrade.
 *
 * Super-admins can override the tenant for the duration of a single
 * request via the `x-impersonate-tenant` header. Every other role
 * sees its own tenantId regardless of what the header says.
 */
function continueWithTenant(
  req: Request,
  user: AuthUser | undefined,
  next: NextFunction
): void {
  if (!MULTI_TENANCY_ENABLED) {
    return next();
  }

  let tenantId = user?.tenantId ?? DEFAULT_TENANT_ID;
  if (user?.role === 'super-admin') {
    const override = req.headers[IMPERSONATE_HEADER];
    if (typeof override === 'string' && override.length > 0) {
      tenantId = override;
    }
  }

  tenantStore.run({ tenantId }, () => next());
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Authentication middleware - requires valid JWT
 *
 * When AUTH_DISABLED=true, injects mock user and allows all requests.
 * Otherwise, validates JWT from Authorization header.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip auth in development mode
  if (isAuthDisabled()) {
    req.user = MOCK_USER;
    return continueWithTenant(req, req.user, next);
  }

  // Extract token
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'No authentication token provided',
    });
    return;
  }

  // Service-account token path (TASK-165)
  if (token.startsWith('ndsa_')) {
    const result = await authenticateServiceToken(token);
    if (!result) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired API token',
      });
      return;
    }
    req.user = {
      id: result.userId,
      email: result.email,
      name: result.name,
      role: result.role as UserRole,
      tenantId: result.tenantId,
      authType: 'service',
      tokenId: result.tokenId,
    };
    return continueWithTenant(req, req.user, next);
  }

  // JWT path
  const payload = authService.verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
    return;
  }

  // Attach user to request
  req.user = {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    role: payload.role as AuthUser['role'],
    tenantId: payload.tenantId ?? null,
    authType: 'human',
  };

  continueWithTenant(req, req.user, next);
}

/**
 * Optional authentication middleware
 *
 * Attaches user if valid token is present, but allows request without token.
 * Useful for endpoints that behave differently for authenticated users.
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip auth in development mode
  if (isAuthDisabled()) {
    req.user = MOCK_USER;
    return continueWithTenant(req, req.user, next);
  }

  // Extract token
  const token = extractBearerToken(req);
  if (!token) {
    return continueWithTenant(req, undefined, next);
  }

  // Service-account token path (TASK-165)
  if (token.startsWith('ndsa_')) {
    const result = await authenticateServiceToken(token);
    if (result) {
      req.user = {
        id: result.userId,
        email: result.email,
        name: result.name,
        role: result.role as UserRole,
        tenantId: result.tenantId,
        authType: 'service',
        tokenId: result.tokenId,
      };
    }
    return continueWithTenant(req, req.user, next);
  }

  // JWT path
  const payload = authService.verifyAccessToken(token);
  if (payload) {
    req.user = {
      id: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role as UserRole,
      tenantId: payload.tenantId ?? null,
      authType: 'human',
    };
  }

  continueWithTenant(req, req.user, next);
}

/**
 * Role-based authorization middleware
 *
 * Must be used after authMiddleware. Checks if user has one of the allowed roles.
 *
 * @param roles - Allowed roles for this endpoint
 */
export function roleMiddleware(...roles: UserRole[]): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Skip in development mode
    if (isAuthDisabled()) {
      return next();
    }

    // Ensure user is authenticated
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    // Check role
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}

/**
 * Platform super-admin only (TASK-162). `super-admin` users have
 * `tenantId = null` and access every tenant via impersonation (TASK-160).
 */
export const superAdminOnly = roleMiddleware('super-admin');

/**
 * Tenant owner or platform super-admin (TASK-162). Use for
 * tenant-admin operations like team management.
 */
export const ownerOnly = roleMiddleware('super-admin', 'owner');

/**
 * Member or above (TASK-162). Use for write/operate endpoints
 * that read-only viewers should not reach.
 */
export const memberOrAbove = roleMiddleware('super-admin', 'owner', 'member');

/**
 * Viewer or above (TASK-162). Equivalent to "any authenticated user"
 * but explicit about the intent.
 */
export const viewerOrAbove = roleMiddleware(
  'super-admin',
  'owner',
  'member',
  'viewer'
);

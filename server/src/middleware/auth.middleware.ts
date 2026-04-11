/**
 * @file auth.middleware.ts
 * @description Express middleware for JWT authentication
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { authService, type TokenPayload } from '../services/AuthService.js';
import { DEFAULT_TENANT_ID, MULTI_TENANCY_ENABLED } from '../config/features.js';
import { tenantStore } from './tenantContext.js';

/**
 * User info attached to authenticated requests
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer';
  /**
   * Multi-tenancy (TASK-155): tenant this user belongs to. Null for
   * legacy/unscoped users. Read by `withTenantContext` middleware.
   */
  tenantId: string | null;
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
  role: 'admin',
  tenantId: DEFAULT_TENANT_ID,
};

/**
 * Check if auth is disabled (development mode)
 */
function isAuthDisabled(): boolean {
  return process.env.AUTH_DISABLED === 'true';
}

/**
 * Continue the request chain inside a tenant-scoped AsyncLocalStorage
 * if multi-tenancy is enabled. Pulls tenantId from `req.user` (set by
 * the caller), falling back to DEFAULT for dev/AUTH_DISABLED and for
 * users whose token predates the multi-tenancy upgrade.
 */
function continueWithTenant(user: AuthUser | undefined, next: NextFunction): void {
  if (!MULTI_TENANCY_ENABLED) {
    return next();
  }
  const tenantId = user?.tenantId ?? DEFAULT_TENANT_ID;
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
export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Skip auth in development mode
  if (isAuthDisabled()) {
    req.user = MOCK_USER;
    return continueWithTenant(req.user, next);
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

  // Verify token
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
  };

  continueWithTenant(req.user, next);
}

/**
 * Optional authentication middleware
 *
 * Attaches user if valid token is present, but allows request without token.
 * Useful for endpoints that behave differently for authenticated users.
 */
export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Skip auth in development mode
  if (isAuthDisabled()) {
    req.user = MOCK_USER;
    return continueWithTenant(req.user, next);
  }

  // Extract token
  const token = extractBearerToken(req);
  if (!token) {
    return continueWithTenant(undefined, next);
  }

  // Verify token
  const payload = authService.verifyAccessToken(token);
  if (payload) {
    req.user = {
      id: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role as AuthUser['role'],
      tenantId: payload.tenantId ?? null,
    };
  }

  continueWithTenant(req.user, next);
}

/**
 * Role-based authorization middleware
 *
 * Must be used after authMiddleware. Checks if user has one of the allowed roles.
 *
 * @param roles - Allowed roles for this endpoint
 */
export function roleMiddleware(
  ...roles: Array<'admin' | 'operator' | 'viewer'>
): RequestHandler {
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
 * Admin-only middleware
 */
export const adminOnly = roleMiddleware('admin');

/**
 * Operator or admin middleware
 */
export const operatorOrAdmin = roleMiddleware('admin', 'operator');

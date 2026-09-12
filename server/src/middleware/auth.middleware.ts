/**
 * @file auth.middleware.ts
 * @description Express middleware for JWT authentication
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { authService, type TokenPayload } from '../services/AuthService.js';
import { authenticateServiceToken } from '../services/ServiceAccountService.js';
import { DEFAULT_TENANT_ID, MULTI_TENANCY_ENABLED } from '../config/features.js';
import { tenantStore } from './tenantContext.js';
import { complianceLogService } from '../services/ComplianceLogService.js';
import { verifyCameraTicket } from '../security/cameraTicket.js';

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
    if (typeof override === 'string' && override.length > 0 && override !== tenantId) {
      // Fire-and-forget compliance log (EU AI Act Art. 12)
      complianceLogService.logSystemEvent({
        sessionId: `impersonation-${user.id}`,
        robotId: 'platform',
        payload: {
          description: `Super-admin impersonated tenant ${override}`,
          eventName: 'tenant_impersonation',
          component: 'auth',
          metadata: {
            actorId: user.id,
            actorEmail: user.email,
            originalTenantId: tenantId,
            impersonatedTenantId: override,
          },
        },
      }).catch(() => {}); // Best-effort, never block requests
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
 * Paths, relative to the `/api/robots` mount, that serve an MJPEG stream.
 * `/:id/camera/:name` and nothing else.
 */
const CAMERA_STREAM_PATH = /^\/([^/]+)\/camera\/([^/]+)\/?$/;

/**
 * Marks a request whose identity came from a camera ticket rather than a
 * bearer token. A module-private symbol, so nothing that arrives over the wire
 * can set it: a header or body field named `cameraTicketAuthenticated` would
 * otherwise be an authentication bypass in a string.
 */
const TICKET_AUTHENTICATED = Symbol('cameraTicketAuthenticated');

/**
 * Authenticate a camera stream from a `?ticket=` in its URL (TASK-214).
 *
 * WHY A QUERY PARAMETER AT ALL: `/api/robots/:id/camera/:name` is rendered in
 * an `<img>` — the only way a page can show `multipart/x-mixed-replace` — and
 * an `<img>` cannot set an `Authorization` header, which is the only place
 * `extractBearerToken` looks. Without something in the URL, every camera frame
 * is a 401 the moment auth is enabled.
 *
 * WHAT CHANGED: this used to promote `?access_token=` into the header, so the
 * user's real access token sat in a URL — valid everywhere, for its whole
 * lifetime, in the one place URLs are logged and proxied. It now accepts a
 * ticket instead, which opens one camera on one robot for two minutes and
 * authorises nothing else (see `security/cameraTicket.ts`).
 *
 * STILL DELIBERATELY NARROW — the three guards are unchanged: GET only, the
 * stream path only, and never when a real Authorization header was supplied.
 * The ticket must additionally name the robot AND the camera in the path it
 * arrived on, so a ticket for one camera cannot open another.
 *
 * A ticket is not a bearer credential, so this cannot hand `authMiddleware`
 * something to validate — it establishes the identity itself and marks the
 * request. `authMiddleware` honours the mark and does the tenant hand-off, so
 * a ticketed stream runs inside exactly the same row-level isolation as the
 * request that asked for the ticket.
 */
export function cameraStreamTicket(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (req.method !== 'GET' || req.headers.authorization) return next();
  const match = CAMERA_STREAM_PATH.exec(req.path);
  if (!match) return next();

  const claims = verifyCameraTicket(req.query.ticket);
  // A bad ticket is not refused here: it is simply not an identity. The request
  // falls through to `authMiddleware`, which answers the same 401 it answers
  // for anything else unauthenticated — one rejection path, not two.
  if (!claims) return next();

  // Express has already decoded the path segments; the ticket carries the raw
  // ids, so compare decoded against raw. A malformed escape (`%zz`) throws here
  // rather than mismatching, and an uncaught throw would turn what should be a
  // 401 into a 500 — so it falls through to `authMiddleware` like any other
  // ticket that does not name this path.
  let robotId: string;
  let cameraName: string;
  try {
    robotId = decodeURIComponent(match[1]);
    cameraName = decodeURIComponent(match[2]);
  } catch {
    return next();
  }
  if (claims.robotId !== robotId || claims.cameraName !== cameraName) return next();

  req.user = {
    id: claims.userId,
    email: '',
    name: '',
    role: claims.role as AuthUser['role'],
    tenantId: claims.tenantId,
    authType: 'human',
  };
  (req as AuthenticatedRequest & { [TICKET_AUTHENTICATED]?: boolean })[TICKET_AUTHENTICATED] = true;
  next();
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

  // A camera stream that presented a valid ticket is already identified
  // (`cameraStreamTicket`, mounted immediately before this). The mark is a
  // module-private symbol, so this is not reachable by setting a field.
  if ((req as AuthenticatedRequest & { [TICKET_AUTHENTICATED]?: boolean })[TICKET_AUTHENTICATED]) {
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

/**
 * The verbs `writeRoleGuard` inspects. Everything else — GET, HEAD, OPTIONS —
 * is a read and passes straight through, which is what keeps the
 * ticket-authenticated MJPEG stream on `/api/robots/:id/camera/:name` working.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Write paths a `viewer` may still reach, matched against the full request
 * path (TASK-282). Every entry is a self-service action a user performs on
 * their own account or their own personal data — never on a robot, a fleet
 * object, or another person.
 *
 * This is the only hole in `writeRoleGuard`, so keep it minimal and keep every
 * entry anchored: a loose pattern here is a privilege escalation. An entry that
 * matches no live route fails `__tests__/write-route-authorization.test.ts`,
 * so a stale exemption cannot sit here unnoticed.
 *
 * TASK-283 classified all 349 write verbs against this bar. The decisions that
 * were close enough to be worth recording, all of them resolved as
 * member-or-above rather than exempt:
 *
 * - **Password change and MFA enrolment on a live session** — genuinely
 *   self-service, but they live on `/api/auth`, which is an unauthenticated
 *   mount and never reaches this guard. No entry needed; adding one would open
 *   a hole for no gain.
 * - **Alert acknowledgement** (`PATCH /api/alerts/:id/acknowledge`) and the
 *   oversight/patrol acknowledgements — these clear a fleet-wide signal for
 *   everyone, not a personal notification. Member.
 * - **Contribution submission** (`POST /api/contributions`, `/:id/submit`,
 *   `/:id/upload`) — a contribution donates robot data into the platform and is
 *   reviewed by an owner (`contributions.routes.ts` already gates the approval
 *   half with `ownerOnly`). Donating is an operator act, not a personal one.
 * - **`/api/gdpr/admin/*`** — acts on other people's requests. Member, and the
 *   one-segment anchoring below is what keeps it out.
 */
export const SELF_SERVICE_WRITES: RegExp[] = [
  // PUT /api/settings — a viewer's own theme and UI preferences.
  /^\/api\/settings\/?$/,
  // POST /api/settings/reset — those same preferences, back to defaults.
  /^\/api\/settings\/reset\/?$/,
  // POST /api/gdpr/requests/* and DELETE /api/gdpr/requests/:id — data-subject
  // rights (GDPR Art. 15-22), which a viewer must be able to exercise over
  // their own data and withdraw again. One segment only, so this never reaches
  // /api/gdpr/admin/*, which acts on other people's requests.
  /^\/api\/gdpr\/requests\/[^/]+\/?$/,
  // POST /api/gdpr/consents and DELETE /api/gdpr/consents/:type — a viewer
  // granting and withdrawing consent for their own data.
  /^\/api\/gdpr\/consents(?:\/[^/]+)?\/?$/,
];

/**
 * Endpoints that are registered as POST but perform no write at all (TASK-283).
 *
 * A handful of endpoints are POSTs only because they need a request body, not
 * because they change anything. Most of them still ended up member-or-above —
 * a viewer losing `POST /api/datasets/compatibility` is a small, reversible
 * cost, and keeping the exception list short matters more. This list is for the
 * ones where the opposite answer is already recorded as a product decision.
 *
 * The bar is strictly narrower than it looks: the handler must be a pure
 * function of its request body — no repository call, no tenant row, nothing
 * persisted — so that granting it to a viewer grants no more than a GET would.
 * Anything that reads data belongs on a GET; anything that writes belongs
 * behind the guard.
 *
 * Keep every entry anchored, and keep the reason attached to it. A stale entry
 * fails `__tests__/write-route-authorization.test.ts`, which requires each one
 * to match a live route.
 */
export const POST_SHAPED_READS: RegExp[] = [
  // POST /api/patrol/cron/validate — parses a cron expression and returns the
  // next five fire times (`patrol.routes.ts:106`). It is a calculator: no
  // service call that touches storage, no patrol route involved, nothing saved.
  // A viewer plans a schedule in the UI before asking a member to save it, so
  // `field-operations-role-routing.test.ts` asserts a viewer gets 200 here —
  // that test is the recorded decision this entry honours.
  /^\/api\/patrol\/cron\/validate\/?$/,
];

/**
 * Require `member` or above for any write on the mount it guards (TASK-282).
 *
 * Mounted as an extra handler *after* `authMiddleware` on each protected mount
 * — see `app.ts`. There is deliberately no `app.use('/api', writeRoleGuard)`
 * chokepoint: Express runs middleware in mount order, so a guard registered
 * before the routers would see no `req.user`, and one registered after them
 * would never run at all. The enumeration test, not this comment, is what
 * holds the mount list down.
 *
 * Reads pass through untouched. Writes are delegated to `memberOrAbove`, which
 * owns the single 403 response body — this must never answer a second one.
 */
export function writeRoleGuard(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Dev bypass, identical to every other layer: keeps AUTH_DISABLED=true
  // deployments and the existing route suites behaving exactly as before.
  if (isAuthDisabled()) {
    return next();
  }

  if (!WRITE_METHODS.has(req.method)) {
    return next();
  }

  // `req.path` is mount-relative inside a mounted middleware, so it would read
  // `/:id/command` here and match none of the absolute patterns above.
  const path = req.originalUrl.split('?')[0];
  if (SELF_SERVICE_WRITES.some((pattern) => pattern.test(path))) {
    return next();
  }
  // Registered as a write, performs none — see `POST_SHAPED_READS`.
  if (POST_SHAPED_READS.some((pattern) => pattern.test(path))) {
    return next();
  }

  memberOrAbove(req, res, next);
}

/**
 * @file auth.middleware.test.ts
 * @description Unit tests for the JWT/service-account Express auth middleware:
 *   authMiddleware, optionalAuthMiddleware, roleMiddleware, and the
 *   pre-bound role guards (superAdminOnly/ownerOnly/memberOrAbove/viewerOrAbove).
 *   Mocks only the external boundaries (AuthService, ServiceAccountService,
 *   ComplianceLogService, feature flags); lets the real tenant ALS run.
 * @feature auth
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mocked boundaries (vi.hoisted so they exist before module init)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  authenticateServiceToken: vi.fn(),
  logSystemEvent: vi.fn(),
  // Mutable feature-flag state, read via getters in the mock factory.
  multiTenancyEnabled: false,
}));

vi.mock('../../services/AuthService.js', () => ({
  authService: {
    verifyAccessToken: mocks.verifyAccessToken,
  },
}));

vi.mock('../../services/ServiceAccountService.js', () => ({
  authenticateServiceToken: mocks.authenticateServiceToken,
}));

vi.mock('../../services/ComplianceLogService.js', () => ({
  complianceLogService: {
    logSystemEvent: mocks.logSystemEvent,
  },
}));

vi.mock('../../config/features.js', () => ({
  get MULTI_TENANCY_ENABLED() {
    return mocks.multiTenancyEnabled;
  },
  DEFAULT_TENANT_ID: 'default',
}));

import {
  authMiddleware,
  optionalAuthMiddleware,
  roleMiddleware,
  superAdminOnly,
  ownerOnly,
  memberOrAbove,
  viewerOrAbove,
  type AuthenticatedRequest,
  type AuthUser,
} from '../auth.middleware.js';
import { getTenantId } from '../tenantContext.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeRes {
  status: Mock;
  json: Mock;
  set: Mock;
  end: Mock;
}

function makeReq(
  overrides: Partial<AuthenticatedRequest> = {}
): AuthenticatedRequest {
  return {
    headers: {},
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function makeRes(): Response & FakeRes {
  const res: Partial<FakeRes> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res as unknown as Response & FakeRes;
}

function makeNext(): NextFunction & Mock {
  return vi.fn() as unknown as NextFunction & Mock;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.multiTenancyEnabled = false;
  mocks.logSystemEvent.mockResolvedValue(undefined);
  delete process.env.AUTH_DISABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ===========================================================================
// authMiddleware
// ===========================================================================

describe('authMiddleware', () => {
  describe('AUTH_DISABLED bypass', () => {
    it('injects the mock super-admin user and calls next() without a token', async () => {
      process.env.AUTH_DISABLED = 'true';
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(req.user).toMatchObject({
        id: 'dev-user-id',
        email: 'dev@neodem.local',
        role: 'super-admin',
        tenantId: 'default',
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('does not bypass when AUTH_DISABLED is set to a non-"true" value', async () => {
      process.env.AUTH_DISABLED = 'false';
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      // No token -> 401, no mock user
      expect(req.user).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('missing / malformed token', () => {
    it('rejects with 401 when no Authorization header is present', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'No authentication token provided',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the header does not start with "Bearer "', async () => {
      const req = makeReq({ headers: { authorization: 'Token abc' } as any });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('JWT path', () => {
    it('attaches the human user and calls next() for a valid token', async () => {
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'owner',
        tenantId: 'tenant-a',
      });
      const req = makeReq({ headers: { authorization: 'Bearer good.jwt' } as any });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(mocks.verifyAccessToken).toHaveBeenCalledWith('good.jwt');
      expect(req.user).toEqual({
        id: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'owner',
        tenantId: 'tenant-a',
        authType: 'human',
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('defaults tenantId to null when the token omits it', async () => {
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'u2',
        email: 'c@d.com',
        name: 'Carol',
        role: 'member',
      });
      const req = makeReq({ headers: { authorization: 'Bearer t' } as any });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(req.user?.tenantId).toBeNull();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects with 401 when the token is invalid/expired (verify returns null)', async () => {
      mocks.verifyAccessToken.mockReturnValue(null);
      const req = makeReq({ headers: { authorization: 'Bearer bad' } as any });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      expect(req.user).toBeUndefined();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('service-account token path (ndsa_)', () => {
    it('attaches a service user and calls next() for a valid ndsa_ token', async () => {
      mocks.authenticateServiceToken.mockResolvedValue({
        userId: 'svc-1',
        email: 'svc@x.com',
        name: 'CI Bot',
        role: 'member',
        tenantId: 'tenant-b',
        tokenId: 'tok-9',
      });
      const req = makeReq({ headers: { authorization: 'Bearer ndsa_abc123' } as any });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(mocks.authenticateServiceToken).toHaveBeenCalledWith('ndsa_abc123');
      // JWT verification must NOT be attempted for service tokens.
      expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
      expect(req.user).toEqual({
        id: 'svc-1',
        email: 'svc@x.com',
        name: 'CI Bot',
        role: 'member',
        tenantId: 'tenant-b',
        authType: 'service',
        tokenId: 'tok-9',
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects with 401 when the service token is invalid (returns null)', async () => {
      mocks.authenticateServiceToken.mockResolvedValue(null);
      const req = makeReq({ headers: { authorization: 'Bearer ndsa_bad' } as any });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired API token',
      });
      expect(req.user).toBeUndefined();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('tenant context propagation (MULTI_TENANCY_ENABLED=true)', () => {
    it('runs next() inside the user tenant ALS scope', async () => {
      mocks.multiTenancyEnabled = true;
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'owner',
        tenantId: 'tenant-a',
      });
      const req = makeReq({ headers: { authorization: 'Bearer t' } as any });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await authMiddleware(req, res, next);

      expect(seen).toBe('tenant-a');
    });

    it('falls back to DEFAULT_TENANT_ID when the user has null tenantId', async () => {
      mocks.multiTenancyEnabled = true;
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'member',
        tenantId: null,
      });
      const req = makeReq({ headers: { authorization: 'Bearer t' } as any });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await authMiddleware(req, res, next);

      expect(seen).toBe('default');
    });

    it('does not establish a tenant scope when MULTI_TENANCY_ENABLED=false', async () => {
      mocks.multiTenancyEnabled = false;
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'owner',
        tenantId: 'tenant-a',
      });
      const req = makeReq({ headers: { authorization: 'Bearer t' } as any });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await authMiddleware(req, res, next);

      expect(seen).toBeUndefined();
    });
  });

  describe('super-admin impersonation header', () => {
    function superAdminToken() {
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'sa-1',
        email: 'sa@x.com',
        name: 'Super',
        role: 'super-admin',
        tenantId: null,
      });
    }

    it('overrides tenant scope and logs a compliance event for super-admins', async () => {
      mocks.multiTenancyEnabled = true;
      superAdminToken();
      const req = makeReq({
        headers: {
          authorization: 'Bearer t',
          'x-impersonate-tenant': 'victim-tenant',
        } as any,
      });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await authMiddleware(req, res, next);

      expect(seen).toBe('victim-tenant');
      expect(mocks.logSystemEvent).toHaveBeenCalledTimes(1);
      const arg = mocks.logSystemEvent.mock.calls[0][0];
      expect(arg.payload.eventName).toBe('tenant_impersonation');
      expect(arg.payload.metadata.impersonatedTenantId).toBe('victim-tenant');
      expect(arg.payload.metadata.actorId).toBe('sa-1');
    });

    it('ignores the impersonation header for non-super-admin roles (no log)', async () => {
      mocks.multiTenancyEnabled = true;
      mocks.verifyAccessToken.mockReturnValue({
        userId: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'owner',
        tenantId: 'tenant-a',
      });
      const req = makeReq({
        headers: {
          authorization: 'Bearer t',
          'x-impersonate-tenant': 'victim-tenant',
        } as any,
      });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await authMiddleware(req, res, next);

      expect(seen).toBe('tenant-a');
      expect(mocks.logSystemEvent).not.toHaveBeenCalled();
    });

    it('does not impersonate (or log) when the header equals the current tenant', async () => {
      mocks.multiTenancyEnabled = true;
      // super-admin with tenantId null resolves to DEFAULT_TENANT_ID = 'default'
      superAdminToken();
      const req = makeReq({
        headers: {
          authorization: 'Bearer t',
          'x-impersonate-tenant': 'default',
        } as any,
      });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await authMiddleware(req, res, next);

      expect(seen).toBe('default');
      expect(mocks.logSystemEvent).not.toHaveBeenCalled();
    });

    it('does not log when the impersonation header is empty', async () => {
      mocks.multiTenancyEnabled = true;
      superAdminToken();
      const req = makeReq({
        headers: {
          authorization: 'Bearer t',
          'x-impersonate-tenant': '',
        } as any,
      });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(mocks.logSystemEvent).not.toHaveBeenCalled();
    });

    it('survives a rejected compliance log (best-effort fire-and-forget)', async () => {
      mocks.multiTenancyEnabled = true;
      superAdminToken();
      mocks.logSystemEvent.mockRejectedValueOnce(new Error('db down'));
      const req = makeReq({
        headers: {
          authorization: 'Bearer t',
          'x-impersonate-tenant': 'victim-tenant',
        } as any,
      });
      const res = makeRes();
      let seen: string | undefined;
      const next = vi.fn(() => {
        seen = getTenantId();
      }) as unknown as NextFunction;

      await expect(
        authMiddleware(req, res, next)
      ).resolves.toBeUndefined();
      expect(seen).toBe('victim-tenant');
    });
  });
});

// ===========================================================================
// optionalAuthMiddleware
// ===========================================================================

describe('optionalAuthMiddleware', () => {
  it('injects the mock user under AUTH_DISABLED', async () => {
    process.env.AUTH_DISABLED = 'true';
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user?.id).toBe('dev-user-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the request through with no user when no token is present', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('attaches a human user for a valid JWT', async () => {
    mocks.verifyAccessToken.mockReturnValue({
      userId: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      role: 'viewer',
      tenantId: 'tenant-a',
    });
    const req = makeReq({ headers: { authorization: 'Bearer t' } as any });
    const res = makeRes();
    const next = makeNext();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toMatchObject({ id: 'u1', authType: 'human' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('proceeds without a user (no 401) when the JWT is invalid', async () => {
    mocks.verifyAccessToken.mockReturnValue(null);
    const req = makeReq({ headers: { authorization: 'Bearer bad' } as any });
    const res = makeRes();
    const next = makeNext();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('attaches a service user for a valid ndsa_ token', async () => {
    mocks.authenticateServiceToken.mockResolvedValue({
      userId: 'svc-1',
      email: 'svc@x.com',
      name: 'CI Bot',
      role: 'member',
      tenantId: 'tenant-b',
      tokenId: 'tok-9',
    });
    const req = makeReq({ headers: { authorization: 'Bearer ndsa_ok' } as any });
    const res = makeRes();
    const next = makeNext();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toMatchObject({ id: 'svc-1', authType: 'service' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('proceeds without a user when the ndsa_ token is invalid (no 401)', async () => {
    mocks.authenticateServiceToken.mockResolvedValue(null);
    const req = makeReq({ headers: { authorization: 'Bearer ndsa_bad' } as any });
    const res = makeRes();
    const next = makeNext();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// roleMiddleware + pre-bound guards
// ===========================================================================

describe('roleMiddleware', () => {
  it('bypasses the role check entirely under AUTH_DISABLED', () => {
    process.env.AUTH_DISABLED = 'true';
    const mw = roleMiddleware('super-admin');
    const req = makeReq(); // no user
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 401 when there is no authenticated user', () => {
    const mw = roleMiddleware('owner');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the user role is not allowed', () => {
    const mw = roleMiddleware('owner', 'super-admin');
    const req = makeReq({ user: { role: 'viewer' } as AuthUser });
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Insufficient permissions',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the user role is allowed', () => {
    const mw = roleMiddleware('owner', 'super-admin');
    const req = makeReq({ user: { role: 'owner' } as AuthUser });
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('pre-bound role guards', () => {
  const cases: Array<{
    name: string;
    guard: ReturnType<typeof roleMiddleware>;
    allowed: AuthUser['role'][];
    denied: AuthUser['role'][];
  }> = [
    {
      name: 'superAdminOnly',
      guard: superAdminOnly,
      allowed: ['super-admin'],
      denied: ['owner', 'member', 'viewer'],
    },
    {
      name: 'ownerOnly',
      guard: ownerOnly,
      allowed: ['super-admin', 'owner'],
      denied: ['member', 'viewer'],
    },
    {
      name: 'memberOrAbove',
      guard: memberOrAbove,
      allowed: ['super-admin', 'owner', 'member'],
      denied: ['viewer'],
    },
    {
      name: 'viewerOrAbove',
      guard: viewerOrAbove,
      allowed: ['super-admin', 'owner', 'member', 'viewer'],
      denied: [],
    },
  ];

  for (const { name, guard, allowed, denied } of cases) {
    for (const role of allowed) {
      it(`${name} allows role "${role}"`, () => {
        const req = makeReq({ user: { role } as AuthUser });
        const res = makeRes();
        const next = makeNext();
        guard(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });
    }
    for (const role of denied) {
      it(`${name} denies role "${role}" with 403`, () => {
        const req = makeReq({ user: { role } as AuthUser });
        const res = makeRes();
        const next = makeNext();
        guard(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      });
    }
  }
});

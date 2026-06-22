/**
 * @file service-accounts-routes.test.ts
 * @description Integration tests for service account + API token routes (TASK-165)
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting.
const { mockServiceAccountService } = vi.hoisted(() => ({
  mockServiceAccountService: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    listTokens: vi.fn(),
    createToken: vi.fn(),
    rotateToken: vi.fn(),
    revokeToken: vi.fn(),
  },
}));

// Mock the service module but keep the REAL error classes so the route's
// `instanceof` checks still work. Only the singleton is swapped out.
vi.mock('../services/ServiceAccountService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../services/ServiceAccountService.js')
  >('../services/ServiceAccountService.js');
  return {
    ...actual,
    serviceAccountService: mockServiceAccountService,
  };
});

// Mock auth middleware: both authMiddleware (mount) and ownerOnly (router.use)
// must be pass-throughs that inject a req.user with a tenantId.
vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-123',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
      tenantId: 'tenant-1',
    };
    next();
  },
  ownerOnly: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import { serviceAccountRoutes } from '../routes/service-accounts.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  InvalidServiceRoleError,
  ServiceAccountNotFoundError,
  TokenNotFoundError,
  DuplicateNameError,
  DuplicateTokenNameError,
} from '../services/ServiceAccountService.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/team/service-accounts', authMiddleware as any, serviceAccountRoutes);
  return app;
}

// App variant whose authMiddleware injects a user WITHOUT a tenantId,
// to exercise the "Caller has no tenantId" 400 branches.
function createAppNoTenant() {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/team/service-accounts',
    (req: any, _res: any, next: any) => {
      req.user = { id: 'user-123', email: 'o@e.com', name: 'O', role: 'owner' };
      next();
    },
    serviceAccountRoutes
  );
  return app;
}

const SA = {
  id: 'sa-1',
  name: 'CI Bot',
  role: 'member',
  tenantId: 'tenant-1',
  createdAt: '2026-06-23T00:00:00.000Z',
};

describe('Service Account Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET / — list service accounts
  // --------------------------------------------------------------------------

  describe('GET /api/team/service-accounts', () => {
    it('returns the list of service accounts', async () => {
      mockServiceAccountService.list.mockResolvedValue([SA]);

      const response = await request(app).get('/api/team/service-accounts');

      expect(response.status).toBe(200);
      expect(response.body.accounts).toHaveLength(1);
      expect(response.body.accounts[0].id).toBe('sa-1');
      expect(mockServiceAccountService.list).toHaveBeenCalledWith('tenant-1');
    });

    it('returns 400 when caller has no tenantId', async () => {
      const noTenantApp = createAppNoTenant();

      const response = await request(noTenantApp).get('/api/team/service-accounts');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Caller has no tenantId');
      expect(mockServiceAccountService.list).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockServiceAccountService.list.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/team/service-accounts');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // POST / — create a service account
  // --------------------------------------------------------------------------

  describe('POST /api/team/service-accounts', () => {
    it('creates a service account', async () => {
      mockServiceAccountService.create.mockResolvedValue(SA);

      const response = await request(app)
        .post('/api/team/service-accounts')
        .send({ name: '  CI Bot  ', role: 'member' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('sa-1');
      expect(mockServiceAccountService.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        name: 'CI Bot',
        role: 'member',
        actorId: 'user-123',
      });
    });

    it('returns 400 when caller has no tenantId', async () => {
      const noTenantApp = createAppNoTenant();

      const response = await request(noTenantApp)
        .post('/api/team/service-accounts')
        .send({ name: 'CI Bot', role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Caller has no tenantId');
      expect(mockServiceAccountService.create).not.toHaveBeenCalled();
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/team/service-accounts')
        .send({ role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name and role are required');
      expect(mockServiceAccountService.create).not.toHaveBeenCalled();
    });

    it('returns 400 when role is missing', async () => {
      const response = await request(app)
        .post('/api/team/service-accounts')
        .send({ name: 'CI Bot' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name and role are required');
    });

    it('returns 400 for invalid service role', async () => {
      mockServiceAccountService.create.mockRejectedValue(
        new InvalidServiceRoleError('owner')
      );

      const response = await request(app)
        .post('/api/team/service-accounts')
        .send({ name: 'CI Bot', role: 'owner' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid service account role');
    });

    it('returns 409 for duplicate name', async () => {
      mockServiceAccountService.create.mockRejectedValue(
        new DuplicateNameError('CI Bot')
      );

      const response = await request(app)
        .post('/api/team/service-accounts')
        .send({ name: 'CI Bot', role: 'member' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already exists');
    });

    it('returns 400 on unexpected service error', async () => {
      mockServiceAccountService.create.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/team/service-accounts')
        .send({ name: 'CI Bot', role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /:id — soft-delete a service account
  // --------------------------------------------------------------------------

  describe('DELETE /api/team/service-accounts/:id', () => {
    it('deletes a service account', async () => {
      mockServiceAccountService.delete.mockResolvedValue(undefined);

      const response = await request(app).delete('/api/team/service-accounts/sa-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockServiceAccountService.delete).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        serviceAccountId: 'sa-1',
        actorId: 'user-123',
      });
    });

    it('returns 400 when caller has no tenantId', async () => {
      const noTenantApp = createAppNoTenant();

      const response = await request(noTenantApp).delete(
        '/api/team/service-accounts/sa-1'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Caller has no tenantId');
      expect(mockServiceAccountService.delete).not.toHaveBeenCalled();
    });

    it('returns 404 when service account not found', async () => {
      mockServiceAccountService.delete.mockRejectedValue(
        new ServiceAccountNotFoundError()
      );

      const response = await request(app).delete('/api/team/service-accounts/sa-x');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Service account not found');
    });

    it('returns 400 on unexpected service error', async () => {
      mockServiceAccountService.delete.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/team/service-accounts/sa-1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // GET /:id/tokens — list tokens
  // --------------------------------------------------------------------------

  describe('GET /api/team/service-accounts/:id/tokens', () => {
    it('lists tokens for a service account', async () => {
      const tokens = [{ id: 'tok-1', name: 'default' }];
      mockServiceAccountService.listTokens.mockResolvedValue(tokens);

      const response = await request(app).get(
        '/api/team/service-accounts/sa-1/tokens'
      );

      expect(response.status).toBe(200);
      expect(response.body.tokens).toHaveLength(1);
      expect(response.body.tokens[0].id).toBe('tok-1');
      expect(mockServiceAccountService.listTokens).toHaveBeenCalledWith('sa-1');
    });

    it('returns 500 on service error', async () => {
      mockServiceAccountService.listTokens.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(
        '/api/team/service-accounts/sa-1/tokens'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // POST /:id/tokens — mint a token
  // --------------------------------------------------------------------------

  describe('POST /api/team/service-accounts/:id/tokens', () => {
    it('mints a new token', async () => {
      const result = { id: 'tok-1', token: 'secret', name: 'default' };
      mockServiceAccountService.createToken.mockResolvedValue(result);

      const response = await request(app)
        .post('/api/team/service-accounts/sa-1/tokens')
        .send({ name: '  default  ', expiresInDays: 30 });

      expect(response.status).toBe(201);
      expect(response.body.token).toBe('secret');
      expect(mockServiceAccountService.createToken).toHaveBeenCalledWith({
        serviceAccountId: 'sa-1',
        name: 'default',
        expiresInDays: 30,
        actorId: 'user-123',
      });
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/team/service-accounts/sa-1/tokens')
        .send({ expiresInDays: 30 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name is required');
      expect(mockServiceAccountService.createToken).not.toHaveBeenCalled();
    });

    it('returns 404 when service account not found', async () => {
      mockServiceAccountService.createToken.mockRejectedValue(
        new ServiceAccountNotFoundError()
      );

      const response = await request(app)
        .post('/api/team/service-accounts/sa-x/tokens')
        .send({ name: 'default' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Service account not found');
    });

    it('returns 409 for duplicate token name', async () => {
      mockServiceAccountService.createToken.mockRejectedValue(
        new DuplicateTokenNameError('default')
      );

      const response = await request(app)
        .post('/api/team/service-accounts/sa-1/tokens')
        .send({ name: 'default' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already exists');
    });

    it('returns 400 on unexpected service error', async () => {
      mockServiceAccountService.createToken.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/team/service-accounts/sa-1/tokens')
        .send({ name: 'default' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // POST /:id/tokens/:tokenId/rotate — rotate a token
  // --------------------------------------------------------------------------

  describe('POST /api/team/service-accounts/:id/tokens/:tokenId/rotate', () => {
    it('rotates a token', async () => {
      const result = { id: 'tok-1', token: 'rotated-secret' };
      mockServiceAccountService.rotateToken.mockResolvedValue(result);

      const response = await request(app).post(
        '/api/team/service-accounts/sa-1/tokens/tok-1/rotate'
      );

      expect(response.status).toBe(200);
      expect(response.body.token).toBe('rotated-secret');
      expect(mockServiceAccountService.rotateToken).toHaveBeenCalledWith({
        tokenId: 'tok-1',
        serviceAccountId: 'sa-1',
        actorId: 'user-123',
      });
    });

    it('returns 404 when token not found', async () => {
      mockServiceAccountService.rotateToken.mockRejectedValue(
        new TokenNotFoundError()
      );

      const response = await request(app).post(
        '/api/team/service-accounts/sa-1/tokens/tok-x/rotate'
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('API token not found');
    });

    it('returns 400 on unexpected service error', async () => {
      mockServiceAccountService.rotateToken.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(
        '/api/team/service-accounts/sa-1/tokens/tok-1/rotate'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /:id/tokens/:tokenId — revoke a token
  // --------------------------------------------------------------------------

  describe('DELETE /api/team/service-accounts/:id/tokens/:tokenId', () => {
    it('revokes a token', async () => {
      const result = { id: 'tok-1', revokedAt: '2026-06-23T00:00:00.000Z' };
      mockServiceAccountService.revokeToken.mockResolvedValue(result);

      const response = await request(app).delete(
        '/api/team/service-accounts/sa-1/tokens/tok-1'
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('tok-1');
      expect(mockServiceAccountService.revokeToken).toHaveBeenCalledWith({
        tokenId: 'tok-1',
        serviceAccountId: 'sa-1',
        actorId: 'user-123',
      });
    });

    it('returns 404 when token not found', async () => {
      mockServiceAccountService.revokeToken.mockRejectedValue(
        new TokenNotFoundError()
      );

      const response = await request(app).delete(
        '/api/team/service-accounts/sa-1/tokens/tok-x'
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('API token not found');
    });

    it('returns 400 on unexpected service error', async () => {
      mockServiceAccountService.revokeToken.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete(
        '/api/team/service-accounts/sa-1/tokens/tok-1'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });
});

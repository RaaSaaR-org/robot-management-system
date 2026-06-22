/**
 * @file tenants-routes.test.ts
 * @description Integration tests for tenant (Organization) management routes
 * @feature multi-tenancy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects/classes are available before vi.mock hoisting
const {
  mockTenantService,
  TenantNotEmptyError,
  TenantSlugTakenError,
  mockGetTenantId,
} = vi.hoisted(() => {
  class TenantNotEmptyError extends Error {
    counts: { users: number; robots: number; datasets: number; trainingJobs: number };
    constructor(counts: { users: number; robots: number; datasets: number; trainingJobs: number }) {
      super('Tenant is not empty');
      this.name = 'TenantNotEmptyError';
      this.counts = counts;
    }
  }
  class TenantSlugTakenError extends Error {
    constructor(slug: string) {
      super(`Slug "${slug}" is already in use`);
      this.name = 'TenantSlugTakenError';
    }
  }
  return {
    mockTenantService: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      onboard: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    TenantNotEmptyError,
    TenantSlugTakenError,
    mockGetTenantId: vi.fn(),
  };
});

vi.mock('../services/TenantService.js', () => ({
  tenantService: mockTenantService,
  TenantNotEmptyError,
  TenantSlugTakenError,
}));

vi.mock('../middleware/tenantContext.js', () => ({
  getTenantId: mockGetTenantId,
}));

vi.mock('../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: false,
  DEFAULT_TENANT_ID: 'default',
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test',
      role: 'admin',
      tenantId: 'tenant-from-user',
    };
    next();
  },
  // superAdminOnly is applied at route-level; mock it to pass through.
  superAdminOnly: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import { tenantsRoutes } from '../routes/tenants.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tenants', authMiddleware as any, tenantsRoutes);
  return app;
}

const TENANT = {
  id: 'tenant-001',
  slug: 'acme',
  name: 'Acme Corp',
  logoUrl: null,
  plan: 'pro',
  settings: '{}',
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
  isDefault: false,
  counts: { users: 1, robots: 0, datasets: 0, trainingJobs: 0 },
};

describe('Tenants Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantId.mockReturnValue(undefined);
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/tenants
  // --------------------------------------------------------------------------

  describe('GET /api/tenants', () => {
    it('lists all tenants', async () => {
      mockTenantService.list.mockResolvedValue([TENANT]);

      const response = await request(app).get('/api/tenants');

      expect(response.status).toBe(200);
      expect(response.body.tenants).toHaveLength(1);
      expect(response.body.tenants[0].name).toBe('Acme Corp');
      expect(mockTenantService.list).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockTenantService.list.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/tenants');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/tenants/current
  // --------------------------------------------------------------------------

  describe('GET /api/tenants/current', () => {
    it("returns the caller's tenant (falls back to user claim when MT off)", async () => {
      mockTenantService.get.mockResolvedValue(TENANT);

      const response = await request(app).get('/api/tenants/current');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Acme Corp');
      // MULTI_TENANCY_ENABLED is false, so it uses the user's tenantId claim
      expect(mockTenantService.get).toHaveBeenCalledWith('tenant-from-user');
    });

    it('returns 404 when current tenant not found', async () => {
      mockTenantService.get.mockResolvedValue(null);

      const response = await request(app).get('/api/tenants/current');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Current tenant not found');
    });

    it('returns 500 on service error', async () => {
      mockTenantService.get.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/tenants/current');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/tenants
  // --------------------------------------------------------------------------

  describe('POST /api/tenants', () => {
    it('creates a new tenant', async () => {
      mockTenantService.create.mockResolvedValue(TENANT);

      const response = await request(app)
        .post('/api/tenants')
        .send({ name: 'Acme Corp', slug: 'acme', plan: 'pro' });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Acme Corp');
      expect(mockTenantService.create).toHaveBeenCalledWith({
        name: 'Acme Corp',
        slug: 'acme',
        logoUrl: null,
        plan: 'pro',
      });
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app).post('/api/tenants').send({ slug: 'acme' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name is required');
      expect(mockTenantService.create).not.toHaveBeenCalled();
    });

    it('returns 409 when slug is taken', async () => {
      mockTenantService.create.mockRejectedValue(new TenantSlugTakenError('acme'));

      const response = await request(app)
        .post('/api/tenants')
        .send({ name: 'Acme Corp', slug: 'acme' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already in use');
    });

    it('returns 400 on other service error', async () => {
      mockTenantService.create.mockRejectedValue(new Error('bad input'));

      const response = await request(app).post('/api/tenants').send({ name: 'Acme Corp' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad input');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/tenants/onboard
  // --------------------------------------------------------------------------

  describe('POST /api/tenants/onboard', () => {
    const validBody = {
      tenant: { name: 'Acme Corp', slug: 'acme', plan: 'pro' },
      adminUser: { email: 'admin@acme.com', name: 'Admin', password: 'supersecret' },
    };

    it('onboards a tenant + admin user', async () => {
      const result = { tenant: TENANT, adminUser: { id: 'u1', email: 'admin@acme.com' } };
      mockTenantService.onboard.mockResolvedValue(result);

      const response = await request(app).post('/api/tenants/onboard').send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.tenant.name).toBe('Acme Corp');
      expect(mockTenantService.onboard).toHaveBeenCalledWith({
        tenant: { name: 'Acme Corp', slug: 'acme', logoUrl: null, plan: 'pro' },
        adminUser: { email: 'admin@acme.com', name: 'Admin', password: 'supersecret' },
        starterResources: undefined,
      });
    });

    it('returns 400 when tenant.name is missing', async () => {
      const response = await request(app)
        .post('/api/tenants/onboard')
        .send({ ...validBody, tenant: { slug: 'acme' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('tenant.name is required');
    });

    it('returns 400 when adminUser.email is missing', async () => {
      const response = await request(app)
        .post('/api/tenants/onboard')
        .send({ tenant: { name: 'Acme' }, adminUser: { name: 'Admin', password: 'supersecret' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('adminUser.email is required');
    });

    it('returns 400 when adminUser.name is missing', async () => {
      const response = await request(app)
        .post('/api/tenants/onboard')
        .send({
          tenant: { name: 'Acme' },
          adminUser: { email: 'admin@acme.com', password: 'supersecret' },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('adminUser.name is required');
    });

    it('returns 400 when password is too short', async () => {
      const response = await request(app)
        .post('/api/tenants/onboard')
        .send({
          tenant: { name: 'Acme' },
          adminUser: { email: 'admin@acme.com', name: 'Admin', password: 'short' },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('adminUser.password is required (min 8 chars)');
    });

    it('returns 409 when slug is taken', async () => {
      mockTenantService.onboard.mockRejectedValue(new TenantSlugTakenError('acme'));

      const response = await request(app).post('/api/tenants/onboard').send(validBody);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already in use');
    });

    it('returns 400 on other service error', async () => {
      mockTenantService.onboard.mockRejectedValue(new Error('onboard failed'));

      const response = await request(app).post('/api/tenants/onboard').send(validBody);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('onboard failed');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/tenants/:id
  // --------------------------------------------------------------------------

  describe('PATCH /api/tenants/:id', () => {
    it('updates a tenant', async () => {
      const updated = { ...TENANT, name: 'New Name' };
      mockTenantService.update.mockResolvedValue(updated);

      const response = await request(app)
        .patch('/api/tenants/tenant-001')
        .send({ name: 'New Name', logoUrl: null });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('New Name');
      expect(mockTenantService.update).toHaveBeenCalledWith('tenant-001', {
        name: 'New Name',
        logoUrl: null,
        plan: undefined,
        settings: undefined,
      });
    });

    it('returns 404 when tenant not found', async () => {
      mockTenantService.update.mockRejectedValue(new Error('Tenant not found'));

      const response = await request(app)
        .patch('/api/tenants/missing')
        .send({ name: 'New Name' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Tenant not found');
    });

    it('returns 400 on other service error', async () => {
      mockTenantService.update.mockRejectedValue(new Error('invalid'));

      const response = await request(app)
        .patch('/api/tenants/tenant-001')
        .send({ name: 'New Name' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/tenants/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/tenants/:id', () => {
    it('deletes a tenant (204)', async () => {
      mockTenantService.delete.mockResolvedValue(undefined);

      const response = await request(app).delete('/api/tenants/tenant-001');

      expect(response.status).toBe(204);
      expect(mockTenantService.delete).toHaveBeenCalledWith('tenant-001');
    });

    it('returns 409 when tenant is not empty', async () => {
      const counts = { users: 2, robots: 3, datasets: 1, trainingJobs: 0 };
      mockTenantService.delete.mockRejectedValue(new TenantNotEmptyError(counts));

      const response = await request(app).delete('/api/tenants/tenant-001');

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Tenant is not empty');
      expect(response.body.counts).toEqual(counts);
    });

    it('returns 404 when tenant not found', async () => {
      mockTenantService.delete.mockRejectedValue(new Error('Tenant not found'));

      const response = await request(app).delete('/api/tenants/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Tenant not found');
    });

    it('returns 400 on other service error', async () => {
      mockTenantService.delete.mockRejectedValue(new Error('cannot delete default'));

      const response = await request(app).delete('/api/tenants/default');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot delete default');
    });
  });
});

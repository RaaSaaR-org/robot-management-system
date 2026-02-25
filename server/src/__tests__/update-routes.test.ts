/**
 * @file update-routes.test.ts
 * @description Integration tests for OTA update routes
 * @feature updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockUpdateService } = vi.hoisted(() => ({
  mockUpdateService: {
    getUpdatePackages: vi.fn(),
    getUpdatePackage: vi.fn(),
    createUpdatePackage: vi.fn(),
    approveUpdate: vi.fn(),
    deployToRobot: vi.fn(),
    triggerRollback: vi.fn(),
    getDeploymentHistory: vi.fn(),
    verifyPackageSignature: vi.fn(),
    getAvailableUpdates: vi.fn(),
  },
}));

vi.mock('../services/UpdateService.js', () => ({
  updateService: mockUpdateService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { updateRoutes } from '../routes/update.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/updates', updateRoutes);
  return app;
}

describe('Update Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/updates
  // --------------------------------------------------------------------------

  describe('GET /api/updates', () => {
    it('returns list of updates', async () => {
      const mockPackages = [
        {
          id: 'pkg-001',
          version: '1.1.0',
          changelog: 'Update 1',
          signature: 'sig1',
          publicKey: 'pk1',
          checksum: 'cs1',
          fileSize: 100,
          status: 'pending',
          approvedBy: null,
          approvedAt: null,
          createdAt: '2026-02-25T00:00:00.000Z',
        },
      ];
      mockUpdateService.getUpdatePackages.mockResolvedValue(mockPackages);

      const response = await request(app).get('/api/updates');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].version).toBe('1.1.0');
      expect(mockUpdateService.getUpdatePackages).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/updates
  // --------------------------------------------------------------------------

  describe('POST /api/updates', () => {
    it('creates update package', async () => {
      const mockPackage = {
        id: 'pkg-002',
        version: '1.2.0',
        changelog: 'New feature',
        signature: 'sig',
        publicKey: 'pk',
        checksum: 'cs',
        fileSize: 50,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        createdAt: '2026-02-25T00:00:00.000Z',
      };
      mockUpdateService.createUpdatePackage.mockResolvedValue(mockPackage);

      const response = await request(app)
        .post('/api/updates')
        .send({ version: '1.2.0', changelog: 'New feature' });

      expect(response.status).toBe(201);
      expect(response.body.version).toBe('1.2.0');
      expect(mockUpdateService.createUpdatePackage).toHaveBeenCalled();
    });

    it('returns 400 when missing required fields', async () => {
      const response = await request(app)
        .post('/api/updates')
        .send({ version: '1.2.0' }); // missing changelog

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/updates/:id/approve
  // --------------------------------------------------------------------------

  describe('POST /api/updates/:id/approve', () => {
    it('approves update', async () => {
      const mockApproved = {
        id: 'pkg-001',
        version: '1.1.0',
        changelog: 'Update',
        status: 'approved',
        approvedBy: 'admin-001',
        approvedAt: '2026-02-25T00:00:00.000Z',
      };
      mockUpdateService.approveUpdate.mockResolvedValue(mockApproved);

      const response = await request(app)
        .post('/api/updates/pkg-001/approve')
        .send({ approverId: 'admin-001' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('approved');
      expect(mockUpdateService.approveUpdate).toHaveBeenCalledWith('pkg-001', 'admin-001');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/updates/:id/rollback/:robotId
  // --------------------------------------------------------------------------

  describe('POST /api/updates/:id/rollback/:robotId', () => {
    it('triggers rollback', async () => {
      const mockDeployment = {
        id: 'dep-001',
        packageId: 'pkg-001',
        robotId: 'robot-001',
        status: 'rolled_back',
        rolledBackAt: '2026-02-25T00:00:00.000Z',
      };
      mockUpdateService.triggerRollback.mockResolvedValue(mockDeployment);

      const response = await request(app)
        .post('/api/updates/pkg-001/rollback/robot-001')
        .send({ targetVersion: '1.0.0' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('rolled_back');
      expect(mockUpdateService.triggerRollback).toHaveBeenCalledWith('robot-001', '1.0.0');
    });

    it('returns 400 when missing targetVersion', async () => {
      const response = await request(app)
        .post('/api/updates/pkg-001/rollback/robot-001')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('targetVersion');
    });
  });
});

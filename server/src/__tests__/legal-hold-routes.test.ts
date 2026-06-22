/**
 * @file legal-hold-routes.test.ts
 * @description Integration tests for legal hold management routes
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockLegalHoldService } = vi.hoisted(() => ({
  mockLegalHoldService: {
    getAllHolds: vi.fn(),
    getActiveHolds: vi.fn(),
    getHold: vi.fn(),
    createHold: vi.fn(),
    releaseHold: vi.fn(),
    addLogsToHold: vi.fn(),
    removeLogsFromHold: vi.fn(),
    isLogUnderHold: vi.fn(),
  },
}));

vi.mock('../services/LegalHoldService.js', () => ({
  legalHoldService: mockLegalHoldService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { legalHoldRoutes } from '../routes/legal-hold.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/compliance/legal-holds', authMiddleware as any, legalHoldRoutes);
  return app;
}

const MOCK_HOLD = {
  id: 'hold-001',
  name: 'Litigation 2026',
  reason: 'Pending lawsuit',
  createdBy: 'user-123',
  logIds: ['log-1', 'log-2'],
  active: true,
  endDate: null,
  createdAt: '2026-06-22T00:00:00.000Z',
  updatedAt: '2026-06-22T00:00:00.000Z',
};

describe('Legal Hold Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/legal-holds
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/legal-holds', () => {
    it('returns all holds by default', async () => {
      mockLegalHoldService.getAllHolds.mockResolvedValue([MOCK_HOLD]);

      const response = await request(app).get('/api/compliance/legal-holds');

      expect(response.status).toBe(200);
      expect(response.body.holds).toHaveLength(1);
      expect(response.body.holds[0].id).toBe('hold-001');
      expect(mockLegalHoldService.getAllHolds).toHaveBeenCalled();
      expect(mockLegalHoldService.getActiveHolds).not.toHaveBeenCalled();
    });

    it('returns only active holds when activeOnly=true', async () => {
      mockLegalHoldService.getActiveHolds.mockResolvedValue([MOCK_HOLD]);

      const response = await request(app).get('/api/compliance/legal-holds?activeOnly=true');

      expect(response.status).toBe(200);
      expect(response.body.holds).toHaveLength(1);
      expect(mockLegalHoldService.getActiveHolds).toHaveBeenCalled();
      expect(mockLegalHoldService.getAllHolds).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.getAllHolds.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/compliance/legal-holds');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch legal holds');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/legal-holds/check/:logId
  // (registered last, but two-segment path matches before single-segment /:id)
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/legal-holds/check/:logId', () => {
    it('returns hold status for a log', async () => {
      mockLegalHoldService.isLogUnderHold.mockResolvedValue(true);

      const response = await request(app).get('/api/compliance/legal-holds/check/log-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ logId: 'log-1', isUnderHold: true });
      expect(mockLegalHoldService.isLogUnderHold).toHaveBeenCalledWith('log-1');
    });

    it('returns false when log is not under hold', async () => {
      mockLegalHoldService.isLogUnderHold.mockResolvedValue(false);

      const response = await request(app).get('/api/compliance/legal-holds/check/log-9');

      expect(response.status).toBe(200);
      expect(response.body.isUnderHold).toBe(false);
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.isLogUnderHold.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/compliance/legal-holds/check/log-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to check legal hold status');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/legal-holds/:id
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/legal-holds/:id', () => {
    it('returns a specific hold', async () => {
      mockLegalHoldService.getHold.mockResolvedValue(MOCK_HOLD);

      const response = await request(app).get('/api/compliance/legal-holds/hold-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('hold-001');
      expect(mockLegalHoldService.getHold).toHaveBeenCalledWith('hold-001');
    });

    it('returns 404 when hold not found', async () => {
      mockLegalHoldService.getHold.mockResolvedValue(null);

      const response = await request(app).get('/api/compliance/legal-holds/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Legal hold not found');
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.getHold.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/compliance/legal-holds/hold-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch legal hold');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/compliance/legal-holds
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/legal-holds', () => {
    it('creates a new hold', async () => {
      mockLegalHoldService.createHold.mockResolvedValue(MOCK_HOLD);

      const response = await request(app)
        .post('/api/compliance/legal-holds')
        .send({
          name: 'Litigation 2026',
          reason: 'Pending lawsuit',
          createdBy: 'user-123',
          logIds: ['log-1', 'log-2'],
          endDate: '2026-12-31T00:00:00.000Z',
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('hold-001');
      expect(mockLegalHoldService.createHold).toHaveBeenCalledWith({
        name: 'Litigation 2026',
        reason: 'Pending lawsuit',
        createdBy: 'user-123',
        logIds: ['log-1', 'log-2'],
        endDate: new Date('2026-12-31T00:00:00.000Z'),
      });
    });

    it('creates a hold without endDate (undefined)', async () => {
      mockLegalHoldService.createHold.mockResolvedValue(MOCK_HOLD);

      const response = await request(app)
        .post('/api/compliance/legal-holds')
        .send({
          name: 'No End',
          reason: 'Reason',
          createdBy: 'user-123',
          logIds: ['log-1'],
        });

      expect(response.status).toBe(201);
      expect(mockLegalHoldService.createHold).toHaveBeenCalledWith({
        name: 'No End',
        reason: 'Reason',
        createdBy: 'user-123',
        logIds: ['log-1'],
        endDate: undefined,
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/compliance/legal-holds')
        .send({ name: 'Only name' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockLegalHoldService.createHold).not.toHaveBeenCalled();
    });

    it('returns 400 when logIds is not an array', async () => {
      const response = await request(app)
        .post('/api/compliance/legal-holds')
        .send({
          name: 'X',
          reason: 'Y',
          createdBy: 'user-123',
          logIds: 'not-an-array',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockLegalHoldService.createHold).not.toHaveBeenCalled();
    });

    it('returns 400 when logIds array is empty', async () => {
      const response = await request(app)
        .post('/api/compliance/legal-holds')
        .send({
          name: 'X',
          reason: 'Y',
          createdBy: 'user-123',
          logIds: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least one log ID');
      expect(mockLegalHoldService.createHold).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.createHold.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/compliance/legal-holds')
        .send({
          name: 'X',
          reason: 'Y',
          createdBy: 'user-123',
          logIds: ['log-1'],
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create legal hold');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/compliance/legal-holds/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/compliance/legal-holds/:id', () => {
    it('releases a hold', async () => {
      const released = { ...MOCK_HOLD, active: false };
      mockLegalHoldService.releaseHold.mockResolvedValue(released);

      const response = await request(app).delete('/api/compliance/legal-holds/hold-001');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Legal hold released');
      expect(response.body.hold.active).toBe(false);
      expect(mockLegalHoldService.releaseHold).toHaveBeenCalledWith('hold-001');
    });

    it('returns 404 when hold not found', async () => {
      mockLegalHoldService.releaseHold.mockResolvedValue(null);

      const response = await request(app).delete('/api/compliance/legal-holds/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Legal hold not found');
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.releaseHold.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/compliance/legal-holds/hold-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to release legal hold');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/compliance/legal-holds/:id/logs
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/legal-holds/:id/logs', () => {
    it('adds logs to a hold', async () => {
      const updated = { ...MOCK_HOLD, logIds: ['log-1', 'log-2', 'log-3'] };
      mockLegalHoldService.addLogsToHold.mockResolvedValue(updated);

      const response = await request(app)
        .post('/api/compliance/legal-holds/hold-001/logs')
        .send({ logIds: ['log-3'] });

      expect(response.status).toBe(200);
      expect(response.body.logIds).toContain('log-3');
      expect(mockLegalHoldService.addLogsToHold).toHaveBeenCalledWith({
        holdId: 'hold-001',
        logIds: ['log-3'],
      });
    });

    it('returns 400 when logIds missing or empty', async () => {
      const response = await request(app)
        .post('/api/compliance/legal-holds/hold-001/logs')
        .send({ logIds: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('logIds (non-empty array)');
      expect(mockLegalHoldService.addLogsToHold).not.toHaveBeenCalled();
    });

    it('returns 404 when hold not found or not active', async () => {
      mockLegalHoldService.addLogsToHold.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/compliance/legal-holds/missing/logs')
        .send({ logIds: ['log-3'] });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Legal hold not found or not active');
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.addLogsToHold.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/compliance/legal-holds/hold-001/logs')
        .send({ logIds: ['log-3'] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to add logs to legal hold');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/compliance/legal-holds/:id/logs
  // --------------------------------------------------------------------------

  describe('DELETE /api/compliance/legal-holds/:id/logs', () => {
    it('removes logs from a hold', async () => {
      const updated = { ...MOCK_HOLD, logIds: ['log-1'] };
      mockLegalHoldService.removeLogsFromHold.mockResolvedValue(updated);

      const response = await request(app)
        .delete('/api/compliance/legal-holds/hold-001/logs')
        .send({ logIds: ['log-2'] });

      expect(response.status).toBe(200);
      expect(response.body.logIds).toEqual(['log-1']);
      expect(mockLegalHoldService.removeLogsFromHold).toHaveBeenCalledWith('hold-001', ['log-2']);
    });

    it('returns 400 when logIds missing or empty', async () => {
      const response = await request(app)
        .delete('/api/compliance/legal-holds/hold-001/logs')
        .send({ logIds: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('logIds (non-empty array)');
      expect(mockLegalHoldService.removeLogsFromHold).not.toHaveBeenCalled();
    });

    it('returns 404 when hold not found', async () => {
      mockLegalHoldService.removeLogsFromHold.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/compliance/legal-holds/missing/logs')
        .send({ logIds: ['log-2'] });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Legal hold not found');
    });

    it('returns 500 on service error', async () => {
      mockLegalHoldService.removeLogsFromHold.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .delete('/api/compliance/legal-holds/hold-001/logs')
        .send({ logIds: ['log-2'] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to remove logs from legal hold');
    });
  });
});

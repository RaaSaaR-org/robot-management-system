/**
 * @file retention-routes.test.ts
 * @description Integration tests for retention policy management routes
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockRetentionPolicyService, mockRetentionCleanupJob } = vi.hoisted(() => ({
  mockRetentionPolicyService: {
    getAllPolicies: vi.fn(),
    getPolicy: vi.fn(),
    setPolicy: vi.fn(),
    deletePolicy: vi.fn(),
  },
  mockRetentionCleanupJob: {
    runCleanup: vi.fn(),
    getRetentionStats: vi.fn(),
  },
}));

vi.mock('../services/RetentionPolicyService.js', () => ({
  retentionPolicyService: mockRetentionPolicyService,
}));

vi.mock('../jobs/RetentionCleanupJob.js', () => ({
  retentionCleanupJob: mockRetentionCleanupJob,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { retentionRoutes } from '../routes/retention.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/compliance/retention', authMiddleware as any, retentionRoutes);
  return app;
}

const SAMPLE_POLICY = {
  eventType: 'ai_decision',
  retentionDays: 365,
  description: 'AI decisions retained for one year',
  isDefault: false,
};

describe('Retention Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/retention
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/retention', () => {
    it('returns all retention policies', async () => {
      mockRetentionPolicyService.getAllPolicies.mockResolvedValue([SAMPLE_POLICY]);

      const response = await request(app).get('/api/compliance/retention');

      expect(response.status).toBe(200);
      expect(response.body.policies).toHaveLength(1);
      expect(response.body.policies[0].eventType).toBe('ai_decision');
      expect(mockRetentionPolicyService.getAllPolicies).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockRetentionPolicyService.getAllPolicies.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/compliance/retention');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch retention policies');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/retention/:eventType
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/retention/:eventType', () => {
    it('returns the policy for a valid event type', async () => {
      mockRetentionPolicyService.getPolicy.mockResolvedValue(SAMPLE_POLICY);

      const response = await request(app).get('/api/compliance/retention/ai_decision');

      expect(response.status).toBe(200);
      expect(response.body.eventType).toBe('ai_decision');
      expect(response.body.retentionDays).toBe(365);
      expect(mockRetentionPolicyService.getPolicy).toHaveBeenCalledWith('ai_decision');
    });

    it('returns 400 for an invalid event type', async () => {
      const response = await request(app).get('/api/compliance/retention/bogus_type');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid eventType');
      expect(mockRetentionPolicyService.getPolicy).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockRetentionPolicyService.getPolicy.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/compliance/retention/safety_action');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch retention policy');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/compliance/retention/:eventType
  // --------------------------------------------------------------------------

  describe('PUT /api/compliance/retention/:eventType', () => {
    it('sets a retention policy successfully', async () => {
      const updated = { ...SAMPLE_POLICY, retentionDays: 90, description: 'shorter' };
      mockRetentionPolicyService.setPolicy.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/compliance/retention/ai_decision')
        .send({ retentionDays: 90, description: 'shorter' });

      expect(response.status).toBe(200);
      expect(response.body.retentionDays).toBe(90);
      expect(mockRetentionPolicyService.setPolicy).toHaveBeenCalledWith({
        eventType: 'ai_decision',
        retentionDays: 90,
        description: 'shorter',
      });
    });

    it('returns 400 for an invalid event type', async () => {
      const response = await request(app)
        .put('/api/compliance/retention/bogus_type')
        .send({ retentionDays: 90 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid eventType');
      expect(mockRetentionPolicyService.setPolicy).not.toHaveBeenCalled();
    });

    it('returns 400 when retentionDays is not a number', async () => {
      const response = await request(app)
        .put('/api/compliance/retention/ai_decision')
        .send({ retentionDays: 'soon' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('retentionDays must be a positive number');
      expect(mockRetentionPolicyService.setPolicy).not.toHaveBeenCalled();
    });

    it('returns 400 when retentionDays is less than 1', async () => {
      const response = await request(app)
        .put('/api/compliance/retention/ai_decision')
        .send({ retentionDays: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('retentionDays must be a positive number');
      expect(mockRetentionPolicyService.setPolicy).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockRetentionPolicyService.setPolicy.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .put('/api/compliance/retention/ai_decision')
        .send({ retentionDays: 90 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to set retention policy');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/compliance/retention/:eventType
  // --------------------------------------------------------------------------

  describe('DELETE /api/compliance/retention/:eventType', () => {
    it('deletes a custom policy and returns the default', async () => {
      mockRetentionPolicyService.deletePolicy.mockResolvedValue(true);
      const defaultPolicy = { ...SAMPLE_POLICY, isDefault: true, retentionDays: 180 };
      mockRetentionPolicyService.getPolicy.mockResolvedValue(defaultPolicy);

      const response = await request(app).delete('/api/compliance/retention/ai_decision');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Custom policy deleted, reverted to default');
      expect(response.body.policy.isDefault).toBe(true);
      expect(mockRetentionPolicyService.deletePolicy).toHaveBeenCalledWith('ai_decision');
      expect(mockRetentionPolicyService.getPolicy).toHaveBeenCalledWith('ai_decision');
    });

    it('returns 404 when no custom policy exists', async () => {
      mockRetentionPolicyService.deletePolicy.mockResolvedValue(false);

      const response = await request(app).delete('/api/compliance/retention/ai_decision');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Custom policy not found');
      expect(mockRetentionPolicyService.getPolicy).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockRetentionPolicyService.deletePolicy.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/compliance/retention/ai_decision');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete retention policy');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/compliance/retention/cleanup
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/retention/cleanup', () => {
    it('triggers a manual cleanup and returns the result', async () => {
      const result = { deletedCount: 42, byEventType: { ai_decision: 42 } };
      mockRetentionCleanupJob.runCleanup.mockResolvedValue(result);

      const response = await request(app).post('/api/compliance/retention/cleanup');

      expect(response.status).toBe(200);
      expect(response.body.deletedCount).toBe(42);
      expect(mockRetentionCleanupJob.runCleanup).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on cleanup error', async () => {
      mockRetentionCleanupJob.runCleanup.mockRejectedValue(new Error('cleanup failed'));

      const response = await request(app).post('/api/compliance/retention/cleanup');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to run cleanup');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/retention/cleanup/stats
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/retention/cleanup/stats', () => {
    it('returns retention statistics', async () => {
      const stats = { totalLogs: 1000, expiringSoon: 12 };
      mockRetentionCleanupJob.getRetentionStats.mockResolvedValue(stats);

      const response = await request(app).get('/api/compliance/retention/cleanup/stats');

      expect(response.status).toBe(200);
      expect(response.body.totalLogs).toBe(1000);
      expect(mockRetentionCleanupJob.getRetentionStats).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on stats error', async () => {
      mockRetentionCleanupJob.getRetentionStats.mockRejectedValue(new Error('stats failed'));

      const response = await request(app).get('/api/compliance/retention/cleanup/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch retention stats');
    });
  });
});

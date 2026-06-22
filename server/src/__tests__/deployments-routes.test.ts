/**
 * @file deployments-routes.test.ts
 * @description Integration tests for VLA deployment routes
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockDeploymentService, mockDeploymentMetricsService, mockModelVersionRepository } =
  vi.hoisted(() => ({
    mockDeploymentService: {
      createDeployment: vi.fn(),
      listDeployments: vi.fn(),
      getActiveDeployments: vi.fn(),
      getDeployment: vi.fn(),
      getDeploymentContext: vi.fn(),
      startCanary: vi.fn(),
      progressToNextStage: vi.fn(),
      promoteToProduction: vi.fn(),
      rollback: vi.fn(),
      cancelDeployment: vi.fn(),
    },
    mockDeploymentMetricsService: {
      getAggregatedMetrics: vi.fn(),
      isMonitoring: vi.fn(),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
    },
    mockModelVersionRepository: {
      findById: vi.fn(),
    },
  }));

vi.mock('../services/DeploymentService.js', () => ({
  deploymentService: mockDeploymentService,
}));

vi.mock('../services/DeploymentMetricsService.js', () => ({
  deploymentMetricsService: mockDeploymentMetricsService,
}));

vi.mock('../repositories/index.js', () => ({
  modelVersionRepository: mockModelVersionRepository,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { deploymentsRoutes } from '../routes/deployments.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/deployments', authMiddleware as any, deploymentsRoutes);
  return app;
}

const BASE_DEPLOYMENT: any = {
  id: 'dep-001',
  modelVersionId: 'mv-001',
  status: 'pending',
  strategy: 'canary',
  trafficPercentage: 0,
  deployedRobotIds: ['r1', 'r2'],
  failedRobotIds: ['r3'],
  canaryConfig: {
    stages: [
      { percentage: 10, durationMinutes: 30 },
      { percentage: 50, durationMinutes: 60 },
      { percentage: 100, durationMinutes: 0 },
    ],
  },
};

describe('Deployments Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/deployments
  // --------------------------------------------------------------------------

  describe('POST /api/deployments', () => {
    it('creates a new deployment (201)', async () => {
      mockDeploymentService.createDeployment.mockResolvedValue(BASE_DEPLOYMENT);

      const response = await request(app)
        .post('/api/deployments')
        .send({ modelVersionId: 'mv-001', strategy: 'canary' });

      expect(response.status).toBe(201);
      expect(response.body.deployment.id).toBe('dep-001');
      expect(response.body.message).toBe('Deployment created successfully');
      expect(mockDeploymentService.createDeployment).toHaveBeenCalledWith({
        modelVersionId: 'mv-001',
        strategy: 'canary',
      });
    });

    it('returns 400 when modelVersionId is missing', async () => {
      const response = await request(app).post('/api/deployments').send({ strategy: 'canary' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelVersionId is required');
      expect(mockDeploymentService.createDeployment).not.toHaveBeenCalled();
    });

    it('returns 400 when the service throws', async () => {
      mockDeploymentService.createDeployment.mockRejectedValue(new Error('Model not found'));

      const response = await request(app)
        .post('/api/deployments')
        .send({ modelVersionId: 'mv-001' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Model not found');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/deployments
  // --------------------------------------------------------------------------

  describe('GET /api/deployments', () => {
    it('lists deployments with pagination', async () => {
      mockDeploymentService.listDeployments.mockResolvedValue({
        data: [BASE_DEPLOYMENT],
        pagination: { page: 1, pageSize: 20, total: 1 },
      });

      const response = await request(app).get('/api/deployments');

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(1);
      expect(response.body.pagination.total).toBe(1);
      expect(mockDeploymentService.listDeployments).toHaveBeenCalledWith({
        modelVersionId: undefined,
        page: undefined,
        pageSize: undefined,
        status: undefined,
        strategy: undefined,
      });
    });

    it('parses query params including comma-separated arrays', async () => {
      mockDeploymentService.listDeployments.mockResolvedValue({
        data: [],
        pagination: { page: 2, pageSize: 5, total: 0 },
      });

      const response = await request(app).get(
        '/api/deployments?modelVersionId=mv-9&page=2&pageSize=5&status=active,paused&strategy=canary'
      );

      expect(response.status).toBe(200);
      expect(mockDeploymentService.listDeployments).toHaveBeenCalledWith({
        modelVersionId: 'mv-9',
        page: 2,
        pageSize: 5,
        status: ['active', 'paused'],
        strategy: 'canary',
      });
    });

    it('returns 500 on service error', async () => {
      mockDeploymentService.listDeployments.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/deployments');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/deployments/active
  // --------------------------------------------------------------------------

  describe('GET /api/deployments/active', () => {
    it('returns active deployments with count', async () => {
      mockDeploymentService.getActiveDeployments.mockResolvedValue([BASE_DEPLOYMENT, BASE_DEPLOYMENT]);

      const response = await request(app).get('/api/deployments/active');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.deployments).toHaveLength(2);
      expect(mockDeploymentService.getActiveDeployments).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockDeploymentService.getActiveDeployments.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/deployments/active');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/deployments/:id
  // --------------------------------------------------------------------------

  describe('GET /api/deployments/:id', () => {
    it('returns deployment details with computed fields', async () => {
      const dep = { ...BASE_DEPLOYMENT, trafficPercentage: 50 };
      mockDeploymentService.getDeployment.mockResolvedValue(dep);
      mockModelVersionRepository.findById.mockResolvedValue({ id: 'mv-001', name: 'v1' });
      mockDeploymentMetricsService.getAggregatedMetrics.mockReturnValue({ successRate: 0.99 });
      mockDeploymentService.getDeploymentContext.mockReturnValue({
        stageStartTime: new Date('2026-06-01T00:00:00.000Z'),
      });

      const response = await request(app).get('/api/deployments/dep-001');

      expect(response.status).toBe(200);
      expect(response.body.deployment.id).toBe('dep-001');
      expect(response.body.modelVersion.id).toBe('mv-001');
      // trafficPercentage 50 -> stages[0]=10, stages[1]=50 reached -> currentStage 2
      expect(response.body.currentStage).toBe(2);
      expect(response.body.totalStages).toBe(3);
      expect(response.body.metrics.successRate).toBe(0.99);
      expect(response.body.eligibleRobotCount).toBe(3);
      expect(response.body.deployedCount).toBe(2);
      expect(response.body.failedCount).toBe(1);
      // currentStage 2 -> stages[1].durationMinutes = 60 -> nextStageTime computed
      expect(response.body.nextStageTime).toBe('2026-06-01T01:00:00.000Z');
      expect(mockDeploymentService.getDeployment).toHaveBeenCalledWith('dep-001');
    });

    it('returns 404 when deployment is missing', async () => {
      mockDeploymentService.getDeployment.mockResolvedValue(null);

      const response = await request(app).get('/api/deployments/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Deployment not found');
    });

    it('handles missing model version and no context gracefully', async () => {
      mockDeploymentService.getDeployment.mockResolvedValue({ ...BASE_DEPLOYMENT });
      mockModelVersionRepository.findById.mockResolvedValue(null);
      mockDeploymentMetricsService.getAggregatedMetrics.mockReturnValue(null);
      mockDeploymentService.getDeploymentContext.mockReturnValue(null);

      const response = await request(app).get('/api/deployments/dep-001');

      expect(response.status).toBe(200);
      expect(response.body.modelVersion).toBeUndefined();
      expect(response.body.metrics).toBeUndefined();
      expect(response.body.nextStageTime).toBeUndefined();
      expect(response.body.currentStage).toBe(0);
    });

    it('returns 500 on service error', async () => {
      mockDeploymentService.getDeployment.mockRejectedValue(new Error('explode'));

      const response = await request(app).get('/api/deployments/dep-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('explode');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/deployments/:id/metrics
  // --------------------------------------------------------------------------

  describe('GET /api/deployments/:id/metrics', () => {
    it('returns metrics and monitoring state', async () => {
      mockDeploymentService.getDeployment.mockResolvedValue(BASE_DEPLOYMENT);
      mockDeploymentMetricsService.getAggregatedMetrics.mockReturnValue({ successRate: 0.95 });
      mockDeploymentMetricsService.isMonitoring.mockReturnValue(true);

      const response = await request(app).get('/api/deployments/dep-001/metrics');

      expect(response.status).toBe(200);
      expect(response.body.deploymentId).toBe('dep-001');
      expect(response.body.metrics.successRate).toBe(0.95);
      expect(response.body.isMonitoring).toBe(true);
    });

    it('returns 404 when deployment is missing', async () => {
      mockDeploymentService.getDeployment.mockResolvedValue(null);

      const response = await request(app).get('/api/deployments/missing/metrics');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Deployment not found');
    });

    it('returns 500 on service error', async () => {
      mockDeploymentService.getDeployment.mockRejectedValue(new Error('m-fail'));

      const response = await request(app).get('/api/deployments/dep-001/metrics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('m-fail');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/deployments/:id/start
  // --------------------------------------------------------------------------

  describe('POST /api/deployments/:id/start', () => {
    it('starts canary rollout and begins monitoring', async () => {
      mockDeploymentService.startCanary.mockResolvedValue({ ...BASE_DEPLOYMENT, status: 'active' });

      const response = await request(app).post('/api/deployments/dep-001/start');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Canary deployment started');
      expect(mockDeploymentService.startCanary).toHaveBeenCalledWith('dep-001');
      expect(mockDeploymentMetricsService.startMonitoring).toHaveBeenCalledWith('dep-001');
    });

    it('returns 400 on service error', async () => {
      mockDeploymentService.startCanary.mockRejectedValue(new Error('cannot start'));

      const response = await request(app).post('/api/deployments/dep-001/start');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot start');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/deployments/:id/progress
  // --------------------------------------------------------------------------

  describe('POST /api/deployments/:id/progress', () => {
    it('progresses to next stage', async () => {
      mockDeploymentService.progressToNextStage.mockResolvedValue(BASE_DEPLOYMENT);

      const response = await request(app).post('/api/deployments/dep-001/progress');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Progressed to next stage');
      expect(mockDeploymentService.progressToNextStage).toHaveBeenCalledWith('dep-001');
    });

    it('returns 400 on service error', async () => {
      mockDeploymentService.progressToNextStage.mockRejectedValue(new Error('no next stage'));

      const response = await request(app).post('/api/deployments/dep-001/progress');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('no next stage');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/deployments/:id/promote
  // --------------------------------------------------------------------------

  describe('POST /api/deployments/:id/promote', () => {
    it('promotes to production and stops monitoring', async () => {
      mockDeploymentService.promoteToProduction.mockResolvedValue(BASE_DEPLOYMENT);

      const response = await request(app).post('/api/deployments/dep-001/promote');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Deployment promoted to production');
      expect(mockDeploymentService.promoteToProduction).toHaveBeenCalledWith('dep-001');
      expect(mockDeploymentMetricsService.stopMonitoring).toHaveBeenCalledWith('dep-001');
    });

    it('returns 400 on service error', async () => {
      mockDeploymentService.promoteToProduction.mockRejectedValue(new Error('cannot promote'));

      const response = await request(app).post('/api/deployments/dep-001/promote');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot promote');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/deployments/:id/rollback
  // --------------------------------------------------------------------------

  describe('POST /api/deployments/:id/rollback', () => {
    it('rolls back with a reason and stops monitoring', async () => {
      mockDeploymentService.rollback.mockResolvedValue(BASE_DEPLOYMENT);

      const response = await request(app)
        .post('/api/deployments/dep-001/rollback')
        .send({ reason: 'high error rate' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Deployment rolled back');
      expect(response.body.reason).toBe('high error rate');
      expect(mockDeploymentService.rollback).toHaveBeenCalledWith('dep-001', 'high error rate');
      expect(mockDeploymentMetricsService.stopMonitoring).toHaveBeenCalledWith('dep-001');
    });

    it('returns 400 when reason is missing', async () => {
      const response = await request(app).post('/api/deployments/dep-001/rollback').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('reason is required for rollback');
      expect(mockDeploymentService.rollback).not.toHaveBeenCalled();
    });

    it('returns 400 on service error', async () => {
      mockDeploymentService.rollback.mockRejectedValue(new Error('rollback failed'));

      const response = await request(app)
        .post('/api/deployments/dep-001/rollback')
        .send({ reason: 'oops' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('rollback failed');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/deployments/:id/cancel
  // --------------------------------------------------------------------------

  describe('POST /api/deployments/:id/cancel', () => {
    it('cancels deployment and stops monitoring', async () => {
      mockDeploymentService.cancelDeployment.mockResolvedValue(BASE_DEPLOYMENT);

      const response = await request(app).post('/api/deployments/dep-001/cancel');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Deployment cancelled');
      expect(mockDeploymentService.cancelDeployment).toHaveBeenCalledWith('dep-001');
      expect(mockDeploymentMetricsService.stopMonitoring).toHaveBeenCalledWith('dep-001');
    });

    it('returns 400 on service error', async () => {
      mockDeploymentService.cancelDeployment.mockRejectedValue(new Error('cannot cancel'));

      const response = await request(app).post('/api/deployments/dep-001/cancel');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot cancel');
    });
  });
});

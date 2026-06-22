/**
 * @file active-learning-routes.test.ts
 * @description Integration tests for active learning routes
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockActiveLearningService } = vi.hoisted(() => ({
  mockActiveLearningService: {
    logPrediction: vi.fn(),
    logPredictionsBatch: vi.fn(),
    getPredictionLogs: vi.fn(),
    computeUncertaintyAnalysis: vi.fn(),
    computeLearningProgress: vi.fn(),
    identifyPlateaus: vi.fn(),
    computeCollectionPriorities: vi.fn(),
    createCollectionTarget: vi.fn(),
    listCollectionTargets: vi.fn(),
    getCollectionTarget: vi.fn(),
    updateCollectionProgress: vi.fn(),
    getProgressSummary: vi.fn(),
    computeDiversityAnalysis: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../services/ActiveLearningService.js', () => ({
  activeLearningService: mockActiveLearningService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { activeLearningRoutes } from '../routes/active-learning.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/active-learning', authMiddleware as any, activeLearningRoutes);
  return app;
}

const VALID_PREDICTION = {
  modelId: 'model-1',
  robotId: 'robot-1',
  inputHash: 'hash-abc',
  taskCategory: 'pick_place',
  environment: 'warehouse',
  confidence: 0.75,
};

describe('Active Learning Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/active-learning/predictions
  // --------------------------------------------------------------------------

  describe('POST /api/active-learning/predictions', () => {
    it('logs a prediction (201)', async () => {
      mockActiveLearningService.logPrediction.mockResolvedValue({
        id: 'log-1',
        timestamp: '2026-02-26T00:00:00.000Z',
      });

      const response = await request(app)
        .post('/api/active-learning/predictions')
        .send(VALID_PREDICTION);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 'log-1',
        logged: true,
        timestamp: '2026-02-26T00:00:00.000Z',
      });
      expect(mockActiveLearningService.logPrediction).toHaveBeenCalledWith(VALID_PREDICTION);
    });

    it('returns 400 when modelId/robotId/inputHash missing', async () => {
      const response = await request(app)
        .post('/api/active-learning/predictions')
        .send({ taskCategory: 'pick', environment: 'warehouse', confidence: 0.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelId, robotId, and inputHash are required');
      expect(mockActiveLearningService.logPrediction).not.toHaveBeenCalled();
    });

    it('returns 400 when taskCategory/environment missing', async () => {
      const response = await request(app)
        .post('/api/active-learning/predictions')
        .send({ modelId: 'm', robotId: 'r', inputHash: 'h', confidence: 0.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('taskCategory and environment are required');
    });

    it('returns 400 when confidence out of range', async () => {
      const response = await request(app)
        .post('/api/active-learning/predictions')
        .send({ ...VALID_PREDICTION, confidence: 1.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('confidence must be a number between 0 and 1');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.logPrediction.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/active-learning/predictions')
        .send(VALID_PREDICTION);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to log prediction');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/active-learning/predictions/batch
  // --------------------------------------------------------------------------

  describe('POST /api/active-learning/predictions/batch', () => {
    it('logs a batch (201)', async () => {
      mockActiveLearningService.logPredictionsBatch.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      const response = await request(app)
        .post('/api/active-learning/predictions/batch')
        .send({ predictions: [VALID_PREDICTION, VALID_PREDICTION] });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ logged: 2, ids: ['a', 'b'] });
      expect(mockActiveLearningService.logPredictionsBatch).toHaveBeenCalledWith([
        VALID_PREDICTION,
        VALID_PREDICTION,
      ]);
    });

    it('returns 400 when predictions array missing or empty', async () => {
      const response = await request(app)
        .post('/api/active-learning/predictions/batch')
        .send({ predictions: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('predictions array is required');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.logPredictionsBatch.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/active-learning/predictions/batch')
        .send({ predictions: [VALID_PREDICTION] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to log predictions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/predictions
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/predictions', () => {
    it('returns prediction logs', async () => {
      mockActiveLearningService.getPredictionLogs.mockResolvedValue([{ id: 'l1' }]);

      const response = await request(app)
        .get('/api/active-learning/predictions')
        .query({ modelId: 'model-1', limit: '50', minConfidence: '0.2' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        modelId: 'model-1',
        count: 1,
        predictions: [{ id: 'l1' }],
      });
      expect(mockActiveLearningService.getPredictionLogs).toHaveBeenCalledWith('model-1', {
        limit: 50,
        taskCategory: undefined,
        environment: undefined,
        minConfidence: 0.2,
        maxConfidence: undefined,
      });
    });

    it('returns 400 when modelId missing', async () => {
      const response = await request(app).get('/api/active-learning/predictions');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelId query parameter is required');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.getPredictionLogs.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .get('/api/active-learning/predictions')
        .query({ modelId: 'model-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get predictions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/uncertainty/:modelId
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/uncertainty/:modelId', () => {
    it('returns uncertainty analysis', async () => {
      mockActiveLearningService.computeUncertaintyAnalysis.mockResolvedValue({
        modelId: 'model-1',
        meanUncertainty: 0.3,
      });

      const response = await request(app)
        .get('/api/active-learning/uncertainty/model-1')
        .query({ windowDays: '14' });

      expect(response.status).toBe(200);
      expect(response.body.meanUncertainty).toBe(0.3);
      expect(mockActiveLearningService.computeUncertaintyAnalysis).toHaveBeenCalledWith(
        'model-1',
        14
      );
    });

    it('defaults windowDays to 7', async () => {
      mockActiveLearningService.computeUncertaintyAnalysis.mockResolvedValue({});

      await request(app).get('/api/active-learning/uncertainty/model-1');

      expect(mockActiveLearningService.computeUncertaintyAnalysis).toHaveBeenCalledWith(
        'model-1',
        7
      );
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.computeUncertaintyAnalysis.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/active-learning/uncertainty/model-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compute uncertainty analysis');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/progress/:modelId
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/progress/:modelId', () => {
    it('returns learning progress for a specific task', async () => {
      mockActiveLearningService.computeLearningProgress.mockResolvedValue({
        task: 'pick',
        progress: 0.8,
      });

      const response = await request(app)
        .get('/api/active-learning/progress/model-1')
        .query({ task: 'pick' });

      expect(response.status).toBe(200);
      expect(response.body.progress).toBe(0.8);
      expect(mockActiveLearningService.computeLearningProgress).toHaveBeenCalledWith(
        'model-1',
        'pick'
      );
      expect(mockActiveLearningService.identifyPlateaus).not.toHaveBeenCalled();
    });

    it('returns plateaued tasks when no task query', async () => {
      mockActiveLearningService.identifyPlateaus.mockResolvedValue(['t1', 't2']);

      const response = await request(app).get('/api/active-learning/progress/model-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        modelId: 'model-1',
        plateauedTasks: ['t1', 't2'],
        totalPlateaued: 2,
      });
      expect(mockActiveLearningService.identifyPlateaus).toHaveBeenCalledWith('model-1');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.identifyPlateaus.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/active-learning/progress/model-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get learning progress');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/priorities
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/priorities', () => {
    const PRIORITIES = {
      modelId: 'model-1',
      priorities: [
        { target: 't1', targetType: 'task', priorityScore: 0.9 },
        { target: 't2', targetType: 'environment', priorityScore: 0.3 },
        { target: 't3', targetType: 'task', priorityScore: 0.6 },
      ],
    };

    it('returns priorities without filters', async () => {
      mockActiveLearningService.computeCollectionPriorities.mockResolvedValue(PRIORITIES);

      const response = await request(app)
        .get('/api/active-learning/priorities')
        .query({ modelId: 'model-1' });

      expect(response.status).toBe(200);
      expect(response.body.priorities).toHaveLength(3);
      expect(mockActiveLearningService.computeCollectionPriorities).toHaveBeenCalledWith(
        'model-1'
      );
    });

    it('applies limit, minPriorityScore and targetType filters', async () => {
      mockActiveLearningService.computeCollectionPriorities.mockResolvedValue(PRIORITIES);

      const response = await request(app)
        .get('/api/active-learning/priorities')
        .query({ modelId: 'model-1', minPriorityScore: '0.5', targetType: 'task' });

      expect(response.status).toBe(200);
      expect(response.body.priorities).toHaveLength(2);
      expect(response.body.priorities.every((p: any) => p.targetType === 'task')).toBe(true);
    });

    it('returns 400 when modelId missing', async () => {
      const response = await request(app).get('/api/active-learning/priorities');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelId query parameter is required');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.computeCollectionPriorities.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .get('/api/active-learning/priorities')
        .query({ modelId: 'model-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get collection priorities');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/priorities/:target
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/priorities/:target', () => {
    const PRIORITIES = {
      modelId: 'model-1',
      priorities: [{ target: 't1', targetType: 'task', priorityScore: 0.9 }],
    };

    it('returns the matching priority', async () => {
      mockActiveLearningService.computeCollectionPriorities.mockResolvedValue(PRIORITIES);

      const response = await request(app)
        .get('/api/active-learning/priorities/t1')
        .query({ modelId: 'model-1' });

      expect(response.status).toBe(200);
      expect(response.body.target).toBe('t1');
    });

    it('returns 400 when modelId missing', async () => {
      const response = await request(app).get('/api/active-learning/priorities/t1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelId query parameter is required');
    });

    it('returns 404 when target not in priorities', async () => {
      mockActiveLearningService.computeCollectionPriorities.mockResolvedValue(PRIORITIES);

      const response = await request(app)
        .get('/api/active-learning/priorities/unknown')
        .query({ modelId: 'model-1' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Target not found in priorities');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.computeCollectionPriorities.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .get('/api/active-learning/priorities/t1')
        .query({ modelId: 'model-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get priority details');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/active-learning/targets
  // --------------------------------------------------------------------------

  describe('POST /api/active-learning/targets', () => {
    const VALID_TARGET = {
      targetType: 'task',
      targetName: 'pick_place',
      estimatedDemos: 100,
      priorityScore: 0.5,
    };

    it('creates a collection target (201)', async () => {
      mockActiveLearningService.createCollectionTarget.mockResolvedValue({
        id: 'target-1',
        ...VALID_TARGET,
      });

      const response = await request(app)
        .post('/api/active-learning/targets')
        .send(VALID_TARGET);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('target-1');
      expect(mockActiveLearningService.createCollectionTarget).toHaveBeenCalledWith(
        'task',
        'pick_place',
        100,
        0.5
      );
    });

    it('returns 400 when required fields missing', async () => {
      const response = await request(app)
        .post('/api/active-learning/targets')
        .send({ targetType: 'task' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'targetType, targetName, and estimatedDemos are required'
      );
    });

    it('returns 400 for invalid targetType', async () => {
      const response = await request(app)
        .post('/api/active-learning/targets')
        .send({ targetType: 'bogus', targetName: 'x', estimatedDemos: 10 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid targetType');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.createCollectionTarget.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/active-learning/targets')
        .send(VALID_TARGET);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create collection target');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/targets
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/targets', () => {
    it('lists collection targets', async () => {
      mockActiveLearningService.listCollectionTargets.mockResolvedValue([{ id: 'a' }]);

      const response = await request(app)
        .get('/api/active-learning/targets')
        .query({ status: 'active', targetType: 'task', minPriorityScore: '0.4' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 1, targets: [{ id: 'a' }] });
      expect(mockActiveLearningService.listCollectionTargets).toHaveBeenCalledWith({
        status: 'active',
        targetType: 'task',
        minPriorityScore: 0.4,
      });
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.listCollectionTargets.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/active-learning/targets');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list collection targets');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/targets/:id
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/targets/:id', () => {
    it('returns a collection target', async () => {
      mockActiveLearningService.getCollectionTarget.mockResolvedValue({ id: 'target-1' });

      const response = await request(app).get('/api/active-learning/targets/target-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('target-1');
      expect(mockActiveLearningService.getCollectionTarget).toHaveBeenCalledWith('target-1');
    });

    it('returns 404 when not found', async () => {
      mockActiveLearningService.getCollectionTarget.mockResolvedValue(null);

      const response = await request(app).get('/api/active-learning/targets/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Collection target not found');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.getCollectionTarget.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/active-learning/targets/target-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get collection target');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/active-learning/targets/:id/progress
  // --------------------------------------------------------------------------

  describe('POST /api/active-learning/targets/:id/progress', () => {
    it('updates collection progress', async () => {
      mockActiveLearningService.updateCollectionProgress.mockResolvedValue({
        id: 'target-1',
        status: 'in_progress',
        collectedDemos: 50,
        estimatedDemos: 100,
      });

      const response = await request(app)
        .post('/api/active-learning/targets/target-1/progress')
        .send({ demosCollected: 50, uncertaintyAfter: 0.2 });

      expect(response.status).toBe(200);
      expect(response.body.isCompleted).toBe(false);
      expect(response.body.progress).toBe(0.5);
      expect(mockActiveLearningService.updateCollectionProgress).toHaveBeenCalledWith(
        'target-1',
        50,
        0.2
      );
    });

    it('reports completion when status is completed', async () => {
      mockActiveLearningService.updateCollectionProgress.mockResolvedValue({
        id: 'target-1',
        status: 'completed',
        collectedDemos: 100,
        estimatedDemos: 100,
      });

      const response = await request(app)
        .post('/api/active-learning/targets/target-1/progress')
        .send({ demosCollected: 100 });

      expect(response.status).toBe(200);
      expect(response.body.isCompleted).toBe(true);
      expect(response.body.progress).toBe(1);
    });

    it('returns 400 for negative demosCollected', async () => {
      const response = await request(app)
        .post('/api/active-learning/targets/target-1/progress')
        .send({ demosCollected: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('demosCollected must be a non-negative number');
    });

    it('returns 404 when target not found', async () => {
      mockActiveLearningService.updateCollectionProgress.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/active-learning/targets/missing/progress')
        .send({ demosCollected: 10 });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Collection target not found');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.updateCollectionProgress.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/active-learning/targets/target-1/progress')
        .send({ demosCollected: 10 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update collection progress');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/summary
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/summary', () => {
    it('returns progress summary', async () => {
      mockActiveLearningService.getProgressSummary.mockResolvedValue({ total: 5 });

      const response = await request(app).get('/api/active-learning/summary');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(5);
      expect(mockActiveLearningService.getProgressSummary).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.getProgressSummary.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/active-learning/summary');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get progress summary');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/diversity/:modelId
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/diversity/:modelId', () => {
    it('returns diversity analysis', async () => {
      mockActiveLearningService.computeDiversityAnalysis.mockResolvedValue({ score: 0.7 });

      const response = await request(app).get('/api/active-learning/diversity/model-1');

      expect(response.status).toBe(200);
      expect(response.body.score).toBe(0.7);
      expect(mockActiveLearningService.computeDiversityAnalysis).toHaveBeenCalledWith('model-1');
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.computeDiversityAnalysis.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/active-learning/diversity/model-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compute diversity analysis');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/active-learning/config
  // --------------------------------------------------------------------------

  describe('GET /api/active-learning/config', () => {
    it('returns the scoring config', async () => {
      mockActiveLearningService.getConfig.mockReturnValue({ weightUncertainty: 0.5 });

      const response = await request(app).get('/api/active-learning/config');

      expect(response.status).toBe(200);
      expect(response.body.weightUncertainty).toBe(0.5);
      expect(mockActiveLearningService.getConfig).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.getConfig.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/active-learning/config');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get configuration');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/active-learning/config
  // --------------------------------------------------------------------------

  describe('PUT /api/active-learning/config', () => {
    it('updates the scoring config', async () => {
      mockActiveLearningService.updateConfig.mockReturnValue({ weightUncertainty: 0.8 });

      const response = await request(app)
        .put('/api/active-learning/config')
        .send({ weightUncertainty: 0.8 });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Configuration updated');
      expect(response.body.config.weightUncertainty).toBe(0.8);
      expect(mockActiveLearningService.updateConfig).toHaveBeenCalledWith({
        weightUncertainty: 0.8,
      });
    });

    it('returns 500 on service error', async () => {
      mockActiveLearningService.updateConfig.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .put('/api/active-learning/config')
        .send({ weightUncertainty: 0.8 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update configuration');
    });
  });
});

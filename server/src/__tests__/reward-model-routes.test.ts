/**
 * @file reward-model-routes.test.ts
 * @description Integration tests for the reward-model evaluation routes
 *   (TASK-179 §3): POST /api/evaluation/reward-model,
 *   GET /api/evaluation/reward-model/:jobId, GET /api/evaluation/rewards.
 * @feature evaluation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockEvaluationService } = vi.hoisted(() => ({
  mockEvaluationService: {
    startRewardModelEvaluation: vi.fn(),
    getRewardModelJob: vi.fn(),
    getRewards: vi.fn(),
    recordEpisode: vi.fn(),
    getEpisodes: vi.fn(),
    getSuccessRate: vi.fn(),
    getErrorBreakdown: vi.fn(),
    compareModels: vi.fn(),
    getEpisodeById: vi.fn(),
  },
}));

vi.mock('../services/EvaluationService.js', () => ({
  evaluationService: mockEvaluationService,
}));

vi.mock('../services/RobotManager.js', () => ({
  robotManager: { getRegisteredRobot: vi.fn() },
}));

vi.mock('../repositories/index.js', () => ({
  modelVersionRepository: { findById: vi.fn() },
  skillDefinitionRepository: { findById: vi.fn() },
}));

vi.mock('../services/HttpClient.js', () => ({
  HttpClient: class {
    post = vi.fn();
  },
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { evaluationRoutes } from '../routes/evaluation.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/evaluation', authMiddleware as any, evaluationRoutes);
  return app;
}

const REWARD = {
  id: 'er-1',
  datasetId: 'ds-1',
  episodeIndex: 0,
  rewardType: 'robometer',
  score: 0.87,
  success: true,
  curve: [0.1, 0.4, 0.87],
  fps: 30,
  jobId: 'job-rm-1',
  createdAt: '2026-07-07T10:00:00.000Z',
};

describe('Reward-Model Evaluation Routes (TASK-179)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/evaluation/reward-model
  // --------------------------------------------------------------------------

  describe('POST /api/evaluation/reward-model', () => {
    it('creates a reward_model job (201 { jobId })', async () => {
      mockEvaluationService.startRewardModelEvaluation.mockResolvedValue({ jobId: 'job-rm-1' });

      const response = await request(app).post('/api/evaluation/reward-model').send({
        datasetId: 'ds-1',
        rewardType: 'robometer',
        episodes: [0, 1],
        task: 'pick up the cube',
        imageKey: 'observation.images.top',
        maxFrames: 300,
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ jobId: 'job-rm-1' });
      expect(mockEvaluationService.startRewardModelEvaluation).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        rewardType: 'robometer',
        episodes: [0, 1],
        task: 'pick up the cube',
        imageKey: 'observation.images.top',
        maxFrames: 300,
      });
    });

    it('returns 400 when datasetId is missing', async () => {
      const response = await request(app)
        .post('/api/evaluation/reward-model')
        .send({ rewardType: 'robometer' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('datasetId is required');
      expect(mockEvaluationService.startRewardModelEvaluation).not.toHaveBeenCalled();
    });

    it('returns 400 for an unknown rewardType', async () => {
      const response = await request(app)
        .post('/api/evaluation/reward-model')
        .send({ datasetId: 'ds-1', rewardType: 'cosmos3' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('rewardType must be one of');
      expect(mockEvaluationService.startRewardModelEvaluation).not.toHaveBeenCalled();
    });

    it('returns 400 when episodes is not an array', async () => {
      const response = await request(app)
        .post('/api/evaluation/reward-model')
        .send({ datasetId: 'ds-1', rewardType: 'topreward', episodes: 'all' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('episodes must be an array');
    });

    it('returns 400 when the service throws (e.g. dataset not ready)', async () => {
      mockEvaluationService.startRewardModelEvaluation.mockRejectedValue(
        new Error('Dataset not ready: ds-1 (status: validating)')
      );

      const response = await request(app)
        .post('/api/evaluation/reward-model')
        .send({ datasetId: 'ds-1', rewardType: 'robometer' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Dataset not ready');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/reward-model/:jobId
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/reward-model/:jobId', () => {
    it('returns job status + rewards', async () => {
      mockEvaluationService.getRewardModelJob.mockResolvedValue({
        job: { id: 'job-rm-1', status: 'completed', progress: 100 },
        rewards: [REWARD],
      });

      const response = await request(app).get('/api/evaluation/reward-model/job-rm-1');

      expect(response.status).toBe(200);
      expect(response.body.job.status).toBe('completed');
      expect(response.body.rewards).toHaveLength(1);
      expect(response.body.rewards[0].curve).toEqual([0.1, 0.4, 0.87]);
      expect(mockEvaluationService.getRewardModelJob).toHaveBeenCalledWith('job-rm-1');
    });

    it('returns 404 when the job does not exist', async () => {
      mockEvaluationService.getRewardModelJob.mockResolvedValue(null);

      const response = await request(app).get('/api/evaluation/reward-model/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Reward-model job not found');
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.getRewardModelJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/evaluation/reward-model/job-rm-1');

      expect(response.status).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/rewards
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/rewards', () => {
    it('lists rewards for a dataset with parsed curves', async () => {
      mockEvaluationService.getRewards.mockResolvedValue([REWARD]);

      const response = await request(app).get('/api/evaluation/rewards?datasetId=ds-1');

      expect(response.status).toBe(200);
      expect(response.body.rewards).toHaveLength(1);
      expect(Array.isArray(response.body.rewards[0].curve)).toBe(true);
      expect(response.body.rewards[0].curve).toEqual([0.1, 0.4, 0.87]);
      expect(mockEvaluationService.getRewards).toHaveBeenCalledWith('ds-1', undefined);
    });

    it('passes the optional rewardType filter through', async () => {
      mockEvaluationService.getRewards.mockResolvedValue([]);

      const response = await request(app).get(
        '/api/evaluation/rewards?datasetId=ds-1&rewardType=topreward'
      );

      expect(response.status).toBe(200);
      expect(mockEvaluationService.getRewards).toHaveBeenCalledWith('ds-1', 'topreward');
    });

    it('returns 400 when datasetId is missing', async () => {
      const response = await request(app).get('/api/evaluation/rewards');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('datasetId query parameter is required');
    });

    it('returns 400 for an unknown rewardType filter', async () => {
      const response = await request(app).get(
        '/api/evaluation/rewards?datasetId=ds-1&rewardType=bogus'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('rewardType must be one of');
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.getRewards.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/evaluation/rewards?datasetId=ds-1');

      expect(response.status).toBe(500);
    });
  });
});

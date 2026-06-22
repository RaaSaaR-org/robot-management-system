/**
 * @file evaluation-routes.test.ts
 * @description Integration tests for VLA model evaluation routes
 * @feature evaluation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const {
  mockEvaluationService,
  mockRobotManager,
  mockModelVersionRepository,
  mockSkillDefinitionRepository,
  mockHttpClientPost,
  MockHttpClient,
} = vi.hoisted(() => {
  const mockHttpClientPost = vi.fn();
  return {
    mockEvaluationService: {
      recordEpisode: vi.fn(),
      getEpisodes: vi.fn(),
      getSuccessRate: vi.fn(),
      getErrorBreakdown: vi.fn(),
      compareModels: vi.fn(),
      getEpisodeById: vi.fn(),
    },
    mockRobotManager: {
      getRegisteredRobot: vi.fn(),
    },
    mockModelVersionRepository: {
      findById: vi.fn(),
    },
    mockSkillDefinitionRepository: {
      findById: vi.fn(),
    },
    mockHttpClientPost,
    MockHttpClient: class {
      baseUrl: string;
      timeout: number;
      constructor(baseUrl?: string, timeout?: number) {
        this.baseUrl = baseUrl ?? '';
        this.timeout = timeout ?? 0;
      }
      post = mockHttpClientPost;
    },
  };
});

vi.mock('../services/EvaluationService.js', () => ({
  evaluationService: mockEvaluationService,
}));

vi.mock('../services/RobotManager.js', () => ({
  robotManager: mockRobotManager,
}));

vi.mock('../repositories/index.js', () => ({
  modelVersionRepository: mockModelVersionRepository,
  skillDefinitionRepository: mockSkillDefinitionRepository,
}));

vi.mock('../services/HttpClient.js', () => ({
  HttpClient: MockHttpClient,
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

const EPISODE = {
  id: 'ep-001',
  robotId: 'robot-1',
  modelVersion: 'smolvla-v1',
  taskPrompt: 'pick up the cube',
  success: true,
  errorType: null,
  durationMs: 1234,
  createdAt: '2026-06-22T00:00:00.000Z',
};

describe('Evaluation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/evaluation/episodes
  // --------------------------------------------------------------------------

  describe('POST /api/evaluation/episodes', () => {
    it('records a new evaluation episode (201)', async () => {
      mockEvaluationService.recordEpisode.mockResolvedValue(EPISODE);

      const response = await request(app)
        .post('/api/evaluation/episodes')
        .send({
          robotId: 'robot-1',
          modelVersion: 'smolvla-v1',
          taskPrompt: 'pick up the cube',
          success: true,
          durationMs: 1234,
        });

      expect(response.status).toBe(201);
      expect(response.body.episode.id).toBe('ep-001');
      expect(response.body.message).toBe('Evaluation episode recorded successfully');
      expect(mockEvaluationService.recordEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          robotId: 'robot-1',
          modelVersion: 'smolvla-v1',
          taskPrompt: 'pick up the cube',
          success: true,
          durationMs: 1234,
        })
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/evaluation/episodes')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId, modelVersion, and taskPrompt are required');
      expect(mockEvaluationService.recordEpisode).not.toHaveBeenCalled();
    });

    it('returns 400 with service error message on failure', async () => {
      mockEvaluationService.recordEpisode.mockRejectedValue(new Error('invalid robot'));

      const response = await request(app)
        .post('/api/evaluation/episodes')
        .send({
          robotId: 'robot-1',
          modelVersion: 'smolvla-v1',
          taskPrompt: 'pick up the cube',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid robot');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/episodes
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/episodes', () => {
    it('lists episodes with parsed filters', async () => {
      const result = { episodes: [EPISODE], total: 1, page: 2, limit: 10 };
      mockEvaluationService.getEpisodes.mockResolvedValue(result);

      const response = await request(app)
        .get('/api/evaluation/episodes')
        .query({
          robotId: 'robot-1',
          modelVersion: 'smolvla-v1',
          period: '24h',
          success: 'true',
          page: '2',
          limit: '10',
        });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockEvaluationService.getEpisodes).toHaveBeenCalledWith({
        robotId: 'robot-1',
        modelVersion: 'smolvla-v1',
        period: '24h',
        success: true,
        page: 2,
        limit: 10,
      });
    });

    it('lists episodes with undefined filters when no query', async () => {
      mockEvaluationService.getEpisodes.mockResolvedValue({ episodes: [], total: 0 });

      const response = await request(app).get('/api/evaluation/episodes');

      expect(response.status).toBe(200);
      expect(mockEvaluationService.getEpisodes).toHaveBeenCalledWith({
        robotId: undefined,
        modelVersion: undefined,
        period: undefined,
        success: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.getEpisodes.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/evaluation/episodes');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list evaluation episodes');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/success-rate
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/success-rate', () => {
    it('returns success rate with provided params', async () => {
      mockEvaluationService.getSuccessRate.mockResolvedValue({ rate: 0.9, total: 10 });

      const response = await request(app)
        .get('/api/evaluation/success-rate')
        .query({ robotId: 'robot-1', modelVersion: 'smolvla-v1', period: '7d' });

      expect(response.status).toBe(200);
      expect(response.body.rate).toBe(0.9);
      expect(mockEvaluationService.getSuccessRate).toHaveBeenCalledWith(
        'robot-1',
        'smolvla-v1',
        '7d'
      );
    });

    it('defaults period to 24h when not provided', async () => {
      mockEvaluationService.getSuccessRate.mockResolvedValue({ rate: 1, total: 1 });

      const response = await request(app).get('/api/evaluation/success-rate');

      expect(response.status).toBe(200);
      expect(mockEvaluationService.getSuccessRate).toHaveBeenCalledWith(
        undefined,
        undefined,
        '24h'
      );
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.getSuccessRate.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/evaluation/success-rate');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get success rate');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/error-breakdown
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/error-breakdown', () => {
    it('returns error breakdown wrapped in { errors }', async () => {
      const breakdown = [{ errorType: 'collision', count: 3 }];
      mockEvaluationService.getErrorBreakdown.mockResolvedValue(breakdown);

      const response = await request(app)
        .get('/api/evaluation/error-breakdown')
        .query({ robotId: 'robot-1', modelVersion: 'smolvla-v1', period: '7d' });

      expect(response.status).toBe(200);
      expect(response.body.errors).toEqual(breakdown);
      expect(mockEvaluationService.getErrorBreakdown).toHaveBeenCalledWith(
        'robot-1',
        'smolvla-v1',
        '7d'
      );
    });

    it('defaults period to 24h when not provided', async () => {
      mockEvaluationService.getErrorBreakdown.mockResolvedValue([]);

      const response = await request(app).get('/api/evaluation/error-breakdown');

      expect(response.status).toBe(200);
      expect(mockEvaluationService.getErrorBreakdown).toHaveBeenCalledWith(
        undefined,
        undefined,
        '24h'
      );
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.getErrorBreakdown.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/evaluation/error-breakdown');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get error breakdown');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/compare
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/compare', () => {
    it('compares two model versions', async () => {
      mockEvaluationService.compareModels.mockResolvedValue({ winner: 'versionB' });

      const response = await request(app)
        .get('/api/evaluation/compare')
        .query({ versionA: 'v1', versionB: 'v2', period: '24h' });

      expect(response.status).toBe(200);
      expect(response.body.winner).toBe('versionB');
      expect(mockEvaluationService.compareModels).toHaveBeenCalledWith('v1', 'v2', '24h');
    });

    it('defaults period to 7d when not provided', async () => {
      mockEvaluationService.compareModels.mockResolvedValue({ winner: 'versionA' });

      const response = await request(app)
        .get('/api/evaluation/compare')
        .query({ versionA: 'v1', versionB: 'v2' });

      expect(response.status).toBe(200);
      expect(mockEvaluationService.compareModels).toHaveBeenCalledWith('v1', 'v2', '7d');
    });

    it('returns 400 when versionA or versionB is missing', async () => {
      const response = await request(app)
        .get('/api/evaluation/compare')
        .query({ versionA: 'v1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('versionA and versionB are required');
      expect(mockEvaluationService.compareModels).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.compareModels.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .get('/api/evaluation/compare')
        .query({ versionA: 'v1', versionB: 'v2' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compare models');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/evaluation/run-hardware
  // --------------------------------------------------------------------------

  describe('POST /api/evaluation/run-hardware', () => {
    const SKILL = {
      id: 'skill-1',
      name: 'Pick Cube',
      linkedModelVersionId: 'mv-1',
    };
    const ROBOT = { id: 'robot-1', baseUrl: 'http://robot-1.local' };

    it('triggers a hardware evaluation run (200)', async () => {
      mockSkillDefinitionRepository.findById.mockResolvedValue(SKILL);
      mockRobotManager.getRegisteredRobot.mockResolvedValue(ROBOT);
      mockModelVersionRepository.findById.mockResolvedValue({ artifactUri: 's3://model' });
      mockHttpClientPost.mockResolvedValue({ runId: 'run-1', episodes: 5 });

      const response = await request(app)
        .post('/api/evaluation/run-hardware')
        .send({ robotId: 'robot-1', skillId: 'skill-1', episodes: 5 });

      expect(response.status).toBe(200);
      expect(response.body.summary).toEqual({ runId: 'run-1', episodes: 5 });
      expect(mockSkillDefinitionRepository.findById).toHaveBeenCalledWith('skill-1');
      expect(mockRobotManager.getRegisteredRobot).toHaveBeenCalledWith('robot-1');
      expect(mockModelVersionRepository.findById).toHaveBeenCalledWith('mv-1');
      expect(mockHttpClientPost).toHaveBeenCalledWith(
        '/api/v1/robots/robot-1/evaluation/run',
        expect.objectContaining({
          skillId: 'skill-1',
          modelVersionId: 'mv-1',
          artifactUri: 's3://model',
          taskPrompt: 'Execute skill Pick Cube',
          episodes: 5,
          maxStepsPerEpisode: 200,
        })
      );
    });

    it('returns 400 when robotId or skillId is missing', async () => {
      const response = await request(app)
        .post('/api/evaluation/run-hardware')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId and skillId are required');
      expect(mockSkillDefinitionRepository.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when skill not found', async () => {
      mockSkillDefinitionRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/evaluation/run-hardware')
        .send({ robotId: 'robot-1', skillId: 'skill-x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill not found');
    });

    it('returns 404 when robot not registered', async () => {
      mockSkillDefinitionRepository.findById.mockResolvedValue(SKILL);
      mockRobotManager.getRegisteredRobot.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/evaluation/run-hardware')
        .send({ robotId: 'robot-1', skillId: 'skill-1' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Robot not registered');
    });

    it('uses default taskPrompt/episodes and skips model lookup when no linked model', async () => {
      mockSkillDefinitionRepository.findById.mockResolvedValue({
        id: 'skill-2',
        name: 'Wave',
        linkedModelVersionId: null,
      });
      mockRobotManager.getRegisteredRobot.mockResolvedValue(ROBOT);
      mockHttpClientPost.mockResolvedValue({ runId: 'run-2' });

      const response = await request(app)
        .post('/api/evaluation/run-hardware')
        .send({ robotId: 'robot-1', skillId: 'skill-2' });

      expect(response.status).toBe(200);
      expect(mockModelVersionRepository.findById).not.toHaveBeenCalled();
      expect(mockHttpClientPost).toHaveBeenCalledWith(
        '/api/v1/robots/robot-1/evaluation/run',
        expect.objectContaining({
          taskPrompt: 'Execute skill Wave',
          episodes: 5,
          maxStepsPerEpisode: 200,
          artifactUri: undefined,
        })
      );
    });

    it('returns 500 with error message when http call fails', async () => {
      mockSkillDefinitionRepository.findById.mockResolvedValue(SKILL);
      mockRobotManager.getRegisteredRobot.mockResolvedValue(ROBOT);
      mockModelVersionRepository.findById.mockResolvedValue({ artifactUri: 's3://model' });
      mockHttpClientPost.mockRejectedValue(new Error('agent unreachable'));

      const response = await request(app)
        .post('/api/evaluation/run-hardware')
        .send({ robotId: 'robot-1', skillId: 'skill-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('agent unreachable');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/evaluation/episodes/:id
  // --------------------------------------------------------------------------

  describe('GET /api/evaluation/episodes/:id', () => {
    it('returns episode detail', async () => {
      mockEvaluationService.getEpisodeById.mockResolvedValue(EPISODE);

      const response = await request(app).get('/api/evaluation/episodes/ep-001');

      expect(response.status).toBe(200);
      expect(response.body.episode.id).toBe('ep-001');
      expect(mockEvaluationService.getEpisodeById).toHaveBeenCalledWith('ep-001');
    });

    it('returns 404 when episode not found', async () => {
      mockEvaluationService.getEpisodeById.mockResolvedValue(null);

      const response = await request(app).get('/api/evaluation/episodes/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Evaluation episode not found');
    });

    it('returns 500 on service error', async () => {
      mockEvaluationService.getEpisodeById.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/evaluation/episodes/ep-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get evaluation episode');
    });
  });
});

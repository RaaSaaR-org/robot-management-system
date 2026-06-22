/**
 * @file uncertainty-routes.test.ts
 * @description Integration tests for ensemble uncertainty / active-learning routes
 * @feature Active Learning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockEnsembleUncertainty } = vi.hoisted(() => ({
  mockEnsembleUncertainty: {
    rankEpisodes: vi.fn(),
    computeJSD: vi.fn(),
    computeMCDropout: vi.fn(),
  },
}));

vi.mock('../services/EnsembleUncertainty.js', () => ({
  ensembleUncertainty: mockEnsembleUncertainty,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { uncertaintyRoutes } from '../routes/uncertainty.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/uncertainty', authMiddleware as any, uncertaintyRoutes);
  return app;
}

describe('Uncertainty Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/uncertainty/rank
  // --------------------------------------------------------------------------

  describe('POST /api/uncertainty/rank', () => {
    it('ranks episodes by ensemble uncertainty', async () => {
      const episodes = [
        { episodeId: 'ep-1', predictions: [[0.9, 0.1], [0.5, 0.5]] },
        { episodeId: 'ep-2', predictions: [[0.6, 0.4], [0.6, 0.4]] },
      ];
      const ranked = [
        { episodeId: 'ep-1', jsd: 0.3, epistemic: 0.04, aleatoric: 0.01, score: 0.2, rank: 1 },
        { episodeId: 'ep-2', jsd: 0.0, epistemic: 0.0, aleatoric: 0.0, score: 0.0, rank: 2 },
      ];
      mockEnsembleUncertainty.rankEpisodes.mockReturnValue(ranked);

      const response = await request(app)
        .post('/api/uncertainty/rank')
        .send({ episodes });

      expect(response.status).toBe(200);
      expect(response.body.ranked).toEqual(ranked);
      expect(typeof response.body.timestamp).toBe('string');
      expect(mockEnsembleUncertainty.rankEpisodes).toHaveBeenCalledWith(episodes);
    });

    it('returns 400 when episodes is not an array', async () => {
      const response = await request(app)
        .post('/api/uncertainty/rank')
        .send({ episodes: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('episodes must be an array');
      expect(mockEnsembleUncertainty.rankEpisodes).not.toHaveBeenCalled();
    });

    it('returns 400 when episodes is missing', async () => {
      const response = await request(app).post('/api/uncertainty/rank').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('episodes must be an array');
    });

    it('returns 500 when the service throws', async () => {
      mockEnsembleUncertainty.rankEpisodes.mockImplementation(() => {
        throw new Error('compute failure');
      });

      const response = await request(app)
        .post('/api/uncertainty/rank')
        .send({ episodes: [] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to rank episodes: compute failure');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/uncertainty/jsd
  // --------------------------------------------------------------------------

  describe('POST /api/uncertainty/jsd', () => {
    it('computes Jensen-Shannon Divergence', async () => {
      const predictions = [[0.9, 0.1], [0.5, 0.5]];
      mockEnsembleUncertainty.computeJSD.mockReturnValue(0.123);

      const response = await request(app)
        .post('/api/uncertainty/jsd')
        .send({ predictions });

      expect(response.status).toBe(200);
      expect(response.body.jsd).toBe(0.123);
      expect(mockEnsembleUncertainty.computeJSD).toHaveBeenCalledWith(predictions);
    });

    it('returns 400 when predictions is not an array', async () => {
      const response = await request(app)
        .post('/api/uncertainty/jsd')
        .send({ predictions: 42 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('predictions must be an array');
      expect(mockEnsembleUncertainty.computeJSD).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockEnsembleUncertainty.computeJSD.mockImplementation(() => {
        throw new Error('jsd boom');
      });

      const response = await request(app)
        .post('/api/uncertainty/jsd')
        .send({ predictions: [[0.5, 0.5]] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compute JSD: jsd boom');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/uncertainty/mcdropout
  // --------------------------------------------------------------------------

  describe('POST /api/uncertainty/mcdropout', () => {
    it('computes MC Dropout statistics', async () => {
      const predictions = [[0.9, 0.1], [0.7, 0.3], [0.8, 0.2]];
      const result = { mean: [0.8, 0.2], variance: [0.0066, 0.0066], uncertainty: 0.0066 };
      mockEnsembleUncertainty.computeMCDropout.mockReturnValue(result);

      const response = await request(app)
        .post('/api/uncertainty/mcdropout')
        .send({ predictions });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(result);
      expect(mockEnsembleUncertainty.computeMCDropout).toHaveBeenCalledWith(predictions);
    });

    it('returns 400 when predictions is not an array', async () => {
      const response = await request(app)
        .post('/api/uncertainty/mcdropout')
        .send({ predictions: { not: 'array' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('predictions must be an array');
      expect(mockEnsembleUncertainty.computeMCDropout).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockEnsembleUncertainty.computeMCDropout.mockImplementation(() => {
        throw new Error('mc boom');
      });

      const response = await request(app)
        .post('/api/uncertainty/mcdropout')
        .send({ predictions: [[0.5, 0.5]] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compute MC Dropout: mc boom');
    });
  });
});

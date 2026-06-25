/**
 * @file simulation-routes.test.ts
 * @description Integration tests for simulation job management routes
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockSimulationService, mockFs } = vi.hoisted(() => ({
  mockSimulationService: {
    submitJob: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    cancelJob: vi.fn(),
    getAvailableEnvironments: vi.fn(),
    getSimToRealComparison: vi.fn(),
    getFramesDir: vi.fn(),
    getEnvironmentPreview: vi.fn(),
    generateSceneFromTwin: vi.fn(),
  },
  mockFs: {
    existsSync: vi.fn(),
    createReadStream: vi.fn(),
  },
}));

vi.mock('../services/SimulationService.js', () => ({
  simulationService: mockSimulationService,
}));

vi.mock('fs', () => ({
  existsSync: mockFs.existsSync,
  createReadStream: mockFs.createReadStream,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { simulationRoutes } from '../routes/simulation.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/simulation', authMiddleware as any, simulationRoutes);
  return app;
}

const MOCK_JOB = {
  id: 'sim-001',
  modelId: 'model-abc',
  environment: 'kitchen',
  rolloutCount: 5,
  backend: 'mujoco',
  status: 'queued',
};

describe('Simulation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/simulation/jobs
  // --------------------------------------------------------------------------

  describe('POST /api/simulation/jobs', () => {
    it('submits a new simulation job', async () => {
      mockSimulationService.submitJob.mockReturnValue(MOCK_JOB);

      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ modelId: 'model-abc', environment: 'kitchen', rolloutCount: 5, backend: 'mujoco' });

      expect(response.status).toBe(201);
      expect(response.body.job.id).toBe('sim-001');
      expect(response.body.message).toBe('Simulation job submitted successfully');
      expect(mockSimulationService.submitJob).toHaveBeenCalledWith('model-abc', 'kitchen', 5, 'mujoco');
    });

    it('returns 400 when modelId is missing', async () => {
      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ environment: 'kitchen', rolloutCount: 5, backend: 'mujoco' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelId is required');
      expect(mockSimulationService.submitJob).not.toHaveBeenCalled();
    });

    it('returns 400 when environment is missing', async () => {
      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ modelId: 'model-abc', rolloutCount: 5, backend: 'mujoco' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('environment or sceneId is required');
    });

    it('returns 400 when rolloutCount is missing', async () => {
      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ modelId: 'model-abc', environment: 'kitchen', backend: 'mujoco' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('rolloutCount is required and must be a number');
    });

    it('returns 400 when rolloutCount is not a number', async () => {
      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ modelId: 'model-abc', environment: 'kitchen', rolloutCount: 'five', backend: 'mujoco' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('rolloutCount is required and must be a number');
    });

    it('returns 400 when backend is missing', async () => {
      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ modelId: 'model-abc', environment: 'kitchen', rolloutCount: 5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('backend is required');
    });

    it('returns 400 when the service throws', async () => {
      mockSimulationService.submitJob.mockImplementation(() => {
        throw new Error('Unknown backend');
      });

      const response = await request(app)
        .post('/api/simulation/jobs')
        .send({ modelId: 'model-abc', environment: 'kitchen', rolloutCount: 5, backend: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unknown backend');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/simulation/jobs
  // --------------------------------------------------------------------------

  describe('GET /api/simulation/jobs', () => {
    it('lists all simulation jobs', async () => {
      mockSimulationService.listJobs.mockReturnValue([MOCK_JOB]);

      const response = await request(app).get('/api/simulation/jobs');

      expect(response.status).toBe(200);
      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.jobs[0].id).toBe('sim-001');
      expect(mockSimulationService.listJobs).toHaveBeenCalledWith({});
    });

    it('applies query filters', async () => {
      mockSimulationService.listJobs.mockReturnValue([]);

      const response = await request(app)
        .get('/api/simulation/jobs')
        .query({ modelId: 'model-abc', environment: 'kitchen', status: 'running' });

      expect(response.status).toBe(200);
      expect(mockSimulationService.listJobs).toHaveBeenCalledWith({
        modelId: 'model-abc',
        environment: 'kitchen',
        status: 'running',
      });
    });

    it('returns 500 on service error', async () => {
      mockSimulationService.listJobs.mockImplementation(() => {
        throw new Error('DB error');
      });

      const response = await request(app).get('/api/simulation/jobs');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/simulation/jobs/:id
  // --------------------------------------------------------------------------

  describe('GET /api/simulation/jobs/:id', () => {
    it('returns a specific job', async () => {
      mockSimulationService.getJob.mockReturnValue(MOCK_JOB);

      const response = await request(app).get('/api/simulation/jobs/sim-001');

      expect(response.status).toBe(200);
      expect(response.body.job.id).toBe('sim-001');
      expect(mockSimulationService.getJob).toHaveBeenCalledWith('sim-001');
    });

    it('returns 404 when job not found', async () => {
      mockSimulationService.getJob.mockReturnValue(undefined);

      const response = await request(app).get('/api/simulation/jobs/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Simulation job not found');
    });

    it('returns 500 on service error', async () => {
      mockSimulationService.getJob.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/simulation/jobs/sim-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/simulation/jobs/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/simulation/jobs/:id', () => {
    it('cancels a simulation job', async () => {
      mockSimulationService.cancelJob.mockReturnValue({ ...MOCK_JOB, status: 'failed' });

      const response = await request(app).delete('/api/simulation/jobs/sim-001');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Simulation job cancelled');
      expect(mockSimulationService.cancelJob).toHaveBeenCalledWith('sim-001');
    });

    it('returns 400 when the service throws', async () => {
      mockSimulationService.cancelJob.mockImplementation(() => {
        throw new Error('Cannot cancel completed job');
      });

      const response = await request(app).delete('/api/simulation/jobs/sim-001');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot cancel completed job');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/simulation/environments
  // --------------------------------------------------------------------------

  describe('GET /api/simulation/environments', () => {
    it('lists available environments', async () => {
      mockSimulationService.getAvailableEnvironments.mockReturnValue(['kitchen', 'warehouse']);

      const response = await request(app).get('/api/simulation/environments');

      expect(response.status).toBe(200);
      expect(response.body.environments).toEqual(['kitchen', 'warehouse']);
      expect(mockSimulationService.getAvailableEnvironments).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSimulationService.getAvailableEnvironments.mockImplementation(() => {
        throw new Error('fail');
      });

      const response = await request(app).get('/api/simulation/environments');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/simulation/comparison/:modelId
  // --------------------------------------------------------------------------

  describe('GET /api/simulation/comparison/:modelId', () => {
    it('returns sim-to-real comparison', async () => {
      mockSimulationService.getSimToRealComparison.mockReturnValue([{ metric: 'success', sim: 0.9, real: 0.8 }]);

      const response = await request(app).get('/api/simulation/comparison/model-abc');

      expect(response.status).toBe(200);
      expect(response.body.comparisons).toHaveLength(1);
      expect(mockSimulationService.getSimToRealComparison).toHaveBeenCalledWith('model-abc');
    });

    it('returns 500 on service error', async () => {
      mockSimulationService.getSimToRealComparison.mockImplementation(() => {
        throw new Error('fail');
      });

      const response = await request(app).get('/api/simulation/comparison/model-abc');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/simulation/jobs/:id/frames/:filename
  // --------------------------------------------------------------------------

  describe('GET /api/simulation/jobs/:id/frames/:filename', () => {
    it('serves a captured frame image', async () => {
      mockSimulationService.getFramesDir.mockReturnValue('/tmp/frames');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.createReadStream.mockReturnValue(Readable.from(['jpeg-bytes']));

      const response = await request(app).get('/api/simulation/jobs/sim-001/frames/frame_001.jpg');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(mockSimulationService.getFramesDir).toHaveBeenCalledWith('sim-001');
    });

    it('returns 404 when no frames dir for the job', async () => {
      mockSimulationService.getFramesDir.mockReturnValue(null);

      const response = await request(app).get('/api/simulation/jobs/sim-001/frames/frame_001.jpg');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No frames available for this job');
    });

    it('returns 404 when frame file does not exist', async () => {
      mockSimulationService.getFramesDir.mockReturnValue('/tmp/frames');
      mockFs.existsSync.mockReturnValue(false);

      const response = await request(app).get('/api/simulation/jobs/sim-001/frames/frame_001.jpg');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Frame not found');
    });

    it('returns 500 on service error', async () => {
      mockSimulationService.getFramesDir.mockImplementation(() => {
        throw new Error('fs fail');
      });

      const response = await request(app).get('/api/simulation/jobs/sim-001/frames/frame_001.jpg');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to serve frame');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/simulation/preview/:environment
  // --------------------------------------------------------------------------

  describe('GET /api/simulation/preview/:environment', () => {
    it('serves an environment preview image', async () => {
      mockSimulationService.getEnvironmentPreview.mockResolvedValue('/tmp/preview.jpg');
      mockFs.createReadStream.mockReturnValue(Readable.from(['preview-bytes']));

      const response = await request(app).get('/api/simulation/preview/kitchen');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
      expect(mockSimulationService.getEnvironmentPreview).toHaveBeenCalledWith('kitchen');
    });

    it('returns 404 when preview is not available', async () => {
      mockSimulationService.getEnvironmentPreview.mockResolvedValue(null);

      const response = await request(app).get('/api/simulation/preview/kitchen');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Preview not available');
    });

    it('returns 500 on service error', async () => {
      mockSimulationService.getEnvironmentPreview.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/simulation/preview/kitchen');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to serve preview');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/simulation/scenes/generate
  // --------------------------------------------------------------------------

  describe('POST /api/simulation/scenes/generate', () => {
    const MOCK_SCENE = { id: 'scene-1', twinId: 'twin-1', source: 'twin', mjcfKey: 'k' };

    it('generates a scene for a twin', async () => {
      mockSimulationService.generateSceneFromTwin.mockResolvedValue(MOCK_SCENE);

      const response = await request(app)
        .post('/api/simulation/scenes/generate')
        .send({ twinId: 'twin-1' });

      expect(response.status).toBe(201);
      expect(response.body.scene.id).toBe('scene-1');
      expect(mockSimulationService.generateSceneFromTwin).toHaveBeenCalledWith('twin-1');
    });

    it('returns 400 when twinId is missing', async () => {
      const response = await request(app).post('/api/simulation/scenes/generate').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('twinId is required');
      expect(mockSimulationService.generateSceneFromTwin).not.toHaveBeenCalled();
    });

    it('returns 404 when the twin is unknown', async () => {
      mockSimulationService.generateSceneFromTwin.mockRejectedValue(
        new Error('Unknown twin: twin-x')
      );

      const response = await request(app)
        .post('/api/simulation/scenes/generate')
        .send({ twinId: 'twin-x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Unknown twin: twin-x');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSimulationService.generateSceneFromTwin.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/simulation/scenes/generate')
        .send({ twinId: 'twin-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });
});

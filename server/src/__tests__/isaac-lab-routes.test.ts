/**
 * @file isaac-lab-routes.test.ts
 * @description Integration tests for Isaac Lab synthetic data generation routes
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockIsaacLabClient } = vi.hoisted(() => ({
  mockIsaacLabClient: {
    submitJob: vi.fn(),
    listJobs: vi.fn(),
    getJobStatus: vi.fn(),
    cancelJob: vi.fn(),
    getJobOutput: vi.fn(),
    healthCheck: vi.fn(),
    getCircuitBreakerState: vi.fn(),
    isMockMode: vi.fn(),
  },
}));

vi.mock('../services/IsaacLabClient.js', () => ({
  isaacLabClient: mockIsaacLabClient,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { isaacLabRoutes } from '../routes/isaac-lab.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/isaac-lab', authMiddleware as any, isaacLabRoutes);
  return app;
}

const MOCK_JOB = {
  id: 'job-001',
  datasetId: 'ds-001',
  status: 'queued',
  config: { sceneType: 'warehouse', modalities: ['rgb', 'depth'] },
  progress: 0,
  createdAt: '2026-06-22T00:00:00.000Z',
  updatedAt: '2026-06-22T00:00:00.000Z',
};

describe('Isaac Lab Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/isaac-lab/jobs
  // --------------------------------------------------------------------------

  describe('POST /api/isaac-lab/jobs', () => {
    const validBody = {
      datasetId: 'ds-001',
      config: { sceneType: 'warehouse', modalities: ['rgb', 'depth'] },
    };

    it('submits a job successfully (201)', async () => {
      mockIsaacLabClient.submitJob.mockResolvedValue(MOCK_JOB);

      const response = await request(app).post('/api/isaac-lab/jobs').send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('job-001');
      expect(response.body.status).toBe('queued');
      expect(mockIsaacLabClient.submitJob).toHaveBeenCalledWith('ds-001', validBody.config);
    });

    it('returns 400 when datasetId is missing', async () => {
      const response = await request(app)
        .post('/api/isaac-lab/jobs')
        .send({ config: validBody.config });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('datasetId is required');
      expect(mockIsaacLabClient.submitJob).not.toHaveBeenCalled();
    });

    it('returns 400 when config is missing', async () => {
      const response = await request(app)
        .post('/api/isaac-lab/jobs')
        .send({ datasetId: 'ds-001' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('config is required');
    });

    it('returns 400 when config.sceneType is missing', async () => {
      const response = await request(app)
        .post('/api/isaac-lab/jobs')
        .send({ datasetId: 'ds-001', config: { modalities: ['rgb'] } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('config.sceneType is required');
    });

    it('returns 400 when modalities is empty', async () => {
      const response = await request(app)
        .post('/api/isaac-lab/jobs')
        .send({ datasetId: 'ds-001', config: { sceneType: 'warehouse', modalities: [] } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('config.modalities must be a non-empty array');
    });

    it('returns 400 when modalities is not an array', async () => {
      const response = await request(app)
        .post('/api/isaac-lab/jobs')
        .send({ datasetId: 'ds-001', config: { sceneType: 'warehouse', modalities: 'rgb' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('config.modalities must be a non-empty array');
    });

    it('returns 503 when circuit breaker is open', async () => {
      mockIsaacLabClient.submitJob.mockRejectedValue(
        new Error('Circuit breaker is OPEN — Isaac Lab service unavailable')
      );

      const response = await request(app).post('/api/isaac-lab/jobs').send(validBody);

      expect(response.status).toBe(503);
      expect(response.body.error).toContain('Circuit breaker');
    });

    it('returns 500 on unexpected service error', async () => {
      mockIsaacLabClient.submitJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/isaac-lab/jobs').send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to submit Isaac Lab job');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/isaac-lab/jobs
  // --------------------------------------------------------------------------

  describe('GET /api/isaac-lab/jobs', () => {
    it('lists jobs without filters', async () => {
      mockIsaacLabClient.listJobs.mockResolvedValue([MOCK_JOB]);

      const response = await request(app).get('/api/isaac-lab/jobs');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('job-001');
      expect(mockIsaacLabClient.listJobs).toHaveBeenCalledWith({});
    });

    it('lists jobs with status and datasetId filters', async () => {
      mockIsaacLabClient.listJobs.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/isaac-lab/jobs')
        .query({ status: 'running', datasetId: 'ds-001' });

      expect(response.status).toBe(200);
      expect(mockIsaacLabClient.listJobs).toHaveBeenCalledWith({
        status: 'running',
        datasetId: 'ds-001',
      });
    });

    it('returns 500 on service error', async () => {
      mockIsaacLabClient.listJobs.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/isaac-lab/jobs');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list Isaac Lab jobs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/isaac-lab/jobs/:id
  // --------------------------------------------------------------------------

  describe('GET /api/isaac-lab/jobs/:id', () => {
    it('returns job status', async () => {
      mockIsaacLabClient.getJobStatus.mockResolvedValue(MOCK_JOB);

      const response = await request(app).get('/api/isaac-lab/jobs/job-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('job-001');
      expect(mockIsaacLabClient.getJobStatus).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when job not found', async () => {
      mockIsaacLabClient.getJobStatus.mockRejectedValue(new Error("Job 'job-x' not found"));

      const response = await request(app).get('/api/isaac-lab/jobs/job-x');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('returns 500 on unexpected error', async () => {
      mockIsaacLabClient.getJobStatus.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/isaac-lab/jobs/job-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get job status');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/isaac-lab/jobs/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/isaac-lab/jobs/:id', () => {
    it('cancels a job', async () => {
      mockIsaacLabClient.cancelJob.mockResolvedValue({ ...MOCK_JOB, status: 'cancelled' });

      const response = await request(app).delete('/api/isaac-lab/jobs/job-001');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
      expect(mockIsaacLabClient.cancelJob).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when job not found', async () => {
      mockIsaacLabClient.cancelJob.mockRejectedValue(new Error("Job 'job-x' not found"));

      const response = await request(app).delete('/api/isaac-lab/jobs/job-x');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('returns 500 on unexpected error', async () => {
      mockIsaacLabClient.cancelJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/isaac-lab/jobs/job-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to cancel job');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/isaac-lab/jobs/:id/output
  // --------------------------------------------------------------------------

  describe('GET /api/isaac-lab/jobs/:id/output', () => {
    it('returns job output', async () => {
      const output = { jobId: 'job-001', outputUrl: 's3://bucket/job-001', sizeBytes: 1024 };
      mockIsaacLabClient.getJobOutput.mockResolvedValue(output);

      const response = await request(app).get('/api/isaac-lab/jobs/job-001/output');

      expect(response.status).toBe(200);
      expect(response.body.outputUrl).toBe('s3://bucket/job-001');
      expect(mockIsaacLabClient.getJobOutput).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when job not found', async () => {
      mockIsaacLabClient.getJobOutput.mockRejectedValue(new Error("Job 'job-x' not found"));

      const response = await request(app).get('/api/isaac-lab/jobs/job-x/output');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('returns 400 when job not completed', async () => {
      mockIsaacLabClient.getJobOutput.mockRejectedValue(
        new Error("Job 'job-001' is not completed (status: running)")
      );

      const response = await request(app).get('/api/isaac-lab/jobs/job-001/output');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not completed');
    });

    it('returns 500 on unexpected error', async () => {
      mockIsaacLabClient.getJobOutput.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/isaac-lab/jobs/job-001/output');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get job output');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/isaac-lab/health
  // --------------------------------------------------------------------------

  describe('GET /api/isaac-lab/health', () => {
    it('returns health, circuit breaker state and mock mode', async () => {
      mockIsaacLabClient.healthCheck.mockResolvedValue({ status: 'healthy', latencyMs: 12 });
      mockIsaacLabClient.getCircuitBreakerState.mockReturnValue('closed');
      mockIsaacLabClient.isMockMode.mockReturnValue(true);

      const response = await request(app).get('/api/isaac-lab/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.circuitBreaker).toBe('closed');
      expect(response.body.mockMode).toBe(true);
      expect(mockIsaacLabClient.healthCheck).toHaveBeenCalled();
    });

    it('returns 500 on health check error', async () => {
      mockIsaacLabClient.healthCheck.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/isaac-lab/health');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to check Isaac Lab health');
    });
  });
});

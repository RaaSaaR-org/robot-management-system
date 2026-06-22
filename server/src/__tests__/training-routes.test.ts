/**
 * @file training-routes.test.ts
 * @description Integration tests for training job + worker callback routes
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockTrainingJobService, mockTrainingOrchestrator, mockDatasetRepository } = vi.hoisted(
  () => ({
    mockTrainingJobService: {
      submitJob: vi.fn(),
      getJobs: vi.fn(),
      getJob: vi.fn(),
      getJobWithProgress: vi.fn(),
      cancelJob: vi.fn(),
      retryJob: vi.fn(),
      getQueueStats: vi.fn(),
      getActiveJobs: vi.fn(),
    },
    mockTrainingOrchestrator: {
      validateHyperparameters: vi.fn(),
      claimNextPendingJob: vi.fn(),
      recordHeartbeat: vi.fn(),
      updateProgress: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
      recordCheckpoint: vi.fn(),
      listWorkers: vi.fn(),
      estimateTrainingDuration: vi.fn(),
    },
    mockDatasetRepository: {
      findById: vi.fn(),
    },
  })
);

vi.mock('../services/TrainingJobService.js', () => ({
  trainingJobService: mockTrainingJobService,
}));

vi.mock('../services/TrainingOrchestrator.js', () => ({
  trainingOrchestrator: mockTrainingOrchestrator,
}));

vi.mock('../repositories/index.js', () => ({
  datasetRepository: mockDatasetRepository,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

vi.mock('../middleware/workerAuth.middleware.js', () => ({
  workerAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { trainingRoutes } from '../routes/training.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/training', authMiddleware as any, trainingRoutes);
  return app;
}

const MOCK_JOB = {
  id: 'job-001',
  datasetId: 'dataset-001',
  baseModel: 'smolvla',
  fineTuneMethod: 'lora',
  status: 'pending',
  hyperparameters: { epochs: 10 },
};

describe('Training Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/training/jobs
  // --------------------------------------------------------------------------

  describe('POST /api/training/jobs', () => {
    it('submits a job successfully (201)', async () => {
      mockTrainingJobService.submitJob.mockResolvedValue(MOCK_JOB);

      const response = await request(app).post('/api/training/jobs').send({
        datasetId: 'dataset-001',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      });

      expect(response.status).toBe(201);
      expect(response.body.job.id).toBe('job-001');
      expect(response.body.message).toBe('Training job submitted successfully');
      expect(mockTrainingJobService.submitJob).toHaveBeenCalledWith({
        datasetId: 'dataset-001',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      });
    });

    it('validates hyperparameters via orchestrator when provided', async () => {
      mockTrainingOrchestrator.validateHyperparameters.mockReturnValue({ epochs: 5 });
      mockTrainingJobService.submitJob.mockResolvedValue(MOCK_JOB);

      const response = await request(app).post('/api/training/jobs').send({
        datasetId: 'dataset-001',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
        hyperparameters: { epochs: 5 },
      });

      expect(response.status).toBe(201);
      expect(mockTrainingOrchestrator.validateHyperparameters).toHaveBeenCalledWith(
        { epochs: 5 },
        'lora'
      );
      expect(mockTrainingJobService.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({ hyperparameters: { epochs: 5 } })
      );
    });

    it('returns 400 when datasetId is missing', async () => {
      const response = await request(app)
        .post('/api/training/jobs')
        .send({ baseModel: 'smolvla', fineTuneMethod: 'lora' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('datasetId is required');
      expect(mockTrainingJobService.submitJob).not.toHaveBeenCalled();
    });

    it('returns 400 when baseModel is missing', async () => {
      const response = await request(app)
        .post('/api/training/jobs')
        .send({ datasetId: 'dataset-001', fineTuneMethod: 'lora' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('baseModel is required');
    });

    it('returns 400 when fineTuneMethod is missing', async () => {
      const response = await request(app)
        .post('/api/training/jobs')
        .send({ datasetId: 'dataset-001', baseModel: 'smolvla' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('fineTuneMethod is required');
    });

    it('returns 400 when hyperparameter validation fails', async () => {
      mockTrainingOrchestrator.validateHyperparameters.mockImplementation(() => {
        throw new Error('Invalid hyperparameters: epochs must be positive');
      });

      const response = await request(app).post('/api/training/jobs').send({
        datasetId: 'dataset-001',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
        hyperparameters: { epochs: -1 },
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid hyperparameters');
      expect(mockTrainingJobService.submitJob).not.toHaveBeenCalled();
    });

    it('returns 400 when service throws', async () => {
      mockTrainingJobService.submitJob.mockRejectedValue(new Error('dataset not found'));

      const response = await request(app).post('/api/training/jobs').send({
        datasetId: 'dataset-001',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('dataset not found');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training/jobs
  // --------------------------------------------------------------------------

  describe('GET /api/training/jobs', () => {
    it('lists jobs with pagination', async () => {
      mockTrainingJobService.getJobs.mockResolvedValue({
        data: [MOCK_JOB],
        pagination: { page: 1, pageSize: 20, total: 1 },
      });

      const response = await request(app).get('/api/training/jobs');

      expect(response.status).toBe(200);
      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.pagination.total).toBe(1);
    });

    it('parses scalar and array query params', async () => {
      mockTrainingJobService.getJobs.mockResolvedValue({
        data: [],
        pagination: { page: 2, pageSize: 5, total: 0 },
      });

      const response = await request(app).get(
        '/api/training/jobs?datasetId=ds-1&page=2&pageSize=5&baseModel=smolvla,pi0&status=pending'
      );

      expect(response.status).toBe(200);
      expect(mockTrainingJobService.getJobs).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        page: 2,
        pageSize: 5,
        baseModel: ['smolvla', 'pi0'],
        status: 'pending',
      });
    });

    it('returns 500 on service error', async () => {
      mockTrainingJobService.getJobs.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/training/jobs');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list training jobs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training/active
  // --------------------------------------------------------------------------

  describe('GET /api/training/active', () => {
    it('returns active jobs with count', async () => {
      mockTrainingJobService.getActiveJobs.mockResolvedValue([MOCK_JOB, MOCK_JOB]);

      const response = await request(app).get('/api/training/active');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(2);
    });

    it('returns 500 on service error', async () => {
      mockTrainingJobService.getActiveJobs.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training/active');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get active jobs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training/jobs/:id
  // --------------------------------------------------------------------------

  describe('GET /api/training/jobs/:id', () => {
    it('returns job with progress', async () => {
      mockTrainingJobService.getJobWithProgress.mockResolvedValue({
        job: MOCK_JOB,
        progress: { epoch: 3, loss: 0.5 },
      });

      const response = await request(app).get('/api/training/jobs/job-001');

      expect(response.status).toBe(200);
      expect(response.body.job.id).toBe('job-001');
      expect(response.body.progress.epoch).toBe(3);
      expect(mockTrainingJobService.getJobWithProgress).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when job not found', async () => {
      mockTrainingJobService.getJobWithProgress.mockResolvedValue(null);

      const response = await request(app).get('/api/training/jobs/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Training job not found');
    });

    it('returns 500 on service error', async () => {
      mockTrainingJobService.getJobWithProgress.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training/jobs/job-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get training job');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/jobs/:id/cancel
  // --------------------------------------------------------------------------

  describe('POST /api/training/jobs/:id/cancel', () => {
    it('cancels a job', async () => {
      mockTrainingJobService.cancelJob.mockResolvedValue({ ...MOCK_JOB, status: 'cancelled' });

      const response = await request(app).post('/api/training/jobs/job-001/cancel');

      expect(response.status).toBe(200);
      expect(response.body.job.status).toBe('cancelled');
      expect(response.body.message).toBe('Training job cancelled successfully');
      expect(mockTrainingJobService.cancelJob).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when job not found', async () => {
      mockTrainingJobService.cancelJob.mockResolvedValue(null);

      const response = await request(app).post('/api/training/jobs/missing/cancel');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Training job not found');
    });

    it('returns 400 on service error', async () => {
      mockTrainingJobService.cancelJob.mockRejectedValue(new Error('cannot cancel completed job'));

      const response = await request(app).post('/api/training/jobs/job-001/cancel');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot cancel completed job');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/jobs/:id/retry
  // --------------------------------------------------------------------------

  describe('POST /api/training/jobs/:id/retry', () => {
    it('retries a job', async () => {
      mockTrainingJobService.retryJob.mockResolvedValue({ ...MOCK_JOB, status: 'pending' });

      const response = await request(app).post('/api/training/jobs/job-001/retry');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Training job retried successfully');
      expect(mockTrainingJobService.retryJob).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when job not found', async () => {
      mockTrainingJobService.retryJob.mockResolvedValue(null);

      const response = await request(app).post('/api/training/jobs/missing/retry');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Training job not found');
    });

    it('returns 400 on service error', async () => {
      mockTrainingJobService.retryJob.mockRejectedValue(new Error('job not in failed state'));

      const response = await request(app).post('/api/training/jobs/job-001/retry');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('job not in failed state');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training/queue/stats
  // --------------------------------------------------------------------------

  describe('GET /api/training/queue/stats', () => {
    it('returns queue stats', async () => {
      mockTrainingJobService.getQueueStats.mockResolvedValue({ waiting: 2, active: 1 });

      const response = await request(app).get('/api/training/queue/stats');

      expect(response.status).toBe(200);
      expect(response.body.waiting).toBe(2);
    });

    it('returns 503 when queue unavailable', async () => {
      mockTrainingJobService.getQueueStats.mockResolvedValue(null);

      const response = await request(app).get('/api/training/queue/stats');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Queue not available');
    });

    it('returns 500 on service error', async () => {
      mockTrainingJobService.getQueueStats.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training/queue/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get queue statistics');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training/jobs/:id/estimate
  // --------------------------------------------------------------------------

  describe('GET /api/training/jobs/:id/estimate', () => {
    it('returns training duration estimate', async () => {
      mockTrainingJobService.getJob.mockResolvedValue(MOCK_JOB);
      mockTrainingOrchestrator.estimateTrainingDuration.mockResolvedValue({ minutes: 120 });

      const response = await request(app).get('/api/training/jobs/job-001/estimate');

      expect(response.status).toBe(200);
      expect(response.body.minutes).toBe(120);
      expect(mockTrainingOrchestrator.estimateTrainingDuration).toHaveBeenCalledWith(
        'dataset-001',
        { epochs: 10 }
      );
    });

    it('returns 404 when job not found', async () => {
      mockTrainingJobService.getJob.mockResolvedValue(null);

      const response = await request(app).get('/api/training/jobs/missing/estimate');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Training job not found');
    });

    it('returns 400 on estimate error', async () => {
      mockTrainingJobService.getJob.mockResolvedValue(MOCK_JOB);
      mockTrainingOrchestrator.estimateTrainingDuration.mockRejectedValue(
        new Error('cannot estimate')
      );

      const response = await request(app).get('/api/training/jobs/job-001/estimate');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot estimate');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/workers/claim
  // --------------------------------------------------------------------------

  describe('POST /api/training/workers/claim', () => {
    it('claims a job and includes dataset reference', async () => {
      mockTrainingOrchestrator.claimNextPendingJob.mockResolvedValue(MOCK_JOB);
      mockDatasetRepository.findById.mockResolvedValue({
        id: 'dataset-001',
        storagePath: 'datasets/abc',
        lerobotVersion: 'v2.1',
      });

      const response = await request(app)
        .post('/api/training/workers/claim')
        .send({ workerId: 'worker-1', device: 'cuda' });

      expect(response.status).toBe(200);
      expect(response.body.job.id).toBe('job-001');
      expect(response.body.dataset.storagePath).toBe('datasets/abc');
      expect(mockTrainingOrchestrator.claimNextPendingJob).toHaveBeenCalledWith('worker-1', 'cuda');
      expect(mockDatasetRepository.findById).toHaveBeenCalledWith('dataset-001');
    });

    it('returns null dataset when not found', async () => {
      mockTrainingOrchestrator.claimNextPendingJob.mockResolvedValue(MOCK_JOB);
      mockDatasetRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/training/workers/claim')
        .send({ workerId: 'worker-1' });

      expect(response.status).toBe(200);
      expect(response.body.dataset).toBeNull();
    });

    it('returns 204 when no jobs waiting', async () => {
      mockTrainingOrchestrator.claimNextPendingJob.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/training/workers/claim')
        .send({ workerId: 'worker-1' });

      expect(response.status).toBe(204);
      expect(mockDatasetRepository.findById).not.toHaveBeenCalled();
    });

    it('returns 400 when workerId missing', async () => {
      const response = await request(app).post('/api/training/workers/claim').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('workerId is required');
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.claimNextPendingJob.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/training/workers/claim')
        .send({ workerId: 'worker-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to claim job');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/workers/heartbeat
  // --------------------------------------------------------------------------

  describe('POST /api/training/workers/heartbeat', () => {
    it('records heartbeat and returns status', async () => {
      mockTrainingOrchestrator.recordHeartbeat.mockResolvedValue('continue');

      const response = await request(app)
        .post('/api/training/workers/heartbeat')
        .send({ jobId: 'job-001', gpuUtil: 80, memoryUtil: 50, workerId: 'w1', device: 'cuda' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('continue');
      expect(mockTrainingOrchestrator.recordHeartbeat).toHaveBeenCalledWith({
        jobId: 'job-001',
        gpuUtil: 80,
        memoryUtil: 50,
        workerId: 'w1',
        device: 'cuda',
      });
    });

    it('includes stop message when status is stop', async () => {
      mockTrainingOrchestrator.recordHeartbeat.mockResolvedValue('stop');

      const response = await request(app)
        .post('/api/training/workers/heartbeat')
        .send({ jobId: 'job-001' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('stop');
      expect(response.body.message).toBe('Job has been cancelled');
    });

    it('returns 400 when jobId missing', async () => {
      const response = await request(app).post('/api/training/workers/heartbeat').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('jobId is required');
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.recordHeartbeat.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/training/workers/heartbeat')
        .send({ jobId: 'job-001' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process heartbeat');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/workers/progress
  // --------------------------------------------------------------------------

  describe('POST /api/training/workers/progress', () => {
    it('updates progress and returns ok status', async () => {
      mockTrainingOrchestrator.updateProgress.mockResolvedValue({ cancel: false, eta: 600 });

      const response = await request(app)
        .post('/api/training/workers/progress')
        .send({ jobId: 'job-001', epoch: 3 });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.eta).toBe(600);
    });

    it('returns cancel status when orchestrator signals cancel', async () => {
      mockTrainingOrchestrator.updateProgress.mockResolvedValue({ cancel: true });

      const response = await request(app)
        .post('/api/training/workers/progress')
        .send({ jobId: 'job-001' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancel');
    });

    it('returns 400 when jobId missing', async () => {
      const response = await request(app).post('/api/training/workers/progress').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('jobId is required');
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.updateProgress.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/training/workers/progress')
        .send({ jobId: 'job-001' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process progress update');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/workers/complete
  // --------------------------------------------------------------------------

  describe('POST /api/training/workers/complete', () => {
    it('completes a job and returns modelVersionId', async () => {
      mockTrainingOrchestrator.completeJob.mockResolvedValue({ modelVersionId: 'mv-1' });

      const response = await request(app).post('/api/training/workers/complete').send({
        jobId: 'job-001',
        artifactUri: 's3://artifacts/1',
        finalMetrics: { loss: 0.1 },
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.modelVersionId).toBe('mv-1');
    });

    it('returns 400 when jobId missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/complete')
        .send({ artifactUri: 's3://x', finalMetrics: {} });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('jobId is required');
    });

    it('returns 400 when artifactUri missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/complete')
        .send({ jobId: 'job-001', finalMetrics: {} });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('artifactUri is required');
    });

    it('returns 400 when finalMetrics missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/complete')
        .send({ jobId: 'job-001', artifactUri: 's3://x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('finalMetrics is required');
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.completeJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/training/workers/complete').send({
        jobId: 'job-001',
        artifactUri: 's3://x',
        finalMetrics: { loss: 0.1 },
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process completion');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/workers/failed
  // --------------------------------------------------------------------------

  describe('POST /api/training/workers/failed', () => {
    it('records a failure', async () => {
      mockTrainingOrchestrator.failJob.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/training/workers/failed')
        .send({ jobId: 'job-001', error: 'OOM' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(mockTrainingOrchestrator.failJob).toHaveBeenCalledWith({
        jobId: 'job-001',
        error: 'OOM',
      });
    });

    it('returns 400 when jobId missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/failed')
        .send({ error: 'OOM' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('jobId is required');
    });

    it('returns 400 when error message missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/failed')
        .send({ jobId: 'job-001' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('error message is required');
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.failJob.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/training/workers/failed')
        .send({ jobId: 'job-001', error: 'OOM' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process failure');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training/workers/checkpoint
  // --------------------------------------------------------------------------

  describe('POST /api/training/workers/checkpoint', () => {
    it('records a checkpoint', async () => {
      mockTrainingOrchestrator.recordCheckpoint.mockResolvedValue(undefined);

      const response = await request(app).post('/api/training/workers/checkpoint').send({
        jobId: 'job-001',
        epoch: 5,
        checkpointUri: 's3://ckpt/5',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(mockTrainingOrchestrator.recordCheckpoint).toHaveBeenCalledWith({
        jobId: 'job-001',
        epoch: 5,
        checkpointUri: 's3://ckpt/5',
      });
    });

    it('returns 400 when jobId missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/checkpoint')
        .send({ epoch: 5, checkpointUri: 's3://ckpt/5' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('jobId is required');
    });

    it('returns 400 when epoch missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/checkpoint')
        .send({ jobId: 'job-001', checkpointUri: 's3://ckpt/5' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('epoch is required');
    });

    it('returns 400 when checkpointUri missing', async () => {
      const response = await request(app)
        .post('/api/training/workers/checkpoint')
        .send({ jobId: 'job-001', epoch: 5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('checkpointUri is required');
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.recordCheckpoint.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/training/workers/checkpoint').send({
        jobId: 'job-001',
        epoch: 5,
        checkpointUri: 's3://ckpt/5',
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process checkpoint');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training/workers
  // --------------------------------------------------------------------------

  describe('GET /api/training/workers', () => {
    it('lists active workers', async () => {
      mockTrainingOrchestrator.listWorkers.mockResolvedValue({ workers: [{ id: 'w1' }] });

      const response = await request(app).get('/api/training/workers');

      expect(response.status).toBe(200);
      expect(response.body.workers).toHaveLength(1);
    });

    it('returns 500 on error', async () => {
      mockTrainingOrchestrator.listWorkers.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training/workers');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list workers');
    });
  });
});

/**
 * @file synthetic-routes.test.ts
 * @description Integration tests for synthetic data generation routes (Isaac Lab)
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockSyntheticDataService } = vi.hoisted(() => ({
  mockSyntheticDataService: {
    submitJob: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    cancelJob: vi.fn(),
    getDRPresets: vi.fn(),
    getDRPreset: vi.fn(),
    getRecommendedPreset: vi.fn(),
    recordSimToRealValidation: vi.fn(),
    listValidations: vi.fn(),
    getValidation: vi.fn(),
    getValidationsForJob: vi.fn(),
    checkIsaacLabStatus: vi.fn(),
    getJobStatistics: vi.fn(),
  },
}));

vi.mock('../services/SyntheticDataService.js', () => ({
  syntheticDataService: mockSyntheticDataService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { syntheticRoutes } from '../routes/synthetic.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/synthetic', authMiddleware as any, syntheticRoutes);
  return app;
}

const MOCK_JOB = {
  id: 'job-001',
  task: 'pick_place',
  embodiment: 'so101',
  trajectoryCount: 100,
  status: 'queued',
  createdAt: '2026-02-26T00:00:00.000Z',
};

const MOCK_VALIDATION = {
  id: 'val-001',
  syntheticJobId: 'job-001',
  modelVersionId: 'model-001',
  simSuccessRate: 0.9,
  realSuccessRate: 0.85,
  realTestCount: 20,
  taskCategories: ['pick_place'],
  domainGapScore: 0.05,
};

describe('Synthetic Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/synthetic/jobs
  // --------------------------------------------------------------------------

  describe('POST /api/synthetic/jobs', () => {
    it('submits a job successfully', async () => {
      mockSyntheticDataService.submitJob.mockResolvedValue(MOCK_JOB);

      const body = {
        task: 'pick_place',
        embodiment: 'so101',
        trajectoryCount: 100,
        simulation: { numEnvs: 16 },
      };

      const response = await request(app).post('/api/synthetic/jobs').send(body);

      expect(response.status).toBe(201);
      expect(response.body.job.id).toBe('job-001');
      expect(response.body.estimatedDuration).toBe(Math.ceil((100 / 16) * 30));
      expect(response.body.queuePosition).toBe(0);
      expect(mockSyntheticDataService.submitJob).toHaveBeenCalledWith(body);
    });

    it('uses default numEnvs of 16 when simulation omitted', async () => {
      mockSyntheticDataService.submitJob.mockResolvedValue(MOCK_JOB);

      const response = await request(app)
        .post('/api/synthetic/jobs')
        .send({ task: 'push', embodiment: 'so101', trajectoryCount: 32 });

      expect(response.status).toBe(201);
      expect(response.body.estimatedDuration).toBe(Math.ceil((32 / 16) * 30));
    });

    it('returns 400 when task is missing', async () => {
      const response = await request(app)
        .post('/api/synthetic/jobs')
        .send({ embodiment: 'so101', trajectoryCount: 100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('task is required');
      expect(mockSyntheticDataService.submitJob).not.toHaveBeenCalled();
    });

    it('returns 400 when embodiment is missing', async () => {
      const response = await request(app)
        .post('/api/synthetic/jobs')
        .send({ task: 'pick_place', trajectoryCount: 100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('embodiment is required');
    });

    it('returns 400 when trajectoryCount is invalid', async () => {
      const response = await request(app)
        .post('/api/synthetic/jobs')
        .send({ task: 'pick_place', embodiment: 'so101', trajectoryCount: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('trajectoryCount must be a positive integer');
    });

    it('returns 400 for an invalid task type', async () => {
      const response = await request(app)
        .post('/api/synthetic/jobs')
        .send({ task: 'fly', embodiment: 'so101', trajectoryCount: 100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid task. Must be one of:');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.submitJob.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/synthetic/jobs')
        .send({ task: 'pick_place', embodiment: 'so101', trajectoryCount: 100 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to submit synthetic generation job');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/jobs
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/jobs', () => {
    it('lists jobs with default pagination', async () => {
      mockSyntheticDataService.listJobs.mockResolvedValue({ jobs: [MOCK_JOB], total: 1 });

      const response = await request(app).get('/api/synthetic/jobs');

      expect(response.status).toBe(200);
      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(response.body.limit).toBe(50);
      expect(response.body.offset).toBe(0);
      expect(mockSyntheticDataService.listJobs).toHaveBeenCalledWith({
        status: undefined,
        task: undefined,
        embodiment: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('passes query filters through to the service', async () => {
      mockSyntheticDataService.listJobs.mockResolvedValue({ jobs: [], total: 0 });

      const response = await request(app).get(
        '/api/synthetic/jobs?status=running&task=push&embodiment=h1&limit=10&offset=5'
      );

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(5);
      expect(mockSyntheticDataService.listJobs).toHaveBeenCalledWith({
        status: 'running',
        task: 'push',
        embodiment: 'h1',
        limit: 10,
        offset: 5,
      });
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.listJobs.mockRejectedValue(new Error('db'));

      const response = await request(app).get('/api/synthetic/jobs');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list jobs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/jobs/:id
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/jobs/:id', () => {
    it('returns a job by id', async () => {
      mockSyntheticDataService.getJob.mockResolvedValue(MOCK_JOB);

      const response = await request(app).get('/api/synthetic/jobs/job-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('job-001');
      expect(mockSyntheticDataService.getJob).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when the job is not found', async () => {
      mockSyntheticDataService.getJob.mockResolvedValue(null);

      const response = await request(app).get('/api/synthetic/jobs/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Job not found');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/synthetic/jobs/job-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get job');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/synthetic/jobs/:id/cancel
  // --------------------------------------------------------------------------

  describe('POST /api/synthetic/jobs/:id/cancel', () => {
    it('cancels a job successfully', async () => {
      mockSyntheticDataService.cancelJob.mockResolvedValue({ ...MOCK_JOB, status: 'cancelled' });

      const response = await request(app).post('/api/synthetic/jobs/job-001/cancel');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Job cancelled');
      expect(response.body.job.status).toBe('cancelled');
      expect(mockSyntheticDataService.cancelJob).toHaveBeenCalledWith('job-001');
    });

    it('returns 404 when the job is not found', async () => {
      mockSyntheticDataService.cancelJob.mockResolvedValue(null);

      const response = await request(app).post('/api/synthetic/jobs/missing/cancel');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Job not found');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.cancelJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/synthetic/jobs/job-001/cancel');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to cancel job');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/templates
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/templates', () => {
    it('returns DR presets with a count', async () => {
      const presets = [{ id: 'p1' }, { id: 'p2' }];
      mockSyntheticDataService.getDRPresets.mockReturnValue(presets);

      const response = await request(app).get('/api/synthetic/templates');

      expect(response.status).toBe(200);
      expect(response.body.presets).toHaveLength(2);
      expect(response.body.count).toBe(2);
      expect(mockSyntheticDataService.getDRPresets).toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getDRPresets.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/synthetic/templates');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get templates');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/templates/recommended/:task
  // (declared before /templates/:id in source — placed here intentionally)
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/templates/recommended/:task', () => {
    it('returns the recommended preset for a task', async () => {
      const preset = { id: 'rec-1', name: 'Recommended' };
      mockSyntheticDataService.getRecommendedPreset.mockReturnValue(preset);

      const response = await request(app).get(
        '/api/synthetic/templates/recommended/pick_place'
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('rec-1');
      expect(mockSyntheticDataService.getRecommendedPreset).toHaveBeenCalledWith('pick_place');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getRecommendedPreset.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get(
        '/api/synthetic/templates/recommended/pick_place'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get recommended preset');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/templates/:id
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/templates/:id', () => {
    it('returns a specific preset', async () => {
      mockSyntheticDataService.getDRPreset.mockReturnValue({ id: 'preset-1' });

      const response = await request(app).get('/api/synthetic/templates/preset-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('preset-1');
      expect(mockSyntheticDataService.getDRPreset).toHaveBeenCalledWith('preset-1');
    });

    it('returns 404 when the preset is not found', async () => {
      mockSyntheticDataService.getDRPreset.mockReturnValue(null);

      const response = await request(app).get('/api/synthetic/templates/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Preset not found');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getDRPreset.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/synthetic/templates/preset-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get preset');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/synthetic/validate-sim-to-real
  // --------------------------------------------------------------------------

  describe('POST /api/synthetic/validate-sim-to-real', () => {
    const validBody = {
      syntheticJobId: 'job-001',
      modelVersionId: 'model-001',
      simSuccessRate: 0.9,
      realSuccessRate: 0.85,
      realTestCount: 20,
      taskCategories: ['pick_place'],
    };

    it('records a validation successfully', async () => {
      mockSyntheticDataService.getJob.mockResolvedValue(MOCK_JOB);
      mockSyntheticDataService.recordSimToRealValidation.mockResolvedValue(MOCK_VALIDATION);

      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.validation.id).toBe('val-001');
      expect(response.body.interpretation.level).toBe('excellent');
      expect(mockSyntheticDataService.recordSimToRealValidation).toHaveBeenCalledWith(validBody);
    });

    it('returns 400 when syntheticJobId is missing', async () => {
      const { syntheticJobId, ...rest } = validBody;
      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('syntheticJobId is required');
    });

    it('returns 400 when modelVersionId is missing', async () => {
      const { modelVersionId, ...rest } = validBody;
      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelVersionId is required');
    });

    it('returns 400 when simSuccessRate is out of range', async () => {
      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send({ ...validBody, simSuccessRate: 1.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('simSuccessRate must be a number between 0 and 1');
    });

    it('returns 400 when realSuccessRate is out of range', async () => {
      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send({ ...validBody, realSuccessRate: -0.1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('realSuccessRate must be a number between 0 and 1');
    });

    it('returns 400 when realTestCount is invalid', async () => {
      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send({ ...validBody, realTestCount: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('realTestCount must be a positive integer');
    });

    it('returns 400 when taskCategories is empty', async () => {
      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send({ ...validBody, taskCategories: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('taskCategories must be a non-empty array');
    });

    it('returns 404 when the synthetic job does not exist', async () => {
      mockSyntheticDataService.getJob.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send(validBody);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Synthetic job not found');
      expect(mockSyntheticDataService.recordSimToRealValidation).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getJob.mockResolvedValue(MOCK_JOB);
      mockSyntheticDataService.recordSimToRealValidation.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/synthetic/validate-sim-to-real')
        .send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to record validation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/validations
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/validations', () => {
    it('lists validations with a count', async () => {
      mockSyntheticDataService.listValidations.mockResolvedValue([MOCK_VALIDATION]);

      const response = await request(app).get('/api/synthetic/validations');

      expect(response.status).toBe(200);
      expect(response.body.validations).toHaveLength(1);
      expect(response.body.count).toBe(1);
      expect(mockSyntheticDataService.listValidations).toHaveBeenCalledWith({
        modelVersionId: undefined,
        minRealSuccessRate: undefined,
        maxDomainGap: undefined,
      });
    });

    it('passes numeric query filters through', async () => {
      mockSyntheticDataService.listValidations.mockResolvedValue([]);

      const response = await request(app).get(
        '/api/synthetic/validations?modelVersionId=m1&minRealSuccessRate=0.8&maxDomainGap=0.2'
      );

      expect(response.status).toBe(200);
      expect(mockSyntheticDataService.listValidations).toHaveBeenCalledWith({
        modelVersionId: 'm1',
        minRealSuccessRate: 0.8,
        maxDomainGap: 0.2,
      });
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.listValidations.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/synthetic/validations');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list validations');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/validations/:id
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/validations/:id', () => {
    it('returns a validation with interpretation', async () => {
      mockSyntheticDataService.getValidation.mockResolvedValue(MOCK_VALIDATION);

      const response = await request(app).get('/api/synthetic/validations/val-001');

      expect(response.status).toBe(200);
      expect(response.body.validation.id).toBe('val-001');
      expect(response.body.interpretation.level).toBe('excellent');
      expect(mockSyntheticDataService.getValidation).toHaveBeenCalledWith('val-001');
    });

    it('returns 404 when the validation is not found', async () => {
      mockSyntheticDataService.getValidation.mockResolvedValue(null);

      const response = await request(app).get('/api/synthetic/validations/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Validation not found');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getValidation.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/synthetic/validations/val-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get validation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/jobs/:id/validations
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/jobs/:id/validations', () => {
    it('returns validations for a job', async () => {
      mockSyntheticDataService.getValidationsForJob.mockResolvedValue([MOCK_VALIDATION]);

      const response = await request(app).get('/api/synthetic/jobs/job-001/validations');

      expect(response.status).toBe(200);
      expect(response.body.syntheticJobId).toBe('job-001');
      expect(response.body.validations).toHaveLength(1);
      expect(response.body.count).toBe(1);
      expect(mockSyntheticDataService.getValidationsForJob).toHaveBeenCalledWith('job-001');
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getValidationsForJob.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/synthetic/jobs/job-001/validations');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get job validations');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/status
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/status', () => {
    it('returns Isaac Lab service status', async () => {
      mockSyntheticDataService.checkIsaacLabStatus.mockResolvedValue({ available: true });

      const response = await request(app).get('/api/synthetic/status');

      expect(response.status).toBe(200);
      expect(response.body.available).toBe(true);
      expect(mockSyntheticDataService.checkIsaacLabStatus).toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.checkIsaacLabStatus.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/synthetic/status');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to check service status');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic/statistics
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic/statistics', () => {
    it('returns job statistics', async () => {
      mockSyntheticDataService.getJobStatistics.mockResolvedValue({ totalJobs: 5 });

      const response = await request(app).get('/api/synthetic/statistics');

      expect(response.status).toBe(200);
      expect(response.body.totalJobs).toBe(5);
      expect(mockSyntheticDataService.getJobStatistics).toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockSyntheticDataService.getJobStatistics.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/synthetic/statistics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get statistics');
    });
  });
});

/**
 * @file dataset-annotations-routes.test.ts
 * @description Integration tests for the TASK-179 dataset routes:
 *   POST /api/datasets/:id/annotate, GET /api/datasets/:id/annotations (§4)
 *   and POST/GET /api/datasets/interventions (§7).
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockDatasetService, mockTrainingJobService, mockInterventionService } = vi.hoisted(() => ({
  mockDatasetService: {
    get: vi.fn(),
    getAnnotations: vi.fn(),
    list: vi.fn(),
  },
  mockTrainingJobService: {
    submitAnnotateJob: vi.fn(),
  },
  mockInterventionService: {
    recordIntervention: vi.fn(),
    listInterventions: vi.fn(),
  },
}));

vi.mock('../services/DatasetService.js', () => ({
  datasetService: mockDatasetService,
}));

vi.mock('../services/TrainingJobService.js', () => ({
  trainingJobService: mockTrainingJobService,
}));

vi.mock('../services/InterventionService.js', () => ({
  interventionService: mockInterventionService,
}));

vi.mock('../services/HuggingFaceImportService.js', () => ({
  huggingFaceImportService: { importDataset: vi.fn() },
}));

vi.mock('../services/DataQualityService.js', () => ({
  dataQualityService: {},
}));

vi.mock('../storage/model-storage.js', () => ({
  modelStorage: {},
  BUCKETS: { TRAINING_DATASETS: 'training-datasets' },
}));

vi.mock('../storage/rustfs-client.js', () => ({
  getRustFSClient: vi.fn(),
  isRustFSInitialized: vi.fn().mockReturnValue(false),
}));

import { datasetRoutes } from '../routes/datasets.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

const ANNOTATIONS = [
  {
    episodeIndex: 0,
    subtasks: [{ startS: 0, endS: 2.5, text: 'reach for the cube' }],
    vqa: [{ question: 'What is grasped?', answer: 'a red cube' }],
  },
];

const INTERVENTION = {
  id: 'iv-1',
  robotId: 'robot-1',
  skillId: 'skill-1',
  taskPrompt: 'pick up the cube',
  strategy: 'dagger',
  startedAt: '2026-07-07T10:00:00.000Z',
  endedAt: '2026-07-07T10:01:30.000Z',
  steps: [
    { t: 0, source: 'policy', action: [0.1, 0.2] },
    { t: 1, source: 'human', action: [0.3, 0.4] },
  ],
  createdAt: '2026-07-07T10:01:31.000Z',
};

describe('Dataset Annotation + Intervention Routes (TASK-179)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/datasets/:id/annotate
  // --------------------------------------------------------------------------

  describe('POST /api/datasets/:id/annotate', () => {
    it('queues an annotate job (201 { jobId })', async () => {
      mockTrainingJobService.submitAnnotateJob.mockResolvedValue({ id: 'job-an-1' });

      const response = await request(app)
        .post('/api/datasets/ds-1/annotate')
        .send({ episodes: [0, 2] });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ jobId: 'job-an-1' });
      expect(mockTrainingJobService.submitAnnotateJob).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        episodes: [0, 2],
      });
    });

    it('works without episodes (annotate everything)', async () => {
      mockTrainingJobService.submitAnnotateJob.mockResolvedValue({ id: 'job-an-2' });

      const response = await request(app).post('/api/datasets/ds-1/annotate').send({});

      expect(response.status).toBe(201);
      expect(mockTrainingJobService.submitAnnotateJob).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        episodes: undefined,
      });
    });

    it('returns 400 when episodes is not an array', async () => {
      const response = await request(app)
        .post('/api/datasets/ds-1/annotate')
        .send({ episodes: 'all' });

      expect(response.status).toBe(400);
      expect(mockTrainingJobService.submitAnnotateJob).not.toHaveBeenCalled();
    });

    it('returns 404 when the dataset does not exist', async () => {
      mockTrainingJobService.submitAnnotateJob.mockRejectedValue(
        new Error('Dataset not found: ds-missing')
      );

      const response = await request(app).post('/api/datasets/ds-missing/annotate').send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('returns 400 when the dataset is not ready', async () => {
      mockTrainingJobService.submitAnnotateJob.mockRejectedValue(
        new Error('Dataset not ready: ds-1 (status: validating)')
      );

      const response = await request(app).post('/api/datasets/ds-1/annotate').send({});

      expect(response.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/datasets/:id/annotations
  // --------------------------------------------------------------------------

  describe('GET /api/datasets/:id/annotations', () => {
    it('returns the stored annotations', async () => {
      mockDatasetService.getAnnotations.mockResolvedValue(ANNOTATIONS);

      const response = await request(app).get('/api/datasets/ds-1/annotations');

      expect(response.status).toBe(200);
      expect(response.body.annotations).toEqual(ANNOTATIONS);
      expect(mockDatasetService.getAnnotations).toHaveBeenCalledWith('ds-1');
    });

    it('returns [] for a dataset without annotations', async () => {
      mockDatasetService.getAnnotations.mockResolvedValue([]);

      const response = await request(app).get('/api/datasets/ds-1/annotations');

      expect(response.status).toBe(200);
      expect(response.body.annotations).toEqual([]);
    });

    it('returns 404 when the dataset does not exist', async () => {
      mockDatasetService.getAnnotations.mockResolvedValue(null);

      const response = await request(app).get('/api/datasets/missing/annotations');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Dataset not found');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/datasets/interventions
  // --------------------------------------------------------------------------

  describe('POST /api/datasets/interventions', () => {
    it('records an intervention episode (201 { id })', async () => {
      mockInterventionService.recordIntervention.mockResolvedValue(INTERVENTION);

      const response = await request(app).post('/api/datasets/interventions').send({
        robotId: 'robot-1',
        skillId: 'skill-1',
        taskPrompt: 'pick up the cube',
        strategy: 'dagger',
        startedAt: INTERVENTION.startedAt,
        endedAt: INTERVENTION.endedAt,
        steps: INTERVENTION.steps,
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: 'iv-1' });
      expect(mockInterventionService.recordIntervention).toHaveBeenCalledWith(
        expect.objectContaining({
          robotId: 'robot-1',
          taskPrompt: 'pick up the cube',
          strategy: 'dagger',
          steps: INTERVENTION.steps,
        })
      );
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app)
        .post('/api/datasets/interventions')
        .send({ taskPrompt: 'x', startedAt: 'now', endedAt: 'now' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
    });

    it('returns 400 when taskPrompt is missing', async () => {
      const response = await request(app)
        .post('/api/datasets/interventions')
        .send({ robotId: 'robot-1', startedAt: 'now', endedAt: 'now' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('taskPrompt is required');
    });

    it('returns 400 when timestamps are missing', async () => {
      const response = await request(app)
        .post('/api/datasets/interventions')
        .send({ robotId: 'robot-1', taskPrompt: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('startedAt and endedAt are required');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/datasets/interventions
  // --------------------------------------------------------------------------

  describe('GET /api/datasets/interventions', () => {
    it('lists interventions with parsed steps', async () => {
      mockInterventionService.listInterventions.mockResolvedValue([INTERVENTION]);

      const response = await request(app).get('/api/datasets/interventions?robotId=robot-1');

      expect(response.status).toBe(200);
      expect(response.body.interventions).toHaveLength(1);
      expect(response.body.interventions[0].steps).toEqual(INTERVENTION.steps);
      expect(mockInterventionService.listInterventions).toHaveBeenCalledWith('robot-1');
    });

    it('lists all interventions when robotId is omitted', async () => {
      mockInterventionService.listInterventions.mockResolvedValue([]);

      const response = await request(app).get('/api/datasets/interventions');

      expect(response.status).toBe(200);
      expect(mockInterventionService.listInterventions).toHaveBeenCalledWith(undefined);
    });

    it('is not swallowed by the /:id dataset route', async () => {
      mockInterventionService.listInterventions.mockResolvedValue([]);

      const response = await request(app).get('/api/datasets/interventions');

      // Must hit the interventions handler, not GET /:id (which would 404
      // via datasetService.get or return a dataset payload).
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('interventions');
      expect(mockDatasetService.get).not.toHaveBeenCalled();
    });
  });
});

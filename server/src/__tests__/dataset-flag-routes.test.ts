/**
 * @file dataset-flag-routes.test.ts
 * @description The endpoints that used to answer `{success:true}` without
 *              acting, and the two that now say 501 instead (TASK-217).
 * @feature datasets
 *
 * Five endpoints agreed on a fiction: flagging returned success and stored
 * nothing, the flagged list always returned `[]`, unflagging returned a
 * `reviewedAt` for a review it did not record, and two more returned 200 with a
 * `message` explaining they had not done anything. The episode viewer showed a
 * flag control in front of the first three. Three of the five act now; the
 * other two are honest about not existing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockDatasetService, mockFlagRepo, mockRobotTypeRepo } = vi.hoisted(() => ({
  mockDatasetService: {
    get: vi.fn(),
    list: vi.fn(),
    validateAndUpdateDataset: vi.fn(),
  },
  mockFlagRepo: {
    set: vi.fn(),
    get: vi.fn(),
    flaggedIndices: vi.fn(),
    countFlagged: vi.fn(),
    listFlagged: vi.fn(),
    review: vi.fn(),
  },
  mockRobotTypeRepo: { findAll: vi.fn() },
}));

vi.mock('../services/DatasetService.js', () => ({ datasetService: mockDatasetService }));
vi.mock('../repositories/DatasetEpisodeFlagRepository.js', () => ({
  datasetEpisodeFlagRepository: mockFlagRepo,
}));
vi.mock('../repositories/index.js', () => ({ robotTypeRepository: mockRobotTypeRepo }));
vi.mock('../services/TrainingJobService.js', () => ({ trainingJobService: {} }));
vi.mock('../services/InterventionService.js', () => ({ interventionService: {} }));
vi.mock('../services/HuggingFaceImportService.js', () => ({
  huggingFaceImportService: { importDataset: vi.fn() },
}));
vi.mock('../services/DataQualityService.js', () => ({ dataQualityService: {} }));
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

const DATASET = {
  id: 'ds1',
  name: 'Pick and place',
  storagePath: '/data/ds1/',
  status: 'ready',
  demonstrationCount: 4,
  qualityScore: 70,
  infoJson: {},
  updatedAt: new Date('2026-08-22T00:00:00.000Z'),
};

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  mockDatasetService.get.mockResolvedValue(DATASET);
  mockFlagRepo.countFlagged.mockResolvedValue(0);
  mockFlagRepo.listFlagged.mockResolvedValue({ rows: [], total: 0 });
  app = createApp();
});

describe('PATCH /:id/episodes/:index/flag', () => {
  it('stores the flag rather than acknowledging it', async () => {
    mockFlagRepo.set.mockResolvedValue({ datasetId: 'ds1', episodeIndex: 2, flagged: true });

    const res = await request(app)
      .patch('/api/datasets/ds1/episodes/2/flag')
      .send({ flagged: true, reason: 'gripper slipped' });

    expect(res.status).toBe(200);
    expect(mockFlagRepo.set).toHaveBeenCalledWith('ds1', 2, true, 'gripper slipped');
    expect(res.body.flag).toMatchObject({ episodeIndex: 2, flagged: true });
  });

  it('still refuses a non-boolean, and does not touch the store', async () => {
    const res = await request(app)
      .patch('/api/datasets/ds1/episodes/2/flag')
      .send({ flagged: 'yes' });

    expect(res.status).toBe(400);
    expect(mockFlagRepo.set).not.toHaveBeenCalled();
  });
});

describe('GET /:id/flagged', () => {
  it('returns what is flagged, not an empty list with an explanation', async () => {
    mockFlagRepo.listFlagged.mockResolvedValue({
      rows: [{ datasetId: 'ds1', episodeIndex: 3, flagged: true, reason: 'blurry' }],
      total: 1,
    });

    const res = await request(app).get('/api/datasets/ds1/flagged');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.flagged[0]).toMatchObject({ episodeIndex: 3, reason: 'blurry' });
    // The old body carried `message: 'Run advanced validation to generate
    // flagged trajectories'`, which described a pipeline that does not exist.
    expect(res.body.message).toBeUndefined();
  });
});

describe('POST /:id/trajectories/:idx/unflag', () => {
  it('records the decision', async () => {
    mockFlagRepo.review.mockResolvedValue({
      datasetId: 'ds1', episodeIndex: 1, flagged: false,
      reviewDecision: 'remove', reviewedAt: new Date('2026-08-22T12:00:00.000Z'),
    });

    const res = await request(app)
      .post('/api/datasets/ds1/trajectories/1/unflag')
      .send({ reviewDecision: 'remove', reviewedBy: 'sam' });

    expect(res.status).toBe(200);
    expect(mockFlagRepo.review).toHaveBeenCalledWith('ds1', 1, 'remove', 'sam');
    expect(res.body.reviewedAt).toBe('2026-08-22T12:00:00.000Z');
  });

  it('404s when there is no flag to review, instead of inventing a timestamp', async () => {
    // The old handler answered `{success:true, reviewedAt: <now>}` whatever the
    // state, so a review of an episode nobody had flagged looked identical to a
    // real one.
    mockFlagRepo.review.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/datasets/ds1/trajectories/9/unflag')
      .send({ reviewDecision: 'keep' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBeUndefined();
  });
});

describe('the two that do not exist', () => {
  it('POST /:id/validate-advanced answers 501, not "queued"', async () => {
    // `{status:'queued'}` was a promise the platform could not keep: no worker,
    // no job subject, no table for the results. A caller polling for the
    // outcome waited forever.
    const res = await request(app).post('/api/datasets/ds1/validate-advanced').send({});

    expect(res.status).toBe(501);
    expect(res.body.code).toBe('NOT_IMPLEMENTED');
    // And it points at the validation that DOES run.
    expect(res.body.hint).toContain('/validate');
  });

  it('GET /:id/trajectories/:idx/metrics answers 501, not an empty metrics object', async () => {
    const res = await request(app).get('/api/datasets/ds1/trajectories/0/metrics');

    expect(res.status).toBe(501);
    expect(res.body.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('POST /:id/validate', () => {
  it('runs structural validation and reports what it found', async () => {
    // There was no way to validate a dataset that had not just been uploaded:
    // validation ran once, inside `completeUpload`. Every dataset registered
    // any other way could never be checked at all.
    mockDatasetService.get
      .mockResolvedValueOnce(DATASET)
      .mockResolvedValueOnce({
        ...DATASET,
        status: 'failed',
        qualityScore: 0,
        validation: { valid: false, errors: [{ code: 'MISSING_DATA_FILE', message: 'gone' }] },
      });

    const res = await request(app).post('/api/datasets/ds1/validate');

    expect(res.status).toBe(200);
    expect(mockDatasetService.validateAndUpdateDataset).toHaveBeenCalledWith('ds1', '/data/ds1/');
    expect(res.body.status).toBe('failed');
    expect(res.body.validation.errors[0].code).toBe('MISSING_DATA_FILE');
  });

  it('404s for a dataset that is not there', async () => {
    mockDatasetService.get.mockResolvedValue(null);
    const res = await request(app).post('/api/datasets/missing/validate');
    expect(res.status).toBe(404);
    expect(mockDatasetService.validateAndUpdateDataset).not.toHaveBeenCalled();
  });
});

describe('GET /:id/quality', () => {
  it('counts the real flags instead of reporting zero and 100% clean', async () => {
    mockDatasetService.get.mockResolvedValue({ ...DATASET, qualityBreakdown: { total: 70 } });
    mockFlagRepo.countFlagged.mockResolvedValue(1);
    mockFlagRepo.listFlagged.mockResolvedValue({
      rows: [{ datasetId: 'ds1', episodeIndex: 2, flagged: true, reason: 'blurry', createdAt: new Date() }],
      total: 1,
    });

    const res = await request(app).get('/api/datasets/ds1/quality');

    expect(res.status).toBe(200);
    expect(res.body.report.flaggedTrajectoryCount).toBe(1);
    // 4 episodes, 1 flagged.
    expect(res.body.report.cleanTrajectoryPercentage).toBe(75);
    expect(res.body.report.flaggedSummary[0]).toMatchObject({ trajectoryIndex: 2, reason: 'blurry' });
  });
});

describe('GET /robot-types', () => {
  it('lists them — the upload modal had no source for this at all', async () => {
    mockRobotTypeRepo.findAll.mockResolvedValue([{ id: 'rt1', name: 'Unitree G1 EDU' }]);

    const res = await request(app).get('/api/datasets/robot-types');

    expect(res.status).toBe(200);
    expect(res.body.robotTypes).toHaveLength(1);
  });

  it('is matched before /:id, or it would be read as a dataset id', async () => {
    mockRobotTypeRepo.findAll.mockResolvedValue([]);
    await request(app).get('/api/datasets/robot-types');
    expect(mockRobotTypeRepo.findAll).toHaveBeenCalled();
    expect(mockDatasetService.get).not.toHaveBeenCalledWith('robot-types');
  });
});

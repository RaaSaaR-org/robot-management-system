/**
 * @file dataset-validate-route.test.ts
 * @description `POST /api/datasets/:id/validate` after TASK-219: it accepts the
 *              work and answers, instead of validating inside the request.
 * @feature datasets
 *
 * The route used to `await datasetService.validateAndUpdateDataset(...)`, which
 * opens every file the manifest names — seconds to minutes on a real dataset,
 * during which this process serves nothing else. Two things are pinned here:
 * the request no longer waits for the pass, and a second request while one is
 * in flight is REFUSED rather than queued behind it.
 *
 * The refusal itself lives in `DatasetService.requestValidation` and is tested
 * against the real implementation in `services/__tests__/DatasetService.test.ts`;
 * what these assert is that the route asks for it and maps every answer onto a
 * status a client can act on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockDatasetService, mockFlagRepo, mockRobotTypeRepo } = vi.hoisted(() => ({
  mockDatasetService: {
    get: vi.fn(),
    list: vi.fn(),
    requestValidation: vi.fn(),
    getUploadProgress: vi.fn(),
    // Present so a route that still called it would be caught doing so, rather
    // than failing with "not a function" and looking like a wiring problem.
    validateAndUpdateDataset: vi.fn(),
  },
  mockFlagRepo: {
    countFlagged: vi.fn(),
    listFlagged: vi.fn(),
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
};

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  mockDatasetService.get.mockResolvedValue(DATASET);
  app = createApp();
});

describe('POST /:id/validate', () => {
  it('accepts the work and says where the answer will appear', async () => {
    mockDatasetService.requestValidation.mockResolvedValue('queued');

    const res = await request(app).post('/api/datasets/ds1/validate');

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      datasetId: 'ds1',
      accepted: true,
      state: 'queued',
      progressUrl: '/api/datasets/ds1/progress',
    });
    expect(mockDatasetService.requestValidation).toHaveBeenCalledWith('ds1', '/data/ds1/');
  });

  it('names the degraded path when there is no NATS to queue onto', async () => {
    // NATS is optional here and a dev box has none. `started` says the pass is
    // running in this process rather than in a worker — a different place to
    // look when it goes wrong, so the response says which.
    mockDatasetService.requestValidation.mockResolvedValue('started');

    const res = await request(app).post('/api/datasets/ds1/validate');

    expect(res.status).toBe(202);
    expect(res.body.state).toBe('started');
  });

  it('never runs the validation on the request thread', async () => {
    // The defect, stated as a test: a pass that never finishes must not stop
    // the route from answering.
    mockDatasetService.validateAndUpdateDataset.mockReturnValue(new Promise(() => {}));
    mockDatasetService.requestValidation.mockResolvedValue('started');

    const res = await request(app).post('/api/datasets/ds1/validate');

    expect(res.status).toBe(202);
    expect(mockDatasetService.validateAndUpdateDataset).not.toHaveBeenCalled();
  });

  it('refuses a second request while one is in flight rather than queueing it', async () => {
    mockDatasetService.requestValidation
      .mockResolvedValueOnce('queued')
      .mockResolvedValue('in-flight');

    const first = await request(app).post('/api/datasets/ds1/validate');
    const second = await request(app).post('/api/datasets/ds1/validate');

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'VALIDATION_IN_FLIGHT',
      datasetId: 'ds1',
      progressUrl: '/api/datasets/ds1/progress',
    });
  });

  it('answers 503 when there is nothing to open, and leaves the row alone', async () => {
    // Unchanged from before TASK-219, and the reason it is a separate answer:
    // nothing was looked at, so the dataset is not "failed" — the caller should
    // retry rather than go looking at a dataset that is probably fine.
    mockDatasetService.requestValidation.mockResolvedValue('store-unavailable');

    const res = await request(app).post('/api/datasets/ds1/validate');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'STORE_UNAVAILABLE', datasetId: 'ds1' });
  });

  it('404s an unknown dataset without asking for a validation', async () => {
    mockDatasetService.get.mockResolvedValue(null);

    const res = await request(app).post('/api/datasets/missing/validate');

    expect(res.status).toBe(404);
    expect(mockDatasetService.requestValidation).not.toHaveBeenCalled();
  });

  it('500s when the request could not even be accepted', async () => {
    mockDatasetService.requestValidation.mockRejectedValue(new Error('JetStream not available'));

    const res = await request(app).post('/api/datasets/ds1/validate');

    expect(res.status).toBe(500);
  });

  it('sends the caller to a URL that reports THIS pass, not the last verdict', async () => {
    // The 202 promises a place to read the answer. That place used to answer
    // out of the dataset row whenever the service had no progress record —
    // `{status:'ready', progress:100}` for a pass that had not begun, which a
    // client cannot tell from one that finished and passed. The service now
    // always has a record for a pass it accepted (see
    // `DatasetService.getUploadProgress`); the route must prefer it over the
    // row it falls back to.
    mockDatasetService.requestValidation.mockResolvedValue('started');
    mockDatasetService.getUploadProgress.mockResolvedValue({
      datasetId: 'ds1',
      status: 'validating',
      progress: 0,
      message: 'Validation started',
    });

    const accepted = await request(app).post('/api/datasets/ds1/validate');
    const progress = await request(app).get(accepted.body.progressUrl as string);

    // The row still says `ready` — DATASET.status — and that must not be what
    // comes back.
    expect(progress.status).toBe(200);
    expect(progress.body).toMatchObject({ status: 'validating', progress: 0 });
  });
});

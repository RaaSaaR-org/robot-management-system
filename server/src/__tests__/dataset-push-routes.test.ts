/**
 * @file dataset-push-routes.test.ts
 * @description Tests for push-to-hub dataset routes
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock dataset service
const { mockDatasetService } = vi.hoisted(() => ({
  mockDatasetService: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    initiateUpload: vi.fn(),
    completeUpload: vi.fn(),
    getStats: vi.fn(),
    computeStats: vi.fn(),
    getUploadProgress: vi.fn(),
  },
}));

vi.mock('../services/DatasetService.js', () => ({
  datasetService: mockDatasetService,
}));

vi.mock('../services/HuggingFaceImportService.js', () => ({
  huggingFaceImportService: {
    importDataset: vi.fn(),
  },
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

// Mock child_process.spawn to avoid actually running Python
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require('events');
    const child = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 12345;
    return child;
  }),
}));

import { datasetRoutes } from '../routes/datasets.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

const MOCK_DATASET = {
  id: 'ds-001',
  name: 'Test Dataset',
  description: 'A test dataset',
  robotTypeId: 'rt-001',
  storagePath: 'datasets/ds-001/',
  lerobotVersion: 'v2.1',
  fps: 30,
  totalFrames: 1000,
  totalDuration: 33.3,
  demonstrationCount: 5,
  status: 'ready',
  huggingFaceRepoId: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

describe('Dataset Push-to-Hub Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/datasets/:id/push-to-hub
  // --------------------------------------------------------------------------

  describe('POST /api/datasets/:id/push-to-hub', () => {
    it('returns 202 when push is started successfully', async () => {
      mockDatasetService.get.mockResolvedValue(MOCK_DATASET);

      const response = await request(app)
        .post('/api/datasets/ds-001/push-to-hub')
        .send({ token: 'hf_test123', repoId: 'user/my-dataset' });

      expect(response.status).toBe(202);
      expect(response.body.jobId).toBe('ds-001');
      expect(response.body.message).toContain('Push started');
    });

    it('returns 400 when token is missing', async () => {
      const response = await request(app)
        .post('/api/datasets/ds-001/push-to-hub')
        .send({ repoId: 'user/my-dataset' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('token is required');
    });

    it('returns 400 when repoId is missing', async () => {
      const response = await request(app)
        .post('/api/datasets/ds-001/push-to-hub')
        .send({ token: 'hf_test123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('repoId is required');
    });

    it('returns 404 when dataset is not found', async () => {
      mockDatasetService.get.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/datasets/ds-999/push-to-hub')
        .send({ token: 'hf_test123', repoId: 'user/my-dataset' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Dataset not found');
    });

    it('returns 400 when dataset is not ready', async () => {
      mockDatasetService.get.mockResolvedValue({ ...MOCK_DATASET, status: 'validating' });

      const response = await request(app)
        .post('/api/datasets/ds-001/push-to-hub')
        .send({ token: 'hf_test123', repoId: 'user/my-dataset' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('ready state');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/datasets/:id/push-status
  // --------------------------------------------------------------------------

  describe('GET /api/datasets/:id/push-status', () => {
    it('returns none when no push job exists and no HF repo', async () => {
      mockDatasetService.get.mockResolvedValue(MOCK_DATASET);

      const response = await request(app)
        .get('/api/datasets/ds-002/push-status');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('none');
    });

    it('returns done with URL when dataset has HF repo but no active job', async () => {
      mockDatasetService.get.mockResolvedValue({
        ...MOCK_DATASET,
        huggingFaceRepoId: 'user/existing-repo',
      });

      const response = await request(app)
        .get('/api/datasets/ds-002/push-status');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('done');
      expect(response.body.url).toContain('user/existing-repo');
    });

    it('returns 404 when dataset does not exist', async () => {
      mockDatasetService.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/datasets/ds-999/push-status');

      expect(response.status).toBe(404);
    });
  });
});

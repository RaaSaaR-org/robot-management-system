/**
 * @file storage-routes.test.ts
 * @description Integration tests for storage routes (presign, datasets, models, checkpoints, stats, temp cleanup)
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ----------------------------------------------------------------------------
// Mocks (vi.hoisted so they exist before vi.mock hoisting)
// ----------------------------------------------------------------------------

const {
  BUCKETS,
  SIZE_LIMITS,
  mockModelStorage,
  mockIsRustFSInitialized,
  mockGetRustFSClient,
  mockRustFSClient,
} = vi.hoisted(() => ({
  BUCKETS: {
    TRAINING_DATASETS: 'training-datasets',
    MODEL_CHECKPOINTS: 'model-checkpoints',
    PRODUCTION_MODELS: 'production-models',
    ROBOT_LOGS: 'robot-logs',
  } as const,
  SIZE_LIMITS: {
    DATASET: 50 * 1024 * 1024 * 1024,
    MODEL: 10 * 1024 * 1024 * 1024,
    CHECKPOINT: 5 * 1024 * 1024 * 1024,
    LOG: 1 * 1024 * 1024 * 1024,
  } as const,
  mockModelStorage: {
    getPresignedUploadUrl: vi.fn(),
    datasetExists: vi.fn(),
    getDatasetDownloadUrl: vi.fn(),
    listDatasets: vi.fn(),
    modelExists: vi.fn(),
    getModelDownloadUrl: vi.fn(),
    listModelVersions: vi.fn(),
    listCheckpoints: vi.fn(),
    getCheckpointDownloadUrl: vi.fn(),
    getAllStats: vi.fn(),
  },
  mockIsRustFSInitialized: vi.fn(),
  mockGetRustFSClient: vi.fn(),
  mockRustFSClient: {
    delete: vi.fn(),
  },
}));

vi.mock('../storage/index.js', () => ({
  modelStorage: mockModelStorage,
  isRustFSInitialized: mockIsRustFSInitialized,
  getRustFSClient: mockGetRustFSClient,
  BUCKETS,
  SIZE_LIMITS,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { storageRoutes } from '../routes/storage.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/storage', authMiddleware as any, storageRoutes);
  return app;
}

describe('Storage Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: storage is available so the checkStorageAvailable middleware passes through.
    mockIsRustFSInitialized.mockReturnValue(true);
    mockGetRustFSClient.mockReturnValue(mockRustFSClient);
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // checkStorageAvailable middleware (503 when not initialized)
  // --------------------------------------------------------------------------

  describe('checkStorageAvailable middleware', () => {
    it('returns 503 when RustFS storage is not initialized', async () => {
      mockIsRustFSInitialized.mockReturnValue(false);

      const response = await request(app).get('/api/storage/stats');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Storage not available');
      expect(response.body.message).toBe('RustFS storage is not initialized');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/storage/presign
  // --------------------------------------------------------------------------

  describe('POST /api/storage/presign', () => {
    it('returns a presigned upload URL', async () => {
      mockModelStorage.getPresignedUploadUrl.mockResolvedValue({
        url: 'https://rustfs.example/upload',
        expiresIn: 3600,
      });

      const response = await request(app).post('/api/storage/presign').send({
        bucket: BUCKETS.TRAINING_DATASETS,
        key: 'datasets/foo/v1/data.tar',
        contentType: 'application/x-tar',
        size: 1024,
      });

      expect(response.status).toBe(200);
      expect(response.body.uploadUrl).toBe('https://rustfs.example/upload');
      expect(response.body.expiresIn).toBe(3600);
      expect(response.body.bucket).toBe(BUCKETS.TRAINING_DATASETS);
      expect(response.body.key).toBe('datasets/foo/v1/data.tar');
      expect(mockModelStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        BUCKETS.TRAINING_DATASETS,
        'datasets/foo/v1/data.tar',
        'application/x-tar',
        1024
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post('/api/storage/presign').send({
        bucket: BUCKETS.TRAINING_DATASETS,
        key: 'datasets/foo/v1/data.tar',
        // missing contentType and size
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
      expect(response.body.required).toEqual(['bucket', 'key', 'contentType', 'size']);
      expect(mockModelStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid bucket', async () => {
      const response = await request(app).post('/api/storage/presign').send({
        bucket: 'not-a-bucket',
        key: 'datasets/foo/v1/data.tar',
        contentType: 'application/x-tar',
        size: 1024,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid bucket');
      expect(response.body.validBuckets).toEqual(Object.values(BUCKETS));
      expect(mockModelStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('returns 400 with the service error message when presign fails (size too large)', async () => {
      mockModelStorage.getPresignedUploadUrl.mockRejectedValue(
        new Error('File size exceeds limit')
      );

      const response = await request(app).post('/api/storage/presign').send({
        bucket: BUCKETS.TRAINING_DATASETS,
        key: 'datasets/foo/v1/data.tar',
        contentType: 'application/x-tar',
        size: 999,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('File size exceeds limit');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/storage/datasets/:id/complete
  // --------------------------------------------------------------------------

  describe('POST /api/storage/datasets/:id/complete', () => {
    it('marks the dataset upload as complete', async () => {
      mockModelStorage.datasetExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/storage/datasets/ds-1/complete')
        .send({ version: 'v1', metadata: { foo: 'bar' } });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.version).toBe('v1');
      expect(response.body.message).toBe('Dataset upload marked as complete');
      expect(mockModelStorage.datasetExists).toHaveBeenCalledWith('ds-1', 'v1');
    });

    it('returns 400 when version is missing', async () => {
      const response = await request(app)
        .post('/api/storage/datasets/ds-1/complete')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('version is required');
      expect(mockModelStorage.datasetExists).not.toHaveBeenCalled();
    });

    it('returns 404 when the dataset does not exist', async () => {
      mockModelStorage.datasetExists.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/storage/datasets/ds-1/complete')
        .send({ version: 'v1' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Dataset not found');
      expect(response.body.message).toContain('ds-1/v1');
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.datasetExists.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/storage/datasets/ds-1/complete')
        .send({ version: 'v1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to complete dataset upload');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/datasets/:id/download
  // --------------------------------------------------------------------------

  describe('GET /api/storage/datasets/:id/download', () => {
    it('returns a dataset download URL', async () => {
      mockModelStorage.datasetExists.mockResolvedValue(true);
      mockModelStorage.getDatasetDownloadUrl.mockResolvedValue('https://dl/dataset');

      const response = await request(app)
        .get('/api/storage/datasets/ds-1/download')
        .query({ version: 'v1' });

      expect(response.status).toBe(200);
      expect(response.body.downloadUrl).toBe('https://dl/dataset');
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.version).toBe('v1');
      expect(mockModelStorage.getDatasetDownloadUrl).toHaveBeenCalledWith('ds-1', 'v1');
    });

    it('returns 400 when version query param is missing', async () => {
      const response = await request(app).get('/api/storage/datasets/ds-1/download');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('version query parameter is required');
      expect(mockModelStorage.datasetExists).not.toHaveBeenCalled();
    });

    it('returns 404 when the dataset does not exist', async () => {
      mockModelStorage.datasetExists.mockResolvedValue(false);

      const response = await request(app)
        .get('/api/storage/datasets/ds-1/download')
        .query({ version: 'v1' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Dataset not found');
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.datasetExists.mockResolvedValue(true);
      mockModelStorage.getDatasetDownloadUrl.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .get('/api/storage/datasets/ds-1/download')
        .query({ version: 'v1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get download URL');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/datasets
  // --------------------------------------------------------------------------

  describe('GET /api/storage/datasets', () => {
    it('lists datasets', async () => {
      mockModelStorage.listDatasets.mockResolvedValue([{ name: 'a' }, { name: 'b' }]);

      const response = await request(app)
        .get('/api/storage/datasets')
        .query({ prefix: 'foo/' });

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.datasets).toHaveLength(2);
      expect(mockModelStorage.listDatasets).toHaveBeenCalledWith('foo/');
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.listDatasets.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/storage/datasets');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list datasets');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/models/:id/download
  // --------------------------------------------------------------------------

  describe('GET /api/storage/models/:id/download', () => {
    it('returns a model download URL', async () => {
      mockModelStorage.modelExists.mockResolvedValue(true);
      mockModelStorage.getModelDownloadUrl.mockResolvedValue('https://dl/model');

      const response = await request(app)
        .get('/api/storage/models/m-1/download')
        .query({ version: 'v2' });

      expect(response.status).toBe(200);
      expect(response.body.downloadUrl).toBe('https://dl/model');
      expect(response.body.modelId).toBe('m-1');
      expect(response.body.version).toBe('v2');
      expect(mockModelStorage.getModelDownloadUrl).toHaveBeenCalledWith('m-1', 'v2');
    });

    it('returns 400 when version query param is missing', async () => {
      const response = await request(app).get('/api/storage/models/m-1/download');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('version query parameter is required');
      expect(mockModelStorage.modelExists).not.toHaveBeenCalled();
    });

    it('returns 404 when the model does not exist', async () => {
      mockModelStorage.modelExists.mockResolvedValue(false);

      const response = await request(app)
        .get('/api/storage/models/m-1/download')
        .query({ version: 'v2' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Model not found');
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.modelExists.mockResolvedValue(true);
      mockModelStorage.getModelDownloadUrl.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .get('/api/storage/models/m-1/download')
        .query({ version: 'v2' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get download URL');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/models/:id/versions
  // --------------------------------------------------------------------------

  describe('GET /api/storage/models/:id/versions', () => {
    it('lists model versions', async () => {
      mockModelStorage.listModelVersions.mockResolvedValue(['v1', 'v2', 'v3']);

      const response = await request(app).get('/api/storage/models/m-1/versions');

      expect(response.status).toBe(200);
      expect(response.body.modelId).toBe('m-1');
      expect(response.body.count).toBe(3);
      expect(response.body.versions).toEqual(['v1', 'v2', 'v3']);
      expect(mockModelStorage.listModelVersions).toHaveBeenCalledWith('m-1');
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.listModelVersions.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/storage/models/m-1/versions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list model versions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/checkpoints/:jobId
  // --------------------------------------------------------------------------

  describe('GET /api/storage/checkpoints/:jobId', () => {
    it('lists checkpoints for a job', async () => {
      mockModelStorage.listCheckpoints.mockResolvedValue([{ epoch: 1 }, { epoch: 2 }]);

      const response = await request(app).get('/api/storage/checkpoints/job-1');

      expect(response.status).toBe(200);
      expect(response.body.jobId).toBe('job-1');
      expect(response.body.count).toBe(2);
      expect(response.body.checkpoints).toHaveLength(2);
      expect(mockModelStorage.listCheckpoints).toHaveBeenCalledWith('job-1');
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.listCheckpoints.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/storage/checkpoints/job-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list checkpoints');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/checkpoints/:jobId/:epoch/download
  // --------------------------------------------------------------------------

  describe('GET /api/storage/checkpoints/:jobId/:epoch/download', () => {
    it('returns a checkpoint download URL', async () => {
      mockModelStorage.getCheckpointDownloadUrl.mockResolvedValue('https://dl/ckpt');

      const response = await request(app).get(
        '/api/storage/checkpoints/job-1/5/download'
      );

      expect(response.status).toBe(200);
      expect(response.body.downloadUrl).toBe('https://dl/ckpt');
      expect(response.body.jobId).toBe('job-1');
      expect(response.body.epoch).toBe(5);
      expect(mockModelStorage.getCheckpointDownloadUrl).toHaveBeenCalledWith('job-1', 5);
    });

    it('returns 400 for an invalid epoch number', async () => {
      const response = await request(app).get(
        '/api/storage/checkpoints/job-1/abc/download'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid epoch number');
      expect(mockModelStorage.getCheckpointDownloadUrl).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.getCheckpointDownloadUrl.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(
        '/api/storage/checkpoints/job-1/5/download'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get download URL');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/storage/stats
  // --------------------------------------------------------------------------

  describe('GET /api/storage/stats', () => {
    it('returns aggregated storage statistics', async () => {
      mockModelStorage.getAllStats.mockResolvedValue([
        { bucket: 'training-datasets', objectCount: 2, totalSize: 1024 },
        { bucket: 'production-models', objectCount: 3, totalSize: 2048 },
      ]);

      const response = await request(app).get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.buckets).toHaveLength(2);
      expect(response.body.totals.objectCount).toBe(5);
      expect(response.body.totals.totalSize).toBe(3072);
      expect(response.body.totals.totalSizeFormatted).toBe('3 KB');
      expect(response.body.limits).toEqual(SIZE_LIMITS);
      expect(mockModelStorage.getAllStats).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockModelStorage.getAllStats.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/storage/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get storage statistics');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/storage/temp/*
  // --------------------------------------------------------------------------

  describe('DELETE /api/storage/temp/*', () => {
    it('deletes a temp file', async () => {
      mockRustFSClient.delete.mockResolvedValue(undefined);

      const response = await request(app).delete(
        '/api/storage/temp/temp/uploads/abc.bin'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deletedKey).toBe('temp/uploads/abc.bin');
      expect(mockRustFSClient.delete).toHaveBeenCalledWith(
        BUCKETS.MODEL_CHECKPOINTS,
        'temp/uploads/abc.bin'
      );
    });

    it('returns 403 when the key is not under the temp/ prefix', async () => {
      const response = await request(app).delete(
        '/api/storage/temp/models/abc.bin'
      );

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe(
        'Only temp uploads can be deleted via this endpoint'
      );
      expect(mockRustFSClient.delete).not.toHaveBeenCalled();
    });

    it('returns 500 on client delete error', async () => {
      mockRustFSClient.delete.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete(
        '/api/storage/temp/temp/uploads/abc.bin'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete temp file');
    });
  });
});

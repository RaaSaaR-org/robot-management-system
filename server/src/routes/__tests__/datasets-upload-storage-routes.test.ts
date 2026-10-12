/**
 * @file datasets-upload-storage-routes.test.ts
 * @description Both dataset upload routes answer 503 STORAGE_UNAVAILABLE, with
 *   the RustFS state and errorKind, while RustFS is configured but down (TASK-350)
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StorageUnavailableError } from '../../storage/availability.js';

const datasets = vi.hoisted(() => ({
  initiateUpload: vi.fn(),
  completeUpload: vi.fn(),
}));

vi.mock('../../services/HuggingFaceImportService.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/HuggingFaceImportService.js')>(
    '../../services/HuggingFaceImportService.js',
  );
  return { HuggingFaceImportError: actual.HuggingFaceImportError, huggingFaceImportService: {} };
});

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: {
    initiateUpload: datasets.initiateUpload,
    completeUpload: datasets.completeUpload,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  datasetStorageRoot: () => '/tmp',
}));

import { datasetRoutes } from '../datasets.routes.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

const DOWN = new StorageUnavailableError({ state: 'unavailable', errorKind: 'connectivity' });

describe('dataset upload routes while RustFS is configured but down', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp();
  });

  it.each([
    ['initiate', () => datasets.initiateUpload],
    ['complete', () => datasets.completeUpload],
  ])('POST /:id/upload/%s answers 503 naming the errorKind', async (step, fn) => {
    fn().mockRejectedValue(DOWN);

    const response = await request(app).post(`/api/datasets/ds1/upload/${step}`).send({});

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      state: 'unavailable',
      errorKind: 'connectivity',
    });
    expect(response.body.error).toContain('(connectivity)');
  });

  it('keeps the old 400 for an unconfigured server (a plain Error)', async () => {
    datasets.initiateUpload.mockRejectedValue(new Error('Storage service not available'));

    const response = await request(app).post('/api/datasets/ds1/upload/initiate').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Failed to initiate upload' });
  });
});

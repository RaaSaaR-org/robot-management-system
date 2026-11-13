/**
 * @file datasets-delete-upload-routes.test.ts
 * @description Deleting a dataset that a direct upload is filling (TASK-480):
 *   the upload is released first — its open multipart uploads are not objects,
 *   so the prefix delete alone would leave them — and a caller that cannot see
 *   the dataset can never reach another organization's upload through it.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  releaseForDelete: vi.fn(),
  order: [] as string[],
}));

vi.mock('../../services/HuggingFaceImportService.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/HuggingFaceImportService.js')>(
    '../../services/HuggingFaceImportService.js',
  );
  return { HuggingFaceImportError: actual.HuggingFaceImportError, huggingFaceImportService: {} };
});

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: { get: mocks.get, delete: mocks.remove, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  datasetStorageRoot: () => '/tmp',
}));

vi.mock('../../services/datasetUpload/DatasetUploadService.js', () => ({
  datasetUploadService: { releaseForDelete: mocks.releaseForDelete },
}));

import { datasetRoutes } from '../datasets.routes.js';
import { DatasetUploadError } from '../../services/datasetUpload/uploadManifest.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

describe('DELETE /api/datasets/:id and a direct upload', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.get.mockResolvedValue({ id: 'ds1', status: 'uploading' });
    mocks.releaseForDelete.mockImplementation(async () => { mocks.order.push('release'); });
    mocks.remove.mockImplementation(async () => { mocks.order.push('delete'); return true; });
    app = createApp();
  });

  it('releases the upload before the dataset and its prefix are deleted', async () => {
    const response = await request(app).delete('/api/datasets/ds1');

    expect(response.status).toBe(200);
    expect(mocks.releaseForDelete).toHaveBeenCalledWith('ds1');
    expect(mocks.order).toEqual(['release', 'delete']);
  });

  it('does not touch any upload for a dataset the caller cannot see', async () => {
    mocks.get.mockResolvedValue(null);
    mocks.remove.mockResolvedValue(false);

    const response = await request(app).delete('/api/datasets/someone-elses');

    expect(response.status).toBe(404);
    expect(mocks.releaseForDelete).not.toHaveBeenCalled();
  });

  it('answers 409 and keeps the dataset while its upload is being finished', async () => {
    mocks.releaseForDelete.mockRejectedValue(new DatasetUploadError(
      'UPLOAD_PROCESSING', 'The upload of this dataset is being finished; delete it once it has settled.', 409,
    ));

    const response = await request(app).delete('/api/datasets/ds1');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'UPLOAD_PROCESSING' });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

/**
 * @file dataset-modality-route.test.ts
 * @description `GET /api/datasets/:id/modality` (TASK-476): the joint groups of
 *              a dataset's state and action vectors, and what the route answers
 *              when there are none, no dataset, or no store.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockDatasetService } = vi.hoisted(() => ({
  mockDatasetService: { getModality: vi.fn(), getStats: vi.fn() },
}));

vi.mock('../services/DatasetService.js', () => ({ datasetService: mockDatasetService }));
vi.mock('../repositories/DatasetEpisodeFlagRepository.js', () => ({ datasetEpisodeFlagRepository: {} }));
vi.mock('../repositories/index.js', () => ({ robotTypeRepository: {} }));
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
import { DatasetStoreError } from '../services/lerobot/DatasetTree.js';

const app = express();
app.use(express.json());
app.use('/api/datasets', datasetRoutes);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/datasets/:id/modality', () => {
  it('answers the joint groups', async () => {
    const modality = {
      state: [{ name: 'left_arm', start: 15, end: 22 }],
      action: [{ name: 'left_arm', start: 15, end: 22 }],
    };
    mockDatasetService.getModality.mockResolvedValue({ datasetId: 'ds1', modality });

    const res = await request(app).get('/api/datasets/ds1/modality');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ datasetId: 'ds1', modality });
    expect(mockDatasetService.getModality).toHaveBeenCalledWith('ds1');
  });

  it('answers 200 with modality null for a dataset that has no modality.json', async () => {
    mockDatasetService.getModality.mockResolvedValue({ datasetId: 'ds1', modality: null });
    const res = await request(app).get('/api/datasets/ds1/modality');
    expect(res.status).toBe(200);
    expect(res.body.modality).toBeNull();
  });

  it('answers 404 for an unknown dataset', async () => {
    mockDatasetService.getModality.mockRejectedValue(new Error('Dataset not found: nope'));
    const res = await request(app).get('/api/datasets/nope/modality');
    expect(res.status).toBe(404);
  });

  it('answers 503, not 500, when the object store did not answer', async () => {
    mockDatasetService.getModality.mockRejectedValue(
      new DatasetStoreError('meta/modality.json', new Error('timeout')),
    );
    const res = await request(app).get('/api/datasets/ds1/modality');
    expect(res.status).toBe(503);
  });
});

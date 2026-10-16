/**
 * @file dataset-publish-routes.test.ts
 * @description Routes for publishing a dataset to the Hugging Face Hub (TASK-394):
 *              input validation, refusal codes, status. The service is mocked.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPublish, MockPublishError } = vi.hoisted(() => {
  class MockPublishError extends Error {
    constructor(message: string, public status: number, public code: string) {
      super(message);
    }
  }
  return {
    MockPublishError,
    mockPublish: { publish: vi.fn(), getJob: vi.fn(), getStatus: vi.fn() },
  };
});

vi.mock('../services/HuggingFacePublishService.js', () => ({
  huggingFacePublishService: mockPublish,
  PublishError: MockPublishError,
}));
vi.mock('../services/DatasetService.js', () => ({
  datasetService: { get: vi.fn() },
  DatasetExpectationError: class extends Error {},
}));
vi.mock('../services/HuggingFaceImportService.js', () => ({
  huggingFaceImportService: {},
  HuggingFaceImportError: class extends Error {},
}));
vi.mock('../services/DataQualityService.js', () => ({ dataQualityService: {} }));
vi.mock('../storage/model-storage.js', () => ({ modelStorage: {}, BUCKETS: { TRAINING_DATASETS: 'training-datasets' } }));
vi.mock('../storage/rustfs-client.js', () => ({ getRustFSClient: vi.fn(), isRustFSInitialized: vi.fn().mockReturnValue(false) }));

import { datasetRoutes } from '../routes/datasets.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: 'user-1' };
    next();
  });
  app.use('/api/datasets', datasetRoutes);
  return app;
}

describe('Dataset publish routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /api/datasets/:id/publish', () => {
    it('starts a publish and answers 202 with the job', async () => {
      mockPublish.publish.mockResolvedValue({ status: 'running', repoId: 'zemarobotik/g1', private: true });
      const res = await request(app)
        .post('/api/datasets/ds-1/publish')
        .send({ repoId: 'zemarobotik/g1', tags: ['apple'], license: 'Apache-2.0' });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ status: 'running', repoId: 'zemarobotik/g1' });
      expect(mockPublish.publish).toHaveBeenCalledWith(
        'ds-1',
        { repoId: 'zemarobotik/g1', tags: ['apple'], license: 'apache-2.0' },
        'user-1',
      );
    });

    it.each([
      [{}, 'repoId'],
      [{ repoId: 'a/b', private: 'yes' }, 'private'],
      [{ repoId: 'a/b', tags: ['has space'] }, 'tags.0'],
      [{ repoId: 'a/b', license: 'not a license' }, 'license'],
      [{ repoId: 'a/b', token: 'hf_x' }, '(body)'],
    ])('rejects %j with 400 naming %s', async (body, field) => {
      const res = await request(app).post('/api/datasets/ds-1/publish').send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PUBLISH_REQUEST');
      expect(res.body.fields).toContain(field);
      expect(mockPublish.publish).not.toHaveBeenCalled();
    });

    it.each([
      [409, 'DATASET_DEGRADED'],
      [409, 'DATASET_NOT_READY'],
      [503, 'HF_TOKEN_MISSING'],
      [403, 'NAMESPACE_FORBIDDEN'],
      [404, 'DATASET_NOT_FOUND'],
    ])('passes a %i %s refusal through with its code', async (status, code) => {
      mockPublish.publish.mockRejectedValue(new MockPublishError('refused', status, code));
      const res = await request(app).post('/api/datasets/ds-1/publish').send({ repoId: 'zemarobotik/g1' });
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: 'refused', code });
    });
  });

  describe('GET /api/datasets/:id/publish', () => {
    it('returns the job', async () => {
      mockPublish.getJob.mockResolvedValue({ status: 'done', url: 'https://huggingface.co/datasets/zemarobotik/g1' });
      const res = await request(app).get('/api/datasets/ds-1/publish');
      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://huggingface.co/datasets/zemarobotik/g1');
    });

    it('404s for an unknown dataset', async () => {
      mockPublish.getJob.mockResolvedValue(null);
      expect((await request(app).get('/api/datasets/nope/publish')).status).toBe(404);
    });
  });

  describe('GET /api/datasets/publish/status', () => {
    it('returns the account status, not a dataset', async () => {
      mockPublish.getStatus.mockResolvedValue({ configured: true, source: 'file', user: 'huhn511', orgs: [], defaultNamespace: 'zemarobotik' });
      const res = await request(app).get('/api/datasets/publish/status');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ configured: true, user: 'huhn511' });
    });
  });

  it('no longer serves the legacy push-to-hub route', async () => {
    const res = await request(app).post('/api/datasets/ds-1/push-to-hub').send({ token: 'hf_x', repoId: 'a/b' });
    expect(res.status).toBe(404);
  });
});

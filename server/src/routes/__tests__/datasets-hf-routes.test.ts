/**
 * @file datasets-hf-routes.test.ts
 * @description Integration tests for the HuggingFace preview and retry routes
 * @feature datasets
 *
 * Route order is the defect class this file has had before — `/robot-types`
 * and `/interventions` are both single-segment GETs that `/:id` would swallow
 * if they moved below it, and both carry a comment saying so. `/hf/preview` is
 * two segments and so is not at risk from `/:id` itself; what IS worth pinning
 * is that a request for it reaches the preview handler rather than any of the
 * `/:id/<literal>` routes, which a unit test of the service cannot see.
 *
 * The rest is the status mapping. Every HuggingFace failure used to come back
 * 400 after a chain of `message.includes` tests on English prose, so "no such
 * repo", "an import is already running" and "huggingface.co is down" were one
 * answer to a client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const hf = vi.hoisted(() => ({
  previewRepo: vi.fn(),
  retryImport: vi.fn(),
  importDataset: vi.fn(),
}));

const datasets = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../services/HuggingFaceImportService.js', async () => {
  // The error class is the real one: the route's status mapping IS the thing
  // under test, and a stand-in would be testing the stand-in.
  const actual = await vi.importActual<typeof import('../../services/HuggingFaceImportService.js')>(
    '../../services/HuggingFaceImportService.js',
  );
  return {
    HuggingFaceImportError: actual.HuggingFaceImportError,
    huggingFaceImportService: hf,
  };
});

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: {
    get: datasets.get,
    list: vi.fn().mockResolvedValue({ data: [], pagination: {} }),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  datasetStorageRoot: () => '/tmp',
}));

import { datasetRoutes } from '../datasets.routes.js';
import { HuggingFaceImportError } from '../../services/HuggingFaceImportService.js';

const PREVIEW = {
  repoId: 'nvidia/GR00T-N1.7-AppleToPlate',
  revision: 'main',
  resolvedRevision: '7628202a2180972f291ba1bc6723834921e72c19',
  lerobotVersion: 'v2.1',
  robotType: 'unitree_g1',
  fps: 30,
  totalEpisodes: 402,
  totalFrames: 171_625,
  stateWidth: 43,
  actionWidth: 43,
  cameraKeys: ['observation.images.ego_view'],
  fileCount: 810,
  dataBytes: 73_000_000,
  videoBytes: 929_000_000,
  license: 'cc-by-4.0',
};

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

describe('dataset HuggingFace routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /api/datasets/hf/preview', () => {
    it('reaches the preview handler, not a dataset lookup for an id of "hf"', async () => {
      hf.previewRepo.mockResolvedValue(PREVIEW);
      datasets.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/datasets/hf/preview')
        .query({ repoId: PREVIEW.repoId });

      expect(response.status).toBe(200);
      expect(hf.previewRepo).toHaveBeenCalledWith(PREVIEW.repoId, 'main');
      // Nothing under `/:id` answered it: a handler that got there first would
      // have looked up a dataset and returned its 404 instead.
      expect(datasets.get).not.toHaveBeenCalled();
    });

    it('returns everything the modal needs to price the download', async () => {
      hf.previewRepo.mockResolvedValue(PREVIEW);

      const response = await request(app)
        .get('/api/datasets/hf/preview')
        .query({ repoId: PREVIEW.repoId });

      expect(response.body).toEqual(PREVIEW);
      expect(response.body.videoBytes).toBeGreaterThan(response.body.dataBytes);
    });

    it('passes a revision through when one is given', async () => {
      hf.previewRepo.mockResolvedValue(PREVIEW);

      await request(app)
        .get('/api/datasets/hf/preview')
        .query({ repoId: PREVIEW.repoId, revision: 'refs/convert/parquet' });

      expect(hf.previewRepo).toHaveBeenCalledWith(PREVIEW.repoId, 'refs/convert/parquet');
    });

    it('is a 400 without a repoId', async () => {
      const response = await request(app).get('/api/datasets/hf/preview');

      expect(response.status).toBe(400);
      expect(hf.previewRepo).not.toHaveBeenCalled();
    });

    it('is a 404 for a repo that is not there', async () => {
      hf.previewRepo.mockRejectedValue(
        new HuggingFaceImportError('REPO_NOT_FOUND', 'No such dataset repo: nobody/nothing', 404),
      );

      const response = await request(app)
        .get('/api/datasets/hf/preview')
        .query({ repoId: 'nobody/nothing' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('REPO_NOT_FOUND');
    });

    it('is a 502 when the Hub itself is the problem, not a 400', async () => {
      // The old handler mapped every failure to 400 after testing English
      // prose with `message.includes`, so "your request is wrong" and
      // "huggingface.co is down" were the same answer.
      hf.previewRepo.mockRejectedValue(
        new HuggingFaceImportError('REPO_UNREACHABLE', 'HuggingFace returned 503', 502),
      );

      const response = await request(app)
        .get('/api/datasets/hf/preview')
        .query({ repoId: PREVIEW.repoId });

      expect(response.status).toBe(502);
      expect(response.body.code).toBe('REPO_UNREACHABLE');
    });
  });

  describe('POST /api/datasets/:id/import/retry', () => {
    it('is a 202 carrying the dataset it restarted', async () => {
      hf.retryImport.mockResolvedValue({ datasetId: 'ds-1', status: 'importing' });

      const response = await request(app).post('/api/datasets/ds-1/import/retry');

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ datasetId: 'ds-1', status: 'importing' });
    });

    it('is a 409 when an import is already in flight', async () => {
      hf.retryImport.mockRejectedValue(
        new HuggingFaceImportError('IN_PROGRESS', 'Dataset ds-1 is already importing', 409),
      );

      const response = await request(app).post('/api/datasets/ds-1/import/retry');

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IN_PROGRESS');
    });

    it('is a 400 for a dataset that never came from the Hub', async () => {
      hf.retryImport.mockRejectedValue(
        new HuggingFaceImportError('NOT_AN_IMPORT', 'nothing to retry', 400),
      );

      const response = await request(app).post('/api/datasets/ds-1/import/retry');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('NOT_AN_IMPORT');
    });

    it('is a 404 for a dataset that does not exist', async () => {
      hf.retryImport.mockRejectedValue(
        new HuggingFaceImportError('NOT_FOUND', 'Dataset not found: nope', 404),
      );

      const response = await request(app).post('/api/datasets/nope/import/retry');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/datasets/import/huggingface', () => {
    it('is a 400 without a repoId', async () => {
      const response = await request(app).post('/api/datasets/import/huggingface').send({});

      expect(response.status).toBe(400);
      expect(hf.importDataset).not.toHaveBeenCalled();
    });

    it('is a 404 when the repo does not exist, not a blanket 400', async () => {
      hf.importDataset.mockRejectedValue(
        new HuggingFaceImportError('REPO_NOT_FOUND', 'No such dataset repo', 404),
      );

      const response = await request(app)
        .post('/api/datasets/import/huggingface')
        .send({ repoId: 'nobody/nothing' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('REPO_NOT_FOUND');
    });

    it('passes includeVideos through to the service', async () => {
      hf.importDataset.mockResolvedValue('ds-1');

      const response = await request(app)
        .post('/api/datasets/import/huggingface')
        .send({ repoId: PREVIEW.repoId, includeVideos: true });

      expect(response.status).toBe(202);
      expect(hf.importDataset).toHaveBeenCalledWith(
        expect.objectContaining({ repoId: PREVIEW.repoId, includeVideos: true }),
      );
    });
  });
});

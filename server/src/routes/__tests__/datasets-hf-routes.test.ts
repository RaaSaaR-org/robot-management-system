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
  getUploadProgress: vi.fn(),
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
    getUploadProgress: datasets.getUploadProgress,
    list: vi.fn().mockResolvedValue({ data: [], pagination: {} }),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  datasetStorageRoot: () => '/tmp',
}));

import { datasetRoutes } from '../datasets.routes.js';
import { HuggingFaceImportError } from '../../services/HuggingFaceImportService.js';
import { importActivityLog } from '../../services/ImportActivityLog.js';

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
      // What the route is responsible for: reaching the service with the repo
      // the caller named, and passing every field through untouched. Comparing
      // `videoBytes > dataBytes` on the way back out would only compare two
      // literals from this file to each other — the handler is `res.json(...)`,
      // so no change to the route could ever make that fail.
      expect(hf.previewRepo).toHaveBeenCalledWith(PREVIEW.repoId, 'main');
      // The split is the point of the endpoint, so assert the fields EXIST
      // rather than that one fixture number exceeds another.
      expect(response.body).toHaveProperty('dataBytes');
      expect(response.body).toHaveProperty('videoBytes');
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

  describe('GET /:id/import/log (TASK-352)', () => {
    it('backfills the lines and the last progress frame of an import this server is running', async () => {
      importActivityLog.start('ds-log');
      importActivityLog.append('ds-log', 'info', 'Downloading 3 files from the Hub');
      importActivityLog.setProgress('ds-log', {
        datasetId: 'ds-log', status: 'importing', phase: 'downloading', progress: 40,
      });
      datasets.get.mockResolvedValue({ id: 'ds-log', status: 'importing', importError: null });

      const response = await request(app).get('/api/datasets/ds-log/import/log');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        datasetId: 'ds-log',
        status: 'importing',
        retained: true,
        progress: { progress: 40 },
        lines: [{ level: 'info', message: 'Downloading 3 files from the Hub' }],
      });
    });

    it('still gives the status and the reason after a restart lost the lines', async () => {
      importActivityLog.forget('ds-old');
      const importError = { phase: 'downloading', error: '500 Server Error', repoId: 'a/b', failedAt: '2026-10-12T00:00:00Z' };
      datasets.get.mockResolvedValue({ id: 'ds-old', status: 'failed', importError });

      const response = await request(app).get('/api/datasets/ds-old/import/log');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'failed', importError, lines: [], retained: false });
    });

    it('names the pinned commit and the LeRobot version, so the panel can show them (TASK-358)', async () => {
      importActivityLog.forget('ds-rev');
      datasets.get.mockResolvedValue({
        id: 'ds-rev', status: 'importing', importError: null,
        sourceRevision: '89d5752c021e580d26d90ceec7e8192ef01e7c30', lerobotVersion: 'v2.1',
      });

      const response = await request(app).get('/api/datasets/ds-rev/import/log');

      expect(response.body).toMatchObject({
        sourceRevision: '89d5752c021e580d26d90ceec7e8192ef01e7c30',
        lerobotVersion: 'v2.1',
      });
    });

    it('404s for a dataset that does not exist', async () => {
      datasets.get.mockResolvedValue(null);
      const response = await request(app).get('/api/datasets/nope/import/log');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /:id/progress during a Hub import (#370)', () => {
    const DOWNLOADING = {
      datasetId: 'ds-dl', status: 'importing' as const, phase: 'downloading' as const, progress: 42,
      totalFiles: 40, completedFiles: 12, downloadedBytes: 400, totalBytes: 1000, importMode: 'full' as const,
    };

    it('answers with the download frame, not the 0 it fell through to before', async () => {
      importActivityLog.start('ds-dl');
      importActivityLog.setProgress('ds-dl', DOWNLOADING);
      datasets.getUploadProgress.mockResolvedValue(null);

      const response = await request(app).get('/api/datasets/ds-dl/progress');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DOWNLOADING);
      // The validation-progress store was not even asked: a download has none.
      expect(datasets.getUploadProgress).not.toHaveBeenCalled();
    });

    it('says null (unmeasured) for an import whose frame a restart lost', async () => {
      importActivityLog.forget('ds-lost');
      datasets.getUploadProgress.mockResolvedValue(null);
      datasets.get.mockResolvedValue({ id: 'ds-lost', status: 'importing', huggingFaceRepoId: 'a/b', importError: null });

      const response = await request(app).get('/api/datasets/ds-lost/progress');

      expect(response.body).toEqual({ datasetId: 'ds-lost', status: 'importing', progress: null });
    });

    it('keeps where a failed import stopped, with the persisted reason', async () => {
      importActivityLog.start('ds-f');
      importActivityLog.setProgress('ds-f', { ...DOWNLOADING, datasetId: 'ds-f', status: 'failed', error: 'terminated' });
      datasets.getUploadProgress.mockResolvedValue(null);
      const importError = { phase: 'downloading', error: 'terminated', repoId: 'a/b', failedAt: '2026-10-12T00:00:00Z' };
      datasets.get.mockResolvedValue({ id: 'ds-f', status: 'failed', huggingFaceRepoId: 'a/b', importError });

      const response = await request(app).get('/api/datasets/ds-f/progress');

      expect(response.body).toMatchObject({ status: 'failed', progress: 42, completedFiles: 12, error: 'terminated' });
    });
  });
});

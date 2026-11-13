/**
 * @file model-uploads-routes.test.ts
 * @description The HTTP face of the direct model upload (TASK-498): status
 *   codes and bodies of each endpoint, that a part reaches the service as an
 *   unparsed stream, that a stored file is served whole, by range and to a
 *   HEAD, that its stream is given back when the client leaves, and that
 *   deleting an uploaded model removes its files.
 * @feature deployment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { Readable } from 'stream';

const uploads = vi.hoisted(() => ({
  start: vi.fn(),
  listOpen: vi.fn(),
  status: vi.fn(),
  receivePart: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  manifest: vi.fn(),
  file: vi.fn(),
  removeStoredFiles: vi.fn(),
  storageOf: vi.fn(),
}));
const registry = vi.hoisted(() => ({
  findById: vi.fn(),
  findByIdWithRelations: vi.fn(),
  getEvaluationSummary: vi.fn(),
  archive: vi.fn(),
  datasetFindById: vi.fn(),
}));

vi.mock('../../services/modelUpload/ModelUploadService.js', () => ({
  modelUploadService: uploads,
  DEFAULT_MODEL_FILES_PAGE: 1000,
  MAX_MODEL_FILES_PAGE: 1000,
}));
vi.mock('../../repositories/index.js', () => ({
  modelVersionRepository: {
    findById: registry.findById,
    findByIdWithRelations: registry.findByIdWithRelations,
    getEvaluationSummary: registry.getEvaluationSummary,
  },
  datasetRepository: { findById: registry.datasetFindById },
}));
vi.mock('../../services/ModelRegistryService.js', () => ({ modelRegistryService: { archive: registry.archive } }));
vi.mock('../../services/buildAudit.js', () => ({ auditBuildAct: vi.fn(async () => undefined) }));

import { modelUploadRoutes, isModelUploadPart } from '../model-uploads.routes.js';
import { modelsRoutes } from '../models.routes.js';
import { DatasetUploadError } from '../../services/datasetUpload/uploadManifest.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/models', modelUploadRoutes);
  app.use('/api/models', modelsRoutes);
  return app;
}

const DATA = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const SHA = createHash('sha256').update(DATA).digest('hex');

function stored(open = vi.fn(async (options?: { range?: { start: number; end: number } }) =>
  Readable.from([options?.range ? DATA.subarray(options.range.start, options.range.end + 1) : DATA]))) {
  uploads.file.mockResolvedValue({ entry: { id: 0, path: 'processor/weights.bin', size: DATA.length, sha256: SHA, partCount: 1 }, open });
  return open;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  registry.findById.mockResolvedValue({ id: 'm1' });
  app = createApp();
});

describe('upload endpoints', () => {
  it('POST /uploads answers 201 with what the service opened', async () => {
    uploads.start.mockResolvedValue({ uploadId: 'u1', state: 'uploading', chunkSize: 33554432, files: [] });
    const body = { name: 'g11', version: '1', files: [{ path: 'config.json', size: 2 }] };
    const res = await request(app).post('/api/models/uploads').send(body);
    expect(res.status).toBe(201);
    expect(res.body.uploadId).toBe('u1');
    expect(uploads.start).toHaveBeenCalledWith(body);
  });

  it('answers a refusal with its status, code and context', async () => {
    uploads.start.mockRejectedValue(new DatasetUploadError('INSUFFICIENT_STORAGE', 'The model is 6.5 GB and the store has 1.0 GB free.', 507, { freeBytes: 1 }));
    const res = await request(app).post('/api/models/uploads').send({});
    expect(res.status).toBe(507);
    expect(res.body).toEqual({ error: 'The model is 6.5 GB and the store has 1.0 GB free.', code: 'INSUFFICIENT_STORAGE', freeBytes: 1 });
  });

  it('GET /uploads lists the open uploads and GET /uploads/:id one of them', async () => {
    uploads.listOpen.mockResolvedValue([{ uploadId: 'u1', state: 'uploading' }]);
    uploads.status.mockResolvedValue({ uploadId: 'u1', state: 'uploading', files: [] });
    expect((await request(app).get('/api/models/uploads')).body).toEqual({ uploads: [{ uploadId: 'u1', state: 'uploading' }] });
    expect((await request(app).get('/api/models/uploads/u1')).body.uploadId).toBe('u1');
    expect(uploads.status).toHaveBeenCalledWith('u1');
  });

  it('hands a part to the service as a raw stream with its length and checksum', async () => {
    uploads.receivePart.mockImplementation(async (_id, fileId, partNumber, source: Readable, options) => {
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of source) { hash.update(chunk as Buffer); size += (chunk as Buffer).length; }
      return { fileId, partNumber, size, sha256: hash.digest('hex'), options };
    });
    const res = await request(app)
      .put('/api/models/uploads/u1/files/3/parts/2')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Chunk-Sha256', SHA)
      .send(DATA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fileId: 3, partNumber: 2, size: DATA.length, sha256: SHA, options: { contentLength: DATA.length, sha256: SHA } });
  });

  it('refuses a part that is not an octet stream, and answers UPLOAD_BUSY with Retry-After', async () => {
    const wrong = await request(app).put('/api/models/uploads/u1/files/0/parts/1').send({ a: 1 });
    expect(wrong.status).toBe(415);
    uploads.receivePart.mockRejectedValue(new DatasetUploadError('UPLOAD_BUSY', 'busy', 503, { retryAfterSeconds: 2 }));
    const busy = await request(app).put('/api/models/uploads/u1/files/0/parts/1').set('Content-Type', 'application/octet-stream').send(DATA);
    expect(busy.status).toBe(503);
    expect(busy.headers['retry-after']).toBe('2');
    expect(busy.body.code).toBe('UPLOAD_BUSY');
  });

  it('finish answers 202 while the server works and 200 once registered; cancel answers what was done', async () => {
    uploads.finish.mockResolvedValueOnce({ uploadId: 'u1', state: 'processing', modelVersionId: null });
    expect((await request(app).post('/api/models/uploads/u1/finish')).status).toBe(202);
    uploads.finish.mockResolvedValueOnce({ uploadId: 'u1', state: 'completed', modelVersionId: 'u1' });
    expect((await request(app).post('/api/models/uploads/u1/finish')).status).toBe(200);
    uploads.cancel.mockResolvedValue({ uploadId: 'u1', status: 'cancelled' });
    expect((await request(app).post('/api/models/uploads/u1/cancel')).body.status).toBe('cancelled');
  });

  it('exempts exactly the part requests from the rate limits', () => {
    expect(isModelUploadPart('PUT', '/api/models/uploads/abc/files/0/parts/1')).toBe(true);
    expect(isModelUploadPart('PUT', '/models/uploads/abc/files/12/parts/149/')).toBe(true);
    expect(isModelUploadPart('POST', '/api/models/uploads/abc/files/0/parts/1')).toBe(false);
    expect(isModelUploadPart('PUT', '/api/models/uploads/abc/finish')).toBe(false);
    expect(isModelUploadPart('PUT', '/api/datasets/abc/upload/files/0/parts/1')).toBe(false);
  });
});

describe('GET /versions/:id/files', () => {
  it('answers the manifest', async () => {
    uploads.manifest.mockResolvedValue({ modelVersionId: 'm1', totalBytes: 1000, fileCount: 1, files: [{ path: 'a', size: 1000, sha256: null }] });
    const res = await request(app).get('/api/models/versions/m1/files');
    expect(res.status).toBe(200);
    expect(res.body.fileCount).toBe(1);
    expect(uploads.manifest).toHaveBeenCalledWith('m1', { after: undefined, limit: 1000 });
  });

  it('pages the list like a dataset\'s, and refuses a limit or cursor it cannot use', async () => {
    uploads.manifest.mockResolvedValue({ files: [], nextCursor: null });
    await request(app).get('/api/models/versions/m1/files?limit=2&after=config.json');
    expect(uploads.manifest).toHaveBeenLastCalledWith('m1', { after: 'config.json', limit: 2 });
    const limit = await request(app).get('/api/models/versions/m1/files?limit=5000');
    expect(limit.status).toBe(400);
    expect(limit.body.code).toBe('INVALID_LIMIT');
    const cursor = await request(app).get('/api/models/versions/m1/files?after=../x');
    expect(cursor.status).toBe(400);
    expect(cursor.body.code).toBe('INVALID_CURSOR');
  });

  it('answers 404 for a model the caller cannot see, before asking about files', async () => {
    registry.findById.mockResolvedValue(null);
    const res = await request(app).get('/api/models/versions/other/files');
    expect(res.status).toBe(404);
    expect(uploads.manifest).not.toHaveBeenCalled();
    expect((await request(app).get('/api/models/versions/other/files/content?path=config.json')).status).toBe(404);
    expect(uploads.file).not.toHaveBeenCalled();
  });

  it('answers the refusal of a model that has no stored files, or lost them', async () => {
    uploads.manifest.mockRejectedValue(new DatasetUploadError('ARTIFACT_REMOVED', 'removed', 410));
    const res = await request(app).get('/api/models/versions/m1/files');
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('ARTIFACT_REMOVED');
  });
});

describe('GET /versions/:id/files/content?path=', () => {
  it('serves the whole file with its length and checksum', async () => {
    const open = stored();
    const res = await request(app).get('/api/models/versions/m1/files/content?path=processor/weights.bin').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(uploads.file).toHaveBeenCalledWith('m1', 'processor/weights.bin');
    expect(res.headers['content-length']).toBe(String(DATA.length));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['x-content-sha256']).toBe(SHA);
    expect((res.body as Buffer).equals(DATA)).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ range: undefined }));
  });

  it('serves a byte range as 206 and asks the store for that window only', async () => {
    const open = stored();
    const res = await request(app).get('/api/models/versions/m1/files/content?path=processor/weights.bin').set('Range', 'bytes=100-299')
      .buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 100-299/${DATA.length}`);
    expect(res.headers['content-length']).toBe('200');
    expect((res.body as Buffer).equals(DATA.subarray(100, 300))).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ range: { start: 100, end: 299 } }));
  });

  it('answers 416 for a range outside the file, and a HEAD without opening anything', async () => {
    const open = stored();
    const bad = await request(app).get('/api/models/versions/m1/files/content?path=processor/weights.bin').set('Range', 'bytes=5000-');
    expect(bad.status).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${DATA.length}`);
    expect(bad.body).toMatchObject({ code: 'RANGE_NOT_SATISFIABLE', size: DATA.length });
    const head = await request(app).head('/api/models/versions/m1/files/content?path=processor/weights.bin');
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(DATA.length));
    expect(open).not.toHaveBeenCalled();
  });

  it('answers 404 FILE_NOT_FOUND for a path the manifest does not list', async () => {
    uploads.file.mockRejectedValue(new DatasetUploadError('FILE_NOT_FOUND', 'This model has no file x', 404));
    const res = await request(app).get('/api/models/versions/m1/files/content?path=x');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('FILE_NOT_FOUND');
  });

  it('refuses a path that could leave the model before asking for anything', async () => {
    for (const path of ['../other/secret.bin', '/etc/passwd', 'a//b', '']) {
      const res = await request(app).get('/api/models/versions/m1/files/content').query({ path });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PATH');
    }
    expect((await request(app).get('/api/models/versions/m1/files/content')).body.code).toBe('INVALID_PATH');
    expect(uploads.file).not.toHaveBeenCalled();
    expect(registry.findById).not.toHaveBeenCalled();
  });

  it('answers 503 STORAGE_TIMEOUT with Retry-After when the store does not answer in time', async () => {
    stored(vi.fn(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }));
    const res = await request(app).get('/api/models/versions/m1/files/content?path=processor/weights.bin');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STORAGE_TIMEOUT');
    expect(res.headers['retry-after']).toBe('2');
    expect(res.headers['x-content-sha256']).toBeUndefined();
  });

  it('answers 502 without the file headers when the store fails before the first byte', async () => {
    stored(vi.fn(async () => new Readable({ read() { this.destroy(new Error('socket hang up')); } })));
    const res = await request(app).get('/api/models/versions/m1/files/content?path=processor/weights.bin');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('STORE_ERROR');
    expect(res.headers['x-content-sha256']).toBeUndefined();
  });

  it('gives the store stream back when the client leaves mid-download', async () => {
    let body: Readable | undefined;
    let signal: AbortSignal | undefined;
    const open = vi.fn(async (options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      // Never ends on its own: only the client leaving can release it.
      body = new Readable({ read() { this.push(Buffer.alloc(1024)); } });
      return body;
    });
    // A 5 GB shard: far more than the client will stay for.
    uploads.file.mockResolvedValue({ entry: { id: 0, path: 'processor/weights.bin', size: 4_990_519_232, partCount: 149 }, open });
    const server = http.createServer(app).listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve, reject) => {
        const req = http.get({ port, path: '/api/models/versions/m1/files/content?path=processor/weights.bin' }, (res) => {
          res.once('data', () => { req.destroy(); resolve(); });
        });
        req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? resolve() : reject(error)));
      });
      const deadline = Date.now() + 2000;
      while (!body?.destroyed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      expect(body?.destroyed).toBe(true);
      expect(signal?.aborted).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe('the registry routes of an uploaded model', () => {
  it('DELETE archives and then removes the stored files, saying how much was freed', async () => {
    registry.archive.mockResolvedValue({ before: { id: 'm1', deploymentStatus: 'staging', version: '1', artifactUri: 's3://production-models/uploads/m1/' } });
    uploads.removeStoredFiles.mockResolvedValue({ removed: true, freedBytes: 6_911_196_610 });
    const res = await request(app).delete('/api/models/versions/m1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'm1', outcome: 'archived', storedFilesRemoved: true, freedBytes: 6_911_196_610 });
    expect(registry.archive.mock.invocationCallOrder[0]).toBeLessThan(uploads.removeStoredFiles.mock.invocationCallOrder[0]);
  });

  it('DELETE keeps the files of a model that may not be archived', async () => {
    const { ConflictError } = await import('../../utils/errors.js');
    registry.archive.mockRejectedValue(new ConflictError('Model is in 1 deployment(s) that are not finished'));
    const res = await request(app).delete('/api/models/versions/m1');
    expect(res.status).toBe(409);
    expect(uploads.removeStoredFiles).not.toHaveBeenCalled();
  });

  it('DELETE of a model that only points elsewhere answers as before', async () => {
    registry.archive.mockResolvedValue({ before: { id: 'm1', deploymentStatus: 'archived' } });
    uploads.removeStoredFiles.mockResolvedValue({ removed: false, freedBytes: 0 });
    expect((await request(app).delete('/api/models/versions/m1')).body).toEqual({ id: 'm1', outcome: 'archived' });
  });

  it('GET /versions/:id names the dataset it was trained on and where its files are', async () => {
    registry.findByIdWithRelations.mockResolvedValue({ id: 'm1', datasetId: 'ds1' });
    registry.getEvaluationSummary.mockResolvedValue({ episodeCount: 0, successCount: 0, successRate: 0 });
    registry.datasetFindById.mockResolvedValue({ id: 'ds1', name: 'AppleToPlate', storagePath: 'x/' });
    uploads.storageOf.mockResolvedValue({ uploadId: 'm1', storage: 'rustfs', filesRemovedAt: null });
    const res = await request(app).get('/api/models/versions/m1');
    expect(res.body.trainedOnDataset).toEqual({ id: 'ds1', name: 'AppleToPlate' });
    expect(res.body.storage).toEqual({ uploadId: 'm1', storage: 'rustfs', filesRemovedAt: null });

    registry.datasetFindById.mockResolvedValue(null);
    uploads.storageOf.mockResolvedValue(null);
    const gone = await request(app).get('/api/models/versions/m1');
    expect(gone.body.trainedOnDataset).toBeNull();
    expect(gone.body.storage).toBeNull();
  });
});

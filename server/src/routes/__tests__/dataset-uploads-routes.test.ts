/**
 * @file dataset-uploads-routes.test.ts
 * @description The HTTP face of the direct dataset upload (TASK-480): the
 *   status codes and bodies of each endpoint, that a part reaches the service
 *   as an unparsed stream with its length and checksum, and that a refusal
 *   carries a stable code a client can branch on.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import express from 'express';
import request from 'supertest';
import type { Readable } from 'stream';

const uploads = vi.hoisted(() => ({
  start: vi.fn(),
  status: vi.fn(),
  receivePart: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../services/datasetUpload/DatasetUploadService.js', () => ({ datasetUploadService: uploads }));

import { datasetUploadRoutes, isDatasetUploadPart } from '../dataset-uploads.routes.js';
import { DatasetUploadError } from '../../services/datasetUpload/uploadManifest.js';

function createApp(): express.Express {
  const app = express();
  // The same parser, with the same limit, the real app mounts ahead of every router.
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/datasets', datasetUploadRoutes);
  return app;
}

/** Stand-in for the service: read the body to its end and say what arrived. */
async function consume(source: Readable): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of source) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: hash.digest('hex') };
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  app = createApp();
});

describe('POST /api/datasets/uploads', () => {
  it('answers 201 with what the service opened', async () => {
    uploads.start.mockResolvedValue({ datasetId: 'ds1', status: 'uploading', chunkSize: 33554432, files: [] });
    const body = { name: 'bottles', info: { codebase_version: 'v3.0' }, files: [{ path: 'meta/info.json', size: 2 }] };

    const response = await request(app).post('/api/datasets/uploads').send(body);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ datasetId: 'ds1', status: 'uploading', chunkSize: 33554432 });
    expect(uploads.start).toHaveBeenCalledWith(body);
  });

  it('answers a refusal with its status, its code and its context', async () => {
    uploads.start.mockRejectedValue(new DatasetUploadError(
      'UPLOAD_TOO_LARGE', 'The dataset is 9 bytes; this server accepts at most 5 bytes per upload', 413,
      { totalBytes: 9, maxTotalBytes: 5 },
    ));

    const response = await request(app).post('/api/datasets/uploads').send({ name: 'x' });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'The dataset is 9 bytes; this server accepts at most 5 bytes per upload',
      code: 'UPLOAD_TOO_LARGE',
      totalBytes: 9,
      maxTotalBytes: 5,
    });
  });

  it('never echoes an unexpected failure', async () => {
    uploads.start.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:5432 at /app/dist/x.js'));

    const response = await request(app).post('/api/datasets/uploads').send({ name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to start the upload', code: 'UPLOAD_ERROR' });
  });
});

describe('GET /api/datasets/:id/upload', () => {
  it('returns the status the service reports', async () => {
    uploads.status.mockResolvedValue({ datasetId: 'ds1', state: 'uploading', readyToFinish: false, files: [] });

    const response = await request(app).get('/api/datasets/ds1/upload');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'uploading', readyToFinish: false });
    expect(uploads.status).toHaveBeenCalledWith('ds1');
  });

  it('answers 404 with a code for a dataset that has no direct upload', async () => {
    uploads.status.mockRejectedValue(new DatasetUploadError('NO_UPLOAD', 'This dataset has no direct upload', 404));

    const response = await request(app).get('/api/datasets/ds1/upload');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NO_UPLOAD' });
  });
});

describe('PUT /api/datasets/:id/upload/files/:fileId/parts/:partNumber', () => {
  it('hands the raw body to the service as a stream, with its length and checksum', async () => {
    const data = Buffer.alloc(300_000, 7);
    uploads.receivePart.mockImplementation(async (datasetId: string, fileId: number, partNumber: number, source: Readable, options: unknown) => {
      const seen = await consume(source);
      return { datasetId, fileId, partNumber, ...seen, options };
    });

    const response = await request(app)
      .put('/api/datasets/ds1/upload/files/4/parts/2')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Chunk-Sha256', 'ab'.repeat(32))
      .send(data);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      datasetId: 'ds1',
      fileId: 4,
      partNumber: 2,
      size: 300_000,
      sha256: createHash('sha256').update(data).digest('hex'),
      options: { contentLength: 300_000, sha256: 'ab'.repeat(32) },
    });
  });

  it('accepts a part larger than the JSON body limit', async () => {
    uploads.receivePart.mockImplementation(async (_d: string, _f: number, _p: number, source: Readable) => consume(source));
    const data = Buffer.alloc(12 * 1024 * 1024, 1);

    const response = await request(app)
      .put('/api/datasets/ds1/upload/files/0/parts/1')
      .set('Content-Type', 'application/octet-stream')
      .send(data);

    expect(response.status).toBe(200);
    expect(response.body.size).toBe(data.length);
  });

  it.each(['application/json', 'multipart/form-data; boundary=x', 'text/plain'])(
    'refuses a %s body with 415 and does not call the service',
    async (contentType) => {
      const response = await request(app)
        .put('/api/datasets/ds1/upload/files/0/parts/1')
        .set('Content-Type', contentType)
        .send('{}');

      expect(response.status).toBe(415);
      expect(response.body).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
      expect(uploads.receivePart).not.toHaveBeenCalled();
    },
  );

  it('passes a file id or part number that is not a number to the service as NaN, never as a guess', async () => {
    uploads.receivePart.mockRejectedValue(new DatasetUploadError('UNKNOWN_FILE', 'This upload has no file NaN', 404));

    const response = await request(app)
      .put('/api/datasets/ds1/upload/files/..%2Fmeta/parts/1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(4));

    expect(response.status).toBe(404);
    expect(uploads.receivePart.mock.calls[0][1]).toBeNaN();
  });

  it('answers a refusal even though the service never read the body', async () => {
    uploads.receivePart.mockRejectedValue(new DatasetUploadError(
      'PART_SIZE_MISMATCH', 'Part 1 of meta/info.json must be exactly 10 bytes; the request declares 200000.', 400,
      { expectedSize: 10 },
    ));

    const response = await request(app)
      .put('/api/datasets/ds1/upload/files/0/parts/1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(200_000));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'PART_SIZE_MISMATCH', expectedSize: 10 });
  });

  it('sets Retry-After when the server is receiving as many parts as it allows', async () => {
    uploads.receivePart.mockRejectedValue(new DatasetUploadError('UPLOAD_BUSY', 'The server is already receiving 4 parts', 503, { retryAfterSeconds: 2 }));

    const response = await request(app)
      .put('/api/datasets/ds1/upload/files/0/parts/1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(8));

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('2');
    expect(response.body).toMatchObject({ code: 'UPLOAD_BUSY' });
  });

  it('answers a checksum mismatch with 422 and both digests', async () => {
    uploads.receivePart.mockImplementation(async (_d: string, _f: number, _p: number, source: Readable) => {
      await consume(source);
      throw new DatasetUploadError('CHECKSUM_MISMATCH', 'Part 1 does not match X-Chunk-Sha256', 422, { expected: 'aa', actual: 'bb' });
    });

    const response = await request(app)
      .put('/api/datasets/ds1/upload/files/0/parts/1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(8));

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'CHECKSUM_MISMATCH', expected: 'aa', actual: 'bb' });
  });
});

describe('a part larger than any part may be', () => {
  it('is answered 413 and the connection is closed instead of being made to carry it', async () => {
    uploads.receivePart.mockRejectedValue(new DatasetUploadError('PART_SIZE_MISMATCH', 'Part 1 must be exactly 10 bytes', 413));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as { port: number };
    const http = await import('http');

    // 65 MiB declared, a few bytes sent: the client is still "uploading" when the answer comes.
    const outcome = await new Promise<{ status: number; connection: string | undefined }>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'PUT', path: '/api/datasets/ds1/upload/files/0/parts/1',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 65 * 1024 * 1024 },
      }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, connection: res.headers.connection });
        req.destroy();
      });
      req.on('error', reject);
      req.write(Buffer.alloc(1024));
    });
    await new Promise((resolve) => server.close(resolve));

    expect(outcome).toEqual({ status: 413, connection: 'close' });
  });
});

describe('POST /api/datasets/:id/upload/finish', () => {
  it('answers 202 while the dataset is being assembled and validated', async () => {
    uploads.finish.mockResolvedValue({ datasetId: 'ds1', state: 'processing', status: 'uploading', message: 'Upload received' });

    const response = await request(app).post('/api/datasets/ds1/upload/finish').send();

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ state: 'processing' });
  });

  it('answers 200 for an upload that is already finished', async () => {
    uploads.finish.mockResolvedValue({ datasetId: 'ds1', state: 'completed', status: 'ready', message: 'The upload is already finished' });

    expect((await request(app).post('/api/datasets/ds1/upload/finish').send()).status).toBe(200);
  });

  it('answers 409 with the missing parts while the upload is incomplete', async () => {
    const missing = [{ fileId: 4, path: 'videos/cam/file-000.mp4', missingParts: [2, 3] }];
    uploads.finish.mockRejectedValue(new DatasetUploadError(
      'UPLOAD_INCOMPLETE', '1 of 7 files are not fully uploaded', 409, { missingFiles: 1, missingBytes: 99, missing },
    ));

    const response = await request(app).post('/api/datasets/ds1/upload/finish').send();

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: '1 of 7 files are not fully uploaded', code: 'UPLOAD_INCOMPLETE', missingFiles: 1, missingBytes: 99, missing,
    });
  });
});

describe('POST /api/datasets/:id/upload/cancel', () => {
  it('answers 200 once everything was removed', async () => {
    uploads.cancel.mockResolvedValue({ datasetId: 'ds1', status: 'cancelled', message: 'Upload cancelled' });

    const response = await request(app).post('/api/datasets/ds1/upload/cancel').send();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'cancelled' });
  });

  it('answers 409 when the upload can no longer be cancelled', async () => {
    uploads.cancel.mockRejectedValue(new DatasetUploadError('UPLOAD_PROCESSING', 'The upload is being finished', 409, { state: 'processing' }));

    const response = await request(app).post('/api/datasets/ds1/upload/cancel').send();

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'UPLOAD_PROCESSING', state: 'processing' });
  });
});

describe('isDatasetUploadPart', () => {
  it.each([
    ['PUT', '/api/datasets/8752a4ca/upload/files/0/parts/1'],
    ['PUT', '/datasets/8752a4ca/upload/files/12/parts/7'],
  ])('exempts %s %s from the general rate limit', (method, path) => {
    expect(isDatasetUploadPart(method, path)).toBe(true);
  });

  it.each([
    ['POST', '/api/datasets/uploads'],
    ['GET', '/api/datasets/8752a4ca/upload'],
    ['POST', '/api/datasets/8752a4ca/upload/finish'],
    ['PUT', '/api/datasets/8752a4ca'],
    ['PUT', '/api/datasets/8752a4ca/upload/files/x/parts/1'],
    ['PUT', '/api/robots/8752a4ca/upload/files/0/parts/1'],
    ['GET', '/api/datasets/8752a4ca/upload/files/0/parts/1'],
  ])('keeps %s %s under it', (method, path) => {
    expect(isDatasetUploadPart(method, path)).toBe(false);
  });
});

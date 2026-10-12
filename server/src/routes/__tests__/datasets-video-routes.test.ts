/**
 * @file datasets-video-routes.test.ts
 * @description Episode video of a RustFS or HF dataset: streamed through the server with Range (TASK-361)
 * @feature datasets
 *
 * A presigned redirect names the in-cluster RustFS host, which no browser can
 * resolve, so every RustFS answer here must be the bytes themselves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

const datasets = vi.hoisted(() => ({ get: vi.fn() }));
const storage = vi.hoisted(() => ({
  initialized: true,
  objects: {} as Record<string, Buffer>,
  ranges: [] as Array<{ start: number; end: number } | undefined>,
}));

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: { get: datasets.get, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  datasetStorageRoot: () => '/tmp',
}));

vi.mock('../../storage/rustfs-client.js', () => {
  const client = {
    async exists(bucket: string, key: string) {
      return bucket === 'training-datasets' && key in storage.objects;
    },
    async getMetadata(_bucket: string, key: string) {
      return { contentLength: storage.objects[key].length };
    },
    async getStream(_bucket: string, key: string, range?: { start: number; end: number }) {
      storage.ranges.push(range);
      const body = storage.objects[key];
      return Readable.from([range ? body.subarray(range.start, range.end + 1) : body]);
    },
    async getPresignedDownloadUrl() {
      return 'http://neodem-rustfs:9000/presigned';
    },
  };
  return { isRustFSInitialized: () => storage.initialized, getRustFSClient: () => client };
});

import { datasetRoutes, parseByteRange, cameraFeatureKey } from '../datasets.routes.js';

const VIDEO = Buffer.from('0123456789');
const V3 = { id: 'ds-pusht', storagePath: 'ds-pusht/', lerobotVersion: 'v3.0', huggingFaceRepoId: 'lerobot/pusht', sourceRevision: null };

function app() {
  const a = express();
  a.use('/api/datasets', datasetRoutes);
  return a;
}

/** supertest buffers video/mp4 only when asked to. */
const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

beforeEach(() => {
  storage.initialized = true;
  storage.objects = {};
  storage.ranges = [];
  datasets.get.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /datasets/:id/episodes/:index/video/:camera from RustFS', () => {
  it('answers a Range with 206 and only that window, never a redirect', async () => {
    datasets.get.mockResolvedValue(V3);
    storage.objects['ds-pusht/videos/observation.images.top/chunk-000/file-001.mp4'] = VIDEO;

    const res = await binary(
      request(app()).get('/api/datasets/ds-pusht/episodes/3/video/observation.images.top?chunk=0&file=1').set('Range', 'bytes=2-5'),
    );

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(res.headers['content-length']).toBe('4');
    expect(res.headers.location).toBeUndefined();
    expect((res.body as Buffer).toString()).toBe('2345');
    expect(storage.ranges).toEqual([{ start: 2, end: 5 }]);
  });

  it('answers a request without Range with the whole file', async () => {
    datasets.get.mockResolvedValue(V3);
    storage.objects['ds-pusht/videos/observation.images.top/chunk-000/file-000.mp4'] = VIDEO;

    const res = await binary(request(app()).get('/api/datasets/ds-pusht/episodes/0/video/top'));

    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect((res.body as Buffer).toString()).toBe('0123456789');
  });

  it('finds a singular camera key such as observation.image', async () => {
    datasets.get.mockResolvedValue(V3);
    storage.objects['ds-pusht/videos/observation.image/chunk-000/file-000.mp4'] = VIDEO;

    const res = await binary(request(app()).get('/api/datasets/ds-pusht/episodes/0/video/observation.image').set('Range', 'bytes=0-'));

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-9/10');
  });

  it('answers an unsatisfiable Range with 416', async () => {
    datasets.get.mockResolvedValue(V3);
    storage.objects['ds-pusht/videos/observation.images.top/chunk-000/file-000.mp4'] = VIDEO;

    const res = await request(app()).get('/api/datasets/ds-pusht/episodes/0/video/top').set('Range', 'bytes=20-30');

    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */10');
  });

  it('refuses a camera key that is not one path segment', async () => {
    datasets.get.mockResolvedValue(V3);
    const res = await request(app()).get('/api/datasets/ds-pusht/episodes/0/video/x%2f..%2f..');
    expect(res.status).toBe(400);
  });
});

describe('GET /datasets/:id/episodes/:index/video/:camera from HuggingFace', () => {
  it('proxies the revision the dataset was imported from, not main', async () => {
    storage.initialized = false;
    datasets.get.mockResolvedValue({ ...V3, lerobotVersion: 'v2.1', sourceRevision: 'v2.1', huggingFaceRepoId: 'lerobot/xarm_lift_medium' });
    const fetchMock = vi.fn(async () => new Response(VIDEO, { status: 200, headers: { 'content-length': '10' } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await binary(request(app()).get('/api/datasets/ds-pusht/episodes/2/video/observation.image'));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://huggingface.co/datasets/lerobot/xarm_lift_medium/resolve/v2.1/videos/chunk-000/observation.image/episode_000002.mp4',
      expect.anything(),
    );
  });
});

describe('parseByteRange', () => {
  it('reads open, closed and suffix ranges and clamps the end', () => {
    expect(parseByteRange('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=3-99', 10)).toEqual({ start: 3, end: 9 });
    expect(parseByteRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 });
    expect(parseByteRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(parseByteRange('items=0-1', 10)).toBe('unsatisfiable');
  });
});

describe('cameraFeatureKey', () => {
  it('keeps a full feature key and prefixes a bare camera name', () => {
    expect(cameraFeatureKey('observation.image')).toBe('observation.image');
    expect(cameraFeatureKey('observation.images.top')).toBe('observation.images.top');
    expect(cameraFeatureKey('top')).toBe('observation.images.top');
    expect(cameraFeatureKey('..')).toBeNull();
    expect(cameraFeatureKey('a/b')).toBeNull();
  });
});

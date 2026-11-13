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
import http from 'http';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';

const datasets = vi.hoisted(() => ({ get: vi.fn() }));
const storage = vi.hoisted(() => ({
  initialized: true,
  objects: {} as Record<string, Buffer>,
  ranges: [] as Array<{ start: number; end: number } | undefined>,
  // `exists` calls: how often a video was looked for in storage.
  lookups: 0,
  // `getStream` calls and the signal each was handed (TASK-491).
  opens: [] as Array<{ signal?: AbortSignal }>,
  // Set to answer `getStream` by hand: a store that is slow, or fails.
  open: null as null | ((signal?: AbortSignal) => Promise<Readable>),
}));

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: { get: datasets.get, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  datasetStorageRoot: () => '/tmp',
}));

vi.mock('../../storage/rustfs-client.js', () => {
  const client = {
    async exists(bucket: string, key: string) {
      storage.lookups++;
      return bucket === 'training-datasets' && key in storage.objects;
    },
    async getMetadata(_bucket: string, key: string) {
      return { contentLength: storage.objects[key].length };
    },
    async getStream(
      _bucket: string,
      key: string,
      range?: { start: number; end: number },
      options?: { signal?: AbortSignal },
    ) {
      storage.ranges.push(range);
      storage.opens.push({ signal: options?.signal });
      if (storage.open) return storage.open(options?.signal);
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
import { clearDatasetReadCaches, invalidateDatasetReads } from '../../services/lerobot/DatasetReadCache.js';

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
  clearDatasetReadCaches();
  storage.lookups = 0;
  storage.initialized = true;
  storage.objects = {};
  storage.ranges = [];
  storage.opens = [];
  storage.open = null;
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

  it('looks a video up once for all the ranges a player asks of it, and again after the dataset changes', async () => {
    datasets.get.mockResolvedValue(V3);
    storage.objects['ds-pusht/videos/observation.images.top/chunk-000/file-000.mp4'] = VIDEO;
    const url = '/api/datasets/ds-pusht/episodes/3/video/top';

    for (const range of ['bytes=0-3', 'bytes=4-7', 'bytes=8-9']) {
      const res = await binary(request(app()).get(url).set('Range', range));
      expect(res.status).toBe(206);
    }
    expect(storage.lookups).toBe(1);
    expect(storage.ranges).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 9 }]);

    // Deleted or re-imported: the next request must not trust the old answer.
    invalidateDatasetReads('ds-pusht');
    delete storage.objects['ds-pusht/videos/observation.images.top/chunk-000/file-000.mp4'];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    expect((await request(app()).get(url)).status).toBe(404);
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

  it('reads a v2.1 episode from the chunk its chunks_size puts it in', async () => {
    // floor(5 / 2) = chunk-002; a literal 1000 looked in chunk-000 (TASK-479).
    datasets.get.mockResolvedValue({ ...V3, lerobotVersion: 'v2.1', infoJson: JSON.stringify({ chunks_size: 2 }) });
    storage.objects['ds-pusht/videos/chunk-002/observation.images.top/episode_000005.mp4'] = VIDEO;

    const res = await binary(request(app()).get('/api/datasets/ds-pusht/episodes/5/video/top'));

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('0123456789');
  });

  it('still streams when the stored infoJson is not valid JSON', async () => {
    datasets.get.mockResolvedValue({ ...V3, lerobotVersion: 'v2.1', infoJson: '{not json' });
    storage.objects['ds-pusht/videos/chunk-000/observation.images.top/episode_000005.mp4'] = VIDEO;

    const res = await binary(request(app()).get('/api/datasets/ds-pusht/episodes/5/video/top'));

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('0123456789');
  });

  it('refuses a camera key that is not one path segment', async () => {
    datasets.get.mockResolvedValue(V3);
    const res = await request(app()).get('/api/datasets/ds-pusht/episodes/0/video/x%2f..%2f..');
    expect(res.status).toBe(400);
  });
});

/**
 * TASK-491. On the demo instance a viewer clicking through episodes took every
 * storage-backed route down until the pod was restarted: a `<video>` whose
 * `src` changes drops its request, and a store stream that opened for a
 * request already dropped was never destroyed or read, so its socket never
 * went back to the S3 client's pool. These run against a real HTTP server —
 * the defect is an ordering of socket events.
 */
describe('a video request the player drops', () => {
  const KEY = 'ds-pusht/videos/observation.images.top/chunk-000/file-000.mp4';
  const PATH = '/api/datasets/ds-pusht/episodes/0/video/observation.images.top';
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    datasets.get.mockResolvedValue(V3);
    storage.objects[KEY] = VIDEO;
    server = http.createServer(app());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const until = async (condition: () => boolean): Promise<void> => {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > 2000) throw new Error('condition not met in time');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  /** A body nobody reads to the end, like a 208 MB chunk file. */
  const endless = () =>
    new Readable({
      read() {
        this.push(Buffer.alloc(16 * 1024, 1));
      },
    });

  const ranged = (method = 'GET') =>
    http.request({ host: '127.0.0.1', port, path: PATH, method, headers: { Range: 'bytes=0-' }, agent: false });

  it('gives the store stream back when the player leaves while it is being opened', async () => {
    let answer!: (stream: Readable) => void;
    storage.open = () => new Promise<Readable>((resolve) => { answer = resolve; });

    const req = ranged();
    req.on('error', () => undefined);
    req.end();
    await until(() => storage.opens.length === 1);
    const { signal } = storage.opens[0];
    expect(signal?.aborted).toBe(false);

    // The next episode was clicked: the browser drops this request.
    req.destroy();
    // The store is told to stop…
    await until(() => signal?.aborted === true);
    // …and when its answer arrives all the same, the body is not left open.
    const stream = endless();
    answer(stream);
    await until(() => stream.destroyed);
  });

  it('gives the store stream back when the player leaves mid-stream', async () => {
    const stream = endless();
    storage.open = async () => stream;
    await new Promise<void>((resolve) => {
      const req = ranged();
      req.on('response', (res) => {
        expect(res.statusCode).toBe(206);
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => undefined);
      req.end();
    });
    await until(() => stream.destroyed);
    expect(storage.opens[0].signal?.aborted).toBe(true);
  });

  it('answers a HEAD from the known size without opening the object', async () => {
    const res = await request(app()).head(PATH).set('Range', 'bytes=2-5');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(res.headers['content-length']).toBe('4');
    expect(storage.opens).toHaveLength(0);
  });

  it('reads one byte for the one-byte probe and ends the store stream', async () => {
    const res = await binary(request(app()).get(PATH).set('Range', 'bytes=0-0'));
    expect(res.status).toBe(206);
    expect((res.body as Buffer).toString()).toBe('0');
    expect(storage.ranges).toEqual([{ start: 0, end: 0 }]);
  });

  it('answers a store stream that fails before its first byte with 500 and a body, not under Content-Range', async () => {
    storage.open = async () =>
      new Readable({
        read() {
          this.destroy(new Error('socket hang up'));
        },
      });
    const res = await request(app()).get(PATH).set('Range', 'bytes=0-');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to stream video' });
    expect(res.headers['content-range']).toBeUndefined();
  });

  it('answers 503 with Retry-After when the store does not answer in time', async () => {
    storage.open = async () => {
      throw Object.assign(new Error('RustFS did not answer GetObject within 15000 ms'), { name: 'TimeoutError' });
    };
    const res = await request(app()).get(PATH).set('Range', 'bytes=0-');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toMatchObject({ code: 'STORAGE_TIMEOUT' });
    expect(res.headers['content-range']).toBeUndefined();
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

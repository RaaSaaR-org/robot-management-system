/**
 * @file dataset-files-routes.test.ts
 * @description A dataset's stored files: the paginated manifest and each file as raw bytes with Range (TASK-496)
 * @feature datasets
 *
 * The same answers are owed for a dataset that arrived by direct upload and
 * one that was imported from Hugging Face — both are objects under a prefix —
 * and for a directory on the server's disk.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const datasets = vi.hoisted(() => ({ get: vi.fn(), root: '' }));
const uploads = vi.hoisted(() => ({ find: vi.fn() }));
const storage = vi.hoisted(() => ({
  initialized: true,
  /** bucket → key → body */
  buckets: {} as Record<string, Record<string, Buffer>>,
  /** A store that ignores `StartAfter`. */
  ignoresStartAfter: false,
  lists: [] as Array<{ bucket: string; prefix?: string; maxKeys?: number; startAfter?: string }>,
  ranges: [] as Array<{ start: number; end: number } | undefined>,
  opens: [] as Array<{ signal?: AbortSignal }>,
  open: null as null | ((signal?: AbortSignal) => Promise<Readable>),
}));

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: { get: datasets.get, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  datasetStorageRoot: () => datasets.root,
}));

vi.mock('../../repositories/DatasetUploadRepository.js', () => ({
  datasetUploadRepository: { find: uploads.find },
}));

vi.mock('../../storage/rustfs-client.js', () => {
  const missing = (name: string) => Object.assign(new Error(name), { name });
  const client = {
    async list(bucket: string, options: { prefix?: string; maxKeys?: number; startAfter?: string } = {}) {
      storage.lists.push({ bucket, ...options });
      const held = storage.buckets[bucket];
      if (!held) throw missing('NoSuchBucket');
      const keys = Object.keys(held)
        .filter((key) => key.startsWith(options.prefix ?? ''))
        .filter((key) => storage.ignoresStartAfter || !options.startAfter || Buffer.compare(Buffer.from(key), Buffer.from(options.startAfter)) > 0)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      const max = options.maxKeys ?? 1000;
      return {
        objects: keys.slice(0, max).map((key) => ({ key, size: held[key].length, lastModified: new Date(0), etag: `"etag-${held[key].length}"` })),
        isTruncated: keys.length > max,
      };
    },
    async getMetadata(bucket: string, key: string) {
      const body = storage.buckets[bucket]?.[key];
      if (!body) throw missing('NotFound');
      return { contentLength: body.length, etag: '"abc123"' };
    },
    async getStream(bucket: string, key: string, range?: { start: number; end: number }, options?: { signal?: AbortSignal }) {
      storage.ranges.push(range);
      storage.opens.push({ signal: options?.signal });
      if (storage.open) return storage.open(options?.signal);
      const body = storage.buckets[bucket][key];
      return Readable.from([range ? body.subarray(range.start, range.end + 1) : body]);
    },
  };
  return { isRustFSInitialized: () => storage.initialized, getRustFSClient: () => client };
});

import { datasetFileRoutes, parseFileRange } from '../dataset-files.routes.js';

const UPLOADED = { id: 'ds-up', storagePath: 'ds-up/', status: 'ready' };
const IMPORTED = { id: 'ds-hf', storagePath: 'ds-hf', status: 'ready', huggingFaceRepoId: 'lerobot/pusht' };
const BODY = Buffer.from('0123456789');

function app() {
  const a = express();
  a.use('/api/datasets', datasetFileRoutes);
  return a;
}

const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

function tree(prefix: string): Record<string, Buffer> {
  return {
    [`${prefix}/meta/info.json`]: Buffer.from('{}'),
    [`${prefix}/meta/episodes/chunk-000/file-000.parquet`]: Buffer.from('PAR1'),
    [`${prefix}/data/chunk-000/file-000.parquet`]: Buffer.from('PAR1data'),
    [`${prefix}/videos/observation.images.head/chunk-000/file-000.mp4`]: BODY,
  };
}

beforeEach(() => {
  storage.initialized = true;
  storage.buckets = { 'training-datasets': { ...tree('ds-up'), ...tree('ds-hf'), 'ds-upx/other': Buffer.from('no') } };
  storage.ignoresStartAfter = false;
  storage.lists = [];
  storage.ranges = [];
  storage.opens = [];
  storage.open = null;
  datasets.get.mockReset();
  uploads.find.mockReset();
  uploads.find.mockResolvedValue(null);
});

describe('parseFileRange', () => {
  it('reads closed, open-ended and suffix ranges', () => {
    expect(parseFileRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseFileRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(parseFileRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseFileRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9 });
  });

  it('refuses what cannot be served', () => {
    for (const header of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1']) {
      expect(parseFileRange(header, 10)).toBe('unsatisfiable');
    }
    expect(parseFileRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});

describe('GET /datasets/:id/files', () => {
  it('lists an uploaded dataset with relative paths, sizes, etags and the checksums the upload declared', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    uploads.find.mockResolvedValue({
      state: 'completed',
      files: [{ id: 0, path: 'meta/info.json', size: 2, sha256: 'a'.repeat(64), partCount: 1 }],
    });

    const res = await request(app()).get('/api/datasets/ds-up/files');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      datasetId: 'ds-up',
      storage: 'rustfs',
      limit: 1000,
      nextCursor: null,
      files: [
        { path: 'data/chunk-000/file-000.parquet', size: 8, etag: 'etag-8' },
        { path: 'meta/episodes/chunk-000/file-000.parquet', size: 4, etag: 'etag-4' },
        { path: 'meta/info.json', size: 2, etag: 'etag-2', sha256: 'a'.repeat(64) },
        { path: 'videos/observation.images.head/chunk-000/file-000.mp4', size: 10, etag: 'etag-10' },
      ],
    });
    // The prefix ends in a slash, so a sibling prefix that merely starts the same is not this dataset's.
    expect(storage.lists.at(-1)).toMatchObject({ bucket: 'training-datasets', prefix: 'ds-up/' });
  });

  it('lists a dataset imported from Hugging Face the same way, without checksums', async () => {
    datasets.get.mockResolvedValue(IMPORTED);
    const res = await request(app()).get('/api/datasets/ds-hf/files');
    expect(res.status).toBe(200);
    expect(res.body.files.map((f: { path: string }) => f.path)).toEqual([
      'data/chunk-000/file-000.parquet',
      'meta/episodes/chunk-000/file-000.parquet',
      'meta/info.json',
      'videos/observation.images.head/chunk-000/file-000.mp4',
    ]);
    expect(res.body.files.every((f: { sha256?: string }) => f.sha256 === undefined)).toBe(true);
  });

  it('pages with limit and after until nextCursor is null, each file exactly once', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const res = await request(app()).get('/api/datasets/ds-up/files').query({ limit: 3, ...(after ? { after } : {}) });
      expect(res.status).toBe(200);
      seen.push(...res.body.files.map((f: { path: string }) => f.path));
      after = res.body.nextCursor;
      pages++;
    } while (after && pages < 10);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(storage.lists.at(-1)).toMatchObject({ startAfter: 'ds-up/meta/info.json', maxKeys: 3 });
  });

  it('never repeats a file when the store ignores StartAfter, and says so rather than loop the client', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    storage.ignoresStartAfter = true;
    const res = await request(app()).get('/api/datasets/ds-up/files').query({ limit: 2, after: 'meta/info.json' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('STORE_ERROR');
  });

  it('finds a dataset that sits in the legacy bucket', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    storage.buckets = { 'training-datasets': {}, datasets: tree('ds-up') };
    const res = await request(app()).get('/api/datasets/ds-up/files');
    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(4);
  });

  it.each([
    [{ ...UPLOADED, status: 'uploading' }, 409, 'DATASET_NOT_READY'],
    [{ ...UPLOADED, status: 'importing' }, 409, 'DATASET_NOT_READY'],
    [{ ...UPLOADED, kind: 'view' }, 409, 'DATASET_IS_VIEW'],
    [{ ...UPLOADED, storagePath: '' }, 409, 'NO_STORED_FILES'],
    [{ ...UPLOADED, storagePath: 'nothing-here/' }, 409, 'NO_STORED_FILES'],
    [{ ...UPLOADED, storagePath: '/no/such/directory' }, 409, 'NO_STORED_FILES'],
    [null, 404, 'NOT_FOUND'],
  ])('refuses %j with %i %s', async (dataset, status, code) => {
    datasets.get.mockResolvedValue(dataset);
    const res = await request(app()).get('/api/datasets/ds-up/files');
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('refuses a limit or cursor it cannot use', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    for (const limit of ['0', '1001', 'ten', '-1']) {
      const res = await request(app()).get('/api/datasets/ds-up/files').query({ limit });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_LIMIT');
    }
    const res = await request(app()).get('/api/datasets/ds-up/files').query({ after: '../ds-hf/meta' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CURSOR');
  });

  it('answers 503 with Retry-After while object storage is down', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    storage.initialized = false;
    const res = await request(app()).get('/api/datasets/ds-up/files');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('5');
  });
});

describe('GET /datasets/:id/files/content', () => {
  const VIDEO_PATH = 'videos/observation.images.head/chunk-000/file-000.mp4';
  const url = '/api/datasets/ds-up/files/content';

  it.each([[UPLOADED], [IMPORTED]])('serves the whole file byte for byte (%j)', async (dataset) => {
    datasets.get.mockResolvedValue(dataset);
    const res = await binary(request(app()).get(`/api/datasets/${dataset.id}/files/content`).query({ path: VIDEO_PATH }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-length']).toBe('10');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers.etag).toBe('"abc123"');
    expect(res.headers.location).toBeUndefined();
    expect((res.body as Buffer).equals(BODY)).toBe(true);
    expect(storage.ranges).toEqual([undefined]);
  });

  it('answers a Range with 206 and only that window', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    const res = await binary(request(app()).get(url).query({ path: VIDEO_PATH }).set('Range', 'bytes=4-'));
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 4-9/10');
    expect(res.headers['content-length']).toBe('6');
    expect((res.body as Buffer).toString()).toBe('456789');
    expect(storage.ranges).toEqual([{ start: 4, end: 9 }]);
  });

  it('answers 416 with the size for a range past the end, without opening the object', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    const res = await request(app()).get(url).query({ path: VIDEO_PATH }).set('Range', 'bytes=10-');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */10');
    expect(res.body).toMatchObject({ code: 'RANGE_NOT_SATISFIABLE', size: 10 });
    expect(storage.opens).toHaveLength(0);
  });

  it('answers a HEAD from the known size without opening the object', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    const res = await request(app()).head(url).query({ path: VIDEO_PATH });
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('10');
    expect(storage.opens).toHaveLength(0);
  });

  it('answers an empty file without opening the object', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    storage.buckets['training-datasets']['ds-up/meta/empty.jsonl'] = Buffer.alloc(0);
    const res = await binary(request(app()).get(url).query({ path: 'meta/empty.jsonl' }));
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('0');
    expect(storage.opens).toHaveLength(0);
  });

  it('answers 404 FILE_NOT_FOUND for a path the dataset does not have', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    const res = await request(app()).get(url).query({ path: 'meta/nope.json' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'FILE_NOT_FOUND', path: 'meta/nope.json' });
  });

  it.each([['../ds-hf/meta/info.json'], ['/etc/passwd'], ['meta//info.json'], ['meta\\info.json'], ['']])(
    'refuses the path %j before anything is looked up',
    async (path) => {
      datasets.get.mockResolvedValue(UPLOADED);
      const res = await request(app()).get(url).query({ path });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PATH');
      expect(datasets.get).not.toHaveBeenCalled();
    },
  );

  it('refuses a dataset that is still being uploaded', async () => {
    datasets.get.mockResolvedValue({ ...UPLOADED, status: 'uploading' });
    const res = await request(app()).get(url).query({ path: VIDEO_PATH });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DATASET_NOT_READY');
  });

  it('answers a store stream that fails before its first byte with 502 and a body, not under the file headers', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    storage.open = async () =>
      new Readable({
        read() {
          this.destroy(new Error('socket hang up'));
        },
      });
    const res = await request(app()).get(url).query({ path: VIDEO_PATH }).set('Range', 'bytes=0-');
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'STORE_ERROR' });
    expect(res.headers['content-range']).toBeUndefined();
    expect(res.headers.etag).not.toBe('"abc123"');
  });

  it('answers 503 with Retry-After when the store does not answer in time', async () => {
    datasets.get.mockResolvedValue(UPLOADED);
    storage.open = async () => {
      throw Object.assign(new Error('RustFS did not answer GetObject within 15000 ms'), { name: 'TimeoutError' });
    };
    const res = await request(app()).get(url).query({ path: VIDEO_PATH });
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toMatchObject({ code: 'STORAGE_TIMEOUT' });
  });
});

/**
 * The orderings a downloader can leave in (TASK-491): a store stream opened
 * for a request that is gone must be given back, or its socket never returns
 * to the pool. Against a real HTTP server — the defect is an order of socket events.
 */
describe('a file request the client drops', () => {
  const PATH = '/api/datasets/ds-up/files/content?path=videos/observation.images.head/chunk-000/file-000.mp4';
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    datasets.get.mockResolvedValue(UPLOADED);
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

  const endless = () =>
    new Readable({
      read() {
        this.push(Buffer.alloc(16 * 1024, 1));
      },
    });

  const get = () => http.request({ host: '127.0.0.1', port, path: PATH, method: 'GET', agent: false });

  it('gives the store stream back when the client leaves while it is being opened', async () => {
    let answer!: (stream: Readable) => void;
    storage.open = () => new Promise<Readable>((resolve) => { answer = resolve; });

    const req = get();
    req.on('error', () => undefined);
    req.end();
    await until(() => storage.opens.length === 1);
    const { signal } = storage.opens[0];
    expect(signal?.aborted).toBe(false);

    req.destroy();
    await until(() => signal?.aborted === true);
    const stream = endless();
    answer(stream);
    await until(() => stream.destroyed);
  });

  it('gives the store stream back when the client leaves mid-stream', async () => {
    const stream = endless();
    storage.open = async () => stream;
    await new Promise<void>((resolve) => {
      const req = get();
      req.on('response', (res) => {
        expect(res.statusCode).toBe(200);
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
});

describe('a dataset on the server\'s disk', () => {
  let base: string;
  let root: string;
  let local: { id: string; storagePath: string; status: string };

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'dataset-files-')));
    datasets.root = join(base, 'uploaded-datasets');
    root = join(datasets.root, 'ds-local');
    mkdirSync(join(root, 'meta'), { recursive: true });
    mkdirSync(join(root, 'data', 'chunk-000'), { recursive: true });
    writeFileSync(join(root, 'meta', 'info.json'), '{"a":1}');
    writeFileSync(join(root, 'data', 'chunk-000', 'file-000.parquet'), BODY);
    writeFileSync(join(base, 'secret.txt'), 'not a dataset file');
    symlinkSync(join(base, 'secret.txt'), join(root, 'meta', 'leak.txt'));
    symlinkSync(base, join(root, 'outside'));
    mkdirSync(join(base, 'elsewhere', 'meta'), { recursive: true });
    writeFileSync(join(base, 'elsewhere', 'meta', 'info.json'), '{}');
    local = { id: 'ds-local', storagePath: `${root}/`, status: 'ready' };
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('lists its regular files in key order and leaves symlinks out', async () => {
    datasets.get.mockResolvedValue(local);
    const res = await request(app()).get('/api/datasets/ds-local/files');
    expect(res.status).toBe(200);
    expect(res.body.storage).toBe('local');
    expect(res.body.files).toEqual([
      { path: 'data/chunk-000/file-000.parquet', size: 10 },
      { path: 'meta/info.json', size: 7 },
    ]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('pages a local listing with the same cursor', async () => {
    datasets.get.mockResolvedValue(local);
    const first = await request(app()).get('/api/datasets/ds-local/files').query({ limit: 1 });
    expect(first.body.files).toHaveLength(1);
    expect(first.body.nextCursor).toBe('data/chunk-000/file-000.parquet');
    const second = await request(app()).get('/api/datasets/ds-local/files').query({ limit: 1, after: first.body.nextCursor });
    expect(second.body.files).toEqual([{ path: 'meta/info.json', size: 7 }]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('serves a file and a range of it from disk', async () => {
    datasets.get.mockResolvedValue(local);
    const url = '/api/datasets/ds-local/files/content';
    const whole = await binary(request(app()).get(url).query({ path: 'data/chunk-000/file-000.parquet' }));
    expect(whole.status).toBe(200);
    expect((whole.body as Buffer).equals(BODY)).toBe(true);
    const part = await binary(request(app()).get(url).query({ path: 'data/chunk-000/file-000.parquet' }).set('Range', 'bytes=7-'));
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 7-9/10');
    expect((part.body as Buffer).toString()).toBe('789');
  });

  it('does not follow a symlink out of the dataset, as a file or on the way to one', async () => {
    datasets.get.mockResolvedValue(local);
    const url = '/api/datasets/ds-local/files/content';
    for (const path of ['meta/leak.txt', 'outside/secret.txt', 'meta']) {
      const res = await request(app()).get(url).query({ path });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('refuses a directory this server does not keep datasets in', async () => {
    datasets.get.mockResolvedValue({ ...local, storagePath: join(base, 'elsewhere') });
    for (const url of ['/api/datasets/ds-local/files', '/api/datasets/ds-local/files/content?path=meta/info.json']) {
      const res = await request(app()).get(url);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DATASET_PATH_NOT_ALLOWED');
    }
  });
});

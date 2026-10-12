/**
 * @file datasets-episodes-routes.test.ts
 * @description Episodes and frames of a RustFS dataset: real data or a non-2xx (TASK-354)
 * @feature datasets
 *
 * The reader itself is covered in RemoteDatasetReader.test.ts. What only a
 * route test sees is the wiring: the bucket probe, the key prefix, the status
 * and body a DatasetReadError becomes, and that no path answers 200 with
 * numbers storage does not hold.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FRAME_FIELDS, frameRows, parquetBuffer } from '../../services/lerobot/__tests__/parquetFixtures.js';

const datasets = vi.hoisted(() => ({ get: vi.fn() }));
const storage = vi.hoisted(() => ({
  initialized: true,
  // bucket → key → bytes
  buckets: {} as Record<string, Record<string, Buffer>>,
  listError: null as Error | null,
  // Every object read, whole or ranged, as `key` or `key@offset+length`.
  reads: [] as string[],
}));

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: { get: datasets.get, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  datasetStorageRoot: () => '/tmp',
}));

vi.mock('../../repositories/DatasetEpisodeFlagRepository.js', () => ({
  datasetEpisodeFlagRepository: { flaggedIndices: vi.fn(async () => new Set([1])) },
}));

vi.mock('../../storage/rustfs-client.js', () => {
  const keys = (bucket: string, prefix = '') =>
    Object.keys(storage.buckets[bucket] ?? {}).filter((k) => k.startsWith(prefix));
  const client = {
    async list(bucket: string, opts?: { prefix?: string; maxKeys?: number }) {
      if (storage.listError) throw storage.listError;
      if (!storage.buckets[bucket]) throw new Error('NoSuchBucket');
      const found = keys(bucket, opts?.prefix).slice(0, opts?.maxKeys ?? 1000);
      return { objects: found.map((key) => ({ key, size: 1, lastModified: new Date() })), isTruncated: false };
    },
    async *listAll(bucket: string, prefix?: string) {
      for (const key of keys(bucket, prefix)) yield { key, size: 1, lastModified: new Date() };
    },
    async exists(bucket: string, key: string) {
      return Boolean(storage.buckets[bucket]?.[key]);
    },
    async download(bucket: string, key: string) {
      storage.reads.push(key);
      return storage.buckets[bucket][key];
    },
    async getMetadata(bucket: string, key: string) {
      return { contentLength: storage.buckets[bucket][key].length };
    },
    async downloadRange(bucket: string, key: string, start: number, length: number) {
      storage.reads.push(`${key}@${start}+${length}`);
      return storage.buckets[bucket][key].subarray(start, start + length);
    },
  };
  return { isRustFSInitialized: () => storage.initialized, getRustFSClient: () => client };
});

import { datasetRoutes } from '../datasets.routes.js';
import { episodeFramesCache } from '../../services/lerobot/RemoteDatasetReader.js';

const INFO_V21 = { codebase_version: 'v2.1', fps: 30, chunks_size: 1000, total_episodes: 3, total_frames: 17 };
const LENGTHS = [5, 9, 3];
const DATASET = {
  id: 'ds-apple',
  storagePath: 'ds-apple/',
  lerobotVersion: 'v2.1',
  fps: 30,
  infoJson: JSON.stringify(INFO_V21),
  totalFrames: 17,
  demonstrationCount: 3,
};

let v21Files: Record<string, Buffer>;

beforeAll(async () => {
  v21Files = {
    'ds-apple/meta/info.json': Buffer.from(JSON.stringify(INFO_V21)),
    'ds-apple/meta/episodes.jsonl': Buffer.from(
      LENGTHS.map((length, i) => JSON.stringify({ episode_index: i, tasks: ['apple to plate'], length })).join('\n'),
    ),
  };
  for (const [i, length] of LENGTHS.entries()) {
    v21Files[`ds-apple/data/chunk-000/episode_00000${i}.parquet`] = await parquetBuffer(
      FRAME_FIELDS,
      frameRows(i, length, 43),
    );
  }
});

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

describe('RustFS dataset episodes and frames', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storage.initialized = true;
    storage.listError = null;
    storage.reads = [];
    episodeFramesCache.clear();
    storage.buckets = { 'training-datasets': { ...v21Files } };
    datasets.get.mockResolvedValue(DATASET);
    app = createApp();
  });

  it('lists a v2.1 dataset from episodes.jsonl with real lengths and stored flags', async () => {
    const res = await request(app).get('/api/datasets/ds-apple/episodes');
    expect(res.status).toBe(200);
    expect(res.body.episodes.map((e: { frameCount: number }) => e.frameCount)).toEqual(LENGTHS);
    expect(res.body.episodes.map((e: { flagged: boolean }) => e.flagged)).toEqual([false, true, false]);
  });

  it("serves a v2.1 episode's frames from its own parquet with the real total", async () => {
    const res = await request(app).get('/api/datasets/ds-apple/episodes/1/frames?limit=4');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(9);
    expect(res.body.frames).toHaveLength(4);
    expect(res.body.frames[0].observationState).toHaveLength(43);
  });

  it('finds a dataset kept in the legacy bucket', async () => {
    storage.buckets = { 'training-datasets': {}, datasets: { ...v21Files } };
    const res = await request(app).get('/api/datasets/ds-apple/episodes');
    expect(res.status).toBe(200);
    expect(res.body.episodes).toHaveLength(3);
  });

  it('answers 422 naming the file when info.json exists but no episode metadata does', async () => {
    storage.buckets = { 'training-datasets': { 'ds-apple/meta/info.json': v21Files['ds-apple/meta/info.json'] } };
    const res = await request(app).get('/api/datasets/ds-apple/episodes');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/meta\/episodes\.jsonl is missing/);
    expect(res.body.episodes).toBeUndefined();
  });

  it('answers 404 for an episode index the dataset does not have', async () => {
    const res = await request(app).get('/api/datasets/ds-apple/episodes/7/frames');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Episode frames not found');
    expect(res.body.message).toMatch(/episode 7: the dataset has 3 episodes/);
    expect(res.body.frames).toBeUndefined();
  });

  it('answers 422 naming the missing parquet of an episode that should exist', async () => {
    delete storage.buckets['training-datasets']['ds-apple/data/chunk-000/episode_000002.parquet'];
    const res = await request(app).get('/api/datasets/ds-apple/episodes/2/frames');
    expect(res.status).toBe(422);
    expect(res.body.file).toBe('data/chunk-000/episode_000002.parquet');
    expect(res.body.frames).toBeUndefined();
  });

  it('answers 422 when nothing of the dataset is in storage', async () => {
    storage.buckets = { 'training-datasets': {} };
    const eps = await request(app).get('/api/datasets/ds-apple/episodes');
    expect(eps.status).toBe(422);
    expect(eps.body.error).toMatch(/No files for this dataset/);
  });

  it('answers 502 when storage itself fails', async () => {
    storage.listError = new Error('connect ECONNREFUSED');
    const res = await request(app).get('/api/datasets/ds-apple/episodes/0/frames');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/ECONNREFUSED/);
  });

  it('reads a data file in byte ranges and serves the next page of the episode from the cache', async () => {
    const first = await request(app).get('/api/datasets/ds-apple/episodes/1/frames?offset=0&limit=4');
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(9);
    expect(first.body.frames).toHaveLength(4);
    const dataReads = storage.reads.filter((r) => r.includes('/data/'));
    expect(dataReads.length).toBeGreaterThan(0);
    expect(dataReads.every((r) => r.includes('@'))).toBe(true);

    storage.reads = [];
    const second = await request(app).get('/api/datasets/ds-apple/episodes/1/frames?offset=4&limit=4');
    expect(second.status).toBe(200);
    expect(second.body.total).toBe(9);
    expect(second.body.frames.map((f: { frameIndex: number }) => f.frameIndex)).toEqual([4, 5, 6, 7]);
    expect(storage.reads).toEqual([]);
  });

  it('does not cache a failed read', async () => {
    storage.initialized = false;
    expect((await request(app).get('/api/datasets/ds-apple/episodes/0/frames')).status).toBe(503);
    storage.initialized = true;
    expect((await request(app).get('/api/datasets/ds-apple/episodes/0/frames')).status).toBe(200);
  });

  it('answers 503 when RustFS is not running', async () => {
    storage.initialized = false;
    const res = await request(app).get('/api/datasets/ds-apple/episodes');
    expect(res.status).toBe(503);
  });

  it('refuses a dataset of unknown layout rather than guessing', async () => {
    datasets.get.mockResolvedValue({ ...DATASET, lerobotVersion: null, infoJson: JSON.stringify({ fps: 30 }) });
    const res = await request(app).get('/api/datasets/ds-apple/episodes');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/codebase_version/);
  });
});

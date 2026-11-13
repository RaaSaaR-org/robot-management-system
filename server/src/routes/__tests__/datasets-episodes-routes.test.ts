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

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
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
  // Every round trip to storage, reads included: `LIST …`, `HEAD …`, `GET …`.
  calls: [] as string[],
  // When set, every object read waits for it: storage that has not answered yet.
  hold: null as Promise<void> | null,
}));

/** What S3 throws for an object that is not there. */
function missing(name: 'NoSuchKey' | 'NotFound'): Error {
  return Object.assign(new Error(name), { name });
}

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
      storage.calls.push(`LIST ${bucket}/${opts?.prefix ?? ''}`);
      if (storage.listError) throw storage.listError;
      if (!storage.buckets[bucket]) throw new Error('NoSuchBucket');
      const found = keys(bucket, opts?.prefix).slice(0, opts?.maxKeys ?? 1000);
      return { objects: found.map((key) => ({ key, size: 1, lastModified: new Date() })), isTruncated: false };
    },
    async *listAll(bucket: string, prefix?: string) {
      storage.calls.push(`LIST ${bucket}/${prefix ?? ''}`);
      for (const key of keys(bucket, prefix)) yield { key, size: 1, lastModified: new Date() };
    },
    async exists(bucket: string, key: string) {
      storage.calls.push(`HEAD ${key}`);
      return Boolean(storage.buckets[bucket]?.[key]);
    },
    async download(bucket: string, key: string) {
      storage.calls.push(`GET ${key}`);
      if (storage.hold) await storage.hold;
      if (!storage.buckets[bucket]?.[key]) throw missing('NoSuchKey');
      storage.reads.push(key);
      return storage.buckets[bucket][key];
    },
    async getMetadata(bucket: string, key: string) {
      storage.calls.push(`HEAD ${key}`);
      if (!storage.buckets[bucket]?.[key]) throw missing('NotFound');
      return { contentLength: storage.buckets[bucket][key].length };
    },
    async downloadRange(bucket: string, key: string, start: number, length: number) {
      storage.calls.push(`GET ${key}@${start}+${length}`);
      storage.reads.push(`${key}@${start}+${length}`);
      return storage.buckets[bucket][key].subarray(start, start + length);
    },
  };
  return { isRustFSInitialized: () => storage.initialized, getRustFSClient: () => client };
});

import { datasetRoutes } from '../datasets.routes.js';
import {
  clearDatasetReadCaches,
  datasetReadCacheUsage,
  invalidateDatasetReads,
} from '../../services/lerobot/DatasetReadCache.js';

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
    storage.calls = [];
    clearDatasetReadCaches();
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

  it("fetches a small episode file in one request and serves the episode's next page from the cache", async () => {
    const first = await request(app).get('/api/datasets/ds-apple/episodes/1/frames?offset=0&limit=4');
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(9);
    expect(first.body.frames).toHaveLength(4);
    // One GET for the file, not one per column chunk (ranged reads are for
    // files too large to hold — parquetEpisodeRows.test.ts covers those).
    expect(storage.reads).toEqual(['ds-apple/data/chunk-000/episode_000001.parquet']);

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

  describe('what is remembered between requests (TASK-490)', () => {
    const INFO_V30 = { codebase_version: 'v3.0', fps: 30, total_episodes: 6, total_frames: 60 };
    const V30 = {
      id: 'ds-bottle',
      storagePath: 'ds-bottle/',
      lerobotVersion: 'v3.0',
      fps: 30,
      infoJson: JSON.stringify(INFO_V30),
      updatedAt: new Date('2026-11-13T08:00:00Z'),
    };
    const META = 'ds-bottle/meta/episodes/chunk-000/file-000.parquet';
    const DATA = 'ds-bottle/data/chunk-000/file-000.parquet';
    let v30Files: Record<string, Buffer>;

    beforeAll(async () => {
      const episodeFields = {
        episode_index: { type: 'INT64' as const },
        length: { type: 'INT64' as const },
        'data/chunk_index': { type: 'INT64' as const },
        'data/file_index': { type: 'INT64' as const },
        'videos/observation.images.head/chunk_index': { type: 'INT64' as const },
        'videos/observation.images.head/file_index': { type: 'INT64' as const },
        'videos/observation.images.head/from_timestamp': { type: 'DOUBLE' as const },
        'videos/observation.images.head/to_timestamp': { type: 'DOUBLE' as const },
        'stats/action/mean': { type: 'DOUBLE' as const, repeated: true },
      };
      const episodes = Array.from({ length: 6 }, (_, i) => ({
        episode_index: i,
        length: 10,
        'data/chunk_index': 0,
        'data/file_index': 0,
        'videos/observation.images.head/chunk_index': 0,
        'videos/observation.images.head/file_index': 0,
        'videos/observation.images.head/from_timestamp': i,
        'videos/observation.images.head/to_timestamp': i + 1,
        'stats/action/mean': [i, i, i],
      }));
      v30Files = {
        'ds-bottle/meta/info.json': Buffer.from(JSON.stringify(INFO_V30)),
        // Two episodes a row group, as the recorder writes them: three row
        // groups of eight wanted columns were 24 requests.
        [META]: await parquetBuffer(episodeFields, episodes, { rowGroupSize: 2 }),
        [DATA]: await parquetBuffer(
          FRAME_FIELDS,
          episodes.flatMap((e) => frameRows(e.episode_index, 10, 31)),
          { rowGroupSize: 10 },
        ),
      };
    });

    beforeEach(() => {
      storage.buckets = { 'training-datasets': { ...v30Files } };
      datasets.get.mockResolvedValue(V30);
    });

    const list = () => request(app).get('/api/datasets/ds-bottle/episodes');
    const frames = (episode: number) => request(app).get(`/api/datasets/ds-bottle/episodes/${episode}/frames`);

    it('reads a v3.0 episode list in four round trips and answers the next one without any', async () => {
      const first = await list();
      expect(first.status).toBe(200);
      expect(first.body.episodes).toHaveLength(6);
      expect(first.body.episodes[4].videoWindows['observation.images.head']).toEqual({ from: 4, to: 5, chunk: 0, file: 0 });
      expect(storage.calls).toEqual([
        'LIST training-datasets/ds-bottle/',
        'LIST training-datasets/ds-bottle/meta/episodes/',
        `HEAD ${META}`,
        `GET ${META}`,
      ]);

      storage.calls = [];
      const second = await list();
      expect(second.body).toEqual(first.body);
      expect(storage.calls).toEqual([]);
    });

    it('lays the current flags over the remembered list', async () => {
      const { datasetEpisodeFlagRepository } = await import('../../repositories/DatasetEpisodeFlagRepository.js');
      const flagged = (body: { episodes: Array<{ index: number; flagged: boolean }> }) =>
        body.episodes.filter((e) => e.flagged).map((e) => e.index);
      expect(flagged((await list()).body)).toEqual([1]);
      vi.mocked(datasetEpisodeFlagRepository.flaggedIndices).mockResolvedValueOnce(new Set([0, 5]));
      expect(flagged((await list()).body)).toEqual([0, 5]);
      // The remembered rows themselves were not marked by either answer.
      expect(flagged((await list()).body)).toEqual([1]);
    });

    it('reads storage once for six lists asked for at the same time', async () => {
      const answers = await Promise.all(Array.from({ length: 6 }, list));
      expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(storage.calls.filter((c) => c === `GET ${META}`)).toHaveLength(1);
      expect(storage.calls).toHaveLength(4);
    });

    it('opens further episodes without reading the episode metadata or probing the bucket again', async () => {
      const first = await frames(2);
      expect(first.status).toBe(200);
      expect(first.body.total).toBe(10);
      expect(first.body.frames[0].observationState[0]).toBe(2000);

      storage.calls = [];
      const next = await frames(5);
      expect(next.body.frames[9].observationState[0]).toBe(5009);
      // Nothing at all: the small data file holds every episode and its
      // bytes were kept from the first read (TASK-492).
      expect(storage.calls).toEqual([]);

      storage.calls = [];
      expect((await list()).body.episodes).toHaveLength(6);
      expect((await frames(5)).body.total).toBe(10);
      expect(storage.calls).toEqual([]);
    });

    it('answers six different episodes opened at once, reading the metadata once', async () => {
      const answers = await Promise.all([0, 1, 2, 3, 4, 5].map(frames));
      expect(answers.map((a) => a.body.total)).toEqual([10, 10, 10, 10, 10, 10]);
      expect(answers.map((a) => a.body.frames[0].observationState[0])).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
      expect(storage.calls.filter((c) => c === `GET ${META}`)).toHaveLength(1);
      expect(storage.calls.filter((c) => c.startsWith('LIST'))).toHaveLength(2);
    });

    it('reads again once the dataset record has been written', async () => {
      await list();
      await frames(1);
      storage.calls = [];
      datasets.get.mockResolvedValue({ ...V30, updatedAt: new Date('2026-11-13T09:00:00Z') });
      expect((await list()).status).toBe(200);
      expect((await frames(1)).status).toBe(200);
      expect(storage.calls).toContain(`GET ${META}`);
      expect(storage.calls).toContain(`GET ${DATA}`);
    });

    it('forgets a dataset that was deleted or re-imported, so its files are not served from memory', async () => {
      await list();
      await frames(1);
      expect(datasetReadCacheUsage().episodeTables.entries).toBe(1);

      invalidateDatasetReads('ds-bottle');
      expect(Object.values(datasetReadCacheUsage()).map((u) => u.entries)).toEqual([0, 0, 0, 0, 0, 0]);
      storage.buckets = { 'training-datasets': {} };
      expect((await list()).status).toBe(422);
      expect((await frames(1)).status).toBe(422);
    });

    it('keeps answering a list it remembers while storage is down, and says so for one it does not', async () => {
      await list();
      storage.initialized = false;
      expect((await list()).status).toBe(200);
      const cold = await frames(3);
      expect(cold.status).toBe(503);
      expect(cold.body.error).toMatch(/Object storage is unavailable/);
    });

    describe('a viewer who has moved on (TASK-492)', () => {
      let server: http.Server;
      let port: number;
      let release: () => void;

      beforeEach(async () => {
        server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
        storage.hold = new Promise<void>((resolve) => (release = resolve));
        // The episode table is in memory, as it is once the page has listed the episodes.
        const held = storage.hold;
        storage.hold = null;
        await list();
        storage.hold = held;
        storage.calls = [];
      });
      afterEach(async () => {
        release();
        storage.hold = null;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      });

      /** A frames request over a real socket, which the test can drop. */
      function open(episode: number) {
        let finish!: (answer: { status: number; body: { total?: number } } | null) => void;
        const answer = new Promise<{ status: number; body: { total?: number } } | null>((resolve) => (finish = resolve));
        const req = http.get(
          { host: '127.0.0.1', port, path: `/api/datasets/ds-bottle/episodes/${episode}/frames`, agent: false },
          (res) => {
            let text = '';
            res.on('data', (chunk) => (text += chunk));
            res.on('end', () => finish({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
          },
        );
        req.on('error', () => finish(null));
        return { answer, drop: () => req.destroy() };
      }
      const until = async (condition: () => boolean) => {
        for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
        expect(condition()).toBe(true);
      };
      const framesLogged = (episode: number) =>
        logSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes(`frames from parquet for episode ${episode},`)).length;
      let logSpy: ReturnType<typeof vi.spyOn>;
      beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      });
      afterEach(() => logSpy.mockRestore());

      it('stops reading an episode whose only request was dropped, and reads it afresh when asked again', async () => {
        const viewer = open(2);
        await until(() => storage.calls.includes(`GET ${DATA}`));
        viewer.drop();
        expect(await viewer.answer).toBeNull();
        // Give the server its turn to notice, then let storage answer.
        await new Promise((r) => setTimeout(r, 30));
        release();
        await new Promise((r) => setTimeout(r, 30));

        // Nothing was decoded and nothing was kept for it.
        expect(framesLogged(2)).toBe(0);
        expect(datasetReadCacheUsage().episodeFrames.entries).toBe(0);

        storage.hold = null;
        const back = await frames(2);
        expect(back.status).toBe(200);
        expect(back.body.total).toBe(10);
        expect(back.body.frames[0].observationState[0]).toBe(2000);
      });

      it('finishes the read for a second request that is still waiting for the same episode', async () => {
        const left = open(4);
        const stays = open(4);
        await until(() => storage.calls.includes(`GET ${DATA}`));
        // Both are waiting on the one read.
        await new Promise((r) => setTimeout(r, 30));
        left.drop();
        expect(await left.answer).toBeNull();
        await new Promise((r) => setTimeout(r, 30));
        release();

        const answer = await stays.answer;
        expect(answer?.status).toBe(200);
        expect(answer?.body.total).toBe(10);
        expect(storage.calls.filter((c) => c === `GET ${DATA}`)).toHaveLength(1);
        expect(datasetReadCacheUsage().episodeFrames.entries).toBe(1);
      });

      it('takes dropped requests out of the queue for a read slot, so the newest is not behind them', async () => {
        // Six reads hold every slot; a seventh and eighth request queue behind them.
        // v2.1 episodes each have a file of their own, so each is a read of its own.
        datasets.get.mockImplementation(async (id: string) => (id === 'ds-apple' ? DATASET : V30));
        storage.buckets = { 'training-datasets': { ...v30Files, ...v21Files } };
        const openApple = (episode: number) => {
          const req = http.get({ host: '127.0.0.1', port, path: `/api/datasets/ds-apple/episodes/${episode}/frames`, agent: false });
          req.on('error', () => undefined);
          return req;
        };
        const holders = [0, 1, 2].map(openApple);
        const more = [0, 1, 3].map((episode) => open(episode));
        await until(() => storage.calls.filter((c) => c.startsWith('GET')).length === 4);
        // Episodes 0, 1 and 3 of the bottle file share its one download; the
        // apple episodes hold three more slots — six reads in all.
        const queuedOld = open(4);
        const queuedNew = open(5);
        await new Promise((r) => setTimeout(r, 30));

        queuedOld.drop();
        expect(await queuedOld.answer).toBeNull();
        await new Promise((r) => setTimeout(r, 30));
        release();
        expect((await queuedNew.answer)?.status).toBe(200);
        for (const m of more) expect((await m.answer)?.status).toBe(200);
        // The dropped one never got a slot: it was not read.
        expect(framesLogged(4)).toBe(0);
        for (const holder of holders) holder.destroy();
      });
    });

    describe('?maxPoints — frames for a chart (TASK-492)', () => {
      it('thins the page to evenly spaced frames and still reports the real total', async () => {
        const all = await frames(3);
        const thinned = await request(app).get('/api/datasets/ds-bottle/episodes/3/frames?maxPoints=4');
        expect(thinned.status).toBe(200);
        expect(thinned.body.total).toBe(10);
        expect(thinned.body.frames.map((f: { frameIndex: number }) => f.frameIndex)).toEqual([0, 3, 6, 9]);
        expect(thinned.body.frames[1]).toEqual(all.body.frames[3]);
      });

      it('changes nothing when the page is already small enough, or the value is not a number', async () => {
        const all = await frames(3);
        for (const value of ['400', '10', 'abc', '0', '-5']) {
          const answer = await request(app).get(`/api/datasets/ds-bottle/episodes/3/frames?maxPoints=${value}`);
          expect(answer.body).toEqual(all.body);
        }
      });

      it('thins after paging, so offset and limit mean what they did', async () => {
        const answer = await request(app).get('/api/datasets/ds-bottle/episodes/3/frames?offset=2&limit=6&maxPoints=2');
        expect(answer.body.frames.map((f: { frameIndex: number }) => f.frameIndex)).toEqual([2, 7]);
        expect(answer.body.total).toBe(10);
      });
    });
  });
});

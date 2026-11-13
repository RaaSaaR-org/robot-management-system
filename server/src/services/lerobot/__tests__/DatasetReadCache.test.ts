/**
 * @file DatasetReadCache.test.ts
 * @description What the dataset browser remembers about stored files, how much, and when it forgets (TASK-490)
 * @feature datasets
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cachedEpisodeTable,
  cachedLocation,
  clearDatasetReadCaches,
  createGate,
  datasetReadCacheUsage,
  datasetVersionKey,
  episodeTableCache,
  FOOTER_BYTES,
  footerCachingStore,
  invalidateDatasetReads,
  parquetFooterCache,
  sharedFileCache,
  storageLocationCache,
} from '../DatasetReadCache.js';
import { ReadAbandoned } from '../ReadCache.js';
import { parquetMetadataCache } from '../parquetEpisodeRows.js';
import {
  episodeFramesCache,
  WHOLE_FILE_BYTES,
  type DatasetObjectStore,
  type EpisodeTable,
} from '../RemoteDatasetReader.js';

const table = (episodes: number): EpisodeTable => ({
  layout: 'v2',
  episodes: Array.from({ length: episodes }, (_, index) => ({ index, frameCount: 10, durationSeconds: 1, flagged: false })),
});

/** A ranged store over `files` that records every round trip. */
function countingStore(files: Record<string, Buffer>): DatasetObjectStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async read(path) {
      calls.push(`GET ${path}`);
      return files[path] ?? null;
    },
    async list(prefix) {
      calls.push(`LIST ${prefix}`);
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async stat(path) {
      calls.push(`HEAD ${path}`);
      return files[path] ? { size: files[path].length } : null;
    },
    async readRange(path, offset, length) {
      calls.push(`GET ${path}@${offset}+${length}`);
      return files[path].subarray(offset, offset + length);
    },
  };
}

beforeEach(() => clearDatasetReadCaches());

describe('datasetVersionKey', () => {
  it('changes whenever the dataset record is written, and survives a record without a date', () => {
    const a = datasetVersionKey({ id: 'ds', updatedAt: new Date('2026-11-13T10:00:00Z') });
    const b = datasetVersionKey({ id: 'ds', updatedAt: '2026-11-13T10:00:01Z' });
    expect(a).not.toBe(b);
    expect(a.startsWith('ds@')).toBe(true);
    expect(datasetVersionKey({ id: 'ds' })).toBe('ds@0');
    expect(datasetVersionKey({ id: 'ds', updatedAt: 'not a date' })).toBe('ds@0');
  });
});

describe('cachedEpisodeTable', () => {
  it('reads once for any number of concurrent and later callers', async () => {
    let loads = 0;
    const load = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 5));
      return table(3);
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => cachedEpisodeTable('ds@1', load)));
    expect(new Set(results).size).toBe(1);
    await cachedEpisodeTable('ds@1', load);
    expect(loads).toBe(1);
  });

  it('reads again for another stored state of the same dataset', async () => {
    let loads = 0;
    const load = async () => (loads++, table(3));
    await cachedEpisodeTable('ds@1', load);
    await cachedEpisodeTable('ds@2', load);
    expect(loads).toBe(2);
  });

  it('does not remember a failed read', async () => {
    await expect(cachedEpisodeTable('ds@1', async () => Promise.reject(new Error('storage down')))).rejects.toThrow('storage down');
    expect((await cachedEpisodeTable('ds@1', async () => table(2))).episodes).toHaveLength(2);
  });

  it('keeps tables within its budget by dropping the least recently used', async () => {
    // ~160 bytes an episode: 30,000 episodes is 4.8 MB, so one table fits in 8 MB and two do not.
    for (const id of ['a', 'b', 'c']) await cachedEpisodeTable(`${id}@1`, async () => table(30_000));
    const usage = datasetReadCacheUsage().episodeTables;
    expect(usage.entries).toBe(1);
    expect(usage.weight).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(episodeTableCache.get('a@1#episodes')).toBeUndefined();
    expect(episodeTableCache.get('c@1#episodes')).toBeDefined();
  });
});

describe('invalidateDatasetReads', () => {
  it('drops every cached read of that dataset and leaves other datasets alone', async () => {
    for (const id of ['gone', 'kept']) {
      await cachedEpisodeTable(`${id}@1`, async () => table(2));
      await cachedLocation(`${id}@1#bucket`, async () => ({ bucket: 'training-datasets' }));
      parquetFooterCache.set(`${id}@1#file:data/chunk-000/file-000.parquet`, { size: 10 }, 64);
      episodeFramesCache.set(`${id}@1#0`, { frames: [], source: 'x' }, 10);
      parquetMetadataCache.set(`${id}@1#file:data/chunk-000/file-000.parquet`, {}, 10);
      sharedFileCache.set(`${id}@1#file:data/chunk-000/file-000.parquet`, Buffer.alloc(4), 4);
    }
    invalidateDatasetReads('gone');
    const usage = datasetReadCacheUsage();
    expect(Object.values(usage).map((u) => u.entries)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(episodeTableCache.get('kept@1#episodes')).toBeDefined();
    expect(episodeFramesCache.get('gone@1#0')).toBeUndefined();
  });

  it('does not match a dataset whose id merely starts the same', async () => {
    await cachedEpisodeTable('ds-1@1', async () => table(1));
    await cachedEpisodeTable('ds-10@1', async () => table(1));
    invalidateDatasetReads('ds-1');
    expect(episodeTableCache.get('ds-10@1#episodes')).toBeDefined();
    expect(episodeTableCache.get('ds-1@1#episodes')).toBeUndefined();
  });

  it('does not keep what a read that was already running brings back', async () => {
    let release!: () => void;
    const pending = cachedEpisodeTable('ds@1', async () => {
      await new Promise<void>((r) => (release = r));
      return table(5);
    });
    // Let the load get under way before the dataset is invalidated.
    await new Promise((r) => setImmediate(r));
    invalidateDatasetReads('ds');
    release();
    expect((await pending).episodes).toHaveLength(5);
    expect(episodeTableCache.get('ds@1#episodes')).toBeUndefined();
  });
});

describe('cachedLocation', () => {
  it('remembers where something was found, but never that it was missing', async () => {
    let lookups = 0;
    const absent = async () => (lookups++, null);
    expect(await cachedLocation('ds@1#video:a', absent)).toBeNull();
    expect(await cachedLocation('ds@1#video:a', absent)).toBeNull();
    expect(lookups).toBe(2);

    const present = async () => (lookups++, { bucket: 'training-datasets', key: 'ds/a.mp4', size: 7 });
    expect(await cachedLocation('ds@1#video:a', present)).toEqual({ bucket: 'training-datasets', key: 'ds/a.mp4', size: 7 });
    await cachedLocation('ds@1#video:a', present);
    expect(lookups).toBe(3);
  });

  it('holds a bounded number of locations', () => {
    for (let i = 0; i < 5000; i++) storageLocationCache.set(`ds@1#video:${i}`, { bucket: 'b' }, 1);
    expect(storageLocationCache.size).toBe(4096);
  });
});

describe('footerCachingStore', () => {
  const big = Buffer.alloc(WHOLE_FILE_BYTES + 3 * FOOTER_BYTES);
  for (let i = 0; i < big.length; i += 4096) big.writeUInt32LE(i, i);
  const small = Buffer.from('a small file');
  const files = { 'data/big.parquet': big, 'data/small.parquet': small };

  it('opens a large file with one HEAD and its magic and tail fetched together, then from memory', async () => {
    const inner = countingStore(files);
    const store = footerCachingStore(inner, 'ds@1');
    expect(await store.stat!('data/big.parquet')).toEqual({ size: big.length });
    expect(inner.calls).toEqual([
      'HEAD data/big.parquet',
      'GET data/big.parquet@0+4',
      `GET data/big.parquet@${big.length - FOOTER_BYTES}+${FOOTER_BYTES}`,
    ]);

    inner.calls.length = 0;
    // What opening a parquet file reads: magic, footer length, footer.
    expect(await store.readRange!('data/big.parquet', 0, 4)).toEqual(big.subarray(0, 4));
    expect(await store.readRange!('data/big.parquet', big.length - 8, 8)).toEqual(big.subarray(big.length - 8));
    const footerAt = big.length - 90_000;
    expect(await store.readRange!('data/big.parquet', footerAt, 89_992)).toEqual(big.subarray(footerAt, footerAt + 89_992));
    expect(await store.stat!('data/big.parquet')).toEqual({ size: big.length });
    expect(inner.calls).toEqual([]);
  });

  it('passes reads outside the remembered regions through to storage', async () => {
    const inner = countingStore(files);
    const store = footerCachingStore(inner, 'ds@1');
    await store.stat!('data/big.parquet');
    inner.calls.length = 0;
    const straddling = big.length - FOOTER_BYTES - 10;
    expect(await store.readRange!('data/big.parquet', 1_000_000, 500)).toEqual(big.subarray(1_000_000, 1_000_500));
    expect(await store.readRange!('data/big.parquet', straddling, 100)).toEqual(big.subarray(straddling, straddling + 100));
    expect(inner.calls).toEqual(['GET data/big.parquet@1000000+500', `GET data/big.parquet@${straddling}+100`]);
  });

  it('remembers only the size of a file small enough to fetch whole', async () => {
    const inner = countingStore(files);
    const store = footerCachingStore(inner, 'ds@1');
    expect(await store.stat!('data/small.parquet')).toEqual({ size: small.length });
    expect(await store.stat!('data/small.parquet')).toEqual({ size: small.length });
    expect(inner.calls).toEqual(['HEAD data/small.parquet']);
    expect(await store.read('data/small.parquet')).toEqual(small);
  });

  it('asks again for a file that was missing, and shares one open between concurrent readers', async () => {
    const inner = countingStore({ ...files });
    const store = footerCachingStore(inner, 'ds@1');
    expect(await store.stat!('data/late.parquet')).toBeNull();
    expect(await store.stat!('data/late.parquet')).toBeNull();
    expect(inner.calls).toEqual(['HEAD data/late.parquet', 'HEAD data/late.parquet']);

    inner.calls.length = 0;
    await Promise.all(Array.from({ length: 6 }, () => store.stat!('data/big.parquet')));
    expect(inner.calls.filter((c) => c.startsWith('HEAD'))).toHaveLength(1);
    expect(inner.calls).toHaveLength(3);
  });

  it('keeps the footers of two stored states apart, and its total within budget', async () => {
    const inner = countingStore(files);
    await footerCachingStore(inner, 'ds@1').stat!('data/big.parquet');
    await footerCachingStore(inner, 'ds@2').stat!('data/big.parquet');
    expect(inner.calls.filter((c) => c.startsWith('HEAD'))).toHaveLength(2);

    for (let i = 3; i < 100; i++) await footerCachingStore(inner, `ds@${i}`).stat!('data/big.parquet');
    const usage = datasetReadCacheUsage().parquetFooters;
    expect(usage.weight).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(usage.entries).toBeLessThan(99);
  });

  it('leaves a store without ranged access as it is', () => {
    const plain: DatasetObjectStore = { read: async () => null, list: async () => [] };
    expect(footerCachingStore(plain, 'ds@1')).toBe(plain);
  });
});

describe('createGate', () => {
  it('never runs more than its limit at once and runs everything in the end', async () => {
    const gate = createGate(3);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        gate(async () => {
          peak = Math.max(peak, ++running);
          await new Promise((r) => setTimeout(r, i % 3));
          running--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(done).toHaveLength(20);
  });

  it('frees its slot when a task fails', async () => {
    const gate = createGate(1);
    await expect(gate(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate(async () => 'next')).toBe('next');
  });

  it('takes the slot back from a task that hangs, and does not free it twice when that task ends', async () => {
    vi.useFakeTimers();
    try {
      const gate = createGate(1, 1000);
      let finishHung!: (value: string) => void;
      const hung = gate(() => new Promise<string>((resolve) => (finishHung = resolve)));
      let running = 0;
      let peak = 0;
      const next = [1, 2].map((i) =>
        gate(async () => {
          peak = Math.max(peak, ++running);
          await new Promise((r) => setTimeout(r, 10));
          running--;
          return i;
        }),
      );
      // Both wait behind the hung read until its hold runs out.
      await vi.advanceTimersByTimeAsync(999);
      expect(running).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(running).toBe(1);
      // The hung read ends late: its caller is answered, and no second slot appears.
      finishHung('late');
      expect(await hung).toBe('late');
      await vi.advanceTimersByTimeAsync(50);
      expect(await Promise.all(next)).toEqual([1, 2]);
      expect(peak).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createGate — who waits, and who goes first (TASK-492)', () => {
  /** A task the test finishes by hand. */
  function held(gate: ReturnType<typeof createGate>, order: string[], name: string, signal?: AbortSignal) {
    let finish!: () => void;
    const done = gate(
      () =>
        new Promise<string>((resolve) => {
          order.push(name);
          finish = () => resolve(name);
        }),
      signal,
    );
    return { done, finish: () => finish() };
  }
  const turn = () => new Promise((r) => setTimeout(r, 0));

  it('gives a freed slot to the request that arrived last', async () => {
    const gate = createGate(1);
    const order: string[] = [];
    const running = held(gate, order, 'running');
    const stale = held(gate, order, 'episode 3');
    const older = held(gate, order, 'episode 4');
    const newest = held(gate, order, 'episode 5');
    await turn();
    expect(order).toEqual(['running']);

    running.finish();
    await turn();
    expect(order).toEqual(['running', 'episode 5']);
    newest.finish();
    await turn();
    older.finish();
    await turn();
    stale.finish();
    await Promise.all([running.done, stale.done, older.done, newest.done]);
    expect(order).toEqual(['running', 'episode 5', 'episode 4', 'episode 3']);
  });

  it('lets a waiter leave the queue without ever running it, and without losing a slot', async () => {
    const gate = createGate(1);
    const order: string[] = [];
    const running = held(gate, order, 'running');
    const viewer = new AbortController();
    const left = held(gate, order, 'left', viewer.signal);
    const stays = held(gate, order, 'stays');
    await turn();

    viewer.abort();
    await expect(left.done).rejects.toBeInstanceOf(ReadAbandoned);
    running.finish();
    await turn();
    stays.finish();
    await Promise.all([running.done, stays.done]);
    expect(order).toEqual(['running', 'stays']);
    // The slot count is intact: one more task runs straight away.
    expect(await gate(async () => 'next')).toBe('next');
  });

  it('refuses a task whose caller has already left', async () => {
    const gate = createGate(1);
    const viewer = new AbortController();
    viewer.abort();
    const task = vi.fn(async () => 'never');
    await expect(gate(task, viewer.signal)).rejects.toBeInstanceOf(ReadAbandoned);
    expect(task).not.toHaveBeenCalled();
  });

  it('does not stop a task that already holds a slot when its signal fires', async () => {
    const gate = createGate(1);
    const order: string[] = [];
    const viewer = new AbortController();
    const running = held(gate, order, 'running', viewer.signal);
    await turn();
    viewer.abort();
    running.finish();
    expect(await running.done).toBe('running');
  });
});

describe('sharedFileCache — a small data file is fetched once for all its episodes (TASK-492)', () => {
  const files = { 'data/chunk-000/file-000.parquet': Buffer.alloc(1000, 7) };

  it('answers the second read of a file from memory, and a missing file every time from storage', async () => {
    const inner = countingStore(files);
    const store = footerCachingStore(inner, 'ds@1');
    const first = await store.readShared!('data/chunk-000/file-000.parquet');
    const second = await store.readShared!('data/chunk-000/file-000.parquet');
    expect(second).toBe(first);
    expect(inner.calls.filter((c) => c.startsWith('GET'))).toHaveLength(1);
    expect(datasetReadCacheUsage().sharedFiles).toEqual({ entries: 1, weight: 1000 });

    expect(await store.readShared!('data/chunk-000/file-009.parquet')).toBeNull();
    expect(await store.readShared!('data/chunk-000/file-009.parquet')).toBeNull();
    expect(inner.calls.filter((c) => c === 'GET data/chunk-000/file-009.parquet')).toHaveLength(2);
  });

  it('does not keep what a plain read fetched', async () => {
    const inner = countingStore(files);
    const store = footerCachingStore(inner, 'ds@1');
    await store.read('data/chunk-000/file-000.parquet');
    await store.read('data/chunk-000/file-000.parquet');
    expect(inner.calls.filter((c) => c.startsWith('GET'))).toHaveLength(2);
    expect(datasetReadCacheUsage().sharedFiles.entries).toBe(0);
  });

  it('stays within 24 MB however many files pass through', async () => {
    const big = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`data/f${i}.parquet`, Buffer.alloc(WHOLE_FILE_BYTES)]));
    const store = footerCachingStore(countingStore(big), 'ds@1');
    for (const path of Object.keys(big)) await store.readShared!(path);
    const usage = datasetReadCacheUsage().sharedFiles;
    expect(usage.weight).toBeLessThanOrEqual(24 * 1024 * 1024);
    expect(usage.entries).toBe(6);
  });

  it('names a file by the stored state of its dataset', () => {
    const inner = countingStore(files);
    expect(footerCachingStore(inner, 'ds@1').fileKey!('data/a.parquet')).not.toBe(
      footerCachingStore(inner, 'ds@2').fileKey!('data/a.parquet'),
    );
  });
});

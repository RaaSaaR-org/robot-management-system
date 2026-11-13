/**
 * @file DatasetReadCache.ts
 * @description What the dataset browser remembers between requests about a dataset in object storage, and when it forgets
 * @feature datasets
 *
 * Browsing a v3.0 dataset on the live instance took 2–4 s per episode list and
 * fell over at six requests in parallel. Nothing was slow in itself; nothing
 * was remembered. Every list request probed the bucket, listed
 * `meta/episodes/`, sent two HEADs and then 139 ranged GETs for one 828 KB
 * file — and every newly opened episode did all of that again before touching
 * its own data file. At ~20 ms a round trip that is the whole 2.8 s, and the
 * requests of six browsers are several hundred round trips signed and parsed
 * on one throttled CPU.
 *
 * So the three things that do not change while the stored files do not change
 * are kept, each under its own budget:
 *
 * - the **episode table** of a dataset (`meta/episodes*`), which answers the
 *   episode list and tells a v3.0 frames read which data file to open,
 * - the **footer** of each large parquet file — its size, magic and tail —
 *   so opening another episode of the same file costs one ranged GET,
 * - **where an object is**: the bucket a dataset lives in, and the bucket, key
 *   and size of a video, which the player asks for again on every seek.
 *
 * Decoded frames are a fourth, older cache (`episodeFramesCache`, TASK-355).
 *
 * Every key starts with `<dataset id>@<record updatedAt>`, so anything that
 * rewrites the dataset record reads fresh. {@link invalidateDatasetReads}
 * drops a dataset's entries outright when it is deleted, re-validated or
 * re-uploaded, and a ten-minute TTL covers files changed behind the record's
 * back.
 */

import { ReadCache } from './ReadCache.js';
import {
  episodeFramesCache,
  episodeTableWeight,
  WHOLE_FILE_BYTES,
  type DatasetObjectStore,
  type EpisodeTable,
} from './RemoteDatasetReader.js';

const TTL_MS = 10 * 60 * 1000;

/** How much of a large parquet file's end is kept: the footer and its length. */
export const FOOTER_BYTES = 256 * 1024;
/** The leading magic `PAR1`, which the parquet library checks before the footer. */
const HEAD_BYTES = 4;

/** Size, leading magic and tail of one stored file. Small files carry the size only. */
interface FileHandle {
  size: number;
  head?: Buffer;
  tail?: Buffer;
}

/** Where a stored object was found. */
export interface StorageLocation {
  bucket: string;
  key?: string;
  size?: number;
}

/** Episode tables: ~0.5 KB an episode, so 8 MB is some 15,000 episodes across datasets. */
export const episodeTableCache = new ReadCache<EpisodeTable>({ maxWeight: 8 * 1024 * 1024, ttlMs: TTL_MS });
/** Parquet footers, weighed by the bytes held. */
export const parquetFooterCache = new ReadCache<FileHandle>({ maxWeight: 16 * 1024 * 1024, ttlMs: TTL_MS });
/** Bucket and video lookups; every entry weighs 1, so this is a count. */
export const storageLocationCache = new ReadCache<StorageLocation>({ maxWeight: 4096, ttlMs: TTL_MS });

/**
 * The prefix of every cache key of one stored state of a dataset. The
 * record's `updatedAt` moves whenever the row is written, which includes every
 * import, upload and validation that could have changed its files.
 */
export function datasetVersionKey(dataset: { id: string; updatedAt?: Date | string | null }): string {
  const stamp = dataset.updatedAt ? new Date(dataset.updatedAt).getTime() : 0;
  return `${dataset.id}@${Number.isFinite(stamp) ? stamp : 0}`;
}

/** Forget everything read from this dataset's storage, in every cache. */
export function invalidateDatasetReads(datasetId: string): void {
  const prefix = `${datasetId}@`;
  episodeTableCache.deletePrefix(prefix);
  parquetFooterCache.deletePrefix(prefix);
  storageLocationCache.deletePrefix(prefix);
  episodeFramesCache.deletePrefix(prefix);
}

/** Empty every dataset read cache. For tests. */
export function clearDatasetReadCaches(): void {
  episodeTableCache.clear();
  parquetFooterCache.clear();
  storageLocationCache.clear();
  episodeFramesCache.clear();
}

/**
 * Run at most `limit` of the given tasks at once; the rest wait their turn in
 * order. A slot is handed straight to the next waiter, so the count never
 * exceeds the limit even when a task finishes and another arrives together.
 */
export function createGate(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * Bounds reads that are NOT served from a cache. Each holds up to one row
 * group's bytes (8 MB) plus its decoded rows, so the limit is what keeps a
 * burst of first-time requests from being a burst of memory. Cache hits never
 * pass through here, and neither do requests waiting on a load already running.
 */
export const coldReadGate = createGate(6);

/** The dataset's episode table, read once per stored state and shared by concurrent callers. */
export function cachedEpisodeTable(versionKey: string, load: () => Promise<EpisodeTable>): Promise<EpisodeTable> {
  return episodeTableCache.getOrLoad(`${versionKey}#episodes`, episodeTableWeight, () => coldReadGate(load));
}

/** Thrown inside a cache load to say "not there" — a failed load is not remembered. */
class MissingObject extends Error {}

/**
 * A lookup of where something is stored, remembered only when it was found
 * and shared between callers that ask while it is still running.
 */
export async function cachedLocation<T extends StorageLocation>(
  key: string,
  find: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return (await storageLocationCache.getOrLoad(
      key,
      () => 1,
      async () => {
        const found = await find();
        if (!found) throw new MissingObject();
        return found;
      },
    )) as T;
  } catch (error) {
    if (error instanceof MissingObject) return null;
    throw error;
  }
}

/**
 * The same store, remembering each file's size and — for a file too large to
 * fetch whole — its first and last bytes, where the parquet footer is.
 *
 * Opening a parquet file reads its magic, its footer length and its footer:
 * three round trips before the first row, after one or two HEADs for the size.
 * Here the first open of a large file fetches magic and tail side by side and
 * every later open of it is answered from memory. Reads outside those two
 * regions, and everything about a store without ranged access, pass through.
 */
export function footerCachingStore(store: DatasetObjectStore, versionKey: string): DatasetObjectStore {
  if (!store.stat || !store.readRange) return store;
  const stat = store.stat.bind(store);
  const readRange = store.readRange.bind(store);
  const keyOf = (path: string) => `${versionKey}#file:${path}`;

  const open = async (path: string): Promise<FileHandle | null> => {
    try {
      return await parquetFooterCache.getOrLoad(
        keyOf(path),
        (handle) => 64 + (handle.head?.length ?? 0) + (handle.tail?.length ?? 0),
        async () => {
          const found = await stat(path);
          if (!found) throw new MissingObject();
          if (found.size <= WHOLE_FILE_BYTES) return { size: found.size };
          const tailLength = Math.min(found.size, FOOTER_BYTES);
          const [head, tail] = await Promise.all([
            readRange(path, 0, HEAD_BYTES),
            readRange(path, found.size - tailLength, tailLength),
          ]);
          return { size: found.size, head, tail };
        },
      );
    } catch (error) {
      // A file that is not there yet may be there on the next request.
      if (error instanceof MissingObject) return null;
      throw error;
    }
  };

  return {
    read: (path) => store.read(path),
    list: (prefix) => store.list(prefix),
    async stat(path) {
      const handle = await open(path);
      return handle ? { size: handle.size } : null;
    },
    async readRange(path, offset, length) {
      const handle = parquetFooterCache.get(keyOf(path));
      if (handle?.head && offset + length <= handle.head.length) {
        return handle.head.subarray(offset, offset + length);
      }
      if (handle?.tail) {
        const tailStart = handle.size - handle.tail.length;
        if (offset >= tailStart && offset + length <= handle.size) {
          return handle.tail.subarray(offset - tailStart, offset - tailStart + length);
        }
      }
      return readRange(path, offset, length);
    },
  };
}

/** Entries and summed weight per cache, for the memory tests. */
export function datasetReadCacheUsage(): Record<string, { entries: number; weight: number }> {
  const usage = (cache: { size: number; totalWeight: number }) => ({ entries: cache.size, weight: cache.totalWeight });
  return {
    episodeTables: usage(episodeTableCache),
    parquetFooters: usage(parquetFooterCache),
    storageLocations: usage(storageLocationCache),
    episodeFrames: usage(episodeFramesCache),
  };
}

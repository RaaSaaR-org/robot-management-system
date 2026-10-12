/**
 * @file RemoteDatasetReader.test.ts
 * @description Episodes and frames come from the dataset's real files, or fail (TASK-354)
 * @feature datasets
 *
 * The routes this reader replaced answered 200 with averaged episode lengths
 * and sine-wave joints whenever the one file they knew about was absent —
 * which was every v2.1 dataset. Every case below either reads the values the
 * fixture holds or expects a DatasetReadError; none may succeed with numbers
 * the fixture does not contain.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  DatasetReadError,
  formatPathTemplate,
  layoutOf,
  parseEpisodeRecords,
  readRemoteEpisodes,
  readRemoteFrames,
  type DatasetObjectStore,
} from '../RemoteDatasetReader.js';
import { FRAME_FIELDS, frameRows, memoryStore, parquetBuffer } from './parquetFixtures.js';

const PAGE = { offset: 0, limit: 10_000 };

async function expectReadError(p: Promise<unknown>, status: number, text: RegExp): Promise<DatasetReadError> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DatasetReadError);
  const e = error as DatasetReadError;
  expect(e.status).toBe(status);
  expect(`${e.message} ${e.detail ?? ''}`).toMatch(text);
  return e;
}

describe('layoutOf', () => {
  it('reads codebase_version first, the record version second', () => {
    expect(layoutOf({ codebase_version: 'v2.1' }, 'v3.0')).toBe('v2');
    expect(layoutOf({ codebase_version: 'v3.0' })).toBe('v3');
    expect(layoutOf({}, 'v2.0')).toBe('v2');
  });

  it('refuses a dataset whose layout it would have to guess', () => {
    expect(() => layoutOf({})).toThrow(DatasetReadError);
    expect(() => layoutOf({ codebase_version: 'v1.6' })).toThrow(/Unsupported LeRobot version "v1.6"/);
  });
});

describe('helpers', () => {
  it('expands LeRobot path templates', () => {
    expect(
      formatPathTemplate('data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet', {
        episode_chunk: 1,
        episode_index: 1042,
      }),
    ).toBe('data/chunk-001/episode_001042.parquet');
  });

  it('parses JSON Lines and a JSON array alike', () => {
    expect(parseEpisodeRecords('{"episode_index":0,"length":5}\n\n{"episode_index":1,"length":7}\n')).toHaveLength(2);
    expect(parseEpisodeRecords('[{"episode_index":0,"length":5}]')).toEqual([{ episode_index: 0, length: 5 }]);
  });
});

describe('LeRobot v2.1 (per-episode parquet)', () => {
  const lengths = [5, 9, 3];
  const info = { codebase_version: 'v2.1', fps: 30, chunks_size: 1000, total_episodes: 3, total_frames: 17 };
  let store: DatasetObjectStore;

  beforeAll(async () => {
    const files: Record<string, Buffer | string> = {
      'meta/episodes.jsonl': lengths
        .map((length, i) => JSON.stringify({ episode_index: i, tasks: ['pick the apple'], length }))
        .join('\n'),
    };
    for (const [i, length] of lengths.entries()) {
      files[`data/chunk-000/episode_${String(i).padStart(6, '0')}.parquet`] = await parquetBuffer(
        FRAME_FIELDS,
        frameRows(i, length, 43),
      );
    }
    store = memoryStore(files);
  });

  it('returns one episode per line with its real length, summing to total_frames', async () => {
    const episodes = await readRemoteEpisodes(store, info, 30);
    expect(episodes.map((e) => e.frameCount)).toEqual(lengths);
    expect(episodes.reduce((n, e) => n + e.frameCount, 0)).toBe(info.total_frames);
    expect(episodes[1]).toMatchObject({ index: 1, durationSeconds: 0.3, flagged: false });
  });

  it("reads an episode's frames from its own file, at the real width", async () => {
    const page = await readRemoteFrames(store, info, 1, 30, PAGE);
    expect(page.total).toBe(9);
    expect(page.source).toBe('data/chunk-000/episode_000001.parquet');
    expect(page.frames[0].observationState).toHaveLength(43);
    expect(page.frames[0].action).toHaveLength(43);
    expect(page.frames[4].observationState[0]).toBe(1004);
  });

  it('pages without changing total', async () => {
    const page = await readRemoteFrames(store, info, 1, 30, { offset: 2, limit: 3 });
    expect(page.frames.map((f) => f.frameIndex)).toEqual([2, 3, 4]);
    expect(page.total).toBe(9);
  });

  it('honours a custom data_path template', async () => {
    const buf = await parquetBuffer(FRAME_FIELDS, frameRows(0, 2, 6));
    const custom = memoryStore({ 'frames/0/ep-0.parquet': buf });
    const page = await readRemoteFrames(
      custom,
      { codebase_version: 'v2.1', data_path: 'frames/{episode_chunk}/ep-{episode_index}.parquet' },
      0,
      30,
      PAGE,
    );
    expect(page.total).toBe(2);
  });

  it('404s an episode index the dataset does not have', async () => {
    await expectReadError(readRemoteFrames(store, info, 3, 30, PAGE), 404, /Episode frames not found.*3 episodes/);
  });

  it("names the missing file of an episode that should exist", async () => {
    const holed = memoryStore({ 'meta/episodes.jsonl': '{"episode_index":0,"length":5}' });
    const e = await expectReadError(readRemoteFrames(holed, info, 0, 30, PAGE), 422, /episode_000000\.parquet is missing/);
    expect(e.file).toBe('data/chunk-000/episode_000000.parquet');
  });

  it('fails without episodes.jsonl instead of inventing episodes from info.json', async () => {
    await expectReadError(readRemoteEpisodes(memoryStore({}), info, 30), 422, /meta\/episodes\.jsonl is missing/);
  });

  it('turns a storage failure into a 502 naming the file', async () => {
    const broken = memoryStore({}, ['meta/episodes.jsonl']);
    await expectReadError(readRemoteEpisodes(broken, info, 30), 502, /meta\/episodes\.jsonl.*connection reset/);
  });

  it('reports a corrupt parquet as a 502 naming it', async () => {
    const corrupt = memoryStore({ 'data/chunk-000/episode_000000.parquet': 'not parquet' });
    await expectReadError(readRemoteFrames(corrupt, info, 0, 30, PAGE), 502, /Could not read data\/chunk-000\/episode_000000\.parquet/);
  });
});

describe('LeRobot v3.0 (concatenated file-* parquet)', () => {
  const info = { codebase_version: 'v3.0', fps: 30, chunks_size: 1000, total_episodes: 4, total_frames: 22 };
  const EPISODE_FIELDS = {
    episode_index: { type: 'INT64' as const },
    length: { type: 'INT64' as const },
    'data/chunk_index': { type: 'INT64' as const },
    'data/file_index': { type: 'INT64' as const },
    'videos/observation.images.front/chunk_index': { type: 'INT64' as const },
    'videos/observation.images.front/file_index': { type: 'INT64' as const },
    'videos/observation.images.front/from_timestamp': { type: 'DOUBLE' as const },
    'videos/observation.images.front/to_timestamp': { type: 'DOUBLE' as const },
    // pusht names its one camera in the singular
    'videos/observation.image/chunk_index': { type: 'INT64' as const },
    'videos/observation.image/file_index': { type: 'INT64' as const },
    'videos/observation.image/from_timestamp': { type: 'DOUBLE' as const },
    'videos/observation.image/to_timestamp': { type: 'DOUBLE' as const },
  };
  // Episodes 0-1 in file-000, 2-3 in file-001 — of both meta and data.
  const lengths = [4, 6, 5, 7];
  const fileOf = (i: number) => (i < 2 ? 0 : 1);

  function episodeRow(i: number, withCoords = true): Record<string, unknown> {
    return {
      episode_index: i,
      length: lengths[i],
      ...(withCoords ? { 'data/chunk_index': 0, 'data/file_index': fileOf(i) } : {}),
      'videos/observation.images.front/chunk_index': 0,
      'videos/observation.images.front/file_index': fileOf(i),
      'videos/observation.images.front/from_timestamp': i,
      'videos/observation.images.front/to_timestamp': i + 0.5,
      'videos/observation.image/chunk_index': 0,
      'videos/observation.image/file_index': 0,
      'videos/observation.image/from_timestamp': i * 2,
      'videos/observation.image/to_timestamp': i * 2 + 1,
    };
  }

  async function twoFileStore(withCoords = true): Promise<DatasetObjectStore> {
    const fields = withCoords
      ? EPISODE_FIELDS
      : Object.fromEntries(Object.entries(EPISODE_FIELDS).filter(([k]) => !k.startsWith('data/')));
    return memoryStore({
      'meta/episodes/chunk-000/file-000.parquet': await parquetBuffer(fields, [0, 1].map((i) => episodeRow(i, withCoords))),
      'meta/episodes/chunk-000/file-001.parquet': await parquetBuffer(fields, [2, 3].map((i) => episodeRow(i, withCoords))),
      'data/chunk-000/file-000.parquet': await parquetBuffer(FRAME_FIELDS, [...frameRows(0, 4, 29), ...frameRows(1, 6, 29)]),
      'data/chunk-000/file-001.parquet': await parquetBuffer(FRAME_FIELDS, [...frameRows(2, 5, 29), ...frameRows(3, 7, 29)]),
    });
  }

  it('reads a single-file chunk', async () => {
    const store = memoryStore({
      'meta/episodes/chunk-000/file-000.parquet': await parquetBuffer(EPISODE_FIELDS, [0, 1].map((i) => ({
        ...episodeRow(i),
        'data/file_index': 0,
      }))),
      'data/chunk-000/file-000.parquet': await parquetBuffer(FRAME_FIELDS, [...frameRows(0, 4, 29), ...frameRows(1, 6, 29)]),
    });
    const episodes = await readRemoteEpisodes(store, info, 30);
    expect(episodes.map((e) => e.frameCount)).toEqual([4, 6]);
    // keyed by the full feature key, the singular `observation.image` included
    expect(episodes[1].videoWindows).toEqual({
      'observation.images.front': { from: 1, to: 1.5, chunk: 0, file: 0 },
      'observation.image': { from: 2, to: 3, chunk: 0, file: 0 },
    });
    const page = await readRemoteFrames(store, info, 1, 30, PAGE);
    expect(page.total).toBe(6);
    expect(page.frames[0].observationState[0]).toBe(1000);
  });

  it('returns every episode of a chunk split over file-000 and file-001', async () => {
    const episodes = await readRemoteEpisodes(await twoFileStore(), info, 30);
    expect(episodes.map((e) => [e.index, e.frameCount])).toEqual([[0, 4], [1, 6], [2, 5], [3, 7]]);
    expect(episodes.reduce((n, e) => n + e.frameCount, 0)).toBe(info.total_frames);
    expect(episodes[3].videoWindows?.['observation.images.front'].file).toBe(1);
  });

  it('opens the one data file the episode row names', async () => {
    const page = await readRemoteFrames(await twoFileStore(), info, 3, 30, PAGE);
    expect(page.source).toBe('data/chunk-000/file-001.parquet');
    expect(page.total).toBe(7);
    expect(page.frames[6].observationState[0]).toBe(3006);
    expect(page.frames[0].observationState).toHaveLength(29);
  });

  it('scans the data files in order when the episode row has no coordinates', async () => {
    const page = await readRemoteFrames(await twoFileStore(false), info, 2, 30, PAGE);
    expect(page.source).toBe('data/chunk-000/file-001.parquet');
    expect(page.total).toBe(5);
  });

  it('404s an episode absent from meta/episodes', async () => {
    await expectReadError(readRemoteFrames(await twoFileStore(), info, 9, 30, PAGE), 404, /Episode frames not found.*not among the 4/);
  });

  it('names the data file an episode row points at when it is missing', async () => {
    const store = await twoFileStore();
    const holed: DatasetObjectStore = {
      read: (p) => (p === 'data/chunk-000/file-001.parquet' ? Promise.resolve(null) : store.read(p)),
      list: (p) => store.list(p),
    };
    await expectReadError(readRemoteFrames(holed, info, 2, 30, PAGE), 422, /file-001\.parquet is missing/);
  });

  it('fails without meta/episodes instead of inventing episodes from info.json', async () => {
    await expectReadError(readRemoteEpisodes(memoryStore({}), info, 30), 422, /meta\/episodes\/chunk-\*\/file-\*\.parquet is missing/);
  });
});

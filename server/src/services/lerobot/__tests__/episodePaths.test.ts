/**
 * @file episodePaths.test.ts
 * @description Where an episode's files are once a dataset has more than one chunk (TASK-479)
 * @feature datasets
 */

import { describe, it, expect } from 'vitest';
import {
  chunksSizeOf,
  episodeChunkOf,
  episodeDataCandidates,
  episodeDataPath,
  episodeVideoCandidates,
  formatPathTemplate,
} from '../episodePaths.js';

const DATA = 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet';
const VIDEO = 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4';
const KEY_FIRST = 'videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.mp4';

describe('chunksSizeOf / episodeChunkOf', () => {
  it('puts episode N in chunk floor(N / chunks_size)', () => {
    expect(episodeChunkOf({ chunks_size: 2 }, 0)).toBe(0);
    expect(episodeChunkOf({ chunks_size: 2 }, 1)).toBe(0);
    expect(episodeChunkOf({ chunks_size: 2 }, 2)).toBe(1);
    expect(episodeChunkOf({ chunks_size: 2 }, 5)).toBe(2);
  });

  it('defaults to 1000 episodes per chunk', () => {
    expect(chunksSizeOf(null)).toBe(1000);
    expect(chunksSizeOf({})).toBe(1000);
    expect(episodeChunkOf(null, 999)).toBe(0);
    expect(episodeChunkOf(undefined, 1000)).toBe(1);
    expect(episodeChunkOf({}, 2345)).toBe(2);
  });

  it('ignores a chunks_size that is not a positive number', () => {
    for (const bad of [0, -5, Number.NaN, 'many' as unknown as number]) {
      expect(chunksSizeOf({ chunks_size: bad })).toBe(1000);
    }
  });
});

describe('formatPathTemplate', () => {
  it('expands numbers with their padding and strings as they are', () => {
    expect(formatPathTemplate(VIDEO, { episode_chunk: 1, video_key: 'observation.images.top', episode_index: 1002 }))
      .toBe('videos/chunk-001/observation.images.top/episode_001002.mp4');
  });
});

describe('episodeDataPath', () => {
  it('follows chunks_size and the data_path template', () => {
    expect(episodeDataPath({ chunks_size: 2, data_path: DATA }, 3)).toBe('data/chunk-001/episode_000003.parquet');
    expect(episodeDataPath({ chunks_size: 2, data_path: 'd/c{episode_chunk}/e{episode_index}.parquet' }, 3))
      .toBe('d/c1/e3.parquet');
  });

  it('uses the standard path without a template, or with a v3.0 one', () => {
    expect(episodeDataPath(null, 1000)).toBe('data/chunk-001/episode_001000.parquet');
    expect(episodeDataPath({ data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet' }, 1000))
      .toBe('data/chunk-001/episode_001000.parquet');
  });
});

describe('episodeDataCandidates', () => {
  it('names the chunk of the episode first and chunk-000 last', () => {
    expect(episodeDataCandidates({ chunks_size: 2, data_path: DATA }, 2)).toEqual([
      'data/chunk-001/episode_000002.parquet',
      'data/chunk-000/episode_000002.parquet',
    ]);
  });

  it('is one path for an episode of the first chunk', () => {
    expect(episodeDataCandidates({ chunks_size: 2 }, 1)).toEqual(['data/chunk-000/episode_000001.parquet']);
  });

  it('drops a template that leaves the dataset directory', () => {
    for (const template of [
      '../../etc/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet',
      '/etc/episode_{episode_index:06d}.parquet',
      'data/../../episode_{episode_index:06d}.parquet',
      'data/{unknown}/episode_{episode_index:06d}.parquet',
    ]) {
      expect(episodeDataCandidates({ chunks_size: 2, data_path: template }, 2)).toEqual([
        'data/chunk-001/episode_000002.parquet',
        'data/chunk-000/episode_000002.parquet',
      ]);
    }
  });
});

describe('episodeVideoCandidates', () => {
  const key = 'observation.images.ego_view';

  it('tries the template, then both directory orders, in the chunk of the episode', () => {
    expect(episodeVideoCandidates({ chunks_size: 2, video_path: KEY_FIRST }, key, 4)).toEqual([
      `videos/${key}/chunk-002/episode_000004.mp4`,
      `videos/chunk-002/${key}/episode_000004.mp4`,
      `videos/chunk-000/${key}/episode_000004.mp4`,
      `videos/${key}/chunk-000/episode_000004.mp4`,
    ]);
  });

  it('tries both orders when info.json has no video_path', () => {
    expect(episodeVideoCandidates({ chunks_size: 1000, video_path: null }, key, 1000).slice(0, 2)).toEqual([
      `videos/chunk-001/${key}/episode_001000.mp4`,
      `videos/${key}/chunk-001/episode_001000.mp4`,
    ]);
  });

  it('is the two orders of chunk-000 for an episode of the first chunk', () => {
    expect(episodeVideoCandidates({ video_path: VIDEO }, key, 7)).toEqual([
      `videos/chunk-000/${key}/episode_000007.mp4`,
      `videos/${key}/chunk-000/episode_000007.mp4`,
    ]);
  });

  it('drops a template that leaves the dataset directory', () => {
    const paths = episodeVideoCandidates(
      { video_path: '../{video_key}/episode_{episode_index:06d}.mp4' }, key, 0,
    );
    expect(paths.every((p) => p.startsWith('videos/'))).toBe(true);
  });
});

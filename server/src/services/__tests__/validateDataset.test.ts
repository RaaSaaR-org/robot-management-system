/**
 * @file validateDataset.test.ts
 * @description One test per way a dataset can be broken, each asserting the
 *              SPECIFIC finding — a validator that fails everything for the
 *              wrong reason is no better than one that passes everything.
 * @feature training
 *
 * The fixtures are built here in TypeScript rather than shelled out to
 * `make_synthetic_dataset.py`, so these run on a machine with no python and no
 * pyarrow. The python generator writes the same shapes for the converter tests;
 * what is asserted here is what the SERVER sees, and building it in the
 * server's own parquet library is the honest way to test that.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ParquetSchema, ParquetWriter, ParquetFieldBuilder } from '@dsnp/parquetjs';
import { LocalDatasetTree } from '../lerobot/DatasetTree.js';
import type { DatasetTree } from '../lerobot/DatasetTree.js';
import { validateDatasetStructure } from '../lerobot/validateDataset.js';
import type { ValidationContext } from '../lerobot/validateDataset.js';

const STATE_DIM = 6;
const FPS = 10;
const EPISODES = [10, 11, 12];

let root: string;

/** Codes present in the report, so a test can name the one it means. */
function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

interface FixtureOptions {
  version?: 'v2.1' | 'v3.0';
  cameras?: string[];
  /** Write `observation.state` this many wide, whatever `features` declares. */
  stateWidth?: number;
  /** Add a column `features` does not declare. */
  undeclaredColumn?: boolean;
  /** Claim this many episodes in info.json regardless of what is written. */
  declaredEpisodes?: number;
  /** Skip writing the data parquet the manifest names. */
  omitData?: boolean;
  /** Write the camera mp4 as zero bytes. */
  emptyVideo?: boolean;
  /** Write no mp4 at all — what a metadata-only import leaves on disk. */
  omitVideos?: boolean;
  /**
   * v2.1: write the mp4s as `videos/<key>/chunk-000/episode_N.mp4` while
   * `info.json` still declares the chunk-first template.
   *
   * Not a corruption — it is what several real converters emit, and why
   * `alternateVideoPath` exists. It matters twice over now the tree is LISTED:
   * a file found under the other ordering has to count as accounted for, or
   * every dataset laid out this way collects an `UNEXPECTED_FILE` warning for
   * each of its videos.
   */
  keyFirstVideos?: boolean;
  /** v3.0: spread the episodes across this many data + video files in chunk-000. */
  splitFiles?: number;
  /** v3.0: skip writing `file-<n>` even though the metadata points at it. */
  omitSplitFile?: number;
  /** Claim more chunks in info.json than the tree actually has. */
  declaredChunks?: number;
  /** Declare the cameras as `dtype: 'image'` with `video_path: null`. */
  stillImages?: boolean;
  /** With `stillImages`, write no frames at all. */
  emptyImages?: boolean;
  /** Add this many frames to episode 0's `length` in the episode metadata only. */
  metaLengthBump?: number;
  /** Claim this many frames in info.json regardless of what is written. */
  declaredFrames?: number;
  /** Episode lengths, when the default three are not enough. */
  episodes?: number[];
  /**
   * Rows per row group in the data parquet.
   *
   * pyarrow — which is what lerobot writes with — puts a whole 100 MB data file
   * in ONE row group, so a reader that decodes "the first row group" decodes
   * the file. Setting this large reproduces that shape at test size.
   */
  rowGroupSize?: number;
  /**
   * One video camera AND one `dtype: 'image'` feature — an RGB stream recorded
   * as video next to a depth map stored as frames. `video_path` is non-null, so
   * this is the shape that isolates the dtype filter from it.
   */
  mixedMedia?: boolean;
}

async function writeDataParquet(
  path: string,
  perEpisode: number[],
  options: FixtureOptions,
): Promise<void> {
  const width = options.stateWidth ?? STATE_DIM;
  const fields: Record<string, unknown> = {
    'observation.state': ParquetFieldBuilder.createListField('FLOAT', false),
    action: ParquetFieldBuilder.createListField('FLOAT', false),
    timestamp: { type: 'FLOAT' },
    frame_index: { type: 'INT64' },
    episode_index: { type: 'INT64' },
    index: { type: 'INT64' },
    task_index: { type: 'INT64' },
  };
  if (options.undeclaredColumn) fields.next_done = { type: 'BOOLEAN' };
  const writer = await ParquetWriter.openFile(
    new ParquetSchema(fields as ConstructorParameters<typeof ParquetSchema>[0]),
    path,
  );
  if (options.rowGroupSize) writer.setRowGroupSize(options.rowGroupSize);
  const asList = (v: number[]) => ({ list: v.map((element) => ({ element })) });
  let index = 0;
  for (let ep = 0; ep < perEpisode.length; ep++) {
    for (let f = 0; f < perEpisode[ep]!; f++) {
      const vec = Array.from({ length: width }, (_, j) => Math.sin(f * 0.1 + j));
      const row: Record<string, unknown> = {
        'observation.state': asList(vec),
        action: asList(Array.from({ length: STATE_DIM }, (_, j) => Math.sin(f * 0.1 + j))),
        timestamp: f / FPS,
        frame_index: f,
        episode_index: ep,
        index: index++,
        task_index: 0,
      };
      if (options.undeclaredColumn) row.next_done = f === perEpisode[ep]! - 1;
      await writer.appendRow(row);
    }
  }
  await writer.close();
}

async function writeEpisodesParquet(
  path: string,
  perEpisode: number[],
  cameras: string[],
  fileOf: (ep: number) => number = () => 0,
  lengthBump = 0,
): Promise<void> {
  const fields: Record<string, unknown> = {
    episode_index: { type: 'INT64' },
    length: { type: 'INT64' },
    dataset_from_index: { type: 'INT64' },
    dataset_to_index: { type: 'INT64' },
    'data/chunk_index': { type: 'INT64' },
    'data/file_index': { type: 'INT64' },
  };
  for (const cam of cameras) {
    fields[`videos/${cam}/from_timestamp`] = { type: 'DOUBLE' };
    fields[`videos/${cam}/to_timestamp`] = { type: 'DOUBLE' };
    fields[`videos/${cam}/chunk_index`] = { type: 'INT64' };
    fields[`videos/${cam}/file_index`] = { type: 'INT64' };
  }
  const writer = await ParquetWriter.openFile(
    new ParquetSchema(fields as ConstructorParameters<typeof ParquetSchema>[0]),
    path,
  );
  let from = 0;
  let cursor = 0;
  for (let ep = 0; ep < perEpisode.length; ep++) {
    const length = perEpisode[ep]!;
    const file = fileOf(ep);
    const row: Record<string, unknown> = {
      episode_index: ep,
      length: ep === 0 ? length + lengthBump : length,
      dataset_from_index: from,
      dataset_to_index: from + length,
      'data/chunk_index': 0,
      'data/file_index': file,
    };
    for (const cam of cameras) {
      row[`videos/${cam}/from_timestamp`] = cursor;
      row[`videos/${cam}/to_timestamp`] = cursor + length / FPS;
      row[`videos/${cam}/chunk_index`] = 0;
      row[`videos/${cam}/file_index`] = file;
    }
    cursor += length / FPS;
    from += length;
    await writer.appendRow(row);
  }
  await writer.close();
}

/** A dataset on disk, sound unless an option says otherwise. */
async function fixture(name: string, options: FixtureOptions = {}): Promise<string> {
  const version = options.version ?? 'v3.0';
  const cameras = (options.cameras ?? ['cam_high']).map((c) => `observation.images.${c}`);
  const dir = join(root, name);
  const perEpisode = options.episodes ?? EPISODES;
  const totalFrames = perEpisode.reduce((a, b) => a + b, 0);
  await mkdir(join(dir, 'meta'), { recursive: true });
  await mkdir(join(dir, 'data', 'chunk-000'), { recursive: true });

  const features: Record<string, unknown> = {};
  const stillKey = 'observation.images.depth';
  if (options.mixedMedia) {
    features[stillKey] = { dtype: 'image', shape: [64, 64, 1], names: ['height', 'width', 'channel'] };
  }
  for (const cam of cameras) {
    features[cam] = {
      dtype: options.stillImages ? 'image' : 'video',
      shape: [64, 64, 3],
      names: ['height', 'width', 'channel'],
    };
  }
  features['observation.state'] = { dtype: 'float32', shape: [STATE_DIM], names: null };
  features.action = { dtype: 'float32', shape: [STATE_DIM], names: null };
  for (const k of ['timestamp']) features[k] = { dtype: 'float32', shape: [1], names: null };
  for (const k of ['frame_index', 'episode_index', 'index', 'task_index']) {
    features[k] = { dtype: 'int64', shape: [1], names: null };
  }

  const info = {
    codebase_version: version,
    robot_type: 'unitree_g1_edu_dex3',
    fps: FPS,
    total_episodes: options.declaredEpisodes ?? perEpisode.length,
    total_frames: options.declaredFrames ?? totalFrames,
    total_chunks: options.declaredChunks ?? 1,
    chunks_size: 1000,
    data_path: version === 'v3.0'
      ? 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet'
      : 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet',
    video_path: cameras.length && !options.stillImages
      ? (version === 'v3.0'
        ? 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4'
        : 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4')
      : null,
    features,
  };
  await writeFile(join(dir, 'meta', 'info.json'), JSON.stringify(info, null, 2));

  if (version === 'v3.0') {
    // One data file per `split` group, so `data/file_index` in the episode
    // metadata is the only thing that says where episode N's rows live — which
    // is the whole point of the v3.0 layout.
    const splits = Math.max(1, options.splitFiles ?? 1);
    const fileOf = (ep: number) => ep % splits;
    for (let file = 0; file < splits; file++) {
      if (options.omitData) continue;
      if (options.omitSplitFile === file) continue;
      const eps = perEpisode.map((n, ep) => (fileOf(ep) === file ? n : 0));
      await writeDataParquet(
        join(dir, 'data', 'chunk-000', `file-${String(file).padStart(3, '0')}.parquet`),
        eps, options,
      );
    }
    await mkdir(join(dir, 'meta', 'episodes', 'chunk-000'), { recursive: true });
    await writeEpisodesParquet(
      join(dir, 'meta', 'episodes', 'chunk-000', 'file-000.parquet'), perEpisode, cameras,
      fileOf, options.metaLengthBump ?? 0,
    );
    for (const cam of cameras) {
      if (options.stillImages) {
        if (options.emptyImages) continue;
        const dst = join(dir, 'images', cam, 'episode_000000');
        await mkdir(dst, { recursive: true });
        await writeFile(join(dst, 'frame_000000.png'), 'not really a png, but non-empty');
        continue;
      }
      if (options.omitVideos) continue;
      const dst = join(dir, 'videos', cam, 'chunk-000');
      await mkdir(dst, { recursive: true });
      for (let file = 0; file < splits; file++) {
        await writeFile(
          join(dst, `file-${String(file).padStart(3, '0')}.mp4`),
          options.emptyVideo ? '' : 'not really an mp4, but non-empty',
        );
      }
    }
  } else {
    for (let ep = 0; ep < perEpisode.length; ep++) {
      if (options.omitData && ep === 1) continue;
      await writeDataParquet(
        join(dir, 'data', 'chunk-000', `episode_${String(ep).padStart(6, '0')}.parquet`),
        [perEpisode[ep]!],
        options,
      );
    }
    const lines = perEpisode
      .map((length, ep) => JSON.stringify({ episode_index: ep, tasks: ['pick'], length }))
      .join('\n');
    await writeFile(join(dir, 'meta', 'episodes.jsonl'), `${lines}\n`);
    if (options.mixedMedia) {
      const dst = join(dir, 'images', stillKey, 'episode_000000');
      await mkdir(dst, { recursive: true });
      await writeFile(join(dst, 'frame_000000.png'), 'not really a png, but non-empty');
    }
    for (const cam of cameras) {
      if (options.omitVideos) continue;
      const dst = options.keyFirstVideos
        ? join(dir, 'videos', cam, 'chunk-000')
        : join(dir, 'videos', 'chunk-000', cam);
      await mkdir(dst, { recursive: true });
      for (let ep = 0; ep < perEpisode.length; ep++) {
        await writeFile(
          join(dst, `episode_${String(ep).padStart(6, '0')}.mp4`),
          options.emptyVideo && ep === 0 ? '' : 'not really an mp4, but non-empty',
        );
      }
    }
  }
  return dir;
}

async function validate(dir: string, expected = {}, context: ValidationContext = {}) {
  return validateDatasetStructure(new LocalDatasetTree(dir), expected, context);
}

/** What the validator asked the store for, per method (TASK-219). */
interface StoreCalls {
  stat: string[];
  list: string[];
  read: string[];
  readBytes: number;
  range: { path: string; offset: number; length: number }[];
}

/**
 * A tree that answers exactly like `LocalDatasetTree` and records the asking.
 *
 * The access pattern IS the behaviour under test here: "does it still find the
 * missing file" cannot distinguish 1500 HEADs from one listing, and "does it
 * still read the row count" cannot distinguish a footer read from pulling
 * 100 MB through the process.
 */
function spyTree(dir: string): { tree: DatasetTree; calls: StoreCalls } {
  const inner = new LocalDatasetTree(dir);
  const calls: StoreCalls = { stat: [], list: [], read: [], readBytes: 0, range: [] };
  const tree: DatasetTree = {
    kind: inner.kind,
    root: inner.root,
    async stat(path) {
      calls.stat.push(path);
      return inner.stat(path);
    },
    async read(path) {
      calls.read.push(path);
      const buffer = await inner.read(path);
      calls.readBytes += buffer.length;
      return buffer;
    },
    async readRange(path, offset, length) {
      calls.range.push({ path, offset, length });
      return inner.readRange(path, offset, length);
    },
    async list(prefix) {
      calls.list.push(prefix);
      return inner.list(prefix);
    },
  };
  return { tree, calls };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'validate-dataset-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a sound dataset', () => {
  it('passes, and says what it opened', async () => {
    const report = await validate(await fixture('good-v3'));
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.layout).toBe('v3');
    expect(report.episodeCount).toBe(3);
    expect(report.totalFrames).toBe(33);
    expect(report.totalDuration).toBeCloseTo(3.3, 6);
    expect(report.imageKeys).toEqual(['observation.images.cam_high']);
    // The point of the whole file: it opened files, and can list them.
    expect(report.files.map((f) => f.path)).toEqual(expect.arrayContaining([
      'meta/info.json',
      'meta/episodes/chunk-000/file-000.parquet',
      'data/chunk-000/file-000.parquet',
      'videos/observation.images.cam_high/chunk-000/file-000.mp4',
    ]));
  });

  it('passes a v2.1 dataset too — the format still on disk here', async () => {
    const report = await validate(await fixture('good-v21', { version: 'v2.1' }));
    expect(report.errors).toEqual([]);
    expect(report.layout).toBe('v2');
    expect(report.files.filter((f) => f.kind === 'data')).toHaveLength(3);
    expect(report.files.filter((f) => f.kind === 'video')).toHaveLength(3);
  });
});

describe('the failures that used to pass', () => {
  it('fails when info.json names a parquet that is not there', async () => {
    // The headline case. The previous validator confirmed `meta/info.json`
    // existed and four of its fields were present; it never once looked for a
    // file that file named, so this scored well and then failed at training.
    const report = await validate(await fixture('no-data', { omitData: true }));
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toContain('MISSING_DATA_FILE');
    expect(report.errors.find((e) => e.code === 'MISSING_DATA_FILE')!.message)
      .toContain('data/chunk-000/file-000.parquet');
  });

  it('fails a v2.1 dataset missing one episode of many', async () => {
    const report = await validate(await fixture('no-data-v21', { version: 'v2.1', omitData: true }));
    expect(codes(report.errors)).toContain('MISSING_DATA_FILE');
    expect(report.errors.find((e) => e.code === 'MISSING_DATA_FILE')!.message)
      .toContain('episode_000001.parquet');
  });

  it('fails a zero-byte video rather than reporting it as present', async () => {
    const report = await validate(await fixture('empty-video', { emptyVideo: true }));
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toContain('EMPTY_FILE');
  });

  it('fails when observation.state is not the width info.json declares', async () => {
    const report = await validate(await fixture('narrow-state', { stateWidth: STATE_DIM - 1 }));
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toContain('STATE_WIDTH_MISMATCH');
    expect(report.observedStateWidth).toBe(STATE_DIM - 1);
  });

  it('fails when observation.state disagrees with the ROBOT TYPE, not just the manifest', async () => {
    // A dataset can be internally consistent and still be the wrong shape for
    // the robot it claims. The error training produces names neither number.
    const report = await validate(await fixture('robot-dim'), {
      proprioceptionDim: 43,
      actionDim: 43,
    });
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toContain('ROBOT_STATE_DIM_MISMATCH');
    expect(codes(report.errors)).toContain('ROBOT_ACTION_DIM_MISMATCH');
    expect(report.errors.find((e) => e.code === 'ROBOT_STATE_DIM_MISMATCH')!.message)
      .toContain('43');
  });

  it('fails when the declared episode count disagrees with the episode metadata', async () => {
    const report = await validate(await fixture('ep-count', { declaredEpisodes: 4 }));
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toContain('EPISODE_COUNT_MISMATCH');
  });

  it('fails on a data column info.json does not declare', async () => {
    // lerobot casts the data parquet against `features`; an extra column is a
    // hard CastError and the dataset does not open at all. Every dataset the
    // episode recorder produced before TASK-215's review had exactly this and
    // no test noticed, because they all read it back with the library that
    // wrote it.
    const report = await validate(await fixture('extra-column', { undeclaredColumn: true }));
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toContain('UNDECLARED_COLUMN');
    expect(report.errors.find((e) => e.code === 'UNDECLARED_COLUMN')!.message).toContain('next_done');
  });
});

describe('the warning that would have saved a training run', () => {
  it('warns, loudly and by code, when the dataset has no camera at all', async () => {
    const report = await validate(await fixture('no-images', { cameras: [] }));
    // A warning, not an error: a state-only dataset is a legitimate thing to
    // hold. What it cannot do is train a vision-language-action policy, and
    // that used to surface hours later inside the training job.
    expect(report.valid).toBe(true);
    expect(codes(report.warnings)).toContain('NO_IMAGE_FEATURES');
    expect(report.imageKeys).toEqual([]);
    expect(report.warnings.find((w) => w.code === 'NO_IMAGE_FEATURES')!.message)
      .toContain('All image features are missing from the batch');
  });
});

describe('what it refuses to guess at', () => {
  it('reports a missing info.json as a missing file, not a crash', async () => {
    const dir = join(root, 'not-a-dataset');
    await mkdir(dir, { recursive: true });
    const report = await validate(dir);
    expect(report.valid).toBe(false);
    expect(codes(report.errors)).toEqual(['MISSING_INFO']);
    expect(report.layout).toBe('unknown');
  });

  it('reports unparseable JSON as unparseable JSON', async () => {
    const dir = join(root, 'bad-json');
    await mkdir(join(dir, 'meta'), { recursive: true });
    await writeFile(join(dir, 'meta', 'info.json'), '{ not json');
    const report = await validate(dir);
    expect(codes(report.errors)).toEqual(['BAD_INFO']);
  });

  it('stops at the missing fields rather than reporting every file as absent', async () => {
    // A manifest with no `features` cannot say which files should exist, so
    // continuing would produce a wall of misleading "missing file" errors under
    // the one real problem.
    const dir = join(root, 'empty-info');
    await mkdir(join(dir, 'meta'), { recursive: true });
    await writeFile(join(dir, 'meta', 'info.json'), JSON.stringify({ codebase_version: 'v3.0' }));
    const report = await validate(dir);
    expect(codes(report.errors)).toEqual(['MISSING_ROBOT_TYPE', 'MISSING_FPS', 'MISSING_FEATURES']);
  });
});

describe('v3.0 file enumeration', () => {
  // The first cut of this validator guessed the v3 file list from
  // `total_chunks`: one file per chunk, always named `file-000`. v3.0 does not
  // work that way — it names a template and then addresses each episode by
  // (chunk_index, file_index) in the episode metadata. These four are what
  // that guess got wrong.

  it('opens every data file the episode metadata points at, not just file-000', async () => {
    const report = await validate(await fixture('v3-split', { splitFiles: 3 }));
    expect(report.errors).toEqual([]);
    const data = report.files.filter((f) => f.kind === 'data').map((f) => f.path);
    expect(data).toEqual([
      'data/chunk-000/file-000.parquet',
      'data/chunk-000/file-001.parquet',
      'data/chunk-000/file-002.parquet',
    ]);
  });

  it('reports a missing file-001 — which the guess could never see', async () => {
    // The headline regression. Under the old enumeration this dataset passed:
    // `file-000` was present, nothing ever asked about `file-001`, and a third
    // of the frames were simply not there.
    const report = await validate(await fixture('v3-missing-1', {
      splitFiles: 3, omitSplitFile: 1,
    }));
    expect(codes(report.errors)).toContain('MISSING_DATA_FILE');
    expect(report.errors.some((e) => e.message.includes('file-001.parquet'))).toBe(true);
  });

  it('does not invent chunks info.json declares but the metadata never uses', async () => {
    // The other direction: `total_chunks: 4` on a dataset that keeps everything
    // in chunk-000 produced MISSING_DATA_FILE for three files it never claimed
    // to have, and marked a sound dataset `failed`.
    const report = await validate(await fixture('v3-overdeclared', { declaredChunks: 4 }));
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('checks each video file the metadata names, per camera', async () => {
    const report = await validate(await fixture('v3-split-video', { splitFiles: 2 }));
    const video = report.files.filter((f) => f.kind === 'video').map((f) => f.path);
    expect(video).toEqual([
      'videos/observation.images.cam_high/chunk-000/file-000.mp4',
      'videos/observation.images.cam_high/chunk-000/file-001.mp4',
    ]);
  });
});

describe('image features that are not video', () => {
  it('accepts a dtype:image dataset, which has no mp4 by design', async () => {
    // `imageKeys` lumped `dtype: 'image'` in with `dtype: 'video'` and then
    // demanded an mp4 for each — so every image-mode dataset, which is most of
    // what comes off the Hub, failed with MISSING_VIDEO_FILE for a file the
    // format never says exists.
    const report = await validate(await fixture('v3-stills', { stillImages: true }));
    expect(codes(report.errors)).not.toContain('MISSING_VIDEO_FILE');
    expect(report.errors).toEqual([]);
    // Still counted as a camera, so NO_IMAGE_FEATURES does not fire.
    expect(report.imageKeys).toEqual(['observation.images.cam_high']);
    expect(codes(report.warnings)).not.toContain('NO_IMAGE_FEATURES');
  });

  it('does not demand an mp4 for an image feature sitting next to a video one', async () => {
    // The case the `video_path === null` short-circuit does not cover: a v2.1
    // dataset with an RGB camera recorded as video AND a depth map stored as
    // frames. `video_path` is non-null, so only the dtype filter keeps the
    // depth key out of the mp4 list — without it the depth feature is asked
    // for `videos/chunk-000/observation.images.depth/episode_000000.mp4`,
    // which the format never says exists.
    const report = await validate(await fixture('v21-mixed', {
      version: 'v2.1', mixedMedia: true,
    }));
    expect(codes(report.errors)).not.toContain('MISSING_VIDEO_FILE');
    expect(report.errors).toEqual([]);
    expect(report.imageKeys).toContain('observation.images.depth');
  });

  it('but fails one whose images/ prefix is empty', async () => {
    const report = await validate(await fixture('v3-stills-empty', {
      stillImages: true, emptyImages: true,
    }));
    expect(codes(report.errors)).toContain('MISSING_IMAGE_FILES');
  });
});

describe('the frame count, cross-checked against the metadata', () => {
  it('catches a v3 manifest that disagrees with the episode lengths', async () => {
    // v3.0 had no metadata-side frame check at all: `metaFrames` stayed null,
    // and the only cross-check was against the data parquets — which is the
    // half that gets skipped on any dataset with more than 8 data files.
    const report = await validate(await fixture('v3-frames', { metaLengthBump: 5 }));
    expect(codes(report.errors)).toContain('FRAME_COUNT_MISMATCH');
    expect(report.errors.some((e) => e.message.includes('38'))).toBe(true);
  });

  it('does not record a partial row count as the dataset\'s frame total', async () => {
    // With more data files than it reads, the validator warned that the count
    // was partial and then wrote that partial count into `totalFrames` anyway,
    // which is the number the training split and the UI both then believe.
    const episodes = Array.from({ length: 12 }, (_, i) => 10 + i);
    const report = await validate(await fixture('v3-partial', {
      episodes, splitFiles: 12, declaredFrames: 0,
    }));
    expect(codes(report.warnings)).toContain('PARTIAL_ROW_COUNT');
    // The full 186 from the episode metadata, not the 8 files the read got to.
    expect(report.totalFrames).toBe(episodes.reduce((a, b) => a + b, 0));
  });
});

describe('a metadata-only import', () => {
  // The GR00T repo declares 402 mp4s. Imported without videos — which is what
  // `includeVideos: false`, the DEFAULT, asks for — the validator raised 402
  // MISSING_VIDEO_FILE errors and the row went to `failed`, for a dataset that
  // arrived exactly as ordered.

  it('is a warning naming the mode, not 402 errors', async () => {
    const dir = await fixture('v3-metadata-only', { omitVideos: true });
    const report = await validate(dir, {}, { importMode: 'metadata' });

    expect(codes(report.errors)).not.toContain('MISSING_VIDEO_FILE');
    expect(codes(report.warnings)).toContain('VIDEO_NOT_IMPORTED');
    // The mode is IN the message: whoever reads it has to be able to act on it
    // without going back to the row to find out what was asked for.
    expect(report.warnings.find((w) => w.code === 'VIDEO_NOT_IMPORTED')!.message)
      .toContain("importMode 'metadata'");
    expect(report.valid).toBe(true);
  });

  it('still fails a FULL import that is missing its videos', async () => {
    // The other half, and the reason this is not just "stop erroring on
    // missing mp4s": a full import with no video IS broken.
    const dir = await fixture('v3-full-no-video', { omitVideos: true });
    const report = await validate(dir, {}, { importMode: 'full' });

    expect(codes(report.errors)).toContain('MISSING_VIDEO_FILE');
    expect(codes(report.warnings)).not.toContain('VIDEO_NOT_IMPORTED');
    expect(report.valid).toBe(false);
  });

  it('treats an unknown provenance as a full import', async () => {
    // Every dataset registered before TASK-220 has a null importMode, and none
    // of them may quietly stop being checked.
    const dir = await fixture('v3-no-mode', { omitVideos: true });
    expect(codes((await validate(dir)).errors)).toContain('MISSING_VIDEO_FILE');
    expect(codes((await validate(dir, {}, { importMode: null })).errors))
      .toContain('MISSING_VIDEO_FILE');
  });
});

describe('a metadata-only import forgives the videos and NOTHING else', () => {
  // The failure mode of the fix itself. "Do not error on a missing mp4" is one
  // character away from "do not error on a missing file", and a metadata-only
  // import whose parquet never arrived has to stay a failure.

  it('still fails when the data parquet is absent', async () => {
    const dir = await fixture('meta-only-no-data', { omitVideos: true, omitData: true });
    const report = await validate(dir, {}, { importMode: 'metadata' });

    expect(codes(report.errors)).toContain('MISSING_DATA_FILE');
    expect(report.valid).toBe(false);
  });

  it('still fails when the data parquet is zero bytes', async () => {
    const dir = await fixture('meta-only-empty-data', { omitVideos: true });
    await writeFile(join(dir, 'data', 'chunk-000', 'file-000.parquet'), '');
    const report = await validate(dir, {}, { importMode: 'metadata' });

    expect(codes(report.errors)).toContain('EMPTY_FILE');
    expect(report.valid).toBe(false);
  });

  it('still fails when meta/info.json is absent', async () => {
    const dir = await fixture('meta-only-no-info', { omitVideos: true });
    await rm(join(dir, 'meta', 'info.json'));
    const report = await validate(dir, {}, { importMode: 'metadata' });

    expect(codes(report.errors)).toContain('MISSING_INFO');
    expect(report.valid).toBe(false);
  });

  it('still fails when the episode metadata is absent', async () => {
    const dir = await fixture('meta-only-no-episodes', { omitVideos: true });
    await rm(join(dir, 'meta', 'episodes'), { recursive: true });
    const report = await validate(dir, {}, { importMode: 'metadata' });

    expect(codes(report.errors)).toContain('MISSING_EPISODE_META');
    expect(report.valid).toBe(false);
  });

  it('applies to the v2.1 layout too, where the mp4s are per episode', async () => {
    const dir = await fixture('v21-metadata-only', { version: 'v2.1', omitVideos: true });
    const report = await validate(dir, {}, { importMode: 'metadata' });

    expect(codes(report.errors)).not.toContain('MISSING_VIDEO_FILE');
    expect(codes(report.warnings)).toContain('VIDEO_NOT_IMPORTED');
    expect(report.valid).toBe(true);
  });
});

describe('what it costs to check (TASK-219)', () => {
  // Both halves of this validator were correct and ruinous: the existence check
  // was one HEAD per file the manifest named, and the shape check pulled whole
  // parquets through the process. Neither shows up in a report — the only way
  // to pin them is to watch what the tree is asked for.

  const DATA_FILE = 'data/chunk-000/file-000.parquet';
  /** Everything a footer read touches lives in the first 4 bytes or the last of these. */
  const FOOTER_WINDOW = 64 * 1024;

  it('finds the files with two listings rather than one stat per file', async () => {
    const dir = await fixture('cost-v21-listing', { version: 'v2.1', episodes: [4, 4, 4, 4, 4] });
    const { tree, calls } = spyTree(dir);
    const report = await validateDatasetStructure(tree);

    expect(report.errors).toEqual([]);
    // Five episodes and one camera: ten files the manifest names, and not one
    // of them is stat'ed. `data` and `videos` are listed once each instead.
    expect(calls.stat.filter((p) => p.startsWith('data/') || p.startsWith('videos/'))).toEqual([]);
    expect(calls.list.filter((p) => p === 'data')).toHaveLength(1);
    expect(calls.list.filter((p) => p === 'videos')).toHaveLength(1);
  });

  it('reads a data parquet by its footer, not by its whole self', async () => {
    // 5000 rows so the file is comfortably bigger than the footer window: with
    // 33 rows every offset is "in the footer" and the assertion says nothing.
    const dir = await fixture('cost-v3-footer', { episodes: [5000], declaredFrames: 5000 });
    const size = (await stat(join(dir, DATA_FILE))).size;
    expect(size).toBeGreaterThan(FOOTER_WINDOW);

    const { tree, calls } = spyTree(dir);
    const report = await validateDatasetStructure(tree);

    expect(report.errors).toEqual([]);
    // It still learned everything it used to: the row count out of the footer…
    expect(report.totalFrames).toBe(5000);
    // …and the vector widths, which is the read that used to cost a row group.
    expect(report.observedStateWidth).toBe(STATE_DIM);
    expect(report.observedActionWidth).toBe(STATE_DIM);

    // Never pulled whole, and nothing outside the header and the footer was
    // fetched at all.
    expect(calls.read).not.toContain(DATA_FILE);
    const ranges = calls.range.filter((r) => r.path === DATA_FILE);
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.offset === 0 || range.offset >= size - FOOTER_WINDOW).toBe(true);
    }
  });

  it('does the same for a file whose first row group IS the whole file', async () => {
    // The shape that made this worth fixing: pyarrow writes one row group per
    // 100 MB data file, so "read the first row" read all of it.
    const dir = await fixture('cost-single-rowgroup', {
      episodes: [5000], declaredFrames: 5000, rowGroupSize: 100_000,
    });
    const size = (await stat(join(dir, DATA_FILE))).size;
    const { tree, calls } = spyTree(dir);
    const report = await validateDatasetStructure(tree);

    expect(report.errors).toEqual([]);
    expect(report.observedStateWidth).toBe(STATE_DIM);
    expect(calls.read).not.toContain(DATA_FILE);
    for (const range of calls.range.filter((r) => r.path === DATA_FILE)) {
      expect(range.offset === 0 || range.offset >= size - FOOTER_WINDOW).toBe(true);
    }
  });

  it('still catches a state vector of the wrong width', async () => {
    // The check the footer read must not quietly stop performing: a width read
    // from metadata that nothing compares is worth nothing.
    const report = await validate(await fixture('cost-narrow', {
      episodes: [200], declaredFrames: 200, stateWidth: STATE_DIM - 1,
    }));
    expect(report.observedStateWidth).toBe(STATE_DIM - 1);
    expect(codes(report.errors)).toContain('STATE_WIDTH_MISMATCH');
  });

  it('still says which parquet will not open', async () => {
    // A file that is not a parquet must fail the same way it did when it was
    // read whole: UNREADABLE_PARQUET, not a store outage and not a pass.
    const dir = await fixture('cost-not-a-parquet');
    await writeFile(join(dir, DATA_FILE), 'PAR1 not really a parquet');
    const report = await validate(dir);

    expect(codes(report.errors)).toContain('UNREADABLE_PARQUET');
    expect(report.valid).toBe(false);
  });
});

describe('a file the manifest never named', () => {
  // What the switch from HEADs to a listing makes newly possible. A HEAD can
  // only answer about a path someone already thought of, so an extra file on
  // the store was invisible. It is a warning, not an error — the dataset still
  // loads — but a data file nothing points at is frames that will not be
  // trained on while info.json reads as though they will.

  it('is reported as UNEXPECTED_FILE, with its path', async () => {
    const dir = await fixture('extra-file');
    await writeFile(join(dir, 'data', 'chunk-000', 'file-001.parquet'), 'left over from a re-export');
    const report = await validate(dir);

    expect(codes(report.warnings)).toContain('UNEXPECTED_FILE');
    expect(report.warnings.find((w) => w.code === 'UNEXPECTED_FILE')!.message)
      .toContain('data/chunk-000/file-001.parquet');
    // A warning: every file the manifest DOES name is there and readable.
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('covers videos/ as well as data/', async () => {
    const dir = await fixture('extra-video');
    await writeFile(
      join(dir, 'videos', 'observation.images.cam_high', 'chunk-000', 'file-009.mp4'),
      'an orphan',
    );
    const report = await validate(dir);

    expect(report.warnings.find((w) => w.code === 'UNEXPECTED_FILE')!.message)
      .toContain('videos/observation.images.cam_high/chunk-000/file-009.mp4');
    expect(report.valid).toBe(true);
  });

  it('says nothing about a sound dataset', async () => {
    // The failure mode of the warning itself. `expectedFiles` and the listing
    // have to agree exactly on a tree that IS complete, or every dataset in
    // this database picks up a warning nobody can act on.
    const v3 = await validate(await fixture('extra-none-v3', { splitFiles: 3 }));
    expect(codes(v3.warnings)).not.toContain('UNEXPECTED_FILE');

    const v21 = await validate(await fixture('extra-none-v21', { version: 'v2.1' }));
    expect(codes(v21.warnings)).not.toContain('UNEXPECTED_FILE');
  });

  it('says nothing about a v2.1 tree whose mp4s are keyed the other way round', async () => {
    // `videos/<key>/chunk-000/episode_N.mp4` against a manifest that declares
    // `videos/chunk-000/<key>/...`. The existence check has always accepted
    // either ordering, and now the listing has to as well: an mp4 found under
    // the alternate path is the one the manifest named, not a stray.
    const report = await validate(
      await fixture('extra-none-v21-keyfirst', { version: 'v2.1', keyFirstVideos: true }),
    );

    expect(codes(report.warnings)).not.toContain('UNEXPECTED_FILE');
    expect(report.errors).toEqual([]);
    // And it really did find them where they are, rather than skipping the
    // check: every episode's video is in the report, under its real path.
    expect(report.files.filter((f) => f.kind === 'video').map((f) => f.path)).toEqual([
      'videos/observation.images.cam_high/chunk-000/episode_000000.mp4',
      'videos/observation.images.cam_high/chunk-000/episode_000001.mp4',
      'videos/observation.images.cam_high/chunk-000/episode_000002.mp4',
    ]);
  });

  it('counts them rather than listing thousands', async () => {
    const dir = await fixture('extra-many');
    for (let i = 1; i <= 14; i++) {
      await writeFile(
        join(dir, 'data', 'chunk-000', `file-${String(i).padStart(3, '0')}.parquet`),
        'stray',
      );
    }
    const report = await validate(dir);

    expect(codes(report.warnings).filter((c) => c === 'UNEXPECTED_FILE')).toHaveLength(10);
    expect(report.warnings.find((w) => w.code === 'UNEXPECTED_FILE_COUNT')!.message)
      .toContain('14 files');
  });
});

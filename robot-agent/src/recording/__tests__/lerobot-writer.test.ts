/**
 * @file lerobot-writer.test.ts
 * @description The v3.0 tree: parquet columns and dtypes, the episode windows
 *              a viewer slices video by, info.json, stats.json, and a real mp4.
 * @feature recording
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { ParquetReader } from '@dsnp/parquetjs';
import {
  writeLeRobotV3,
  buildInfo,
  computeFeatureStats,
  LEROBOT_CODEBASE_VERSION,
  type WriterEpisode,
} from '../lerobot-writer.js';

const HAVE_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

const JOINTS = ['j0', 'j1', 'j2'];

function episode(index: number, frames: number, offset = 0): WriterEpisode {
  return {
    episodeIndex: index,
    task: 'pick up the block',
    dropped: index,
    wallDurationS: frames / 10,
    frames: Array.from({ length: frames }, (_, i) => ({
      state: [offset + i * 0.01, offset + i * 0.02, offset + i * 0.03],
      // Deliberately NOT the state: the commanded/measured distinction is the
      // point of the whole recorder.
      action: [offset + i * 0.01 + 0.5, offset + i * 0.02 + 0.5, offset + i * 0.03 + 0.5],
    })),
  };
}

async function readRows(path: string): Promise<Record<string, unknown>[]> {
  const reader = await ParquetReader.openFile(path);
  const cursor = reader.getCursor();
  const rows: Record<string, unknown>[] = [];
  let row: Record<string, unknown> | null;
  while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
    if (Object.keys(row).length === 0) break;
    rows.push(row);
  }
  await reader.close();
  return rows;
}

function listValues(cell: unknown): number[] {
  const list = (cell as { list?: { element?: number }[] })?.list ?? [];
  return list.map((e) => e.element ?? 0);
}

/** Real JPEGs, because ffmpeg is the thing under test on the video side. */
async function makeFrames(dir: string, count: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const res = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=64x48:rate=10`,
    '-frames:v', String(count),
    '-start_number', '0',
    join(dir, 'frame_%08d.jpg'),
  ]);
  if (res.status !== 0) throw new Error(`fixture ffmpeg failed: ${res.stderr?.toString()}`);
}

describe('computeFeatureStats', () => {
  it('is per column, not per row', () => {
    const stats = computeFeatureStats([
      [0, 10],
      [2, 20],
    ]);
    expect(stats.mean).toEqual([1, 15]);
    expect(stats.min).toEqual([0, 10]);
    expect(stats.max).toEqual([2, 20]);
  });

  it('never returns a zero std, so a constant column cannot divide by zero downstream', () => {
    const stats = computeFeatureStats([[5], [5], [5]]);
    expect(stats.std[0]).toBeGreaterThan(0);
    expect(stats.std[0]).toBeLessThan(1e-6);
  });

  it('survives an empty input rather than producing NaN', () => {
    const stats = computeFeatureStats([]);
    expect(stats.mean).toEqual([]);
    expect(stats.min).toEqual([]);
  });
});

describe('buildInfo', () => {
  const base = {
    robotType: 'Unitree_G1_Dex3',
    jointNames: JOINTS,
    fps: 19.7,
    totalEpisodes: 2,
    totalFrames: 30,
  };

  it('declares v3.0 and the v3 path templates', () => {
    const info = buildInfo({ ...base, cameras: [{ key: 'cam_right_high', framesDir: '', width: 640, height: 480 }] });
    expect(info.codebase_version).toBe(LEROBOT_CODEBASE_VERSION);
    // The placeholders lerobot's own CHUNK_FILE_PATTERN formats. The v2.1
    // spelling (`episode_chunk`/`episode_file`) raises KeyError the moment it
    // looks for a file, so this assertion is the template's whole contract.
    expect(info.data_path).toBe('data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet');
    expect(info.video_path).toBe(
      'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
    );
  });

  it('writes the MEASURED fps, decimals and all', () => {
    const info = buildInfo({ ...base, cameras: [] });
    expect(info.fps).toBe(19.7);
  });

  it('marks a camera with dtype video — the v3 spelling, not video:true', () => {
    const info = buildInfo({
      ...base,
      cameras: [{ key: 'cam_right_high', framesDir: '', width: 640, height: 480 }],
    });
    const feature = (info.features as Record<string, Record<string, unknown>>)[
      'observation.images.cam_right_high'
    ];
    expect(feature.dtype).toBe('video');
    expect(feature.shape).toEqual([480, 640, 3]);
    expect(feature.names).toEqual(['height', 'width', 'channel']);
    expect((feature.info as Record<string, unknown>)['video.fps']).toBe(19.7);
  });

  it('gives state and action the joint names and the same width', () => {
    const features = buildInfo({ ...base, cameras: [] }).features as Record<
      string,
      Record<string, unknown>
    >;
    expect(features['observation.state'].shape).toEqual([3]);
    expect(features['action'].shape).toEqual([3]);
    expect(features['observation.state'].names).toEqual(JOINTS);
  });

  it('declares the scalar columns too, one feature per parquet column', () => {
    const features = buildInfo({ ...base, cameras: [] }).features as Record<string, unknown>;
    for (const name of ['timestamp', 'frame_index', 'episode_index', 'index', 'task_index']) {
      expect(features[name]).toBeDefined();
    }
  });

  it('has no video_path when nothing filmed', () => {
    expect(buildInfo({ ...base, cameras: [] }).video_path).toBeNull();
  });
});

describe('writeLeRobotV3 refuses what cannot be a dataset', () => {
  it('refuses when every episode is empty', async () => {
    await expect(
      writeLeRobotV3({
        root: join(tmpdir(), 'never-created'),
        robotType: 'x',
        jointNames: JOINTS,
        fps: 30,
        episodes: [{ episodeIndex: 0, task: 't', frames: [], dropped: 0, wallDurationS: 0 }],
        cameras: [],
      }),
    ).rejects.toThrow(/every episode is empty/);
    expect(existsSync(join(tmpdir(), 'never-created'))).toBe(false);
  });

  it('refuses a frame whose width disagrees with the layout', async () => {
    await expect(
      writeLeRobotV3({
        root: join(tmpdir(), 'never-created-2'),
        robotType: 'x',
        jointNames: JOINTS,
        fps: 30,
        episodes: [
          {
            episodeIndex: 0,
            task: 't',
            dropped: 0,
            wallDurationS: 1,
            frames: [{ state: [1, 2], action: [1, 2] }],
          },
        ],
        cameras: [],
      }),
    ).rejects.toThrow(/width 2\/2, expected 3/);
  });

  it('refuses a non-positive fps', async () => {
    await expect(
      writeLeRobotV3({
        root: join(tmpdir(), 'never-created-3'),
        robotType: 'x',
        jointNames: JOINTS,
        fps: 0,
        episodes: [episode(0, 2)],
        cameras: [],
      }),
    ).rejects.toThrow(/fps must be positive/);
  });
});

describe.skipIf(!HAVE_FFMPEG)('writeLeRobotV3 produces a v3.0 tree', () => {
  let dir: string;
  let root: string;
  const FPS = 10;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lerobot-writer-'));
    root = join(dir, 'dataset');
    const framesDir = join(dir, 'seq', 'cam_right_high');
    await makeFrames(framesDir, 9); // 4 + 5
    await writeLeRobotV3({
      root,
      robotType: 'Unitree_G1_Dex3',
      jointNames: JOINTS,
      fps: FPS,
      episodes: [episode(0, 4), episode(1, 5, 10)],
      cameras: [{ key: 'cam_right_high', framesDir, width: 64, height: 48 }],
      provenance: { scene: 'g1_dex3_house_scene.xml', simulated: true },
    });
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lays the tree out where a v3.0 reader looks', () => {
    for (const rel of [
      'data/chunk-000/file-000.parquet',
      'meta/episodes/chunk-000/file-000.parquet',
      'meta/episodes.jsonl',
      'meta/episodes.json',
      'meta/tasks.jsonl',
      'meta/tasks.parquet',
      'meta/info.json',
      'meta/stats.json',
      'videos/observation.images.cam_right_high/chunk-000/file-000.mp4',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
  });

  it('writes one row per frame, with a global index and a per-episode frame index', async () => {
    const rows = await readRows(join(root, 'data/chunk-000/file-000.parquet'));
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => Number(r.index))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.map((r) => Number(r.frame_index))).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4]);
    expect(rows.map((r) => Number(r.episode_index))).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it('keeps action and observation.state apart', async () => {
    const rows = await readRows(join(root, 'data/chunk-000/file-000.parquet'));
    for (const row of rows) {
      const state = listValues(row['observation.state']);
      const action = listValues(row['action']);
      expect(state).toHaveLength(3);
      expect(action).toHaveLength(3);
      expect(action).not.toEqual(state);
    }
  });

  it('re-bases timestamps per episode, at the fps it declares', async () => {
    const rows = await readRows(join(root, 'data/chunk-000/file-000.parquet'));
    expect(Number(rows[0]!.timestamp)).toBeCloseTo(0, 5);
    expect(Number(rows[3]!.timestamp)).toBeCloseTo(3 / FPS, 4);
    expect(Number(rows[4]!.timestamp)).toBeCloseTo(0, 5); // episode 1 restarts
  });

  it('writes no column that info.json does not declare', async () => {
    // lerobot loads the data parquet by CASTING it to a schema built from
    // `info.json.features`. A column in the file that is not in `features` is a
    // hard CastError and the dataset does not open at all — which is how a
    // stray `next_done`, copied from the v2.1 exporter, made every dataset this
    // writer produced unloadable.
    const rows = await readRows(join(root, 'data/chunk-000/file-000.parquet'));
    const info = JSON.parse(await readFile(join(root, 'meta/info.json'), 'utf-8'));
    const declared = new Set(Object.keys(info.features));
    for (const column of Object.keys(rows[0]!)) {
      expect(declared.has(column), `column ${column} is not declared in info.json`).toBe(true);
    }
  });

  it('carries the retargeting label on the EPISODES parquet, never on the data one', async () => {
    // Two different constraints, twenty lines apart in the writer. The data
    // parquet is CAST against `info.json.features` and a column features does
    // not declare is a hard CastError; the episodes parquet is not cast, which
    // is why `dropped_frames`, `wall_duration_s` and now `retarget_modes` can
    // live there at all. Putting this one in the wrong file makes every dataset
    // unopenable, and the two files are written by the same loop.
    const episodes = await readRows(join(root, 'meta/episodes/chunk-000/file-000.parquet'));
    expect(episodes[0]!).toHaveProperty('retarget_modes');
    const data = await readRows(join(root, 'data/chunk-000/file-000.parquet'));
    expect(data[0]!).not.toHaveProperty('retarget_modes');
  });

  it('gives every episode the coordinates lerobot finds its parquet by', async () => {
    // `get_data_file_path` reads these two and formats `data_path` with them.
    const rows = await readRows(join(root, 'meta/episodes/chunk-000/file-000.parquet'));
    for (const row of rows) {
      expect(Number(row['data/chunk_index'])).toBe(0);
      expect(Number(row['data/file_index'])).toBe(0);
      expect(Number(row['meta/episodes/chunk_index'])).toBe(0);
      expect(Number(row['meta/episodes/file_index'])).toBe(0);
    }
  });

  it('gives each episode the video window a viewer slices by', async () => {
    const rows = await readRows(join(root, 'meta/episodes/chunk-000/file-000.parquet'));
    const p = 'videos/observation.images.cam_right_high';
    expect(rows).toHaveLength(2);
    expect(Number(rows[0]![`${p}/from_timestamp`])).toBeCloseTo(0, 5);
    expect(Number(rows[0]![`${p}/to_timestamp`])).toBeCloseTo(4 / FPS, 5);
    expect(Number(rows[1]![`${p}/from_timestamp`])).toBeCloseTo(4 / FPS, 5);
    expect(Number(rows[1]![`${p}/to_timestamp`])).toBeCloseTo(9 / FPS, 5);
    expect(Number(rows[0]![`${p}/chunk_index`])).toBe(0);
    expect(Number(rows[0]![`${p}/file_index`])).toBe(0);
  });

  it('records the row range of each episode inside the aggregated parquet', async () => {
    const rows = await readRows(join(root, 'meta/episodes/chunk-000/file-000.parquet'));
    expect([Number(rows[0]!.dataset_from_index), Number(rows[0]!.dataset_to_index)]).toEqual([0, 4]);
    expect([Number(rows[1]!.dataset_from_index), Number(rows[1]!.dataset_to_index)]).toEqual([4, 9]);
  });

  it('keeps the drop count next to the episode it happened in', async () => {
    const rows = await readRows(join(root, 'meta/episodes/chunk-000/file-000.parquet'));
    expect(rows.map((r) => Number(r.dropped_frames))).toEqual([0, 1]);
    const lines = (await readFile(join(root, 'meta/episodes.jsonl'), 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.length)).toEqual([4, 5]);
    expect(lines.map((l) => l.dropped_frames)).toEqual([0, 1]);
  });

  it('writes an info.json that matches what is on disk', async () => {
    const info = JSON.parse(await readFile(join(root, 'meta/info.json'), 'utf-8'));
    expect(info.total_episodes).toBe(2);
    expect(info.total_frames).toBe(9);
    expect(info.fps).toBe(FPS);
    expect(info.splits).toEqual({ train: '0:2' });
    expect(info.features['observation.images.cam_right_high'].shape).toEqual([48, 64, 3]);
    expect(info._neodem.scene).toBe('g1_dex3_house_scene.xml');
  });

  it('writes stats for state and action over every frame', async () => {
    const stats = JSON.parse(await readFile(join(root, 'meta/stats.json'), 'utf-8'));
    expect(stats['observation.state'].mean).toHaveLength(3);
    expect(stats['action'].mean).toHaveLength(3);
    expect(stats['action'].mean[0]).toBeGreaterThan(stats['observation.state'].mean[0]);
  });

  it('produces an mp4 with as many frames as the parquet has rows', async () => {
    const mp4 = join(root, 'videos/observation.images.cam_right_high/chunk-000/file-000.mp4');
    expect((await stat(mp4)).size).toBeGreaterThan(0);
    const probe = spawnSync('ffprobe', [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames',
      '-of', 'csv=p=0',
      mp4,
    ]);
    if (probe.status === 0) {
      expect(parseInt(probe.stdout.toString().trim(), 10)).toBe(9);
    }
  });

  it('keys tasks.parquet by the instruction, not by a row number', async () => {
    // lerobot reads the sentence off the parquet's INDEX
    // (`self.meta.tasks.iloc[task_idx].name`). Written as two ordinary columns,
    // `.name` is the row number, and every sample handed to a
    // language-conditioned policy carries `task = 0` instead of the sentence.
    const jsonl = (await readFile(join(root, 'meta/tasks.jsonl'), 'utf-8')).trim();
    expect(JSON.parse(jsonl)).toEqual({ task_index: 0, task: 'pick up the block' });

    const rows = await readRows(join(root, 'meta/tasks.parquet'));
    expect(rows).toEqual([{ task_index: 0n, __index_level_0__: 'pick up the block' }]);

    // …and the pandas metadata without which `read_parquet` gives back an
    // ordinary column called `__index_level_0__` and a RangeIndex.
    const reader = await ParquetReader.openFile(join(root, 'meta/tasks.parquet'));
    const meta = JSON.parse(String(reader.metadata?.key_value_metadata
      ?.find((kv: { key: string }) => kv.key === 'pandas')?.value ?? '{}'));
    await reader.close();
    expect(meta.index_columns).toEqual(['__index_level_0__']);
  });
});

describe.skipIf(!HAVE_FFMPEG)('discarded episodes leave no hole', () => {
  it('re-indexes densely so splits does not lie', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lerobot-writer-gap-'));
    try {
      const root = join(dir, 'dataset');
      const framesDir = join(dir, 'seq', 'cam_right_high');
      await makeFrames(framesDir, 5);
      // Episode 1 was discarded by the operator: it arrives empty, between two
      // that survived.
      await writeLeRobotV3({
        root,
        robotType: 'x',
        jointNames: JOINTS,
        fps: 10,
        episodes: [
          episode(0, 2),
          { episodeIndex: 1, task: 't', frames: [], dropped: 0, wallDurationS: 0 },
          episode(2, 3),
        ],
        cameras: [{ key: 'cam_right_high', framesDir, width: 64, height: 48 }],
      });
      const info = JSON.parse(await readFile(join(root, 'meta/info.json'), 'utf-8'));
      expect(info.total_episodes).toBe(2);
      expect(info.splits).toEqual({ train: '0:2' });
      const rows = await readRows(join(root, 'data/chunk-000/file-000.parquet'));
      expect([...new Set(rows.map((r) => Number(r.episode_index)))]).toEqual([0, 1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

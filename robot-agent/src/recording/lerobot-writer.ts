/**
 * @file lerobot-writer.ts
 * @description Writes a LeRobot **v3.0** dataset tree: aggregated parquet, one
 *              mp4 per camera, and the meta/ files a v3.0 reader needs.
 * @feature recording
 * @status live
 */

import { mkdir, writeFile, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { ParquetSchema, ParquetWriter, ParquetFieldBuilder } from '@dsnp/parquetjs';

/** v3.0 aggregates; v2.1 is one file per episode. See TASK-217 for the bridge. */
export const LEROBOT_CODEBASE_VERSION = 'v3.0';

/** Episodes per chunk. One chunk is enough for anything a person records by hand. */
export const CHUNKS_SIZE = 1000;

export interface WriterFrame {
  /** Layout-order measured pose. */
  state: number[];
  /** Layout-order commanded pose. Different array, on purpose. */
  action: number[];
}

export interface WriterEpisode {
  episodeIndex: number;
  task: string;
  frames: WriterFrame[];
  /** Ticks the recorder wanted and did not get. Reported, never interpolated. */
  dropped: number;
  /** Wall seconds the episode really took, for the summary and provenance. */
  wallDurationS: number;
}

export interface WriterCamera {
  /** Dataset key, without the `observation.images.` prefix. */
  key: string;
  /** Directory of `frame_%08d.jpg`, numbered from 0 across the WHOLE dataset. */
  framesDir: string;
  width: number;
  height: number;
}

export interface WriteDatasetOptions {
  /** Directory to create. Must not already hold a dataset. */
  root: string;
  /** LeRobot `robot_type`, e.g. `Unitree_G1_Dex3`. */
  robotType: string;
  /** Ordered joint names — the `names` of `observation.state` and `action`. */
  jointNames: readonly string[];
  /** The fps actually achieved. Declared fps is a lie the timestamps inherit. */
  fps: number;
  episodes: WriterEpisode[];
  cameras: WriterCamera[];
  /** Merged into `info.json` under `_neodem`; never read by LeRobot. */
  provenance?: Record<string, unknown>;
  /** Override for tests. */
  ffmpegPath?: string;
}

export interface WriteDatasetResult {
  root: string;
  totalEpisodes: number;
  totalFrames: number;
  /** Full feature names, e.g. `observation.images.cam_right_high`. */
  videoFeatures: string[];
  /** True when at least one image feature was written. */
  hasVideo: boolean;
}

export class FfmpegMissingError extends Error {
  readonly code = 'FFMPEG_MISSING';
  constructor(bin: string) {
    super(
      `ffmpeg not found (tried "${bin}"). An episode without video is not a ` +
        `dataset a VLA can train on — install ffmpeg or record with no cameras.`,
    );
    this.name = 'FfmpegMissingError';
  }
}

export class VideoEncodeError extends Error {
  readonly code = 'VIDEO_ENCODE_FAILED';
  constructor(key: string, detail: string) {
    super(`encoding ${key} failed: ${detail}`);
    this.name = 'VideoEncodeError';
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const chunk = (n: number): string => `chunk-${String(n).padStart(3, '0')}`;
const file = (n: number): string => `file-${String(n).padStart(3, '0')}`;

export const DATA_PATH_TEMPLATE = 'data/chunk-{episode_chunk:03d}/file-{episode_file:03d}.parquet';
export const VIDEO_PATH_TEMPLATE = 'videos/{video_key}/chunk-{episode_chunk:03d}/file-{file_index:03d}.mp4';

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface FeatureStats {
  mean: number[];
  std: number[];
  min: number[];
  max: number[];
}

/**
 * Per-column mean/std/min/max. `+1e-8` on std matches
 * `server/curation/neural_traj/convert.py:197` — a column that never moves
 * would otherwise normalise to a division by zero downstream.
 */
export function computeFeatureStats(rows: readonly number[][]): FeatureStats {
  const width = rows[0]?.length ?? 0;
  const mean = new Array(width).fill(0);
  const min = new Array(width).fill(Number.POSITIVE_INFINITY);
  const max = new Array(width).fill(Number.NEGATIVE_INFINITY);
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const v = row[i] ?? 0;
      mean[i] += v;
      if (v < min[i]) min[i] = v;
      if (v > max[i]) max[i] = v;
    }
  }
  const n = Math.max(1, rows.length);
  for (let i = 0; i < width; i++) mean[i] /= n;

  const std = new Array(width).fill(0);
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const d = (row[i] ?? 0) - mean[i];
      std[i] += d * d;
    }
  }
  for (let i = 0; i < width; i++) std[i] = Math.sqrt(std[i] / n) + 1e-8;

  return {
    mean,
    std,
    min: min.map((v) => (Number.isFinite(v) ? v : 0)),
    max: max.map((v) => (Number.isFinite(v) ? v : 0)),
  };
}

// ---------------------------------------------------------------------------
// info.json
// ---------------------------------------------------------------------------

export interface BuildInfoOptions {
  robotType: string;
  jointNames: readonly string[];
  fps: number;
  totalEpisodes: number;
  totalFrames: number;
  cameras: readonly WriterCamera[];
  provenance?: Record<string, unknown>;
}

/**
 * The v3.0 `meta/info.json`.
 *
 * Two things here that `LeRobotExportService` does not write and a v3.0 reader
 * needs: a `video_path` template, and a feature block per camera with
 * `dtype: 'video'` (v3's marker — `video: true` is the v1/v2 spelling). The
 * scalar columns get feature entries too; `lerobot` expects one per parquet
 * column.
 */
export function buildInfo(options: BuildInfoOptions): Record<string, unknown> {
  const dim = options.jointNames.length;
  const names = [...options.jointNames];

  const features: Record<string, unknown> = {};
  for (const cam of options.cameras) {
    features[`observation.images.${cam.key}`] = {
      dtype: 'video',
      shape: [cam.height, cam.width, 3],
      names: ['height', 'width', 'channel'],
      info: {
        'video.fps': options.fps,
        'video.height': cam.height,
        'video.width': cam.width,
        'video.channels': 3,
        'video.codec': 'h264',
        'video.pix_fmt': 'yuv420p',
        'video.is_depth_map': false,
        has_audio: false,
      },
    };
  }
  features['observation.state'] = { dtype: 'float32', shape: [dim], names };
  features['action'] = { dtype: 'float32', shape: [dim], names };
  for (const scalar of ['timestamp'] as const) {
    features[scalar] = { dtype: 'float32', shape: [1], names: null };
  }
  for (const scalar of ['frame_index', 'episode_index', 'index', 'task_index'] as const) {
    features[scalar] = { dtype: 'int64', shape: [1], names: null };
  }

  const info: Record<string, unknown> = {
    codebase_version: LEROBOT_CODEBASE_VERSION,
    robot_type: options.robotType,
    fps: options.fps,
    total_episodes: options.totalEpisodes,
    total_frames: options.totalFrames,
    total_tasks: 1,
    total_videos: options.cameras.length,
    total_chunks: Math.max(1, Math.ceil(options.totalEpisodes / CHUNKS_SIZE)),
    chunks_size: CHUNKS_SIZE,
    data_path: DATA_PATH_TEMPLATE,
    video_path: options.cameras.length > 0 ? VIDEO_PATH_TEMPLATE : null,
    splits: { train: `0:${options.totalEpisodes}` },
    features,
  };
  if (options.provenance) info._neodem = options.provenance;
  return info;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

async function runFfmpeg(bin: string, args: string[], key: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ENOENT' ? new FfmpegMissingError(bin) : err);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new VideoEncodeError(key, `ffmpeg exited ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

/**
 * One mp4 per camera holding every episode back to back, which is what v3.0's
 * `from_timestamp`/`to_timestamp` windows address into.
 *
 * The JPEG sequence must be contiguous from `frame_00000000.jpg`: a gap ends
 * the encode early and silently, which is why a tick where any camera failed is
 * dropped WHOLE rather than leaving a hole in one stream.
 */
async function encodeCamera(
  cam: WriterCamera,
  fps: number,
  root: string,
  ffmpegPath: string,
): Promise<void> {
  const outDir = join(root, 'videos', `observation.images.${cam.key}`, chunk(0));
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `${file(0)}.mp4`);
  await runFfmpeg(
    ffmpegPath,
    [
      '-y',
      '-loglevel', 'error',
      '-framerate', String(fps),
      '-start_number', '0',
      '-i', join(cam.framesDir, 'frame_%08d.jpg'),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      out,
    ],
    cam.key,
  );
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

/**
 * Write the whole tree. Throws before touching `root` if the input cannot make
 * a valid dataset — an empty dataset directory that looks finished is worse
 * than a failure with a reason.
 */
export async function writeLeRobotV3(options: WriteDatasetOptions): Promise<WriteDatasetResult> {
  const kept = options.episodes.filter((e) => e.frames.length > 0);
  if (kept.length === 0) throw new Error('nothing to write: every episode is empty');
  if (!(options.fps > 0)) throw new Error(`fps must be positive, got ${options.fps}`);
  const dim = options.jointNames.length;
  for (const ep of kept) {
    for (const f of ep.frames) {
      if (f.state.length !== dim || f.action.length !== dim) {
        throw new Error(
          `episode ${ep.episodeIndex} has a frame of width ${f.state.length}/${f.action.length}, expected ${dim}`,
        );
      }
    }
  }

  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const root = options.root;
  await mkdir(join(root, 'data', chunk(0)), { recursive: true });
  await mkdir(join(root, 'meta', 'episodes', chunk(0)), { recursive: true });

  // Re-index episodes densely: a discarded episode must not leave a hole that
  // `splits: 0:N` then lies about.
  const episodes = kept.map((ep, i) => ({ ...ep, episodeIndex: i }));
  const task = episodes[0]?.task ?? 'teleoperation';

  // ---- data parquet -------------------------------------------------------
  const dataSchema = new ParquetSchema({
    'observation.state': ParquetFieldBuilder.createListField('FLOAT', false),
    action: ParquetFieldBuilder.createListField('FLOAT', false),
    timestamp: { type: 'FLOAT' },
    frame_index: { type: 'INT64' },
    episode_index: { type: 'INT64' },
    index: { type: 'INT64' },
    task_index: { type: 'INT64' },
    next_done: { type: 'BOOLEAN' },
  });
  const dataWriter = await ParquetWriter.openFile(
    dataSchema,
    join(root, 'data', chunk(0), `${file(0)}.parquet`),
  );
  const asList = (v: number[]) => ({ list: v.map((element) => ({ element })) });

  const episodeRanges: { from: number; to: number }[] = [];
  let globalIndex = 0;
  for (const ep of episodes) {
    const from = globalIndex;
    for (let i = 0; i < ep.frames.length; i++) {
      const f = ep.frames[i]!;
      await dataWriter.appendRow({
        'observation.state': asList(f.state),
        action: asList(f.action),
        // Uniform, from the MEASURED fps — the same convention
        // `curation/neural_traj/convert.py` uses, and the one that makes a row
        // land on the video frame it was taken from. Real wall duration is
        // reported per episode instead of smuggled in here.
        timestamp: Math.round((i / options.fps) * 1e6) / 1e6,
        frame_index: i,
        episode_index: ep.episodeIndex,
        index: globalIndex,
        task_index: 0,
        next_done: i === ep.frames.length - 1,
      });
      globalIndex += 1;
    }
    episodeRanges.push({ from, to: globalIndex });
  }
  await dataWriter.close();
  const totalFrames = globalIndex;

  // ---- videos -------------------------------------------------------------
  for (const cam of options.cameras) {
    await encodeCamera(cam, options.fps, root, ffmpegPath);
  }

  // ---- episodes parquet ---------------------------------------------------
  const episodeFields: Record<string, unknown> = {
    episode_index: { type: 'INT64' },
    length: { type: 'INT64' },
    tasks: { type: 'UTF8', repeated: true },
    dataset_from_index: { type: 'INT64' },
    dataset_to_index: { type: 'INT64' },
    // Not LeRobot's: what the recorder could not get, kept next to the episode
    // it happened in rather than in a log nobody reads.
    dropped_frames: { type: 'INT64' },
    wall_duration_s: { type: 'FLOAT' },
  };
  for (const cam of options.cameras) {
    const p = `videos/observation.images.${cam.key}`;
    // Flat column names with literal slashes — `datasets.routes.ts:868-878`
    // string-matches on exactly this, and it is what LeRobot writes.
    episodeFields[`${p}/from_timestamp`] = { type: 'DOUBLE' };
    episodeFields[`${p}/to_timestamp`] = { type: 'DOUBLE' };
    episodeFields[`${p}/chunk_index`] = { type: 'INT64' };
    episodeFields[`${p}/file_index`] = { type: 'INT64' };
  }
  const epWriter = await ParquetWriter.openFile(
    new ParquetSchema(episodeFields as never),
    join(root, 'meta', 'episodes', chunk(0), `${file(0)}.parquet`),
  );
  let videoCursor = 0;
  const episodeLines: Record<string, unknown>[] = [];
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!;
    const range = episodeRanges[i]!;
    const fromTs = videoCursor / options.fps;
    const toTs = (videoCursor + ep.frames.length) / options.fps;
    videoCursor += ep.frames.length;

    const row: Record<string, unknown> = {
      episode_index: ep.episodeIndex,
      length: ep.frames.length,
      tasks: [ep.task],
      dataset_from_index: range.from,
      dataset_to_index: range.to,
      dropped_frames: ep.dropped,
      wall_duration_s: Math.round(ep.wallDurationS * 1000) / 1000,
    };
    for (const cam of options.cameras) {
      const p = `videos/observation.images.${cam.key}`;
      row[`${p}/from_timestamp`] = Math.round(fromTs * 1e6) / 1e6;
      row[`${p}/to_timestamp`] = Math.round(toTs * 1e6) / 1e6;
      row[`${p}/chunk_index`] = 0;
      row[`${p}/file_index`] = 0;
    }
    await epWriter.appendRow(row);

    episodeLines.push({
      episode_index: ep.episodeIndex,
      tasks: [ep.task],
      length: ep.frames.length,
      dropped_frames: ep.dropped,
      wall_duration_s: Math.round(ep.wallDurationS * 1000) / 1000,
    });
  }
  await epWriter.close();

  // ---- meta ---------------------------------------------------------------
  const metaDir = join(root, 'meta');
  await writeFile(
    join(metaDir, 'episodes.jsonl'),
    episodeLines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf-8',
  );
  // `datasets.routes.ts:90-99` and `DatasetService.validateStructure` both
  // prefer this one for local-directory serving.
  await writeFile(join(metaDir, 'episodes.json'), JSON.stringify(episodeLines, null, 2), 'utf-8');
  await writeFile(
    join(metaDir, 'tasks.jsonl'),
    JSON.stringify({ task_index: 0, task }) + '\n',
    'utf-8',
  );
  const taskWriter = await ParquetWriter.openFile(
    new ParquetSchema({ task_index: { type: 'INT64' }, task: { type: 'UTF8' } }),
    join(metaDir, 'tasks.parquet'),
  );
  await taskWriter.appendRow({ task_index: 0, task });
  await taskWriter.close();

  const allStates = episodes.flatMap((e) => e.frames.map((f) => f.state));
  const allActions = episodes.flatMap((e) => e.frames.map((f) => f.action));
  // State and action only, as both existing writers in this repo do. Image
  // stats would mean decoding every JPEG a second time; LeRobot computes them
  // when it needs them.
  await writeFile(
    join(metaDir, 'stats.json'),
    JSON.stringify(
      { 'observation.state': computeFeatureStats(allStates), action: computeFeatureStats(allActions) },
      null,
      2,
    ),
    'utf-8',
  );

  const info = buildInfo({
    robotType: options.robotType,
    jointNames: options.jointNames,
    fps: options.fps,
    totalEpisodes: episodes.length,
    totalFrames,
    cameras: options.cameras,
    ...(options.provenance ? { provenance: options.provenance } : {}),
  });
  await writeFile(join(metaDir, 'info.json'), JSON.stringify(info, null, 2), 'utf-8');

  return {
    root,
    totalEpisodes: episodes.length,
    totalFrames,
    videoFeatures: options.cameras.map((c) => `observation.images.${c.key}`),
    hasVideo: options.cameras.length > 0,
  };
}

/** Delete a scratch directory, tolerating one that was never created. */
export async function discardScratch(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}

/** How many `frame_%08d.jpg` a scratch directory holds. Used by the tests. */
export async function countFrames(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const names = await readdir(dir);
  return names.filter((n) => /^frame_\d{8}\.jpg$/.test(n)).length;
}

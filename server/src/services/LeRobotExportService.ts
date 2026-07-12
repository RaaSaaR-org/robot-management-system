/**
 * @file LeRobotExportService.ts
 * @description Converts teleoperation session data to LeRobot v3.0 format
 *              (chunked Parquet + metadata) and uploads to RustFS object storage.
 *              Frames are grouped by episodeIndex into separate LeRobot episodes.
 * @feature datacollection
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readFile, mkdir, rm } from 'fs/promises';
import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs';
import { RustFSClient } from '../storage/rustfs-client.js';
import { BUCKETS } from '../storage/model-storage.js';

// ============================================================================
// TYPES
// ============================================================================

/** A single frame row as stored in the DB */
export interface FrameRow {
  frameIndex: number;
  timestamp: number;
  jointPositions: number[];
  action: number[];
  isIntervention: boolean;
  /** Episode within the session (default 0 for legacy single-episode data) */
  episodeIndex?: number;
}

/** Per-feature statistics (one value per joint) */
export interface FeatureStats {
  mean: number[];
  std: number[];
  min: number[];
  max: number[];
}

/** Complete stats.json structure */
export interface LeRobotStats {
  'observation.state': FeatureStats;
  action: FeatureStats;
}

/** info.json structure */
export interface LeRobotInfo {
  codebase_version: string;
  robot_type: string;
  total_episodes: number;
  total_frames: number;
  total_tasks: number;
  chunks_size: number;
  fps: number;
  data_path: string;
  features: Record<string, { dtype: string; shape: number[]; names: string[] }>;
  splits: Record<string, string>;
}

/** Options for the export */
export interface LeRobotExportOptions {
  sessionFps: number;
  robotType?: string;
  jointNames?: string[];
  /** Language instruction — becomes the LeRobot task for every episode */
  task?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_JOINT_NAMES = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
  'gripper',
];

const DEFAULT_ROBOT_TYPE = 'so101';
// The writer emits the LeRobot v3.0 layout: all episodes of a chunk are
// concatenated into data/chunk-000/file-000.parquet with an episode_index
// column, and per-episode metadata lives in meta/episodes/chunk-000/….
const LEROBOT_CODEBASE_VERSION = 'v3.0';
const CHUNKS_SIZE = 1000;
const DEFAULT_TASK = 'manipulate object';
// Upload into the bucket the dataset viewer reads from
// (datasets.routes.ts → readParquetFromRustFS tries 'training-datasets' first).
const RUSTFS_BUCKET = process.env.RUSTFS_BUCKET ?? BUCKETS.TRAINING_DATASETS;

// ============================================================================
// LEROBOT EXPORT SERVICE
// ============================================================================

/**
 * Service that converts teleoperation frames into the LeRobot v3.0 dataset
 * format and uploads the resulting Parquet + metadata files to RustFS.
 */
export class LeRobotExportService {
  private storage: RustFSClient;

  constructor(storage: RustFSClient) {
    this.storage = storage;
  }

  /**
   * Run the full export pipeline:
   *   1. Group frames by episodeIndex and write data/chunk-000/file-000.parquet
   *   2. Write meta/episodes/chunk-000/file-000.parquet (per-episode lengths)
   *   3. Write meta/episodes.jsonl (one line per episode, with the task)
   *   4. Compute meta/stats.json
   *   5. Generate meta/info.json
   *   6. Upload everything to RustFS under `<datasetId>/`
   *
   * @returns The datasetId (UUID) used as the root key in RustFS
   */
  async exportSession(
    frames: FrameRow[],
    options: LeRobotExportOptions
  ): Promise<{ datasetId: string; storagePath: string; episodeCount: number }> {
    if (frames.length === 0) {
      throw new Error('Cannot export empty frame list');
    }

    const episodes = this.groupByEpisode(frames);
    const datasetId = randomUUID();
    const workDir = join(tmpdir(), `lerobot-export-${datasetId}`);
    await mkdir(workDir, { recursive: true });

    try {
      // 1. Write data parquet (all episodes, re-based frame_index/timestamp)
      const dataParquetPath = join(workDir, 'data.parquet');
      await this.writeDataParquet(episodes, dataParquetPath);

      // 2. Write episodes metadata parquet
      const episodesParquetPath = join(workDir, 'episodes.parquet');
      await this.writeEpisodesParquet(episodes, episodesParquetPath, options);

      // 3. episodes.jsonl
      const task = options.task ?? DEFAULT_TASK;
      const episodesJsonl = episodes
        .map((ep) =>
          JSON.stringify({
            episode_index: ep.episodeIndex,
            tasks: [task],
            length: ep.frames.length,
          })
        )
        .join('\n');

      // 4. Stats
      const stats = this.computeStats(frames);

      // 5. Info
      const info = this.buildInfo(frames, episodes.length, options);

      // 6. Upload everything. Keys live under `<datasetId>/…` and the returned
      // storagePath is the same prefix, so the dataset viewer's
      // readParquetFromRustFS(storagePath, relativePath) resolves correctly.
      const prefix = datasetId;
      const [dataBuf, episodesBuf] = await Promise.all([
        readFile(dataParquetPath),
        readFile(episodesParquetPath),
      ]);

      await Promise.all([
        this.storage.upload(RUSTFS_BUCKET, `${prefix}/data/chunk-000/file-000.parquet`, dataBuf, {
          contentType: 'application/octet-stream',
        }),
        this.storage.upload(
          RUSTFS_BUCKET,
          `${prefix}/meta/episodes/chunk-000/file-000.parquet`,
          episodesBuf,
          { contentType: 'application/octet-stream' }
        ),
        this.storage.putObject(RUSTFS_BUCKET, `${prefix}/meta/episodes.jsonl`, episodesJsonl, {
          contentType: 'application/jsonl',
        }),
        this.storage.putObject(
          RUSTFS_BUCKET,
          `${prefix}/meta/info.json`,
          JSON.stringify(info, null, 2),
          { contentType: 'application/json' }
        ),
        this.storage.putObject(
          RUSTFS_BUCKET,
          `${prefix}/meta/stats.json`,
          JSON.stringify(stats, null, 2),
          { contentType: 'application/json' }
        ),
      ]);

      return {
        datasetId,
        storagePath: `${datasetId}/`,
        episodeCount: episodes.length,
      };
    } finally {
      // Clean up temp dir
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // --------------------------------------------------------------------------
  // EPISODE GROUPING
  // --------------------------------------------------------------------------

  /**
   * Group frames by episodeIndex, ordered by episode then frameIndex.
   * Episode indices are re-numbered densely (0..N-1) so discarded episodes
   * don't leave gaps in the exported dataset.
   */
  groupByEpisode(frames: FrameRow[]): Array<{ episodeIndex: number; frames: FrameRow[] }> {
    const byEpisode = new Map<number, FrameRow[]>();
    for (const frame of frames) {
      const ep = frame.episodeIndex ?? 0;
      const list = byEpisode.get(ep);
      if (list) list.push(frame);
      else byEpisode.set(ep, [frame]);
    }

    const sourceIndices = [...byEpisode.keys()].sort((a, b) => a - b);
    return sourceIndices.map((sourceIndex, denseIndex) => ({
      episodeIndex: denseIndex,
      frames: byEpisode
        .get(sourceIndex)!
        .slice()
        .sort((a, b) => a.frameIndex - b.frameIndex),
    }));
  }

  // --------------------------------------------------------------------------
  // PARQUET
  // --------------------------------------------------------------------------

  /**
   * Write all episodes as one LeRobot v3.0 data Parquet file.
   * frame_index and timestamp are re-based per episode (LeRobot convention);
   * `index` is the global frame counter across the dataset.
   */
  private async writeDataParquet(
    episodes: Array<{ episodeIndex: number; frames: FrameRow[] }>,
    outputPath: string
  ): Promise<void> {
    const schema = new ParquetSchema({
      'observation.state': { type: 'DOUBLE', repeated: true },
      action: { type: 'DOUBLE', repeated: true },
      frame_index: { type: 'INT32' },
      episode_index: { type: 'INT32' },
      index: { type: 'INT32' },
      task_index: { type: 'INT32' },
      timestamp: { type: 'DOUBLE' },
      next_done: { type: 'BOOLEAN' },
    });

    const writer = await ParquetWriter.openFile(schema, outputPath);

    let globalIndex = 0;
    for (const episode of episodes) {
      const epStart = episode.frames.length > 0 ? episode.frames[0].timestamp : 0;
      const lastIdx = episode.frames.length - 1;
      for (let i = 0; i < episode.frames.length; i++) {
        const f = episode.frames[i];
        await writer.appendRow({
          'observation.state': f.jointPositions,
          action: f.action,
          frame_index: i,
          episode_index: episode.episodeIndex,
          index: globalIndex,
          task_index: 0,
          timestamp: Math.max(0, f.timestamp - epStart),
          next_done: i === lastIdx,
        });
        globalIndex += 1;
      }
    }

    await writer.close();
  }

  /**
   * Write the per-episode metadata parquet the dataset viewer reads
   * (meta/episodes/chunk-000/file-000.parquet with episode_index + length).
   */
  private async writeEpisodesParquet(
    episodes: Array<{ episodeIndex: number; frames: FrameRow[] }>,
    outputPath: string,
    options: LeRobotExportOptions
  ): Promise<void> {
    const schema = new ParquetSchema({
      episode_index: { type: 'INT32' },
      length: { type: 'INT32' },
      tasks: { type: 'UTF8', repeated: true },
    });

    const writer = await ParquetWriter.openFile(schema, outputPath);
    const task = options.task ?? DEFAULT_TASK;
    for (const episode of episodes) {
      await writer.appendRow({
        episode_index: episode.episodeIndex,
        length: episode.frames.length,
        tasks: [task],
      });
    }
    await writer.close();
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  /**
   * Compute per-joint mean, std, min, max for observation.state and action.
   */
  computeStats(frames: FrameRow[]): LeRobotStats {
    return {
      'observation.state': this.computeFeatureStats(frames.map((f) => f.jointPositions)),
      action: this.computeFeatureStats(frames.map((f) => f.action)),
    };
  }

  private computeFeatureStats(data: number[][]): FeatureStats {
    if (data.length === 0) {
      return { mean: [], std: [], min: [], max: [] };
    }

    const dim = data[0].length;
    const n = data.length;

    const mean = new Array<number>(dim).fill(0);
    const min = new Array<number>(dim).fill(Infinity);
    const max = new Array<number>(dim).fill(-Infinity);

    for (const row of data) {
      for (let j = 0; j < dim; j++) {
        const v = row[j];
        mean[j] += v;
        if (v < min[j]) min[j] = v;
        if (v > max[j]) max[j] = v;
      }
    }

    for (let j = 0; j < dim; j++) {
      mean[j] /= n;
    }

    // Compute std (population std dev)
    const std = new Array<number>(dim).fill(0);
    for (const row of data) {
      for (let j = 0; j < dim; j++) {
        const diff = row[j] - mean[j];
        std[j] += diff * diff;
      }
    }
    for (let j = 0; j < dim; j++) {
      std[j] = Math.sqrt(std[j] / n);
    }

    return { mean, std, min, max };
  }

  // --------------------------------------------------------------------------
  // INFO
  // --------------------------------------------------------------------------

  /**
   * Build the info.json metadata object.
   */
  buildInfo(frames: FrameRow[], totalEpisodes: number, options: LeRobotExportOptions): LeRobotInfo {
    const jointNames = options.jointNames ?? DEFAULT_JOINT_NAMES;
    const dim = frames[0].jointPositions.length;
    const names =
      jointNames.length >= dim
        ? jointNames.slice(0, dim)
        : Array.from({ length: dim }, (_, i) => jointNames[i] ?? `joint_${i}`);

    // Compute FPS from timestamps if we have enough frames, otherwise use session fps
    let fps = options.sessionFps;
    if (frames.length >= 2) {
      const first = frames[0].timestamp;
      const last = frames[frames.length - 1].timestamp;
      const duration = last - first;
      if (duration > 0) {
        const measured = Math.round((frames.length - 1) / duration);
        if (measured > 0) fps = measured;
      }
    }

    return {
      codebase_version: LEROBOT_CODEBASE_VERSION,
      robot_type: options.robotType ?? DEFAULT_ROBOT_TYPE,
      total_episodes: totalEpisodes,
      total_frames: frames.length,
      total_tasks: 1,
      chunks_size: CHUNKS_SIZE,
      fps,
      data_path: 'data/chunk-{episode_chunk:03d}/file-{episode_file:03d}.parquet',
      features: {
        'observation.state': {
          dtype: 'float32',
          shape: [dim],
          names,
        },
        action: {
          dtype: 'float32',
          shape: [dim],
          names,
        },
      },
      splits: { train: `0:${totalEpisodes}` },
    };
  }
}

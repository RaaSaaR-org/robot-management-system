/**
 * @file LeRobotExportService.ts
 * @description Converts teleoperation session data to LeRobot v3 format (Parquet + metadata)
 *              and uploads to RustFS object storage
 * @feature datacollection
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readFile, mkdir, rm } from 'fs/promises';
import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs';
import { RustFSClient } from '../storage/rustfs-client.js';

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
  fps: number;
  features: Record<string, { dtype: string; shape: number[]; names: string[] }>;
  splits: Record<string, string>;
}

/** Options for the export */
export interface LeRobotExportOptions {
  sessionFps: number;
  robotType?: string;
  jointNames?: string[];
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
const LEROBOT_CODEBASE_VERSION = 'v2.0';
const RUSTFS_BUCKET = process.env.RUSTFS_BUCKET ?? 'lerobot-datasets';

// ============================================================================
// LEROBOT EXPORT SERVICE
// ============================================================================

/**
 * Service that converts teleoperation frames into the LeRobot v3 dataset format
 * and uploads the resulting Parquet + metadata files to RustFS.
 */
export class LeRobotExportService {
  private storage: RustFSClient;

  constructor(storage: RustFSClient) {
    this.storage = storage;
  }

  /**
   * Run the full export pipeline:
   *   1. Write data.parquet to a temp file
   *   2. Compute stats.json
   *   3. Generate info.json
   *   4. Upload all three files to RustFS
   *
   * @returns The datasetId (UUID) used as the root key in RustFS
   */
  async exportSession(
    frames: FrameRow[],
    options: LeRobotExportOptions
  ): Promise<{ datasetId: string; storagePath: string }> {
    if (frames.length === 0) {
      throw new Error('Cannot export empty frame list');
    }

    const datasetId = randomUUID();
    const workDir = join(tmpdir(), `lerobot-export-${datasetId}`);
    await mkdir(workDir, { recursive: true });

    try {
      // 1. Write parquet
      const parquetPath = join(workDir, 'data.parquet');
      await this.writeParquet(frames, parquetPath);

      // 2. Compute stats
      const stats = this.computeStats(frames);

      // 3. Build info
      const info = this.buildInfo(frames, options);

      // 4. Upload everything
      const prefix = `${datasetId}`;
      const parquetBuf = await readFile(parquetPath);

      await Promise.all([
        this.storage.upload(RUSTFS_BUCKET, `${prefix}/data/data.parquet`, parquetBuf, {
          contentType: 'application/octet-stream',
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
        storagePath: `datasets/${datasetId}/`,
      };
    } finally {
      // Clean up temp dir
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // --------------------------------------------------------------------------
  // PARQUET
  // --------------------------------------------------------------------------

  /**
   * Write all frames as a LeRobot v3 Parquet file.
   */
  private async writeParquet(frames: FrameRow[], outputPath: string): Promise<void> {
    const schema = new ParquetSchema({
      observation_state: { type: 'DOUBLE', repeated: true },
      action: { type: 'DOUBLE', repeated: true },
      frame_index: { type: 'INT32' },
      episode_index: { type: 'INT32' },
      timestamp: { type: 'DOUBLE' },
      next_done: { type: 'BOOLEAN' },
    });

    const writer = await ParquetWriter.openFile(schema, outputPath);

    const lastIdx = frames.length - 1;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      await writer.appendRow({
        observation_state: f.jointPositions,
        action: f.action,
        frame_index: f.frameIndex,
        episode_index: 0,
        timestamp: f.timestamp,
        next_done: i === lastIdx,
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
  buildInfo(frames: FrameRow[], options: LeRobotExportOptions): LeRobotInfo {
    const jointNames = options.jointNames ?? DEFAULT_JOINT_NAMES;
    const dim = frames[0].jointPositions.length;
    const names = jointNames.slice(0, dim);

    // Compute FPS from timestamps if we have enough frames, otherwise use session fps
    let fps = options.sessionFps;
    if (frames.length >= 2) {
      const first = frames[0].timestamp;
      const last = frames[frames.length - 1].timestamp;
      const duration = last - first;
      if (duration > 0) {
        fps = Math.round((frames.length - 1) / duration);
      }
    }

    return {
      codebase_version: LEROBOT_CODEBASE_VERSION,
      robot_type: options.robotType ?? DEFAULT_ROBOT_TYPE,
      total_episodes: 1,
      total_frames: frames.length,
      fps,
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
      splits: { train: '0:1' },
    };
  }
}

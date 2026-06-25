/**
 * @file pointcloud-replay.ts
 * @description Plays back REAL recorded point clouds through the perception pipeline.
 *
 * This is the production-shaped "real data" source. Where {@link generateSyntheticScan}
 * fabricates a cloud, this loads genuine LiDAR recordings (KITTI `.bin`, PCD) off
 * disk, normalizes them into the robot's base frame (x-forward, y-left, z-up,
 * floor at z = 0, intensity 0..1), downsamples to a live or full budget, and
 * serves {@link PointCloudFrame}s — so the Perception tab shows a real sensor
 * scan with the robot standing inside it.
 *
 * Selection priority in {@link RobotStateManager.getPointCloudFrame} is:
 *   hardware (live sidecar) → replay (this, if configured) → synthetic.
 * It is therefore opt-in via env and never displaces real hardware.
 *
 * Configure with either:
 *   POINTCLOUD_REPLAY_FILE=/abs/path/to/scan.bin
 *   POINTCLOUD_REPLAY_DIR=/abs/path/to/dir   (cycles through *.bin / *.pcd)
 *
 * @status live
 */

import fs from 'fs';
import path from 'path';
import type { PointCloudFrame, PointCloudSensorType } from './types.js';
import type { DepthSensorSpec } from '../embodiment/index.js';
import { parsePointCloudFile, type RawCloud } from './pointcloud-formats.js';

/** A real recording loaded + pre-normalized into the robot base frame. */
interface LoadedCloud {
  label: string;
  count: number;
  /** Interleaved XYZ in base frame (x-fwd, y-left, z-up, floor≈0), length count*3. */
  positions: Float32Array;
  /** Per-point intensity, normalized 0..1. */
  intensities: Float32Array;
  hasIntensity: boolean;
}

export interface ReplayNormalizeOptions {
  /** Shift Z so the ground (5th percentile) sits at 0. Default true. */
  floorToZero?: boolean;
  /** Shift XY so the cloud is centered on the robot. Default true. */
  centerXY?: boolean;
  /** Uniform scale applied after recentering (e.g. shrink a huge outdoor scan). */
  scale?: number;
  /** Yaw (radians) applied per sequence step so the cloud slowly rotates → "live". */
  yawPerFrame?: number;
}

const DEFAULT_NORMALIZE: Required<ReplayNormalizeOptions> = {
  floorToZero: true,
  centerXY: true,
  scale: 1,
  yawPerFrame: 0.015,
};

/** Robust max via a high percentile, so a few hot returns don't crush the range. */
function percentile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Plays back real recorded scans as {@link PointCloudFrame}s.
 *
 * Construct directly (tests) or via {@link PointCloudReplaySource.fromEnv}.
 */
export class PointCloudReplaySource {
  private clouds: LoadedCloud[] = [];
  private readonly opts: Required<ReplayNormalizeOptions>;

  constructor(opts: ReplayNormalizeOptions = {}) {
    this.opts = { ...DEFAULT_NORMALIZE, ...opts };
  }

  /** Number of recordings loaded. */
  get size(): number {
    return this.clouds.length;
  }

  /** Labels of the loaded recordings, in load order. */
  get labels(): string[] {
    return this.clouds.map((c) => c.label);
  }

  /**
   * Build a replay source from environment configuration, or `undefined` if
   * none is set / nothing loads. Safe to call on every robot type.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): PointCloudReplaySource | undefined {
    const file = env.POINTCLOUD_REPLAY_FILE?.trim();
    const dir = env.POINTCLOUD_REPLAY_DIR?.trim();
    if (!file && !dir) return undefined;

    const source = new PointCloudReplaySource({
      scale: env.POINTCLOUD_REPLAY_SCALE ? Number(env.POINTCLOUD_REPLAY_SCALE) : undefined,
    });
    try {
      if (file) source.loadFile(file);
      if (dir) source.loadDir(dir);
    } catch (err) {
      console.warn('[PointCloudReplay] Failed to load recordings:', err);
    }
    return source.size > 0 ? source : undefined;
  }

  /** Load every `.bin` / `.pcd` in a directory (sorted, for deterministic cycling). */
  loadDir(dir: string): void {
    const entries = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.bin') || f.toLowerCase().endsWith('.pcd'))
      .sort();
    for (const entry of entries) this.loadFile(path.join(dir, entry));
  }

  /** Load and normalize a single recording. */
  loadFile(filePath: string): void {
    const buffer = fs.readFileSync(filePath);
    const raw = parsePointCloudFile(filePath, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    this.clouds.push(this.normalize(raw, path.basename(filePath)));
  }

  /** Load from an in-memory buffer (used by tests / the sidecar bridge). */
  loadBuffer(filename: string, buffer: ArrayBuffer | Uint8Array): void {
    const raw = parsePointCloudFile(filename, buffer);
    this.clouds.push(this.normalize(raw, filename));
  }

  /**
   * Reframe a raw cloud into the robot base frame: recenter XY on the robot,
   * drop the floor to z = 0, scale, and normalize intensity to 0..1.
   */
  private normalize(raw: RawCloud, label: string): LoadedCloud {
    const { count } = raw;
    const positions = new Float32Array(raw.positions); // copy
    const intensities = new Float32Array(raw.intensities);

    // --- Centroid (XY) and floor (low percentile of Z) ---
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < count; i++) {
      sx += positions[i * 3];
      sy += positions[i * 3 + 1];
    }
    const cx = this.opts.centerXY && count ? sx / count : 0;
    const cy = this.opts.centerXY && count ? sy / count : 0;

    let floor = 0;
    if (this.opts.floorToZero && count) {
      const zs = new Float32Array(count);
      for (let i = 0; i < count; i++) zs[i] = positions[i * 3 + 2];
      zs.sort();
      floor = percentile(zs, 0.05);
    }

    const scale = this.opts.scale || 1;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (positions[i * 3] - cx) * scale;
      positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * scale;
      positions[i * 3 + 2] = (positions[i * 3 + 2] - floor) * scale;
    }

    // --- Normalize intensity to 0..1 (robust 99th-percentile max) ---
    if (raw.hasIntensity && count) {
      const sortedI = new Float32Array(intensities);
      sortedI.sort();
      const maxI = percentile(sortedI, 0.99) || sortedI[sortedI.length - 1] || 1;
      const inv = maxI > 0 ? 1 / maxI : 1;
      for (let i = 0; i < count; i++) intensities[i] = Math.max(0, Math.min(1, intensities[i] * inv));
    }

    return { label, count, positions, intensities, hasIntensity: raw.hasIntensity };
  }

  /**
   * Produce a frame for the given sequence. Cycles through loaded recordings,
   * downsamples to the requested budget, and applies a small per-sequence yaw so
   * a static recording reads as a live, slowly-rotating scan.
   */
  getFrame(
    spec: DepthSensorSpec | undefined,
    sequence: number,
    opts: { full?: boolean; robotId?: string; livePoints?: number } = {},
  ): PointCloudFrame {
    if (this.clouds.length === 0) throw new Error('PointCloudReplaySource: no recordings loaded');

    const cloud = this.clouds[((sequence % this.clouds.length) + this.clouds.length) % this.clouds.length];
    const target = opts.full ? (spec?.points_per_frame ?? 20000) : opts.livePoints ?? 7000;
    // Float step so we land on ~`target` points even when the source only
    // slightly exceeds the budget (integer stride would overshoot badly).
    const step = cloud.count > target ? cloud.count / target : 1;

    // Yaw the whole cloud a little each frame (about base z) for a live feel.
    const yaw = sequence * this.opts.yawPerFrame;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    const positions: number[] = [];
    const intensities: number[] = [];
    for (let f = 0; f < cloud.count; f += step) {
      const i = Math.floor(f);
      const x = cloud.positions[i * 3];
      const y = cloud.positions[i * 3 + 1];
      const z = cloud.positions[i * 3 + 2];
      positions.push(x * cosY - y * sinY, x * sinY + y * cosY, z);
      intensities.push(cloud.hasIntensity ? cloud.intensities[i] : 0.5);
    }

    const sensorType: PointCloudSensorType = spec?.type ?? 'lidar';
    return {
      robotId: opts.robotId ?? '',
      sensor: spec?.name ?? 'mid360_lidar',
      sensorType,
      frame: 'base_link',
      pointCount: positions.length / 3,
      positions,
      intensities,
      hasIntensity: cloud.hasIntensity,
      sequence,
      origin: spec?.position ?? [0, 0, 1.0],
      source: 'replay',
      sourceLabel: cloud.label,
      timestamp: new Date().toISOString(),
    };
  }
}

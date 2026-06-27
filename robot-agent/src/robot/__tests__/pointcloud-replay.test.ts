/**
 * @file pointcloud-replay.test.ts
 * @description Unit tests for PointCloudReplaySource — plays REAL recorded scans
 *              (KITTI .bin, Unitree/SICK PCD) through the perception pipeline.
 * @feature robots
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PointCloudReplaySource } from '../pointcloud-replay.js';
import type { DepthSensorSpec } from '../../embodiment/index.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const KITTI = join(FIX, 'real-kitti-12k.bin');
const UNITREE = join(FIX, 'real-unitree-lidar.pcd');

const MID360: DepthSensorSpec = {
  name: 'mid360_lidar',
  type: 'lidar',
  fov_horizontal: 360,
  fov_vertical: 59,
  range: [0.1, 40],
  points_per_frame: 20000,
  frame_rate: 10,
  has_intensity: true,
  position: [0, 0, 1.0],
  enabled: true,
} as DepthSensorSpec;

describe('PointCloudReplaySource — real KITTI scan', () => {
  it('loads a real recording and serves a normalized live frame', () => {
    const src = new PointCloudReplaySource();
    src.loadFile(KITTI);
    expect(src.size).toBe(1);

    const frame = src.getFrame(MID360, 0, { livePoints: 7000, robotId: 'r1' });
    expect(frame.source).toBe('replay');
    expect(frame.sourceLabel).toBe('real-kitti-12k.bin');
    expect(frame.robotId).toBe('r1');
    expect(frame.sensor).toBe('mid360_lidar');
    expect(frame.pointCount).toBeGreaterThan(0);
    expect(frame.positions.length).toBe(frame.pointCount * 3);
    expect(frame.intensities.length).toBe(frame.pointCount);

    // Live budget downsamples below the full 12k.
    expect(frame.pointCount).toBeLessThanOrEqual(7000);

    // Normalized: intensity in 0..1, all coords finite.
    for (const v of frame.intensities) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(frame.positions.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('floors the cloud to z≈0 so the robot stands inside it', () => {
    const src = new PointCloudReplaySource();
    src.loadFile(KITTI);
    const frame = src.getFrame(MID360, 0, { full: true });
    let minZ = Infinity;
    for (let i = 0; i < frame.pointCount; i++) minZ = Math.min(minZ, frame.positions[i * 3 + 2]);
    // 5th-percentile floor sits at 0; a few points may dip slightly below.
    expect(minZ).toBeGreaterThan(-2);
    expect(minZ).toBeLessThan(0.5);
  });

  it('full capture yields more points than a live frame', () => {
    const src = new PointCloudReplaySource();
    src.loadFile(KITTI);
    const live = src.getFrame(MID360, 0, { livePoints: 2000 });
    const full = src.getFrame(MID360, 0, { full: true });
    expect(full.pointCount).toBeGreaterThan(live.pointCount);
  });

  it('animates: consecutive sequences differ (per-frame yaw)', () => {
    const src = new PointCloudReplaySource();
    src.loadFile(KITTI);
    const a = src.getFrame(MID360, 1, { livePoints: 3000 });
    const b = src.getFrame(MID360, 50, { livePoints: 3000 });
    // Same sampling, but yaw rotation makes XY differ.
    let differs = false;
    for (let i = 0; i < 20; i++) {
      if (Math.abs(a.positions[i * 3] - b.positions[i * 3]) > 1e-4) { differs = true; break; }
    }
    expect(differs).toBe(true);
  });
});

describe('PointCloudReplaySource — real Unitree LiDAR frame', () => {
  it('loads the vendor-matching Unitree PCD and normalizes intensity to 0..1', () => {
    const src = new PointCloudReplaySource();
    src.loadFile(UNITREE);
    const frame = src.getFrame(MID360, 0, { full: true });
    expect(frame.hasIntensity).toBe(true);
    let maxI = 0;
    for (const v of frame.intensities) maxI = Math.max(maxI, v);
    expect(maxI).toBeGreaterThan(0.5); // raw 0..255 → normalized near 1
    expect(maxI).toBeLessThanOrEqual(1);
  });
});

describe('PointCloudReplaySource.fromEnv', () => {
  it('returns undefined when nothing is configured', () => {
    expect(PointCloudReplaySource.fromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('loads from POINTCLOUD_REPLAY_FILE', () => {
    const src = PointCloudReplaySource.fromEnv({ POINTCLOUD_REPLAY_FILE: KITTI } as unknown as NodeJS.ProcessEnv);
    expect(src?.size).toBe(1);
    expect(src?.labels[0]).toBe('real-kitti-12k.bin');
  });

  it('cycles through multiple recordings by sequence (dir load)', () => {
    const src = new PointCloudReplaySource();
    src.loadFile(KITTI);
    src.loadFile(UNITREE);
    expect(src.size).toBe(2);
    expect(src.getFrame(MID360, 0, {}).sourceLabel).toBe('real-kitti-12k.bin');
    expect(src.getFrame(MID360, 1, {}).sourceLabel).toBe('real-unitree-lidar.pcd');
    expect(src.getFrame(MID360, 2, {}).sourceLabel).toBe('real-kitti-12k.bin');
  });
});

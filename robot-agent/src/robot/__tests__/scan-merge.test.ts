/**
 * @file scan-merge.test.ts
 * @description Unit tests for the base↔world transforms + voxel downsample.
 * @feature robot
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { baseToWorld, worldToBase, voxelDownsample, voxelKey } from '../scan-merge.js';

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('baseToWorld', () => {
  it('rotates a forward point by +90° yaw (radians) to the left axis', () => {
    // x-forward (1,0,0) rotated +90° about z → y-left (0,1,0)
    const [x, y, z] = baseToWorld(1, 0, 0, { x: 0, y: 0, z: 0, yaw: Math.PI / 2 });
    expect(close(x, 0)).toBe(true);
    expect(close(y, 1)).toBe(true);
    expect(close(z, 0)).toBe(true);
  });

  it('translates by the pose origin with zero yaw', () => {
    const [x, y, z] = baseToWorld(1, 0, 0, { x: 5, y: 3, z: 2, yaw: 0 });
    expect(close(x, 6)).toBe(true);
    expect(close(y, 3)).toBe(true);
    expect(close(z, 2)).toBe(true);
  });
});

describe('worldToBase', () => {
  it('is the inverse of baseToWorld', () => {
    const pose = { x: 4.2, y: -1.7, z: 0, yaw: 1.234 };
    const pts: Array<[number, number, number]> = [
      [1, 0, 0],
      [-2, 3, 0.5],
      [0.25, -0.75, 1.1],
    ];
    for (const [bx, by, bz] of pts) {
      const [wx, wy, wz] = baseToWorld(bx, by, bz, pose);
      const [rx, ry, rz] = worldToBase(wx, wy, wz, pose);
      expect(close(rx, bx, 1e-9)).toBe(true);
      expect(close(ry, by, 1e-9)).toBe(true);
      expect(close(rz, bz, 1e-9)).toBe(true);
    }
  });

  it('projects a world point in front of a yawed robot to +x in base', () => {
    // Robot at (2,2) facing +90° (yaw=π/2); a point 1m "ahead" in world is (2,3).
    const pose = { x: 2, y: 2, z: 0, yaw: Math.PI / 2 };
    const [bx, by] = worldToBase(2, 3, 0, pose);
    expect(close(bx, 1, 1e-9)).toBe(true); // 1m forward
    expect(close(by, 0, 1e-9)).toBe(true);
  });
});

describe('voxelDownsample', () => {
  it('collapses points sharing a voxel and preserves first-seen order', () => {
    const cloud = {
      positions: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 5, 5, 5],
      intensities: [0.1, 0.9, 0.5],
    };
    const out = voxelDownsample(cloud, 0.1);
    // First two points fall in the same 0.1 voxel → one survives; (5,5,5) distinct.
    expect(out.positions.length / 3).toBe(2);
    expect(out.intensities[0]).toBe(0.1); // first-seen kept
    expect(out.positions.slice(3)).toEqual([5, 5, 5]);
  });

  it('voxelKey buckets by integer cell', () => {
    expect(voxelKey(0.05, 0.05, 0.05, 0.1)).toBe(voxelKey(0.09, 0.01, 0.0, 0.1));
    expect(voxelKey(0.15, 0, 0, 0.1)).not.toBe(voxelKey(0.05, 0, 0, 0.1));
  });
});

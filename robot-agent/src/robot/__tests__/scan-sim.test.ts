/**
 * @file scan-sim.test.ts
 * @description Unit tests for the pose-dependent scan-session generator.
 * @feature robot
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { createScanRoom, generatePosedScan, seedFromString, SCAN_LIVE_POINTS } from '../scan-sim.js';
import { baseToWorld } from '../scan-merge.js';
import type { SimulatedRobotState, PointCloudPose } from '../types.js';
import type { DepthSensorSpec } from '../../embodiment/index.js';

function mockState(overrides: Partial<SimulatedRobotState> = {}): SimulatedRobotState {
  return {
    id: 'robot-g1-001', name: 'Test G1', model: 'G1', serialNumber: 'SIM-1',
    robotClass: 'standard', robotType: 'g1', maxPayloadKg: 10, description: 'test',
    status: 'online', batteryLevel: 90, location: { x: 0, y: 0, heading: 0 },
    capabilities: [], firmware: 'sim', ipAddress: '127.0.0.1', speed: 0,
    lastSeen: '', createdAt: '', updatedAt: '', errors: [], warnings: [], ...overrides,
  };
}

const MID360: DepthSensorSpec = {
  name: 'mid360_lidar', type: 'lidar', fov_horizontal: 360, fov_vertical: 59,
  range: [0.1, 40.0], points_per_frame: 20000, frame_rate: 10, has_intensity: true,
  position: [0, 0, 1.0], enabled: true,
};

const SCAN_RANGE = 6.5;

/** Lift a frame's base_link points back into the world frame via its pose. */
function worldPointsOf(frame: { positions: number[]; pose?: PointCloudPose }): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const p = frame.pose!;
  const pose = { x: p.x, y: p.y, z: 0, yaw: p.yaw };
  for (let i = 0; i < frame.positions.length / 3; i++) {
    out.push(baseToWorld(frame.positions[i * 3], frame.positions[i * 3 + 1], frame.positions[i * 3 + 2], pose));
  }
  return out;
}

describe('createScanRoom', () => {
  it('is deterministic for a given seed', () => {
    const a = createScanRoom(12345);
    const b = createScanRoom(12345);
    expect(a.worldPositions.length).toBe(b.worldPositions.length);
    expect(Array.from(a.worldPositions.slice(0, 30))).toEqual(Array.from(b.worldPositions.slice(0, 30)));
    expect(a.occluders).toEqual(b.occluders);
  });

  it('differs across seeds and exposes room bounds + occluders', () => {
    const a = createScanRoom(seedFromString('sess-a'));
    const b = createScanRoom(seedFromString('sess-b'));
    expect(Array.from(a.worldPositions.slice(0, 30))).not.toEqual(Array.from(b.worldPositions.slice(0, 30)));
    expect(a.occluders.length).toBeGreaterThan(0);
    expect(a.bounds.maxX).toBeGreaterThan(a.bounds.minX);
  });
});

describe('generatePosedScan', () => {
  const room = createScanRoom(seedFromString('fixed'));
  const pose0: PointCloudPose = { x: 0, y: 0, z: 0, yaw: 0 };

  it('returns a base_link sim frame tagged with pose + session', () => {
    const frame = generatePosedScan(room, mockState(), pose0, MID360, 7, { scanSessionId: 'sess_X' });
    expect(frame.frame).toBe('base_link');
    expect(frame.source).toBe('sim');
    expect(frame.scanSessionId).toBe('sess_X');
    expect(frame.pose).toEqual(pose0);
    expect(frame.sequence).toBe(7);
    expect(frame.positions.length).toBe(frame.pointCount * 3);
    expect(frame.intensities.length).toBe(frame.pointCount);
    expect(frame.pointCount).toBeGreaterThan(0);
  });

  it('only returns points within the effective scan range of the sensor', () => {
    const frame = generatePosedScan(room, mockState(), pose0, MID360, 0, { scanRange: SCAN_RANGE });
    const originZ = MID360.position![2];
    for (let i = 0; i < frame.pointCount; i++) {
      const x = frame.positions[i * 3];
      const y = frame.positions[i * 3 + 1];
      const z = frame.positions[i * 3 + 2];
      const range = Math.hypot(x, y, z - originZ);
      expect(range).toBeLessThanOrEqual(SCAN_RANGE + 1e-6);
    }
  });

  it('respects the live point budget', () => {
    const frame = generatePosedScan(room, mockState(), pose0, MID360, 0, { targetPoints: SCAN_LIVE_POINTS });
    expect(frame.pointCount).toBeLessThanOrEqual(SCAN_LIVE_POINTS);
  });

  it('shows DIFFERENT geometry from two distant poses (pose-dependent visibility)', () => {
    const cornerA: PointCloudPose = { x: -5, y: -3.5, z: 0, yaw: 0 };
    const cornerB: PointCloudPose = { x: 5, y: 3.5, z: 0, yaw: 0 };
    const fa = generatePosedScan(room, mockState(), cornerA, MID360, 0, { scanRange: SCAN_RANGE });
    const fb = generatePosedScan(room, mockState(), cornerB, MID360, 0, { scanRange: SCAN_RANGE });

    const centroid = (pts: Array<[number, number, number]>) => {
      const c = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
      return [c[0] / pts.length, c[1] / pts.length];
    };
    const ca = centroid(worldPointsOf(fa));
    const cb = centroid(worldPointsOf(fb));
    // Visible-region centroids sit near each pose → far apart.
    expect(Math.hypot(ca[0] - cb[0], ca[1] - cb[1])).toBeGreaterThan(4);
  });

  it('accumulates: walking covers more of the room than one spot', () => {
    const VOX = 0.25;
    const coverage = (poses: PointCloudPose[]) => {
      const cells = new Set<string>();
      for (const p of poses) {
        const f = generatePosedScan(room, mockState(), p, MID360, 0, { scanRange: SCAN_RANGE });
        for (const [wx, wy] of worldPointsOf(f)) {
          cells.add(`${Math.floor(wx / VOX)},${Math.floor(wy / VOX)}`);
        }
      }
      return cells.size;
    };
    const single = coverage([{ x: 0, y: 0, z: 0, yaw: 0 }]);
    const walk = coverage([
      { x: -5, y: -3.5, z: 0, yaw: 0 },
      { x: 5, y: -3.5, z: 0, yaw: 0 },
      { x: 5, y: 3.5, z: 0, yaw: 0 },
      { x: -5, y: 3.5, z: 0, yaw: 0 },
      { x: 0, y: 0, z: 0, yaw: 0 },
    ]);
    expect(walk).toBeGreaterThan(single * 1.3);
  });
});

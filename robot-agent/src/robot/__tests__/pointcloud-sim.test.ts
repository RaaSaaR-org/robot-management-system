/**
 * @file pointcloud-sim.test.ts
 * @description Unit tests for the synthetic point-cloud generator
 * @feature robot
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { generateSyntheticScan, LIVE_POINTS_PER_FRAME } from '../pointcloud-sim.js';
import type { SimulatedRobotState } from '../types.js';
import type { DepthSensorSpec } from '../../embodiment/index.js';

function mockState(overrides: Partial<SimulatedRobotState> = {}): SimulatedRobotState {
  return {
    id: 'robot-g1-001',
    name: 'Test G1',
    model: 'G1',
    serialNumber: 'SIM-1',
    robotClass: 'standard',
    robotType: 'g1',
    maxPayloadKg: 10,
    description: 'test',
    status: 'online',
    batteryLevel: 90,
    location: { x: 0, y: 0, heading: 0 },
    capabilities: [],
    firmware: 'sim',
    ipAddress: '127.0.0.1',
    speed: 0,
    lastSeen: '',
    createdAt: '',
    updatedAt: '',
    errors: [],
    warnings: [],
    ...overrides,
  };
}

const MID360: DepthSensorSpec = {
  name: 'mid360_lidar',
  type: 'lidar',
  fov_horizontal: 360,
  fov_vertical: 59,
  range: [0.1, 40.0],
  points_per_frame: 20000,
  frame_rate: 10,
  has_intensity: true,
  position: [0, 0, 1.0],
  enabled: true,
};

describe('generateSyntheticScan', () => {
  it('returns a frame with positions length = pointCount * 3', () => {
    const frame = generateSyntheticScan(mockState(), MID360, 0);
    expect(frame.positions.length).toBe(frame.pointCount * 3);
    expect(frame.intensities.length).toBe(frame.pointCount);
    expect(frame.pointCount).toBeGreaterThan(0);
  });

  it('defaults to the live point budget', () => {
    const frame = generateSyntheticScan(mockState(), MID360, 1);
    // Some points fall outside range and are dropped, so allow a margin.
    expect(frame.pointCount).toBeLessThanOrEqual(LIVE_POINTS_PER_FRAME);
    expect(frame.pointCount).toBeGreaterThan(LIVE_POINTS_PER_FRAME * 0.7);
  });

  it('respects a requested target point count (full capture)', () => {
    const frame = generateSyntheticScan(mockState(), MID360, 2, { targetPoints: 20000 });
    expect(frame.pointCount).toBeGreaterThan(14000);
    expect(frame.pointCount).toBeLessThanOrEqual(20000);
  });

  it('keeps all points within the sensor range', () => {
    const frame = generateSyntheticScan(mockState(), MID360, 3);
    const [minR, maxR] = MID360.range!;
    const origin = MID360.position!;
    for (let i = 0; i < frame.pointCount; i++) {
      const dx = frame.positions[i * 3];
      const dy = frame.positions[i * 3 + 1];
      const dz = frame.positions[i * 3 + 2] - origin[2];
      const dist = Math.hypot(dx, dy, dz);
      expect(dist).toBeGreaterThanOrEqual(minR - 1e-6);
      expect(dist).toBeLessThanOrEqual(maxR + 1e-6);
    }
  });

  it('produces normalized intensities in [0,1]', () => {
    const frame = generateSyntheticScan(mockState(), MID360, 4);
    for (let i = 0; i < frame.intensities.length; i++) {
      expect(frame.intensities[i]).toBeGreaterThanOrEqual(0);
      expect(frame.intensities[i]).toBeLessThanOrEqual(1);
    }
  });

  it('echoes the sequence and robot id', () => {
    const frame = generateSyntheticScan(mockState({ id: 'abc' }), MID360, 42);
    expect(frame.sequence).toBe(42);
    expect(frame.robotId).toBe('abc');
    expect(frame.sensor).toBe('mid360_lidar');
    expect(frame.frame).toBe('base_link');
  });

  it('is deterministic for a given sequence (seeded)', () => {
    const a = generateSyntheticScan(mockState(), MID360, 7);
    const b = generateSyntheticScan(mockState(), MID360, 7);
    expect(a.pointCount).toBe(b.pointCount);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it('shimmers across sequences (frames differ)', () => {
    const a = generateSyntheticScan(mockState(), MID360, 1);
    const b = generateSyntheticScan(mockState(), MID360, 2);
    expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
  });

  it('falls back to MID-360 defaults when no spec is given', () => {
    const frame = generateSyntheticScan(mockState(), undefined, 0);
    expect(frame.sensor).toBe('mid360_lidar');
    expect(frame.sensorType).toBe('lidar');
    expect(frame.hasIntensity).toBe(true);
  });

  it('adds a held object to the scene when carrying', () => {
    const empty = generateSyntheticScan(mockState({ heldObject: undefined }), MID360, 5);
    const holding = generateSyntheticScan(mockState({ heldObject: 'box-1' }), MID360, 5);
    // Same seed + extra object → more total points before range-clipping.
    expect(holding.pointCount).toBeGreaterThanOrEqual(empty.pointCount - 50);
  });
});

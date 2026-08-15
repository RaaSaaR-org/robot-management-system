/**
 * @file occupancy-map.test.ts
 * @description The robot's own map (TASK-206): a wall lands where the wall is,
 *              from any heading; free space is traced up to it; no pose means
 *              no update; the grid grows without moving what it knows; and a
 *              stored map is only ever restored into the same odometry session.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { OccupancyMap } from '../occupancy-map.js';
import type { PointCloudFrame } from '../../robot/types.js';

/** A `base_link` frame in the real contract: flat XYZ, metres, floor at z = 0. */
function frameOf(points: Array<[number, number, number]>, origin?: [number, number, number]): PointCloudFrame {
  return {
    robotId: 'r1',
    sensor: 'mid360_lidar',
    sensorType: 'lidar',
    frame: 'base_link',
    pointCount: points.length,
    positions: points.flatMap((p) => p),
    intensities: [],
    hasIntensity: false,
    sequence: 0,
    ...(origin ? { origin } : {}),
    source: 'hardware',
    timestamp: new Date(0).toISOString(),
  };
}

/** A vertical wall `distM` straight ahead, spanning ±halfWidth, sampled every 5 cm, at 1 m height. */
function wallAhead(distM: number, halfWidthM = 1, samples = 41): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < samples; i++) {
    const y = -halfWidthM + (2 * halfWidthM * i) / (samples - 1);
    pts.push([distM, y, 1.0]);
  }
  return pts;
}

/** Repeat the same cloud so log-odds cross the classification thresholds. */
function integrateN(map: OccupancyMap, frame: PointCloudFrame, pose: { x: number; y: number; yawDeg: number }, n: number, t0 = 1000) {
  for (let i = 0; i < n; i++) map.integrate(frame, pose, t0 + i * 100);
}

describe('OccupancyMap', () => {
  it('marks a wall 2 m ahead occupied, the corridor before it free, and behind it unknown', () => {
    const map = new OccupancyMap();
    integrateN(map, frameOf(wallAhead(2.0)), { x: 0, y: 0, yawDeg: 0 }, 4);

    expect(map.cellAt(2.0, 0)).toBe('occupied');
    expect(map.cellAt(2.0, 0.5)).toBe('occupied');
    for (const x of [0.5, 1.0, 1.5, 1.85]) expect(map.cellAt(x, 0), `x=${x}`).toBe('free');
    expect(map.cellAt(2.5, 0)).toBe('unknown');
    expect(map.cellAt(4.0, 0)).toBe('unknown');
    // Off to the side, never in any ray: unknown.
    expect(map.cellAt(1.0, 3.0)).toBe('unknown');
    // The robot's own cell is where every ray starts: free, not unknown.
    expect(map.cellAt(0.05, 0)).toBe('free');
  });

  it('lands the same wall in the same world cells from a heading rotated 90°', () => {
    // Robot at (1, 1) facing +y: a wall 2 m "ahead" in base_link is at world y = 3.
    const map = new OccupancyMap();
    integrateN(map, frameOf(wallAhead(2.0)), { x: 1, y: 1, yawDeg: 90 }, 4);
    expect(map.cellAt(1.0, 3.0)).toBe('occupied');
    expect(map.cellAt(1.5, 3.0)).toBe('occupied');
    expect(map.cellAt(1.0, 2.0)).toBe('free');
    expect(map.cellAt(3.0, 1.0)).toBe('unknown');

    // The same world wall seen from a second pose reinforces, never contradicts.
    // Robot at (1, 2) facing +y sees it 1 m ahead.
    integrateN(map, frameOf(wallAhead(1.0)), { x: 1, y: 2, yawDeg: 90 }, 2);
    expect(map.cellAt(1.0, 3.0)).toBe('occupied');
    expect(map.logOddsAt(1.0, 3.0)!).toBeGreaterThan(2);
  });

  it('keeps a table that some rings pass OVER — free space is carved only up to the nearest return per bearing', () => {
    // 3 rings hit the table top at 2 m (z 0.7); 8 rings skim over it and hit
    // the wall at 3 m (z 1.0-1.5). Projected naively, the wall rays would carve
    // the table free 8:3.
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 41; i++) {
      const y = -1 + i * 0.05;
      for (let ring = 0; ring < 3; ring++) pts.push([2.0, y, 0.7 + ring * 0.02]);
      for (let ring = 0; ring < 8; ring++) pts.push([3.0, y * 1.5, 1.0 + ring * 0.06]);
    }
    const map = new OccupancyMap();
    integrateN(map, frameOf(pts), { x: 0, y: 0, yawDeg: 0 }, 4);
    expect(map.cellAt(2.0, 0)).toBe('occupied');
    expect(map.cellAt(2.0, 0.5)).toBe('occupied');
    expect(map.cellAt(3.0, 0)).toBe('occupied');
    expect(map.cellAt(1.0, 0)).toBe('free');
    // Between table and wall: occluded, therefore unknown — not free.
    expect(map.cellAt(2.5, 0)).toBe('unknown');
  });

  it('accounts for a sensor origin offset from the base', () => {
    const map = new OccupancyMap();
    // Sensor sits 0.3 m ahead of the base; a point 2 m from the BASE is 1.7 m from the sensor.
    integrateN(map, frameOf(wallAhead(2.0), [0.3, 0, 1.3]), { x: 0, y: 0, yawDeg: 0 }, 4);
    expect(map.cellAt(2.0, 0)).toBe('occupied');
    expect(map.cellAt(1.0, 0)).toBe('free');
  });

  it('does nothing without a pose (honest-null) or with the wrong frame', () => {
    const map = new OccupancyMap();
    const r = map.integrate(frameOf(wallAhead(2.0)), null);
    expect(r.integrated).toBe(false);
    expect(map.isAllocated()).toBe(false);
    expect(map.summary()).toEqual({ knownCells: 0, occupiedCells: 0, lastIntegratedAt: null });

    const sensorFrame = { ...frameOf(wallAhead(2.0)), frame: 'sensor' as const };
    expect(map.integrate(sensorFrame, { x: 0, y: 0, yawDeg: 0 }).integrated).toBe(false);
  });

  it('applies the height band and the blind radius, and treats far returns as free-only', () => {
    const map = new OccupancyMap({ maxRangeM: 3 });
    const pts: Array<[number, number, number]> = [
      [1.0, 0, 0.05], // floor return: dropped
      [1.0, 0, 2.5], // ceiling: dropped
      [0.2, 0, 1.0], // self-return inside 0.35 m: dropped
      [5.0, 0, 1.0], // beyond maxRange: free along the ray to 3 m, no hit
    ];
    const r = map.integrate(frameOf(pts), { x: 0, y: 0, yawDeg: 0 }, 1000);
    expect(r.pointsDropped).toBe(3);
    expect(r.pointsUsed).toBe(1);
    expect(r.hits).toBe(0);
    for (let i = 0; i < 4; i++) map.integrate(frameOf(pts), { x: 0, y: 0, yawDeg: 0 }, 2000 + i);
    expect(map.cellAt(1.0, 0)).toBe('free');
    expect(map.cellAt(2.5, 0)).toBe('free');
    expect(map.cellAt(5.0, 0)).toBe('unknown');
    expect(map.cellAt(3.5, 0)).toBe('unknown');
  });

  it('grows the grid without moving existing cells and caps at maxSizeM', () => {
    const map = new OccupancyMap({ initialSizeM: 4, maxSizeM: 16, maxRangeM: 50 });
    integrateN(map, frameOf(wallAhead(1.5, 0.5)), { x: 0, y: 0, yawDeg: 0 }, 4);
    const before = map.bounds();
    expect(before.width).toBe(40);
    expect(map.cellAt(1.5, 0)).toBe('occupied');

    // A return 6 m out to the LEFT (+y) is beyond the initial ±2 m box → grow +y.
    integrateN(map, frameOf(wallAhead(6, 0.5)), { x: 0, y: 0, yawDeg: 90 }, 4);
    const after = map.bounds();
    expect(after.height).toBeGreaterThan(before.height);
    expect(map.cellAt(1.5, 0)).toBe('occupied');
    expect(map.cellAt(0, 6.0)).toBe('occupied');
    // Grown toward +y only: the origin did not move.
    expect(after.originX).toBe(before.originX);
    expect(after.originY).toBe(before.originY);

    // Behind the robot far away → grow toward -x, origin moves, cells stay put.
    integrateN(map, frameOf(wallAhead(6, 0.5)), { x: 0, y: 0, yawDeg: 180 }, 4);
    const grownBack = map.bounds();
    expect(grownBack.originX).toBeLessThan(after.originX);
    expect(map.cellAt(1.5, 0)).toBe('occupied');
    expect(map.cellAt(0, 6.0)).toBe('occupied');
    expect(map.cellAt(-6.0, 0)).toBe('occupied');

    // Past the cap: dropped, not crashed, and the grid stays at the cap.
    const r = map.integrate(frameOf(wallAhead(40, 0.5)), { x: 0, y: 0, yawDeg: -90 }, 9000);
    expect(r.integrated).toBe(true);
    expect(r.pointsDropped).toBeGreaterThan(0);
    expect(map.bounds().height).toBeLessThanOrEqual(160);
    expect(map.cellAt(0, -40)).toBe('unknown');
  });

  it('round-trips through toSnapshot()/fromSnapshot() and refuses another session', () => {
    const map = new OccupancyMap({ frameId: 'boot-A' });
    integrateN(map, frameOf(wallAhead(2.0)), { x: 0, y: 0, yawDeg: 0 }, 4);
    const snap = map.toSnapshot();
    expect(snap.frame).toBe('odom');
    expect(snap.frameId).toBe('boot-A');
    expect(snap.knownCells).toBeGreaterThan(0);
    expect(snap.occupiedCells).toBeGreaterThan(0);

    const same = OccupancyMap.fromSnapshot(snap, { frameId: 'boot-A' });
    expect(same.map).not.toBeNull();
    expect(same.map!.cellAt(2.0, 0)).toBe('occupied');
    expect(same.map!.cellAt(1.0, 0)).toBe('free');
    expect(same.map!.cellAt(3.0, 0)).toBe('unknown');
    expect(same.map!.summary()).toEqual(map.summary());
    expect(same.map!.getPoseCount()).toBe(4);

    const other = OccupancyMap.fromSnapshot(snap, { frameId: 'boot-B' });
    expect(other.map).toBeNull();
    expect(other.reason).toMatch(/boot-A/);

    const unknownSession = OccupancyMap.fromSnapshot(snap, {});
    expect(unknownSession.map).toBeNull();

    const junk = OccupancyMap.fromSnapshot({ version: 1 }, { frameId: 'boot-A' });
    expect(junk.map).toBeNull();
  });

  it('isTraversable needs every cell within the radius to be free', () => {
    const map = new OccupancyMap();
    integrateN(map, frameOf(wallAhead(2.0, 2.0, 81)), { x: 0, y: 0, yawDeg: 0 }, 6);
    // Squarely in the traced corridor, well before the wall.
    expect(map.isTraversable(1.0, 0, 0.1)).toBe(true);
    // Touching the wall.
    expect(map.isTraversable(1.9, 0, 0.35)).toBe(false);
    // Unknown territory is not traversable.
    expect(map.isTraversable(-3, 0, 0.35)).toBe(false);
  });

  it('decays un-observed cells toward unknown when enabled', () => {
    const map = new OccupancyMap({ decayS: 10 });
    integrateN(map, frameOf(wallAhead(2.0)), { x: 0, y: 0, yawDeg: 0 }, 4, 1_000);
    expect(map.cellAt(2.0, 0)).toBe('occupied');
    // Much later, a cloud that no longer sees the wall (points elsewhere) triggers decay passes.
    const elsewhere = frameOf([[1.0, 3.0, 1.0]]);
    for (let i = 0; i < 40; i++) map.integrate(elsewhere, { x: 0, y: 0, yawDeg: 0 }, 60_000 + i * 1_500);
    expect(map.cellAt(2.0, 0)).toBe('unknown');
  });

  it('writes a PGM with the right dimensions', () => {
    const map = new OccupancyMap({ initialSizeM: 2 });
    integrateN(map, frameOf(wallAhead(0.8, 0.3)), { x: 0, y: 0, yawDeg: 0 }, 4);
    const pgm = map.toPgm();
    const header = pgm.subarray(0, 120).toString('ascii');
    expect(header.startsWith('P5\n')).toBe(true);
    expect(header).toContain('20 20');
    expect(pgm.length).toBeGreaterThan(400);
  });
});

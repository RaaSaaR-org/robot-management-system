/**
 * @file range.test.ts
 * @description Point cloud → distance. Covers the real MID-360's dominant
 *              failure mode (the sub-0.3 m self-return blob), the height band,
 *              the ±180° wrap, the corridor clearance, and the rule that a
 *              missing measurement is `null` and never a number.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { RangeSensor, forwardClearance, rangeAtBearing, rangesAtBearings } from '../range.js';
import type { PointCloudFrame } from '../../robot/types.js';

const DEG = Math.PI / 180;

/** A frame in the real contract: flat XYZ, metres, base_link, floor at z = 0. */
function frameOf(points: Array<[number, number, number]>): PointCloudFrame {
  const positions = points.flatMap((p) => p);
  return {
    robotId: 'test-g1',
    sensor: 'mid360_lidar',
    sensorType: 'lidar',
    frame: 'base_link',
    pointCount: points.length,
    positions,
    intensities: [],
    hasIntensity: false,
    sequence: 1,
    source: 'hardware',
    timestamp: '2026-07-18T12:00:00.000Z',
  };
}

/**
 * `count` returns at exactly `rangeM` horizontal range, fanned over ±1.5°
 * around `bearingDeg` so they all sit inside the default 8° cone.
 */
function arcAt(
  rangeM: number,
  bearingDeg: number,
  count = 12,
  heightM = 1.0
): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const spreadDeg = count === 1 ? 0 : -1.5 + (3 * i) / (count - 1);
    const az = (bearingDeg + spreadDeg) * DEG;
    points.push([rangeM * Math.cos(az), rangeM * Math.sin(az), heightM]);
  }
  return points;
}

describe('rangeAtBearing', () => {
  it('measures a wall at a known range and bearing', () => {
    const reading = rangeAtBearing(frameOf(arcAt(2.31, 17.7)), 17.7);

    expect(reading).not.toBeNull();
    expect(reading!.distanceM).toBeCloseTo(2.31, 2);
    expect(reading!.pointCount).toBe(12);
    // Every return is on one arc at one range → a flat surface, not a scatter.
    expect(reading!.spreadM).toBeCloseTo(0, 3);
    expect(reading!.bearingDeg).toBeCloseTo(17.7, 6);
    expect(reading!.halfAngleDeg).toBe(8);
  });

  it('reports the horizontal distance, not the 3D slant range', () => {
    // A table top 1.2 m up, 1.0 m ahead: 1.56 m of slant range, 1.0 m of walking.
    const reading = rangeAtBearing(frameOf(arcAt(1.0, 0, 12, 1.2)), 0);

    expect(reading!.distanceM).toBeCloseTo(1.0, 3);
  });

  it('IGNORES THE SELF-RETURN BLOB: 200 points at 0.1 m do not beat a wall at 2.5 m', () => {
    // About half of every raw MID-360 frame is the sensor seeing its own
    // housing at < 0.3 m. A naive min(range) answers 0.1 here, and `goto` would
    // believe it had already arrived at everything it ever looked at.
    const blob: Array<[number, number, number]> = [];
    for (let i = 0; i < 200; i++) {
      const az = (-3 + (6 * i) / 199) * DEG;
      blob.push([0.1 * Math.cos(az), 0.1 * Math.sin(az), 1.0]);
    }
    const reading = rangeAtBearing(frameOf([...blob, ...arcAt(2.5, 0)]), 0);

    expect(reading!.distanceM).toBeCloseTo(2.5, 2);
    expect(reading!.pointCount).toBe(12);
  });

  it('reports the near face, not the single nearest stray return', () => {
    // One stray (dust, a mixed pixel on an edge) at 1.0 m in front of 20 wall
    // returns at 3.0 m. The 20th percentile ignores it; a minimum would not.
    const stray = arcAt(1.0, 0, 1);
    const reading = rangeAtBearing(frameOf([...stray, ...arcAt(3.0, 0, 20)]), 0);

    expect(reading!.distanceM).toBeCloseTo(3.0, 3);
    expect(reading!.pointCount).toBe(21);
  });

  it('reports spread so a caller can tell a wall from a scatter', () => {
    // 11 returns evenly from 2.0 m to 3.0 m in one cone: p20 = 2.2 (near face),
    // p90 − p10 = 2.9 − 2.1 = 0.8 → "several things at different depths".
    const points = Array.from({ length: 11 }, (_, i) => arcAt(2.0 + i * 0.1, 0, 1)[0]);
    const reading = rangeAtBearing(frameOf(points), 0);

    expect(reading!.distanceM).toBeCloseTo(2.2, 6);
    expect(reading!.spreadM).toBeCloseTo(0.8, 6);
  });

  it('rejects floor and ceiling returns by height band', () => {
    const floor = arcAt(1.0, 0, 20, 0.01);
    const ceiling = arcAt(1.2, 0, 20, 2.4);

    // Floor + ceiling only → nothing in the band → unknown, not 1.0 m.
    expect(rangeAtBearing(frameOf([...floor, ...ceiling]), 0)).toBeNull();

    // With a real surface behind them, the surface is what gets reported.
    const reading = rangeAtBearing(frameOf([...floor, ...ceiling, ...arcAt(3.0, 0)]), 0);
    expect(reading!.distanceM).toBeCloseTo(3.0, 3);
    expect(reading!.pointCount).toBe(12);
  });

  it('rejects returns beyond maxRangeM', () => {
    expect(rangeAtBearing(frameOf(arcAt(20, 0)), 0)).toBeNull();
    expect(rangeAtBearing(frameOf(arcAt(20, 0)), 0, { maxRangeM: 25 })!.distanceM).toBeCloseTo(20, 2);
  });

  it('returns null for an empty cloud — unknown is not "clear"', () => {
    expect(rangeAtBearing(frameOf([]), 0)).toBeNull();
    expect(rangeAtBearing(null, 0)).toBeNull();
  });

  it('returns null when every return is outside the cone', () => {
    // A wall 40° to the left says nothing about what is straight ahead.
    expect(rangeAtBearing(frameOf(arcAt(2.0, 40)), 0)).toBeNull();
    // ...and the same cloud measured at its own bearing does resolve.
    expect(rangeAtBearing(frameOf(arcAt(2.0, 40)), 40)!.distanceM).toBeCloseTo(2.0, 3);
  });

  it('returns null for a handful of returns — speckle is not a surface', () => {
    expect(rangeAtBearing(frameOf(arcAt(2.0, 0, 5)), 0)).toBeNull();
    expect(rangeAtBearing(frameOf(arcAt(2.0, 0, 6)), 0)!.pointCount).toBe(6);
  });

  it('handles the ±180° wrap: a bearing of 179° matches returns at -179°', () => {
    const behind = frameOf(arcAt(2.0, -179));

    const reading = rangeAtBearing(behind, 179);
    expect(reading).not.toBeNull();
    expect(reading!.distanceM).toBeCloseTo(2.0, 3);
    expect(reading!.pointCount).toBe(12);

    // 181° is the same direction as -179°, and must behave identically.
    expect(rangeAtBearing(behind, 181)!.distanceM).toBeCloseTo(2.0, 3);
    // ...while a bearing 20° away from it still finds nothing.
    expect(rangeAtBearing(behind, 159)).toBeNull();
  });

  it('honours a widened cone', () => {
    // 12° off-axis: outside the default ±8°, inside ±15°.
    expect(rangeAtBearing(frameOf(arcAt(2.0, 12)), 0)).toBeNull();
    expect(rangeAtBearing(frameOf(arcAt(2.0, 12)), 0, { halfAngleDeg: 15 })!.distanceM).toBeCloseTo(
      2.0,
      2
    );
  });
});

describe('rangesAtBearings', () => {
  it('answers every bearing from one frame, with null where nothing is seen', () => {
    const frame = frameOf([...arcAt(1.5, -30), ...arcAt(4.0, 25)]);

    const readings = rangesAtBearings(frame, [-30, 25, 90]);

    expect(readings[0]!.distanceM).toBeCloseTo(1.5, 3);
    expect(readings[1]!.distanceM).toBeCloseTo(4.0, 3);
    expect(readings[2]).toBeNull();
  });

  it('matches rangeAtBearing exactly, so the batched path cannot drift', () => {
    const frame = frameOf([...arcAt(2.31, 17.7), ...arcAt(3.4, -12)]);

    expect(rangesAtBearings(frame, [17.7, -12])).toEqual([
      rangeAtBearing(frame, 17.7),
      rangeAtBearing(frame, -12),
    ]);
  });

  it('returns all nulls for a missing frame instead of throwing', () => {
    expect(rangesAtBearings(null, [0, 30])).toEqual([null, null]);
  });
});

describe('forwardClearance', () => {
  it('sees an obstacle off-axis but inside the corridor, and ignores one outside it', () => {
    // Chair leg at x = 1.5, y = 0.30 → inside the ±0.35 m corridor.
    const inside: Array<[number, number, number]> = Array.from({ length: 12 }, (_, i) => [
      1.5,
      0.28 + i * 0.005,
      0.9,
    ]);
    // Doorframe at x = 1.0, y = 0.60 → the robot walks past it.
    const outside: Array<[number, number, number]> = Array.from({ length: 12 }, (_, i) => [
      1.0,
      0.6 + i * 0.005,
      0.9,
    ]);
    const wall = Array.from({ length: 12 }, (_, i): [number, number, number] => [
      3.0,
      -0.3 + i * 0.05,
      1.0,
    ]);

    expect(forwardClearance(frameOf([...inside, ...outside, ...wall]))).toBeCloseTo(1.5, 3);
    // Without the near obstacle, the wall behind it is the clearance.
    expect(forwardClearance(frameOf([...outside, ...wall]))).toBeCloseTo(3.0, 3);
  });

  it('is unknown, not zero, when only the self-return blob is present', () => {
    const blob = Array.from({ length: 50 }, (_, i): [number, number, number] => [
      0.1,
      -0.05 + i * 0.002,
      1.0,
    ]);

    expect(forwardClearance(frameOf(blob))).toBeNull();
  });

  it('ignores what is behind the robot', () => {
    const behind = Array.from({ length: 12 }, (_, i): [number, number, number] => [
      -1.5,
      -0.2 + i * 0.03,
      1.0,
    ]);

    expect(forwardClearance(frameOf(behind))).toBeNull();
  });

  it('returns null for an empty cloud', () => {
    expect(forwardClearance(frameOf([]))).toBeNull();
    expect(forwardClearance(null)).toBeNull();
  });

  /**
   * The regression this guards is a real measurement, not a hypothetical.
   * Standing 2.5 m in front of the room scene's table with the sim's ray-LiDAR,
   * the corridor holds a handful of returns off the table's near edge at 1.83 m
   * and a great many off the wall 3.2 m behind it. An order statistic over all
   * of them is outvoted by the wall and reports more free space than exists —
   * on the one obstacle `forwardClearance` is there to stop the robot hitting.
   */
  it('reports a MINORITY obstacle, not the wall behind it', () => {
    // 8 returns off a table edge at 1.83 m, 60 off the wall at 3.2 m: the
    // obstacle is 12% of the corridor, well under any low percentile.
    const table = Array.from({ length: 8 }, (_, i): [number, number, number] => [
      1.83 + i * 0.005,
      -0.15 + i * 0.04,
      0.75,
    ]);
    const wall = Array.from({ length: 60 }, (_, i): [number, number, number] => [
      3.2,
      -0.34 + i * 0.011,
      1.0,
    ]);

    expect(forwardClearance(frameOf([...table, ...wall]))).toBeCloseTo(1.83, 2);
    // p20 over the same corridor would have answered the wall — the exact
    // failure mode, kept here so a future "simplification" back to a plain
    // percentile fails loudly.
    expect(forwardClearance(frameOf([...table, ...wall]), { clusterDepthM: 0 })).toBeCloseTo(3.2, 2);
  });

  it('still ignores a lone stray in front of a real surface', () => {
    // One mixed pixel at 0.9 m has no neighbours, so it is not a surface; the
    // wall behind it is. This is what the cluster rule buys over a plain min().
    const stray: Array<[number, number, number]> = [[0.9, 0.0, 1.0]];
    const wall = Array.from({ length: 20 }, (_, i): [number, number, number] => [
      3.0,
      -0.3 + i * 0.03,
      1.0,
    ]);

    expect(forwardClearance(frameOf([...stray, ...wall]))).toBeCloseTo(3.0, 3);
  });
});

describe('RangeSensor', () => {
  const goodFrame = () => frameOf([...arcAt(2.5, 0), ...arcAt(1.2, 35)]);

  it('answers every bearing from ONE snapshot', async () => {
    const snapshot = vi.fn(async () => goodFrame());
    const sensor = new RangeSensor({ snapshot, enabled: true });

    const result = await sensor.measure([0, 35, -60]);

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.readings[0]!.distanceM).toBeCloseTo(2.5, 2);
    expect(result.readings[1]!.distanceM).toBeCloseTo(1.2, 2);
    expect(result.readings[2]).toBeNull();
    // The 35° cluster is 0.69 m to the side, outside the shoulder-wide
    // corridor, so what blocks the walk is the wall dead ahead at 2.5 m.
    expect(result.clearanceM).toBeCloseTo(2.5, 2);
  });

  it('does not throw when the sidecar is absent — it degrades', async () => {
    const snapshot = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const sensor = new RangeSensor({ snapshot, enabled: true });

    const result = await sensor.measure([0, 20]);

    expect(result.ok).toBe(false);
    expect(result.readings).toEqual([null, null]);
    expect(result.clearanceM).toBeNull();
    expect(result.reason).toContain('fetch failed');
  });

  it('caches the failure so eight entities do not cost eight timeouts', async () => {
    const snapshot = vi.fn(async () => {
      throw new Error('timeout');
    });
    const sensor = new RangeSensor({ snapshot, enabled: true });

    await sensor.measure([0]);
    await sensor.measure([10]);
    expect(snapshot).toHaveBeenCalledTimes(1);

    sensor.invalidate();
    await sensor.measure([20]);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('invalidateAfterMotion drops a cloud — a cone must not be aimed from the old pose', async () => {
    const snapshot = vi.fn(async () => goodFrame());
    const sensor = new RangeSensor({ snapshot, enabled: true });

    await sensor.measure([0]);
    await sensor.measure([0]);
    expect(snapshot).toHaveBeenCalledTimes(1); // still inside the cache window

    sensor.invalidateAfterMotion();
    await sensor.measure([0]);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('invalidateAfterMotion KEEPS a cached failure — walking does not conjure a sidecar', async () => {
    // The asymmetry is the point: a cloud goes stale when the robot moves, a
    // missing sidecar does not come back, and re-probing it costs 1.5 s a look.
    const snapshot = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const sensor = new RangeSensor({ snapshot, enabled: true });

    await sensor.measure([0]);
    sensor.invalidateAfterMotion();
    const result = await sensor.measure([0]);

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('treats a zero-point cloud as unknown, not as a clear path', async () => {
    const sensor = new RangeSensor({ snapshot: async () => frameOf([]), enabled: true });

    const result = await sensor.measure([0]);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty/i);
    expect(result.readings).toEqual([null]);
    expect(result.clearanceM).toBeNull();
  });

  it('reports not-ok when disabled, without touching the sensor', async () => {
    const snapshot = vi.fn(async () => goodFrame());
    const sensor = new RangeSensor({ snapshot, enabled: false });

    const result = await sensor.measure([0]);

    expect(snapshot).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.readings).toEqual([null]);
  });

  it('lets explicit options override the config-derived defaults', async () => {
    const sensor = new RangeSensor({
      snapshot: async () => frameOf(arcAt(2.0, 12)),
      enabled: true,
      options: { halfAngleDeg: 15 },
    });

    expect((await sensor.measure([0])).readings[0]!.distanceM).toBeCloseTo(2.0, 2);
  });

  // TASK-206: the occupancy map hangs off the ONE place clouds arrive.
  it('hands every FRESH cloud to the frame listener — never a cache hit, never a failure', async () => {
    const frame = frameOf([[2, 0, 1]]);
    let calls = 0;
    const snapshot = vi.fn(async () => {
      if (calls++ === 2) throw new Error('sidecar down');
      return frame;
    });
    const seen: number[] = [];
    const sensor = new RangeSensor({ snapshot, cacheMs: 100_000, onFrame: (f, at) => seen.push(at) });

    await sensor.measure([0]);
    await sensor.measure([0]); // cache hit
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);

    sensor.invalidate();
    await sensor.measure([0]);
    expect(seen).toHaveLength(2);

    sensor.invalidate();
    const m = await sensor.measure([0]); // throws inside → not handed over
    expect(m.ok).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it('probe() takes a snapshot for the listener only, honours the cache and never throws', async () => {
    const snapshot = vi.fn(async () => frameOf([[2, 0, 1]]));
    const seen: number[] = [];
    const sensor = new RangeSensor({ snapshot, cacheMs: 100_000 });
    sensor.setFrameListener((_f, at) => seen.push(at));
    expect(await sensor.probe()).toBe(true);
    expect(await sensor.probe()).toBe(true); // cached — no second fetch
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);

    const dead = new RangeSensor({ snapshot: async () => { throw new Error('nope'); } });
    expect(await dead.probe()).toBe(false);
    const off = new RangeSensor({ snapshot, enabled: false });
    expect(await off.probe()).toBe(false);
  });

  it('a throwing frame listener never fails the observation', async () => {
    const sensor = new RangeSensor({
      snapshot: async () => frameOf([[2, 0, 1]]),
      cacheMs: 0,
      onFrame: () => { throw new Error('map exploded'); },
    });
    const m = await sensor.measure([0]);
    expect(m.ok).toBe(true);
    expect(m.readings).toHaveLength(1);
  });
});

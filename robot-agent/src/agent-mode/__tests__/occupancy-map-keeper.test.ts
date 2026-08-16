/**
 * @file occupancy-map-keeper.test.ts
 * @description The map's chaperone (TASK-206): frames pair with a pose or not
 *              at all, a stale pose is re-sampled rather than trusted, the map
 *              follows the sidecar's boot id (restore only into the same
 *              odometry session, reset when it changes), and the sweep only
 *              ever goes through the range sensor's own snapshot path.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MapKeeper } from '../occupancy-map-keeper.js';
import { RangeSensor } from '../range.js';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';
import type { PointCloudFrame } from '../../robot/types.js';

function wallFrame(distM = 2): PointCloudFrame {
  const pts: number[] = [];
  for (let i = 0; i < 41; i++) pts.push(distM, -1 + i * 0.05, 1.0);
  return {
    robotId: 'r1',
    sensor: 'mid360_lidar',
    sensorType: 'lidar',
    frame: 'base_link',
    pointCount: 41,
    positions: pts,
    intensities: [],
    hasIntensity: false,
    sequence: 0,
    source: 'hardware',
    timestamp: new Date().toISOString(),
  };
}

const poseAt = (atMs: number, over: Partial<CachedBasePose> = {}): CachedBasePose => ({
  x: 0,
  y: 0,
  yawDeg: 0,
  source: 'sim',
  atMs,
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'map-keeper-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function makeRange(frame = wallFrame()) {
  const snapshot = vi.fn(async () => frame);
  return { range: new RangeSensor({ snapshot, cacheMs: 0 }), snapshot };
}

describe('MapKeeper', () => {
  it('integrates a fresh frame paired with a fresh pose, and reports a summary', async () => {
    const { range } = makeRange();
    const logs: string[] = [];
    const keeper = new MapKeeper({
      enabled: true,
      range,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: (m) => logs.push(m),
    });
    for (let i = 0; i < 4; i++) await range.measure([0]);
    await flush();
    const s = keeper.summary()!;
    expect(s.knownCells).toBeGreaterThan(0);
    expect(s.occupiedCells).toBeGreaterThan(0);
    expect(s.lastIntegratedAt).not.toBeNull();
    expect(keeper.getMap()!.cellAt(2, 0)).toBe('occupied');
    expect(keeper.status().integrations).toBe(4);
    expect(keeper.getMap()!.frameId).toBe('boot-A');
    // The map is a passenger: no chatter on the happy path.
    expect(logs.filter((l) => !l.includes('restored'))).toEqual([]);
  });

  it('skips honestly without a pose, and never assumes the origin', async () => {
    const { range } = makeRange();
    const logs: string[] = [];
    const keeper = new MapKeeper({
      enabled: true,
      range,
      getPose: () => null,
      getBootId: () => 'boot-A',
      log: (m) => logs.push(m),
    });
    await range.measure([0]);
    await range.measure([0]);
    await flush();
    expect(keeper.summary()).toEqual({ knownCells: 0, occupiedCells: 0, lastIntegratedAt: null });
    expect(keeper.status().skippedNoPose).toBe(2);
    // Logged once, not once per frame.
    expect(logs.filter((l) => l.includes('no pose'))).toHaveLength(1);
  });

  it('re-samples a stale pose instead of trusting it, and skips when it stays stale', async () => {
    const { range } = makeRange();
    const samplePose = vi.fn(async () => poseAt(Date.now(), { x: 1 }));
    const keeper = new MapKeeper({
      enabled: true,
      range,
      getPose: () => poseAt(Date.now() - 5000),
      samplePose,
      getBootId: () => 'boot-A',
      log: () => {},
    });
    for (let i = 0; i < 4; i++) await range.measure([0]);
    await flush();
    expect(samplePose).toHaveBeenCalledTimes(4);
    // Integrated at the SAMPLED pose (x = 1): the wall 2 m ahead sits at x = 3.
    expect(keeper.getMap()!.cellAt(3, 0)).toBe('occupied');
    expect(keeper.status().skippedStalePose).toBe(0);

    const stale = new MapKeeper({
      enabled: true,
      range,
      getPose: () => poseAt(Date.now() - 5000),
      samplePose: async () => poseAt(Date.now() - 4000),
      getBootId: () => 'boot-A',
      log: () => {},
    });
    await range.measure([0]);
    await flush();
    expect(stale.status().skippedStalePose).toBe(1);
    expect(stale.summary()!.knownCells).toBe(0);
  });

  it('persists under the boot id and restores only into the same session', async () => {
    const path = join(dir, 'occupancy-map.json');
    const { range } = makeRange();
    const keeper = new MapKeeper({
      enabled: true,
      range,
      path,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: () => {},
    });
    for (let i = 0; i < 4; i++) await range.measure([0]);
    await flush();
    expect(existsSync(path)).toBe(false); // not yet — every 50th, or on dispose
    keeper.dispose();
    expect(existsSync(path)).toBe(true);

    // Same session: restored, first frame lands on top of the old wall.
    const logsA: string[] = [];
    const { range: rangeA } = makeRange();
    const again = new MapKeeper({
      enabled: true,
      range: rangeA,
      path,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: (m) => logsA.push(m),
    });
    await rangeA.measure([0]);
    await flush();
    expect(logsA.some((l) => l.includes('restored'))).toBe(true);
    expect(again.getMap()!.getPoseCount()).toBe(5);
    expect(again.getMap()!.cellAt(2, 0)).toBe('occupied');

    // Different session: refused with a reason, starts empty.
    const logsB: string[] = [];
    const { range: rangeB } = makeRange();
    const other = new MapKeeper({
      enabled: true,
      range: rangeB,
      path,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-B',
      log: (m) => logsB.push(m),
    });
    await rangeB.measure([0]);
    await flush();
    expect(logsB.some((l) => l.includes('not restoring') && l.includes('boot-A'))).toBe(true);
    expect(other.getMap()!.getPoseCount()).toBe(1);
  });

  it('never persists or restores without a boot id, and says so once', async () => {
    const path = join(dir, 'occupancy-map.json');
    const { range } = makeRange();
    const logs: string[] = [];
    const keeper = new MapKeeper({
      enabled: true,
      range,
      path,
      getPose: () => poseAt(Date.now()),
      getBootId: () => null,
      log: (m) => logs.push(m),
    });
    for (let i = 0; i < 3; i++) await range.measure([0]);
    await flush();
    expect(keeper.getMap()!.frameId).toBeNull();
    expect(keeper.summary()!.knownCells).toBeGreaterThan(0);
    keeper.dispose();
    expect(existsSync(path)).toBe(false);
    expect(logs.filter((l) => l.includes('no boot_id'))).toHaveLength(1);
  });

  it('starts a new map when the sidecar boot id changes mid-run', async () => {
    const { range } = makeRange();
    let bootId = 'boot-A';
    const logs: string[] = [];
    const keeper = new MapKeeper({
      enabled: true,
      range,
      getPose: () => poseAt(Date.now()),
      getBootId: () => bootId,
      log: (m) => logs.push(m),
    });
    for (let i = 0; i < 4; i++) await range.measure([0]);
    await flush();
    expect(keeper.getMap()!.getPoseCount()).toBe(4);
    bootId = 'boot-B';
    await range.measure([0]);
    await flush();
    expect(keeper.getMap()!.frameId).toBe('boot-B');
    expect(keeper.getMap()!.getPoseCount()).toBe(1);
    expect(logs.some((l) => l.includes('session changed'))).toBe(true);
  });

  it('does nothing at all when disabled', async () => {
    const { range } = makeRange();
    const keeper = new MapKeeper({
      enabled: false,
      range,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: () => {},
    });
    await range.measure([0]);
    await flush();
    expect(keeper.summary()).toBeNull();
    expect(keeper.snapshot()).toBeNull();
    expect(keeper.getMap()).toBeNull();
  });

  it('sweeps through the range sensor while active, honouring its cache, and stops when told', async () => {
    vi.useFakeTimers();
    const { range, snapshot } = makeRange();
    const keeper = new MapKeeper({
      enabled: true,
      sweepHz: 2,
      range,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: () => {},
    });
    expect(keeper.isSweeping()).toBe(false);
    keeper.setSweeping(true);
    expect(keeper.isSweeping()).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(snapshot.mock.calls.length).toBeGreaterThanOrEqual(3);
    const n = snapshot.mock.calls.length;
    keeper.setSweeping(false);
    expect(keeper.isSweeping()).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshot.mock.calls.length).toBe(n);
    // And the frames it pulled fed the map.
    expect(keeper.status().integrations).toBeGreaterThan(0);
  });

  it('does not sweep when the range sensor is disabled or sweepHz is 0', () => {
    const { range } = makeRange();
    const off = new MapKeeper({
      enabled: true,
      sweepHz: 0,
      range,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: () => {},
    });
    off.setSweeping(true);
    expect(off.isSweeping()).toBe(false);

    const disabledRange = new RangeSensor({ snapshot: async () => wallFrame(), enabled: false });
    const noSensor = new MapKeeper({
      enabled: true,
      sweepHz: 1,
      range: disabledRange,
      getPose: () => poseAt(Date.now()),
      getBootId: () => 'boot-A',
      log: () => {},
    });
    noSensor.setSweeping(true);
    expect(noSensor.isSweeping()).toBe(false);
  });
});

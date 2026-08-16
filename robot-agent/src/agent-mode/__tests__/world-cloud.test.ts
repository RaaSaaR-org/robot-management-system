/**
 * @file world-cloud.test.ts
 * @description The world cloud (TASK-211): frames land in the odometry frame
 *              through the pose, one point per voxel, oldest evicted at the
 *              cap, freed cells purge their voxels, snapshots round-trip and
 *              refuse the wrong frame, PCD/PLY headers are right, and the
 *              keeper feeds and persists it alongside the grid.
 * @feature agent-mode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldCloud } from '../world-cloud.js';
import { OccupancyMap } from '../occupancy-map.js';
import { MapKeeper } from '../occupancy-map-keeper.js';
import { RangeSensor } from '../range.js';
import type { PointCloudFrame } from '../../robot/types.js';

function frameOf(points: Array<[number, number, number]>): PointCloudFrame {
  return {
    robotId: 'r1', sensor: 'mid360_lidar', sensorType: 'lidar', frame: 'base_link',
    pointCount: points.length, positions: points.flat(), intensities: [], hasIntensity: false,
    sequence: 0, source: 'hardware', timestamp: new Date().toISOString(),
  };
}
/** A wall 2 m ahead in base_link, 41 points across, at height 1 m. */
function wallFrame(distM = 2, z = 1.0): PointCloudFrame {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < 41; i++) pts.push([distM, -1 + i * 0.05, z]);
  return frameOf(pts);
}

describe('WorldCloud.integrate', () => {
  it('rotates and translates base_link points into odom through the pose', () => {
    const cloud = new WorldCloud({ frameId: 'b' });
    // Robot at (1, 2) facing +y (yaw 90): a point 2 m ahead is at (1, 4).
    const r = cloud.integrate(frameOf([[2, 0, 1]]), { x: 1, y: 2, yawDeg: 90 }, 1000);
    expect(r).toEqual({ integrated: true, pointsUsed: 1, added: 1, refreshed: 0 });
    // Stored as the voxel centre (5 cm voxels): within half a voxel of the true point.
    const { positions } = cloud.positions();
    expect(positions[0]).toBeCloseTo(1, 1);
    expect(positions[1]).toBeCloseTo(4, 1);
    expect(positions[2]).toBeCloseTo(1, 1);
    expect(Math.abs(positions[0] - 1)).toBeLessThanOrEqual(0.025 + 1e-6);
  });

  it('keeps one point per voxel and refreshes rather than duplicates', () => {
    const cloud = new WorldCloud({ frameId: 'b', voxelM: 0.05 });
    cloud.integrate(frameOf([[2, 0, 1], [2.01, 0.01, 1.01]]), { x: 0, y: 0, yawDeg: 0 }, 1000);
    expect(cloud.pointCount).toBe(1);
    const r = cloud.integrate(frameOf([[2, 0, 1]]), { x: 0, y: 0, yawDeg: 0 }, 2000);
    expect(r.refreshed).toBe(1);
    expect(cloud.pointCount).toBe(1);
  });

  it('drops the robot body, far returns, sub-floor and ceiling points', () => {
    const cloud = new WorldCloud({ frameId: 'b', minRangeM: 0.3, maxRangeM: 5, minZM: -0.2, maxZM: 2.4 });
    const r = cloud.integrate(frameOf([[0.1, 0, 1], [6, 0, 1], [2, 0, -1], [2, 0, 3], [2, 0, 1]]), { x: 0, y: 0, yawDeg: 0 });
    expect(r.pointsUsed).toBe(1);
  });

  it('refuses frames that are not base_link and poses that are not numbers', () => {
    const cloud = new WorldCloud({ frameId: 'b' });
    expect(cloud.integrate({ ...frameOf([[2, 0, 1]]), frame: 'sensor' }, { x: 0, y: 0, yawDeg: 0 }).integrated).toBe(false);
    expect(cloud.integrate(frameOf([[2, 0, 1]]), null).integrated).toBe(false);
    expect(cloud.integrate(frameOf([[2, 0, 1]]), { x: NaN, y: 0, yawDeg: 0 }).integrated).toBe(false);
  });

  it('evicts the voxels seen longest ago once over the cap', () => {
    const cloud = new WorldCloud({ frameId: 'b', maxPoints: 3, voxelM: 0.1 });
    cloud.integrate(frameOf([[2, 0, 1]]), { x: 0, y: 0, yawDeg: 0 }, 1000); // oldest
    cloud.integrate(frameOf([[2, 1, 1], [2, 2, 1]]), { x: 0, y: 0, yawDeg: 0 }, 2000);
    cloud.integrate(frameOf([[2, 0, 1]]), { x: 0, y: 0, yawDeg: 0 }, 3000); // refreshed → now newest
    cloud.integrate(frameOf([[2, 3, 1]]), { x: 0, y: 0, yawDeg: 0 }, 4000); // pushes one out
    expect(cloud.pointCount).toBe(3);
    const ys = Array.from(cloud.positions().positions).filter((_, i) => i % 3 === 1).map((v) => Math.floor(v)).sort();
    expect(ys).toEqual([0, 2, 3]); // y=1 (seen at 2000, never refreshed) is the one that went
  });
});

describe('WorldCloud.purgeFreed', () => {
  it('deletes voxels in the grid band whose cell became free, keeps floor/ceiling and far ones', () => {
    const grid = new OccupancyMap({ initialSizeM: 20, frameId: 'b' });
    // Carve the cell at (2, 0) free: a wall at 4 m traces free space through 2 m.
    for (let i = 0; i < 6; i++) grid.integrate(wallFrame(4), { x: 0, y: 0, yawDeg: 0 }, 1000 + i);
    expect(grid.cellAt(2, 0)).toBe('free');
    const cloud = new WorldCloud({ frameId: 'b', voxelM: 0.05, minZM: -1, maxZM: 5 });
    // A stale point at (2, 0, 1) — the object that was carried away — plus a
    // floor point under it, and one 8 m away in a free cell but out of reach.
    cloud.integrate(frameOf([[2, 0, 1], [2, 0, -0.5]]), { x: 0, y: 0, yawDeg: 0 }, 500);
    for (let i = 0; i < 6; i++) grid.integrate(wallFrame(10), { x: 0, y: 0, yawDeg: 0 }, 2000 + i);
    cloud.integrate(frameOf([[8, 0, 1]]), { x: 0, y: 0, yawDeg: 0 }, 600);
    expect(cloud.pointCount).toBe(3);
    const purged = cloud.purgeFreed(grid, { x: 0, y: 0, radiusM: 5 });
    expect(purged).toBe(1);
    const xs = Array.from(cloud.positions().positions).filter((_, i) => i % 3 === 0).map((v) => Math.round(v));
    expect(xs.sort()).toEqual([2, 8]); // the floor point (z −0.5, outside the band) and the far one survive
    expect(cloud.purgeFreed(grid)).toBe(1); // no `near`: the far one goes too
  });
});

describe('WorldCloud snapshots and files', () => {
  it('round-trips through toSnapshot/fromSnapshot and refuses another frame', () => {
    const cloud = new WorldCloud({ frameId: 'boot-A', voxelM: 0.05 });
    cloud.integrate(wallFrame(2), { x: 0.3, y: -0.2, yawDeg: 30 }, 5000);
    const snap = cloud.toSnapshot();
    expect(snap.pointCount).toBe(cloud.pointCount);
    const back = WorldCloud.fromSnapshot(JSON.parse(JSON.stringify(snap)), { frameId: 'boot-A' });
    expect(back.cloud!.pointCount).toBe(cloud.pointCount);
    expect(Array.from(back.cloud!.positions().positions)).toEqual(Array.from(cloud.positions().positions));
    expect(back.cloud!.getFrames()).toBe(1);
    expect(WorldCloud.fromSnapshot(snap, { frameId: 'boot-B' }).cloud).toBeNull();
    expect(WorldCloud.fromSnapshot({ ...snap, positions: 'AAAA' }, { frameId: 'boot-A' }).cloud).toBeNull();
  });

  it('samples an even stride when asked for fewer points', () => {
    const cloud = new WorldCloud({ frameId: 'b', voxelM: 0.05 });
    cloud.integrate(wallFrame(2), { x: 0, y: 0, yawDeg: 0 });
    const { positions, total } = cloud.positions(10);
    expect(total).toBe(41);
    expect(positions.length).toBe(30);
    expect(cloud.positions(0).positions.length).toBe(123);
  });

  it('writes PCD and PLY headers that name the point count, then the raw floats', () => {
    const cloud = new WorldCloud({ frameId: 'b', voxelM: 0.05 });
    cloud.integrate(wallFrame(2), { x: 0, y: 0, yawDeg: 0 });
    const pcd = cloud.toPcd();
    const head = pcd.toString('ascii', 0, 300);
    expect(head).toContain('FIELDS x y z');
    expect(head).toContain('POINTS 41');
    expect(head).toContain('DATA binary\n');
    expect(pcd.length).toBe(head.indexOf('DATA binary\n') + 'DATA binary\n'.length + 41 * 12);
    const ply = cloud.toPly();
    expect(ply.toString('ascii', 0, 200)).toContain('element vertex 41');
    expect(ply.toString('ascii', 0, 200)).toContain('end_header\n');
    // First float after the header is the first point's x = 2.
    const off = ply.indexOf('end_header\n') + 'end_header\n'.length;
    expect(ply.readFloatLE(off)).toBeCloseTo(2, 1);
  });
});

describe('MapKeeper + cloud', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cloud-keeper-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('feeds every integrated frame to the cloud, saves it beside the map, and restores it by boot id', async () => {
    const snapshot = vi.fn(async () => wallFrame(2));
    const range = new RangeSensor({ snapshot, cacheMs: 0 });
    const mapPath = join(dir, 'map.json');
    const cloudPath = join(dir, 'map.cloud.json');
    const deps = {
      enabled: true, range, path: mapPath, saveEvery: 2,
      cloud: { enabled: true, path: cloudPath, options: { voxelM: 0.05 } },
      getPose: () => ({ x: 0, y: 0, yawDeg: 0, source: 'sim' as const, atMs: Date.now() }),
      getBootId: () => 'boot-A', log: () => {},
    };
    const keeper = new MapKeeper(deps);
    for (let i = 0; i < 4; i++) await range.measure([0]);
    await flush();
    expect(keeper.getCloud()!.pointCount).toBe(41);
    expect(keeper.status().cloud).toMatchObject({ enabled: true, persisted: true, pointCount: 41, frames: 4 });
    expect(existsSync(cloudPath)).toBe(true);
    expect(JSON.parse(readFileSync(cloudPath, 'utf-8')).frameId).toBe('boot-A');
    keeper.dispose();

    const again = new MapKeeper({ ...deps, range: new RangeSensor({ snapshot, cacheMs: 0 }) });
    expect(again.getCloud()!.pointCount).toBe(41); // cold restore on read, like the grid
    again.dispose();

    const other = new MapKeeper({ ...deps, range: new RangeSensor({ snapshot, cacheMs: 0 }), getBootId: () => 'boot-B' });
    expect(other.getCloud()!.pointCount).toBe(0); // a new odometry session never inherits a cloud
    other.dispose();
  });

  it('is off unless asked, and off with the map', () => {
    const range = new RangeSensor({ snapshot: async () => wallFrame(2), cacheMs: 0 });
    const k1 = new MapKeeper({ enabled: true, range, getPose: () => null, getBootId: () => 'a', log: () => {} });
    expect(k1.getCloud()).toBeNull();
    expect(k1.status().cloud).toBeNull();
    const k2 = new MapKeeper({ enabled: false, range, cloud: { enabled: true }, getPose: () => null, getBootId: () => 'a', log: () => {} });
    expect(k2.getCloud()).toBeNull();
    expect(k2.isCloudEnabled()).toBe(false);
  });
});

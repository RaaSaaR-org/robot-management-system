/**
 * @file occupancy-map-keeper-save.test.ts
 * @description How the map reaches the disk (TASK-206/211): the periodic save
 *              never blocks the lidar frame path, a write that keeps failing is
 *              retried on the save cadence instead of on every frame, and a
 *              failing world cloud is reported under its OWN path.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';
import type { PointCloudFrame } from '../../robot/types.js';

/**
 * Both write paths are counted: the fix moved the periodic save from
 * `writeFileSync` to `fs/promises`, so a test that watched only one of them
 * would pass for the wrong reason.
 */
const io = vi.hoisted(() => ({
  sync: [] as string[],
  async: [] as string[],
  /** Substring of a path whose write throws, as a full disk does. */
  failing: null as string | null,
}));

const failFor = (path: string): boolean => io.failing !== null && path.includes(io.failing);

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const writeFileSync = (path: never, data: never, enc: never) => {
    io.sync.push(String(path));
    if (failFor(String(path))) throw new Error('ENOSPC: no space left on device');
    return real.writeFileSync(path, data, enc);
  };
  return { ...real, writeFileSync, default: { ...real, writeFileSync } };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const writeFile = async (path: never, data: never, enc: never) => {
    io.async.push(String(path));
    if (failFor(String(path))) throw new Error('ENOSPC: no space left on device');
    return real.writeFile(path, data, enc);
  };
  return { ...real, writeFile, default: { ...real, writeFile } };
});

const { MapKeeper } = await import('../occupancy-map-keeper.js');
const { RangeSensor } = await import('../range.js');

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

const pose = (): CachedBasePose => ({ x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: Date.now() });
/** Let the scheduled save run and its writes settle. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};

/**
 * Wait for a condition the save path reaches ASYNCHRONOUSLY.
 *
 * `settle()` is a fixed number of macrotasks, which is enough on an idle
 * machine and not enough when the whole suite runs in parallel — this file
 * failed exactly once that way ("expected [] to have a length of 1"). Polling
 * a predicate keeps the assertions about the behaviour rather than about the
 * scheduler's mood.
 */
const until = async (ok: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!ok() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'map-save-'));
  io.sync.length = 0;
  io.async.length = 0;
  io.failing = null;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function keeperWith(over: Record<string, unknown> = {}) {
  const range = new RangeSensor({ snapshot: vi.fn(async () => wallFrame()), cacheMs: 0 });
  const logs: string[] = [];
  const keeper = new MapKeeper({
    enabled: true,
    range,
    path: join(dir, 'occupancy-map.json'),
    saveEvery: 5,
    getPose: pose,
    getBootId: () => 'boot-A',
    log: (m: string) => logs.push(m),
    ...over,
  });
  return { keeper, range, logs };
}

describe('MapKeeper — saving', () => {
  it('does not write on the lidar frame path', async () => {
    // `onFrame` runs synchronously inside the range sensor's snapshot, on the
    // agent's only event loop. At defaults the payload is a 300k-point cloud
    // plus the grid — a `writeFileSync` there froze REST, telemetry and loco
    // for a few hundred milliseconds mid-walk.
    const { keeper, range } = keeperWith();
    for (let i = 0; i < 12; i++) await range.measure([0]);
    await until(() => io.async.length > 0);

    expect(io.async.length).toBeGreaterThan(0);
    expect(io.sync).toEqual([]);

    // Shutdown is the one place a blocking write is right: `dispose()` and the
    // controller's `persistMap()` have to land before the process goes.
    keeper.dispose();
    expect(io.sync.length).toBe(1);
  });

  it('retries a failing disk on the save cadence, not on every frame', async () => {
    // The watermark used to advance only on success, so a full disk left the
    // "N integrations since the last save" guard true and every following frame
    // re-ran the whole multi-megabyte write.
    io.failing = 'occupancy-map.json';
    const { keeper, range, logs } = keeperWith();
    for (let i = 0; i < 20; i++) {
      await range.measure([0]);
      await settle();
    }
    await until(() => logs.some((l) => l.includes('could not save')));

    expect(keeper.status().integrations).toBe(20);
    // 20 integrations at saveEvery 5 = four attempts, not one per frame.
    expect(io.async.length).toBeLessThanOrEqual(5);
    expect(io.async.length).toBeGreaterThan(0);
    // And one line about it, not one per attempt (the same 60 s throttle the
    // skip path has always had).
    expect(logs.filter((l) => l.includes('could not save'))).toHaveLength(1);
    keeper.dispose();
  });

  it('names the cloud, not the grid, when the cloud is what could not be written', async () => {
    // The cloud write sat under the grid's watermark and the grid's error
    // message: the operator read "could not save occupancy-map.json" while that
    // file was landing fine and the 3-D cloud was the thing being lost.
    io.failing = 'cloud';
    const cloudPath = join(dir, 'occupancy-map.cloud.json');
    const { keeper, range, logs } = keeperWith({
      cloud: { enabled: true, path: cloudPath, options: { voxelM: 0.05 } },
    });
    for (let i = 0; i < 6; i++) await range.measure([0]);
    await until(() => logs.some((l) => l.includes('could not save')));

    const errors = logs.filter((l) => l.includes('could not save'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(cloudPath);
    expect(errors[0]).not.toContain('occupancy-map.json:');
    keeper.dispose();
  });
});

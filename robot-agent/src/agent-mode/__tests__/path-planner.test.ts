/**
 * @file path-planner.test.ts
 * @description Grid A* on the occupancy map (TASK-208): straight lines stay one
 *              segment, walls are gone around at robot radius, keepouts are
 *              gone around at the geofence margin, a goal inside a keepout is
 *              refused by name, unknown ground is dispreferred but usable, and
 *              the budget yields `null`-equivalent, never a guess.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { LOGODDS_SCALE, OccupancyMap } from '../occupancy-map.js';
import {
  checkStraightSegment,
  keepoutAt,
  planPath,
  type PlannerWorld,
} from '../path-planner.js';
import type { Place } from '../place-resolver.js';
import { pointInPolygon } from '../place-resolver.js';
import { keepoutDepthM } from '../geofence.js';

const RES = 0.1;

/**
 * Build a map from rows of `#` (occupied), `.` (free) and `?` (unknown). Row 0
 * is the TOP of the picture, i.e. the largest y; column 0 is x = 0.
 */
function gridMap(rows: string[]): OccupancyMap {
  const height = rows.length;
  const width = rows[0]!.length;
  const q = new Int8Array(width * height);
  for (let r = 0; r < height; r++) {
    const row = rows[r]!;
    const cy = height - 1 - r;
    for (let cx = 0; cx < width; cx++) {
      const ch = row[cx];
      q[cy * width + cx] = ch === '#' ? 4 * LOGODDS_SCALE : ch === '.' ? -4 * LOGODDS_SCALE : 0;
    }
  }
  const snap = {
    version: 1,
    frame: 'odom',
    frameId: 'test',
    resolution: RES,
    originX: 0,
    originY: 0,
    width,
    height,
    encoding: 'int8-logodds-b64',
    cells: Buffer.from(q.buffer).toString('base64'),
    occupiedAbove: 1.2,
    freeBelow: -1.2,
    poseCount: 1,
    lastIntegratedAt: null,
    knownCells: 0,
    occupiedCells: 0,
  };
  const r = OccupancyMap.fromSnapshot(snap, { frameId: 'test', resolutionM: RES });
  if (!r.map) throw new Error(r.reason);
  return r.map;
}

/** An all-free square `sizeM` on a side, origin at (0,0). */
function openMap(sizeM: number): OccupancyMap {
  const n = Math.round(sizeM / RES);
  return gridMap(Array.from({ length: n }, () => '.'.repeat(n)));
}

function place(id: string, polygon: Array<[number, number]>, keepout = true): Place {
  return { id, name: id, placeType: 'cell', floor: 0, polygon, source: 'surveyed', keepout, landmarks: [] };
}

function world(map: OccupancyMap | null, keepouts: Place[] = []): PlannerWorld {
  return { map, keepouts, keepoutMarginM: 0.5, robotRadiusM: 0.3 };
}

/** Every point along the polyline, sampled at 5 cm. */
function samples(waypoints: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 1; i < waypoints.length; i++) {
    const [ax, ay] = waypoints[i - 1]!;
    const [bx, by] = waypoints[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
    for (let s = 0; s <= n; s++) out.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n]);
  }
  return out;
}

function nearestOccupied(map: OccupancyMap, x: number, y: number): number {
  const b = map.bounds();
  let best = Infinity;
  for (let cy = 0; cy < b.height; cy++) {
    for (let cx = 0; cx < b.width; cx++) {
      const px = b.originX + (cx + 0.5) * RES;
      const py = b.originY + (cy + 0.5) * RES;
      if (map.cellAt(px, py) === 'occupied') best = Math.min(best, Math.hypot(px - x, py - y));
    }
  }
  return best;
}

describe('planPath — open floor', () => {
  it('plans a straight line as ONE segment', () => {
    const r = planPath(world(openMap(6)), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.segments).toHaveLength(1);
    expect(Math.abs(r.path.segments[0]!.headingDeg)).toBeLessThan(2);
    // Stops at the goal tolerance, not on top of the goal.
    expect(r.path.lengthM).toBeGreaterThan(3.2);
    expect(r.path.lengthM).toBeLessThan(4.0);
    expect(r.path.throughUnknown).toBe(false);
  });

  it('is already there when the start is inside the goal tolerance', () => {
    const r = planPath(world(openMap(4)), { x: 1, y: 1 }, { x: 1.4, y: 1 });
    expect(r.ok && r.path.segments.length === 0 && r.path.lengthM === 0).toBe(true);
  });

  it('answers no-map when the map is missing or empty', () => {
    expect(planPath(world(null), { x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({ ok: false, reason: 'no-map' });
    expect(planPath(world(new OccupancyMap()), { x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({
      ok: false,
      reason: 'no-map',
    });
  });
});

describe('planPath — walls', () => {
  it('goes through the gap in a wall and keeps the robot radius from it', () => {
    // 6 m × 6 m, a wall across x = 3 m with a 1.2 m gap around y = 4 m.
    const rows: string[] = [];
    for (let r = 0; r < 60; r++) {
      const y = (59 - r) * RES;
      const gap = y > 3.4 && y < 4.6;
      rows.push('.'.repeat(30) + (gap ? '.' : '#') + '.'.repeat(29));
    }
    const map = gridMap(rows);
    const r = planPath(world(map), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.segments.length).toBeGreaterThanOrEqual(2);
    for (const [x, y] of samples(r.path.waypoints)) {
      // Cell centres are up to half a cell off the sampled line, hence the slack.
      expect(nearestOccupied(map, x, y)).toBeGreaterThanOrEqual(0.3 - RES);
    }
    // It went up through the gap and came back down.
    expect(Math.max(...r.path.waypoints.map(([, y]) => y))).toBeGreaterThan(3.3);
  });

  it('answers no-path when the wall has no gap', () => {
    const rows = Array.from({ length: 40 }, () => '.'.repeat(20) + '#' + '.'.repeat(19));
    const r = planPath(world(gridMap(rows)), { x: 1, y: 1 }, { x: 3.5, y: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'no-path' });
  });

  it('can plan away from a wall the robot is parked against', () => {
    const rows = Array.from({ length: 40 }, () => '#' + '.'.repeat(39));
    // 0.15 m from the wall face: the robot's own disc overlaps the wall.
    const r = planPath(world(gridMap(rows)), { x: 0.25, y: 2 }, { x: 3.5, y: 2 });
    expect(r.ok).toBe(true);
  });

  it('treats a peer on the dynamic overlay as a wall', () => {
    const map = openMap(6);
    map.setDynamicObstacles([{ x: 3, y: 1, radiusM: 0.6, label: 'robot Bravo' }]);
    const r = planPath(world(map), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [x, y] of samples(r.path.waypoints)) {
      expect(Math.hypot(x - 3, y - 1)).toBeGreaterThanOrEqual(0.9 - RES);
    }
  });
});

describe('planPath — keepouts', () => {
  const TABLE = place('TABLE', [
    [2.5, 0.2],
    [3.5, 0.2],
    [3.5, 1.8],
    [2.5, 1.8],
  ]);

  it('goes around a keepout between start and goal, at least the margin away everywhere', () => {
    const r = planPath(world(openMap(6), [TABLE]), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [x, y] of samples(r.path.waypoints)) {
      expect(pointInPolygon(x, y, TABLE.polygon)).toBe(false);
      // Inside the geofence margin would be a protective stop — must never happen.
      expect(keepoutDepthM(x, y, TABLE, 0.5)).toBeNull();
    }
  });

  it('refuses a goal deep inside a keepout, by name, before searching', () => {
    const r = planPath(world(openMap(6), [TABLE]), { x: 1, y: 1 }, { x: 3, y: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'goal-in-keepout', keepout: { name: 'TABLE' } });
    expect(keepoutAt(world(null, [TABLE]), 4.2, 1)).toBeNull();
    expect(keepoutAt(world(null, [TABLE]), 3.8, 1)?.name).toBe('TABLE');
  });

  it('plans to the stand-off ring when the goal is ON a fenced surface — "go to the table"', () => {
    // The lidar puts the goal on the table's face (x = 2.5, inside the margin);
    // the robot can stand 0.6 m short of it, outside the fence.
    const r = planPath(world(openMap(6), [TABLE]), { x: 1, y: 1 }, { x: 2.5, y: 1 }, { goalToleranceM: 0.6 + 0.3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const end = r.path.waypoints[r.path.waypoints.length - 1]!;
    expect(keepoutDepthM(end[0], end[1], TABLE, 0.5)).toBeNull();
    expect(Math.hypot(end[0] - 2.5, end[1] - 1)).toBeLessThanOrEqual(0.9 + 0.01);
  });
});

describe('planPath — unknown ground', () => {
  it('prefers seen floor over unknown when both lead there', () => {
    // Bottom half free, top half unknown; the straight line runs through free.
    const rows = [
      ...Array.from({ length: 20 }, () => '?'.repeat(60)),
      ...Array.from({ length: 20 }, () => '.'.repeat(60)),
    ];
    const r = planPath(world(gridMap(rows)), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.throughUnknown).toBe(false);
  });

  it('crosses unknown ground when it is the only way, and says so', () => {
    // A free corridor to x = 3, then unknown all the way.
    const rows = Array.from({ length: 30 }, () => '.'.repeat(30) + '?'.repeat(30));
    const r = planPath(world(gridMap(rows)), { x: 1, y: 1.5 }, { x: 5, y: 1.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.throughUnknown).toBe(true);
    expect(r.path.segments.some((s) => s.throughUnknown)).toBe(true);
  });

  it('takes a known detour over a shorter unknown line when the detour is cheap enough', () => {
    // Free ring around an unknown block: the straight line (4 m unknown → cost 12)
    // loses to the free detour (~5.4 m → cost 5.4).
    const rows: string[] = [];
    for (let r = 0; r < 40; r++) {
      const y = (39 - r) * RES;
      const inBlock = y > 0.4 && y < 1.6;
      rows.push(inBlock ? '.'.repeat(15) + '?'.repeat(30) + '.'.repeat(15) : '.'.repeat(60));
    }
    const r = planPath(world(gridMap(rows)), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.throughUnknown).toBe(false);
  });
});

describe('planPath — budget', () => {
  it('gives up honestly when the node budget is exhausted', () => {
    const rows = Array.from({ length: 60 }, () => '.'.repeat(60));
    const r = planPath(world(gridMap(rows)), { x: 0.5, y: 0.5 }, { x: 5.5, y: 5.5 }, { maxExpandedNodes: 10 });
    expect(r).toMatchObject({ ok: false, reason: 'budget' });
  });

  it('gives up honestly when the time budget is exhausted', () => {
    let t = 0;
    const r = planPath(
      world(openMap(6)),
      { x: 0.5, y: 0.5 },
      { x: 5.5, y: 5.5 },
      { maxMs: 10, now: () => (t += 5) },
    );
    expect(r).toMatchObject({ ok: false, reason: 'budget' });
  });
});

describe('checkStraightSegment', () => {
  const TABLE = place('TABLE', [
    [2.5, 0.2],
    [3.5, 0.2],
    [3.5, 1.8],
    [2.5, 1.8],
  ]);

  it('is fully allowed and fully known on open floor', () => {
    const c = checkStraightSegment(world(openMap(6)), { x: 1, y: 1 }, 0, 3);
    expect(c.blocker).toBeNull();
    expect(c.allowedM).toBe(3);
    expect(c.knownM).toBeCloseTo(3, 5);
  });

  it('stops short of a keepout, naming it, at the margin', () => {
    const c = checkStraightSegment(world(openMap(6), [TABLE]), { x: 1, y: 1 }, 0, 3);
    expect(c.blocker).toEqual({ kind: 'keepout', label: 'TABLE' });
    // Polygon face at x = 2.5, margin 0.5 → the fence starts at x = 2.0, i.e.
    // 1.0 m out; the check stops a step early plus a step of cushion.
    expect(c.allowedM).toBeGreaterThanOrEqual(0.75);
    expect(c.allowedM).toBeLessThan(1.0);
  });

  it('checks keepouts even without a map, and knows nothing about the floor', () => {
    const c = checkStraightSegment(world(null, [TABLE]), { x: 1, y: 1 }, 0, 3);
    expect(c.blocker?.kind).toBe('keepout');
    expect(c.knownM).toBe(0);
    const open = checkStraightSegment(world(null, [TABLE]), { x: 1, y: 3 }, 0, 3);
    expect(open.blocker).toBeNull();
    expect(open.allowedM).toBe(3);
    expect(open.knownM).toBe(0);
  });

  it('stops short of an occupied cell and of a peer, and stops KNOWING at unknown ground', () => {
    const rows = Array.from({ length: 30 }, () => '.'.repeat(20) + '?'.repeat(5) + '.'.repeat(10) + '#' + '.'.repeat(24));
    const map = gridMap(rows);
    const c = checkStraightSegment(world(map), { x: 0.5, y: 1.5 }, 0, 5);
    expect(c.blocker?.kind).toBe('occupied');
    // Wall at x = 3.5, robot radius 0.3 → allowed ≈ 3.5 − 0.3 − 0.5 = 2.7 m.
    expect(c.allowedM).toBeGreaterThan(2.5);
    expect(c.allowedM).toBeLessThan(2.85);
    // Unknown starts at x = 2.0 → known ends ≈ 1.5 − 0.3 = 1.2 m out (disc touches it first).
    expect(c.knownM).toBeGreaterThan(1.0);
    expect(c.knownM).toBeLessThan(1.5);

    map.setDynamicObstacles([{ x: 1.5, y: 1.5, radiusM: 0.5, label: 'robot Bravo' }]);
    const p = checkStraightSegment(world(map), { x: 0.5, y: 1.5 }, 0, 5);
    expect(p.blocker).toEqual({ kind: 'robot', label: 'robot Bravo' });
    expect(p.allowedM).toBeLessThan(0.3);
  });

  it('ignores the wall the robot is already standing against', () => {
    const rows = Array.from({ length: 30 }, () => '#' + '.'.repeat(39));
    const c = checkStraightSegment(world(gridMap(rows)), { x: 0.25, y: 1.5 }, 0, 2);
    expect(c.blocker).toBeNull();
    expect(c.allowedM).toBe(2);
  });
});

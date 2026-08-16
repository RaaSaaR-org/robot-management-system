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

/**
 * `planPath` with a budget that cannot expire because the machine is busy.
 *
 * The real default is 50 ms — right for a robot that must answer while it
 * walks, wrong for an assertion about pathfinding: under a full parallel test
 * run this file failed with `reason: 'budget'` roughly once in ten. The one
 * test that is ABOUT the budget calls `planPathRaw` with its own fake clock.
 */
const plan: typeof planPath = (w, start, goal, opts = {}) =>
  planPath(w, start, goal, { maxMs: 5_000, ...opts });
const planPathRaw = planPath;

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
    const r = plan(world(openMap(6)), { x: 1, y: 1 }, { x: 5, y: 1 });
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
    const r = plan(world(openMap(4)), { x: 1, y: 1 }, { x: 1.4, y: 1 });
    expect(r.ok && r.path.segments.length === 0 && r.path.lengthM === 0).toBe(true);
  });

  it('answers no-map when the map is missing or empty', () => {
    expect(plan(world(null), { x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({ ok: false, reason: 'no-map' });
    expect(plan(world(new OccupancyMap()), { x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({
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
    const r = plan(world(map), { x: 1, y: 1 }, { x: 5, y: 1 });
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
    const r = plan(world(gridMap(rows)), { x: 1, y: 1 }, { x: 3.5, y: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'no-path' });
  });

  it('can plan away from a wall the robot is parked against', () => {
    const rows = Array.from({ length: 40 }, () => '#' + '.'.repeat(39));
    // 0.15 m from the wall face: the robot's own disc overlaps the wall.
    const r = plan(world(gridMap(rows)), { x: 0.25, y: 2 }, { x: 3.5, y: 2 });
    expect(r.ok).toBe(true);
  });

  it('treats a peer on the dynamic overlay as a wall', () => {
    const map = openMap(6);
    map.setDynamicObstacles([{ x: 3, y: 1, radiusM: 0.6, label: 'robot Bravo' }]);
    const r = plan(world(map), { x: 1, y: 1 }, { x: 5, y: 1 });
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
    const r = plan(world(openMap(6), [TABLE]), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [x, y] of samples(r.path.waypoints)) {
      expect(pointInPolygon(x, y, TABLE.polygon)).toBe(false);
      // Inside the geofence margin would be a protective stop — must never happen.
      expect(keepoutDepthM(x, y, TABLE, 0.5)).toBeNull();
    }
  });

  it('refuses a goal deep inside a keepout, by name, before searching', () => {
    const r = plan(world(openMap(6), [TABLE]), { x: 1, y: 1 }, { x: 3, y: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'goal-in-keepout', keepout: { name: 'TABLE' } });
    expect(keepoutAt(world(null, [TABLE]), 4.2, 1)).toBeNull();
    expect(keepoutAt(world(null, [TABLE]), 3.8, 1)?.name).toBe('TABLE');
  });

  it('plans to the stand-off ring when the goal is ON a fenced surface — "go to the table"', () => {
    // The lidar puts the goal on the table's face (x = 2.5, inside the margin);
    // the robot can stand 0.6 m short of it, outside the fence.
    const r = plan(world(openMap(6), [TABLE]), { x: 1, y: 1 }, { x: 2.5, y: 1 }, { goalToleranceM: 0.6 + 0.3 });
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
    const r = plan(world(gridMap(rows)), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.throughUnknown).toBe(false);
  });

  it('crosses unknown ground when it is the only way, and says so', () => {
    // A free corridor to x = 3, then unknown all the way.
    const rows = Array.from({ length: 30 }, () => '.'.repeat(30) + '?'.repeat(30));
    const r = plan(world(gridMap(rows)), { x: 1, y: 1.5 }, { x: 5, y: 1.5 });
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
    const r = plan(world(gridMap(rows)), { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.throughUnknown).toBe(false);
  });
});

describe('planPath — budget', () => {
  it('gives up honestly when the node budget is exhausted', () => {
    const rows = Array.from({ length: 60 }, () => '.'.repeat(60));
    const r = plan(world(gridMap(rows)), { x: 0.5, y: 0.5 }, { x: 5.5, y: 5.5 }, { maxExpandedNodes: 10 });
    expect(r).toMatchObject({ ok: false, reason: 'budget' });
  });

  it('gives up honestly when the time budget is exhausted', () => {
    let t = 0;
    const r = planPathRaw(
      world(openMap(6)),
      { x: 0.5, y: 0.5 },
      { x: 5.5, y: 5.5 },
      { maxMs: 10, now: () => (t += 5) },
    );
    expect(r).toMatchObject({ ok: false, reason: 'budget' });
  });
});

describe('a grid that is not aligned to world zero', () => {
  /** `gridMap`'s picture, at an arbitrary resolution and origin. */
  function gridMapAt(rows: string[], res: number, originX: number, originY: number): OccupancyMap {
    const height = rows.length;
    const width = rows[0]!.length;
    const q = new Int8Array(width * height);
    for (let r = 0; r < height; r++) {
      const row = rows[r]!;
      const cy = height - 1 - r;
      for (let cx = 0; cx < width; cx++) {
        q[cy * width + cx] = row[cx] === '#' ? 4 * LOGODDS_SCALE : row[cx] === '.' ? -4 * LOGODDS_SCALE : 0;
      }
    }
    const r = OccupancyMap.fromSnapshot(
      {
        version: 1,
        frame: 'odom',
        frameId: 'test',
        resolution: res,
        originX,
        originY,
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
      },
      { frameId: 'test', resolutionM: res },
    );
    if (!r.map) throw new Error(r.reason);
    return r.map;
  }

  /**
   * `AGENT_MAP_RESOLUTION_M=0.3` makes the initial 20 m box 67 cells wide, and
   * `allocateAround` then put the origin half a cell off world zero. The
   * planner used to re-derive cell centres from the WORLD-zero lattice, so
   * every footprint sample sat half a cell off in +x and +y from the point
   * being tested: walls on the −x side went unseen, `checkStraightSegment`
   * cleared a stop the map's own `isTraversable` refused, and the robot walked
   * into the wall with no refusal anywhere.
   */
  const RES3 = 0.3;
  const WALL_CELL = 20;
  const wallRows = Array.from({ length: 40 }, () => '.'.repeat(WALL_CELL) + '#' + '.'.repeat(19));

  /** Walk west at a wall and report where the segment check says to stop. */
  function approachFromEast(origin: number): { stopX: number; y: number; map: OccupancyMap; toFaceM: number } {
    const map = gridMapAt(wallRows, RES3, origin, origin);
    const w: PlannerWorld = { map, keepouts: [], keepoutMarginM: 0.5, robotRadiusM: 0.4 };
    const from = { x: origin + 34 * RES3 + RES3 / 2, y: origin + 20 * RES3 + RES3 / 2 };
    const c = checkStraightSegment(w, from, 180, 6);
    const stopX = from.x - c.allowedM;
    const wallFaceX = origin + (WALL_CELL + 1) * RES3; // the wall's east face
    return { stopX, y: from.y, map, toFaceM: stopX - wallFaceX };
  }

  it('stops a straight walk where the map itself says the robot still fits', () => {
    const offset = approachFromEast(-0.15); // half a cell off world zero
    // The safety-relevant routine and the map used to disagree about the very
    // same point: the check allowed a stop the map called untraversable.
    expect(offset.map.isTraversable(offset.stopX, offset.y, 0.4)).toBe(true);

    // And where it stops does not depend on where the grid's origin happens to
    // sit: the aligned grid is the same wall at the same distance.
    const aligned = approachFromEast(0);
    expect(aligned.map.isTraversable(aligned.stopX, aligned.y, 0.4)).toBe(true);
    expect(offset.toFaceM).toBeCloseTo(aligned.toFaceM, 6);
  });

  it('allocates the grid on whole cells, so the lattice starts aligned', () => {
    // Belt and braces for the same failure: 20 m at 0.3 m is an odd cell count.
    const map = new OccupancyMap({ resolutionM: RES3, initialSizeM: 20, maxSizeM: 60 });
    map.integrate(
      {
        robotId: 'r1',
        sensor: 'mid360_lidar',
        sensorType: 'lidar',
        frame: 'base_link',
        pointCount: 1,
        positions: [2, 0, 1],
        intensities: [],
        hasIntensity: false,
        sequence: 0,
        source: 'hardware',
        timestamp: new Date(0).toISOString(),
      },
      { x: 0, y: 0, yawDeg: 0 },
      1000,
    );
    const b = map.bounds();
    expect(b.originX / RES3).toBeCloseTo(Math.round(b.originX / RES3), 9);
    expect(b.originY / RES3).toBeCloseTo(Math.round(b.originY / RES3), 9);
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

  it('shortens a walk that would END inside the cushion of a fence it never crosses', () => {
    // Fence at x = 2.0 (face 2.5, margin 0.5). A 0.98 m walk from x = 1 ends
    // 2 cm outside the line with no fenced sample inside it — exactly the walk
    // that used to pass untouched and park the robot on the line. It is
    // shortened to a cushion (0.2 m) short of the fence.
    const c = checkStraightSegment(world(openMap(6), [TABLE]), { x: 1, y: 1 }, 0, 0.98);
    expect(c.blocker).toEqual({ kind: 'keepout', label: 'TABLE' });
    expect(c.allowedM).toBeGreaterThanOrEqual(0.75);
    expect(c.allowedM).toBeLessThan(0.98);
    // A walk that ends a full cushion clear of the fence stands as requested.
    const clear = checkStraightSegment(world(openMap(6), [TABLE]), { x: 1, y: 1 }, 0, 0.75);
    expect(clear.blocker).toBeNull();
    expect(clear.allowedM).toBe(0.75);
    expect(clear.knownM).toBeCloseTo(0.75, 5);
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

describe('planPath and checkStraightSegment agree', () => {
  it('a route the planner approves is not refused by the pre-walk check, even at the disc boundary (TASK-209)', () => {
    // A 6 m × 4 m room with a crate-sized block whose top face sits exactly one
    // robot radius (0.4 m) below the cell row a route past it would use — the
    // hallway crate, measured. Origin (0, 0); rows are top = high y.
    const rows: string[] = [];
    for (let r = 0; r < 40; r++) {
      const y = (39 - r) * RES + RES / 2; // cell centre y
      let row = '';
      for (let c = 0; c < 60; c++) {
        const x = c * RES + RES / 2;
        row += x >= 2.6 && x <= 3.4 && y >= 1.0 && y <= 1.6 ? '#' : '.';
      }
      rows.push(row);
    }
    const map = gridMap(rows);
    const w: PlannerWorld = { map, keepouts: [], keepoutMarginM: 0.25, robotRadiusM: 0.4 };
    // Start a hair off a cell centre and a hair inside the "escape" radius of
    // the block, heading past it, as the robot did.
    const from = { x: 2.2648, y: 1.9792 };
    for (const goal of [{ x: 5.5, y: 2.0 }, { x: 5.5, y: 1.0 }, { x: 5.5, y: 3.5 }]) {
      const v = planPath(w, from, goal, { unknownCost: 3, goalToleranceM: 0.6 });
      expect(v.ok).toBe(true);
      if (!v.ok) continue;
      for (const seg of v.path.segments.slice(0, 2)) {
        const c = checkStraightSegment(w, { x: seg.from[0], y: seg.from[1] }, seg.headingDeg, seg.lengthM);
        expect(c.blocker).toBeNull();
        expect(c.allowedM).toBeCloseTo(seg.lengthM, 5);
      }
    }
  });
});

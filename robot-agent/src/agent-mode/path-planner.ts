/**
 * @file path-planner.ts
 * @description Grid A* over the robot's own occupancy map (TASK-208), with the
 *              place graph's keepouts inflated into the cost grid and the fleet's
 *              peers (the map's dynamic overlay) as walls. Pure: no clock of its
 *              own beyond the budget check, no I/O, no knowledge of where the
 *              pose or the map came from. Two entry points —
 *              {@link planPath} for the navigator and
 *              {@link checkStraightSegment} for the executor's pre-walk check —
 *              and one rule they share: UNKNOWN is a cost, OCCUPIED, PEER and
 *              KEEPOUT are walls, and nothing here ever answers "clear" about
 *              ground it has no information on.
 * @feature agentmode
 * @status live
 */

import { keepoutDepthM } from './geofence.js';
import type { OccupancyMap } from './occupancy-map.js';
import { pointInPolygon } from './place-resolver.js';
import type { Place } from './place-resolver.js';
import { normalizeDeg } from './types.js';

/** Everything the planner needs to know about the world, assembled by the caller. */
export interface PlannerWorld {
  /** The live map, or null when map building is off / nothing integrated yet. */
  map: OccupancyMap | null;
  /**
   * Keepout places, ALREADY frame-checked by the caller: on an unregistered
   * frame this must be `[]` (the polygons and the map are numbers about
   * different origins), exactly as the geofence and `/map` behave.
   */
  keepouts: readonly Place[];
  /** The geofence's margin — the planner keeps every path at least this far out. */
  keepoutMarginM: number;
  /** Half the robot's footprint; every path point needs this much free disc. */
  robotRadiusM: number;
}

export interface PlanOptions {
  /** Cost multiplier for a step into UNKNOWN cells (default 3). */
  unknownCost?: number;
  /** A node this close to the goal ends the search (default 0.6 m). */
  goalToleranceM?: number;
  /** Hard limits — past either the answer is "no path known", never a guess. */
  maxExpandedNodes?: number;
  maxMs?: number;
  now?: () => number;
}

export interface PathSegment {
  from: [number, number];
  to: [number, number];
  /** World heading of the segment, degrees, +x = 0, CCW positive. */
  headingDeg: number;
  lengthM: number;
  /** True when any point of the segment crosses UNKNOWN cells. */
  throughUnknown: boolean;
}

export interface PlannedPath {
  /** Odometry-frame polyline, the robot's own position first. */
  waypoints: Array<[number, number]>;
  segments: PathSegment[];
  lengthM: number;
  throughUnknown: boolean;
  /** Search diagnostics. */
  expanded: number;
  elapsedMs: number;
}

export type PlanFailure =
  | 'no-map'
  | 'start-off-map'
  | 'goal-in-keepout'
  | 'no-path'
  | 'budget';

export type PlanResult =
  | { ok: true; path: PlannedPath }
  | { ok: false; reason: PlanFailure; message: string; keepout?: { id: string; name: string } };

/** What is in the way, for the messages the robot says out loud. */
export interface Blocker {
  kind: 'keepout' | 'occupied' | 'robot';
  /** Place name / peer label / "an obstacle on the map". */
  label: string;
}

export interface SegmentCheck {
  /** Metres from the start the robot may walk before it would touch `blocker`. */
  allowedM: number;
  /** Metres from the start the map KNOWS to be free (stops at the first unknown or blocked sample). */
  knownM: number;
  blocker: Blocker | null;
  /** Distance at which the blocker sits (= `allowedM` when there is one). */
  blockerAtM: number | null;
}

export const DEFAULT_UNKNOWN_COST = 3;
export const DEFAULT_GOAL_TOLERANCE_M = 0.6;
export const DEFAULT_MAX_EXPANDED_NODES = 20_000;
export const DEFAULT_MAX_MS = 50;
/** Sampling step of the straight-segment check and the line-of-sight test. */
export const SEGMENT_STEP_M = 0.1;

type CellClass = 1 | 2 | 3; // free | unknown | blocked
const FREE: CellClass = 1;
const UNKNOWN: CellClass = 2;
const BLOCKED: CellClass = 3;

/**
 * Which keepout, if any, `(x, y)` is inside or within the margin of.
 * Public so the navigator can refuse a goal BEFORE any search runs.
 */
export function keepoutAt(world: PlannerWorld, x: number, y: number): Place | null {
  for (const place of world.keepouts) {
    if (pointInPolygon(x, y, place.polygon)) return place;
    if (keepoutDepthM(x, y, place, world.keepoutMarginM) !== null) return place;
  }
  return null;
}

/**
 * The robot's disc at `(x, y)`, read off the map: BLOCKED when any cell within
 * the radius is occupied or overlaps a peer, UNKNOWN when any is unclassified
 * (or off the grid), FREE only when every one is free. `ignore` exempts the
 * cells inside the robot's OWN starting footprint — a robot parked 0.2 m from a
 * wall must still be able to plan away from it, and a wall it is already
 * touching cannot be what stops a walk away from it.
 */
function discClass(
  map: OccupancyMap,
  x: number,
  y: number,
  radiusM: number,
  ignore: { x: number; y: number; r: number } | null,
): { cls: CellClass; label: string | null } {
  // Dynamic overlay first: a peer is a labelled thing, and the label is what
  // the message needs.
  for (const o of map.getDynamicObstacles()) {
    const dx = o.x - x;
    const dy = o.y - y;
    const reach = o.radiusM + radiusM;
    if (dx * dx + dy * dy < reach * reach) {
      if (ignore && Math.hypot(o.x - ignore.x, o.y - ignore.y) < ignore.r + o.radiusM) continue;
      return { cls: BLOCKED, label: o.label };
    }
  }
  const res = map.resolution;
  const rCells = Math.ceil(radiusM / res);
  const r2 = radiusM * radiusM;
  const cx = Math.floor(x / res) * res + res / 2;
  const cy = Math.floor(y / res) * res + res / 2;
  let unknown = false;
  for (let dy = -rCells; dy <= rCells; dy++) {
    for (let dx = -rCells; dx <= rCells; dx++) {
      const px = cx + dx * res;
      const py = cy + dy * res;
      const ddx = px - x;
      const ddy = py - y;
      if (ddx * ddx + ddy * ddy > r2) continue;
      const state = map.cellAt(px, py);
      if (state === 'occupied') {
        if (ignore && Math.hypot(px - ignore.x, py - ignore.y) <= ignore.r) continue;
        return { cls: BLOCKED, label: null };
      }
      if (state === 'unknown') unknown = true;
    }
  }
  return { cls: unknown ? UNKNOWN : FREE, label: null };
}

/**
 * Plan from `start` to (within `goalToleranceM` of) `goal`, both in the map's
 * odometry frame. 8-connected A* with an octile heuristic; diagonal moves may
 * not cut a corner past a wall. Then string-pulled, so a straight corridor is
 * one segment — a shortcut is only taken where the line of sight is free of
 * walls and does not cross more unknown ground than the path it replaces.
 */
export function planPath(
  world: PlannerWorld,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  opts: PlanOptions = {},
): PlanResult {
  const map = world.map;
  if (!map || !map.isAllocated()) {
    return { ok: false, reason: 'no-map', message: 'no map yet — nothing has been integrated' };
  }
  const now = opts.now ?? (() => Date.now());
  const t0 = now();
  const unknownCost = opts.unknownCost ?? DEFAULT_UNKNOWN_COST;
  const goalTolM = opts.goalToleranceM ?? DEFAULT_GOAL_TOLERANCE_M;
  const maxNodes = opts.maxExpandedNodes ?? DEFAULT_MAX_EXPANDED_NODES;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;

  const res = map.resolution;
  // The geofence fires on the base CENTRE within `keepoutMarginM`; planning on
  // cell centres, a path can cut inside the margin by up to a cell diagonal, so
  // the planner inflates by one extra cell to stay out by construction.
  const fenceWorld: PlannerWorld = { ...world, keepoutMarginM: world.keepoutMarginM + res * Math.SQRT2 };

  // A goal INSIDE a keepout is refused before any search — but "inside" means
  // the robot could not stand anywhere within reach of it without entering the
  // fence. The lidar puts a target's goal ON its surface, and a table's
  // footprint is exactly the kind of place that is fenced, so the surface
  // point itself being fenced is the normal case for "go to the table"; what
  // matters is whether the stand-off ring around it (the plan's own goal
  // tolerance) has an unfenced spot. When it does not, the sentence is the
  // navigator's to say, and it names the place.
  const fence = keepoutAt(world, goal.x, goal.y);
  if (fence) {
    let standable = false;
    for (let k = 0; k < 24 && !standable; k++) {
      const a = (k / 24) * Math.PI * 2;
      standable = keepoutAt(fenceWorld, goal.x + Math.cos(a) * goalTolM, goal.y + Math.sin(a) * goalTolM) === null;
    }
    if (!standable) {
      return {
        ok: false,
        reason: 'goal-in-keepout',
        message: `inside keepout ${fence.name}`,
        keepout: { id: fence.id, name: fence.name },
      };
    }
  }

  const b = map.bounds();
  const toCell = (x: number, y: number): [number, number] => [
    Math.floor((x - b.originX) / res),
    Math.floor((y - b.originY) / res),
  ];
  const inBounds = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < b.width && cy < b.height;
  const centre = (cx: number, cy: number): [number, number] => [
    b.originX + (cx + 0.5) * res,
    b.originY + (cy + 0.5) * res,
  ];

  const [sx, sy] = toCell(start.x, start.y);
  if (!inBounds(sx, sy)) {
    return { ok: false, reason: 'start-off-map', message: 'the robot is outside the mapped area' };
  }
  const startIdx = sy * b.width + sx;
  // The escape radius: cells inside the robot's own footprint at the start are
  // never walls, or a robot beside a table could not plan its first step.
  const escape = { x: start.x, y: start.y, r: world.robotRadiusM + res };
  const cls = new Uint8Array(b.width * b.height); // 0 = not classified yet
  const classify = (cx: number, cy: number): CellClass => {
    const idx = cy * b.width + cx;
    const cached = cls[idx];
    if (cached) return cached as CellClass;
    const [x, y] = centre(cx, cy);
    let c: CellClass;
    if (idx !== startIdx && keepoutAt(fenceWorld, x, y)) c = BLOCKED;
    else c = discClass(map, x, y, world.robotRadiusM, escape).cls;
    if (idx === startIdx && c === BLOCKED) c = UNKNOWN;
    cls[idx] = c;
    return c;
  };

  const goalReached = (cx: number, cy: number): boolean => {
    const [x, y] = centre(cx, cy);
    return Math.hypot(x - goal.x, y - goal.y) <= goalTolM;
  };
  if (goalReached(sx, sy) || Math.hypot(start.x - goal.x, start.y - goal.y) <= goalTolM) {
    return {
      ok: true,
      path: {
        waypoints: [[start.x, start.y]],
        segments: [],
        lengthM: 0,
        throughUnknown: false,
        expanded: 0,
        elapsedMs: now() - t0,
      },
    };
  }

  const gCost = new Float64Array(b.width * b.height).fill(Infinity);
  const parent = new Int32Array(b.width * b.height).fill(-1);
  const closed = new Uint8Array(b.width * b.height);
  const [gx, gy] = toCell(goal.x, goal.y);
  const h = (cx: number, cy: number): number => {
    const dx = Math.abs(cx - gx);
    const dy = Math.abs(cy - gy);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * res;
  };

  // Binary heap of node indices keyed by f.
  const heap: number[] = [];
  const fOf = new Float64Array(b.width * b.height);
  const push = (idx: number): void => {
    heap.push(idx);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fOf[heap[p]!] <= fOf[idx]) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = idx;
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      let i = 0;
      const n = heap.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mf = fOf[last];
        if (l < n && fOf[heap[l]!] < mf) {
          m = l;
          mf = fOf[heap[l]!];
        }
        if (r < n && fOf[heap[r]!] < mf) m = r;
        if (m === i) break;
        heap[i] = heap[m]!;
        i = m;
      }
      heap[i] = last;
    }
    return top;
  };

  gCost[startIdx] = 0;
  fOf[startIdx] = h(sx, sy);
  push(startIdx);
  const DIRS: Array<[number, number, number]> = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];

  let expanded = 0;
  let goalIdx = -1;
  while (heap.length > 0) {
    const idx = pop();
    if (closed[idx]) continue;
    closed[idx] = 1;
    const cx = idx % b.width;
    const cy = (idx - cx) / b.width;
    if (goalReached(cx, cy)) {
      goalIdx = idx;
      break;
    }
    expanded++;
    if (expanded > maxNodes || now() - t0 > maxMs) {
      return {
        ok: false,
        reason: 'budget',
        message: `no path found within the search budget (${expanded} nodes, ${Math.round(now() - t0)} ms)`,
      };
    }
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const nIdx = ny * b.width + nx;
      if (closed[nIdx]) continue;
      const c = classify(nx, ny);
      if (c === BLOCKED) continue;
      // No corner cutting: a diagonal past a wall cell would brush the wall.
      if (dx !== 0 && dy !== 0 && (classify(cx + dx, cy) === BLOCKED || classify(cx, cy + dy) === BLOCKED)) {
        continue;
      }
      const g = gCost[idx]! + step * res * (c === UNKNOWN ? unknownCost : 1);
      if (g < gCost[nIdx]!) {
        gCost[nIdx] = g;
        parent[nIdx] = idx;
        fOf[nIdx] = g + h(nx, ny);
        push(nIdx);
      }
    }
  }
  if (goalIdx < 0) {
    return { ok: false, reason: 'no-path', message: 'no path on the map from here to there' };
  }

  // Reconstruct, cell centres, then replace the first point with the exact start.
  const cellsBack: number[] = [];
  for (let i = goalIdx; i !== -1; i = parent[i]!) cellsBack.push(i);
  cellsBack.reverse();
  const pts: Array<[number, number]> = cellsBack.map((i) => {
    const cx = i % b.width;
    return centre(cx, (i - cx) / b.width);
  });
  pts[0] = [start.x, start.y];
  const unknownNode = cellsBack.map((i) => cls[i] === UNKNOWN);

  // Line of sight between two points: no wall, and no more unknown ground than
  // the sub-path it would replace touched.
  const los = (i: number, j: number): boolean => {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[j]!;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (res / 2)));
    let unknownAlong = false;
    for (let s = 1; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      const [cx, cy] = toCell(x, y);
      if (!inBounds(cx, cy)) return false;
      const c = classify(cx, cy);
      if (c === BLOCKED) return false;
      if (c === UNKNOWN) unknownAlong = true;
    }
    if (!unknownAlong) return true;
    for (let k = i + 1; k <= j; k++) if (unknownNode[k]) return true;
    return false;
  };
  const kept: number[] = [0];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !los(i, j)) j--;
    kept.push(j);
    i = j;
  }
  const waypoints = kept.map((k) => pts[k]!);

  const segments: PathSegment[] = [];
  let lengthM = 0;
  let throughUnknown = false;
  for (let k = 1; k < waypoints.length; k++) {
    const from = waypoints[k - 1]!;
    const to = waypoints[k]!;
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(len / (res / 2)));
    let unk = false;
    for (let s = 1; s <= steps && !unk; s++) {
      const [cx, cy] = toCell(from[0] + ((to[0] - from[0]) * s) / steps, from[1] + ((to[1] - from[1]) * s) / steps);
      if (inBounds(cx, cy) && classify(cx, cy) === UNKNOWN) unk = true;
    }
    throughUnknown ||= unk;
    lengthM += len;
    segments.push({
      from,
      to,
      headingDeg: normalizeDeg((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI),
      lengthM: len,
      throughUnknown: unk,
    });
  }
  return {
    ok: true,
    path: { waypoints, segments, lengthM, throughUnknown, expanded, elapsedMs: now() - t0 },
  };
}

/**
 * Sample the straight line `distanceM` ahead of `from` along `headingDeg`
 * every {@link SEGMENT_STEP_M} against the keepouts (with the geofence margin),
 * the map's occupied cells and the peers. Returns how far is allowed and how
 * far is KNOWN free. Fail-closed on the honest side: no map → `knownM` is 0 and
 * nothing blocks; keepouts are checked even without a map, because a polygon
 * needs no lidar to be a polygon.
 */
export function checkStraightSegment(
  world: PlannerWorld,
  from: { x: number; y: number },
  headingDeg: number,
  distanceM: number,
): SegmentCheck {
  const map = world.map && world.map.isAllocated() ? world.map : null;
  const rad = (headingDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const escape = { x: from.x, y: from.y, r: world.robotRadiusM + (map?.resolution ?? 0.1) };
  let knownM = 0;
  let knownStopped = map === null;
  const steps = Math.max(1, Math.ceil(distanceM / SEGMENT_STEP_M));
  for (let s = 1; s <= steps; s++) {
    const d = Math.min(distanceM, s * SEGMENT_STEP_M);
    const x = from.x + ux * d;
    const y = from.y + uy * d;
    const fence = keepoutAt(world, x, y);
    if (fence) {
      // One step back to the last unfenced sample, and one more as a cushion:
      // the geofence is a protective stop, and a walk that ends a centimetre
      // outside its line is a walk that ends inside it on a slow base.
      const at = Math.max(0, d - 2 * SEGMENT_STEP_M);
      return {
        allowedM: at,
        knownM: Math.min(knownM, at),
        blocker: { kind: 'keepout', label: fence.name },
        blockerAtM: at,
      };
    }
    if (map) {
      const { cls, label } = discClass(map, x, y, world.robotRadiusM, escape);
      if (cls === BLOCKED) {
        const at = Math.max(0, d - SEGMENT_STEP_M);
        return {
          allowedM: at,
          knownM: Math.min(knownM, at),
          blocker: label ? { kind: 'robot', label } : { kind: 'occupied', label: 'an obstacle on the map' },
          blockerAtM: at,
        };
      }
      if (cls === UNKNOWN) knownStopped = true;
      if (!knownStopped) knownM = d;
    }
  }
  return { allowedM: distanceM, knownM, blocker: null, blockerAtM: null };
}

/**
 * @file navigator-planned.test.ts
 * @description The navigator on a map (TASK-208): a straight route is a few
 *              long stages with a look every 2 m instead of six blind metres,
 *              a keepout in the way is gone around and never entered, a goal
 *              inside a keepout is refused by name before the first step, and
 *              "no path" falls back to the staged loop and says so.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { Navigator } from '../navigator.js';
import { LOGODDS_SCALE, OccupancyMap } from '../occupancy-map.js';
import { planPath, type PlannerWorld } from '../path-planner.js';
import type { Place } from '../place-resolver.js';
import { pointInPolygon } from '../place-resolver.js';
import { keepoutDepthM } from '../geofence.js';
import { SceneMemoryStore, type Observation } from '../scene-memory.js';
import { normalizeDeg, type AgentBlock, type AgentBlockKind, type AgentNavPlan } from '../types.js';

const RES = 0.1;

function gridMap(rows: string[]): OccupancyMap {
  const height = rows.length;
  const width = rows[0]!.length;
  const q = new Int8Array(width * height);
  for (let r = 0; r < height; r++) {
    const cy = height - 1 - r;
    for (let cx = 0; cx < width; cx++) {
      const ch = rows[r]![cx];
      q[cy * width + cx] = ch === '#' ? 4 * LOGODDS_SCALE : ch === '.' ? -4 * LOGODDS_SCALE : 0;
    }
  }
  const r = OccupancyMap.fromSnapshot(
    {
      version: 1,
      frame: 'odom',
      frameId: 't',
      resolution: RES,
      originX: -1,
      originY: -3,
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
    { frameId: 't', resolutionM: RES },
  );
  if (!r.map) throw new Error(r.reason);
  return r.map;
}

/** 8 m × 6 m of free floor from (−1, −3) to (7, 3), optionally with a wall across x = 3. */
function room(wall = false): OccupancyMap {
  return gridMap(
    Array.from({ length: 60 }, () => (wall ? '.'.repeat(40) + '#' + '.'.repeat(39) : '.'.repeat(80))),
  );
}

const TABLE: Place = {
  id: 'TABLE',
  name: 'TABLE',
  placeType: 'cell',
  floor: 0,
  polygon: [
    [1.5, -0.6],
    [2.5, -0.6],
    [2.5, 0.6],
    [1.5, 0.6],
  ],
  source: 'surveyed',
  keepout: true,
  landmarks: [],
};

interface WorldOpts {
  target: { x: number; y: number };
  map: OccupancyMap | null;
  keepouts?: Place[];
  planner?: boolean;
}

/**
 * A planar world: the robot has an odometry pose, `turn` rotates it (and the
 * scene's yaw with it, as odometry-backed yaw does), `walk` moves it along its
 * heading, `look` reports the target's bearing and lidar range from the pose.
 */
function makeWorld(scene: SceneMemoryStore, opts: WorldOpts) {
  const pose = { x: 0, y: 0, yawDeg: 0 };
  const ran: Array<{ kind: AgentBlockKind; params: Record<string, unknown>; reasoning: string }> = [];
  const visited: Array<[number, number]> = [[0, 0]];
  const navs: Array<AgentNavPlan | null> = [];

  const distance = (): number => Math.hypot(opts.target.x - pose.x, opts.target.y - pose.y);
  const look = (): void => {
    const world = (Math.atan2(opts.target.y - pose.y, opts.target.x - pose.x) * 180) / Math.PI;
    const observation: Observation = {
      currentView: 'the table',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: [
        {
          label: 'table',
          bearingDeg: normalizeDeg(world - scene.getYawDeg()),
          distanceEstM: distance(),
          distanceSource: 'lidar',
          confidence: 0.9,
        },
      ],
    };
    scene.merge(observation, undefined, { forwardClearanceM: null });
  };

  const runGeneratedBlock = async (
    kind: AgentBlockKind,
    params: Record<string, unknown>,
    reasoning: string,
  ): Promise<AgentBlock> => {
    ran.push({ kind, params, reasoning });
    if (kind === 'turn') {
      const deg = Number(params.angleDeg);
      pose.yawDeg = normalizeDeg(pose.yawDeg + deg);
      scene.advanceYawDeg(deg);
    } else if (kind === 'walk') {
      const d = Number(params.distanceM);
      scene.noteTranslationM(d);
      const rad = (pose.yawDeg * Math.PI) / 180;
      // Sample the walk so a keepout crossing mid-stage is caught.
      const n = Math.max(1, Math.ceil(d / 0.05));
      for (let s = 1; s <= n; s++) {
        visited.push([pose.x + (Math.cos(rad) * d * s) / n, pose.y + (Math.sin(rad) * d * s) / n]);
      }
      pose.x += Math.cos(rad) * d;
      pose.y += Math.sin(rad) * d;
    } else if (kind === 'look') {
      look();
    }
    return {
      id: `gen-${ran.length}`,
      kind,
      params,
      status: 'done',
      reasoning,
      result: 'ok',
      ...(kind === 'walk' ? { measured: { distanceM: Number(params.distanceM) } } : {}),
    };
  };

  const world: PlannerWorld = {
    map: opts.map,
    keepouts: opts.keepouts ?? [],
    keepoutMarginM: 0.5,
    robotRadiusM: 0.35,
  };
  const navigator = new Navigator({
    scene,
    runGeneratedBlock,
    isAborted: () => false,
    maxStages: 12,
    planner:
      opts.planner === false
        ? null
        : {
            plan: (from, goal) => planPath(world, from, goal, { goalToleranceM: 0.6 + 0.35 + RES }),
            samplePose: async () => ({ ...pose }),
            maxSegmentM: 2,
            lookEveryM: 2,
          },
    onNav: (nav) => navs.push(nav),
  });

  return { pose, ran, look, navigator, visited, navs, distance };
}

type Ran = { kind: AgentBlockKind; params: Record<string, unknown>; reasoning: string };
const walks = (ran: Ran[]) => ran.filter((b) => b.kind === 'walk');
const looks = (ran: Ran[]) => ran.filter((b) => b.kind === 'look');

describe('Navigator on the map — straight route', () => {
  it('walks 3.5 m in ≤ 3 stages with a look every 2 m, and arrives by lidar', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { target: { x: 3.5, y: 0 }, map: room() });
    w.look();
    const outcome = await w.navigator.navigate('table');
    expect(outcome.ok).toBe(true);
    expect(walks(w.ran).length).toBeLessThanOrEqual(3);
    // The first stage is a full 2 m planned segment, and the first look comes AFTER it.
    expect(Number(walks(w.ran)[0]!.params.distanceM)).toBeCloseTo(2, 5);
    expect(walks(w.ran)[0]!.params.planned).toBe(true);
    expect(w.ran.findIndex((b) => b.kind === 'look')).toBeGreaterThan(w.ran.findIndex((b) => b.kind === 'walk'));
    expect(looks(w.ran).length).toBeLessThanOrEqual(3);
    expect(w.distance()).toBeLessThanOrEqual(0.61);
    // The route was reported as planned, and cleared at the end.
    expect(w.navs[0]).toMatchObject({ planned: true, target: 'table', segments: 1 });
    expect(w.navs[0]!.path![0]).toEqual([0, 0]);
    expect(w.navs[w.navs.length - 1]).toBeNull();
  });

  it('the same route without a planner is today\'s staged loop (6 stages, a look after each)', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { target: { x: 3.5, y: 0 }, map: room(), planner: false });
    w.look();
    const outcome = await w.navigator.navigate('table');
    expect(outcome.ok).toBe(true);
    expect(walks(w.ran).length).toBeGreaterThanOrEqual(3);
    // A look after every stage — the last one is what ends the navigation.
    expect(looks(w.ran).length).toBe(walks(w.ran).length);
    for (const b of walks(w.ran)) {
      expect(Number(b.params.distanceM)).toBeLessThanOrEqual(1);
      expect(b.params.planned).toBeUndefined();
    }
    // Still reported, honestly: by sight, and why.
    expect(w.navs[0]).toMatchObject({ planned: false, path: null, reason: 'no map planner' });
    expect(w.navs[w.navs.length - 1]).toBeNull();
  });
});

describe('Navigator on the map — keepouts', () => {
  it('goes around a keepout in the way and never enters it or its margin', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { target: { x: 4, y: 0 }, map: room(), keepouts: [TABLE] });
    w.look();
    const outcome = await w.navigator.navigate('table');
    expect(outcome.ok).toBe(true);
    for (const [x, y] of w.visited) {
      expect(pointInPolygon(x, y, TABLE.polygon)).toBe(false);
      expect(keepoutDepthM(x, y, TABLE, 0.5)).toBeNull();
    }
    // It had to leave the straight line: some turn happened, and the plan had ≥ 2 segments.
    expect(w.ran.some((b) => b.kind === 'turn')).toBe(true);
    expect(w.navs[0]!.segments).toBeGreaterThanOrEqual(2);
    expect(w.distance()).toBeLessThanOrEqual(0.61);
  });

  it('refuses a goal inside a keepout, by name, before any step', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { target: { x: 2, y: 0 }, map: room(), keepouts: [TABLE] });
    w.look();
    const outcome = await w.navigator.navigate('table');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe('"table" is inside keepout TABLE — I won\'t walk there.');
    expect(walks(w.ran)).toHaveLength(0);
    expect(w.ran.filter((b) => b.kind === 'turn')).toHaveLength(0);
    expect(w.navs[0]).toMatchObject({ planned: false, reason: 'inside keepout TABLE' });
  });
});

describe('Navigator on the map — no path', () => {
  it('falls back to walking by sight when the map has no path, and says so', async () => {
    const scene = new SceneMemoryStore('r');
    // Wall across x = 3 with no gap; target at 5 m, well behind it.
    const w = makeWorld(scene, { target: { x: 5, y: 0 }, map: room(true) });
    w.look();
    await w.navigator.navigate('table');
    const first = walks(w.ran)[0]!;
    expect(first.reasoning).toContain('walking by sight');
    expect(first.params.planned).toBeUndefined();
    expect(Number(first.params.distanceM)).toBeLessThanOrEqual(1);
    expect(w.navs[0]).toMatchObject({ planned: false });
    expect(w.navs[0]!.reason).toMatch(/no path/);
  });

  it('walks by sight when there is no map at all', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { target: { x: 2.5, y: 0 }, map: null });
    w.look();
    const outcome = await w.navigator.navigate('table');
    expect(outcome.ok).toBe(true);
    expect(walks(w.ran)[0]!.reasoning).toContain('walking by sight');
    for (const b of walks(w.ran)) expect(Number(b.params.distanceM)).toBeLessThanOrEqual(1);
  });
});

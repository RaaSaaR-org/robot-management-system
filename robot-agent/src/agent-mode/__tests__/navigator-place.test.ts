/**
 * @file navigator-place.test.ts
 * @description `goto` a PLACE (TASK-209): the navigator plans on the map into a
 *              room it was given as a polygon — through the doorway, never
 *              through the wall — arrives once the pose is inside and near the
 *              centre, walks by sight while the map has no path yet and re-plans
 *              as the map grows, refuses a keepout, counts a spent stage budget
 *              that ended inside the polygon as arrival, and stops honestly when
 *              the way in is blocked. Plus `resolvePlaceByName` and `placeGoal`.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { Navigator, PLACE_ARRIVAL_M, placeGoal } from '../navigator.js';
import { LOGODDS_SCALE, OccupancyMap } from '../occupancy-map.js';
import { planPath, type PlannerWorld } from '../path-planner.js';
import { pointInPolygon, resolvePlaceByName, type Place } from '../place-resolver.js';
import { SceneMemoryStore, type Observation } from '../scene-memory.js';
import { normalizeDeg, type AgentBlock, type AgentBlockKind, type AgentNavPlan } from '../types.js';

const RES = 0.1;

/**
 * Two rooms side by side, 6 m × 4 m each from (−1, −2): the hallway on the
 * left (x < 3), the kitchen on the right, a wall at x = 3 with a 1.2 m doorway
 * centred on y = 1. Rows are north-up like a printed map.
 */
function twoRooms(opts: { known: boolean; door: boolean } = { known: true, door: true }): OccupancyMap {
  const width = 80; // x ∈ [−1, 7)
  const height = 40; // y ∈ [−2, 2)
  const q = new Int8Array(width * height);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const x = -1 + (cx + 0.5) * RES;
      const y = -2 + (cy + 0.5) * RES;
      const onWall = Math.abs(x - 3) < RES && !(opts.door && Math.abs(y - 1) < 0.6);
      let v = -4 * LOGODDS_SCALE; // free
      if (onWall) v = 4 * LOGODDS_SCALE;
      // Unknown beyond the wall when the kitchen has never been seen.
      if (!opts.known && x > 3 + RES) v = 0;
      q[cy * width + cx] = v;
    }
  }
  const r = OccupancyMap.fromSnapshot(
    {
      version: 1,
      frame: 'odom',
      frameId: 't',
      resolution: RES,
      originX: -1,
      originY: -2,
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

const KITCHEN: Place = {
  id: 'KITCHEN',
  name: 'Kitchen',
  placeType: 'cell',
  floor: 0,
  polygon: [[3, -2], [7, -2], [7, 2], [3, 2]],
  source: 'surveyed',
  keepout: false,
  landmarks: [],
};
const HALLWAY: Place = { ...KITCHEN, id: 'HALLWAY', name: 'Hallway', polygon: [[-1, -2], [3, -2], [3, 2], [-1, 2]] };
const TABLE: Place = {
  ...KITCHEN,
  id: 'TABLE',
  name: 'Table',
  placeType: 'cell',
  polygon: [[4.5, -0.5], [5.5, -0.5], [5.5, 0.5], [4.5, 0.5]],
  keepout: true,
};

interface WorldOpts {
  map: OccupancyMap | null;
  keepouts?: Place[];
  planner?: boolean;
  /** Called after every walk with the pose: lets a test grow the map. */
  afterWalk?: (pose: { x: number; y: number }) => void;
  /** Called after every look: lets a test "restore" the map from the first lidar frame. */
  afterLook?: () => void;
  /** Make the executor refuse walks whose sampled line crosses this x (a wall it can see). */
  wallX?: number;
  /** Whether that wall has the doorway (default true). */
  door?: boolean;
  /** Stage budget for the navigation (default 12). */
  maxStages?: number;
}

function makeWorld(scene: SceneMemoryStore, opts: WorldOpts) {
  const pose = { x: 0, y: 0, yawDeg: 0 };
  const ran: Array<{ kind: AgentBlockKind; params: Record<string, unknown>; reasoning: string }> = [];
  const visited: Array<[number, number]> = [[0, 0]];
  const navs: Array<AgentNavPlan | null> = [];
  const world = { map: opts.map, keepouts: opts.keepouts ?? [], keepoutMarginM: 0.25, robotRadiusM: 0.35 };

  const runGeneratedBlock = async (
    kind: AgentBlockKind,
    params: Record<string, unknown>,
    reasoning: string,
  ): Promise<AgentBlock> => {
    ran.push({ kind, params, reasoning });
    let measured: number | undefined;
    let error: string | undefined;
    if (kind === 'turn') {
      const deg = Number(params.angleDeg);
      pose.yawDeg = normalizeDeg(pose.yawDeg + deg);
      scene.advanceYawDeg(deg);
    } else if (kind === 'walk') {
      let d = Number(params.distanceM);
      const rad = (pose.yawDeg * Math.PI) / 180;
      // The executor's map clamp, reduced to one wall with the doorway at
      // y = 1 ± 0.6 (when the map has one): stop 0.45 m short of the wall.
      if (opts.wallX !== undefined && Math.cos(rad) > 1e-6) {
        const toWall = (opts.wallX - pose.x) / Math.cos(rad) - 0.45;
        const yAtWall = pose.y + Math.sin(rad) * (toWall + 0.45);
        const throughDoor = opts.door !== false && Math.abs(yAtWall - 1) < 0.6;
        if (!throughDoor && toWall < d) {
          if (toWall < 0.3) {
            error = 'walk: an obstacle on the map is 0.10 m ahead on the map — refusing to walk into it.';
            d = 0;
          } else {
            d = toWall;
          }
        }
      }
      const n = Math.max(1, Math.ceil(d / 0.05));
      for (let s = 1; s <= n; s++) {
        visited.push([pose.x + (Math.cos(rad) * d * s) / n, pose.y + (Math.sin(rad) * d * s) / n]);
      }
      pose.x += Math.cos(rad) * d;
      pose.y += Math.sin(rad) * d;
      scene.noteTranslationM(d);
      measured = d;
      opts.afterWalk?.(pose);
    } else if (kind === 'look') {
      const observation: Observation = {
        currentView: 'a room',
        personVisible: false,
        raw: '{}',
        degraded: false,
        entities: [],
      };
      scene.merge(observation, undefined, { forwardClearanceM: null });
      opts.afterLook?.();
    }
    return {
      id: `gen-${ran.length}`,
      kind,
      params,
      status: error ? 'failed' : 'done',
      reasoning,
      result: error ? undefined : 'ok',
      ...(error ? { error } : {}),
      ...(measured !== undefined && !error ? { measured: { distanceM: measured } } : {}),
    };
  };

  const navigator = new Navigator({
    scene,
    runGeneratedBlock,
    isAborted: () => false,
    maxStages: opts.maxStages ?? 12,
    planner:
      opts.planner === false
        ? null
        : {
            plan: (from, goal) => planPath(world as PlannerWorld, from, goal, { goalToleranceM: 0.6 + 0.35 + RES }),
            samplePose: async () => ({ ...pose }),
            maxSegmentM: 2,
            lookEveryM: 2,
          },
    onNav: (nav) => navs.push(nav),
  });
  return { pose, ran, navigator, visited, navs, world };
}

type Ran = { kind: AgentBlockKind; params: Record<string, unknown>; reasoning: string };
const walks = (ran: Ran[]) => ran.filter((b) => b.kind === 'walk');
const looks = (ran: Ran[]) => ran.filter((b) => b.kind === 'look');

describe('placeGoal', () => {
  it('is the centroid of a rectangle, and stays inside a concave polygon', () => {
    expect(placeGoal(KITCHEN)).toEqual({ x: 5, y: 0 });
    // An L: the area centroid falls outside the room, so the deepest interior point is used.
    const L: Place = { ...KITCHEN, polygon: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]] };
    const g = placeGoal(L);
    expect(pointInPolygon(g.x, g.y, L.polygon)).toBe(true);
  });
});

describe('resolvePlaceByName', () => {
  const places = [HALLWAY, KITCHEN, { ...KITCHEN, id: 'LIVING-ROOM', name: 'Living Room' }, TABLE];
  it('matches id or name, any case, dashes as spaces, articles ignored', () => {
    expect(resolvePlaceByName('kitchen', places)?.id).toBe('KITCHEN');
    expect(resolvePlaceByName('the Kitchen', places)?.id).toBe('KITCHEN');
    expect(resolvePlaceByName('living room', places)?.id).toBe('LIVING-ROOM');
    expect(resolvePlaceByName('LIVING-ROOM', places)?.id).toBe('LIVING-ROOM');
    expect(resolvePlaceByName('living', places)?.id).toBe('LIVING-ROOM');
  });
  it('is null for nothing, for the unknown, and for the ambiguous', () => {
    expect(resolvePlaceByName('', places)).toBeNull();
    expect(resolvePlaceByName('garage', places)).toBeNull();
    // "room" is in both Living Room and nothing else here — make it ambiguous:
    expect(resolvePlaceByName('room', [...places, { ...KITCHEN, id: 'BEDROOM', name: 'Bed Room' }])).toBeNull();
  });
});

describe('Navigator.navigateToPlace — on a known map', () => {
  it('walks into the kitchen through the doorway, never through the wall, and arrives near the centre', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { map: twoRooms() });
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/^Arrived in Kitchen after \d+ stages? and [\d.]+ m/);
    // Inside, near the centre (5, 0).
    expect(pointInPolygon(w.pose.x, w.pose.y, KITCHEN.polygon)).toBe(true);
    expect(Math.hypot(w.pose.x - 5, w.pose.y)).toBeLessThanOrEqual(PLACE_ARRIVAL_M + 0.01);
    // Every sampled point of every walk is off the wall — through the door.
    for (const [x, y] of w.visited) {
      if (Math.abs(x - 3) < 0.15) expect(Math.abs(y - 1)).toBeLessThan(0.6);
    }
    // No look was needed to find the place, but looks happened on the way (discovery).
    expect(walks(w.ran)[0]!.params.planned).toBe(true);
    expect(looks(w.ran).length).toBeGreaterThanOrEqual(1);
    // The route was reported under the place's name and cleared at the end.
    expect(w.navs[0]).toMatchObject({ planned: true, target: 'Kitchen' });
    expect(w.navs[0]!.goal).toEqual({ x: 5, y: 0 });
    expect(w.navs[w.navs.length - 1]).toBeNull();
  });

  it('follows a route that first leads AWAY from the centre — progress is the remaining route, not the crow-flies distance', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { map: twoRooms() });
    // Start below the doorway, hugging the wall; the target strip is right
    // across the wall, so the straight-line distance GROWS for the first stages
    // while the route climbs to the door at y = 1.
    w.pose.x = 2.4;
    w.pose.y = -1.6;
    const strip: Place = { ...KITCHEN, id: 'PANTRY', name: 'Pantry', polygon: [[3, -2], [7, -2], [7, -1.2], [3, -1.2]] };
    const outcome = await w.navigator.navigateToPlace(strip);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/^Arrived in Pantry/);
    expect(pointInPolygon(w.pose.x, w.pose.y, strip.polygon)).toBe(true);
    for (const [x, y] of w.visited) {
      if (Math.abs(x - 3) < 0.15) expect(Math.abs(y - 1)).toBeLessThan(0.6);
    }
  });

  it('is already there: a robot standing in the kitchen near its centre arrives in 0 stages', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { map: twoRooms() });
    w.pose.x = 4.6;
    w.pose.y = 0.2;
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/after 0 stages/);
    expect(w.ran).toHaveLength(0);
  });

  it('refuses a keepout place by name before moving', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { map: twoRooms(), keepouts: [TABLE] });
    const outcome = await w.navigator.navigateToPlace(TABLE);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/"Table" is a keepout/);
    expect(w.ran).toHaveLength(0);
  });

  it('refuses a place whose centre is fenced, naming the fence', async () => {
    const scene = new SceneMemoryStore('r');
    const bigTable = { ...TABLE, polygon: [[3.5, -1.5], [6.5, -1.5], [6.5, 1.5], [3.5, 1.5]] as Place['polygon'] };
    const w = makeWorld(scene, { map: twoRooms(), keepouts: [bigTable] });
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/centre of Kitchen is inside keepout Table/);
    expect(walks(w.ran)).toHaveLength(0);
  });

  it('needs the map planner', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, { map: twoRooms(), planner: false });
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/needs the map planner/);
  });
});

describe('Navigator.navigateToPlace — discovering the map as it goes', () => {
  it('walks by sight while the kitchen is unmapped, and plans through the door once the map knows it', async () => {
    const scene = new SceneMemoryStore('r');
    // The kitchen is unknown and the doorway too — a wall the lidar has not
    // resolved. After the first walk the map "sees" the wall and the door.
    let map = twoRooms({ known: false, door: false });
    const w = makeWorld(scene, {
      map,
      afterWalk: () => {
        map = twoRooms({ known: true, door: true });
        w.world.map = map;
      },
      wallX: 3,
    });
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(true);
    expect(pointInPolygon(w.pose.x, w.pose.y, KITCHEN.polygon)).toBe(true);
    // Something was walked by sight or planned across unknown floor first, then planned.
    const reasons = walks(w.ran).map((b) => b.reasoning);
    expect(reasons.some((r) => /by sight|unmapped floor/.test(r))).toBe(true);
    expect(walks(w.ran).some((b) => b.params.planned === true)).toBe(true);
    // And the wall was never crossed except through the doorway.
    for (const [x, y] of w.visited) {
      if (Math.abs(x - 3) < 0.15) expect(Math.abs(y - 1)).toBeLessThan(0.6);
    }
  });

  it('looks once before setting off when the map is empty — the first lidar frame restores it — instead of a blind stage', async () => {
    const scene = new SceneMemoryStore('r');
    const w = makeWorld(scene, {
      map: null,
      afterLook: () => {
        w.world.map = twoRooms();
      },
    });
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(true);
    expect(w.ran[0]!.kind).toBe('look');
    expect(w.ran[0]!.reasoning).toMatch(/the map has nothing yet/);
    // Every walk after that was planned — no "by sight" stage was needed.
    for (const b of walks(w.ran)) expect(b.params.planned).toBe(true);
  });

  it('counts a spent stage budget that ended INSIDE the place as arrival, not as giving up', async () => {
    const scene = new SceneMemoryStore('r');
    // Three stages is not enough to reach the centre of the kitchen from the
    // far corner of the hallway — but it IS enough to get through the door and
    // stand in the kitchen. The order was "go to the kitchen", and the robot is
    // in the kitchen: the budget expiring on the way to the centre does not
    // undo that. This is the warehouse run that motivated the rule — 18.01 m
    // walked, standing inside Dock 1, 1.41 m of route short of the centroid,
    // reported as "gave up after 12 stages".
    const w = makeWorld(scene, { map: twoRooms(), maxStages: 3 });
    w.pose.x = -0.9;
    w.pose.y = -1;
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/^Arrived in Kitchen after 3 stages and [\d.]+ m/);
    expect(outcome.message).not.toMatch(/gave up/);
    // And honest about how it ended: short of the centre, out of stages.
    expect(outcome.message).toMatch(/stopped [\d.]+ m from its centre — the 3-stage budget ran out/);
    expect(pointInPolygon(w.pose.x, w.pose.y, KITCHEN.polygon)).toBe(true);
    expect(Math.hypot(w.pose.x - 5, w.pose.y)).toBeGreaterThan(PLACE_ARRIVAL_M);
  });

  it('still gives up when the spent stage budget left it OUTSIDE the place', async () => {
    const scene = new SceneMemoryStore('r');
    // The same three stages from one metre further back: the robot is still in
    // the hallway when they run out. Not in the kitchen, so not arrived.
    const w = makeWorld(scene, { map: twoRooms(), maxStages: 3 });
    w.pose.x = -0.9;
    w.pose.y = -1.7;
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/gave up after 3 stages \(3 on a planned path\) and [\d.]+ m/);
    expect(outcome.message).toMatch(/shortest remaining route [\d.]+ m\.$/);
    expect(pointInPolygon(w.pose.x, w.pose.y, KITCHEN.polygon)).toBe(false);
  });

  it('stops honestly when the way in stays blocked', async () => {
    const scene = new SceneMemoryStore('r');
    // A wall with no door and nothing ever changing: no path, by-sight walks are
    // refused at the wall, and the navigation must end saying so — not "arrived".
    const w = makeWorld(scene, { map: twoRooms({ known: true, door: false }), wallX: 3, door: false });
    const outcome = await w.navigator.navigateToPlace(KITCHEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/blocked or not on the map|gave up/);
    expect(pointInPolygon(w.pose.x, w.pose.y, KITCHEN.polygon)).toBe(false);
  });
});

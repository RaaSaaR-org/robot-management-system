/**
 * @file navigator-executor.test.ts
 * @description `Navigator` driven against a REAL `BlockExecutor` and a real
 *              `RangeSensor`, over a fake loco client and a fake camera: the
 *              only test in the suite where a `goto` is expanded into blocks
 *              that are then actually executed. The other navigator tests run
 *              against `makeWorld`, a hand-written model that re-derives the
 *              bearings, calls `noteTranslationM` itself AND writes its own
 *              `measured` onto every finished block — so they would all stay
 *              green if the executor stopped doing any of the three. This one
 *              is the tripwire for all three (TASK-221 item 5).
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { BlockExecutor } from '../block-executor.js';
import { Navigator } from '../navigator.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { DEG_TO_RAD, RAD_TO_DEG, normalizeDeg, type AgentBlock, type AgentBlockKind } from '../types.js';
import type { VisionClient, VisionEntity, VisionObservation } from '../vision.js';
import type { PointCloudFrame } from '../../robot/types.js';

/** Half the fake camera's field of view — outside it the table is not reported. */
const CAMERA_HALF_FOV_DEG = 60;
/** Points in the synthetic return arc, and its half-width in degrees. */
const ARC_POINTS = 41;
const ARC_HALF_WIDTH_DEG = 8;

interface WorldOptions {
  /** Where the table stands, in the odometry frame, metres. */
  table: { x: number; y: number };
  /** Where the robot starts. Yaw in degrees, CCW positive, +x = 0. */
  robot?: { x: number; y: number; yawDeg: number };
  /**
   * Extra entities the camera reports verbatim in every frame, on top of the
   * table the geometry places. Used to inject one the VLM could not place.
   */
  alsoSees?: readonly VisionEntity[];
}

/**
 * A world the executor's own commands move.
 *
 * The point of this harness is that NOTHING in it talks to scene memory. The
 * loco client integrates `(vx, vy, omega, durationS)` into a pose and reports
 * that pose back as odometry; the camera reports the bearing the geometry
 * implies; the LiDAR reports an arc of returns where the table actually is.
 * Every bearing, every distance and every staleness signal the navigator acts
 * on has to come out of `BlockExecutor` for the navigation to work at all.
 */
function makeWorld(scene: SceneMemoryStore, opts: WorldOptions) {
  const pose = { x: opts.robot?.x ?? 0, y: opts.robot?.y ?? 0, yawRad: (opts.robot?.yawDeg ?? 0) * DEG_TO_RAD };
  const ran: Array<{ kind: AgentBlockKind; params: Record<string, unknown> }> = [];
  /**
   * The FINISHED blocks, exactly as the navigator receives them — `measured`
   * included. `ran` records what was ASKED FOR; this records what came back,
   * which is the half the navigator's stage accounting reads.
   */
  const finished: AgentBlock[] = [];

  /** Where the table is from the robot right now: metres and degrees, relative. */
  const relative = (): { distanceM: number; bearingDeg: number } => {
    const dx = opts.table.x - pose.x;
    const dy = opts.table.y - pose.y;
    return {
      distanceM: Math.hypot(dx, dy),
      bearingDeg: normalizeDeg(Math.atan2(dy, dx) * RAD_TO_DEG - pose.yawRad * RAD_TO_DEG),
    };
  };

  /** Teleoperate the base: motion the executor never commanded and never sees. */
  const teleopTo = (x: number, y: number): void => {
    pose.x = x;
    pose.y = y;
  };

  /**
   * Ground truth: metres this base has actually been driven, summed over every
   * commanded segment. `teleopTo` deliberately does NOT add to it — it is
   * motion nobody commanded, and the point of that test is that no block
   * reported it.
   */
  let travelledM = 0;

  const loco = {
    move: async (vx: number, vy: number, omega: number, durationS: number) => {
      // Rotation first, then translation along the resulting heading. Blocks are
      // never both at once (see walkToCommand / turnToCommand), so the order
      // only matters for keeping this honest, not for the arithmetic.
      pose.yawRad += omega * durationS;
      const c = Math.cos(pose.yawRad);
      const s = Math.sin(pose.yawRad);
      const dx = (vx * c - vy * s) * durationS;
      const dy = (vx * s + vy * c) * durationS;
      pose.x += dx;
      pose.y += dy;
      travelledM += Math.hypot(dx, dy);
      return { ok: true };
    },
    action: async () => ({ ok: true }),
    fsm: async () => ({ ok: true }),
    standHeight: async () => ({ ok: true }),
    odometry: async () => ({ x: pose.x, y: pose.y, yaw: pose.yawRad, source: 'sim' }),
  };

  const vision: VisionClient = {
    observe: async (): Promise<VisionObservation> => {
      const { bearingDeg } = relative();
      const inFrame = Math.abs(bearingDeg) <= CAMERA_HALF_FOV_DEG;
      return {
        currentView: inFrame ? 'a table' : 'a bare wall',
        // No distance from the camera on purpose: the VLM's own guess is 0.94 m
        // MAE and the navigator refuses to steer on it, so every metre in this
        // test has to come through the range sensor.
        entities: [
          ...(inFrame ? [{ label: 'table', bearingDeg, distanceEstM: null, confidence: 0.9 }] : []),
          ...(opts.alsoSees ?? []),
        ],
        personVisible: false,
        raw: '{}',
        degraded: false,
      };
    },
  } as unknown as VisionClient;

  /** An arc of returns where the table is, in `base_link` — what the MID-360 sees. */
  const range = new RangeSensor({
    snapshot: async (): Promise<PointCloudFrame> => {
      const { distanceM, bearingDeg } = relative();
      const positions: number[] = [];
      for (let i = 0; i < ARC_POINTS; i++) {
        const spread = -ARC_HALF_WIDTH_DEG + (2 * ARC_HALF_WIDTH_DEG * i) / (ARC_POINTS - 1);
        const az = (bearingDeg + spread) * DEG_TO_RAD;
        positions.push(distanceM * Math.cos(az), distanceM * Math.sin(az), 1.0);
      }
      return {
        robotId: 'robot-1',
        sensor: 'mid360_lidar',
        sensorType: 'lidar',
        frame: 'base_link',
        pointCount: ARC_POINTS,
        positions,
        intensities: [],
        hasIntensity: false,
        sequence: 1,
        source: 'hardware',
        timestamp: '2026-08-27T12:00:00.000Z',
      };
    },
  });

  // Every bearing the executor asks the LiDAR for, one array per `measure`
  // call. The point of recording them is negative: an entity with no bearing
  // must not appear here at all, under any value.
  const rangedBearings: number[][] = [];
  const measureReal = range.measure.bind(range);
  range.measure = async (bearingsDeg: number[]) => {
    rangedBearings.push([...bearingsDeg]);
    return measureReal(bearingsDeg);
  };

  const executor = new BlockExecutor({
    scene,
    vision,
    range,
    isAborted: () => false,
    loco,
    memory: null,
    sleep: async () => {},
    now: () => 1e12,
  });

  const run = async (
    kind: AgentBlockKind,
    params: Record<string, unknown> = {},
    reasoning = ''
  ): Promise<AgentBlock> => {
    ran.push({ kind, params });
    const block: AgentBlock = { id: `gen-${ran.length}`, kind, params, status: 'running', reasoning };
    const outcome = await executor.execute(block);
    const done: AgentBlock = {
      ...block,
      status: outcome.ok ? 'done' : 'failed',
      ...(outcome.ok ? { result: outcome.message } : { error: outcome.message }),
      ...(outcome.measured ? { measured: outcome.measured } : {}),
    };
    finished.push(done);
    return done;
  };

  return {
    pose,
    ran,
    finished,
    run,
    relative,
    teleopTo,
    executor,
    rangedBearings,
    travelledM: () => travelledM,
  };
}

describe('Navigator × BlockExecutor', () => {
  it('converges on a real target with every bearing and metre coming out of the executor', async () => {
    // 3.0 m away and 25° off the nose: far enough to need several stages, off
    // enough to need a correction turn first.
    const scene = new SceneMemoryStore('robot-1');
    const world = makeWorld(scene, {
      table: { x: 3.0 * Math.cos(25 * DEG_TO_RAD), y: 3.0 * Math.sin(25 * DEG_TO_RAD) },
    });

    // The seeding look, through the executor: vision → range → scene.merge.
    await world.run('look');
    expect(scene.get('table')?.distanceSource).toBe('lidar');
    expect(scene.get('table')?.distanceEstM).toBeCloseTo(3.0, 1);

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.run,
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/"table"/);
    // It really got there — the world's own geometry, not the store's opinion.
    expect(world.relative().distanceM).toBeLessThanOrEqual(0.7);
    // One correction turn onto the 25° bearing, then stages of at most a metre.
    const turns = world.ran.filter((b) => b.kind === 'turn');
    expect(turns).toHaveLength(1);
    expect(Number(turns[0]!.params.angleDeg)).toBeCloseTo(25, 0);
    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks.length).toBeGreaterThan(1);
    for (const walk of walks) expect(Number(walk.params.distanceM)).toBeLessThanOrEqual(1);

    // STAGE ACCOUNTING — the second thing item 5 said `makeWorld` would sleep
    // through, and the one `noteTranslationM` above does not cover. The
    // navigator's `walkedTotalM` and `stagesThatMoved` are fed by
    // `walk.measured?.distanceM` and by nothing else (navigator.ts, the walk
    // stage): drop `measured` from `BlockExecutor.walk`'s success outcome and
    // every stage silently becomes "0 m, and moved anyway" — the `?? null`
    // reads as "no odometry", which the navigator is written to forgive.
    // Nothing in this file noticed that, so assert the field itself here.
    const walkOutcomes = world.finished.filter((b) => b.kind === 'walk');
    expect(walkOutcomes.length).toBe(walks.length);
    for (const walk of walkOutcomes) {
      // ≥ CONTACT_STALL_M is not decoration: it is the exact test the navigator
      // applies before counting a stage as one that MOVED, so a `measured` that
      // came back as an unusable number would fail here too.
      expect(walk.measured?.distanceM).toBeGreaterThanOrEqual(0.05);
    }
    // And they total what the base was really driven — the number `walkedTotalM`
    // accumulates, checked against the world's own odometer rather than against
    // the commanded metres the store already hears about.
    //
    // The stage ALIGNMENT is part of that total now. It is issued as an arc —
    // `vx > 0` with `omega != 0`, the only rotation this locomotion checkpoint
    // performs to the left — so it covers ground as well as heading, reports the
    // metres in `measured.distanceM`, and the navigator takes them off the stage
    // that follows. Summing the walks alone would be short by exactly that arc,
    // which is the assumption "a turn does not move the robot" leaving a mark.
    const turnOutcomes = world.finished.filter((b) => b.kind === 'turn');
    const arcedTotalM = turnOutcomes.reduce((sum, b) => sum + (b.measured?.distanceM ?? 0), 0);
    expect(arcedTotalM).toBeGreaterThan(0);
    const measuredTotalM =
      walkOutcomes.reduce((sum, b) => sum + (b.measured?.distanceM ?? 0), 0) + arcedTotalM;
    expect(measuredTotalM).toBeCloseTo(world.travelledM(), 6);
  });

  it('does not arrive on a distance the executor has since walked the robot away from', async () => {
    // THE TRIPWIRE. `driveFor` telling scene memory the robot has moved is the
    // only thing standing between this and "Arrived at table after 0 stages":
    // the table is stored at 0.55 m — inside ARRIVAL_M — so the first check of
    // the navigation loop answers "arrived" unless the pre-flight look has
    // replaced that metre first. `walk` never calls `refreshYaw`, so between
    // the walk and the goto nothing samples odometry either, and the COMMANDED
    // metres from driveFor are the only signal there is.
    //
    // Delete `this.deps.scene.noteTranslationM(...)` from `BlockExecutor.driveFor`
    // and this test fails on the very first expectation.
    const scene = new SceneMemoryStore('robot-1');
    const world = makeWorld(scene, { table: { x: 0.55, y: 0 } });

    await world.run('look');
    expect(scene.get('table')?.distanceEstM).toBeCloseTo(0.55, 1);

    // Straight back, three metres, through the real executor.
    const retreat = await world.run('walk', { distanceM: 3.0, direction: 'backward' });
    expect(retreat.status).toBe('done');
    expect(world.relative().distanceM).toBeCloseTo(3.55, 1);

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.run,
      maxStages: 12,
    });
    const before = world.ran.length;

    const outcome = await navigator.navigate('table');

    const generated = world.ran.slice(before);
    // It cannot have declared victory where it stood…
    expect(outcome.message).not.toMatch(/after 0 stages/);
    // …because it measured again before committing to anything…
    expect(generated[0]?.kind).toBe('look');
    // …and it walked the three and a half metres for real.
    expect(generated.filter((b) => b.kind === 'walk').length).toBeGreaterThan(2);
    expect(outcome.ok).toBe(true);
    expect(world.relative().distanceM).toBeLessThanOrEqual(0.7);
  });

  it('retires what a TELEOP drive invalidated on the next block that reads odometry', async () => {
    // The other half of TASK-221 item 1, at the executor level. The operator
    // takes the lock and drives four metres: no block ran, so nothing commanded
    // anything and `noteTranslationM` was never called. `refreshYaw` reading
    // `{ x, y }` off the same `/loco/odom` it already read the yaw from is what
    // notices, and a turn is enough to trigger it — the distances go, exactly as
    // they do after a commanded walk.
    const scene = new SceneMemoryStore('robot-1');
    const world = makeWorld(scene, { table: { x: 0.55, y: 0 } });

    await world.run('look');
    expect(scene.get('table')?.distanceEstM).toBeCloseTo(0.55, 1);
    expect(scene.get('table')?.distanceSource).toBe('lidar');

    world.teleopTo(-4, 0);
    // Nothing has read odometry yet, so the store cannot know — this is the
    // window the navigator's comment still admits to.
    expect(scene.hasMovedSinceObservation()).toBe(false);

    await world.run('turn', { angleDeg: 45 });

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBeNull();
    expect(scene.get('table')?.distanceSource).toBeNull();
  });

  it('never ranges an entity the VLM could not place, and refuses to walk to it', async () => {
    // TASK-221 item 2. The robot stands nose-on to a table 0.55 m away, and the
    // model also reports a "door" it cannot place — no `x`, no `bearingDeg`,
    // which is exactly what `parseVisionAnswer` yields from `"x": null`.
    //
    // Fabricating bearing 0 for it made every step downstream agree with every
    // other: 0° is straight ahead, so the range cone measures the TABLE, 0.55 m
    // comes back stamped `distanceSource: 'lidar'`, the door is stored at that
    // bearing and that metre, and `goto "door"` — already inside ARRIVAL_M —
    // reports an arrival after 0 stages with the robot's nose against a table
    // and every provenance field claiming the metre was measured.
    const scene = new SceneMemoryStore('robot-1');
    const world = makeWorld(scene, {
      table: { x: 0.55, y: 0 },
      alsoSees: [{ label: 'door', distanceEstM: null, confidence: 0.8 }],
    });

    await world.run('look');

    // ONE cone, aimed at the table. The door contributed no bearing to range.
    expect(world.rangedBearings).toHaveLength(1);
    expect(world.rangedBearings[0]).toHaveLength(1);
    expect(world.rangedBearings[0]![0]).toBeCloseTo(0, 6);
    // The table is placed and measured; the door is not stored at all, because
    // there is no direction to store it in.
    expect(scene.get('table')?.distanceSource).toBe('lidar');
    expect(scene.get('table')?.distanceEstM).toBeCloseTo(0.55, 1);
    expect(scene.get('door')).toBeUndefined();
    // Dropping the door did not cost the frame its real row: the table is still
    // in the summary the planner reads, and the door — which the store has no
    // direction for — is nowhere in it. "The sighting still counts" is a fact
    // about the OBSERVATION, one level up from this store, and it is asserted
    // where it holds: `vision.test.ts`, on `personVisible` and `currentView`.
    expect(scene.summary()).toMatch(/table/);
    expect(scene.summary()).not.toMatch(/door/i);

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.run,
      maxStages: 12,
    });
    const before = world.ran.length;

    const outcome = await navigator.navigate('door');

    // The refusal is the honest one already in the navigator: it does not know
    // where the door is, so there is nothing to steer at.
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/not in the scene memory/);
    expect(outcome.message).not.toMatch(/Arrived/i);
    // The base never moved: only the extra look the navigator takes to see
    // whether a second frame can place it.
    const generated = world.ran.slice(before);
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every((b) => b.kind === 'look')).toBe(true);
    expect(world.pose.x).toBeCloseTo(0, 6);
    expect(world.pose.y).toBeCloseTo(0, 6);
    // And that look did not range it either — every cone in this test is the
    // table's.
    for (const call of world.rangedBearings) expect(call).toHaveLength(1);
  });
});

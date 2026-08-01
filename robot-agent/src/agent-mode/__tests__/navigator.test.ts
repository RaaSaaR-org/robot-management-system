/**
 * @file navigator.test.ts
 * @description The `goto` bearing-and-correct loop against a simulated world:
 *              it converges on a target that gets closer, and it gives up after
 *              AGENT_MAX_NAV_STAGES when the target never does. Plus the range
 *              rules: only a MEASURED distance may end the navigation, and no
 *              stage may be longer than the measured way ahead.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { Navigator } from '../navigator.js';
import { SceneMemoryStore, type Observation } from '../scene-memory.js';
import { normalizeDeg, type AgentBlock, type AgentBlockKind } from '../types.js';

interface WorldOptions {
  /** True world bearing of the target, degrees. */
  worldBearingDeg: number;
  distanceM: number;
  /** Fraction of a commanded walk that actually closes the gap. 0 = no progress. */
  progressFactor?: number;
  /** Simulate no distance at all — neither a lidar range nor a VLM guess. */
  distanceUnknown?: boolean;
  /**
   * Where the distance the looks report came from. 'lidar' is a measurement and
   * the navigator may act on it; 'vlm-estimate' is the vision model's own guess
   * (0.94 m MAE) and must never trigger arrival. Default 'lidar' — a robot with
   * a working range sensor is the normal case now.
   */
  distanceSource?: 'lidar' | 'vlm-estimate';
  /**
   * What the forward-clearance measurement reports on every look, in metres.
   * `undefined` = no range sensor answered, which is the pre-LiDAR world and
   * must leave the navigator's behaviour exactly as it was.
   */
  clearanceM?: number;
  /**
   * Report the target's own distance as the forward clearance — the case where
   * the thing being walked to IS the nearest surface ahead.
   */
  clearanceFromTarget?: boolean;
  /**
   * Number of looks after which the target drops out of frame — every later
   * look reports the room but not the target, exactly as the real VLM does once
   * the robot has turned away from it.
   */
  visibleForLooks?: number;
  /**
   * Number of walks after which the robot is physically stuck: every later walk
   * FAILS with 0.00 m measured, exactly as `walk` does when the base is up
   * against something (or when the loco service is dead — the navigator has to
   * tell those apart).
   */
  blockedAfterWalks?: number;
  /**
   * What being blocked looks like. 'stall' is the hard case the executor fails
   * (0.00 m measured); 'short' is the far more common one on real contact — the
   * walk succeeds but barely moves, which is how a base pushing against a table
   * actually reports.
   */
  blockedMode?: 'stall' | 'short';
  /**
   * Index of ONE look (0 = the seeding look) that comes back without a range
   * for the target — the sensor is alive, this snapshot just produced nothing
   * usable: a 1500 ms timeout, an empty cloud, a cone too sparse to cluster.
   * The 07 recording saw three such frames in one `scan_room`, so this is the
   * measured failure mode, not an invented one.
   */
  unrangedLookIndex?: number;
}

/**
 * A tiny world model: `turn` rotates the robot, `walk` closes (some of) the
 * distance, `look` writes what the robot would now see into scene memory.
 */
function makeWorld(scene: SceneMemoryStore, opts: WorldOptions) {
  const state = { distance: opts.distanceM, worldBearing: opts.worldBearingDeg };
  const progressFactor = opts.progressFactor ?? 1;
  const ran: Array<{ kind: AgentBlockKind; params: Record<string, unknown> }> = [];

  let looks = 0;
  let walks = 0;

  // A distance always carries its provenance, exactly as BlockExecutor's range
  // enrichment produces it: no distance → no source.
  const sourceOf = (distanceM: number | null): 'lidar' | 'vlm-estimate' | null =>
    distanceM === null ? null : (opts.distanceSource ?? 'lidar');

  const look = (): void => {
    // Once the target leaves the frame the look still succeeds — it just says
    // nothing about the target, which is what leaves the stored bearing stale.
    const visible = opts.visibleForLooks === undefined || looks < opts.visibleForLooks;
    const unranged = opts.unrangedLookIndex !== undefined && looks === opts.unrangedLookIndex;
    looks++;
    const targetDistance = opts.distanceUnknown || unranged ? null : state.distance;
    const observation: Observation = {
      currentView: visible ? 'I can see the table' : 'a shelf and a wall',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: visible
        ? [
            {
              label: 'table',
              bearingDeg: normalizeDeg(state.worldBearing - scene.getYawDeg()),
              distanceEstM: targetDistance,
              distanceSource: sourceOf(targetDistance),
              confidence: 0.9,
            },
          ]
        : [
            {
              label: 'shelf',
              bearingDeg: 0,
              distanceEstM: 2,
              distanceSource: sourceOf(2),
              confidence: 0.9,
            },
          ],
    };
    const clearanceM =
      opts.clearanceM !== undefined
        ? opts.clearanceM
        : opts.clearanceFromTarget
          ? state.distance
          : null;
    scene.merge(observation, undefined, { forwardClearanceM: clearanceM });
  };

  const runGeneratedBlock = async (
    kind: AgentBlockKind,
    params: Record<string, unknown>,
    reasoning: string
  ): Promise<AgentBlock> => {
    ran.push({ kind, params });
    if (kind === 'turn') {
      scene.advanceYawDeg(Number(params.angleDeg));
    } else if (kind === 'walk') {
      // What BlockExecutor.driveFor does for every base motion: tell the store
      // the robot is no longer where it measured from. Unconditional, and before
      // the blocked branch below, because a walk that fails may still have moved.
      scene.noteTranslationM(Number(params.distanceM));
      if (opts.blockedAfterWalks !== undefined && walks >= opts.blockedAfterWalks) {
        walks++;
        if (opts.blockedMode === 'short') {
          return {
            id: `gen-${ran.length}`,
            kind,
            params,
            status: 'done',
            reasoning,
            result: 'Walked 0.04 m forward — 96% short of the commanded 1.00 m',
            measured: { distanceM: 0.04 },
          };
        }
        return {
          id: `gen-${ran.length}`,
          kind,
          params,
          status: 'failed',
          reasoning,
          error: 'walk: the robot did not move (0.00 m measured for a commanded 1.00 m)',
          measured: { distanceM: 0 },
        };
      }
      walks++;
      state.distance = Math.max(0, state.distance - Number(params.distanceM) * progressFactor);
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

  return { state, ran, look, runGeneratedBlock };
}

describe('Navigator — convergence', () => {
  it('turns onto the bearing, walks in ~1 m stages and arrives', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 30, distanceM: 3 });
    world.look();

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Arrived at "table"/);

    // Exactly one correction turn, onto the initial 30° bearing.
    const turns = world.ran.filter((b) => b.kind === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].params.angleDeg).toBeCloseTo(30, 6);
    expect(scene.getYawDeg()).toBeCloseTo(30, 6);

    // Stages are capped at 1 m each, never one long dash at the target.
    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks.length).toBeGreaterThan(1);
    for (const walk of walks) expect(Number(walk.params.distanceM)).toBeLessThanOrEqual(1);

    // Every walk is followed by a look — that is what re-bears the target.
    expect(world.ran.filter((b) => b.kind === 'look')).toHaveLength(walks.length);
  });

  it('skips the correction turn when the target is already dead ahead', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 2, distanceM: 1.2 });
    world.look();

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(world.ran.filter((b) => b.kind === 'turn')).toHaveLength(0);
  });

  it('re-bears after every look when the target keeps moving off-centre', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 3 });
    world.look();

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      // Nudge the target sideways after every walk, so each stage needs a turn.
      runGeneratedBlock: async (kind, params, reasoning) => {
        const done = await world.runGeneratedBlock(kind, params, reasoning);
        if (kind === 'walk') world.state.worldBearing = normalizeDeg(world.state.worldBearing + 25);
        return done;
      },
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(world.ran.filter((b) => b.kind === 'turn').length).toBeGreaterThan(1);
  });
});

describe('Navigator — abort', () => {
  it('gives up after maxStages when the target never gets closer', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 4, progressFactor: 0 });
    world.look();

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 3,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/gave up after 3 stages/);
    expect(outcome.message).toMatch(/3 of them without getting closer/);
    expect(world.ran.filter((b) => b.kind === 'walk')).toHaveLength(3);
  });

  it('never counts an unknown distance as progress', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, {
      worldBearingDeg: 0,
      distanceM: 4,
      distanceUnknown: true,
    });
    world.look();

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 2,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/distance never estimated/);
  });

  it('stops rather than steering on a bearing no look has confirmed', async () => {
    // Measured against the real sim: after one good stage the VLM stopped
    // reporting the table, `scene.get` kept returning the stale bearing, and
    // the robot walked four more stages north into a wall.
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, {
      worldBearingDeg: 0,
      distanceM: 6,
      // The seeding look plus one in-loop look, then the target drops out.
      visibleForLooks: 2,
    });
    world.look();

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/did not report it/);
    expect(outcome.message).toMatch(/2 looks in a row did not report it/);
    expect(outcome.message).toMatch(/stale/);
    // The point of the fix: it stops early instead of burning all 12 stages.
    expect(world.ran.filter((b) => b.kind === 'walk').length).toBeLessThanOrEqual(3);
  });

  it('forgives a single blind look and carries on once the target is seen again', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 3 });
    world.look();

    // Exactly one look in the middle of the run reports nothing about the
    // target — a blink, not a loss, and it must not end the navigation.
    let lookCount = 0;
    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: async (kind, params, reasoning) => {
        if (kind === 'look' && lookCount++ === 0) {
          world.ran.push({ kind, params });
          scene.merge({
            currentView: 'kurz nichts Erkennbares',
            entities: [],
            personVisible: false,
            raw: '{}',
            degraded: false,
          });
          return { id: 'blind', kind, params, status: 'done', reasoning, result: 'ok' };
        }
        return world.runGeneratedBlock(kind, params, reasoning);
      },
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Arrived at "table"/);
  });

  it('stops between stages when the abort flag is raised', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 5 });
    world.look();
    let aborted = false;

    const navigator = new Navigator({
      scene,
      isAborted: () => aborted,
      runGeneratedBlock: async (kind, params, reasoning) => {
        const done = await world.runGeneratedBlock(kind, params, reasoning);
        if (kind === 'look') aborted = true;
        return done;
      },
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/aborted after 1 stages/);
  });

  it('fails honestly when the entity was never seen', async () => {
    const scene = new SceneMemoryStore('robot-1');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 2 });

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      // A look that finds nothing — the store stays empty.
      runGeneratedBlock: async (kind, params, reasoning) => {
        world.ran.push({ kind, params });
        if (kind === 'look') {
          scene.merge({
            currentView: 'nichts Erkennbares',
            entities: [],
            personVisible: false,
            raw: '{}',
            degraded: false,
          });
        }
        return { id: 'gen', kind, params, status: 'done', reasoning };
      },
      maxStages: 12,
    });

    const outcome = await navigator.navigate('Sofa');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/not in the scene memory/);
    // It spent exactly one look looking for it, then stopped — no blind walking.
    expect(world.ran).toEqual([{ kind: 'look', params: {} }]);
  });
});

describe('Navigator — walking into the target', () => {
  function navigateBlocked(opts: {
    distanceM: number;
    blockedAfterWalks: number;
    worldBearingDeg?: number;
    blockedMode?: 'stall' | 'short';
    /** Default: no distance at all, which is what the real VLM reports. */
    distanceUnknown?: boolean;
  }) {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, {
      worldBearingDeg: opts.worldBearingDeg ?? 0,
      distanceM: opts.distanceM,
      blockedAfterWalks: opts.blockedAfterWalks,
      blockedMode: opts.blockedMode,
      distanceUnknown: opts.distanceUnknown ?? true,
    });
    world.look();
    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });
    return { navigator, world };
  }

  it('stops on the first badly short walk, before the base grinds into the target', async () => {
    // The walk still "succeeds" — it just moves 0.04 m of a commanded 1.0 m.
    // Pushing on from here is what leaves the robot inside the table with every
    // later turn coming up short.
    const { navigator, world } = navigateBlocked({
      distanceM: 2.0,
      blockedAfterWalks: 1,
      blockedMode: 'short',
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/moved only 0.04 m of 1.00 m/);
    expect(world.ran.filter((b) => b.kind === 'walk')).toHaveLength(2);
  });

  it('counts a stalled walk against a near target as arrival, not as a failure', async () => {
    const { navigator } = navigateBlocked({ distanceM: 2.0, blockedAfterWalks: 1 });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/moved only 0.00 m of 1.00 m/);
    expect(outcome.message).toMatch(/"table" is straight ahead/);
  });

  it('fails when the FIRST walk stalls — that is a dead loco service, not a table', async () => {
    const { navigator, world } = navigateBlocked({ distanceM: 2.0, blockedAfterWalks: 0 });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/walk failed/);
    expect(outcome.message).toMatch(/did not move/);
    // It stopped on the first stalled walk instead of grinding out 12 stages.
    expect(world.ran.filter((b) => b.kind === 'walk')).toHaveLength(1);
  });

  it('takes the blind 1 m stage and arrives by contact when nothing is measured', async () => {
    // The pre-LiDAR path, kept because the real robot can have its target
    // outside the sensor's vertical fan: no clearance, no measured distance,
    // fixed stages, and arrival comes from the walk falling badly short.
    const { navigator, world } = navigateBlocked({
      distanceM: 2.0,
      blockedAfterWalks: 1,
      blockedMode: 'short',
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/moved only 0.04 m of 1.00 m/);
    // Every stage is the blind full stage — nothing measured anything.
    const walks = world.ran.filter((b) => b.kind === 'walk');
    for (const walk of walks) expect(Number(walk.params.distanceM)).toBeCloseTo(1.0, 6);
  });

  it('fails when the robot stalls while the target is still far — something else is in the way', async () => {
    // Blocked at ~4 m out, which is a chair in the path, not the table. Needs a
    // distance to know that — with none, "blocked and dead ahead" is all there is.
    const { navigator } = navigateBlocked({
      distanceM: 5.0,
      blockedAfterWalks: 1,
      distanceUnknown: false,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/walk failed/);
  });
});

describe('Navigator — measured range', () => {
  function navigatorFor(opts: Parameters<typeof makeWorld>[1], maxStages = 12) {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, opts);
    world.look();
    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages,
    });
    return { navigator, world, scene };
  }

  it('arrives on a lidar-measured distance', async () => {
    const { navigator } = navigatorFor({ worldBearingDeg: 0, distanceM: 1.0 }, 3);

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Arrived at "table"/);
    // And it says the number was measured, not guessed.
    expect(outcome.message).toMatch(/lidar/);
  });

  it('does NOT arrive on the same distance when it is only a vision estimate', async () => {
    // The whole point: qwen2.5vl:7b is 0.94 m MAE on distance. Acting on it at a
    // 0.6 m arrival threshold declares arrival while standing in open floor.
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 0, distanceM: 1.0, distanceSource: 'vlm-estimate' },
      3
    );

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).not.toMatch(/Arrived/);
    expect(outcome.message).toMatch(/gave up after 3 stages/);
    // It also keeps the blind fixed stage rather than sizing one off a guess.
    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks.length).toBeGreaterThan(0);
    for (const walk of walks) expect(Number(walk.params.distanceM)).toBeCloseTo(1.0, 6);
  });

  it('sizes the stage from the measured distance instead of the blind 1 m', async () => {
    // 1.0 m measured − 0.6 m arrival = 0.4 m left to walk. The blind path would
    // command a full metre and push straight past the target.
    const { navigator, world } = navigatorFor({ worldBearingDeg: 0, distanceM: 1.0 }, 3);

    await navigator.navigate('table');

    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(Number(walks[0].params.distanceM)).toBeCloseTo(0.4, 6);
  });

  it('clamps the stage to the measured clearance ahead', async () => {
    // Target 5 m away, but the lidar measures a surface 1.2 m ahead — something
    // is in the path. 1.2 − 0.45 stopping margin = 0.75 m is all that may be
    // commanded, instead of the full 1 m stage.
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 0, distanceM: 5.0, clearanceM: 1.2 },
      1
    );

    await navigator.navigate('table');

    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks).toHaveLength(1);
    expect(Number(walks[0].params.distanceM)).toBeCloseTo(0.75, 6);
  });

  it('does NOT clamp with a clearance measured before the stage turned away from it', async () => {
    // The stage order is look → turn → walk, so the clearance in the store was
    // measured down the PREVIOUS heading. Here the target is 75° off: the 0.7 m
    // surface the last look found is behind the robot's left shoulder now, and
    // clamping on it would either veto an open path or — with the numbers
    // reversed — wave the robot into what is actually ahead. It must expire.
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 75, distanceM: 5.0, clearanceM: 0.7 },
      1
    );

    const outcome = await navigator.navigate('table');

    // Compare with 'stops without walking when the way ahead is inside the
    // stopping margin' (same 0.7 m, no turn): there it refuses to step at all.
    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks).toHaveLength(1);
    expect(Number(walks[0].params.distanceM)).toBeCloseTo(1.0, 6);
    expect(outcome.message).not.toMatch(/stopping margin/);
  });

  it('leaves the stage alone when the clearance is further than the stage', async () => {
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 0, distanceM: 5.0, clearanceM: 6.0 },
      1
    );

    await navigator.navigate('table');

    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(Number(walks[0].params.distanceM)).toBeCloseTo(1.0, 6);
  });

  it('stops without walking when the way ahead is inside the stopping margin', async () => {
    // 0.7 m of clearance leaves 0.25 m after the margin — less than the shortest
    // useful stage. The target is measured at 0.8 m, i.e. it IS what is ahead,
    // so this counts as arrival; the alternative is grinding into it.
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 0, distanceM: 0.8, clearanceM: 0.7 },
      12
    );

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/stopping margin/);
    expect(outcome.message).toMatch(/0.70 m/);
    // Nothing was commanded — it never took the step.
    expect(world.ran.filter((b) => b.kind === 'walk')).toHaveLength(0);
  });

  it('refuses to call a blocking surface the target when the target is measured far off', async () => {
    // Blocked 0.7 m ahead while the table is measured 3 m away: that is a chair
    // in the path, and "arrived at the table" would be a lie.
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 0, distanceM: 3.0, clearanceM: 0.7 },
      12
    );

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/Something is in the way/);
    expect(world.ran.filter((b) => b.kind === 'walk')).toHaveLength(0);
  });

  it('walks up to a target that is itself the nearest surface ahead', async () => {
    // The ordinary good case end to end: the table is what the corridor
    // measurement sees, so every stage is clamped by its own distance and the
    // robot converges instead of stopping short.
    const { navigator, world } = navigatorFor(
      { worldBearingDeg: 20, distanceM: 3.0, clearanceFromTarget: true },
      12
    );

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Arrived at "table"|stopping margin/);
    const walks = world.ran.filter((b) => b.kind === 'walk');
    for (const walk of walks) expect(Number(walk.params.distanceM)).toBeLessThanOrEqual(1);
  });

  it('does not read a clearance measured before the robot walked away from it', async () => {
    // The 07 recording's false arrival. Standing at the table (0.67 m of
    // clearance), the robot is walked 2 m backwards and then told "geh zum
    // Tisch". It reported "Stopped at table after 1 stage and 0.00 m … 0.67 m
    // straight ahead" while the lidar in that same frame measured 1.98 m,
    // because 0.67 − 0.45 < 0.30 took the stopping-margin branch.
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, {
      worldBearingDeg: 0,
      distanceM: 0.67,
      clearanceFromTarget: true,
    });
    world.look();

    world.state.distance += 2.0; // the robot retreats; the world does not care
    scene.noteTranslationM(2.0); // ← the only thing scene memory is told

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    // It measures again before committing to anything.
    expect(world.ran[0].kind).toBe('look');
    // And then it actually goes there, rather than declaring victory in place.
    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toMatch(/after 1 stage and 0\.00 m/);
    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks.length).toBeGreaterThan(1);
    // No stage was sized by the pre-retreat 0.67 m (0.67 − 0.45 = 0.22 m).
    for (const walk of walks) expect(Number(walk.params.distanceM)).toBeGreaterThanOrEqual(0.3);
    // It closed the 2.67 m for real, and stopped where the table is — 0.67 m,
    // the stopping margin, which is where the recording's run also ended.
    expect(world.state.distance).toBeCloseTo(0.67, 2);
    expect(outcome.message).toMatch(/stopping margin|Arrived/);
  });

  it('does not arrive on a lidar distance measured two metres ago either', async () => {
    // The same staleness one field over: the target's own range. 0.5 m is inside
    // the arrival threshold, so before the loop turns or walks anything, the
    // first `if` in navigate() would have returned "Arrived after 0 stages".
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 0.5 });
    world.look();

    world.state.distance = 2.5;
    scene.noteTranslationM(2.0);

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.message).not.toMatch(/after 0 stages/);
    expect(world.ran[0].kind).toBe('look');
    expect(world.ran.filter((b) => b.kind === 'walk').length).toBeGreaterThan(0);
    expect(outcome.ok).toBe(true);
  });

  it('spends no look when nothing has moved since the last one', async () => {
    // The pre-flight look is not a free tax on every goto: a target seen from
    // where the robot still stands is walked to straight away.
    const { navigator, world } = navigatorFor({ worldBearingDeg: 0, distanceM: 5.0 }, 1);

    await navigator.navigate('table');

    expect(world.ran[0].kind).toBe('walk');
  });

  it('looks once, not twice, when the target is unknown and the robot has moved', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    const world = makeWorld(scene, { worldBearingDeg: 0, distanceM: 3.0 });
    scene.noteTranslationM(2.0); // moved, and nothing was ever observed

    const navigator = new Navigator({
      scene,
      isAborted: () => false,
      runGeneratedBlock: world.runGeneratedBlock,
      maxStages: 12,
    });
    await navigator.navigate('table');

    const beforeFirstWalk = world.ran.slice(
      0,
      world.ran.findIndex((b) => b.kind === 'walk')
    );
    expect(beforeFirstWalk.filter((b) => b.kind === 'look')).toHaveLength(1);
  });

  it('ignores an unknown clearance instead of reading it as clear or as blocked', async () => {
    // `null` clearance is UNKNOWN: the sensor's vertical fan does not cover
    // everything ahead. It must change nothing — same stages as before LiDAR.
    const { navigator, world } = navigatorFor({ worldBearingDeg: 0, distanceM: 5.0 }, 1);

    await navigator.navigate('table');

    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(Number(walks[0].params.distanceM)).toBeCloseTo(1.0, 6);
  });
  // A dropped range frame is not the same thing as a robot with no lidar, and
  // reading `null` as "near enough to count contact as arrival" conflated them.
  // With the sensor alive, `null` means UNKNOWN — the same rule the rest of this
  // feature follows.
  it('does not turn one unranged look into an arrival metres from the target', async () => {
    const { navigator, world } = navigatorFor({
      worldBearingDeg: 0,
      distanceM: 5.2,
      unrangedLookIndex: 3,
      blockedAfterWalks: 2,
      blockedMode: 'short',
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).not.toMatch(/Counting that as arrived/);
    // It really did stop far away — this is not passing by never walking.
    expect(world.state.distance).toBeGreaterThan(2);
  });

  // Same shape, opposite verdict: a robot whose lidar never spoke for this
  // target has nothing BUT contact to go on, so contact still means arrival.
  it('still arrives by contact when the lidar never measured the target at all', async () => {
    const { navigator } = navigatorFor({
      worldBearingDeg: 0,
      distanceM: 1.2,
      distanceUnknown: true,
      blockedAfterWalks: 1,
      blockedMode: 'short',
    });

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Counting that as arrived/);
    expect(outcome.message).toMatch(/its distance was never measured/);
  });

  // MIN_STAGE_M is the shortest stage worth taking, not a floor on the approach
  // that is LEFT. Flooring `remaining` commanded up to 0.29 m more than the
  // lidar said was available, and clamp 2a could not catch it because the
  // re-bearing turn above expires the clearance past 10 degrees — so the same
  // physical situation was decided by whether the correction was 9 or 15.
  it('does not walk further than the measurement allows on the final approach', async () => {
    const { navigator, world } = navigatorFor({ worldBearingDeg: 15, distanceM: 0.7 }, 4);

    const outcome = await navigator.navigate('table');

    expect(outcome.ok).toBe(true);
    const walks = world.ran.filter((b) => b.kind === 'walk');
    expect(walks).toHaveLength(1);
    expect(Number(walks[0].params.distanceM)).toBeCloseTo(0.1, 6);
  });
});

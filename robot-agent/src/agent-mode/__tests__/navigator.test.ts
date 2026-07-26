/**
 * @file navigator.test.ts
 * @description The `goto` bearing-and-correct loop against a simulated world:
 *              it converges on a target that gets closer, and it gives up after
 *              AGENT_MAX_NAV_STAGES when the target never does.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { Navigator } from '../navigator.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { normalizeDeg, type AgentBlock, type AgentBlockKind } from '../types.js';
import type { VisionObservation } from '../vision.js';

interface WorldOptions {
  /** True world bearing of the target, degrees. */
  worldBearingDeg: number;
  distanceM: number;
  /** Fraction of a commanded walk that actually closes the gap. 0 = no progress. */
  progressFactor?: number;
  /** Simulate the VLM never estimating a distance. */
  distanceUnknown?: boolean;
  /**
   * Number of looks after which the target drops out of frame — every later
   * look reports the room but not the target, exactly as the real VLM does once
   * the robot has turned away from it.
   */
  visibleForLooks?: number;
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

  const look = (): void => {
    // Once the target leaves the frame the look still succeeds — it just says
    // nothing about the target, which is what leaves the stored bearing stale.
    const visible = opts.visibleForLooks === undefined || looks < opts.visibleForLooks;
    looks++;
    const observation: VisionObservation = {
      currentView: visible ? 'I can see the table' : 'a shelf and a wall',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: visible
        ? [
            {
              label: 'table',
              bearingDeg: normalizeDeg(state.worldBearing - scene.getYawDeg()),
              distanceEstM: opts.distanceUnknown ? null : state.distance,
              confidence: 0.9,
            },
          ]
        : [{ label: 'shelf', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }],
    };
    scene.merge(observation);
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

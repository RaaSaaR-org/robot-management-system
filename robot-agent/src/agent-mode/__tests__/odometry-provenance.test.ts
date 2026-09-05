/**
 * @file odometry-provenance.test.ts
 * @description TASK-231: the odometry provenance marker reaches Agent Mode and
 *              changes what a block CLAIMS. A distance differenced from a
 *              DEAD-RECKONED pose is the velocity the bridge itself commanded,
 *              integrated and handed back — on 2026-08-30 it reported 7.995 m
 *              of a commanded 8.00 m while the true root pose had moved
 *              0.113 m. The block must not report such a number as a
 *              measurement. What the robot DOES is unchanged: the same commands
 *              go out, `measured.distanceM` carries the same value, and only
 *              the sentence that names it is honest about where it came from.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { BlockExecutor, type BlockExecutorDeps } from '../block-executor.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { DEG_TO_RAD, type AgentBlock } from '../types.js';
import type { VisionClient } from '../vision.js';
import type { LocoOdometryProvenance } from '../../hardware/HardwareClient.js';

function block(kind: AgentBlock['kind'], params: Record<string, unknown> = {}): AgentBlock {
  return { id: `b-${kind}`, kind, params, status: 'pending' };
}

interface MoveCall {
  vx: number;
  vy: number;
  omega: number;
  durationS: number;
}

/**
 * A base whose pose is integrated from the commands it is given, published with
 * whatever provenance the test asks for.
 *
 * Integrating the command is EXACTLY what a dead-reckoned publisher does, which
 * is why the same integrator serves both cases: the numbers on the wire are
 * identical and only the marker differs. That is the whole point — nothing
 * downstream could tell the two apart before this, and `speedGain` is how a
 * test says what the base really did underneath them.
 */
function makeBase(
  opts: {
    /** What the publisher stamps on every frame; omitted = an unmarked frame. */
    provenance?: LocoOdometryProvenance;
    /** Fraction of the commanded translation the base actually covers. */
    speedGain?: number;
    /** Fraction of the commanded rotation the base actually turns. */
    turnGain?: number;
    /** Unbidden yaw while translating, °/s. */
    driftDps?: number;
  } = {}
) {
  const speedGain = opts.speedGain ?? 1;
  const turnGain = opts.turnGain ?? 1;
  const driftDps = opts.driftDps ?? 0;
  const moves: MoveCall[] = [];
  const pose = { x: 0, y: 0, yawRad: 0 };
  const scene = new SceneMemoryStore('robot-1');

  const deps: BlockExecutorDeps = {
    scene,
    vision: {
      observe: async () => ({
        currentView: 'a factory hall',
        entities: [],
        personVisible: false,
        raw: '{}',
        degraded: false,
      }),
    } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    isAborted: () => false,
    loco: {
      move: async (vx, vy, omega, durationS) => {
        moves.push({ vx, vy, omega, durationS });
        if (omega !== 0) pose.yawRad += omega * durationS * turnGain;
        if (vx !== 0 || vy !== 0) {
          const distanceM = Math.hypot(vx, vy) * speedGain * durationS;
          const heading = pose.yawRad + Math.atan2(vy, vx);
          pose.x += distanceM * Math.cos(heading);
          pose.y += distanceM * Math.sin(heading);
          pose.yawRad += driftDps * durationS * DEG_TO_RAD;
        }
        return { ok: true };
      },
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => ({
        x: pose.x,
        y: pose.y,
        yaw: pose.yawRad,
        // The TRANSPORT, which has never said anything about provenance — the
        // conflation this test exists to keep out of the code.
        source: 'dds',
        ...(opts.provenance ? { provenance: opts.provenance } : {}),
      }),
    },
    sleep: async () => {},
    now: () => 1e12,
  };

  return { executor: new BlockExecutor(deps), moves, scene };
}

describe('walk — a distance is reported with the provenance of the pose behind it', () => {
  it('names a dead-reckoned distance instead of claiming the robot walked it', async () => {
    const h = makeBase({ provenance: 'dead-reckoned' });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    // The reckoned frame reports ~100% of the command, exactly as it did on the
    // rig. The block may still say the number — it must not call it a walk.
    expect(outcome.measured?.distanceM).toBeCloseTo(8, 2);
    expect(outcome.message).toMatch(/Dead reckoned 8\.00 m forward/);
    expect(outcome.message).not.toMatch(/Walked/);
    expect(outcome.message).toMatch(/DEAD RECKONED from the velocity this bridge itself commanded/);
    expect(outcome.message).toMatch(/not of arrival/);
  });

  it('still reports a ground-truth distance as a walk', async () => {
    const h = makeBase({ provenance: 'ground-truth' });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Walked 8\.00 m forward/);
    expect(outcome.message).not.toMatch(/DEAD RECKONED/);
  });

  it('leaves an unmarked frame exactly as it was', async () => {
    // A real G1's own state estimator and every sidecar predating TASK-231 send
    // no marker. Demoting those would put a warning on every walk on real
    // hardware while adding no information, so silence stays silence.
    const h = makeBase();

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.message).toMatch(/Walked 8\.00 m forward/);
    expect(outcome.message).not.toMatch(/DEAD RECKONED/i);
  });

  it('does not call a reckoned zero a measured zero', async () => {
    // The failure message is a claim about evidence too: "0.00 m measured" says
    // the base was watched and did not move, which a reckoned frame cannot say.
    const h = makeBase({ provenance: 'dead-reckoned', speedGain: 0 });

    const outcome = await h.executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/0\.00 m dead reckoned for a commanded 2\.00 m/);
    expect(outcome.message).not.toMatch(/m measured for a commanded/);
  });

  it('carries the marker through a heading correction taken as an arc', async () => {
    // The arc's metres are added to the walk's own total, so its provenance has
    // to travel with them — otherwise a reckoned metre arrives inside a number
    // the walk goes on to call measured.
    const h = makeBase({ provenance: 'dead-reckoned', driftDps: -5 });

    const outcome = await h.executor.execute(block('walk', { distanceM: 4, direction: 'forward' }));

    expect(outcome.message).toMatch(/correction.? arced/);
    expect(outcome.message).toMatch(/DEAD RECKONED/);
  });
});

describe('turn — only the metres are demoted, never the rotation', () => {
  it('says the arced metres are dead reckoned', async () => {
    const h = makeBase({ provenance: 'dead-reckoned' });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.2 }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Arced 0\.80 m forward while turning/);
    expect(outcome.message).toMatch(
      /Those metres are DEAD RECKONED from the commanded velocity, not measured off the base/
    );
    // Yaw is taken off the base's own orientation and is trustworthy on a
    // reckoned frame — TASK-231 is about x/y only. The angle keeps its claim.
    expect(outcome.measured?.angleDeg).toBeCloseTo(90, 6);
    expect(outcome.message).toMatch(/Turned 90° \(left\)/);
  });

  it('says nothing of the sort on a ground-truth arc', async () => {
    const h = makeBase({ provenance: 'ground-truth' });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.2 }));

    expect(outcome.message).toMatch(/Arced 0\.80 m forward while turning/);
    expect(outcome.message).not.toMatch(/DEAD RECKONED/);
  });

  it('does not decorate an in-place turn, which claims no metres at all', async () => {
    const h = makeBase({ provenance: 'dead-reckoned' });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toMatch(/DEAD RECKONED/);
  });
});

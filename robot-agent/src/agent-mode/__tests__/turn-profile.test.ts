/**
 * @file turn-profile.test.ts
 * @description The commanded angular velocity and the achieved turn rate are two
 *              different numbers (TASK-227 follow-up). Pins the deadband floor,
 *              the direction-dependent duration, the arc budget bounding
 *              DISTANCE rather than ANGLE — and, above all, that with no env var
 *              set every one of those reproduces the old coupled arithmetic
 *              exactly.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  BlockExecutor,
  achievedDpsFor,
  turnProfileFor,
  turnToCommand,
  turnToCommandExact,
  type BlockExecutorDeps,
} from '../block-executor.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { DEG_TO_RAD, RAD_TO_DEG, type AgentBlock } from '../types.js';
import { CLEARANCE_MARGIN_M } from '../navigator.js';
import { config } from '../../config/config.js';
import type { VisionClient } from '../vision.js';

/**
 * MEASURED on the live Isaac factory rig, 2026-08-29. In-place (vx = 0):
 * commanded rad/s → achieved deg/s, left (CCW) and right (CW).
 *
 * Two properties this table is here to encode: a DEADBAND below ~0.9 rad/s where
 * an in-place turn produces essentially nothing, and a saturating, roughly 2×
 * asymmetric response above it. The asymmetry is the vendor's trained locomotion
 * policy, not this repository.
 */
const MEASURED_IN_PLACE: Array<[omega: number, left: number, right: number]> = [
  [0.6, 0.11, 0.25],
  [0.79, 0.1, 3.5],
  [0.9, 0.51, 5.45],
  [1.2, 5.09, 14.73],
  [1.6, 7.88, 13.89],
  [2.0, 9.29, 20.35],
];

/** The same sweep at vx = 0.5 m/s. Forward motion partially lifts the deadband. */
const MEASURED_ARC: Array<[omega: number, left: number, right: number]> = [
  [0.785, 4.68, 9.51],
  [1.2, 8.41, 13.78],
];

/** Fraction of a commanded forward distance the rig actually covers. */
const MEASURED_TRAVEL_GAIN = 0.31;

/** Nearest measured row at or below |omega|; the lowest row when below them all. */
function plantDps(omega: number, vx: number): number {
  const table = vx > 1e-6 ? MEASURED_ARC : MEASURED_IN_PLACE;
  let row = table[0]!;
  for (const candidate of table) {
    if (Math.abs(omega) >= candidate[0] - 1e-9) row = candidate;
  }
  return omega >= 0 ? row[1]! : row[2]!;
}

interface MoveCall {
  vx: number;
  vy: number;
  omega: number;
  durationS: number;
}

/** What the world puts in front of an arcing turn; absent → open floor. */
interface ArcObstacles {
  /** What the lidar measures straight ahead, m. */
  clearanceM?: number;
  /** What the map allows before a keepout/occupied cell, m. */
  pathAllowedM?: number;
}

function block(kind: AgentBlock['kind'], params: Record<string, unknown> = {}): AgentBlock {
  return { id: `b-${kind}`, kind, params, status: 'pending' };
}

/**
 * A base that behaves like the measured rig: it rotates at whatever the table
 * above says the COMMANDED omega buys, and it covers `plantTravelGain` of the
 * forward distance it is told to. Nothing is faked at the reporting layer —
 * the pose really goes where these two rules put it.
 *
 * `plantTravelGain` is what the BASE does; `config.agentMode.arcTravelGain` is
 * what the configuration believes about it. They are the same number on the rig
 * that was measured, and the two are deliberately separable here because a rig
 * tuned to walk better than its configured gain is where the arc budget breaks.
 */
function makeMeasuredBase(
  obstacles: ArcObstacles = {},
  plantTravelGain: number = MEASURED_TRAVEL_GAIN
) {
  const moves: MoveCall[] = [];
  const pose = { x: 0, y: 0, yawRad: 0 };
  let pathM = 0;
  const scene = new SceneMemoryStore('robot-1');
  if (obstacles.clearanceM !== undefined) {
    const clearanceM = obstacles.clearanceM;
    scene.getForwardClearanceM = () => clearanceM;
  }
  const deps: BlockExecutorDeps = {
    scene,
    ...(obstacles.pathAllowedM === undefined
      ? {}
      : {
          checkForwardPath: (distanceM: number) => ({
            allowedM: Math.min(distanceM, obstacles.pathAllowedM!),
            knownM: distanceM,
            blocker: { kind: 'keepout' as const, label: 'loading bay' },
            blockerAtM: obstacles.pathAllowedM!,
          }),
        }),
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
      move: async (vx: number, vy: number, omega: number, durationS: number) => {
        moves.push({ vx, vy, omega, durationS });
        if (omega !== 0) pose.yawRad += plantDps(omega, vx) * durationS * DEG_TO_RAD;
        if (vx !== 0 || vy !== 0) {
          const distanceM = Math.hypot(vx, vy) * plantTravelGain * durationS;
          const heading = pose.yawRad + Math.atan2(vy, vx);
          pose.x += distanceM * Math.cos(heading);
          pose.y += distanceM * Math.sin(heading);
          pathM += distanceM;
        }
        return { ok: true };
      },
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => ({ x: pose.x, y: pose.y, yaw: pose.yawRad, source: 'test' }),
    },
    sleep: async () => {},
    now: () => 1e12,
  };
  return {
    executor: new BlockExecutor(deps),
    moves,
    arcMoves: () => moves.filter((m) => m.omega !== 0 && m.vx !== 0),
    /** Forward distance COMMANDED across every command that translates, m. */
    commandedForwardM: () => moves.reduce((sum, m) => sum + Math.abs(m.vx) * m.durationS, 0),
    /** Total rotation the commands ASKED FOR, deg — |omega| × hold, summed. */
    commandedYawDeg: () =>
      moves.reduce((sum, m) => sum + Math.abs(m.omega) * m.durationS * RAD_TO_DEG, 0),
    /** How far the robot ended up from where it started, m. */
    travelledM: () => Math.hypot(pose.x, pose.y),
    /**
     * GROUND covered, m — the path, which is what a distance budget bounds. It
     * equals `travelledM()` only while the whole arc runs on one heading; spent
     * over two commands, the curve between them makes the displacement from the
     * start the shorter of the two.
     */
    pathM: () => pathM,
    yawDeg: () => pose.yawRad * RAD_TO_DEG,
  };
}

/** Everything this suite is allowed to change, restored after every test. */
const TUNABLE = [
  'turnSpeedDps',
  'walkSpeedMps',
  'walkCommandMps',
  'walkAchievedMps',
  'turnCommandRadS',
  'turnAchievedDpsLeft',
  'turnAchievedDpsRight',
  'turnArcCommandRadS',
  'turnArcAchievedDpsLeft',
  'turnArcAchievedDpsRight',
  'arcTravelGain',
] as const;

const SAVED = Object.fromEntries(TUNABLE.map((k) => [k, config.agentMode[k]])) as Record<
  (typeof TUNABLE)[number],
  number
>;

afterEach(() => {
  for (const key of TUNABLE) config.agentMode[key] = SAVED[key];
});

/** The tuning measured for the Isaac factory rig — the values the report names. */
function applyIsaacTuning(): void {
  config.agentMode.walkSpeedMps = 0.5;
  config.agentMode.turnCommandRadS = 2.0;
  config.agentMode.turnAchievedDpsLeft = 9.29;
  config.agentMode.turnAchievedDpsRight = 20.35;
  config.agentMode.turnArcCommandRadS = 1.2;
  config.agentMode.turnArcAchievedDpsLeft = 8.41;
  config.agentMode.turnArcAchievedDpsRight = 13.78;
  config.agentMode.arcTravelGain = MEASURED_TRAVEL_GAIN;
}

/**
 * THE REGRESSION GUARD, and the one that matters most.
 *
 * This code also drives a working warehouse rig and every other embodiment. The
 * Isaac numbers are opt-in through env vars; with none of them set the
 * conversion must be the old coupled arithmetic — `omega = sign × rate × π/180`
 * and `duration = |angle| / rate` — to the last bit.
 */
describe('turn conversion — the untuned default is the OLD arithmetic, exactly', () => {
  const LEGACY_MIN_S = 0.2;
  const LEGACY_MAX_S = 60;

  function legacy(angleDeg: number, rateDps: number, forwardMps = 0) {
    const rate = Math.abs(rateDps) > 1e-6 ? Math.abs(rateDps) : 45;
    const angle = Number.isFinite(angleDeg) ? Math.max(-360, Math.min(360, angleDeg)) : 0;
    return {
      vx: Number.isFinite(forwardMps) && forwardMps > 0 ? forwardMps : 0,
      vy: 0,
      omega: Math.sign(angle) * rate * DEG_TO_RAD,
      durationS: Math.min(LEGACY_MAX_S, Math.max(LEGACY_MIN_S, Math.abs(angle) / rate)),
    };
  }

  const ANGLES = [0, 1, 5, -5, 9, 45, -45, 90, -90, 150, -150, 270, -270, 360, -360, 720, NaN];

  it('reproduces the old (omega, duration) for every angle, in place', () => {
    for (const angle of ANGLES) {
      expect(turnToCommandExact(angle)).toEqual(legacy(angle, config.agentMode.turnSpeedDps));
    }
  });

  it('reproduces the old (omega, duration) for every angle, arcing', () => {
    for (const angle of ANGLES) {
      expect(turnToCommandExact(angle, undefined, 0.4)).toEqual(
        legacy(angle, config.agentMode.turnSpeedDps, 0.4)
      );
    }
  });

  it('reproduces it for a NON-default AGENT_TURN_SPEED_DPS too', () => {
    for (const rate of [10, 45, 90, 120]) {
      config.agentMode.turnSpeedDps = rate;
      for (const angle of ANGLES) {
        expect(turnToCommandExact(angle)).toEqual(legacy(angle, rate));
        expect(turnToCommandExact(angle, undefined, 0.5)).toEqual(legacy(angle, rate, 0.5));
      }
    }
  });

  it('still honours an explicit rate argument as BOTH omega and duration', () => {
    // The exported signature is unchanged and a caller that hands over a rate is
    // asking for the coupled behaviour, so an explicit number bypasses the env
    // tuning entirely — which is what keeps every existing call site pinned.
    applyIsaacTuning();
    expect(turnToCommand(180, 90).durationS).toBe(2);
    expect(turnToCommand(180, 45).durationS).toBe(4);
    expect(turnToCommand(90, 45)).toEqual(legacy(90, 45));
    expect(turnToCommandExact(-270, 45)).toEqual(legacy(-270, 45));
  });

  it('still takes the shorter way round, and still clamps past a full turn', () => {
    expect(turnToCommand(270).omega).toBeLessThan(0);
    expect(turnToCommand(270).durationS).toBeCloseTo(2, 12);
    expect(turnToCommandExact(720).durationS).toBe(360 / 45);
  });

  it('leaves the untuned profile symmetric and coupled', () => {
    const p = turnProfileFor();
    expect(p.commandRadS).toBeCloseTo(45 * DEG_TO_RAD, 12);
    expect(p.achievedDpsLeft).toBe(45);
    expect(p.achievedDpsRight).toBe(45);
  });
});

describe('turn conversion — the commanded omega clears the deadband', () => {
  it('commands the configured rad/s, not the rate the duration came from', () => {
    // The whole point of the split: 45 °/s is 0.785 rad/s, which the rig ignores
    // (+0.10 / −3.5 °/s achieved). The command has to go out at 2.0 rad/s while
    // the hold is still sized from the ~9–20 °/s that comes back.
    applyIsaacTuning();
    expect(turnToCommandExact(90).omega).toBeCloseTo(2.0, 12);
    expect(turnToCommandExact(-90).omega).toBeCloseTo(-2.0, 12);
    // A 5° nudge and a 150° spin are the SAME omega — magnitude is the duration's
    // job. Under the old coupling a slow turn was a below-deadband turn.
    expect(turnToCommandExact(5).omega).toBeCloseTo(2.0, 12);
    expect(turnToCommandExact(150).omega).toBeCloseTo(2.0, 12);
  });

  it('never lets the deadband floor be undercut by asking for a small angle', () => {
    applyIsaacTuning();
    for (const angle of [0.5, 1, 3, 7, 30, 90, 180, 359]) {
      expect(Math.abs(turnToCommandExact(angle).omega)).toBeGreaterThanOrEqual(0.9);
      expect(Math.abs(turnToCommandExact(-angle).omega)).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('uses the ARC profile the moment a command carries forward speed', () => {
    applyIsaacTuning();
    expect(turnToCommandExact(90, undefined, 0.5).omega).toBeCloseTo(1.2, 12);
    expect(turnToCommandExact(90).omega).toBeCloseTo(2.0, 12);
  });

  it('falls the arc back to the in-place tuning when only that is configured', () => {
    config.agentMode.turnCommandRadS = 1.6;
    config.agentMode.turnAchievedDpsLeft = 7.88;
    config.agentMode.turnAchievedDpsRight = 13.89;
    const arc = turnProfileFor(0.5);
    expect(arc.commandRadS).toBeCloseTo(1.6, 12);
    expect(arc.achievedDpsLeft).toBe(7.88);
  });
});

describe('turn conversion — the duration comes from the ACHIEVED rate', () => {
  it('sizes the hold from what comes back, not from what goes out', () => {
    applyIsaacTuning();
    // 2.0 rad/s is 114.6 °/s. If the duration were derived from the command, 90°
    // would be 0.79 s and the robot would rotate 7°. It is derived from the
    // 9.29 °/s the rig actually delivers: 9.69 s.
    expect(turnToCommandExact(90).durationS).toBeCloseTo(90 / 9.29, 10);
    expect(turnToCommandExact(90).durationS).not.toBeCloseTo(90 / (2.0 * (180 / Math.PI)), 3);
  });

  it('gives left and right DIFFERENT durations for the same angle', () => {
    applyIsaacTuning();
    const left = turnToCommandExact(90);
    const right = turnToCommandExact(-90);
    expect(left.durationS).toBeCloseTo(90 / 9.29, 10);
    expect(right.durationS).toBeCloseTo(90 / 20.35, 10);
    // Roughly 2× better to the right — the vendor policy's asymmetry, carried
    // through into the command rather than averaged away.
    expect(left.durationS / right.durationS).toBeCloseTo(20.35 / 9.29, 6);
    // Same magnitude of omega either way: only the sign and the hold differ.
    expect(left.omega).toBeCloseTo(-right.omega, 12);
  });

  it('is asymmetric for an arc too, at the arc rates', () => {
    applyIsaacTuning();
    expect(turnToCommandExact(90, undefined, 0.5).durationS).toBeCloseTo(90 / 8.41, 10);
    expect(turnToCommandExact(-90, undefined, 0.5).durationS).toBeCloseTo(90 / 13.78, 10);
  });

  it('still floors and caps the hold', () => {
    applyIsaacTuning();
    expect(turnToCommandExact(0.01).durationS).toBe(0.2);
    config.agentMode.turnAchievedDpsLeft = 1;
    expect(turnToCommandExact(360).durationS).toBe(60);
  });

  it('reports the achieved rate per direction through achievedDpsFor', () => {
    applyIsaacTuning();
    const p = turnProfileFor();
    expect(achievedDpsFor(p, 30)).toBe(9.29);
    expect(achievedDpsFor(p, -30)).toBe(20.35);
    expect(achievedDpsFor(p, 0)).toBe(9.29); // zero counts as left, as sign() does
  });
});

/**
 * THE ARC BUDGET (defect (e)).
 *
 * The budget existed to bound how far an alignment arc TRAVELS, and instead
 * bounded the commanded ANGLE at `AGENT_TURN_SPEED_DPS / AGENT_WALK_SPEED_MPS` =
 * 90 °/m — so 0.70 m of budget capped the turn at 63° of command whatever was
 * asked for, and the gain-compensation loop that divides the remainder by the
 * measured tracking ratio was clamped straight back to it.
 */
describe('BlockExecutor — an arc budget bounds DISTANCE, not ANGLE', () => {
  const BUDGET_M = 0.7;

  it('untuned, it still spends exactly the commanded metres it used to', async () => {
    const h = makeMeasuredBase();
    config.agentMode.walkSpeedMps = 0.5;

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

    expect(h.arcMoves().length).toBeGreaterThan(0);
    expect(h.commandedForwardM()).toBeLessThanOrEqual(BUDGET_M + 1e-9);
    // 0.70 m ÷ 0.5 m/s is 1.4 s, and 1.4 s at the nominal 45 °/s is the old
    // 63° ceiling on everything this turn was allowed to ask for.
    expect(h.commandedYawDeg()).toBeCloseTo(63, 6);
  });

  it('tuned, it bounds the metres the robot actually covers', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase();

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

    expect(outcome.ok).toBe(true);
    // The caller's budget is REAL ground: `arcM` is carved out of a measured
    // stage and the navigator subtracts the arc's MEASURED displacement from it.
    expect(h.travelledM()).toBeLessThanOrEqual(BUDGET_M + 1e-9);
    expect(outcome.measured?.distanceM ?? 0).toBeLessThanOrEqual(BUDGET_M + 1e-9);
    expect(h.pathM()).toBeCloseTo(BUDGET_M, 6);
  });

  it('tuned, it asks for far more rotation than the old 90°/m ceiling allowed', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase();

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

    // Same 0.70 m of real travel, and the commands ask for several times the
    // 63° the nominal-rate ceiling allowed — because what is bounded is now the
    // HOLD (metres = m/s × s) and the commanded omega is left alone.
    expect(h.commandedYawDeg()).toBeGreaterThan(63);
    for (const move of h.arcMoves()) expect(Math.abs(move.omega)).toBeCloseTo(1.2, 12);
  });

  it('the arc no longer takes its ceiling from AGENT_TURN_SPEED_DPS at all', async () => {
    // This is the sharp form of the defect. The ceiling used to be
    // `budget ÷ walkSpeedMps × turnSpeedDps` — a knob that describes neither the
    // distance being budgeted nor the rotation the base delivers, and one the
    // gain-compensation loop was clamped back to whatever it computed. Nothing
    // in the arc path may read it any more, so moving it must change nothing.
    // The budget bounds GROUND COVERED, so what is compared is `pathM`: an arc
    // that spends its budget over more than one command curves as it does so.
    const runs: Array<{ yawDeg: number; pathM: number; commandedYawDeg: number }> = [];
    for (const nominal of [45, 120]) {
      applyIsaacTuning();
      config.agentMode.turnSpeedDps = nominal;
      const h = makeMeasuredBase();
      // A budget deliberately small enough that the ceiling BINDS — at 45 °/s
      // the old formula allowed 29° of command here and at 120 °/s it allowed
      // 77°, so the two runs used to differ by a factor of nearly three.
      await h.executor.execute(block('turn', { angleDeg: 90, arcM: 0.1 }));
      runs.push({
        yawDeg: h.yawDeg(),
        pathM: h.pathM(),
        commandedYawDeg: h.commandedYawDeg(),
      });
    }

    expect(runs[0]!.yawDeg).toBeCloseTo(runs[1]!.yawDeg, 10);
    expect(runs[0]!.pathM).toBeCloseTo(runs[1]!.pathM, 10);
    expect(runs[0]!.commandedYawDeg).toBeCloseTo(runs[1]!.commandedYawDeg, 10);
    expect(runs[0]!.pathM).toBeCloseTo(0.1, 6);
  });

  it('tuned, the robot actually rotates several times further for the same metres', async () => {
    const untuned = makeMeasuredBase();
    config.agentMode.walkSpeedMps = 0.5;
    await untuned.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

    applyIsaacTuning();
    const tuned = makeMeasuredBase();
    await tuned.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

    expect(untuned.yawDeg()).toBeLessThan(10); // the defect: ~6.5° for a 90° block
    expect(tuned.yawDeg()).toBeGreaterThan(5 * untuned.yawDeg());
    expect(tuned.yawDeg()).toBeGreaterThan(30);
  });

  it('a budget big enough to fund the whole turn lands it, and stops there', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase();

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 4 }));

    expect(outcome.ok).toBe(true);
    expect(h.yawDeg()).toBeGreaterThan(85);
    expect(h.yawDeg()).toBeLessThan(95);
    // It stopped when the heading was right, not when the budget ran out.
    expect(h.travelledM()).toBeLessThan(4);
  });

  it('still refuses an arc it cannot fund one command out of', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase();

    // 0.2 s is the shortest command and 0.5 m/s carries it 0.10 m commanded,
    // which is 0.031 m of real travel at the measured gain.
    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 0.02 }));

    expect(h.arcMoves()).toHaveLength(0);
    expect(outcome.measured?.distanceM).toBeUndefined();
  });

  it('a base that walks BETTER than its configured gain still stops at the budget', async () => {
    // The gain is a PRIOR, and the budget is divided by it: at 0.31 a 0.70 m
    // alignment budget buys 2.26 m of COMMANDED forward motion. Tune the base
    // to beat that prior — this one covers everything it commands — and all
    // 2.26 m becomes real ground. The navigator then subtracts more than the
    // stage it handed out, `Math.max(0, stageM - arcedM)` floors at zero, the
    // walk that follows is nothing, and the robot is already three times past
    // the stage the alignment was for. The arc measures its own ratio instead.
    applyIsaacTuning();
    const h = makeMeasuredBase({}, 1.0);

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

    expect(outcome.ok).toBe(true);
    expect(h.pathM()).toBeLessThanOrEqual(BUDGET_M + 1e-9);
    expect(outcome.measured?.distanceM ?? 0).toBeLessThanOrEqual(BUDGET_M + 1e-9);
    // And it is still an ARC — the fix bounds the travel, it does not quietly
    // fall back to the in-place turn this base cannot make to the left.
    expect(h.arcMoves().length).toBeGreaterThan(0);
    expect(h.yawDeg()).toBeGreaterThan(0);
  });

  it('spends the budget it was promised, whatever ratio the base turns out to have', async () => {
    // The other half: measuring the ratio may not COST the arc metres either.
    // Whether the base beats its configured gain or matches it, the alignment
    // gets the full 0.70 m of real ground the navigator carved out for it.
    for (const plantGain of [MEASURED_TRAVEL_GAIN, 0.6, 1.0]) {
      applyIsaacTuning();
      const h = makeMeasuredBase({}, plantGain);

      await h.executor.execute(block('turn', { angleDeg: 90, arcM: BUDGET_M }));

      expect(h.pathM()).toBeCloseTo(BUDGET_M, 6);
    }
  });

  it('a budget too small to MEASURE overruns by one probe, not by the prior', async () => {
    // The corner the bound does not close, stated instead of hidden. 0.10 m of
    // real ground does not fund a command whose rotation clears the odometry's
    // noise floor, and a probe that cannot be measured re-derives nothing — so
    // that one command is sized by the prior after all. It is ONE command: the
    // arc measures itself and stops, where the defect let the prior spend the
    // whole 1/0.31 of the budget on a base that covers everything it commands.
    applyIsaacTuning();
    const h = makeMeasuredBase({}, 1.0);

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 0.1 }));

    expect(outcome.ok).toBe(true);
    expect(h.arcMoves()).toHaveLength(1);
    expect(h.pathM()).toBeLessThan(0.1 / MEASURED_TRAVEL_GAIN);
  });

  it('never converts a WALK loop budget, which is already in commanded metres', async () => {
    // The walk's segments are commanded metres, so its arcs must spend commanded
    // metres too or "walk 3 m" stops being 3 m of command. Only the navigator's
    // `arcM` is real ground; `AGENT_ARC_TRAVEL_GAIN` must not leak across.
    applyIsaacTuning();
    const h = makeMeasuredBase();

    await h.executor.execute(block('walk', { distanceM: 3, direction: 'forward' }));

    expect(h.commandedForwardM()).toBeLessThanOrEqual(3 + 1e-9);
  });
});

/**
 * An arc is forward motion, so it answers to the obstacles a walk answers to.
 *
 * `walk` has clamped to the lidar's forward clearance and run the segment past
 * the keepouts since TASK-208; the arcing turn did neither, on the reasoning
 * that a turn does not travel. `arcM` ended that. The navigator hands out up to
 * a full stage of it and only clamps AFTER the turn, so an unchecked arc drove
 * along the OLD heading through whatever was there.
 */
describe('BlockExecutor — an arc answers to the same obstacles a walk does', () => {
  const CLEAR_BUDGET_M = 0.7;

  it('spends its whole budget when the floor ahead is open', async () => {
    // The control for everything below: no clearance, no map, nothing changes.
    applyIsaacTuning();
    const h = makeMeasuredBase();

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: CLEAR_BUDGET_M }));

    expect(h.pathM()).toBeCloseTo(CLEAR_BUDGET_M, 6);
  });

  it('clamps the arc to the lidar clearance, minus the stopping margin', async () => {
    applyIsaacTuning();
    // 1.20 m measured − 0.45 m margin = 0.75 m allowed, under the 1.5 m asked.
    const h = makeMeasuredBase({ clearanceM: 1.2 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.5 }));

    expect(outcome.ok).toBe(true);
    expect(h.travelledM()).toBeLessThanOrEqual(1.2 - CLEARANCE_MARGIN_M + 1e-9);
    expect(h.travelledM()).toBeGreaterThan(0);
  });

  it('clamps the arc to the map, so a keepout stops it as it stops a walk', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase({ pathAllowedM: 0.5 });

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.5 }));

    expect(h.travelledM()).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('takes whichever of the two is tighter', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase({ clearanceM: 2.0, pathAllowedM: 0.6 });

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.5 }));

    expect(h.travelledM()).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it('gives the metres up entirely and turns IN PLACE when the room left is under a stage', async () => {
    applyIsaacTuning();
    // 0.50 m measured − 0.45 m margin = 0.05 m, far under MIN_STAGE_M.
    const h = makeMeasuredBase({ clearanceM: 0.5 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.5 }));

    // The TURN still happens — an arc is a heading correction that MAY travel,
    // never one that must — but nothing translates.
    expect(outcome.ok).toBe(true);
    expect(h.travelledM()).toBeCloseTo(0, 9);
    expect(h.arcMoves().length).toBe(0);
    expect(Math.abs(h.yawDeg())).toBeGreaterThan(0);
  });

  it('refuses to arc into a wall the lidar is already inside the margin of', async () => {
    applyIsaacTuning();
    const h = makeMeasuredBase({ clearanceM: 0.2 });

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: 1.5 }));

    expect(h.travelledM()).toBeCloseTo(0, 9);
  });

  it('leaves a small budget alone — the floor is about obstacles, not about size', async () => {
    // 0.10 m is under MIN_STAGE_M, but nothing is in the way, so the caller's
    // deliberate choice stands. Pins the bug the first draft of this had.
    applyIsaacTuning();
    const h = makeMeasuredBase();

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: 0.1 }));

    expect(h.travelledM()).toBeGreaterThan(0);
    expect(h.travelledM()).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});

/**
 * The commanded forward velocity is ONE decision, and both things that drive
 * the base forward have to make it the same way.
 *
 * `walkToCommand` moved to AGENT_WALK_COMMAND_MPS; `arcFor` kept reading
 * AGENT_WALK_SPEED_MPS. Untuned that is invisible — the sentinel resolves back
 * to the same number — so it would have survived every test here and failed on
 * the first rig that used the knob, by putting every arc back under the gait
 * threshold the knob exists to clear.
 */
describe('BlockExecutor — the arc commands what a walk commands', () => {
  it('puts the tuned commanded velocity on the wire, not AGENT_WALK_SPEED_MPS', async () => {
    applyIsaacTuning();
    config.agentMode.walkSpeedMps = 0.4;
    config.agentMode.walkCommandMps = 1.5;
    const h = makeMeasuredBase();

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: 0.7 }));

    const arcs = h.arcMoves();
    expect(arcs.length).toBeGreaterThan(0);
    // 0.4 is the number the defect put here, and it is below the ~0.5 m/s this
    // base needs to take a step at all.
    for (const move of arcs) expect(Math.abs(move.vx)).toBeCloseTo(1.5, 12);
  });

  it('still falls back to the walk speed when the knob is untuned', async () => {
    applyIsaacTuning();
    config.agentMode.walkSpeedMps = 0.5;
    config.agentMode.walkCommandMps = 0;
    const h = makeMeasuredBase();

    await h.executor.execute(block('turn', { angleDeg: 90, arcM: 0.7 }));

    for (const move of h.arcMoves()) expect(Math.abs(move.vx)).toBeCloseTo(0.5, 12);
  });
});

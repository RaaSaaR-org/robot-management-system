/**
 * @file block-executor.test.ts
 * @description distance/angle → (vx, vy, omega, duration_s) conversions for all
 *              four walking directions and both turn senses, plus the sidecar
 *              failure semantics (403 vs. 503), the abort rules, and the range
 *              enrichment every observation passes through.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BlockExecutor,
  G1_FSM_IDS,
  WAVE_GESTURE_MS,
  turnToCommand,
  walkToCommand,
  type BlockExecutorDeps,
} from '../block-executor.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { DEG_TO_RAD, type AgentBlock } from '../types.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { LocoResult } from '../../hardware/HardwareClient.js';
import type { PointCloudFrame } from '../../robot/types.js';

const WALK_SPEED = 0.4;
const TURN_SPEED = 45;

/**
 * A range sensor that is switched off. Every test that is not ABOUT ranging gets
 * one, so the suite never reaches for a sidecar that is not there — and so those
 * tests assert the "no range available" path, which must behave exactly as the
 * executor did before LiDAR existed.
 */
function noRange(): RangeSensor {
  return new RangeSensor({ enabled: false });
}

/** A frame in the real contract: flat XYZ, metres, base_link, floor at z = 0. */
function frameOf(points: Array<[number, number, number]>): PointCloudFrame {
  return {
    robotId: 'test-g1',
    sensor: 'mid360_lidar',
    sensorType: 'lidar',
    frame: 'base_link',
    pointCount: points.length,
    positions: points.flatMap((p) => p),
    intensities: [],
    hasIntensity: false,
    sequence: 1,
    source: 'hardware',
    timestamp: '2026-07-18T12:00:00.000Z',
  };
}

/** `count` returns at `rangeM`, fanned ±1.5° around `bearingDeg`, 1.0 m up. */
function arcAt(rangeM: number, bearingDeg: number, count = 12): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const az = ((bearingDeg + (count === 1 ? 0 : -1.5 + (3 * i) / (count - 1))) * Math.PI) / 180;
    points.push([rangeM * Math.cos(az), rangeM * Math.sin(az), 1.0]);
  }
  return points;
}

function block(kind: AgentBlock['kind'], params: Record<string, unknown> = {}): AgentBlock {
  return { id: `b-${kind}`, kind, params, status: 'pending' };
}

interface MoveCall {
  vx: number;
  vy: number;
  omega: number;
  durationS: number;
}

function makeExecutor(
  overrides: {
    moveResult?: LocoResult;
    actionResult?: LocoResult;
    fsmResult?: LocoResult;
    standHeightResult?: LocoResult;
    odometry?: () => Promise<{ x: number; y: number; yaw: number; source: string } | null>;
    observation?: VisionObservation;
    isAborted?: () => boolean;
    say?: (text: string) => Promise<boolean>;
    range?: RangeSensor;
    sleep?: (ms: number) => Promise<void>;
    checkForwardPath?: BlockExecutorDeps['checkForwardPath'];
  } = {}
) {
  const moves: MoveCall[] = [];
  const actions: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const fsms: number[] = [];
  const standHeights: Array<'high' | 'low'> = [];
  const scene = new SceneMemoryStore('robot-1');
  const observation: VisionObservation = overrides.observation ?? {
    currentView: 'ein leerer Raum',
    entities: [],
    personVisible: false,
    raw: '{}',
    degraded: false,
  };

  const deps: BlockExecutorDeps = {
    scene,
    vision: { observe: async () => observation } as unknown as VisionClient,
    range: overrides.range ?? noRange(),
    isAborted: overrides.isAborted ?? (() => false),
    loco: {
      move: async (vx, vy, omega, durationS) => {
        moves.push({ vx, vy, omega, durationS });
        return overrides.moveResult ?? { ok: true };
      },
      action: async (name, args) => {
        actions.push(args ? { name, args } : { name });
        return overrides.actionResult ?? { ok: true };
      },
      fsm: async (id) => {
        fsms.push(id);
        return overrides.fsmResult ?? { ok: true };
      },
      standHeight: async (preset) => {
        standHeights.push(preset);
        return overrides.standHeightResult ?? { ok: true };
      },
      // Default: no odometry, so the executor must fall back to dead reckoning
      // and SAY the motion is unverified rather than invent a pose. Tests that
      // care about measured motion supply `odometry`.
      odometry: overrides.odometry ?? (async () => null),
    },
    say: overrides.say ?? (async () => true),
    // Time is instantaneous so the duration wait does not slow the suite; the
    // `now` clock is advanced past every command so `driveFor` waits 0 ms.
    sleep: overrides.sleep ?? (async () => {}),
    now: () => 1e12,
  };
  if (overrides.checkForwardPath) deps.checkForwardPath = overrides.checkForwardPath;

  return { executor: new BlockExecutor(deps), moves, actions, fsms, standHeights, scene };
}

describe('walkToCommand — distance → velocity + duration', () => {
  it('drives +x for forward', () => {
    expect(walkToCommand(2, 'forward', WALK_SPEED)).toEqual({
      vx: 0.4,
      vy: 0,
      omega: 0,
      durationS: 5,
    });
  });

  it('drives -x for backward', () => {
    expect(walkToCommand(2, 'backward', WALK_SPEED)).toEqual({
      vx: -0.4,
      vy: 0,
      omega: 0,
      durationS: 5,
    });
  });

  it('drives +y for left (CCW-positive convention)', () => {
    expect(walkToCommand(1, 'left', WALK_SPEED)).toEqual({
      vx: 0,
      vy: 0.4,
      omega: 0,
      durationS: 2.5,
    });
  });

  it('drives -y for right', () => {
    expect(walkToCommand(1, 'right', WALK_SPEED)).toEqual({
      vx: 0,
      vy: -0.4,
      omega: 0,
      durationS: 2.5,
    });
  });

  it('scales the duration with the configured speed, never the velocity', () => {
    const fast = walkToCommand(2, 'forward', 1.0);
    expect(fast.vx).toBe(1.0);
    expect(fast.durationS).toBe(2);
  });

  it('treats a negative distance as a magnitude and floors sub-tick moves', () => {
    expect(walkToCommand(-1, 'forward', WALK_SPEED).vx).toBe(0.4);
    expect(walkToCommand(0.01, 'forward', WALK_SPEED).durationS).toBe(0.2);
  });
});

describe('turnToCommand — angle → omega + duration', () => {
  it('turns left (CCW, positive omega) for a positive angle', () => {
    const cmd = turnToCommand(90, TURN_SPEED);
    expect(cmd.vx).toBe(0);
    expect(cmd.vy).toBe(0);
    expect(cmd.omega).toBeCloseTo(TURN_SPEED * DEG_TO_RAD, 10);
    expect(cmd.durationS).toBe(2);
  });

  it('turns right (CW, negative omega) for a negative angle', () => {
    const cmd = turnToCommand(-90, TURN_SPEED);
    expect(cmd.omega).toBeCloseTo(-TURN_SPEED * DEG_TO_RAD, 10);
    expect(cmd.durationS).toBe(2);
  });

  it('normalizes an over-rotation into (-180, 180]', () => {
    // 270° left is the same heading as 90° right, and takes the shorter path.
    const cmd = turnToCommand(270, TURN_SPEED);
    expect(cmd.omega).toBeLessThan(0);
    expect(cmd.durationS).toBe(2);
  });

  it('scales the duration with the configured turn rate', () => {
    expect(turnToCommand(180, 90).durationS).toBe(2);
    expect(turnToCommand(180, 45).durationS).toBe(4);
  });
});

describe('BlockExecutor — dispatch', () => {
  it('sends exactly the converted walk command to /loco/move', async () => {
    const { executor, moves } = makeExecutor();

    const outcome = await executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    expect(moves).toEqual([{ vx: 0.4, vy: 0, omega: 0, durationS: 5 }]);
  });

  // Found in a live sim run: a 2 m walk moved the robot 1.71 m (the velocity
  // command expired before the executor stopped waiting) while the block
  // cheerfully reported "Walked 2.00 m". The planner then re-planned from a pose
  // the robot was never in. Blocks must report the MEASUREMENT, not the command.
  describe('measured vs. commanded motion', () => {
    function odometryTrack(poses: Array<{ x: number; y: number; yaw: number }>) {
      let i = 0;
      return async () => {
        const p = poses[Math.min(i++, poses.length - 1)];
        return { ...p, source: 'test' };
      };
    }

    it('reports the distance actually travelled, not the one commanded', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 1.71, y: 0, yaw: 0 },
        ]),
      });

      const outcome = await executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

      expect(outcome.ok).toBe(true);
      expect(outcome.measured?.distanceM).toBeCloseTo(1.71, 2);
      expect(outcome.message).toContain('1.71 m');
      expect(outcome.message).not.toContain('2.00 m forward');
      expect(outcome.message).toMatch(/short of the commanded 2\.00 m/);
    });

    it('does not cry shortfall over ordinary tracking error', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 1.97, y: 0, yaw: 0 },
        ]),
      });

      const outcome = await executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

      expect(outcome.message).not.toMatch(/short of/);
    });

    // Found in a live sim run after an E-Stop: the base sits in damp (FSM 1),
    // `SetVelocity` still answers RPC_OK, and the block reported "Walked 0.00 m
    // forward … 100% short of the commanded 2.00 m" as a SUCCESS. The plan then
    // walked through every remaining block with the robot limp on the floor.
    it('fails a walk that measurably did not move', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 0, y: 0, yaw: 0 },
        ]),
      });

      const outcome = await executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

      expect(outcome.ok).toBe(false);
      expect(outcome.measured?.distanceM).toBeCloseTo(0, 3);
      expect(outcome.message).toMatch(/did not move/);
      expect(outcome.message).toMatch(/posture.*stand/);
    });

    it('fails a turn that measurably did not turn', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 0, y: 0, yaw: 0 },
        ]),
      });

      const outcome = await executor.execute(block('turn', { angleDeg: 90 }));

      expect(outcome.ok).toBe(false);
      expect(outcome.measured?.angleDeg).toBeCloseTo(0, 3);
      expect(outcome.message).toMatch(/did not turn/);
      expect(outcome.message).toMatch(/posture.*stand/);
    });

    it('does not call ordinary odometry noise a failure', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 0.3, y: 0, yaw: 0 },
        ]),
      });

      const outcome = await executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

      expect(outcome.ok).toBe(true);
      expect(outcome.message).toMatch(/short of the commanded/);
    });

    it('says the motion is unverified when there is no odometry', async () => {
      const { executor } = makeExecutor();

      const outcome = await executor.execute(block('walk', { distanceM: 2, direction: 'forward' }));

      expect(outcome.ok).toBe(true);
      expect(outcome.measured).toBeUndefined();
      expect(outcome.message).toMatch(/unverified/);
      // It must not claim a travelled distance it cannot know.
      expect(outcome.message).toMatch(/Commanded 2\.00 m/);
    });

    it('reports the angle actually turned', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 0, y: 0, yaw: Math.PI / 2 },
        ]),
      });

      const outcome = await executor.execute(block('turn', { angleDeg: 90 }));

      expect(outcome.measured?.angleDeg).toBeCloseTo(90, 0);
      expect(outcome.message).toMatch(/Turned 90° \(left\)/);
      expect(outcome.message).not.toMatch(/short of/);
    });

    it('flags a turn the robot could not complete', async () => {
      const { executor } = makeExecutor({
        odometry: odometryTrack([
          { x: 0, y: 0, yaw: 0 },
          { x: 0, y: 0, yaw: Math.PI / 6 }, // 30° of a commanded 90°
        ]),
      });

      const outcome = await executor.execute(block('turn', { angleDeg: 90 }));

      expect(outcome.measured?.angleDeg).toBeCloseTo(30, 0);
      expect(outcome.message).toMatch(/short of the commanded 90°/);
    });
  });

  it('advances the dead-reckoned heading on a turn when there is no odometry', async () => {
    const { executor, scene, moves } = makeExecutor();

    await executor.execute(block('turn', { angleDeg: 90 }));

    expect(moves[0].omega).toBeGreaterThan(0);
    expect(scene.getYawDeg()).toBe(90);
    expect(scene.getYawSource()).toBe('dead-reckoning');
  });

  it('maps a posture onto the SetFsmId table', async () => {
    const { executor, fsms } = makeExecutor();

    const outcome = await executor.execute(block('posture', { pose: 'damp' }));

    expect(outcome.ok).toBe(true);
    expect(fsms).toEqual([G1_FSM_IDS.damp]);
  });

  it('only carries FSM ids the sidecar table confirms', () => {
    // Mirrors LOCO_FSM_NAMES in hardware/g1_sidecar.py.
    expect(G1_FSM_IDS).toEqual({ damp: 1, sit: 3, stand: 500 });
  });

  it('routes high/low through SetStandHeight, never through an FSM id', async () => {
    // There is no high-stand/low-stand entry in the FSM table, so sending these
    // as an FSM id would mean guessing one on a 43-DOF humanoid.
    const { executor, fsms, standHeights } = makeExecutor();

    for (const pose of ['high', 'low'] as const) {
      const outcome = await executor.execute(block('posture', { pose }));
      expect(outcome.ok).toBe(true);
    }
    expect(standHeights).toEqual(['high', 'low']);
    expect(fsms).toEqual([]);
  });

  it('reports an unknown posture instead of silently doing nothing', async () => {
    const { executor, fsms, standHeights } = makeExecutor();

    const outcome = await executor.execute(block('posture', { pose: 'crouch' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/unknown pose "crouch"/);
    expect(fsms).toEqual([]);
    expect(standHeights).toEqual([]);
  });

  // The sidecar's /loco/action wave takes exactly one argument, `turn` (bool);
  // it reads `args.get("turn", False)` and silently drops anything else. A
  // `hand` parameter therefore never reached the robot, yet the block reported
  // "Waved with the left hand." into the block card, the A2A stream and the
  // EU-AI-Act compliance record. The wire contract is now `turn`, and the
  // result says which arm actually moved.
  describe('wave — the real sidecar contract', () => {
    it('sends the sidecar its documented `turn` flag, never a hand', async () => {
      const { executor, actions } = makeExecutor();

      await executor.execute(block('wave', { turn: true }));

      expect(actions).toEqual([{ name: 'wave', args: { turn: true } }]);
    });

    it('defaults to no torso turn', async () => {
      const { executor, actions } = makeExecutor();

      const outcome = await executor.execute(block('wave'));

      expect(actions).toEqual([{ name: 'wave', args: { turn: false } }]);
      expect(outcome.message).not.toMatch(/turning the torso/);
    });

    // SetTaskId returns as soon as the request is accepted; the ~4 s animation
    // plays afterwards. The block used to finish in ~2 ms and the next block
    // (a walk, say) started mid-wave.
    it('holds the block open for the length of the gesture', async () => {
      let slept = 0;
      const { executor } = makeExecutor({ sleep: async (ms) => { slept += ms; } });

      const outcome = await executor.execute(block('wave'));

      expect(outcome.ok).toBe(true);
      expect(slept).toBe(WAVE_GESTURE_MS);
    });

    it('greet holds for the gesture too', async () => {
      let slept = 0;
      const { executor } = makeExecutor({ sleep: async (ms) => { slept += ms; } });

      await executor.execute(block('greet', { text: 'hi' }));

      expect(slept).toBe(WAVE_GESTURE_MS);
    });

    it('lets an abort cut the hold short', async () => {
      let slept = 0;
      let aborted = false;
      const { executor } = makeExecutor({
        isAborted: () => aborted,
        sleep: async (ms) => { slept += ms; if (slept >= 300) aborted = true; },
      });

      const outcome = await executor.execute(block('wave'));

      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(/aborted/);
      expect(slept).toBeLessThan(WAVE_GESTURE_MS);
    });

    it('never claims a hand the G1 cannot wave with', async () => {
      const { executor, actions } = makeExecutor();

      // A stale planner answer that still carries `hand` must not resurrect the
      // false claim — the gesture is right-arm only either way.
      const outcome = await executor.execute(block('wave', { hand: 'left' }));

      expect(outcome.ok).toBe(true);
      expect(outcome.message).not.toMatch(/left/i);
      expect(outcome.message).toMatch(/right arm/);
      expect(actions).toEqual([{ name: 'wave', args: { turn: false } }]);
    });

    it('greet waves with the same right-arm gesture and says so', async () => {
      const { executor, actions } = makeExecutor();

      const outcome = await executor.execute(block('greet', { text: 'Hallo' }));

      expect(outcome.ok).toBe(true);
      expect(actions).toEqual([{ name: 'wave', args: { turn: false } }]);
      expect(outcome.message).toMatch(/right-arm wave/);
    });
  });

  it('reports a 403 as a permanent "locomotion disabled" failure', async () => {
    const { executor } = makeExecutor({
      moveResult: { ok: false, locoDisabled: true, error: 'G1_LOCO_ENABLED is off' },
    });

    const outcome = await executor.execute(block('walk', { distanceM: 1, direction: 'forward' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('LOCOMOTION DISABLED');
    expect(outcome.message).toContain('G1_LOCO_ENABLED is off');
  });

  it('reports a 503 verbatim, without the permanent-failure marker', async () => {
    const { executor } = makeExecutor({
      moveResult: { ok: false, error: 'unitree_sdk2py not importable' },
    });

    const outcome = await executor.execute(block('walk', { distanceM: 1, direction: 'forward' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('unitree_sdk2py not importable');
    expect(outcome.message).not.toContain('LOCOMOTION DISABLED');
  });

  it('keeps `speak` a success when the voice service is unreachable (text-only)', async () => {
    const { executor } = makeExecutor({ say: async () => false });

    const outcome = await executor.execute(block('speak', { text: 'Hallo' }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('text-only');
    expect(outcome.message).toContain('Hallo');
  });

  it('never fabricates a result when the camera is down — `look` fails', async () => {
    const scene = new SceneMemoryStore('robot-1');
    const executor = new BlockExecutor({
      scene,
      vision: {
        observe: async () => {
          throw new Error('Sidecar snapshot head_camera failed: HTTP 503');
        },
      } as unknown as VisionClient,
      range: noRange(),
      isAborted: () => false,
      loco: {
        move: async () => ({ ok: true }),
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
    });

    const outcome = await executor.execute(block('look'));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('HTTP 503');
    expect(scene.snapshot()).toBeNull();
  });

  it('lets an abort cut `wait` short but never a motion command', async () => {
    let aborted = false;
    const { executor, moves } = makeExecutor({ isAborted: () => aborted });

    aborted = true;
    const waitOutcome = await executor.execute(block('wait', { seconds: 5 }));
    expect(waitOutcome.ok).toBe(false);
    expect(waitOutcome.message).toMatch(/wait aborted/);

    // The same abort flag must NOT stop a walk that is already in flight.
    const walkOutcome = await executor.execute(block('walk', { distanceM: 1, direction: 'forward' }));
    expect(walkOutcome.ok).toBe(true);
    expect(moves).toHaveLength(1);
  });

  it('runs a scan_room as `steps` looks and returns to the starting heading', async () => {
    const observe = vi.fn(async () => ({
      currentView: 'a table',
      entities: [{ label: 'table', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }],
      personVisible: false,
      raw: '{}',
      degraded: false,
    }));
    const scene = new SceneMemoryStore('robot-1');
    const moves: MoveCall[] = [];
    const executor = new BlockExecutor({
      scene,
      vision: { observe } as unknown as VisionClient,
      range: noRange(),
      isAborted: () => false,
      loco: {
        move: async (vx, vy, omega, durationS) => {
          moves.push({ vx, vy, omega, durationS });
          return { ok: true };
        },
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
      sleep: async () => {},
      now: () => 1e12,
    });

    const outcome = await executor.execute(block('scan_room', { steps: 4 }));

    expect(outcome.ok).toBe(true);
    // 4 observations, but 4 turns: the last one closes the circle without a
    // 5th look, so the robot ends facing exactly where it started. Measured
    // live before this: 90° in, 44.9° out on an 8-step scan.
    expect(observe).toHaveBeenCalledTimes(4);
    expect(moves).toHaveLength(4);
    // Every sweep step turns the same way, 360/4 = 90° each — and that way is
    // CLOCKWISE (negative omega). A 360° sweep covers the same room in either
    // direction, so the direction is free to spend on the one the G1 locomotion
    // checkpoint can actually execute: it achieves 0.01 of a commanded in-place
    // left yaw rate and 0.26-0.53 of a right one (TASK-203), which made every
    // step of a CCW scan a dead turn.
    for (const move of moves) expect(move.omega).toBeLessThan(0);
    // Four clockwise quarter-turns still land exactly back on the start.
    expect(scene.getYawDeg()).toBe(0);
    expect(outcome.message).toContain('table');
  });

  it('still reports the scan when the closing turn fails, and says so', async () => {
    const observe = vi.fn(async () => ({
      currentView: 'a table',
      entities: [{ label: 'table', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }],
      personVisible: false,
      raw: '{}',
      degraded: false,
    }));
    const scene = new SceneMemoryStore('robot-1');
    let call = 0;
    const executor = new BlockExecutor({
      scene,
      vision: { observe } as unknown as VisionClient,
      range: noRange(),
      isAborted: () => false,
      loco: {
        // Fail only the 4th (closing) move; the sweep itself succeeds.
        move: async () => (++call === 4 ? { ok: false, error: 'loco busy' } : { ok: true }),
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
      sleep: async () => {},
      now: () => 1e12,
    });

    const outcome = await executor.execute(block('scan_room', { steps: 4 }));

    // The scan found what it found — that is not invalidated by the turn back.
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('table');
    expect(outcome.message).toMatch(/90° short of it/);
    // And the heading it reports is the one it is actually at: three clockwise
    // quarter-turns from 0° is +90°, one 90° step short of the full circle.
    expect(scene.getYawDeg()).toBe(90);
  });

  /**
   * FOUND LIVE (2026-08-02), driving the real page against a damped G1 in the
   * MuJoCo sim: `scan_room` reported
   *
   *   "Scan room · 8 steps · 360° · 18.4s · Done —
   *    Scanned the room in 8 steps; found: door, bed."
   *
   * while sim odometry showed 0.00° of rotation for the whole block. A `turn`
   * block on the same immobile base correctly failed ("the robot did not turn
   * (0° measured for a commanded 90°)") — because the zero-motion rule lived
   * inside `turn()` and `scan_room` called `driveFor` directly, trusting the
   * sidecar's ACK. The loco service ACKs every velocity command while the base
   * sits in a non-locomoting FSM, which is the entire reason ZERO_MOTION_DEG
   * exists.
   *
   * What makes this worth a test rather than a one-line fix: the operator is
   * not told "a turn failed", they are told the ROOM was scanned. Eight
   * identical frames of one heading become an inventory of a room, and
   * everything behind the robot is reported as absent rather than unobserved.
   */
  it('fails a scan_room whose base measurably never rotated', async () => {
    const observe = vi.fn(async () => ({
      currentView: 'a door and a bed',
      entities: [{ label: 'door', bearingDeg: 0, distanceEstM: 1.5, confidence: 1 }],
      personVisible: false,
      raw: '{}',
      degraded: false,
    }));
    const scene = new SceneMemoryStore('robot-1');
    const executor = new BlockExecutor({
      scene,
      vision: { observe } as unknown as VisionClient,
      range: noRange(),
      isAborted: () => false,
      loco: {
        // The damped base: every command is ACKed, nothing ever moves.
        move: async () => ({ ok: true }),
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => ({ x: 0, y: 0, yaw: 0, source: 'odometry' as const }),
      },
      sleep: async () => {},
      now: () => 1e12,
    });

    const outcome = await executor.execute(block('scan_room', { steps: 8 }));

    expect(outcome.ok).toBe(false);
    // It must not claim a sweep it did not perform...
    expect(outcome.message).not.toMatch(/Scanned the room/);
    // ...and must say which heading was actually observed, and why.
    expect(outcome.message).toMatch(/did not turn/);
    expect(outcome.message).toMatch(/1 of 8 looks/);
    expect(outcome.message).toMatch(/not a 360° scan/);
    expect(outcome.message).toMatch(/posture.*stand/);
    // It fails on the FIRST turn — seven more looks at the same heading would
    // only add confidence to a view it already has.
    expect(observe).toHaveBeenCalledTimes(1);
  });

  /**
   * The mirror of the above: a robot with no odometry cannot measure rotation,
   * and "unmeasured" must never be read as "did not move" — that would ground
   * every scan on a robot for a sensor it does not have. Both tests above this
   * one already run on `odometry: () => null`; this states the rule outright.
   */
  it('still scans a robot that has no odometry to measure the turn with', async () => {
    const observe = vi.fn(async () => ({
      currentView: 'a table',
      entities: [{ label: 'table', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }],
      personVisible: false,
      raw: '{}',
      degraded: false,
    }));
    const executor = new BlockExecutor({
      scene: new SceneMemoryStore('robot-1'),
      vision: { observe } as unknown as VisionClient,
      range: noRange(),
      isAborted: () => false,
      loco: {
        move: async () => ({ ok: true }),
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
      sleep: async () => {},
      now: () => 1e12,
    });

    const outcome = await executor.execute(block('scan_room', { steps: 4 }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('table');
    expect(observe).toHaveBeenCalledTimes(4);
  });
});

/**
 * `observeAndMerge` is the one funnel every perception update goes through, so
 * this is where a VLM guess becomes a measurement — or stays a guess and says
 * so. What must never happen: a distance nobody measured being stored as if it
 * had been, and a missing sensor turning into an error or into "0 m".
 */
describe('BlockExecutor — range enrichment on every observation', () => {
  const SEEN: VisionObservation = {
    currentView: 'a table',
    // 4 m is the vision model's own guess — the kind that is 0.94 m MAE.
    entities: [{ label: 'table', bearingDeg: 20, distanceEstM: 4, confidence: 0.9 }],
    personVisible: false,
    raw: '{}',
    degraded: false,
  };

  it('replaces the guess with the measured range and labels it lidar', async () => {
    // A wall 2.31 m away at the bearing the VLM reported. Note the bearing is
    // the IMAGE-RELATIVE one — the same frame the cloud is in.
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      range: new RangeSensor({ snapshot: async () => frameOf(arcAt(2.31, 20)) }),
    });

    const outcome = await executor.execute(block('look'));

    expect(outcome.ok).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBeCloseTo(2.31, 2);
    expect(scene.get('table')?.distanceSource).toBe('lidar');
  });

  // "Go to the table and tell me what is on it" used to end in
  // speak:"What is on the table?" — the planner cannot know the answer when it
  // plans. `look {speak:true}` answers from the frame instead.
  it('`look` with speak:true says what it saw', async () => {
    const said: string[] = [];
    const { executor } = makeExecutor({
      observation: SEEN,
      say: async (text) => {
        said.push(text);
        return true;
      },
    });

    const outcome = await executor.execute(block('look', { speak: true }));

    expect(outcome.ok).toBe(true);
    expect(said).toEqual([SEEN.currentView]);
    expect(outcome.message).toContain(`said: "${SEEN.currentView}"`);
  });

  it('`look` without speak stays silent', async () => {
    const said: string[] = [];
    const { executor } = makeExecutor({
      observation: SEEN,
      say: async (text) => {
        said.push(text);
        return true;
      },
    });

    await executor.execute(block('look'));

    expect(said).toEqual([]);
  });

  it('keeps the VLM number — marked as an estimate — when ranging is off', async () => {
    const { executor, scene } = makeExecutor({ observation: SEEN });

    await executor.execute(block('look'));

    // Byte-identical to the pre-LiDAR behaviour, except that the number now
    // admits where it came from.
    expect(scene.get('table')?.distanceEstM).toBe(4);
    expect(scene.get('table')?.distanceSource).toBe('vlm-estimate');
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('records the clearance straight ahead alongside the entities', async () => {
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      range: new RangeSensor({
        snapshot: async () => frameOf([...arcAt(2.31, 20), ...arcAt(1.4, 0)]),
      }),
    });

    await executor.execute(block('look'));

    expect(scene.getForwardClearanceM()).toBeCloseTo(1.4, 2);
    expect(scene.snapshot()?.forwardClearanceM).toBeCloseTo(1.4, 2);
  });

  it('expires the clearance and the distances when a walk carries the robot away', async () => {
    // `driveFor` is the funnel every base motion passes through, and it is where
    // both the point-cloud cache and the stored distances are retired. Without
    // this the next `goto` sizes its first stage off a metre measured from a
    // pose the robot has left (the 07 recording's false arrival).
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      range: new RangeSensor({
        snapshot: async () => frameOf([...arcAt(2.31, 20), ...arcAt(1.4, 0)]),
      }),
    });
    await executor.execute(block('look'));
    expect(scene.getForwardClearanceM()).toBeCloseTo(1.4, 2);
    expect(scene.get('table')?.distanceSource).toBe('lidar');

    await executor.execute(block('walk', { distanceM: 1.0, direction: 'forward' }));

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.getForwardClearanceM()).toBeNull();
    expect(scene.get('table')?.distanceEstM).toBeNull();
    expect(scene.get('table')?.distanceSource).toBeNull();
  });

  it('leaves the distances alone when the robot only turns', async () => {
    // Rotation is the yaw rule's business, and a turn small enough to keep the
    // clearance valid must not trip the translation rule instead.
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      range: new RangeSensor({
        snapshot: async () => frameOf([...arcAt(2.31, 20), ...arcAt(1.4, 0)]),
      }),
    });
    await executor.execute(block('look'));

    await executor.execute(block('turn', { angleDeg: 5 }));

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBeCloseTo(1.4, 2);
    expect(scene.get('table')?.distanceSource).toBe('lidar');
  });

  it('never fails the block when the sidecar is not there', async () => {
    // Losing range must degrade Agent Mode to its old behaviour, not break a
    // plan. The camera failing is the loud case; the LiDAR failing is not.
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      range: new RangeSensor({
        snapshot: async () => {
          throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:8767');
        },
      }),
    });

    const outcome = await executor.execute(block('look'));

    expect(outcome.ok).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBe(4);
    expect(scene.get('table')?.distanceSource).toBe('vlm-estimate');
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('treats an empty cloud as unknown, never as a clear way ahead', async () => {
    // A dead publisher and an empty room produce the identical array.
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      range: new RangeSensor({ snapshot: async () => frameOf([]) }),
    });

    await executor.execute(block('look'));

    expect(scene.getForwardClearanceM()).toBeNull();
    expect(scene.get('table')?.distanceSource).toBe('vlm-estimate');
  });

  it('leaves an entity with no distance at all with no distance source', async () => {
    const { executor, scene } = makeExecutor({
      observation: {
        ...SEEN,
        entities: [{ label: 'door', bearingDeg: -70, distanceEstM: null, confidence: 0.5 }],
      },
      // The cloud has nothing at that bearing, so there is nothing to measure.
      range: new RangeSensor({ snapshot: async () => frameOf(arcAt(2.0, 20)) }),
    });

    await executor.execute(block('look'));

    expect(scene.get('door')?.distanceEstM).toBeNull();
    expect(scene.get('door')?.distanceSource).toBeNull();
  });

  it('takes ONE cloud per observation, not one per entity', async () => {
    // One `look` can yield up to 8 entities; ranging each against its own cloud
    // would be slower and less coherent than ranging all against the frame that
    // was current when the picture was taken.
    const snapshot = vi.fn(async () =>
      frameOf([...arcAt(2.0, 20), ...arcAt(3.0, -30), ...arcAt(1.5, 0)])
    );
    const { executor, scene } = makeExecutor({
      observation: {
        ...SEEN,
        entities: [
          { label: 'table', bearingDeg: 20, distanceEstM: 4, confidence: 0.9 },
          { label: 'shelf', bearingDeg: -30, distanceEstM: null, confidence: 0.8 },
          { label: 'box', bearingDeg: 0, distanceEstM: 9, confidence: 0.7 },
        ],
      },
      range: new RangeSensor({ snapshot }),
    });

    await executor.execute(block('look'));

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(scene.get('table')?.distanceEstM).toBeCloseTo(2.0, 2);
    expect(scene.get('shelf')?.distanceEstM).toBeCloseTo(3.0, 2);
    expect(scene.get('box')?.distanceEstM).toBeCloseTo(1.5, 2);
    for (const label of ['table', 'shelf', 'box']) {
      expect(scene.get(label)?.distanceSource).toBe('lidar');
    }
  });
  // The cones must be aimed in base_link, the frame the cloud is in. Nothing
  // pinned that: every other test in this describe runs at yaw 0, the one
  // heading where relative and world coincide, so adding the store yaw to the
  // bearing stayed green across the whole suite while making the robot arrive
  // at a wall 90 degrees away from the table.
  it('aims the range cones in base_link, not in the world frame', async () => {
    const { executor, scene } = makeExecutor({
      observation: SEEN,
      odometry: async () => ({ x: 0, y: 0, yaw: 90 * DEG_TO_RAD, source: 'odometry' }),
      range: new RangeSensor({
        snapshot: async () => frameOf([...arcAt(2.31, 20), ...arcAt(0.55, 110)]),
      }),
    });

    await executor.execute(block('look'));

    expect(scene.get('table')?.distanceEstM).toBeCloseTo(2.31, 2);
    // The world-frame conversion still happens — once, in the store's merge.
    // Asserting it here stops a future failure being "fixed" by deleting it.
    expect(scene.get('table')?.bearingDeg).toBeCloseTo(110, 1);
  });
});

describe('BlockExecutor — a planner-written walk is clamped by the measurement too', () => {
  const SEEN_CLEAR: VisionObservation = {
    currentView: 'a table straight ahead',
    entities: [],
    personVisible: false,
    raw: '{}',
    degraded: false,
  };

  /** Put a measured clearance into scene memory the way a `look` would. */
  function withClearance(clearanceM: number | null) {
    const h = makeExecutor({ observation: SEEN_CLEAR });
    h.scene.merge(
      { ...SEEN_CLEAR, entities: [] },
      undefined,
      { forwardClearanceM: clearanceM }
    );
    return h;
  }

  it('shortens a walk that would drive past the measured clearance', async () => {
    const h = withClearance(1.2);

    const outcome = await h.executor.execute(block('walk', { distanceM: 3.0, direction: 'forward' }));

    // 1.20 - 0.45 margin = 0.75 m allowed, at AGENT_WALK_SPEED_MPS.
    expect(h.moves).toHaveLength(1);
    expect(h.moves[0].durationS).toBeCloseTo(0.75 / WALK_SPEED, 3);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Shortened from the requested 3\.00 m/);
  });

  it('refuses a forward walk when the clearance is already inside the margin', async () => {
    const h = withClearance(0.6);

    const outcome = await h.executor.execute(block('walk', { distanceM: 2.0, direction: 'forward' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/refusing to walk into it/);
    expect(h.moves).toHaveLength(0);
  });

  it('leaves the walk alone when the clearance is unknown — null is never a clamp', async () => {
    const h = withClearance(null);

    await h.executor.execute(block('walk', { distanceM: 3.0, direction: 'forward' }));

    expect(h.moves[0].durationS).toBeCloseTo(3.0 / WALK_SPEED, 3);
  });

  it('does not clamp a backward walk — the clearance only measures ahead', async () => {
    const h = withClearance(0.6);

    const outcome = await h.executor.execute(block('walk', { distanceM: 2.0, direction: 'backward' }));

    expect(outcome.ok).toBe(true);
    expect(h.moves[0].durationS).toBeCloseTo(2.0 / WALK_SPEED, 3);
  });
});

describe('BlockExecutor — turn, then walk: the clearance the turn retired is UNKNOWN AHEAD (TASK-208)', () => {
  const SEEN: VisionObservation = { currentView: 'a room', entities: [], personVisible: false, raw: '{}', degraded: false };

  function afterTurn(checkForwardPath?: BlockExecutorDeps['checkForwardPath']) {
    const h = makeExecutor({ observation: SEEN, ...(checkForwardPath ? { checkForwardPath } : {}) });
    h.scene.merge(SEEN, undefined, { forwardClearanceM: 3.0 });
    // What a `turn` block does to the store: the yaw moves past the 10° tolerance.
    h.scene.advanceYawDeg(45);
    expect(h.scene.getForwardClearanceM()).toBeNull();
    expect(h.scene.wasClearanceExpiredByTurn()).toBe(true);
    return h;
  }

  it('caps a plain walk at the blind stage instead of running it unclamped', async () => {
    const h = afterTurn();
    const outcome = await h.executor.execute(block('walk', { distanceM: 3.0, direction: 'forward' }));
    expect(outcome.ok).toBe(true);
    expect(h.moves[0].durationS).toBeCloseTo(1.0 / WALK_SPEED, 3);
    expect(outcome.message).toMatch(/turned away from/);
  });

  it('lets the map extend the cap to what it KNOWS is free', async () => {
    const h = afterTurn(() => ({ allowedM: 3.0, knownM: 2.2, blocker: null, blockerAtM: null }));
    await h.executor.execute(block('walk', { distanceM: 3.0, direction: 'forward' }));
    expect(h.moves[0].durationS).toBeCloseTo(2.2 / WALK_SPEED, 3);
  });

  it('does not cap a navigator segment planned on the map', async () => {
    const h = afterTurn();
    await h.executor.execute(block('walk', { distanceM: 2.0, direction: 'forward', planned: true }));
    expect(h.moves[0].durationS).toBeCloseTo(2.0 / WALK_SPEED, 3);
  });

  it('a clearance that was never measured still clamps nothing', async () => {
    const h = makeExecutor({ observation: SEEN });
    h.scene.merge(SEEN, undefined, { forwardClearanceM: null });
    h.scene.advanceYawDeg(45);
    expect(h.scene.wasClearanceExpiredByTurn()).toBe(false);
    await h.executor.execute(block('walk', { distanceM: 3.0, direction: 'forward' }));
    expect(h.moves[0].durationS).toBeCloseTo(3.0 / WALK_SPEED, 3);
  });

  it('a fresh look clears the flag', async () => {
    const h = afterTurn();
    h.scene.merge(SEEN, undefined, { forwardClearanceM: null });
    expect(h.scene.wasClearanceExpiredByTurn()).toBe(false);
  });
});

describe('BlockExecutor — the map checks every forward walk (TASK-208)', () => {
  it('stops short of a keepout, and says which and how far', async () => {
    const h = makeExecutor({
      checkForwardPath: (d) => ({ allowedM: 1.2, knownM: 1.2, blocker: { kind: 'keepout', label: 'TABLE' }, blockerAtM: 1.2 }),
    });
    const outcome = await h.executor.execute(block('walk', { distanceM: 3.0, direction: 'forward' }));
    expect(outcome.ok).toBe(true);
    expect(h.moves[0].durationS).toBeCloseTo(1.2 / WALK_SPEED, 3);
    expect(outcome.message).toMatch(/Stopped 1\.80 m short of the requested 3\.00 m — TABLE keepout ahead at 1\.20 m on the map/);
  });

  it('refuses when the blocker is inside the shortest useful stage', async () => {
    const h = makeExecutor({
      checkForwardPath: () => ({ allowedM: 0.1, knownM: 0.1, blocker: { kind: 'robot', label: 'robot Bravo' }, blockerAtM: 0.1 }),
    });
    const outcome = await h.executor.execute(block('walk', { distanceM: 2.0, direction: 'forward' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/robot Bravo is 0\.10 m ahead on the map — refusing/);
    expect(h.moves).toHaveLength(0);
  });

  it('says nothing new when the map has nothing to say (null), and never checks sideways', async () => {
    let calls = 0;
    const h = makeExecutor({
      checkForwardPath: () => {
        calls++;
        return null;
      },
    });
    const fwd = await h.executor.execute(block('walk', { distanceM: 2.0, direction: 'forward' }));
    expect(fwd.ok).toBe(true);
    expect(h.moves[0].durationS).toBeCloseTo(2.0 / WALK_SPEED, 3);
    await h.executor.execute(block('walk', { distanceM: 1.0, direction: 'left' }));
    expect(calls).toBe(1);
  });
});

/**
 * TASK-203. Two measured facts about the G1 locomotion checkpoint drive every
 * test below, and neither is hypothetical:
 *
 *   - Turning IN PLACE, a commanded yaw of −0.3 … −1.0 rad/s (right) achieves a
 *     ratio of 0.26–0.53. `turnToCommand` is open-loop on TIME, so every Agent
 *     Mode turn was landing two to four times short — in both directions.
 *   - The same command with a POSITIVE sign (left) achieves 0.01. A left turn
 *     does not fall short; it does not happen, and the robot does not step.
 *
 * The turn is therefore closed against odometry, and a left turn can be taken
 * the long way round to the right. Both behaviours are conditional on the
 * measurement: a base with symmetric, accurate yaw is driven exactly as before.
 */
describe('BlockExecutor — closed-loop turns (TASK-203)', () => {
  /**
   * A base whose yaw tracking is a fixed FRACTION of what it is commanded, set
   * independently per direction. `gainLeft: 0.01` is the measured G1 dead left
   * turn; `1` is a perfect base.
   *
   * Deliberately integrates `omega * durationS * gain` and nothing else: the
   * point of every assertion here is what comes back out of odometry, so the
   * only way a turn can appear to have happened is if this integrates it.
   */
  function makeTurningBase(opts: {
    gainLeft: number;
    gainRight: number;
    leftTurnStrategy?: 'direct' | 'mirror' | 'auto';
    /**
     * Intercepts one odometry read. `call` is 1-based over EVERY read the
     * executor makes (the fix before the turn, one after each command, and
     * `refreshYaw`'s at the end); returning `undefined` means "answer normally",
     * `null` is the sidecar 503ing, and a pose is a stale or frozen fix. This is
     * what lets the odometry-loss and stale-fix paths be driven exactly, which
     * is where the heading bookkeeping is decided.
     */
    odometry?: (
      call: number,
      yawRad: number
    ) => { x: number; y: number; yaw: number; source: string } | null | undefined;
  }) {
    const moves: MoveCall[] = [];
    const pose = { yawRad: 0 };
    /**
     * Mutable, so a test can change the plant UNDER the executor — a checkpoint
     * whose tracking recovers between two blocks is the case a latched gain gets
     * catastrophically wrong.
     */
    const gains = { left: opts.gainLeft, right: opts.gainRight };
    let odomCalls = 0;
    const scene = new SceneMemoryStore('robot-1');
    const executor = new BlockExecutor({
      scene,
      vision: {
        observe: async () => ({
          currentView: 'a table',
          entities: [{ label: 'table', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }],
          personVisible: false,
          raw: '{}',
          degraded: false,
        }),
      } as unknown as VisionClient,
      range: noRange(),
      isAborted: () => false,
      ...(opts.leftTurnStrategy ? { leftTurnStrategy: opts.leftTurnStrategy } : {}),
      loco: {
        move: async (vx, vy, omega, durationS) => {
          moves.push({ vx, vy, omega, durationS });
          pose.yawRad += omega * durationS * (omega > 0 ? gains.left : gains.right);
          return { ok: true };
        },
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => {
          odomCalls += 1;
          const scripted = opts.odometry?.(odomCalls, pose.yawRad);
          if (scripted !== undefined) return scripted;
          return { x: 0, y: 0, yaw: pose.yawRad, source: 'test' };
        },
      },
      sleep: async () => {},
      now: () => 1e12,
    });
    return { executor, moves, scene, gains, yawDeg: () => (pose.yawRad * 180) / Math.PI };
  }

  it('corrects a turn that tracks at half rate until it lands, instead of stopping short', async () => {
    // 0.53 is the top of the measured right-turn band. One open-loop command
    // gets 47.7° of a commanded 90° — which is exactly what shipped.
    const h = makeTurningBase({ gainLeft: 0.53, gainRight: 0.53 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: -90 }));

    expect(outcome.ok).toBe(true);
    // The first command is the whole of the old behaviour, still issued as-is…
    expect(h.moves[0].durationS).toBe(2);
    expect(h.moves[0].omega).toBeCloseTo(-TURN_SPEED * DEG_TO_RAD, 10);
    // …and would have left the robot 42° short of the commanded 90°.
    expect(h.moves[0].durationS * TURN_SPEED * 0.53).toBeCloseTo(47.7, 1);
    // Four commands land it inside the 5° tolerance instead.
    // Three commands land it inside the 5° tolerance instead.
    expect(h.moves).toHaveLength(3);
    // The second is the gain compensation visible on the wire: 42.3° of heading
    // was left, and it asks for ~55° — MORE than the remainder — because the
    // first command measured this base delivering about half of what it is told.
    // An uncompensated loop asks for 42.3° here, gets 22°, and needs two more.
    expect(h.moves[1].durationS * TURN_SPEED).toBeGreaterThan(42.3);
    expect(h.moves[1].durationS * TURN_SPEED).toBeCloseTo(55.3, 0);
    expect(h.yawDeg()).toBeGreaterThan(-90);
    expect(h.yawDeg()).toBeLessThan(-85);
    expect(outcome.measured?.angleDeg).toBeCloseTo(h.yawDeg(), 6);
    // Every correction goes the same way as the turn — a closed loop that
    // oscillated would show a positive omega here.
    for (const move of h.moves) expect(move.omega).toBeLessThan(0);
    expect(outcome.message).not.toMatch(/short of/);
  });

  it('gives up after the iteration budget rather than turning forever', async () => {
    // 0.03 is below MIN_TURN_GAIN, so compensation is floored and each capped
    // 150° command buys only 4.5° of heading — 20 corrections' worth for a
    // quarter turn, against a cap of 12. Deliberately NOT 0.1: that is the rate
    // `isaac_yaw_sweep.py` measures on the real sim, and gain compensation
    // carries it to -89° in seven commands (the test above this one is the
    // half-rate case; this one is the base that genuinely cannot get there).
    const h = makeTurningBase({ gainLeft: 0.03, gainRight: 0.03 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: -90 }));

    expect(h.moves).toHaveLength(12);
    // It moved — this is the give-up path, not the dead-base path.
    expect(h.yawDeg()).toBeLessThan(-40);
    expect(h.yawDeg()).toBeGreaterThan(-90);
    // And it says so rather than claiming the heading it did not reach.
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/short of the commanded -90°/);
    expect(outcome.measured?.angleDeg).toBeCloseTo(h.yawDeg(), 6);
  });

  it('issues ONE open-loop command, unchanged, when there is no odometry', async () => {
    // The rule this pins: a robot that cannot measure its heading has nothing to
    // close the loop against, and iterating on a dead-reckoned estimate would be
    // guesswork presented as feedback. The old contract survives exactly.
    const { executor, moves } = makeExecutor();

    const outcome = await executor.execute(block('turn', { angleDeg: 90 }));

    expect(moves).toEqual([turnToCommand(90, TURN_SPEED)]);
    expect(outcome.ok).toBe(true);
    expect(outcome.measured).toBeUndefined();
    expect(outcome.message).toMatch(/no odometry/);
  });

  it('mirror: executes a left 90° as a right 270° and ends on the same heading', async () => {
    const h = makeTurningBase({ gainLeft: 0, gainRight: 1, leftTurnStrategy: 'mirror' });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(outcome.ok).toBe(true);
    // 270° of clockwise rotation — not the +90° this base cannot do — issued as
    // 150° + 120°, because no single command may exceed half a turn: two yaw
    // samples cannot tell +190° from −170°, so a command that could rotate more
    // than 180° would produce a rotation nothing can measure.
    expect(h.moves).toHaveLength(2);
    for (const move of h.moves) expect(move.omega).toBeCloseTo(-TURN_SPEED * DEG_TO_RAD, 10);
    expect(h.moves[0].durationS).toBeCloseTo(150 / TURN_SPEED, 6);
    expect(h.moves[1].durationS).toBeCloseTo(120 / TURN_SPEED, 6);
    // The heading is the one that was asked for…
    expect(h.scene.getYawDeg()).toBeCloseTo(90, 6);
    // …and the reported rotation is the one that happened. −270 must NOT be
    // folded into +90: the base turned three quarters of a circle to the right.
    expect(outcome.measured?.angleDeg).toBeCloseTo(-270, 6);
    expect(outcome.message).toMatch(/Turned -270° \(right\)/);
    expect(outcome.message).toMatch(/long way round/);
    expect(outcome.message).not.toMatch(/short of/);
  });

  it('auto: detects a dead left turn, switches to mirror, and remembers it once CONFIRMED', async () => {
    // The measured checkpoint: 0.01 left, 1.0 right.
    const h = makeTurningBase({ gainLeft: 0.01, gainRight: 1, leftTurnStrategy: 'auto' });

    const first = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(first.ok).toBe(true);
    // It TRIED the left turn first — `auto` never assumes the asymmetry.
    expect(h.moves[0].omega).toBeGreaterThan(0);
    expect(h.moves[0].durationS).toBe(2);
    // TWO dead left commands, not one, are what switches the strategy. This test
    // asserted a single probe until the stale-fix hazard was closed: the bridge
    // republishes a frozen yaw for up to a second and the sidecar serves it as
    // current for two more, so ONE dead sample is also exactly what a healthy
    // left-turning base looks like during an odometry hiccup — and it used to
    // latch, process-wide, converting every later left turn into a ~355° spin.
    // The second probe costs ~2 s on a genuinely dead base and is the whole
    // evidence base for a decision that outlives the block. See DEAD_LEFT_PROBES.
    expect(h.moves[1].omega).toBeGreaterThan(0);
    expect(h.moves[1].durationS).toBeCloseTo(89.1 / TURN_SPEED, 3);
    // Only then the mirror. What is LEFT of the turn (88.2°) goes the other way
    // round: −271.8°, split into 150° + 121.8° — no single command may exceed
    // half a turn.
    expect(h.moves).toHaveLength(4);
    expect(h.moves[2].omega).toBeLessThan(0);
    expect(h.moves[2].durationS).toBeCloseTo(150 / TURN_SPEED, 6);
    expect(h.moves[3].omega).toBeLessThan(0);
    expect(h.moves[3].durationS).toBeCloseTo(121.791 / TURN_SPEED, 3);
    // 1.79° left then 271.79° right lands exactly on the requested heading: the
    // mirror is computed from what is LEFT of the turn, not from the request,
    // so the dead probes' 1.79° is not lost.
    expect(h.yawDeg()).toBeCloseTo(-270, 3);
    expect(h.scene.getYawDeg()).toBeCloseTo(90, 3);
    expect(first.measured?.angleDeg).toBeCloseTo(-270, 3);

    // The SECOND turn still probes: one turn's worth of dead commands does not
    // latch a process-wide behaviour change either (DEAD_LEFT_TURNS_TO_LATCH).
    const second = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(second.ok).toBe(true);
    expect(h.moves).toHaveLength(8);
    expect(h.moves[4].omega).toBeGreaterThan(0);
    expect(h.moves[5].omega).toBeGreaterThan(0);
    expect(h.moves[6].omega).toBeLessThan(0);
    expect(h.moves[7].omega).toBeLessThan(0);
    expect(h.yawDeg()).toBeCloseTo(-540, 3);
    expect(h.scene.getYawDeg()).toBeCloseTo(180, 3);
    expect(second.measured?.angleDeg).toBeCloseTo(-270, 3);

    // And NOW the discovery is kept: two turns have each measured two dead left
    // commands, so the third pays nothing — straight to the two clockwise ones.
    const third = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(third.ok).toBe(true);
    expect(h.moves).toHaveLength(10);
    expect(h.moves[8].omega).toBeLessThan(0);
    expect(h.moves[8].durationS).toBeCloseTo(150 / TURN_SPEED, 6);
    expect(h.moves[9].omega).toBeLessThan(0);
    expect(h.moves[9].durationS).toBeCloseTo(120 / TURN_SPEED, 6);
    expect(h.yawDeg()).toBeCloseTo(-810, 3);
    expect(h.scene.getYawDeg()).toBeCloseTo(-90, 3);
    expect(third.measured?.angleDeg).toBeCloseTo(-270, 6);
  });

  it('auto: leaves a base that CAN turn left alone', async () => {
    // The asymmetry is a property of one checkpoint, not of robots. `auto` must
    // be indistinguishable from `direct` on anything that tracks its command.
    const h = makeTurningBase({ gainLeft: 1, gainRight: 1, leftTurnStrategy: 'auto' });

    const first = await h.executor.execute(block('turn', { angleDeg: 90 }));
    const second = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(h.moves).toHaveLength(2);
    for (const move of h.moves) expect(move.omega).toBeGreaterThan(0);
    expect(h.scene.getYawDeg()).toBeCloseTo(180, 6);
    expect(first.measured?.angleDeg).toBeCloseTo(90, 6);
  });

  it('direct: fails a dead left turn honestly instead of re-sending it', async () => {
    const h = makeTurningBase({ gainLeft: 0.01, gainRight: 1, leftTurnStrategy: 'direct' });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/did not turn/);
    // The loop must not keep issuing a command that measurably does nothing.
    expect(h.moves).toHaveLength(1);
  });

  it('sweeps scan_room clockwise, correcting each step', async () => {
    const h = makeTurningBase({ gainLeft: 0.01, gainRight: 0.53, leftTurnStrategy: 'auto' });

    const outcome = await h.executor.execute(block('scan_room', { steps: 4 }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('clockwise');
    // Not one left command anywhere: `scan_room` spends its free choice of
    // direction on the one that works, and is deliberately NOT routed through
    // the mirror strategy — 4 steps of +315° would be nearly four revolutions.
    for (const move of h.moves) expect(move.omega).toBeLessThan(0);
    // Four 90° steps, each needing corrections at 0.53 tracking.
    expect(h.moves.length).toBeGreaterThan(4);
    // And it comes back to where it started, within the per-step tolerance.
    expect(Math.abs(h.scene.getYawDeg())).toBeLessThan(4 * 5);
  });

  /**
   * FOUND BY REVIEW (TASK-203 follow-up), and the worst of the set: the gain
   * estimate is instance state on a process-wide executor, so it survives the
   * block that measured it. Latched at its 0.05 floor by one poorly-tracking
   * turn, it turned EVERY later remainder of 7.5° or more into the full 150°
   * command cap — a 30° request executed as a 150° spin on a plant whose
   * tracking had since recovered, reported ok:true, and unrecoverable because
   * the loop then stopped at the sign flip.
   */
  it('never sizes the FIRST command of a turn from a gain an earlier turn latched', async () => {
    // A checkpoint that tracks at 0.1 — the rate isaac_yaw_sweep.py measures.
    const h = makeTurningBase({ gainLeft: 0.1, gainRight: 0.1 });

    await h.executor.execute(block('turn', { angleDeg: -90 }));
    const learned = h.moves.length;

    // …and now the plant does what it is told: a re-stand, a different surface,
    // the policy warmed up. Nothing tells the executor; only the next command's
    // measurement can, and that is exactly why the first one must not gamble.
    h.gains.left = 1;
    h.gains.right = 1;
    const yawBefore = h.yawDeg();

    const outcome = await h.executor.execute(block('turn', { angleDeg: -30 }));

    // The first command of the new turn asks for the 30° that remain, not for
    // 30 / 0.05 clamped to the 150° cap.
    expect(h.moves[learned].durationS * TURN_SPEED).toBeCloseTo(30, 6);
    expect(h.yawDeg() - yawBefore).toBeCloseTo(-30, 6);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toMatch(/PAST|short of/);
  });

  /**
   * The same hazard through the door this feature was built for. `leftTurnStrategy`
   * exists because left and right tracking differ by up to 50x on this
   * checkpoint, yet the gain was ONE number: a left turn's 0.107 sized the next
   * RIGHT command, which is a 45° block issued as −420°, clamped to −150°, and
   * executed as a 150° rotation. Per-direction estimates make that structural.
   */
  it('never sizes a RIGHT command from what a LEFT turn measured', async () => {
    // 0.107 left, 1.0 right: the asymmetry, with a left turn that still works.
    const h = makeTurningBase({ gainLeft: 0.107, gainRight: 1, leftTurnStrategy: 'direct' });

    await h.executor.execute(block('turn', { angleDeg: 90 }));
    const afterLeft = h.moves.length;
    const yawBefore = h.yawDeg();

    const outcome = await h.executor.execute(block('turn', { angleDeg: -45 }));

    // Not one command of the right turn exceeds the 45° that were asked for.
    for (const move of h.moves.slice(afterLeft)) {
      expect(move.durationS * TURN_SPEED).toBeLessThanOrEqual(45 + 1e-9);
    }
    expect(h.yawDeg() - yawBefore).toBeCloseTo(-45, 6);
    expect(outcome.measured?.angleDeg).toBeCloseTo(-45, 6);
    expect(outcome.message).not.toMatch(/PAST|short of/);
  });

  it('turns BACK from an overshoot instead of leaving the robot pointing past the target', async () => {
    // A base that rotates twice what it is told to the right. The first command
    // is open-loop by design, so this overshoot is not preventable — it has to
    // be correctable, and stopping at the sign flip made it permanent.
    const h = makeTurningBase({ gainLeft: 1, gainRight: 2 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: -30 }));

    expect(h.moves).toHaveLength(2);
    expect(h.moves[0].omega).toBeLessThan(0);
    // The correction goes the OTHER way — the one thing the old loop refused.
    expect(h.moves[1].omega).toBeGreaterThan(0);
    expect(h.moves[1].durationS * TURN_SPEED).toBeCloseTo(30, 6);
    expect(h.yawDeg()).toBeCloseTo(-30, 6);
    expect(outcome.measured?.angleDeg).toBeCloseTo(-30, 6);
    expect(outcome.message).not.toMatch(/PAST|short of/);
  });

  it('reports an overshoot it cannot correct AS an overshoot, not as a shortfall', async () => {
    // 7.5° past a 30° turn: smaller than the shortest command that exists
    // (MIN_DURATION_S x 45°/s = 9°), so correcting it could only bounce, and the
    // loop rightly stops. What it must not do is call it "25% short", which is
    // what the planner was told for a robot that went too FAR.
    const h = makeTurningBase({ gainLeft: 1, gainRight: 1.25 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: -30 }));

    expect(h.moves).toHaveLength(1);
    expect(h.yawDeg()).toBeCloseTo(-37.5, 6);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/7° PAST the commanded -30°/);
    // The word "short" survives only inside "not a shortfall", which is the point.
    expect(outcome.message).not.toMatch(/% short of/);
  });

  it('does not call the shortest command this robot HAS a 50% shortfall', async () => {
    // MIN_DURATION_S floors every command at 0.2 s, i.e. ~9° at 45°/s. A perfect
    // base asked for 6° therefore rotates 9°, and reporting "50% short of the
    // commanded 6°" describes a quantisation floor as a failure to move.
    const h = makeTurningBase({ gainLeft: 1, gainRight: 1 });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 6 }));

    expect(h.moves).toHaveLength(1);
    expect(h.moves[0].durationS).toBe(0.2);
    expect(h.yawDeg()).toBeCloseTo(9, 6);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toMatch(/short|PAST/);
  });

  it('advances the map by the rotation COMMANDED when odometry dies on the first command', async () => {
    // The worst case of the old rule, which advanced the heading by `target` on
    // every path: a mirrored left 90° plans −270°, issues the clamped −150°, and
    // the map moved +90°. 240° of heading error, reported ok:true.
    const h = makeTurningBase({
      gainLeft: 0,
      gainRight: 1,
      leftTurnStrategy: 'mirror',
      // One fix before the turn, then the sidecar 503s for good.
      odometry: (call) => (call === 1 ? undefined : null),
    });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(h.moves).toHaveLength(1);
    expect(h.moves[0].durationS * TURN_SPEED).toBeCloseTo(150, 6);
    // The map follows the robot, not the request.
    expect(h.scene.getYawDeg()).toBeCloseTo(-150, 6);
    expect(h.scene.getYawDeg()).toBeCloseTo(h.yawDeg(), 6);
    expect(outcome.ok).toBe(true);
    // No measurement came back, so none is claimed — this is the dead-reckoning
    // path, not a turn that measurably did not happen.
    expect(outcome.measured).toBeUndefined();
    expect(outcome.message).toMatch(/no odometry/);
  });

  it('advances the map by what it MEASURED plus what it just commanded when odometry dies mid-turn', async () => {
    // Odometry disappears with the third command already executed. Two rotations
    // are measured, the third is estimated at the tracking ratio this turn
    // measured (0.1) — which is the truth here — so the map lands on the robot.
    // The old rule advanced by the full −90° while reporting "Turned -24°",
    // a message that contradicted the heading printed in the same sentence.
    const h = makeTurningBase({
      gainLeft: 1,
      gainRight: 0.1,
      odometry: (call) => (call >= 4 ? null : undefined),
    });

    const outcome = await h.executor.execute(block('turn', { angleDeg: -90 }));

    expect(h.moves).toHaveLength(3);
    expect(h.yawDeg()).toBeCloseTo(-38.727, 3);
    expect(h.scene.getYawDeg()).toBeCloseTo(h.yawDeg(), 6);
    // `measured` stays what odometry actually saw — it feeds the zero-motion
    // rule and the compliance record, and a dead-reckoned estimate is not a
    // measurement however good it is.
    expect(outcome.measured?.angleDeg).toBeCloseTo(-23.727, 3);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Turned -24° \(right\); heading now -39°/);
  });

  it('does not latch the mirror strategy off ONE stale odometry fix', async () => {
    // The hiccup this guards: isaac_loco_bridge.py republishes a frozen yaw for
    // up to 1 s and g1_sidecar.py serves the last fix as current for 2 s more,
    // so one command of a perfectly good left turn measures ~0°. That single
    // sample used to switch this base to the mirror strategy for the life of the
    // process, and every later `turn +3` became a 357° revolution.
    const h = makeTurningBase({
      gainLeft: 1,
      gainRight: 1,
      leftTurnStrategy: 'auto',
      // Read 2 is the frozen one: the robot has turned, the fix has not.
      odometry: (call) => (call === 2 ? { x: 0, y: 0, yaw: 0, source: 'stale' } : undefined),
    });

    const first = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(first.ok).toBe(true);
    // Re-probe (still left), then the fix comes back and shows 180° of rotation,
    // which the reversal rule corrects back to the 90° that was asked for.
    expect(h.moves).toHaveLength(3);
    expect(h.moves[0].omega).toBeGreaterThan(0);
    expect(h.moves[1].omega).toBeGreaterThan(0);
    expect(h.moves[2].omega).toBeLessThan(0);
    expect(h.yawDeg()).toBeCloseTo(90, 6);

    // And nothing was latched: the next left turn is one plain left command.
    const second = await h.executor.execute(block('turn', { angleDeg: 90 }));

    expect(second.ok).toBe(true);
    expect(h.moves).toHaveLength(4);
    expect(h.moves[3].omega).toBeGreaterThan(0);
    expect(h.yawDeg()).toBeCloseTo(180, 6);
    expect(h.scene.getYawDeg()).toBeCloseTo(180, 6);
  });

  it('never takes a SMALL left turn the long way round', async () => {
    // `capture` re-aligns to a checkpoint heading whenever it is more than 5°
    // off, so this is a routine patrol turn. Mirroring it costs 354° of rotation
    // to correct 6°, which drifts the dead-reckoned position further than the
    // error it fixes. The honest "the robot did not turn" is the smaller error.
    const h = makeTurningBase({ gainLeft: 0, gainRight: 1, leftTurnStrategy: 'mirror' });

    const outcome = await h.executor.execute(block('turn', { angleDeg: 6 }));

    expect(h.moves).toHaveLength(1);
    expect(h.moves[0].omega).toBeGreaterThan(0);
    expect(h.moves[0].durationS).toBe(0.2);
    expect(Math.abs(h.yawDeg())).toBeLessThan(1e-9);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/did not turn/);
  });
});

/**
 * TASK-227. The measurement behind every test below, from a live run in the
 * Isaac factory scene: commanding `vx = 0.3` for 25 s produced 2.7 m of travel
 * (~0.11 m/s) while the heading fell from +45° to −18° — about **2°/s of
 * unbidden yaw** in a walk that was asked to go straight.
 *
 * `walk` measured DISTANCE ONLY. It therefore reported that curve as a clean
 * "Walked 2.70 m forward", and a `goto` across the hall never arrived: the
 * robot bowed away from the line and no block outcome said so. The walk is now
 * cut into segments, the heading re-measured at every boundary and steered back
 * with the same closed loop `turn` uses, and the residual stated in the outcome
 * whether it held or not.
 */
describe('BlockExecutor — a walk holds its heading (TASK-227)', () => {
  /**
   * A base that WALKS, with the two defects the factory run measured kept
   * independently settable:
   *
   *   - `driftDps` — unbidden yaw while a TRANSLATION command runs. −2 is the
   *     measured factory number (the heading falls, i.e. the robot curves right).
   *   - `speedGain` — the fraction of the commanded speed actually achieved.
   *
   * Translation is integrated along the pose's CURRENT heading, so a drifting
   * base really does walk somewhere other than where it was aimed; nothing here
   * is faked at the reporting layer.
   */
  function makeWalkingBase(
    opts: {
      driftDps?: number;
      speedGain?: number;
      turnGain?: number;
      odometry?: () => Promise<{ x: number; y: number; yaw: number; source: string } | null>;
      checkForwardPath?: BlockExecutorDeps['checkForwardPath'];
    } = {}
  ) {
    const driftDps = opts.driftDps ?? 0;
    const speedGain = opts.speedGain ?? 1;
    const turnGain = opts.turnGain ?? 1;
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
      range: noRange(),
      isAborted: () => false,
      loco: {
        move: async (vx, vy, omega, durationS) => {
          moves.push({ vx, vy, omega, durationS });
          if (omega !== 0) {
            pose.yawRad += omega * durationS * turnGain;
          } else {
            const distanceM = Math.hypot(vx, vy) * speedGain * durationS;
            // The commanded axis is in the BODY frame, so a strafe goes sideways
            // and a forward walk goes along the heading — including whatever the
            // drift has already done to it.
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
        odometry:
          opts.odometry ??
          (async () => ({ x: pose.x, y: pose.y, yaw: pose.yawRad, source: 'test' })),
      },
      sleep: async () => {},
      now: () => 1e12,
    };
    if (opts.checkForwardPath) deps.checkForwardPath = opts.checkForwardPath;
    return {
      executor: new BlockExecutor(deps),
      moves,
      scene,
      /** Only the translation commands — the walk itself, without corrections. */
      walkMoves: () => moves.filter((m) => m.omega === 0),
      /** Only the rotations — every heading correction this walk spent. */
      turnMoves: () => moves.filter((m) => m.omega !== 0),
      yawDeg: () => (pose.yawRad * 180) / Math.PI,
    };
  }

  it('spends no correction on a base that walks straight', async () => {
    const h = makeWalkingBase();

    const outcome = await h.executor.execute(block('walk', { distanceM: 4, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    // Not one rotation: a base that holds its heading is driven exactly as it
    // was before this loop existed, only in more pieces.
    expect(h.turnMoves()).toHaveLength(0);
    expect(h.yawDeg()).toBeCloseTo(0, 6);
    expect(outcome.message).toMatch(
      /Heading held: 0° of the 0° it set off on \(no correction needed\)/
    );
    expect(outcome.message).not.toMatch(/HEADING OFF/);
  });

  it('segments a long walk without changing how far it goes', async () => {
    const h = makeWalkingBase();

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    // 8 m in 1.5 m segments is six equal 1.333 m pieces, and six of those is
    // 8 m — segmenting changes WHEN the heading is measured, never how far the
    // robot is sent.
    expect(h.walkMoves()).toHaveLength(6);
    const commandedM = h.walkMoves().reduce((sum, m) => sum + m.durationS, 0) * WALK_SPEED;
    expect(commandedM).toBeCloseTo(8, 6);
    for (const move of h.walkMoves()) expect(move.vx).toBeCloseTo(WALK_SPEED, 10);
    expect(outcome.measured?.distanceM).toBeCloseTo(8, 6);
    expect(outcome.message).toMatch(/Walked 8\.00 m forward/);
    expect(outcome.message).toMatch(/over 6 of 6 segments/);
    expect(outcome.message).not.toMatch(/short of/);
  });

  it('holds the heading through the 2°/s drift the factory run measured', async () => {
    const h = makeWalkingBase({ driftDps: -2 });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    // Open-loop this is the defect: 8 m at 0.4 m/s is 20 s of commanded motion,
    // and 20 s × 2°/s is 40° of heading nobody asked for — reported as a clean
    // "Walked 8.00 m forward".
    expect(h.walkMoves().reduce((sum, m) => sum + m.durationS, 0) * 2).toBeCloseTo(40, 6);
    expect(outcome.ok).toBe(true);
    // Closed, the walk ends on the heading it set off on.
    expect(Math.abs(h.yawDeg())).toBeLessThan(8);
    expect(h.turnMoves().length).toBeGreaterThan(0);
    // Every correction goes LEFT — back against a heading that is falling.
    for (const move of h.turnMoves()) expect(move.omega).toBeGreaterThan(0);
    // Six segments, three of them ending far enough out to be worth a
    // correction, and the walk finishes on the heading it started on.
    expect(outcome.message).toMatch(
      /Heading held: 0° of the 0° it set off on \(3 corrections\)/
    );
    // The distance is still the requested one: a correction is a turn in place.
    expect(h.walkMoves().reduce((sum, m) => sum + m.durationS, 0) * WALK_SPEED).toBeCloseTo(8, 6);
  });

  it('says so, loudly, when the drift could not be corrected out', async () => {
    // A base that drifts AND cannot rotate: `turnGain: 0`. The honest answer is
    // a walk that reports where it actually ended up — not a success, and not a
    // block that spends the rest of the plan spinning.
    const h = makeWalkingBase({ driftDps: -2, turnGain: 0 });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    expect(Math.abs(h.yawDeg())).toBeGreaterThan(8);
    // The measured open-loop drift, stated instead of hidden: 40° right.
    expect(outcome.message).toMatch(/HEADING OFF by 40° right of the 0° it set off on/);
    expect(outcome.message).toMatch(/did not go where it was aimed/);
    // And it did not burn the plan's time re-sending a rotation that measurably
    // does nothing: one dead command per boundary, not a loop of them.
    expect(h.turnMoves().length).toBeLessThanOrEqual(6);
  });

  it('degrades to one open-loop command with no odometry, and calls the heading unverified', async () => {
    const { executor, moves } = makeExecutor();

    const outcome = await executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    // No fix to close against: iterating on dead-reckoned yaw would be guesswork
    // presented as feedback, so the walk stays the single command it always was.
    expect(moves).toHaveLength(1);
    expect(moves[0].durationS).toBeCloseTo(8 / WALK_SPEED, 6);
    expect(outcome.ok).toBe(true);
    expect(outcome.measured).toBeUndefined();
    expect(outcome.message).toMatch(/heading held are unverified/);
    expect(outcome.message).not.toMatch(/Heading held:/);
  });

  it('reads odometry that goes away mid-walk as unknown, never as a zero', async () => {
    // The trap this pins: with no measured segment `movedM` stays 0, and the
    // zero-motion rule would fail the block with "the robot did not move" on the
    // strength of a measurement that was never taken.
    let call = 0;
    const h = makeWalkingBase({
      odometry: async () => (call++ === 0 ? { x: 0, y: 0, yaw: 0, source: 'test' } : null),
    });

    const outcome = await h.executor.execute(block('walk', { distanceM: 4, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toMatch(/did not move/);
    expect(outcome.message).toMatch(/unverified/);
    // And it stopped rather than walking the remaining segments blind.
    expect(h.walkMoves()).toHaveLength(1);
    expect(outcome.measured).toBeUndefined();
  });

  it('still refuses a walk into a clearance inside the stopping margin', async () => {
    const h = makeWalkingBase();
    h.scene.merge(
      { currentView: 'a wall', entities: [], personVisible: false, raw: '{}', degraded: false },
      undefined,
      { forwardClearanceM: 0.6 }
    );

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/refusing to walk into it/);
    expect(h.moves).toHaveLength(0);
  });

  it('still refuses a walk into a blocker the map knows about', async () => {
    const h = makeWalkingBase({
      checkForwardPath: () => ({
        allowedM: 0.1,
        knownM: 0.1,
        blocker: { kind: 'robot', label: 'robot Bravo' },
        blockerAtM: 0.1,
      }),
    });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/robot Bravo is 0\.10 m ahead on the map — refusing/);
    expect(h.moves).toHaveLength(0);
  });

  it('re-asks the map at every segment boundary, and stops when it answers differently', async () => {
    // The safety half of segmenting: the map is consulted from the pose the
    // robot is standing at NOW, not once from the pose it set off from. A crate
    // pushed into the aisle after the walk started stops the walk.
    let calls = 0;
    const h = makeWalkingBase({
      checkForwardPath: () => {
        calls++;
        return calls === 1
          ? { allowedM: 8, knownM: 8, blocker: null, blockerAtM: null }
          : {
              allowedM: 0.1,
              knownM: 0.1,
              blocker: { kind: 'keepout', label: 'AISLE' },
              blockerAtM: 0.1,
            };
      },
    });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    expect(h.walkMoves()).toHaveLength(1);
    expect(calls).toBe(2);
    expect(outcome.message).toMatch(
      /Stopped after 1 of 6 segments — AISLE keepout ahead at 0\.10 m on the map/
    );
    expect(outcome.message).toMatch(/short of the commanded 8\.00 m/);
  });

  it('walks up to a blocker a later segment finds, then stops there', async () => {
    let calls = 0;
    const h = makeWalkingBase({
      checkForwardPath: () => {
        calls++;
        return calls === 1
          ? { allowedM: 8, knownM: 8, blocker: null, blockerAtM: null }
          : {
              allowedM: 0.8,
              knownM: 0.8,
              blocker: { kind: 'keepout', label: 'TABLE' },
              blockerAtM: 0.8,
            };
      },
    });

    const outcome = await h.executor.execute(block('walk', { distanceM: 8, direction: 'forward' }));

    expect(outcome.ok).toBe(true);
    expect(h.walkMoves()).toHaveLength(2);
    // The shortened second segment is the 0.80 m the map allowed, not 1.33 m.
    expect(h.walkMoves()[1].durationS).toBeCloseTo(0.8 / WALK_SPEED, 6);
    expect(outcome.message).toMatch(
      /Stopped after 2 of 6 segments — TABLE keepout ahead at 0\.80 m on the map/
    );
  });

  it('never lets segmenting turn the one-minute command cap into a minute per segment', async () => {
    // Open-loop, `walkToCommand` capped a hallucinated distance at
    // MAX_DURATION_S of motion. Segmented, that cap has to bound the WHOLE walk:
    // 667 segments of 60 s would be eleven hours inside one block.
    const h = makeWalkingBase();

    const outcome = await h.executor.execute(
      block('walk', { distanceM: 1000, direction: 'forward' })
    );

    const commandedS = h.walkMoves().reduce((sum, m) => sum + m.durationS, 0);
    expect(commandedS).toBeLessThanOrEqual(60);
    expect(commandedS).toBeGreaterThan(56);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/60 s is the most one walk block may command/);
    expect(outcome.message).toMatch(/short of the commanded 1000\.00 m/);
  });

  it('never checks the map for a sideways walk, and holds the heading anyway', async () => {
    let calls = 0;
    const h = makeWalkingBase({
      driftDps: -2,
      checkForwardPath: () => {
        calls++;
        return null;
      },
    });

    const outcome = await h.executor.execute(block('walk', { distanceM: 4, direction: 'left' }));

    expect(outcome.ok).toBe(true);
    // `forwardClearance` and `checkForwardPath` measure the +x corridor and
    // nothing else, so a left walk asks neither — before or during.
    expect(calls).toBe(0);
    for (const move of h.walkMoves()) expect(move.vy).toBeCloseTo(WALK_SPEED, 10);
    // Heading is not a direction-specific concern: a strafe that spins is just
    // as wrong as a forward walk that curves.
    expect(Math.abs(h.yawDeg())).toBeLessThan(8);
    expect(outcome.message).toMatch(/Heading held/);
  });
});

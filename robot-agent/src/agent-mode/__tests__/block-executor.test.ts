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
    sleep: async () => {},
    now: () => 1e12,
  };

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
    // Every sweep step turns the same way (left), 360/4 = 90° each.
    for (const move of moves) expect(move.omega).toBeGreaterThan(0);
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
    // And the heading it reports is the one it is actually at.
    expect(scene.getYawDeg()).toBe(-90);
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

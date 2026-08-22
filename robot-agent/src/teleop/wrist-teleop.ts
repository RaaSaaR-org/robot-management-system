/**
 * @file wrist-teleop.ts
 * @description Turns the wrist poses a VR client streams into arm joint targets:
 *              solves IK, limits how fast the result may move, and writes it
 *              through the same clamp every other teleop message uses.
 * @feature teleop
 * @status live
 */

import type { RobotStateManager } from '../robot/state.js';
import { G1_ARM_CHAINS, HEAD_SITE_IN_TORSO, type Side } from './g1-chains.generated.js';
import { solveIk, type IkResult } from './ik.js';
import { quatToMat3, type Mat3, type Vec3 } from './kinematics.js';

/**
 * The relaxed standing pose the null space is pulled toward, per side, in chain
 * order (shoulder pitch, roll, yaw, elbow, wrist roll, pitch, yaw).
 *
 * Transcribed from `ARM_REST` in `hardware/sim_g1_dds/joints.py`, which is where
 * the sim's own idle pose comes from — so an arm that runs out of things to do
 * drifts toward the pose the robot is already standing in, not toward the MJCF
 * zero pose, which holds both arms straight out in front.
 */
export const ARM_REST: Readonly<Record<Side, readonly number[]>> = {
  left: [0.25, 0.25, 0, 0.9, 0, 0, 0],
  right: [0.25, -0.25, 0, 0.9, 0, 0, 0],
};

/**
 * Per-joint mobility for the arm chain, in chain order.
 *
 * The two wrist joints at the end are 5 Nm actuators; everything before them is
 * 25 Nm (`actuatorfrcrange` in the MJCF). An unweighted solver gives the
 * smallest motors the largest corrections because they are furthest out on the
 * chain and therefore cheapest in joint angle — which is exactly backwards on
 * hardware.
 */
export const ARM_MOBILITY: readonly number[] = [1, 1, 1, 1, 0.8, 0.5, 0.5];

/**
 * How fast a joint may move under IK, radians per second.
 *
 * This is the answer to "the robot never jumps". The solver is perfectly happy
 * to hand back a pose 2 rad away from the current one — that is what it does on
 * the first frame after the operator's hand appears somewhere new, or after
 * tracking is regained. 3.0 rad/s crosses the arm's whole range in about a
 * second, which is faster than a person moves their arm and slow enough that a
 * discontinuity is a sweep rather than a snap.
 */
const MAX_JOINT_RATE_RAD_S = 3.0;

/**
 * Longest gap that still counts as continuous motion, seconds.
 *
 * Past it the rate limit is applied as if only this much time had passed, so a
 * client that went quiet for ten seconds (tab backgrounded, headset off, socket
 * stalled) does not get ten seconds' worth of allowance in one step.
 */
const MAX_RATE_DT_S = 0.2;

/**
 * A wrist pose as it arrives on the wire.
 *
 * `p` IS RELATIVE TO THE ROBOT'S EYE POINT, not to the torso. That is what the
 * headset can actually measure — the vector from the wearer's head to their
 * hand — and it keeps the one robot-specific constant in the chain table, where
 * it is generated from the MJCF, instead of copied into the frontend where
 * nothing would notice it drifting. The agent adds `HEAD_SITE_IN_TORSO`.
 */
export interface WristPose {
  /** Palm point relative to the eye, metres: +x forward, +y left, +z up. */
  p: Vec3;
  /**
   * Trigger, 0..1, driving the whole hand as one grasp axis. Optional: absent
   * means the fingers are being driven some other way (hand tracking) or not at
   * all, and leaving them alone is the right answer for both.
   */
  grip?: number | null;
  /**
   * Palm orientation in the torso frame, (x, y, z, w).
   *
   * WIRE ORDER IS (x, y, z, w) — the browser's, because that is what WebXR and
   * three.js hand out. Everything below `kinematics.ts` is (w, x, y, z), MJCF's.
   * The single conversion is `wireQuat` and there must never be a second one.
   */
  q?: readonly [number, number, number, number] | null;
}

export interface WristMessage {
  left?: WristPose | null;
  right?: WristPose | null;
}

/** What one solve did, for the socket's reply and for the tests. */
export interface WristSolveReport {
  side: Side;
  /** Position error of the pose actually commanded, metres. */
  error: number;
  /** Solver iterations. */
  iterations: number;
  /** Milliseconds spent in `solveIk`. */
  solveMs: number;
  /** True when a joint limit stopped the solution short. */
  clamped: boolean;
  /** True when the rate limiter is still catching the arm up to the solution. */
  slewing: boolean;
  /**
   * Set when nothing was commanded, and why.
   *
   * There is deliberately no `unreachable` here. A target the arm cannot reach
   * is not a failure — an operator with longer arms than the robot puts their
   * hand out of reach several times a minute, and the right answer is an arm at
   * full stretch pointing the right way, which is what `solveIk` returns. Only
   * arithmetic that cannot be trusted, or an arm whose current pose the robot
   * cannot report, stops a write.
   */
  held?: 'invalid' | 'no-seed';
}

/**
 * (x, y, z, w) off the wire -> (w, x, y, z) for `kinematics.ts`.
 *
 * Straight to a matrix, which is also what makes the quaternion's SIGN a
 * non-issue here: `q` and `-q` are the same rotation and `quatToMat3` maps them
 * to the same matrix. The browser flips the sign whenever the wearer's heading
 * wraps through ±π (`unyaw(2π)` is negative identity), so a client-side or
 * agent-side SLERP over consecutive wrist targets WOULD have to pick the near
 * sign. Nothing here interpolates orientations, and this comment is here so
 * that stays a deliberate choice.
 */
function wireQuat(q: readonly [number, number, number, number]): Mat3 | null {
  if (!q.every((v) => Number.isFinite(v))) return null;
  if (Math.hypot(q[0], q[1], q[2], q[3]) < 1e-6) return null;
  return quatToMat3([q[3], q[0], q[1], q[2]]);
}

function finiteVec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  // A pose this far from the torso is not a hand; it is a unit mistake
  // (millimetres sent as metres) or a tracking glitch, and the solver would
  // happily drive the arm to full extension chasing it.
  if (Math.hypot(x, y, z) > 3) return null;
  return [x, y, z];
}

/**
 * Furthest from the eye a wrist may be before the pose is refused, metres.
 *
 * Not a reach limit — the solver handles an unreachable target by getting as
 * close as it can, which is the right behaviour for an operator with longer
 * arms than the robot. This only rejects poses that cannot be a hand at all.
 */
export const MAX_WRIST_RADIUS_M = 1.2;

/**
 * Parse one side's wrist pose off the wire and move it into the torso frame.
 * Returns null for anything that is not a usable pose, rather than a
 * partly-filled one — a half-parsed pose would drive the arm somewhere real.
 */
export function parseWristPose(value: unknown): { position: Vec3; rotation: Mat3 | null } | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { p?: unknown; q?: unknown };
  const fromEye = finiteVec3(raw.p);
  if (!fromEye) return null;
  if (Math.hypot(fromEye[0], fromEye[1], fromEye[2]) > MAX_WRIST_RADIUS_M) return null;
  const position: Vec3 = [
    fromEye[0] + HEAD_SITE_IN_TORSO[0],
    fromEye[1] + HEAD_SITE_IN_TORSO[1],
    fromEye[2] + HEAD_SITE_IN_TORSO[2],
  ];
  let rotation: Mat3 | null = null;
  if (Array.isArray(raw.q) && raw.q.length === 4
    && raw.q.every((v) => typeof v === 'number')) {
    rotation = wireQuat(raw.q as [number, number, number, number]);
  }
  return { position, rotation };
}

/**
 * Solves both arms and writes the result to the robot, holding the last good
 * pose whenever a solve cannot be trusted.
 *
 * Deliberately NOT a singleton: `keyboard-teleop.ts` builds one per socket, so
 * the warm start and the rate limiter belong to one operator's session and a
 * second console connecting does not inherit a stranger's arm state.
 */
export class WristTeleop {
  private readonly seed: Record<Side, number[] | null> = { left: null, right: null };
  /** What was last COMMANDED, which is what the rate limit moves from. */
  private readonly commanded: Record<Side, number[] | null> = { left: null, right: null };
  /**
   * When each side was last commanded. PER SIDE on purpose: one shared clock
   * gives the second arm solved in a `{wrists}` frame a `dt` of zero, and a
   * zero `dt` used to mean "unlimited". Both hands travel in one message on
   * every frame of two-handed teleop, so that made the limiter inert for the
   * right arm every single frame — measured at 0.85 rad in one 50 ms tick,
   * reported back as `slewing: false`.
   */
  private readonly lastAt: Record<Side, number | null> = { left: null, right: null };

  constructor(
    private readonly robot: RobotStateManager,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Where this side's arm actually is, in chain order — or null if the robot
   * cannot say.
   *
   * THIS IS WHY THE RIG NEEDS NO CALIBRATION. `enableTeleop()` seeds its joint
   * map from the sidecar's MEASURED pose, so the first IK solve of a session
   * starts from where the arm is standing and the operator sees it move away
   * from there rather than snap to it. Seeding from `ARM_REST` instead would
   * reintroduce exactly the startup pose-match `xr_teleoperate` requires and
   * that this rig has never needed.
   */
  private seedFor(side: Side): number[] | null {
    const held = this.commanded[side];
    if (held) return held;
    const positions = this.robot.getTeleopPositions();
    const chain = G1_ARM_CHAINS[side];
    const q: number[] = [];
    for (const link of chain.links) {
      const at = positions[link.joint];
      if (typeof at !== 'number' || !Number.isFinite(at)) return null;
      q.push(at);
    }
    return q;
  }

  /**
   * Solve one side and write it. Returns what happened; the caller decides
   * whether that is worth telling the client about.
   */
  solve(side: Side, target: { position: Vec3; rotation: Mat3 | null }): WristSolveReport {
    const chain = G1_ARM_CHAINS[side];
    const seed = this.seedFor(side);
    if (!seed) {
      return {
        side, error: Number.NaN, iterations: 0, solveMs: 0,
        clamped: false, slewing: false, held: 'no-seed',
      };
    }

    const started = this.now();
    let result: IkResult;
    try {
      result = solveIk(chain, { position: target.position, rotation: target.rotation }, seed, {
        restPose: ARM_REST[side],
        mobility: ARM_MOBILITY,
      });
    } catch {
      // The solver is pure arithmetic and should not throw. If it ever does,
      // the arm holds; it does not fall back to some other retargeting.
      return {
        side, error: Number.NaN, iterations: 0, solveMs: this.now() - started,
        clamped: false, slewing: false, held: 'invalid',
      };
    }
    const solveMs = this.now() - started;

    if (!result.q.every((v) => Number.isFinite(v))) {
      return { side, error: Number.NaN, iterations: result.iterations, solveMs,
        clamped: false, slewing: false, held: 'invalid' };
    }

    // The rate limit runs from what was last COMMANDED, not from the solver's
    // seed — those differ exactly while the limiter is catching up, and running
    // it from the seed would let the arm advance a full step every frame and
    // defeat the limit entirely.
    // A zero `dt` means NO TIME HAS PASSED, which is a budget of zero, not an
    // infinite one — otherwise a client that sends the same frame twice in a
    // millisecond advances the arm twice with no limit. Only the genuinely
    // first solve for a side is unlimited: there is nothing to move from.
    const at = this.now();
    const last = this.lastAt[side];
    this.lastAt[side] = at;
    const budget = last === null
      ? Number.POSITIVE_INFINITY
      : MAX_JOINT_RATE_RAD_S * Math.min(MAX_RATE_DT_S, Math.max(0, (at - last) / 1000));
    const from = this.commanded[side] ?? seed;
    const next: number[] = [];
    let slewing = false;
    for (let i = 0; i < result.q.length; i++) {
      const want = result.q[i]!;
      const have = from[i] ?? want;
      const step = want - have;
      if (Number.isFinite(budget) && Math.abs(step) > budget) {
        next.push(have + Math.sign(step) * budget);
        slewing = true;
      } else {
        next.push(want);
      }
    }

    // Through `setTeleopJoint`, exactly like `{positions}`: an IK solution that
    // would violate an advertised limit is clamped AT THE JOINT and not trusted
    // because a solver produced it. `solveIk` already respects the same limits,
    // so this is belt and braces on purpose — the chain table and the joint
    // config are two different files and nothing forces them to agree.
    for (let i = 0; i < chain.links.length; i++) {
      const applied = this.robot.setTeleopJoint(chain.links[i]!.joint, next[i]!);
      if (applied !== null) next[i] = applied;
    }
    this.commanded[side] = next;
    this.seed[side] = result.q;

    return {
      side,
      error: result.positionError,
      iterations: result.iterations,
      solveMs,
      clamped: result.clamped,
      slewing,
    };
  }

  /** Forget the session's arm state — used when teleop is left or E-Stopped. */
  reset(): void {
    this.seed.left = null;
    this.seed.right = null;
    this.commanded.left = null;
    this.commanded.right = null;
    this.lastAt.left = null;
    this.lastAt.right = null;
  }

  /** The joint targets last written, per side, for tests and diagnostics. */
  lastCommanded(side: Side): readonly number[] | null {
    return this.commanded[side];
  }
}

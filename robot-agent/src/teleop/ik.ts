/**
 * @file ik.ts
 * @description Damped least squares inverse kinematics for the chains in
 *              `g1-chains.generated.ts`. Pure: same inputs, same output, no
 *              clock, no state.
 * @feature teleop
 * @status live
 *
 * WHY DLS AND NOT IPOPT. `xr_teleoperate` solves the same problem with
 * Pinocchio + CasADi + IPOPT, and issue #120 there reports 80–170 ms per solve
 * on a Jetson against ~4 ms on an x86 host. TASK-216 says to prototype the
 * cheap answer first and measure: this file is the cheap answer. It is 7 joints
 * and a 6×6 solve, it needs no Python process on the robot, and
 * `ik.test.ts` records what it actually costs.
 *
 * The wrist is NOT spherical — the yaw axis is offset 46 mm from the
 * roll/pitch intersection — so there is no closed form to fall back to and the
 * full 6-DOF Jacobian is required.
 */

import type { Chain } from './g1-chains.generated.js';
import {
  forwardKinematics,
  jacobian,
  norm,
  rotationError,
  sub,
  type ChainPose,
  type Mat3,
  type Vec3,
} from './kinematics.js';

export interface IkTarget {
  /** Where the tip should be, in the chain's root frame. */
  position: Vec3;
  /**
   * How the tip should be oriented, in the root frame. Optional on purpose:
   * position is what the operator aims and what the acceptance criteria
   * measure, so a chain with no usable orientation reference still tracks.
   */
  rotation?: Mat3 | null;
}

export interface IkOptions {
  /** Hard ceiling on iterations. */
  maxIterations?: number;
  /** Stop once the tip is this close, metres. */
  positionTolerance?: number;
  /** Stop once the tip is this well aligned, radians. Ignored without a rotation target. */
  rotationTolerance?: number;
  /**
   * Damping λ. Larger is slower and steadier; smaller is faster and rings near
   * singularities. Scaled up automatically as the residual shrinks would be
   * cleverer, and is not worth the surprise.
   */
  damping?: number;
  /** How much the rotation residual counts against the position residual. */
  rotationWeight?: number;
  /** Largest change any one joint may make in one iteration, radians. */
  maxStep?: number;
  /**
   * The same limit for the two null-space tasks, applied to each separately.
   *
   * Deliberately much smaller than `maxStep`. A null-space step only leaves the
   * primary task alone to first order, and "first order" is a statement about
   * step size — a 0.25 rad orientation correction moves the hand centimetres,
   * which the next iteration then has to undo.
   */
  secondaryMaxStep?: number;
  /**
   * Distance at which the orientation task starts to matter, metres.
   *
   * Above it the solver chases position ALONE. This is not a tuning knob so
   * much as the fix for a specific failure: from a cold start toward an awkward
   * target, an orientation term that is live from the first iteration walks the
   * shoulder into its limit and parks there — measured, 240 mm of position
   * error on a target position-only reaches in 11 iterations. Set it to 0 to
   * have orientation live from the first iteration.
   */
  rotationActivationM?: number;
  /** Posture the null space is pulled toward. Length must match the chain. */
  restPose?: readonly number[];
  /** Null-space gain. 0 disables the pull entirely. */
  restGain?: number;
  /**
   * Per-joint mobility, one per link, default 1. Below 1 means "move this joint
   * less". The G1's wrist pitch and yaw are 5 Nm actuators against 25 Nm
   * everywhere else in the arm, and an unweighted solver hands the smallest
   * motors the largest corrections.
   */
  mobility?: readonly number[];
}

export interface IkResult {
  /** The solution, already clamped to every joint's advertised limits. */
  q: number[];
  /** Distance from the tip to the target, metres. */
  positionError: number;
  /** Angle between the tip and the target, radians. 0 without a rotation target. */
  rotationError: number;
  iterations: number;
  /** True when both tolerances were met. */
  converged: boolean;
  /**
   * True when the returned pose is resting against at least one joint stop.
   *
   * A property of the ANSWER, not of the last step that produced it. It started
   * as the latter and that was wrong in the case it exists for: an arm reaching
   * behind the shoulder pins the shoulder pitch early and then spends its
   * remaining iterations moving other joints, so the final iteration clamps
   * nothing and the flag read false for a pose that is entirely limit-bound.
   */
  clamped: boolean;
}

const DEFAULTS = {
  maxIterations: 24,
  positionTolerance: 0.002,
  rotationTolerance: 0.05,
  damping: 0.04,
  rotationWeight: 0.6,
  maxStep: 0.25,
  restGain: 0.08,
  secondaryMaxStep: 0.08,
  rotationActivationM: 0.15,
};

/** Position-only iterations run after the main loop. See the polish block. */
const POLISH_ITERATIONS = 6;

/** How close to a limit counts as resting against it, radians (~0.006°). */
const AT_LIMIT_RAD = 1e-4;

/** Inverse of a symmetric positive-definite 3×3, or null if it is singular. */
function invert3(m: readonly number[]): number[] | null {
  const a = m[0]!, b = m[1]!, c = m[2]!;
  const d = m[3]!, e = m[4]!, f = m[5]!;
  const g = m[6]!, h = m[7]!, i = m[8]!;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [
    A * k, (c * h - b * i) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, (c * d - a * f) * k,
    C * k, (b * g - a * h) * k, (a * e - b * d) * k,
  ];
}

/** What to return when the arithmetic produced something that is not a number. */
function failed(
  q: number[],
  res: { posErr: number; rotErr: number },
  iterations: number,
): IkResult {
  return {
    q, positionError: res.posErr, rotationError: res.rotErr,
    iterations, converged: false, clamped: false,
  };
}

/** The residual of a pose against a target. */
function residual(
  pose: ChainPose,
  target: IkTarget,
): { pos: [number, number, number]; rot: [number, number, number]; posErr: number; rotErr: number } {
  const pos = sub(target.position, pose.tip);
  const rot = target.rotation
    ? rotationError(pose.tipRot, target.rotation)
    : ([0, 0, 0] as [number, number, number]);
  return { pos, rot, posErr: norm(pos), rotErr: norm(rot) };
}

/**
 * Drive `chain`'s tip to `target`, starting from `seed`.
 *
 * POSITION IS THE PRIMARY TASK AND ORIENTATION IS SOLVED IN ITS NULL SPACE.
 * That ordering is the whole design. Stacking the two into one damped six-row
 * solve — the obvious thing to write, and what this file did first — lets an
 * orientation the arm cannot reach drag the hand away from the point the
 * operator is pointing at: measured over 400 random targets, the 95th
 * percentile position error went from 7 mm to 272 mm the moment orientation
 * joined the primary task. With seven joints and three position rows there are
 * four degrees of freedom left over, orientation gets those, and a wrist that
 * cannot be matched costs the reach nothing.
 *
 * The seed is what makes it usable at 20 Hz: consecutive frames of a human hand
 * are millimetres apart, so warm-started from the previous answer the loop exits
 * in two or three iterations. `ik.test.ts` measures cold and warm separately.
 *
 * Every iteration clamps `q` to the joint's advertised limits BEFORE the next
 * forward pass, so the returned `q` is reachable by construction and the
 * residual it reports belongs to a pose the robot can actually hold — not to an
 * unreachable one the caller would then clamp into something else. `clamped`
 * says a limit is what stopped it.
 */
export function solveIk(
  chain: Chain,
  target: IkTarget,
  seed: readonly number[],
  options: IkOptions = {},
): IkResult {
  const opt = { ...DEFAULTS, ...options };
  const n = chain.links.length;
  const q = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const link = chain.links[i]!;
    const at = seed[i];
    q[i] = Math.min(link.upper, Math.max(link.lower, Number.isFinite(at) ? (at as number) : 0));
  }
  const mobility = opt.mobility ?? null;
  const lambdaSq = opt.damping * opt.damping;
  const wantRotation = Boolean(target.rotation) && opt.rotationWeight > 0;

  let pose = forwardKinematics(chain, q);
  let res = residual(pose, target);
  let iterations = 0;
  /**
   * How much better the combined residual got last iteration, and how many
   * iterations in a row that was nothing.
   *
   * The orientation task is SECONDARY, so its residual is often one the arm
   * simply cannot reduce any further — the wrist is not spherical and four
   * spare degrees of freedom do not span every orientation. Without this the
   * loop then spends its entire iteration budget, every frame, discovering
   * that again. Position keeps its own hard tolerance; this only stops the
   * chase once nothing is moving.
   */
  let objective = Number.POSITIVE_INFINITY;
  let stalled = 0;

  const dq = new Array<number>(n).fill(0);
  const dqSecondary = new Array<number>(n).fill(0);
  const N = new Array<number>(n * n).fill(0);

  /** Scale `v` so its largest component is at most `limit`, keeping direction. */
  const capStep = (v: number[], limit: number): boolean => {
    let biggest = 0;
    for (const x of v) biggest = Math.max(biggest, Math.abs(x));
    if (!Number.isFinite(biggest)) return false;
    if (biggest > limit) {
      const k = limit / biggest;
      for (let i = 0; i < v.length; i++) v[i]! *= k;
    }
    return true;
  };

  for (; iterations < opt.maxIterations; iterations++) {
    if (res.posErr <= opt.positionTolerance
      && (!wantRotation || res.rotErr <= opt.rotationTolerance)) {
      break;
    }
    const J = jacobian(pose);
    // Column scaling by mobility: a joint at 0.4 takes 0.4x the correction of
    // one at 1. The G1's wrist pitch and yaw are 5 Nm actuators against 25 Nm
    // everywhere else in the arm, and an unweighted solver hands the smallest
    // motors the largest corrections.
    if (mobility) {
      for (let r = 0; r < 6; r++) {
        for (let i = 0; i < n; i++) J[r * n + i]! *= mobility[i] ?? 1;
      }
    }

    // ---- primary task: position ------------------------------------------
    const Ap = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++) {
      for (let c = r; c < 3; c++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += J[r * n + i]! * J[c * n + i]!;
        Ap[r * 3 + c] = s + (r === c ? lambdaSq : 0);
        Ap[c * 3 + r] = Ap[r * 3 + c]!;
      }
    }
    const Api = invert3(Ap);
    if (!Api) break;
    const wp = [
      Api[0]! * res.pos[0] + Api[1]! * res.pos[1] + Api[2]! * res.pos[2],
      Api[3]! * res.pos[0] + Api[4]! * res.pos[1] + Api[5]! * res.pos[2],
      Api[6]! * res.pos[0] + Api[7]! * res.pos[1] + Api[8]! * res.pos[2],
    ];
    for (let i = 0; i < n; i++) {
      dq[i] = J[i]! * wp[0]! + J[n + i]! * wp[1]! + J[2 * n + i]! * wp[2]!;
    }

    // The primary step is capped here, on its own, so a large orientation or
    // posture correction can never scale the reach down to nothing.
    if (!capStep(dq, opt.maxStep)) break;

    // Orientation fades in as the hand closes on the point. See
    // `rotationActivationM`.
    const activation = opt.rotationActivationM > 0
      ? Math.min(1, Math.max(0, 1 - res.posErr / opt.rotationActivationM))
      : 1;
    const needNull = (wantRotation && activation > 0)
      || (opt.restPose !== undefined && opt.restGain > 0);
    dqSecondary.fill(0);
    if (needNull) {
      // N = I − Jpᵀ Ap⁻¹ Jp, the damped null-space projector of the position
      // task. Symmetric, built once and reused by both secondaries.
      const M = new Array<number>(3 * n).fill(0);
      for (let i = 0; i < n; i++) {
        const c0 = J[i]!, c1 = J[n + i]!, c2 = J[2 * n + i]!;
        M[i] = Api[0]! * c0 + Api[1]! * c1 + Api[2]! * c2;
        M[n + i] = Api[3]! * c0 + Api[4]! * c1 + Api[5]! * c2;
        M[2 * n + i] = Api[6]! * c0 + Api[7]! * c1 + Api[8]! * c2;
      }
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const s = J[a]! * M[b]! + J[n + a]! * M[n + b]! + J[2 * n + a]! * M[2 * n + b]!;
          N[a * n + b] = (a === b ? 1 : 0) - s;
        }
      }
    }

    // ---- secondary task: orientation, inside that null space --------------
    if (wantRotation && activation > 0) {
      const Jrn = new Array<number>(3 * n).fill(0);
      for (let r = 0; r < 3; r++) {
        for (let b = 0; b < n; b++) {
          let s = 0;
          for (let a = 0; a < n; a++) s += J[(3 + r) * n + a]! * N[a * n + b]!;
          Jrn[r * n + b] = s;
        }
      }
      const Ar = new Array<number>(9).fill(0);
      for (let r = 0; r < 3; r++) {
        for (let c = r; c < 3; c++) {
          let s = 0;
          for (let i = 0; i < n; i++) s += Jrn[r * n + i]! * Jrn[c * n + i]!;
          Ar[r * 3 + c] = s + (r === c ? lambdaSq : 0);
          Ar[c * 3 + r] = Ar[r * 3 + c]!;
        }
      }
      const Ari = invert3(Ar);
      if (Ari) {
        // What the primary step already did for orientation comes off the
        // residual first, or the two tasks fight over the same motion.
        const done = [0, 0, 0];
        for (let r = 0; r < 3; r++) {
          let s = 0;
          for (let i = 0; i < n; i++) s += J[(3 + r) * n + i]! * dq[i]!;
          done[r] = s;
        }
        const gain = opt.rotationWeight * activation;
        const er = [
          gain * res.rot[0] - done[0]!,
          gain * res.rot[1] - done[1]!,
          gain * res.rot[2] - done[2]!,
        ];
        const wr = [
          Ari[0]! * er[0]! + Ari[1]! * er[1]! + Ari[2]! * er[2]!,
          Ari[3]! * er[0]! + Ari[4]! * er[1]! + Ari[5]! * er[2]!,
          Ari[6]! * er[0]! + Ari[7]! * er[1]! + Ari[8]! * er[2]!,
        ];
        for (let i = 0; i < n; i++) {
          dqSecondary[i] = Jrn[i]! * wr[0]! + Jrn[n + i]! * wr[1]! + Jrn[2 * n + i]! * wr[2]!;
        }
        if (capStep(dqSecondary, opt.secondaryMaxStep)) {
          for (let i = 0; i < n; i++) dq[i]! += dqSecondary[i]!;
        }
      }
    }

    // ---- tertiary: posture, also inside the position null space -----------
    // Keeps the elbow where an operator expects it without ever costing reach.
    if (opt.restPose && opt.restGain > 0) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let a = 0; a < n; a++) {
          s += N[i * n + a]! * opt.restGain * ((opt.restPose[a] ?? 0) - q[a]!);
        }
        dqSecondary[i] = s;
      }
      if (capStep(dqSecondary, opt.secondaryMaxStep)) {
        for (let i = 0; i < n; i++) dq[i]! += dqSecondary[i]!;
      }
    }

    if (mobility) for (let i = 0; i < n; i++) dq[i]! *= mobility[i] ?? 1;
    for (const v of dq) if (!Number.isFinite(v)) return failed(q, res, iterations);

    let moved = 0;
    for (let i = 0; i < n; i++) {
      const link = chain.links[i]!;
      const want = q[i]! + dq[i]!;
      const next = Math.min(link.upper, Math.max(link.lower, want));
      moved = Math.max(moved, Math.abs(next - q[i]!));
      q[i] = next;
    }

    pose = forwardKinematics(chain, q);
    res = residual(pose, target);
    // Every joint pinned against a limit: another iteration computes the same
    // step and clamps it away again.
    if (moved < 1e-9) { iterations++; break; }

    const next = res.posErr + opt.rotationWeight * res.rotErr;
    stalled = objective - next < 1e-6 ? stalled + 1 : 0;
    objective = next;
    if (stalled >= 3 && res.posErr <= opt.positionTolerance) { iterations++; break; }
  }

  // ---- polish: position only ---------------------------------------------
  // The orientation task needs LARGE null-space steps to get anywhere — a
  // 0.04 rad cap leaves it stuck at 1.17 rad of error where 0.08 reaches
  // 0.21 rad — and a large null-space step is exactly the one whose projection
  // no longer holds, so it drags the hand a few millimetres off the point.
  // Measured over a 30 s tracked reach: 5.8 mm median with orientation live,
  // 1.1 mm without. Rather than trade one against the other, orientation gets
  // its big steps and then this walks the position error back out, small-step,
  // with nothing else in the loop to fight it.
  for (let k = 0; k < POLISH_ITERATIONS && res.posErr > opt.positionTolerance; k++) {
    const J = jacobian(pose);
    if (mobility) {
      for (let r = 0; r < 3; r++) {
        for (let i = 0; i < n; i++) J[r * n + i]! *= mobility[i] ?? 1;
      }
    }
    const Ap = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++) {
      for (let c = r; c < 3; c++) {
        let acc = 0;
        for (let i = 0; i < n; i++) acc += J[r * n + i]! * J[c * n + i]!;
        Ap[r * 3 + c] = acc + (r === c ? lambdaSq : 0);
        Ap[c * 3 + r] = Ap[r * 3 + c]!;
      }
    }
    const Api = invert3(Ap);
    if (!Api) break;
    const wp = [
      Api[0]! * res.pos[0] + Api[1]! * res.pos[1] + Api[2]! * res.pos[2],
      Api[3]! * res.pos[0] + Api[4]! * res.pos[1] + Api[5]! * res.pos[2],
      Api[6]! * res.pos[0] + Api[7]! * res.pos[1] + Api[8]! * res.pos[2],
    ];
    for (let i = 0; i < n; i++) {
      dq[i] = (J[i]! * wp[0]! + J[n + i]! * wp[1]! + J[2 * n + i]! * wp[2]!)
        * (mobility ? (mobility[i] ?? 1) : 1);
    }
    if (!capStep(dq, opt.maxStep)) break;
    const prevQ = q.slice();
    const prevPose = pose;
    const prevRes = res;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const link = chain.links[i]!;
      const want = q[i]! + dq[i]!;
      const next = Math.min(link.upper, Math.max(link.lower, want));
      moved = Math.max(moved, Math.abs(next - q[i]!));
      q[i] = next;
    }
    iterations++;
    if (moved < 1e-9) break;
    pose = forwardKinematics(chain, q);
    res = residual(pose, target);
    // The polish must never make things worse — if it does, the pose it just
    // left was the better one, so put it back. Taking the step and then
    // breaking without restoring is not the same thing: it returns the pose
    // this line has just measured as worse. Rare (~4% of solves, and only ones
    // that already missed the tolerance) but real — 12 mm on the worst case
    // found, enough to push an answer from inside TASK-216's 30 mm acceptance
    // bound to outside it.
    if (res.posErr >= prevRes.posErr) {
      for (let i = 0; i < n; i++) q[i] = prevQ[i]!;
      pose = prevPose;
      res = prevRes;
      break;
    }
  }

  const clamped = q.some((v, i) => {
    const link = chain.links[i]!;
    return v - link.lower <= AT_LIMIT_RAD || link.upper - v <= AT_LIMIT_RAD;
  });

  return {
    q,
    positionError: res.posErr,
    rotationError: res.rotErr,
    iterations,
    converged: res.posErr <= opt.positionTolerance
      && (!wantRotation || res.rotErr <= opt.rotationTolerance),
    clamped,
  };
}

/** The tip position a chain reaches at `q`, in the root frame. */
export function tipOf(chain: Chain, q: readonly number[]): [number, number, number] {
  return forwardKinematics(chain, q).tip;
}

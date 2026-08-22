/**
 * @file dexpilot.ts
 * @description Finger retargeting for the Dex3-1: human fingertip geometry in,
 *              seven joint angles per hand out. A port of DexPilot's vector
 *              formulation, not a wrapper around `dex-retargeting`.
 * @feature teleop
 * @status live
 *
 * WHY A PORT. `silencht/dex-retargeting` solves exactly this and its
 * `unitree_dex3.yml` is the reference we follow, but it pulls in torch, and
 * `xr_teleoperate` issue #167 documents a torch/Isaac conflict there is no
 * reason to inherit on a robot whose only job here is to answer a websocket.
 * What we take is the FORMULATION, which is small: match the vectors BETWEEN
 * fingertips rather than joint angles, so that a pinch the operator makes is a
 * pinch the robot makes even though the two hands are different sizes and have
 * different numbers of joints.
 *
 * DexPilot (Handa et al., 2020) matches two sets of vectors:
 *
 *   S1, the three tip-to-tip vectors (thumb-index, thumb-middle, index-middle).
 *       These carry the grasp. When the human's distance falls under
 *       `PROJECT_DIST_M` the target is SNAPPED TO ZERO and weighted up, which
 *       is what makes a pinch close firmly instead of hovering a few
 *       millimetres open.
 *   S2, the three wrist-to-tip vectors. These carry the hand's overall shape,
 *       and are weighted well below S1 — an open hand should look open, but not
 *       at the cost of a grasp.
 */

import {
  forwardKinematics,
  solveSymmetric,
  type Vec3,
} from './kinematics.js';
import { G1_FINGER_CHAINS, type Chain, type Finger, type Side } from './g1-chains.generated.js';

/** The four points DexPilot needs, in the hand's own frame, metres. */
export interface HandKeypoints {
  /** The wrist joint — the origin the S2 vectors are measured from. */
  wrist: Vec3;
  thumb: Vec3;
  index: Vec3;
  middle: Vec3;
}

/** Joint order this module works in. NOT a wire order — see `jointNames`. */
const FINGER_ORDER: readonly Finger[] = ['thumb', 'index', 'middle'];

/**
 * Human tip-to-tip distance below which a pair is treated as touching, metres.
 * `dex-retargeting`'s `project_dist`.
 */
export const PROJECT_DIST_M = 0.03;
/**
 * And the distance it has to reopen past before the pinch is released —
 * `escape_dist`. The gap between the two is hysteresis, and without it a hand
 * held right at the threshold chatters the fingers open and closed at the
 * stream rate.
 */
export const ESCAPE_DIST_M = 0.05;

/** Weight on a tip-to-tip vector, and on one that has snapped to a pinch. */
const S1_WEIGHT = 1;
const S1_PINCH_WEIGHT = 5;
/** Weight on a wrist-to-tip vector. Shape matters, but not as much as grasp. */
const S2_WEIGHT = 0.25;

/**
 * Human hand to robot hand scale.
 *
 * 1.0, following `unitree_dex3.yml`. It is close to right by accident rather
 * than by design: a Dex3 finger is 94 mm from root to tip and an adult index
 * finger is about 90 mm, so the two hands span nearly the same distances. It is
 * a constant here so that a smaller operator can be given a smaller number
 * without touching the objective.
 */
export const HAND_SCALE = 1;

/** The six vector tasks, in a fixed order: three S1 pairs, then three S2. */
const S1_PAIRS: readonly [Finger, Finger][] = [
  ['thumb', 'index'],
  ['thumb', 'middle'],
  ['index', 'middle'],
];

export interface FingerSolveOptions {
  maxIterations?: number;
  damping?: number;
  /** Largest change any one joint may make per iteration, radians. */
  maxStep?: number;
  /** Stop once every task vector is this close, metres. */
  tolerance?: number;
}

const FINGER_DEFAULTS = {
  maxIterations: 12,
  damping: 0.02,
  maxStep: 0.35,
  tolerance: 0.002,
};

export interface FingerSolveResult {
  /** Seven angles in `jointNames(side)` order, clamped to their limits. */
  q: number[];
  /** Root-mean-square residual over the six task vectors, metres. */
  error: number;
  iterations: number;
  /** Which tip pairs are currently held as a pinch. */
  pinched: [Finger, Finger][];
}

/**
 * The joint NAMES this module's `q` corresponds to, in `q` order.
 *
 * Deliberately derived from the chain table rather than written out: the
 * left hand's wire order lists MIDDLE before INDEX and the right hand's lists
 * index before middle (`hardware/sim_g1_dds/joints.py:25-27` — it comes from the
 * hardware). This module's own order is thumb, index, middle on BOTH sides, and
 * it never touches a wire index; the mapping back is by name, every time.
 */
export function jointNames(side: Side): string[] {
  return FINGER_ORDER.flatMap((f) => G1_FINGER_CHAINS[side][f].links.map((l) => l.joint));
}

/** Where each finger's joints sit in the concatenated 7-vector. */
function slices(side: Side): { finger: Finger; chain: Chain; at: number }[] {
  let at = 0;
  return FINGER_ORDER.map((finger) => {
    const chain = G1_FINGER_CHAINS[side][finger];
    const entry = { finger, chain, at };
    at += chain.links.length;
    return entry;
  });
}

function sub3(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * One hand's retargeting, with the pinch latches that make it DexPilot rather
 * than a least-squares fit.
 *
 * Stateful on purpose: the hysteresis (`PROJECT_DIST_M` in, `ESCAPE_DIST_M`
 * out) and the output filter are both memory, and both are per hand.
 */
export class FingerRetargeter {
  private readonly parts: { finger: Finger; chain: Chain; at: number }[];
  private readonly names: string[];
  private readonly total: number;
  private readonly pinched = new Set<string>();
  private filtered: number[] | null = null;

  /**
   * @param side which hand
   * @param alpha output low-pass, per update. `unitree_dex3.yml` uses 0.2 —
   *        higher is snappier, and finger tracking is noisy enough that raw
   *        output visibly buzzes.
   */
  constructor(private readonly side: Side, private readonly alpha = 0.2) {
    this.parts = slices(side);
    this.names = jointNames(side);
    this.total = this.parts.reduce((n, part) => n + part.chain.links.length, 0);
  }

  /** The joint names, in the order `solve()` returns angles. */
  jointNames(): readonly string[] {
    return this.names;
  }

  /** Forget the pinch latches and the filter — a new session, or tracking lost. */
  reset(): void {
    this.pinched.clear();
    this.filtered = null;
  }

  /**
   * Human keypoints in, joint angles out.
   *
   * `seed` warm-starts the solve, exactly as for the arm; pass the previous
   * answer.
   */
  solve(
    human: HandKeypoints,
    seed: readonly number[] | null,
    options: FingerSolveOptions = {},
  ): FingerSolveResult {
    const opt = { ...FINGER_DEFAULTS, ...options };
    const n = this.total;
    const q = new Array<number>(n).fill(0);
    let k = 0;
    for (const part of this.parts) {
      for (const link of part.chain.links) {
        const at = seed?.[k];
        q[k] = Math.min(link.upper, Math.max(link.lower,
          typeof at === 'number' && Number.isFinite(at) ? at : 0));
        k++;
      }
    }

    // ---- targets ----------------------------------------------------------
    const humanTip: Record<Finger, Vec3> = {
      thumb: human.thumb, index: human.index, middle: human.middle,
    };
    const targets: { v: [number, number, number]; w: number }[] = [];
    const pinchedNow: [Finger, Finger][] = [];
    for (const [a, b] of S1_PAIRS) {
      const raw = sub3(humanTip[a], humanTip[b]);
      const d = Math.hypot(raw[0], raw[1], raw[2]);
      const key = `${a}-${b}`;
      // Hysteresis: close at PROJECT_DIST_M, release only past ESCAPE_DIST_M.
      const was = this.pinched.has(key);
      const isPinch = was ? d < ESCAPE_DIST_M : d < PROJECT_DIST_M;
      if (isPinch) this.pinched.add(key); else this.pinched.delete(key);
      if (isPinch) {
        pinchedNow.push([a, b]);
        targets.push({ v: [0, 0, 0], w: S1_PINCH_WEIGHT });
      } else {
        targets.push({
          v: [raw[0] * HAND_SCALE, raw[1] * HAND_SCALE, raw[2] * HAND_SCALE],
          w: S1_WEIGHT,
        });
      }
    }
    for (const finger of FINGER_ORDER) {
      const raw = sub3(humanTip[finger], human.wrist);
      targets.push({
        v: [raw[0] * HAND_SCALE, raw[1] * HAND_SCALE, raw[2] * HAND_SCALE],
        w: S2_WEIGHT,
      });
    }

    const rows = targets.length * 3;
    const lambdaSq = opt.damping * opt.damping;
    let error = Number.POSITIVE_INFINITY;
    let iterations = 0;

    for (; iterations < opt.maxIterations; iterations++) {
      // Per-finger FK, then the tip positions and per-finger Jacobians widened
      // into the shared 7-column space.
      const tips: Record<string, [number, number, number]> = {};
      const tipJ: Record<string, number[]> = {};
      for (const part of this.parts) {
        const sub = q.slice(part.at, part.at + part.chain.links.length);
        const pose = forwardKinematics(part.chain, sub);
        tips[part.finger] = pose.tip;
        const J = new Array<number>(3 * n).fill(0);
        for (let i = 0; i < part.chain.links.length; i++) {
          const a = pose.axes[i]!;
          const r = sub3(pose.tip, pose.anchors[i]!);
          J[part.at + i] = a[1] * r[2] - a[2] * r[1];
          J[n + part.at + i] = a[2] * r[0] - a[0] * r[2];
          J[2 * n + part.at + i] = a[0] * r[1] - a[1] * r[0];
        }
        tipJ[part.finger] = J;
      }

      // Stack: rows 0..8 are the S1 differences, 9..17 the S2 offsets.
      const J = new Array<number>(rows * n).fill(0);
      const e = new Array<number>(rows).fill(0);
      let row = 0;
      const push = (
        vec: [number, number, number],
        Ja: number[],
        Jb: number[] | null,
        target: { v: [number, number, number]; w: number },
      ): void => {
        for (let axis = 0; axis < 3; axis++) {
          e[row] = (target.v[axis]! - vec[axis]!) * target.w;
          for (let i = 0; i < n; i++) {
            J[row * n + i] = (Ja[axis * n + i]! - (Jb ? Jb[axis * n + i]! : 0)) * target.w;
          }
          row++;
        }
      };
      for (let t = 0; t < S1_PAIRS.length; t++) {
        const [a, b] = S1_PAIRS[t]!;
        push(sub3(tips[a]!, tips[b]!), tipJ[a]!, tipJ[b]!, targets[t]!);
      }
      for (let f = 0; f < FINGER_ORDER.length; f++) {
        const finger = FINGER_ORDER[f]!;
        // S2 is measured from the chain root, which IS the wrist frame's
        // origin — so the robot vector is just the tip position.
        push(tips[finger]!, tipJ[finger]!, null, targets[S1_PAIRS.length + f]!);
      }

      let sq = 0;
      for (const v of e) sq += v * v;
      error = Math.sqrt(sq / targets.length);
      if (error <= opt.tolerance) break;

      // Over-constrained: 18 rows, 7 columns. Normal equations.
      const A = new Array<number>(n * n).fill(0);
      const g = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
          let acc = 0;
          for (let r = 0; r < rows; r++) acc += J[r * n + i]! * J[r * n + j]!;
          A[i * n + j] = acc + (i === j ? lambdaSq : 0);
          A[j * n + i] = A[i * n + j]!;
        }
        let acc = 0;
        for (let r = 0; r < rows; r++) acc += J[r * n + i]! * e[r]!;
        g[i] = acc;
      }
      const dq = solveSymmetric(A, g, n);
      if (!dq) break;

      let biggest = 0;
      for (const v of dq) biggest = Math.max(biggest, Math.abs(v));
      if (!Number.isFinite(biggest)) break;
      if (biggest > opt.maxStep) {
        const scale = opt.maxStep / biggest;
        for (let i = 0; i < n; i++) dq[i]! *= scale;
      }

      let moved = 0;
      let at = 0;
      for (const part of this.parts) {
        for (const link of part.chain.links) {
          const next = Math.min(link.upper, Math.max(link.lower, q[at]! + dq[at]!));
          moved = Math.max(moved, Math.abs(next - q[at]!));
          q[at] = next;
          at++;
        }
      }
      if (moved < 1e-9) { iterations++; break; }
    }

    // Output filter. The fingers are the noisiest thing a headset tracks and
    // the joints are small and fast, so raw output buzzes visibly.
    if (this.filtered === null || this.filtered.length !== n) {
      this.filtered = q.slice();
    } else {
      for (let i = 0; i < n; i++) {
        this.filtered[i] = this.filtered[i]! + this.alpha * (q[i]! - this.filtered[i]!);
      }
    }

    return { q: this.filtered.slice(), error, iterations, pinched: pinchedNow };
  }
}

/**
 * How far a joint is driven toward its stop at full grip, 0..1.
 *
 * Not 1: a position-controlled joint commanded exactly to its mechanical limit
 * sits there fighting the stop, which on the real Dex3 is heat rather than
 * grip.
 */
const GRIP_DEPTH = 0.9;

/**
 * The single-axis grasp — the controller fallback when there is no hand
 * tracking, as TASK-216 decision 5 keeps it.
 *
 * `grip` is the trigger, 0 (open) to 1 (closed). Every flexion joint is driven
 * from its open pose toward whichever of its limits is the CLOSING one, which
 * differs in sign between the two hands: the left index closes toward negative
 * and the right toward positive. Reading it off the limits rather than writing
 * two tables is the point — a mirrored table is exactly the mistake that makes
 * one hand open when the other closes.
 *
 * The thumb's first joint is left alone. It is rotation, not flexion — it swings
 * the thumb across the palm — and sweeping it with the trigger closes the thumb
 * into the fingers rather than around whatever is between them.
 */
export function gripPose(side: Side, grip: number): Record<string, number> {
  const g = Math.min(1, Math.max(0, Number.isFinite(grip) ? grip : 0));
  const out: Record<string, number> = {};
  for (const finger of FINGER_ORDER) {
    const chain = G1_FINGER_CHAINS[side][finger];
    for (let i = 0; i < chain.links.length; i++) {
      const link = chain.links[i]!;
      if (finger === 'thumb' && i === 0) {
        out[link.joint] = 0;
        continue;
      }
      // The closing limit is the one further from the open pose at zero. Both
      // Dex3 flexion joints have one limit at (or very near) zero and the other
      // at the closed end, so this picks the closed end on either hand.
      const closed = Math.abs(link.lower) > Math.abs(link.upper) ? link.lower : link.upper;
      out[link.joint] = closed * GRIP_DEPTH * g;
    }
  }
  return out;
}

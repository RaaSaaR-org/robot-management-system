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
 *
 * WHERE THIS DEPARTS FROM THE REFERENCE: the two hands are CALIBRATED against
 * each other before the vectors are compared (see `taskFrames`). `unitree_dex3.yml`
 * compares the human's vectors to the robot's directly, scaled by one number,
 * which only works when the two hands have similar proportions AND similar zero
 * poses. The Dex3 has neither: its fingertips sit 215 mm from the chain root
 * where an adult's sit ~176 mm from the wrist joint, and its thumb rests
 * splayed 110 mm across the palm, 190 mm from its own index tip, where an open
 * human hand's thumb-to-index gap is ~90 mm. Compared raw, an OPEN human hand
 * is a 100 mm error on the thumb-index task, and the cheapest way for the
 * solver to close 100 mm is to curl the index in: measured, a flat open hand
 * drove `index_1` to -1.737 rad against a -1.745 stop, i.e. deeper than the
 * full-trigger fist. The operator holds their hand open and the robot makes a
 * fist. So each of the six tasks gets a scale and a rotation fixed once, such
 * that a canonical open hand maps EXACTLY onto the robot's own open pose, and
 * the objective then carries the operator's DEPARTURE from open rather than
 * the difference between two hands' anatomy.
 */

import {
  axisAngleToMat3,
  cross,
  forwardKinematics,
  matVec,
  norm,
  solveSymmetric,
  type Mat3,
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
/**
 * Weight on a wrist-to-tip vector.
 *
 * `unitree_dex3.yml` discounts these heavily and this port copied it at 0.25.
 * That was damage limitation, not design: comparing the two hands' vectors raw,
 * S2 asked the robot for 40 mm of reach it does not have, and a high weight on
 * a task that can never be satisfied drags the whole hand. With the tasks
 * calibrated (`taskFrames`) S2 is a clean shape signal with an achievable
 * target, and there is no longer a reason to discount it — the grasp is
 * protected by `S1_PINCH_WEIGHT`, not by S2 being small. Measured over a human
 * hand curling from flat to a fist: at 0.25 the robot's index reached 0.60 rad
 * of the 1.41 available, at 1.0 it reaches 0.96, while a pinch closes to 33 mm
 * against the Dex3's own 29 mm floor.
 */
const S2_WEIGHT = 1;

/**
 * Operator hand size, relative to `HUMAN_OPEN_HAND`.
 *
 * 1.0 is the canonical adult hand below. This does NOT scale the human vectors
 * directly — the per-task calibration would divide any such factor straight
 * back out. It scales the REFERENCE hand the calibration is built from, which
 * is the thing a hand size actually changes: give a smaller operator 0.9 and
 * every task's scale rises by the same 11%, so their smaller reach still opens
 * the robot's hand all the way.
 */
export const HAND_SCALE = 1;

/**
 * A canonical adult open hand, RIGHT, in the frame `handKeypointsToRobotFrame`
 * produces: origin at the wrist joint, +x along the fingers, +z from the middle
 * knuckle toward the index knuckle, +y = z x x (which is the palm side on the
 * right hand and the back of the hand on the left — the frame mirrors with the
 * anatomy, which is why one table serves both and only y flips).
 *
 * Anthropometry, not measurement of one person: wrist joint to middle tip
 * 190 mm and to index tip 176 mm, adjacent fingertips ~27 mm apart, the thumb
 * abducted to 98 mm out and 58 mm across toward the index, sitting 22 mm off
 * the palm plane. Every number here is a REFERENCE POSE, not a threshold: being
 * a centimetre off makes the robot's open hand a few degrees off zero, and
 * `HAND_SCALE` is the knob for an operator who is a long way from it.
 */
export const HUMAN_OPEN_HAND: Readonly<HandKeypoints> = {
  wrist: [0, 0, 0],
  thumb: [0.098, 0.022, 0.058],
  index: [0.176, 0, 0.013],
  middle: [0.190, 0, -0.010],
};

/** The same pose for a given hand — y mirrors, exactly as the robot's does. */
export function openHandReference(side: Side): HandKeypoints {
  const flip = side === 'left' ? -1 : 1;
  const m = (v: Vec3): Vec3 => [v[0] * HAND_SCALE, v[1] * flip * HAND_SCALE, v[2] * HAND_SCALE];
  return {
    wrist: m(HUMAN_OPEN_HAND.wrist),
    thumb: m(HUMAN_OPEN_HAND.thumb),
    index: m(HUMAN_OPEN_HAND.index),
    middle: m(HUMAN_OPEN_HAND.middle),
  };
}

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
  /** Pull toward the open hand where the vector tasks do not care. */
  restGain?: number;
}

const FINGER_DEFAULTS = {
  maxIterations: 12,
  damping: 0.02,
  maxStep: 0.35,
  tolerance: 0.002,
  restGain: 0.02,
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
 * How one task's human vector becomes a robot target: turn it into the robot's
 * own open direction for that task, then stretch it to the robot's own span.
 */
interface TaskFrame {
  scale: number;
  rot: Mat3;
}

const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The rotation taking `from` onto `to`, both treated as directions. */
function alignRotation(from: Vec3, to: Vec3): Mat3 {
  const nf = norm(from);
  const nt = norm(to);
  if (!(nf > 1e-9) || !(nt > 1e-9)) return IDENTITY3;
  const f: Vec3 = [from[0] / nf, from[1] / nf, from[2] / nf];
  const t: Vec3 = [to[0] / nt, to[1] / nt, to[2] / nt];
  const axis = cross(f, t);
  const sin = norm(axis);
  const cos = f[0] * t[0] + f[1] * t[1] + f[2] * t[2];
  if (sin < 1e-9) {
    // Parallel, or antiparallel. Antiparallel needs SOME perpendicular axis;
    // which one does not matter, every choice gives the same result on `f`.
    if (cos > 0) return IDENTITY3;
    const seed: Vec3 = Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perp = cross(f, seed);
    const n = norm(perp);
    return axisAngleToMat3([perp[0] / n, perp[1] / n, perp[2] / n], Math.PI);
  }
  return axisAngleToMat3([axis[0] / sin, axis[1] / sin, axis[2] / sin], Math.atan2(sin, cos));
}

/** The robot's own fingertip positions with every finger joint at zero. */
function robotOpenTips(side: Side): Record<Finger, Vec3> {
  const out = {} as Record<Finger, Vec3>;
  for (const finger of FINGER_ORDER) {
    const chain = G1_FINGER_CHAINS[side][finger];
    out[finger] = forwardKinematics(chain, new Array<number>(chain.links.length).fill(0)).tip;
  }
  return out;
}

const TASK_FRAME_CACHE: Partial<Record<Side, readonly TaskFrame[]>> = {};

/**
 * The six task calibrations for one hand, in `S1_PAIRS` then `FINGER_ORDER`
 * order.
 *
 * Fixed geometry on both sides, so it is computed once per hand and cached.
 * The property that matters: fed `openHandReference(side)`, every task's target
 * comes out EXACTLY equal to the robot's own vector at q = 0, so the residual
 * is zero and an open hand stays open. Everything else is measured as the
 * operator's departure from that pose.
 */
function taskFrames(side: Side): readonly TaskFrame[] {
  const cached = TASK_FRAME_CACHE[side];
  if (cached) return cached;
  const robot = robotOpenTips(side);
  const human = openHandReference(side);
  const humanTip: Record<Finger, Vec3> = {
    thumb: human.thumb, index: human.index, middle: human.middle,
  };
  const frames: TaskFrame[] = [];
  const build = (h: Vec3, r: Vec3): TaskFrame => {
    const nh = norm(h);
    return {
      // A degenerate reference vector would be a broken constant, not a
      // runtime condition — fall back to the identity rather than NaN.
      scale: nh > 1e-9 ? norm(r) / nh : 1,
      rot: alignRotation(h, r),
    };
  };
  for (const [a, b] of S1_PAIRS) {
    frames.push(build(sub3(humanTip[a], humanTip[b]), sub3(robot[a], robot[b])));
  }
  for (const finger of FINGER_ORDER) {
    frames.push(build(sub3(humanTip[finger], human.wrist), robot[finger]));
  }
  TASK_FRAME_CACHE[side] = frames;
  return frames;
}

/** A human task vector, expressed as a target in the robot's hand. */
function toRobotTask(frame: TaskFrame, v: Vec3): [number, number, number] {
  const r = matVec(frame.rot, v);
  return [r[0] * frame.scale, r[1] * frame.scale, r[2] * frame.scale];
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
    const frames = taskFrames(this.side);
    const targets: { v: [number, number, number]; w: number }[] = [];
    const pinchedNow: [Finger, Finger][] = [];
    for (let t = 0; t < S1_PAIRS.length; t++) {
      const [a, b] = S1_PAIRS[t]!;
      const raw = sub3(humanTip[a], humanTip[b]);
      // The pinch thresholds are HUMAN distances and stay human — the operator
      // decides they are touching by touching, not by what the calibration
      // makes of it.
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
        targets.push({ v: toRobotTask(frames[t]!, raw), w: S1_WEIGHT });
      }
    }
    for (let f = 0; f < FINGER_ORDER.length; f++) {
      const raw = sub3(humanTip[FINGER_ORDER[f]!], human.wrist);
      targets.push({ v: toRobotTask(frames[S1_PAIRS.length + f]!, raw), w: S2_WEIGHT });
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
        // The robot's S2 vector is just the tip position: the chain root is
        // the origin these are measured from. The human's wrist joint is NOT
        // in the same place — `taskFrames` is what reconciles the two.
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
        // Tikhonov pull toward the open hand — DexPilot's own posture term,
        // which this port had dropped. Seven joints against eighteen rows is
        // over-constrained on paper and badly conditioned in fact: the thumb
        // runs out of travel long before its two tip-to-tip tasks are
        // satisfied, and with nothing to say otherwise the solver pays the
        // remaining error down by CURLING THE INDEX, which moves the same
        // vectors just as well. Measured: an index finger 8 mm shorter than
        // the reference hand drove `index_1` to its stop before this term.
        A[i * n + i]! += opt.restGain;
        g[i] = acc + opt.restGain * (0 - q[i]!);
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

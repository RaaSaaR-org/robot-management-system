/**
 * @file action-contracts.ts
 * @description What a policy's action vector MEANS, per embodiment: the joint
 *              name each element addresses, and the decoding a block needs
 *              before it is radians. Turns an action vector into a name-keyed
 *              joint dict, or refuses.
 * @feature vla
 * @status live
 */

import type { RobotType } from '../robot/types.js';
import { getJointConfig } from '../robot/joint-configs/index.js';
import {
  G1_ARM_JOINTS,
  G1_LEFT_HAND_JOINTS,
  G1_RIGHT_HAND_JOINTS,
} from '../recording/dex3-layout.js';

// ────────────────────────────────────────────────────────────────────────────
// TASK-229. The action vector used to be mapped POSITIONALLY: `action[i]` was
// written to the i-th name of the embodiment's joint order. That order is the
// 43-DOF body order (legs 12, waist 3, arms 14, hands 14), and the policy's
// order is nothing like it, so on a G1 EDU a 31-dim apple-pick action landed
// like this:
//
//     left shoulder pitch  ->  left_hip_pitch_joint
//     left-hand grip code  ->  waist_pitch_joint
//     waist yaw            ->  right_wrist_yaw_joint
//     (vector ends at 31)  ->  both hands, never written at all
//
// i.e. arm trajectories were commanded onto the LEGS of a standing humanoid,
// and no finger ever moved. It logged one warning line and carried on. The
// only reason nobody fell over is that G1_READ_ONLY=1 made the sidecar answer
// 403 at step 1.
//
// The observation direction was assumed correct and was not. `getStateNow`
// reads name-keyed joints and reorders them into the embodiment's joint order,
// which matches the 43-dim state contract at 39 of 43 indices — and misses at
// four: the left hand's index/middle pair, transposed for the same reason. A
// bug that is right 91% of the time, wrong only in the fingers, and wrong only
// on one hand, is the kind that survives a long time. So this module owns BOTH
// orders and both directions go through it.
// ────────────────────────────────────────────────────────────────────────────

// The per-limb name lists below are the same ones
// `hardware/sim_evaluator/envs/g1_apple_env.py` composes its contract from, and
// the arm/hand lists are imported rather than transcribed a third time: this
// repo already carries them in `recording/dex3-layout.ts` (the wire and dataset
// order, `sim_g1_dds/joints.py`), where the comment on the left hand explains at
// length why the two hands are not mirrors of each other. Legs and waist are
// declared here because the recording layout has no use for them — a G1 EDU
// records arms and hands only.

/** SDK leg order per side: hip_pitch, hip_roll, hip_yaw, knee, ankle_pitch, ankle_roll. */
const LEG_JOINT_NAMES: readonly string[] = [
  'left_hip_pitch_joint',
  'left_hip_roll_joint',
  'left_hip_yaw_joint',
  'left_knee_joint',
  'left_ankle_pitch_joint',
  'left_ankle_roll_joint',
  'right_hip_pitch_joint',
  'right_hip_roll_joint',
  'right_hip_yaw_joint',
  'right_knee_joint',
  'right_ankle_pitch_joint',
  'right_ankle_roll_joint',
];

/** SDK indices 12, 13, 14. */
const WAIST_JOINT_NAMES: readonly string[] = [
  'waist_yaw_joint',
  'waist_roll_joint',
  'waist_pitch_joint',
];

/**
 * The 31-dim ACTION contract of the `g1_apple_pnp` checkpoints, in order:
 * `[L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3]`.
 *
 * MIRRORS `ACTION_JOINT_NAMES` in
 * `robot-agent/hardware/sim_evaluator/envs/g1_apple_env.py`, which is the
 * source of truth (composed there from the same per-limb lists the dataset's
 * `meta/modality.json` layout uses). `__tests__/action-contracts.test.ts`
 * parses that Python file at test time and diffs it against this table, because
 * a drifted name has NO runtime symptom on the sidecar: an unknown key is
 * skipped silently and the joint simply never moves.
 *
 * The hand blocks are not symmetric. The Dex3-1 SDK enumerates the LEFT hand as
 * thumb → MIDDLE → index and the RIGHT as thumb → index → middle. That is real
 * hardware (`hardware/sim_g1_dds/joints.py:25`), and it is why this table is
 * names and not an offset: NeoDEM's own `dex3HandJoints()` builds both hands
 * thumb → index → middle, so a positional copy transposes the left hand's index
 * and middle fingers on top of everything else.
 */
export const G1_APPLE_ACTION_JOINT_NAMES: readonly string[] = [
  ...G1_ARM_JOINTS,
  ...G1_LEFT_HAND_JOINTS,
  ...G1_RIGHT_HAND_JOINTS,
  ...WAIST_JOINT_NAMES,
];

/**
 * The 43-dim STATE contract the same checkpoints are fed, in order:
 * `[L-leg 6 | R-leg 6 | waist 3 | L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7]`.
 * Mirrors `STATE_JOINT_NAMES` in `g1_apple_env.py`, pinned by the same test.
 *
 * This exists because the OBSERVATION was wrong too, and less visibly than the
 * action was. `HardwareClient.getStateNow` read name-keyed joints and reordered
 * them into the embodiment's own joint order, which agrees with this table at
 * 39 of 43 indices and disagrees at exactly four — 32..35, the left hand's
 * index/middle pair, transposed for the same hardware-asymmetry reason as
 * above. The legs, the waist, both arms and the entire right hand looked
 * perfect. So the policy was told the left index finger was where the middle
 * finger is, during the grasp, which is the only moment those four numbers
 * carry anything.
 */
export const G1_APPLE_STATE_JOINT_NAMES: readonly string[] = [
  ...LEG_JOINT_NAMES,
  ...WAIST_JOINT_NAMES,
  ...G1_ARM_JOINTS,
  ...G1_LEFT_HAND_JOINTS,
  ...G1_RIGHT_HAND_JOINTS,
];

/** `action[14:21]` — the left-hand block, the one that is a code and not radians. */
export const G1_APPLE_LEFT_HAND_SLICE = { start: 14, end: 21 } as const;

/** `action[21:28]` — the right-hand block, passed through raw. See `toJointTargets`. */
export const G1_APPLE_RIGHT_HAND_SLICE = { start: 21, end: 28 } as const;

// ── the left-hand grip decoder ──────────────────────────────────────────────

/**
 * Steady-state radians at the fully OPEN code, per left-hand joint slot, in the
 * LEFT slot order `[thumb_0, thumb_1, thumb_2, middle_0, middle_1, index_0,
 * index_1]`. Per-joint means over 113 438 steady frames (code held ≥ 20 frames,
 * i.e. past every joint's measured settling time). Copied digit for digit from
 * `vla-training/eval/hand_grip_decoder.py`; they are measurements, so rounding
 * them would be inventing data.
 */
const LEFT_HAND_OPEN: readonly number[] = [
  -0.07438, +0.06824, +0.06162, -0.07636, -0.05852, -0.08516, -0.08469,
];

/** The same, at the fully CLOSED code. n = 24 329 steady frames. */
const LEFT_HAND_CLOSE: readonly number[] = [
  -0.07438, +0.20552, +0.47074, -0.69452, -0.83696, -0.72598, -0.77278,
];

/**
 * MJCF joint limits from `g1_43dof_fixedbase_realism.xml`, kept as the same
 * belt-and-braces clamp the Python reference ends with.
 *
 * It has never fired and cannot: `ga`, `gb` and `gmax` are already clipped to
 * [0,1], so every output is a convex combination of OPEN and CLOSE, and both
 * endpoints sit strictly inside these limits (smallest per-slot margin
 * 0.0585 rad). Brute-forcing 40 000 malformed codes produced a maximum
 * pre-clamp violation of exactly 0. Kept for parity with the reference and as
 * a guard on a future edit of the endpoint tables — not relied on as the
 * safety bound, which is the [0,1] clip above it.
 */
const LEFT_HAND_LIMIT_LO: readonly number[] = [
  -1.0472, -0.724312, 0.0, -1.5708, -1.74533, -1.5708, -1.74533,
];
const LEFT_HAND_LIMIT_HI: readonly number[] = [
  +1.0472, +1.0472, 1.74533, 0.0, 0.0, 0.0, 0.0,
];

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/**
 * `max(a, b, c)` with Python's builtin semantics, NOT `Math.max`'s.
 *
 * The two disagree on exactly one input class, and it is one this decoder can
 * see. Python's `max` is a left-to-right fold of `>`: it starts with `a` and
 * replaces the running maximum only when a later argument compares greater. A
 * NaN never compares greater than anything, so Python's `max` DISCARDS it and
 * returns the largest finite argument. `Math.max` is specified to return NaN if
 * any argument is NaN, so it PROPAGATES it.
 *
 * That matters here because a NaN confined to code slots 5 or 6 (the two
 * redundant measurements of `max(ga, gb)`) leaves `ga` and `gb` finite, so the
 * reference still produces a valid thumb pose from the finger scalars while
 * `Math.max` would poison `gmax` and hand thumb_1/thumb_2 a NaN. Those NaNs do
 * not stop anywhere downstream: `JSON.stringify` serialises them as `null`, so
 * the sidecar is POSTed `{"left_hand_thumb_1_joint": null}` and the joint gets
 * no usable target at all. This module's whole claim is that it is the same
 * function as `hand_grip_decoder.decode_left_hand`, so it folds the same way.
 */
function pythonMax3(a: number, b: number, c: number): number {
  let m = a;
  if (b > m) m = b;
  if (c > m) m = c;
  return m;
}

/**
 * Decode one left-hand Dex3 grip CODE into joint RADIANS. A port of
 * `decode_left_hand` in `vla-training/eval/hand_grip_decoder.py`, which
 * `run_apple_eval.py:221` applies to `action[14:21]` every single step.
 *
 * WHY A DECODER AT ALL: in the AppleToPlate dataset `observation.state[29:36]`
 * is radians but `action[29:36]` is NOT — it is a normalised grip code from the
 * teleop stack, carrying two free scalars quantised to n/255, and its code
 * slots are scrambled relative to the joint slots (slots 5 and 6 sit in the
 * index positions but carry `max(ga, gb)`, not `ga`). A policy trained on this
 * data emits codes, so an identity pass-through cannot work even in principle:
 * fed straight to the position servos, thumb_2 / middle_1 / index_0 / index_1
 * clip to their OPEN limit and thumb_1 sign-flips, and the "closed" hand is
 * very nearly an open hand. Measured through the replay gate on the same
 * command vector: **0/15 transports, median lift 0.0 mm without the decoder,
 * 13/15 and 72.6 mm with it**.
 *
 * Structure recovered over all 171 625 frames:
 *
 *     ga = -code[0] = -code[1]        index_0, index_1   follow ga
 *     gb = -code[2] = -code[3]        middle_0, middle_1 follow gb
 *     code[4] = 0.5*(gb - ga)         read by NOTHING
 *     code[5] = 0.40 * max(ga, gb)    thumb_1, thumb_2   follow max(ga, gb)
 *     code[6] = 0.70 * max(ga, gb)    thumb_0            follows nothing (R² = 0.011)
 *
 * The duplicates are averaged and `code[5]`/`code[6]` are folded back in as a
 * lower bound on the max, because a continuous policy will not honour the
 * redundancy exactly — reading only `code[0]`, or skipping the fold, gives
 * different numbers on real policy output than the reference does.
 *
 * @param code 7 elements, `action[14:21]`, in LEFT slot order.
 * @returns 7 joint targets in radians, same slot order.
 * @throws if `code` is not exactly 7 long — mirroring the reference, because a
 *         silently padded or truncated grip is a hand doing something else.
 */
export function decodeLeftHandGrip(code: readonly number[]): number[] {
  if (code.length !== 7) {
    throw new Error(`decodeLeftHandGrip expects 7 elements, got ${code.length}`);
  }
  const c = code;

  // ga and gb are stored negated and duplicated; average the duplicate pair so
  // a policy emitting c[0] = -0.62 alongside c[1] = -0.70 lands between them
  // rather than on whichever slot happened to be read first.
  let ga = -0.5 * (c[0]! + c[1]!);
  let gb = -0.5 * (c[2]! + c[3]!);

  // The two remaining independent measurements of max(ga, gb), averaged. This
  // is a LOWER BOUND fold, not a substitution: the thumb can end up closing
  // further than either finger scalar alone would say.
  let gmaxObs = 0.5 * (c[5]! / 0.4 + c[6]! / 0.7);

  ga = clamp01(ga);
  gb = clamp01(gb);
  gmaxObs = clamp01(gmaxObs);
  // `pythonMax3`, not `Math.max` — see the note there. `clamp01` above already
  // matches `min(max(v, 0.0), 1.0)` on a NaN (both return it), so the fold is
  // the only place the two languages part company.
  const gmax = pythonMax3(ga, gb, gmaxObs);

  // Per-slot interpolation scalar. thumb_0 is abduction: a per-episode posture
  // constant (within-episode rms 0.0006 rad, between-episode std 0.094 rad)
  // that the code carries no information about, so the best memoryless answer
  // is its global steady mean — which is why OPEN[0] === CLOSE[0] and s[0] is
  // irrelevant. Costs ~0.094 rad rms on that one joint and nothing else.
  const s = [0, gmax, gmax, gb, gb, ga, ga];

  const out = new Array<number>(7);
  for (let i = 0; i < 7; i++) {
    const rad = LEFT_HAND_OPEN[i]! + s[i]! * (LEFT_HAND_CLOSE[i]! - LEFT_HAND_OPEN[i]!);
    out[i] = Math.min(Math.max(rad, LEFT_HAND_LIMIT_LO[i]!), LEFT_HAND_LIMIT_HI[i]!);
  }
  return out;
}

// ── contracts ───────────────────────────────────────────────────────────────

/**
 * How an action vector of a given width is turned into joint targets for a
 * given embodiment.
 *
 * `kind` distinguishes the two eras. `'named'` is a real contract: every
 * element's joint is known by name and any block-level decoding is applied.
 * `'positional'` is the pre-TASK-229 behaviour, kept unchanged for the
 * embodiments whose policies were trained against their own joint order
 * (SO-101 and friends) — for those, `action[i]` genuinely does mean the i-th
 * joint, and changing it would break a working robot to fix a different one.
 */
export interface ActionContract {
  /** Stable id for logs and for the run record. */
  readonly id: string;
  readonly kind: 'named' | 'positional';
  /** Joint name per action index. For `'positional'`, the embodiment's order. */
  readonly names: readonly string[];
  /**
   * Action indices whose value is NOT the joint's angle in radians — a code,
   * a normalised scalar, anything the observation cannot be compared against.
   * Empty for every contract that is angles all the way through.
   *
   * The one consumer is the rate limiter's seed: a delta clip needs the
   * PREVIOUS value of the same quantity, and there is no previous grip code in
   * a vector of joint angles. Slots listed here are seeded "no comparable
   * previous value" rather than with the joint's radians.
   */
  readonly encodedSlots?: readonly number[];
  /** Name-keyed joint targets in radians, ready for the sidecar's `/action`. */
  toJointTargets(action: readonly number[]): Record<string, number>;
}

/**
 * Joints a machine stands on. `requiresActionContract` keys on the PRESENCE of
 * these in an embodiment's joint order, deliberately not on its DOF count.
 *
 * The first cut of this guard asked "is this a 43-DOF robot", which is the same
 * untrusted input that produced the defect: `ROBOT_TYPE` is an env var, and a
 * G1 EDU declared as `g1` (29 DOF) is 29 ≠ 43, so it fell through to the
 * positional map, `getSidecarUrl()` sent it to the very same sidecar on :8767,
 * and a 31-dim apple action landed on twelve leg joints behind one
 * `console.warn`. `h1` is the same shape. The question that actually matters is
 * not how many joints the robot has — it is whether the thing is standing on
 * the joints we are about to command by index, so that is what is asked.
 *
 * Matched as name fragments because the two humanoids spell their legs
 * differently (`left_ankle_pitch_joint` on a G1, `left_ankle_joint` on an H1)
 * and a table would need a new row per embodiment, added by whoever adds the
 * robot — i.e. exactly when it would be forgotten. Nothing on SO-101 matches.
 */
const LEG_JOINT_MARKERS: readonly string[] = ['_hip_', '_knee', '_ankle'];

function hasLegs(order: readonly string[]): boolean {
  return order.some((name) => LEG_JOINT_MARKERS.some((m) => name.includes(m)));
}

/** Whether `order` declares every joint `names` addresses, so the contract can be hosted. */
function declaresAll(order: readonly string[], names: readonly string[]): boolean {
  const have = new Set(order);
  return names.every((n) => have.has(n));
}

const G1_APPLE_PNP_CONTRACT: ActionContract = {
  id: 'g1_apple_pnp_31',
  kind: 'named',
  names: G1_APPLE_ACTION_JOINT_NAMES,
  // `action[14:21]` is the left-hand grip CODE — see `decodeLeftHandGrip`. The
  // state's left hand is radians, so those seven slots have no counterpart in
  // an observation and must not be rate-limited against one.
  encodedSlots: Array.from(
    { length: G1_APPLE_LEFT_HAND_SLICE.end - G1_APPLE_LEFT_HAND_SLICE.start },
    (_, i) => G1_APPLE_LEFT_HAND_SLICE.start + i,
  ),
  toJointTargets(action: readonly number[]): Record<string, number> {
    if (action.length !== G1_APPLE_ACTION_JOINT_NAMES.length) {
      throw new Error(
        `g1_apple_pnp_31 expects ${G1_APPLE_ACTION_JOINT_NAMES.length} action elements, got ${action.length}`,
      );
    }
    // Exactly `run_apple_eval.py:221`: decode the left-hand block in place,
    // leave everything else as it came out of the policy.
    const values = action.slice();
    const decoded = decodeLeftHandGrip(
      values.slice(G1_APPLE_LEFT_HAND_SLICE.start, G1_APPLE_LEFT_HAND_SLICE.end),
    );
    for (let i = 0; i < decoded.length; i++) {
      values[G1_APPLE_LEFT_HAND_SLICE.start + i] = decoded[i]!;
    }

    // The RIGHT hand (`action[21:28]`) is passed through RAW, no decode —
    // mirroring the reference runner, which is the configuration the measured
    // 13/15 was obtained in. Whether that block is a code too is an OPEN
    // QUESTION and cannot be settled from this dataset: it is exactly 0 in all
    // 171 625 frames (one distinct vector) while the right hand's measured
    // state is non-zero, so it is a dead channel carrying no evidence either
    // way. Do not "fix" this by reusing the left decoder — its endpoint tables
    // were fitted to the LEFT hand and are in the LEFT slot order, so it would
    // both invent a model and land it on the wrong fingers.

    // The WAIST (`action[28:31]`) is absolute radians and IS commanded. It
    // barely moves (9.5e-5 rad/frame, ~44x less than the left arm) but it is
    // not zero: it carries a constant ~-0.12 rad operator lean toward the
    // table. Dropping it costs ~52 mm of lateral offset over the whole hand
    // path at a 0.45 m lever — the Isaac replay measured that error at 2/15
    // transports, and parking the waist correctly took it to 7/15. The "waist
    // is not commandable" note applies to Isaac's `action_provider_dds.py`,
    // which reads only positions[15:29]; nothing on NeoDEM's write path drops it.

    const joints: Record<string, number> = {};
    for (let i = 0; i < G1_APPLE_ACTION_JOINT_NAMES.length; i++) {
      joints[G1_APPLE_ACTION_JOINT_NAMES[i]!] = values[i]!;
    }
    return joints;
  },
};

function jointOrderFor(robotType: string): string[] {
  return getJointConfig(robotType as RobotType).map((j) => j.name);
}

function positionalContract(robotType: string, order: readonly string[]): ActionContract {
  return {
    id: `positional_${robotType}`,
    kind: 'positional',
    names: order,
    toJointTargets(action: readonly number[]): Record<string, number> {
      // Byte-for-byte what `HardwareClient.sendActionVector` has always done:
      // map the overlap, never silently truncate the longer side.
      const joints: Record<string, number> = {};
      const n = Math.min(order.length, action.length);
      for (let i = 0; i < n; i++) joints[order[i]!] = action[i]!;
      return joints;
    },
  };
}

/**
 * Whether this embodiment may only be commanded through a named contract.
 *
 * True for every embodiment that has LEGS — `g1_edu`, and also `g1` and `h1`,
 * which the DOF-count version of this test let through. A humanoid whose action
 * vector is mapped onto a joint order it was not trained against does not
 * produce a slightly wrong motion; it produces hip and knee commands, and the
 * robot is standing on those. Refusing is the only safe answer, so for these
 * embodiments `resolveActionContract` returning `null` means "end the rollout",
 * never "fall back to the positional map".
 *
 * Note the consequence for `g1` and `h1`: no named contract exists for either
 * (the only one here needs two Dex3 hands), so EVERY action width is refused on
 * them today. That is the intended reading of "fail closed" — a 29-DOF G1 whose
 * policy really was trained in its own body order gets a contract of its own
 * here, written down and tested, rather than an index map nobody checked.
 */
export function requiresActionContract(robotType: string): boolean {
  return hasLegs(jointOrderFor(robotType));
}

/** Action widths this embodiment has a named contract for. Used in the refusal message. */
export function supportedActionLengths(robotType: string): readonly number[] {
  return declaresAll(jointOrderFor(robotType), G1_APPLE_ACTION_JOINT_NAMES)
    ? [G1_APPLE_ACTION_JOINT_NAMES.length]
    : [];
}

/**
 * Resolve how to interpret an action vector of `actionLength` on `robotType`.
 *
 * Returns `null` when nothing matches. For a `requiresActionContract`
 * embodiment that is a refusal the caller must honour by ending the run; for a
 * `generic` robot with no joints at all it means there is nothing to command,
 * which is what the positional path already did.
 *
 * NOTE the selector is deliberately (robotType, actionLength) TODAY, but width
 * alone does not identify an encoding: two 31-dim G1 policies exist here with
 * different left-hand encodings — the Discoverer finetunes emit the grip CODE,
 * the NVIDIA LEAPP ONNX export emits RADIANS in that block (which is why
 * `arena_leapp_policy.py` keeps its decode behind an opt-in env var). A second
 * 31-dim checkpoint of the LEAPP kind will need the skill/model id threaded in
 * here as well; until one is deployed, adding the parameter would be guessing
 * at its shape.
 */
export function resolveActionContract(
  robotType: string,
  actionLength: number,
): ActionContract | null {
  const order = jointOrderFor(robotType);

  if (hasLegs(order)) {
    if (
      actionLength === G1_APPLE_ACTION_JOINT_NAMES.length &&
      declaresAll(order, G1_APPLE_ACTION_JOINT_NAMES)
    ) {
      return G1_APPLE_PNP_CONTRACT;
    }
    // Legged and nothing matches: refuse. Never a positional fallback here —
    // that is the whole defect. `declaresAll` is what keeps a 31-dim action off
    // a handless `g1`, whose 29 names would otherwise have to be trusted to be
    // the right 31 by count alone.
    return null;
  }

  // No joints declared (robotType 'generic'): nothing to map onto. The old
  // path warned and dropped the action here; returning null preserves that.
  if (order.length === 0) return null;

  return positionalContract(robotType, order);
}

/**
 * Joint names, in the order this embodiment's OBSERVATION vector must be built,
 * or `null` when the embodiment has no named contract and its own joint order
 * is the right answer.
 *
 * Returns the 43-dim `STATE_JOINT_NAMES` order for a G1 EDU. That differs from
 * `getJointConfig('g1_edu')` at four indices only — 32..35, left hand, index
 * and middle transposed — so the observation the policy was given was correct
 * everywhere except in the fingers of the hand doing the grasping. Reading the
 * order from here rather than from the joint config is what keeps the two
 * directions agreeing: the same four slots were wrong in both.
 */
export function resolveStateJointOrder(robotType: string): readonly string[] | null {
  // By name, not by DOF count, for the same reason `resolveActionContract` is:
  // an embodiment gets the contract order only if it actually declares all 43
  // of those joints. `g1` (29, no hands) and `h1` do not, and keep their own.
  if (!declaresAll(jointOrderFor(robotType), G1_APPLE_STATE_JOINT_NAMES)) return null;
  return G1_APPLE_STATE_JOINT_NAMES;
}

/**
 * Express an observation vector in the ACTION space of `contract`, by name.
 *
 * The rate limiter (`SkillExecutor.clipAction`) needs a previous value per
 * action slot, and on step 0 the only "previous value" that exists is where the
 * robot currently is. That arrives as a 43-dim observation in
 * `resolveStateJointOrder` order — legs first — and was being zipped
 * index-by-index against a 31-dim action in `ACTION_JOINT_NAMES` order, which
 * pairs `left_shoulder_pitch` with `left_hip_pitch`. Harmless only because
 * `MAX_DELTA_DEGREES = 5` is compared against RADIANS on this robot, so the
 * clamp is an identity over any pair a G1 can reach — except in principle:
 * `left_shoulder_pitch` [-3.089, 2.670] against `left_hip_pitch` [-2.531,
 * 2.880] spans 5.20 rad and the bound is 5. Correcting the unit without
 * correcting this seed — a one-character change that looks like an improvement
 * — would make the first commanded pose "the leg's angle, plus five degrees".
 * So the projection lands first.
 *
 * @returns one entry per action slot: the joint's current angle, or `null`
 *   where there is no comparable previous value (an `encodedSlots` index, or a
 *   joint the observation does not carry). `null` for the whole call when the
 *   projection is not possible at all — a positional contract, an embodiment
 *   with no state contract, or a state vector of the wrong width — in which
 *   case the caller keeps whatever it was doing before.
 */
export function projectStateIntoActionSpace(
  robotType: string,
  contract: ActionContract,
  state: readonly number[],
): (number | null)[] | null {
  if (contract.kind !== 'named') return null;
  const stateOrder = resolveStateJointOrder(robotType);
  if (stateOrder === null || stateOrder.length !== state.length) return null;

  const byName = new Map<string, number>();
  for (let i = 0; i < stateOrder.length; i++) byName.set(stateOrder[i]!, state[i]!);

  const encoded = new Set(contract.encodedSlots ?? []);
  return contract.names.map((name, i) => {
    if (encoded.has(i)) return null;
    const v = byName.get(name);
    return v === undefined ? null : v;
  });
}

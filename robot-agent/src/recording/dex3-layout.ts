/**
 * @file dex3-layout.ts
 * @description The joint vector a recorded episode stores, and how it is read
 *              out of a name-keyed pose. For a G1 EDU this is the 28-dim
 *              `Unitree_G1_Dex3` layout: 14 arm joints then 14 Dex3 joints.
 * @feature recording
 * @status live
 */

import type { JointConfig, RobotType } from '../robot/types.js';
import { getJointConfig } from '../robot/joint-configs/index.js';

/**
 * The 14 arm joints, in `hardware/sim_g1_dds/joints.py` order — `BODY[15:29]`.
 * Left arm first, seven joints each, shoulder outwards.
 */
export const G1_ARM_JOINTS = [
  'left_shoulder_pitch_joint',
  'left_shoulder_roll_joint',
  'left_shoulder_yaw_joint',
  'left_elbow_joint',
  'left_wrist_roll_joint',
  'left_wrist_pitch_joint',
  'left_wrist_yaw_joint',
  'right_shoulder_pitch_joint',
  'right_shoulder_roll_joint',
  'right_shoulder_yaw_joint',
  'right_elbow_joint',
  'right_wrist_roll_joint',
  'right_wrist_pitch_joint',
  'right_wrist_yaw_joint',
] as const;

/**
 * The left Dex3-1 hand, in `joints.py` `LHAND` order.
 *
 * MIDDLE COMES BEFORE INDEX ON THIS HAND AND AFTER IT ON THE OTHER. That is not
 * a transcription mistake — `joints.py:25-27` says the asymmetry comes from the
 * hardware, and index i of a Dex3 `HandCmd_` is `LHAND[i]` for that side. The
 * two lists below are therefore NOT a mirror of each other, and building one
 * from the other by swapping "left" for "right" silently relabels four columns
 * of every recorded episode. `dex3-layout.test.ts` pins both orders for exactly
 * that reason.
 *
 * Note this is a different order from `G1_EDU_JOINTS` in the joint CONFIG
 * (`robot/joint-configs/g1-edu.config.ts`), which lists index before middle on
 * both hands. The config's order drives the teleop UI; this one is the wire and
 * dataset order. Both are correct for their own job; neither may be used for
 * the other's.
 */
export const G1_LEFT_HAND_JOINTS = [
  'left_hand_thumb_0_joint',
  'left_hand_thumb_1_joint',
  'left_hand_thumb_2_joint',
  'left_hand_middle_0_joint',
  'left_hand_middle_1_joint',
  'left_hand_index_0_joint',
  'left_hand_index_1_joint',
] as const;

/** The right Dex3-1 hand, in `joints.py` `RHAND` order — index before middle. */
export const G1_RIGHT_HAND_JOINTS = [
  'right_hand_thumb_0_joint',
  'right_hand_thumb_1_joint',
  'right_hand_thumb_2_joint',
  'right_hand_index_0_joint',
  'right_hand_index_1_joint',
  'right_hand_middle_0_joint',
  'right_hand_middle_1_joint',
] as const;

/**
 * `ROBOT_CONFIGS['Unitree_G1_Dex3']` from `unitree_lerobot/utils/constants.py`:
 * 28 motors, arms then hands, `observation.state` and `action` the same width.
 * This is the shape the public Unitree G1 datasets have and the shape the
 * Pi0 / GR00T recipes expect.
 */
export const G1_DEX3_JOINTS: readonly string[] = [
  ...G1_ARM_JOINTS,
  ...G1_LEFT_HAND_JOINTS,
  ...G1_RIGHT_HAND_JOINTS,
];

/** The `robot_type` written into `meta/info.json` for that layout. */
export const G1_DEX3_ROBOT_TYPE = 'Unitree_G1_Dex3';

export interface RecordingLayout {
  /** LeRobot `robot_type`. */
  robotType: string;
  /** Ordered joint names — the `names` of `observation.state` and `action`. */
  joints: readonly string[];
}

/**
 * The layout to record a given embodiment in.
 *
 * A G1 EDU records as `Unitree_G1_Dex3`: arms and hands only. Legs and waist are
 * deliberately absent — the operator does not teleoperate them, and a column
 * that never moves is worse than an absent one because a policy will happily
 * learn to predict it.
 *
 * Anything else records every joint its config declares, under its own type
 * name. That is not a Unitree layout and does not pretend to be one.
 */
export function layoutFor(robotType: RobotType): RecordingLayout {
  if (robotType === 'g1_edu') {
    return { robotType: G1_DEX3_ROBOT_TYPE, joints: G1_DEX3_JOINTS };
  }
  const config: JointConfig[] = getJointConfig(robotType);
  return { robotType, joints: config.map((j) => j.name) };
}

export interface VectorExtraction {
  /** One value per layout joint, in layout order. */
  values: number[];
  /** Layout joints the pose did not carry, in layout order. */
  missing: string[];
}

/**
 * Read a layout vector out of a name-keyed pose.
 *
 * A joint the pose does not carry is reported in `missing` and its slot is left
 * at 0 — the caller is expected to refuse rather than to record the zero. This
 * is the same failure that made every Dex3 finger read back as "open" before
 * the sim's `/state` learned to report them: `HardwareClient.getStateNow()`
 * zero-fills silently, and a silent zero is indistinguishable from a real one.
 */
export function extractVector(
  joints: readonly string[],
  pose: Readonly<Record<string, number>>,
): VectorExtraction {
  const values: number[] = new Array(joints.length).fill(0);
  const missing: string[] = [];
  for (let i = 0; i < joints.length; i++) {
    const name = joints[i]!;
    const at = pose[name];
    if (typeof at === 'number' && Number.isFinite(at)) {
      values[i] = at;
    } else {
      missing.push(name);
    }
  }
  return { values, missing };
}

/** Which part of the G1 EDU layout a recording could actually fill (TASK-393). */
export type G1RecordingMode = 'arms+hands' | 'arms+left_hand' | 'arms+right_hand' | 'arms_only';

export interface ReducedLayout extends RecordingLayout {
  /** What the layout covers; null when it is the embodiment's full layout. */
  mode: G1RecordingMode | null;
  /** Full-layout joints left out because the robot did not report them. */
  omitted: string[];
}

/**
 * The G1 EDU layout with a missing Dex3 hand taken out, or null when that is not
 * what is wrong.
 *
 * Yesterday's session (2026-10-16) is the case this exists for: the right Dex3
 * hand published no state at all, and the recorder refused to start on 7 missing
 * joints. An arm demonstration with one hand — or none — is still a real
 * demonstration, and a refusal threw it away. What a recorder must never do is
 * store zeros for the missing hand, so the hand is LEFT OUT: the columns that
 * exist are real, the `robot_type` says which layout this is, and the episode
 * metadata names what is missing.
 *
 * Only a whole missing HAND is forgiven. A missing arm joint means the robot's
 * state is broken, not that a peripheral is unplugged, and stays a refusal; so
 * does a hand with SOME of its joints, which is a broken stream, not an absent
 * hand.
 */
export function reduceG1Layout(layout: RecordingLayout, missing: readonly string[]): ReducedLayout | null {
  if (layout.robotType !== G1_DEX3_ROBOT_TYPE || missing.length === 0) return null;
  const miss = new Set(missing);
  if (G1_ARM_JOINTS.some((j) => miss.has(j))) return null;
  const leftGone = G1_LEFT_HAND_JOINTS.every((j) => miss.has(j));
  const rightGone = G1_RIGHT_HAND_JOINTS.every((j) => miss.has(j));
  const leftPartial = !leftGone && G1_LEFT_HAND_JOINTS.some((j) => miss.has(j));
  const rightPartial = !rightGone && G1_RIGHT_HAND_JOINTS.some((j) => miss.has(j));
  if (leftPartial || rightPartial || (!leftGone && !rightGone)) return null;
  const mode: G1RecordingMode = leftGone && rightGone
    ? 'arms_only'
    : leftGone
      ? 'arms+right_hand'
      : 'arms+left_hand';
  const joints = [
    ...G1_ARM_JOINTS,
    ...(leftGone ? [] : G1_LEFT_HAND_JOINTS),
    ...(rightGone ? [] : G1_RIGHT_HAND_JOINTS),
  ];
  const suffix = mode === 'arms_only' ? 'ArmsOnly' : mode === 'arms+left_hand' ? 'LeftHand' : 'RightHand';
  return {
    robotType: `${G1_DEX3_ROBOT_TYPE}_${suffix}`,
    joints,
    mode,
    omitted: [...(leftGone ? G1_LEFT_HAND_JOINTS : []), ...(rightGone ? G1_RIGHT_HAND_JOINTS : [])],
  };
}

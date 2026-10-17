/**
 * @file forward-joints.ts
 * @description Which teleop joints may leave the agent for the sidecar
 *              (TASK-393). On a G1 that is the 14 arm joints plus the Dex3
 *              fingers of hands that report state — never a leg or the waist.
 *              Pure.
 * @feature teleop
 * @status live
 *
 * WHY THIS EXISTS. The forwarder used to post the WHOLE teleop map — 43 joints
 * on a G1 EDU, legs included — 50 times a second. Against the MuJoCo sim that
 * was harmless; against a standing robot, a leg target is a fall. The arm-only
 * sidecar (TASK-391) ignores leg keys, but a filter that only exists at the far
 * end of the wire is one refactor away from not existing at all, so the agent
 * never sends them in the first place.
 *
 * ONLY JOINTS THE OPERATOR TOUCHED. The teleop map is seeded from the 2 s
 * `/state` cache, which can be two seconds old. The sidecar seeds every joint
 * it is not told about from the MEASURED pose and holds it there, so sending a
 * joint nobody has commanded can only ever replace a fresh value with a stale
 * one. On a G1 the forwarder therefore sends what this session has actually
 * commanded and lets the sidecar hold the rest.
 */

import type { RobotType } from '../robot/types.js';
import { G1_ARM_JOINTS, G1_LEFT_HAND_JOINTS, G1_RIGHT_HAND_JOINTS } from '../recording/dex3-layout.js';

const ARM = new Set<string>(G1_ARM_JOINTS);
const LEFT_HAND = new Set<string>(G1_LEFT_HAND_JOINTS);
const RIGHT_HAND = new Set<string>(G1_RIGHT_HAND_JOINTS);

/** Whether `robotType` is a Unitree G1 (with or without Dex3 hands). */
export function isG1Family(robotType: RobotType | string): boolean {
  return robotType === 'g1' || robotType === 'g1_edu';
}

/**
 * Whether a joint may be commanded on a G1 at all: an arm joint, or a finger of
 * a hand that is present. `hands === null` means the sidecar did not say, and
 * both hands are then assumed present (the sim reports all 14 finger joints).
 */
export function isG1ForwardableJoint(
  name: string,
  hands: { left: boolean; right: boolean } | null,
): boolean {
  if (ARM.has(name)) return true;
  if (LEFT_HAND.has(name)) return hands === null || hands.left;
  if (RIGHT_HAND.has(name)) return hands === null || hands.right;
  return false;
}

/**
 * The part of a teleop pose the forwarder may send.
 *
 * - Any other embodiment: the pose unchanged (SO-101, H1 — their sidecars own
 *   their own joint sets, and nothing here knows better).
 * - A G1: arm joints and present-hand fingers that are in `touched`.
 */
export function forwardableTeleopPose(
  robotType: RobotType | string,
  pose: Readonly<Record<string, number>>,
  touched: ReadonlySet<string>,
  hands: { left: boolean; right: boolean } | null,
): Record<string, number> {
  if (!isG1Family(robotType)) return { ...pose };
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(pose)) {
    if (!touched.has(name)) continue;
    if (!isG1ForwardableJoint(name, hands)) continue;
    out[name] = value;
  }
  return out;
}

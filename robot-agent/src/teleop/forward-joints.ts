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

/** Whether `name` is one of the 14 G1 arm joints (shoulder to wrist, no fingers). */
export function isG1ArmJoint(name: string): boolean {
  return ARM.has(name);
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

/**
 * The targets a fresh arm starts from on a G1 (TASK-421): every arm joint, and
 * every finger of a hand the sidecar commands, at the pose the sidecar seeded
 * the arm from.
 *
 * WHY EVERY ARM JOINT, NOT ONLY THE TOUCHED ONES. An arm-only sidecar holds the
 * pose only while `/action` keeps arriving — 0.5 s without one is a hold, 1 s a
 * disarm. The forwarder used to send only joints the session had touched, so a
 * session whose operator had driven nothing forwardable (the keyboard's first
 * selected joint is `left_hip_pitch_joint`, a leg) armed the robot and then sent
 * NOTHING: the arms blended in for one second, the dead-man fired and they
 * blended back out, once per key press (2026-10-29, g1-edu-4). Sending the seed
 * for all 14 arm joints keeps the stream alive for as long as the agent drives,
 * and moves an arm joint only where its seed sits within the sidecar's limit
 * margin (0.05 rad) of a stop — which a resting arm does not.
 *
 * THE FINGERS ARE TARGETS, NOT TRAFFIC. The caller starts the finger targets
 * here so a finger key begins where the finger is, but must not mark them as
 * commanded: five of a Dex3 hand's seven joints have a stop at 0.0, an open
 * hand rests there, and the sidecar clamps every `/action` value to the stop
 * minus 0.05 rad — streaming an untouched open hand would flex it about three
 * degrees on every fresh arm. The arm joints alone feed the dead-man.
 *
 * `seed` is the `/arm` answer's `seed`; `measured` the agent's last joint
 * reading, used for a joint the seed does not carry (an older sidecar).
 */
export function armSeedTargets(
  seed: Readonly<Record<string, number>> | null,
  measured: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of G1_ARM_JOINTS) {
    const value = seed?.[name] ?? measured[name];
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
  }
  // Fingers only from the seed: it lists exactly the hands the sidecar commands.
  if (seed) {
    for (const name of [...G1_LEFT_HAND_JOINTS, ...G1_RIGHT_HAND_JOINTS]) {
      const value = seed[name];
      if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    }
  }
  return out;
}

/**
 * @file vrRetarget.ts
 * @description Maps Meta Quest (WebXR) controller pose + buttons onto robot arm
 *              joint targets. Orientation-based MVP retargeting (no IK): each
 *              controller's rotation drives the matching arm's shoulder/wrist,
 *              the thumbstick drives elbow + shoulder roll, and the trigger
 *              curls the wrist. Signs/scales are heuristic and tuned for the
 *              Unitree G1's 7-DOF arms — see `retargetArm`.
 * @feature robots
 */

/** A teleoperable joint as advertised by the robot agent's teleop endpoint. */
export interface VrJoint {
  name: string;
  limitLower: number;
  limitUpper: number;
  defaultPosition: number;
}

/** Joint config keyed by joint name, for O(1) lookup during the render loop. */
export type VrJointMap = Record<string, VrJoint>;

export type ArmSide = 'left' | 'right';

/** Controller orientation in radians (from a YXZ Euler of the world quaternion). */
export interface ControllerOrientation {
  /** Pitch — nose up/down (Euler.x). */
  pitch: number;
  /** Yaw — turn left/right (Euler.y). */
  yaw: number;
  /** Roll — twist (Euler.z). */
  roll: number;
}

/** Thumbstick axes, each in [-1, 1]. */
export interface ControllerAxes {
  x: number;
  y: number;
}

export function buildJointMap(joints: VrJoint[]): VrJointMap {
  const map: VrJointMap = {};
  for (const j of joints) map[j.name] = j;
  return map;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Thumbstick travel below this magnitude is treated as zero (drift rejection). */
const STICK_DEADZONE = 0.12;

/**
 * Apply a radial deadzone to a thumbstick axis and rescale the remaining travel
 * back to [-1, 1], so a resting (drifting) stick produces no motion while full
 * deflection still reaches the joint limits.
 */
function deadzone(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  const scaled = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(v) * clamp(scaled, 0, 1);
}

/** Map a normalized signal in [-1, 1] across a joint's full range. */
function toAngle(joint: VrJoint, signal: number): number {
  const mid = (joint.limitLower + joint.limitUpper) / 2;
  const half = (joint.limitUpper - joint.limitLower) / 2;
  return mid + clamp(signal, -1, 1) * half;
}

/** Normalize an angle (radians) to [-1, 1] over roughly ±90°. */
function normAngle(rad: number): number {
  return clamp(rad / (Math.PI / 2), -1, 1);
}

/**
 * Map a unipolar input in [0, 1] (e.g. an analog trigger) onto a joint such that
 * the resting value (0) sits at the joint's neutral midpoint and a full pull (1)
 * drives it to the upper limit. Used for the wrist "curl" so that merely gripping
 * the clutch doesn't snap the wrist to a hard extreme.
 */
function toAngleUnipolar(joint: VrJoint, signal: number): number {
  const mid = (joint.limitLower + joint.limitUpper) / 2;
  return mid + clamp(signal, 0, 1) * (joint.limitUpper - mid);
}

/**
 * Compute absolute target angles (radians) for one arm from a controller's
 * pose and inputs. Returns only the joints that exist in `jointMap`, so it is
 * safe across embodiments with fewer DOF.
 *
 * Mapping (per arm):
 *   controller pitch  → shoulder_pitch
 *   controller yaw    → shoulder_yaw
 *   controller roll   → wrist_roll
 *   thumbstick Y      → elbow
 *   thumbstick X      → shoulder_roll
 *   trigger (0..1)    → wrist_pitch (curl; neutral at rest, curls on pull)
 *
 * The right arm mirrors lateral signals (yaw / roll / thumbstick X) so moving
 * both controllers symmetrically produces a symmetric pose.
 */
export function retargetArm(
  side: ArmSide,
  jointMap: VrJointMap,
  orientation: ControllerOrientation,
  axes: ControllerAxes,
  trigger: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const mirror = side === 'right' ? -1 : 1;

  const set = (suffix: string, signal: number): void => {
    const joint = jointMap[`${side}_${suffix}_joint`];
    if (joint) out[joint.name] = toAngle(joint, signal);
  };

  set('shoulder_pitch', normAngle(orientation.pitch));
  set('shoulder_yaw', normAngle(orientation.yaw) * mirror);
  set('shoulder_roll', deadzone(axes.x) * mirror);
  set('elbow', deadzone(axes.y));
  set('wrist_roll', normAngle(orientation.roll) * mirror);

  // Wrist curl: unipolar trigger (0..1). At rest the wrist stays neutral; pulling
  // the trigger curls it toward the upper limit. Mapping it bipolar (2t-1) would
  // snap the wrist to a hard extreme the instant the clutch is gripped.
  const wrist = jointMap[`${side}_wrist_pitch_joint`];
  if (wrist) out[wrist.name] = toAngleUnipolar(wrist, trigger);

  return out;
}

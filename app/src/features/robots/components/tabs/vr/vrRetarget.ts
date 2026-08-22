/**
 * @file vrRetarget.ts
 * @description Maps Meta Quest (WebXR) controller pose + buttons onto robot arm
 *              joint targets. Orientation-based MVP retargeting (no IK): each
 *              controller's rotation drives the matching arm's shoulder/wrist at
 *              a FIXED gain inside a soft working range, the thumbstick drives
 *              elbow + shoulder roll over their full travel, and the trigger
 *              closes whatever end effector the robot actually advertises.
 *              Pure — no React, no three.js, no WebXR.
 * @feature robots
 */

import { STICK_DEADZONE } from './vrConstants';

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

/**
 * What one arm's retargeting produced.
 *
 * `saturated` exists so the caller can BUZZ the controller: the operator cannot
 * see the robot's end stops, and without feedback the only symptom of asking for
 * a pose the arm cannot reach is that the arm quietly stops following the hand —
 * which reads as "the link died", not as "you have run out of shoulder".
 */
export interface RetargetResult {
  /** Absolute joint targets in radians, keyed by joint name. */
  angles: Record<string, number>;
  /** Names of joints whose command was CLIPPED by their working range. */
  saturated: string[];
}

/** Which end effector the trigger will drive on this arm — see `endEffectorMode`. */
export type EndEffectorMode = 'hand' | 'gripper' | 'wrist' | 'none';

/**
 * Operator-to-robot gain for the three ORIENTATION-driven joints, in radians of
 * joint per radian of controller.
 *
 * 1.0 means the shoulder tracks the hand one-for-one: tilt the controller 30°
 * and the shoulder moves 30°. This replaces a gain that was an ACCIDENT of the
 * mechanical end stops. The old rule normalized the controller angle over ±90°
 * and then scaled it to the joint's travel, so the gain WAS the limit: on the G1
 * shoulder_pitch (-3.0892 .. +2.6704) that is 3.0892/(π/2) = 1.967 rad/rad going
 * up and 2.6704/(π/2) = 1.700 going down — a 15.7% direction-dependent
 * asymmetry that made the same wrist movement mean two different things
 * depending on which way it went.
 *
 * One named constant on purpose: this is the number to retune if the arm feels
 * sluggish (raise it) or twitchy (lower it), and it is the only one.
 */
export const ORIENTATION_GAIN = 1.0;

/**
 * SOFT working range, in radians, for each orientation-driven joint, keyed by
 * joint SUFFIX so one table covers every embodiment that names its joints
 * `<side>_<suffix>_joint`.
 *
 * The mechanical limit is the wrong target for a fixed-gain map. Forward
 * kinematics on `g1_edu.urdf` puts the left hand at its highest FORWARD pose at
 * shoulder_pitch = -1.5708 and BEHIND the robot at the mechanical -3.0892 — so
 * driving toward the end stop drives the hand back down and behind the body. The
 * old normalized map reached -1.5708 at only 45.8° of controller nose-up, which
 * means an ordinary reach-up sent the hand travelling BACKWARD and DOWN through
 * the second half of the gesture. -1.5708 .. +0.7854 is the window over which
 * the hand moves forward/up monotonically.
 *
 * These are intersected with whatever limits the robot actually advertises and
 * never widen them — see `softRange`.
 */
export const ORIENTATION_SOFT_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  // -90°..+45°: forward/up monotonic on the G1 (see above).
  shoulder_pitch: [-1.5708, 0.7854],
  // ±90°. The G1 allows ±150°, but a controller held more than a quarter-turn
  // off the wearer's own facing is not a pose anyone holds deliberately — it is
  // what a lost tracking frame or a mis-subtracted heading looks like, and at
  // 150° the hand is behind the robot's back.
  shoulder_yaw: [-1.5708, 1.5708],
  // ±90°. Human forearm pronation/supination tops out near ±85°, so this covers
  // the whole range a wrist can actually ASK for; the G1's ±113° is travel the
  // operator has no way to command and every way to reach by accident.
  wrist_roll: [-1.5708, 1.5708],
};

/**
 * Dex3-1 finger joints that FLEX (curl into the palm). Suffix as it appears
 * between `<side>_hand_` and `_joint`, from
 * `robot-agent/src/robot/joint-configs/g1-edu.config.ts`.
 *
 * All four rest at 0 and travel positive (thumb_1 0..1.5708, thumb_2 0..1.7453,
 * index_1 and middle_1 0..1.7453), so "closed" is unambiguously the joint's
 * positive limit and a trigger of 1 is a full fist.
 */
export const HAND_FLEXION_SUFFIXES = ['thumb_1', 'thumb_2', 'index_1', 'middle_1'] as const;

/**
 * Dex3-1 joints that ABDUCT (spread the fingers sideways / rotate the thumb into
 * opposition): thumb_0 (±1.0472), index_0 and middle_0 (±0.5236).
 *
 * The trigger deliberately leaves these alone. A trigger is one scalar and
 * spread is not part of a squeeze — driving it from the same axis would make
 * every grasp a pinch, and a thumb swung out of opposition cannot hold anything.
 */
export const HAND_ABDUCTION_SUFFIXES = ['thumb_0', 'index_0', 'middle_0'] as const;

/**
 * How far past a range a command must land before it counts as clipped.
 *
 * Not zero: floating point makes an exactly-at-the-stop command land a few ULP
 * over, and reporting saturation for a pose the operator is holding perfectly
 * would buzz the controller forever.
 */
const SATURATION_EPS = 1e-6;

export function buildJointMap(joints: VrJoint[]): VrJointMap {
  const map: VrJointMap = {};
  for (const j of joints) map[j.name] = j;
  return map;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Apply a radial deadzone to a thumbstick axis and rescale the remaining travel
 * back to [-1, 1], so a resting (drifting) stick produces no motion while full
 * deflection still reaches the joint limits.
 *
 * The threshold comes from `vrConstants` rather than from a local literal, and
 * that is the whole point: this file used to declare its own
 * `const STICK_DEADZONE = 0.12` while `vrDrive.ts` used the exported 0.15. Same
 * physical thumbstick, same operator, 25% different rest travel depending only
 * on whether the grip happened to be closed — and the shadowing NAME meant an
 * import in either file would silently have picked up the other number.
 */
function deadzone(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  const scaled = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(v) * clamp(scaled, 0, 1);
}

/** The joint's rest pose, forced inside its own advertised limits. */
function homeOf(joint: VrJoint): number {
  if (!Number.isFinite(joint.defaultPosition)) return 0;
  const lo = Number.isFinite(joint.limitLower) ? joint.limitLower : -Infinity;
  const hi = Number.isFinite(joint.limitUpper) ? joint.limitUpper : Infinity;
  return clamp(joint.defaultPosition, Math.min(lo, hi), Math.max(lo, hi));
}

/**
 * The range an ORIENTATION-driven joint is allowed to reach: its soft window
 * (if this suffix has one) intersected with the limits the robot advertised.
 *
 * Two rules, both load-bearing:
 *   - The intersection NEVER widens a real limit. A soft window is a comfort
 *     range for one embodiment; a robot that says its shoulder stops at 1.0 rad
 *     means it, whatever this table says.
 *   - The result is then stretched to include the joint's REST pose. Zero
 *     controller tilt must mean "the robot stands as it stands"; if a robot rests
 *     outside our comfort window, clamping the rest pose would yank the arm the
 *     instant the clutch is gripped, which is precisely the surprise the whole
 *     rest-anchored design exists to prevent.
 */
export function softRange(joint: VrJoint, suffix: string): { home: number; lo: number; hi: number } {
  const home = homeOf(joint);
  const mechLo = Number.isFinite(joint.limitLower) ? joint.limitLower : -Infinity;
  const mechHi = Number.isFinite(joint.limitUpper) ? joint.limitUpper : Infinity;
  const soft = ORIENTATION_SOFT_RANGES[suffix];
  let lo = mechLo;
  let hi = mechHi;
  if (soft) {
    lo = Math.max(soft[0], mechLo);
    hi = Math.min(soft[1], mechHi);
    // Disjoint (an embodiment whose whole travel sits outside our window): the
    // robot's own limits win. A backwards range would otherwise pin every
    // command to a single angle.
    if (!(lo <= hi)) {
      lo = mechLo;
      hi = mechHi;
    }
  }
  return { home, lo: Math.min(lo, home), hi: Math.max(hi, home) };
}

/**
 * Map a normalized signal in [-1, 1] onto a joint, anchored at its REST pose,
 * scaling each direction to that direction's own travel.
 *
 * This is the right rule for the thumbstick and the trigger — full stick travel
 * SHOULD reach the end stop, because the stick has no physical relationship to
 * the joint and its whole job is to cover the range. It is the wrong rule for
 * the orientation joints, where the operator's hand and the robot's arm are
 * meant to be the same thing; those go through `toSoftAngle` instead.
 *
 * Zero signal must mean "the robot stands as it stands" — hands at your sides
 * with the controllers level has to leave the arms where they were. Anchoring on
 * the midpoint of the limits instead made rest a pose of its own wherever a joint
 * travels further one way than the other, which on the G1 is most of the arm: the
 * elbow (-1.047..+2.094) sat 30 deg flexed at rest and the shoulder roll 19 deg
 * out.
 */
function toAngle(joint: VrJoint, signal: number): number {
  const home = homeOf(joint);
  const span = signal >= 0 ? joint.limitUpper - home : home - joint.limitLower;
  // A joint advertised without usable limits is one we refuse to drive, not one
  // we drive to infinity.
  if (!Number.isFinite(span)) return home;
  return home + signal * span;
}

/**
 * Map a controller ANGLE (radians) onto a joint at a fixed gain, clamped to the
 * joint's soft working range.
 *
 * `home + rad * gain` and nothing else: the whole point is that the gain does not
 * depend on the joint's mechanical travel. See `ORIENTATION_GAIN`.
 */
function toSoftAngle(joint: VrJoint, suffix: string, rad: number, gain: number): {
  angle: number;
  saturated: boolean;
} {
  const { home, lo, hi } = softRange(joint, suffix);
  const raw = home + rad * gain;
  const angle = clamp(raw, lo, hi);
  return { angle, saturated: Math.abs(raw - angle) > SATURATION_EPS };
}

interface EndEffectorPlan {
  mode: EndEffectorMode;
  /** Driven toward CLOSED proportionally to the trigger. */
  close: VrJoint[];
  /** Held at their rest pose while the trigger moves. */
  hold: VrJoint[];
}

/**
 * Memo for `endEffector`, keyed on the joint map itself.
 *
 * `retargetArm` calls it once per engaged arm per rendered frame — 72-120 Hz on
 * a headset — and each call built two arrays through `.map().filter()` over the
 * suffix tables. The answer is a pure function of `jointMap`, which the modal
 * already memoizes and only rebuilds when the agent re-advertises the
 * embodiment, so the recomputation was pure garbage for the mobile GPU's
 * collector to sweep. A WeakMap so a stale map is collected with the socket that
 * produced it.
 */
const endEffectorCache = new WeakMap<VrJointMap, Partial<Record<ArmSide, EndEffectorPlan>>>();

/** The joints the trigger drives on this arm, and how the caller should label it. */
function endEffector(side: ArmSide, jointMap: VrJointMap): EndEffectorPlan {
  let bySide = endEffectorCache.get(jointMap);
  const cached = bySide?.[side];
  if (cached) return cached;
  const plan = computeEndEffector(side, jointMap);
  if (!bySide) {
    bySide = {};
    endEffectorCache.set(jointMap, bySide);
  }
  bySide[side] = plan;
  return plan;
}

function computeEndEffector(side: ArmSide, jointMap: VrJointMap): EndEffectorPlan {
  const pick = (name: string): VrJoint | undefined => jointMap[name];

  // (1) A real hand, if the robot advertised one. Built from the suffix tables
  // rather than by scanning the map, so the order of the emitted joints is
  // deterministic and a hand with only some of the fingers still works.
  const close = HAND_FLEXION_SUFFIXES.map((s) => pick(`${side}_hand_${s}_joint`)).filter(
    (j): j is VrJoint => j !== undefined,
  );
  if (close.length > 0) {
    const hold = HAND_ABDUCTION_SUFFIXES.map((s) => pick(`${side}_hand_${s}_joint`)).filter(
      (j): j is VrJoint => j !== undefined,
    );
    // The spread joints are COMMANDED to rest rather than left uncommanded.
    // Omitting them leaves them wherever the last operator (or the last agent
    // plan) put them, so the same trigger pull would grasp differently between
    // sessions; commanding rest costs three numbers per frame and makes the
    // hand's pose a function of the input alone.
    return { mode: 'hand', close, hold };
  }

  // (2) A parallel gripper (SO-101 names it `gripper`, with no side prefix
  // because it only has one arm). Higher angle is MORE CLOSED on that
  // embodiment — `robot-agent/src/robot/telemetry.ts` reads 0.5 as open and 1.2
  // as closed — which is exactly the direction `toAngle(joint, trigger)` drives.
  const gripper =
    pick(`${side}_gripper_joint`) ?? pick(`${side}_gripper`) ?? pick('gripper_joint') ?? pick('gripper');
  if (gripper) return { mode: 'gripper', close: [gripper], hold: [] };

  // (3) Nothing to squeeze: fall back to curling the wrist, which is what this
  // rig did for EVERY robot before hands were wired up. Note the consequence on
  // a G1 EDU: it has a real hand, so `wrist_pitch` stops being commanded there
  // and joins `wrist_yaw` as a DOF this MVP retargeting leaves alone. Squeezing
  // to close a hand is worth more than curling a wrist, and pretending one
  // trigger can do both would mean the wrist moved every time the operator
  // grasped something.
  const wrist = pick(`${side}_wrist_pitch_joint`);
  if (wrist) return { mode: 'wrist', close: [wrist], hold: [] };

  return { mode: 'none', close: [], hold: [] };
}

/**
 * Which end effector the trigger will drive on this arm — for the UI legend, so
 * the controller-mapping card can say "Close hand" on a G1 EDU and "Wrist curl"
 * on a plain G1 instead of lying about one of them.
 */
export function endEffectorMode(side: ArmSide, jointMap: VrJointMap): EndEffectorMode {
  return endEffector(side, jointMap).mode;
}

/**
 * Compute absolute target angles (radians) for one arm from a controller's
 * pose and inputs. Returns only the joints that exist in `jointMap`, so it is
 * safe across embodiments with fewer DOF.
 *
 * Mapping (per arm):
 *   controller pitch  → shoulder_pitch (INVERTED, fixed gain, soft range)
 *   controller yaw    → shoulder_yaw   (fixed gain, soft range)
 *   controller roll   → wrist_roll     (fixed gain, soft range)
 *   thumbstick Y      → elbow          (full travel)
 *   thumbstick X      → shoulder_roll  (full travel)
 *   trigger (0..1)    → hand / gripper / wrist curl (see `endEffector`)
 *
 * `wrist_yaw` exists on the G1 (±1.61443) and is deliberately driven by NOTHING.
 * There is no third rotational axis left on the controller — pitch, yaw and roll
 * are already spoken for by the shoulder and wrist roll — and inventing a
 * mapping from a button would mean the wrist twisted on an input the operator
 * associates with something else. It stays at whatever the robot's own rest pose
 * or a previous command left it at, which is the honest answer until this rig
 * grows real IK.
 *
 * The right arm mirrors lateral signals (yaw / roll / thumbstick X) so moving
 * both controllers symmetrically produces a symmetric pose.
 *
 * `orientation.yaw` must be measured relative to the WEARER, not to the room.
 * The grip pose arrives in the XR reference space, where yaw is an absolute
 * compass bearing in the play area — turning your body on the spot then swung
 * the robot's shoulders through their whole travel while the controllers had not
 * moved in your hands at all. The caller subtracts the heading the view was last
 * recentred on; see `VrTeleopRig`.
 *
 * DEGENERATE INPUT: a signal that is not a finite number produces NO command for
 * that joint, rather than a NaN or a jump to rest. The caller's target store
 * then holds the last good value, which is the same thing releasing the clutch
 * does — one dropped tracking frame must not move the arm.
 */
export function retargetArm(
  side: ArmSide,
  jointMap: VrJointMap,
  orientation: ControllerOrientation,
  axes: ControllerAxes,
  trigger: number,
): RetargetResult {
  const angles: Record<string, number> = {};
  const saturated: string[] = [];
  const mirror = side === 'right' ? -1 : 1;

  /** Full-travel joints: thumbstick and trigger. Never reports saturation — a
   *  pegged stick reaches the end stop BY DESIGN, and buzzing for that would be
   *  a permanent rumble rather than information. */
  const setTravel = (suffix: string, signal: number): void => {
    const joint = jointMap[`${side}_${suffix}_joint`];
    if (!joint || !Number.isFinite(signal)) return;
    const angle = toAngle(joint, clamp(signal, -1, 1));
    if (Number.isFinite(angle)) angles[joint.name] = angle;
  };

  /** Orientation joints: fixed gain inside a soft range, saturation reported. */
  const setOriented = (suffix: string, rad: number): void => {
    const joint = jointMap[`${side}_${suffix}_joint`];
    if (!joint || !Number.isFinite(rad)) return;
    const r = toSoftAngle(joint, suffix, rad, ORIENTATION_GAIN);
    if (!Number.isFinite(r.angle)) return;
    angles[joint.name] = r.angle;
    if (r.saturated) saturated.push(joint.name);
  };

  // Pitch is inverted: raising the controller must raise the arm in FRONT of the
  // robot. On the G1 the shoulder pitch axis is +Y with the arm hanging down its
  // -Z, so a POSITIVE angle swings the hand backwards — forward kinematics on
  // `g1_edu.urdf` puts the left hand at x=-0.06 m for +1.0 rad and x=+0.28 m for
  // -1.0 rad. Feeding controller pitch through unchanged therefore parked both
  // arms behind the robot's back at any natural, slightly nose-up hold.
  setOriented('shoulder_pitch', -orientation.pitch);
  setOriented('shoulder_yaw', orientation.yaw * mirror);
  setOriented('wrist_roll', orientation.roll * mirror);

  setTravel('shoulder_roll', deadzone(axes.x) * mirror);
  setTravel('elbow', deadzone(axes.y));

  // Squeeze to close. Unipolar (0..1): at rest the effector sits at its own rest
  // pose; pulling the trigger drives the flexion joints toward closed. Mapping it
  // bipolar (2t-1) would snap the hand to a hard extreme the instant the clutch
  // is gripped.
  if (Number.isFinite(trigger)) {
    const t = clamp(trigger, 0, 1);
    const ee = endEffector(side, jointMap);
    for (const joint of ee.close) {
      const angle = toAngle(joint, t);
      if (Number.isFinite(angle)) angles[joint.name] = angle;
    }
    for (const joint of ee.hold) {
      const angle = homeOf(joint);
      if (Number.isFinite(angle)) angles[joint.name] = angle;
    }
  }

  return { angles, saturated };
}

/**
 * @file vrWrist.ts
 * @description Turns WebXR poses into the wrist poses and fingertip geometry the
 *              robot agent solves against. Pure arithmetic — no three, no XR
 *              objects, no state.
 * @feature robots
 *
 * THE WHOLE FRAME PROBLEM, IN ONE PLACE.
 *
 * WebXR hands out poses in the session's `local-floor` reference space: Y up,
 * −Z forward, metres, origin somewhere on the wearer's own floor. The robot
 * thinks in REP-103: +x forward, +y left, +z up, origin at its torso. Three
 * things separate them and each is handled below, in this order:
 *
 * 1. WHERE THE WEARER IS STANDING. Cancelled by subtraction: everything is
 *    measured from the HEAD, so the room, the wearer's height and wherever
 *    `VrOrigin` put the XR origin all drop out. This is the reason the rig has
 *    no calibration step and must keep not having one.
 * 2. WHICH WAY THE WEARER IS FACING. Cancelled by un-yawing by the ROBOT's
 *    commanded bearing — the same `robotHeadingRef` the orientation mapping
 *    already subtracts from the controller's yaw, for the same reason: the
 *    shoulder is bolted to the robot, not to the operator.
 * 3. AXIS NAMES. A fixed 90° change of basis, `AXIS_MAP` below.
 *
 * What is deliberately NOT here: the offset from the eye to the torso. That is
 * a fact about the robot's geometry, it is generated from the MJCF into
 * `robot-agent/src/teleop/g1-chains.generated.ts`, and a copy of it in this file
 * would be a number nothing keeps in step.
 */

/** A position and orientation as WebXR reports them. */
export interface XrRigidTransform {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

/** A pose in the robot's axes, ready for the `{wrists}` message. */
export interface RobotWristPose {
  /** Relative to the robot's eye point, metres: +x forward, +y left, +z up. */
  p: [number, number, number];
  /** Orientation in the robot's axes, (x, y, z, w). */
  q: [number, number, number, number];
  /**
   * Trigger, 0..1 — the whole hand as one grasp axis, for an operator without
   * finger tracking. Filled in by the rig, not by the transform below: it is
   * input, not geometry.
   */
  grip?: number;
}

/**
 * The change of basis from WebXR axes to the robot's, as a quaternion.
 *
 * As a matrix it is `[[0,0,-1],[-1,0,0],[0,1,0]]`: robot x is XR −z (forward),
 * robot y is XR −x (left), robot z is XR +y (up). Its determinant is +1, so it
 * is a rotation and not a mirror — which matters, because a reflection here
 * would swap the robot's hands and nothing downstream would notice.
 */
export const AXIS_MAP: readonly [number, number, number, number] = [0.5, -0.5, -0.5, 0.5];

/** Hamilton product, (x, y, z, w) throughout. */
function qMul(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qConj(q: readonly [number, number, number, number]): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate a vector by a unit quaternion. */
function qRot(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const t: [number, number, number] = [
    2 * (q[1] * v[2] - q[2] * v[1]),
    2 * (q[2] * v[0] - q[0] * v[2]),
    2 * (q[0] * v[1] - q[1] * v[0]),
  ];
  return [
    v[0] + q[3] * t[0] + q[1] * t[2] - q[2] * t[1],
    v[1] + q[3] * t[1] + q[2] * t[0] - q[0] * t[2],
    v[2] + q[3] * t[2] + q[0] * t[1] - q[1] * t[0],
  ];
}

/**
 * The rotation that undoes a bearing of `heading`, about the XR up axis.
 *
 * Same convention as `vrHeading.ts`: an object at `rotation.y = θ` looks along
 * `(-sin θ, 0, -cos θ)`, so a world direction is expressed in that object's
 * frame by rotating it by `-θ` about +Y.
 */
function unyaw(heading: number): [number, number, number, number] {
  const half = -heading / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function isFiniteTransform(t: XrRigidTransform | null | undefined): t is XrRigidTransform {
  if (!t) return false;
  const { position: p, orientation: o } = t;
  return Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.z)
    && Number.isFinite(o?.x) && Number.isFinite(o?.y) && Number.isFinite(o?.z)
    && Number.isFinite(o?.w);
}

/**
 * One controller or hand pose, expressed the way the robot agent wants it.
 *
 * Returns null rather than a partial answer for a missing or non-finite input,
 * or for a heading that has not been measured yet — an arm command built on a
 * bearing nobody knows is an arm command aimed at a frame the robot is not in.
 * The caller's contract for null is HOLD, never "use a default".
 */
export function wristToRobotFrame(
  wrist: XrRigidTransform | null | undefined,
  head: XrRigidTransform | null | undefined,
  robotHeading: number,
): RobotWristPose | null {
  if (!isFiniteTransform(wrist) || !isFiniteTransform(head)) return null;
  if (!Number.isFinite(robotHeading)) return null;

  const d: [number, number, number] = [
    wrist.position.x - head.position.x,
    wrist.position.y - head.position.y,
    wrist.position.z - head.position.z,
  ];
  const yaw = unyaw(robotHeading);
  const p = qRot(AXIS_MAP, qRot(yaw, d));

  // The orientation is a change of basis on BOTH sides: the wrist frame's own
  // axes get renamed too, or a controller rolled about its handle would come
  // out rolled about the robot's forward axis instead.
  const wq: [number, number, number, number] = [
    wrist.orientation.x, wrist.orientation.y, wrist.orientation.z, wrist.orientation.w,
  ];
  const q = qMul(qMul(AXIS_MAP, qMul(yaw, wq)), qConj(AXIS_MAP));

  return { p, q };
}

/**
 * The four fingertips DexPilot needs, in the robot's own hand frame.
 *
 * WHY THE FRAME IS BUILT FROM THE KEYPOINTS AND NOT FROM THE WRIST JOINT'S
 * ORIENTATION. WebXR gives every hand joint a full pose, and using the wrist
 * joint's would be one line. It would also bake in this file's reading of the
 * spec's axis convention for hand joints, which is exactly the kind of
 * assumption that produces a hand that is subtly, consistently rotated and that
 * no unit test written from the same assumption can catch. The palm's own
 * geometry says the same thing without anyone having to be right about a
 * convention:
 *
 * - +x runs from the wrist to the middle finger's proximal joint — along the
 *   palm, and unaffected by the fingers curling.
 * - +z runs from the middle knuckle to the index knuckle — across the palm,
 *   toward the index side, which is where the Dex3's index finger sits on BOTH
 *   hands (`index_0_link` at +0.0285 in z, `middle_0_link` at −0.0285).
 * - +y completes a right-handed frame, so it is the back of the left hand and
 *   the palm side of the right — the mirror the hardware itself has.
 *
 * The six joints are named rather than indexed. WebXR's `XRHand` is a map
 * keyed by joint name and `dex-retargeting`'s human keypoint indices
 * (0 wrist, 4 thumb tip, 9 index tip, 14 middle tip) happen to line up with the
 * spec's enum order — which is a pleasant coincidence and not something to
 * depend on when the names are right there.
 */
export interface RobotHandKeypoints {
  wrist: [number, number, number];
  thumb: [number, number, number];
  index: [number, number, number];
  middle: [number, number, number];
}

/** The `XRHand` joint names this retargeting reads. */
export const HAND_JOINT_NAMES = {
  wrist: 'wrist',
  thumbTip: 'thumb-tip',
  indexProximal: 'index-finger-phalanx-proximal',
  indexTip: 'index-finger-tip',
  middleProximal: 'middle-finger-phalanx-proximal',
  middleTip: 'middle-finger-tip',
  /** Not retargeted — read only for the stop gesture below. */
  pinkyTip: 'pinky-finger-tip',
} as const;

/**
 * How close thumb and little finger must come to count, metres.
 *
 * The STOP gesture, and it is thumb-to-PINKY on purpose. Every other pinch a
 * hand can make is work: thumb-index and thumb-middle are the two pairs
 * DexPilot retargets into a grasp, and a fist is how you hold something. The
 * little finger is the one digit the retargeting never looks at, so touching it
 * to the thumb cannot happen while the operator is picking something up.
 */
export const STOP_PINCH_M = 0.025;

/**
 * How long BOTH hands must hold it, seconds.
 *
 * Long enough not to fire on a stretch, short enough to be a stop. Both hands,
 * because one hand can make this shape while resting at the operator's side.
 */
export const STOP_HOLD_S = 0.8;

/**
 * Is this hand making the stop gesture?
 *
 * WHY THIS EXISTS. A hands-only session — the Hands toggle on and the
 * controllers put down, which is the only way the feature is worth having —
 * has no reachable stop at all: B/Y, A/X and the episode boundary are read off
 * `useXRInputSourceState('controller', …)` and every one of them is undefined,
 * the desktop STOP button is not on screen inside an immersive session, and the
 * arms follow the hands with no clutch. The operator's only recourse was to
 * take the headset off. Taking the hands out of the tracking volume does hold
 * the arm, but it latches nothing and raises no alert.
 */
export function isStopPinch(
  thumbTip: Point3 | null | undefined,
  pinkyTip: Point3 | null | undefined,
): boolean {
  if (!thumbTip || !pinkyTip) return false;
  const dx = thumbTip.x - pinkyTip.x;
  const dy = thumbTip.y - pinkyTip.y;
  const dz = thumbTip.z - pinkyTip.z;
  const d = Math.hypot(dx, dy, dz);
  return Number.isFinite(d) && d < STOP_PINCH_M;
}

type Point3 = { x: number; y: number; z: number };

/** The six tracked points `handKeypointsToRobotFrame` needs. */
export interface TrackedHandJoints {
  wrist: Point3 | null | undefined;
  thumbTip: Point3 | null | undefined;
  indexProximal: Point3 | null | undefined;
  indexTip: Point3 | null | undefined;
  middleProximal: Point3 | null | undefined;
  middleTip: Point3 | null | undefined;
}

function vsub(a: Point3, b: Point3): [number, number, number] {
  return [a.x - b.x, a.y - b.y, a.z - b.z];
}

function vnorm(v: readonly [number, number, number]): [number, number, number] | null {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-6)) return null;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function vcross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Fingertips in the hand's own frame, from tracked joint positions.
 *
 * Positions may be in any single frame — reference space, world, whatever —
 * because everything below is differences and projections onto axes built from
 * the same points. Returns null for a hand that is not tracked well enough to
 * define a frame (a degenerate palm), which the caller must treat as HOLD.
 */
export function handKeypointsToRobotFrame(
  joints: TrackedHandJoints,
): RobotHandKeypoints | null {
  const at = (j: Point3 | null | undefined): Point3 | null => {
    if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y) || !Number.isFinite(j.z)) return null;
    return j;
  };
  const wrist = at(joints.wrist);
  const thumbTip = at(joints.thumbTip);
  const indexKnuckle = at(joints.indexProximal);
  const indexTip = at(joints.indexTip);
  const middleKnuckle = at(joints.middleProximal);
  const middleTip = at(joints.middleTip);
  if (!wrist || !thumbTip || !indexKnuckle || !indexTip || !middleKnuckle || !middleTip) {
    return null;
  }

  const x = vnorm(vsub(middleKnuckle, wrist));
  if (!x) return null;
  const across = vsub(indexKnuckle, middleKnuckle);
  const y = vnorm(vcross(across, x));
  if (!y) return null;
  const z = vcross(x, y);

  const project = (p: Point3): [number, number, number] => {
    const d = vsub(p, wrist);
    return [
      d[0] * x[0] + d[1] * x[1] + d[2] * x[2],
      d[0] * y[0] + d[1] * y[1] + d[2] * y[2],
      d[0] * z[0] + d[1] * z[1] + d[2] * z[2],
    ];
  };

  return {
    wrist: [0, 0, 0],
    thumb: project(thumbTip),
    index: project(indexTip),
    middle: project(middleTip),
  };
}

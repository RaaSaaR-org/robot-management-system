/**
 * @file vrHeading.ts
 * @description Compass-bearing math for the WebXR rig: extracting the wearer's
 *              heading from a headset quaternion without the ill-conditioning
 *              that a downward gaze causes, rejecting impossible single-frame
 *              jumps, and driving the robot's body yaw as a CLOSED LOOP so
 *              clipped or deadzoned turn commands slow the turn instead of
 *              silently losing angle. Pure — no React, no three.js, no WebXR.
 * @feature robots
 */

/**
 * Anything shaped like a quaternion — `THREE.Quaternion` satisfies it
 * structurally, so the rig passes its own reused instance straight in.
 *
 * Deliberately NOT `import * as THREE`: this module does trigonometry on four
 * numbers and nothing else, and keeping three.js out of it is what lets the
 * whole heading pipeline be tested without a WebGL context.
 */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A planar drive vector in the frame it is named for: +fwd ahead, +left to port. */
export interface StickVector {
  fwd: number;
  left: number;
}

/**
 * Wrap an angle to [-π, π), so subtracting a heading never takes the long way
 * round (a controller at +170° against a heading of -170° is 20° apart, not 340°).
 */
export function wrapAngle(rad: number): number {
  return rad - 2 * Math.PI * Math.floor((rad + Math.PI) / (2 * Math.PI));
}

/**
 * Shortest horizontal forward projection we will still read a bearing off.
 *
 * The projection is |cos(pitch)| long, so 0.25 is a gaze steeper than 75.5° from
 * horizontal — well past the ~45° an operator holds while watching a G1's hands.
 * It is chosen from the NOISE, not from taste: below it, one unit of tracking
 * jitter is amplified by more than 1/0.25 = 4, and the docstring's measured 0.2°
 * of inside-out wobble becomes 0.8° of reported heading. 0.8° is still inside
 * `HEADING_DEADZONE_RAD` (2°), so it commands no turn at all; go much lower and
 * the noise alone starts driving the base.
 */
const FWD_MIN_HORIZONTAL = 0.25;

/**
 * The wearer's compass bearing from the headset's orientation, or `null` when
 * the gaze is too close to vertical to carry one.
 *
 * WHY THE FORWARD AXIS ALONE, AGAIN. This briefly took the bearing from
 * whichever of forward (-Z) and right (+X) had the LONGER horizontal projection,
 * on the theory that right stays horizontal when forward collapses. Right does
 * — but the bearing it reports is contaminated by head ROLL, and nothing
 * enforced the "no roll" the theory assumed. Measured on these exact
 * expressions, true yaw 30°: with 15° of head roll the longer-axis rule flips
 * branch at pitch −14.5° and steps 3.84° in a single frame, then drifts to 39.8°
 * by pitch −40°; at pitch −85° with 30° roll it reports 59.9°. Both the step and
 * the offset clear the 2° error deadzone and are nowhere near the 720 °/s
 * `limitHeadingStep` rejects at, so they went straight into the closed loop and
 * yawed the walking robot. Tilting your head while looking at the robot's hands
 * turned the robot.
 *
 * The forward projection, by contrast, is EXACT at every roll and every pitch
 * short of the ±90° singularity — it is the yaw factor of the YXZ decomposition,
 * which roll cannot touch. Its only defect is conditioning, and conditioning is
 * cheap to detect: below `FWD_MIN_HORIZONTAL` we return null and the caller
 * HOLDS the last good bearing. There is no roll-free bearing to fall back to at
 * a vertical gaze, and holding is strictly better than guessing — a held heading
 * commands nothing, a wrong one turns the robot.
 *
 * Convention matches `VrOrigin`: an object with rotation.y = θ looks along -Z,
 * so its bearing is atan2(forward.x, forward.z) - π = θ.
 */
export function headingFromCamera(q: QuatLike): number | null {
  const { x, y, z, w } = q;
  const len2 = x * x + y * y + z * z + w * w;
  if (!Number.isFinite(len2) || len2 < 1e-12) return null;
  // Normalize: a non-unit quaternion scales the rotation matrix, which would
  // scale the horizontal length we are about to compare against the threshold.
  const s = 1 / len2;
  // forward = R·(0,0,-1), i.e. the negated third column of the rotation matrix.
  const fwdX = -2 * s * (x * z + y * w);
  const fwdZ = -(1 - 2 * s * (x * x + y * y));

  const fwdLen = Math.hypot(fwdX, fwdZ);
  if (!Number.isFinite(fwdLen) || fwdLen < FWD_MIN_HORIZONTAL) return null;

  return wrapAngle(Math.atan2(fwdX, fwdZ) - Math.PI);
}

/**
 * Fastest single-frame head yaw we will believe, in rad/s (720 °/s).
 *
 * A human head peaks near 500-600 °/s in a fast, deliberate turn; 720 °/s is two
 * full revolutions a second, which no neck does. This is NOT a smoother — the
 * ill-conditioned-gaze noise it is often blamed for is only ~165 °/s and passes
 * straight through (`headingFromCamera` refuses to report a bearing at all at
 * that gaze, which is what removes it). It catches the other failure: a
 * tracking dropout or a recentre that teleports the reported bearing half a
 * turn between two frames, which the closed loop below would otherwise
 * faithfully drive the robot through.
 */
export const MAX_HEAD_TURN_RAD_S = (720 * Math.PI) / 180;

/**
 * Accept or reject a new heading sample. Returns the heading to keep and whether
 * the sample was thrown away.
 *
 * `prev` non-finite means "no history" — the first sample is always accepted,
 * because there is no rate to measure against it. `dt <= 0` REJECTS: no time
 * passed, so any change implies an infinite rate, and the usual cause is two
 * samples read inside one frame rather than a real movement.
 */
export function limitHeadingStep(
  prev: number,
  next: number,
  dt: number,
  maxRate: number = MAX_HEAD_TURN_RAD_S,
): { heading: number; rejected: boolean } {
  if (!Number.isFinite(next)) return { heading: prev, rejected: true };
  if (!Number.isFinite(prev)) return { heading: wrapAngle(next), rejected: false };
  if (!Number.isFinite(dt) || dt <= 0) return { heading: prev, rejected: true };
  const step = Math.abs(wrapAngle(next - prev));
  if (step / dt > maxRate) return { heading: prev, rejected: true };
  return { heading: wrapAngle(next), rejected: false };
}

/**
 * Proportional gain on the heading error, in (rad/s) per rad.
 *
 * 2 means a 45° error commands 1.57 rad/s, which the caller's `maxRate` clips to
 * the robot's configured turn speed — so the loop is saturated for any large
 * turn and behaves like a bang-bang controller, then eases off over the last
 * ~20° instead of stopping dead. Higher overshoots on a base with real inertia;
 * lower leaves the robot visibly trailing the wearer's body.
 */
export const HEADING_KP = 2;

/**
 * Heading error below which no turn is commanded, in radians (2°).
 *
 * A worn headset is never perfectly still, and a real base whose locomotion
 * controller is given a trickle of yaw forever never gets to idle. The deadzone
 * is on the ERROR, not on the rate: a rate deadzone in an open loop threw the
 * angle away permanently, so the misalignment grew without bound. On the error
 * it costs at most 2° of standing misalignment, which is below what an operator
 * can see and well inside the arm retargeting's tolerance.
 */
export const HEADING_DEADZONE_RAD = (2 * Math.PI) / 180;

export interface HeadingControllerInput {
  /** Compass bearing the wearer's body is facing, radians. */
  wearer: number;
  /** Bearing the robot has actually been COMMANDED to, radians. */
  robot: number;
  /** Seconds since the last call. */
  dt: number;
  /** Ceiling on the commanded yaw rate, rad/s. */
  maxRate: number;
  kp?: number;
  deadzone?: number;
}

export interface HeadingControllerResult {
  /** Yaw rate to command, rad/s (CCW positive). */
  omega: number;
  /** The robot's bearing after integrating what we just commanded. */
  robotHeading: number;
  /** Wrapped (wearer - robot) at the start of this step — for `rotateStick`. */
  error: number;
}

/**
 * Turn the robot toward the wearer as a CLOSED LOOP.
 *
 * The old rig differentiated the wearer's heading and sent the result as omega,
 * open loop. Every radian the 45 °/s cap clipped, the deadzone killed, or the
 * 10 Hz send interval never sampled was heading the robot could never get back:
 * a 180° body turn in 0.8 s asks for 225 °/s, of which 45 °/s is delivered, so
 * roughly 144° is left on the floor. After that "forward" on the stick walks the
 * robot 144° away from where the operator is looking AND the arm retargeting
 * subtracts the WEARER's bearing to drive a shoulder bolted to the ROBOT.
 *
 * Integrating what was actually commanded into `robotHeading` and driving the
 * remaining error means clipping only SLOWS the turn. The robot finishes the
 * 180°, three seconds later instead of one.
 *
 * The caller owns `robotHeading` (seed it from the recentre, which is the one
 * moment the two bearings are known to agree) and feeds it back each frame.
 */
export function headingController(input: HeadingControllerInput): HeadingControllerResult {
  const { wearer, robot, dt, maxRate } = input;
  const kp = input.kp ?? HEADING_KP;
  const deadzone = input.deadzone ?? HEADING_DEADZONE_RAD;
  const hold = (): HeadingControllerResult => ({
    omega: 0,
    robotHeading: Number.isFinite(robot) ? robot : 0,
    error: 0,
  });
  if (!Number.isFinite(wearer) || !Number.isFinite(robot)) return hold();
  if (!Number.isFinite(dt) || dt <= 0) return hold();
  if (!Number.isFinite(maxRate) || maxRate <= 0) return hold();

  const error = wrapAngle(wearer - robot);
  if (Math.abs(error) < deadzone) return { omega: 0, robotHeading: robot, error };
  const omega = Math.max(-maxRate, Math.min(maxRate, kp * error));
  return { omega, robotHeading: wrapAngle(robot + omega * dt), error };
}

/**
 * Express a stick vector read in the WEARER's frame in the ROBOT's frame.
 *
 * The operator pushes the stick in the direction they are looking; the base
 * takes velocities in its own body frame. While the closed loop above is still
 * catching up those two frames differ by `headingError`, and without this
 * rotation a forward push during a turn walks the robot sideways relative to
 * where the operator meant to go — which is exactly when they are least able to
 * tolerate it.
 *
 * REP-103 convention: +fwd is body +x, +left is body +y, error is CCW positive.
 */
export function rotateStick(stick: StickVector, headingError: number): StickVector {
  const { fwd, left } = stick;
  if (!Number.isFinite(fwd) || !Number.isFinite(left) || !Number.isFinite(headingError)) {
    return { fwd: 0, left: 0 };
  }
  const c = Math.cos(headingError);
  const s = Math.sin(headingError);
  return { fwd: fwd * c - left * s, left: fwd * s + left * c };
}

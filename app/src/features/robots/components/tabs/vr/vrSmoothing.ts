/**
 * @file vrSmoothing.ts
 * @description Frame-rate-independent pose smoothing for the VR teleop target
 *              store, plus the two reducers that keep that store honest:
 *              seeding it from the robot's real pose, and pruning joints whose
 *              arm has been released. Pure — no React, no three.js, no WebXR.
 * @feature robots
 */

/** Absolute joint targets in radians, keyed by joint name. */
export type JointTargets = Record<string, number>;

/**
 * Time constant of the pose filter, in seconds — the time it takes to close
 * 63% of the gap to the target.
 *
 * 0.0483 s is not a new feel: it is what the old fixed 0.25-per-frame filter
 * produced on a 72 Hz Quest, to four decimal places
 * (tau = -dt/ln(1-0.25) = -(1/72)/ln(0.75) = 0.048278, and 1 - exp(-(1/72)/0.0483)
 * = 0.24990). The point of the change is what happens when the frame rate is
 * not 72:
 *
 *   - The same headset drops to 72 Hz or climbs to 120 Hz on a thermal or
 *     battery event. Per-FRAME smoothing made tau 48 ms at 72 and 29 ms at 120,
 *     so a Quest that got warm changed the arm's responsiveness by 1.7x with no
 *     input from the operator and no way for them to know why.
 *   - One 200 ms GC stall closed only 25% of the gap, so the arm visibly lagged
 *     the hand and then lurched to catch up over the following frames.
 *
 * With `1 - exp(-dt/tau)` the SAME 200 ms stall closes 98.5% of the gap, which
 * is what "the filter has a 48 ms memory" actually means.
 */
export const POSE_TAU_S = 0.0483;

/**
 * Longest step the filter will integrate in one call, in seconds.
 *
 * A backgrounded tab or a headset put down and picked up can hand us a dt of
 * minutes. `exp(-3600/0.048)` is 0, so the maths would still be correct — but a
 * dt of Infinity or NaN is not, and clamping is cheaper than trusting the
 * caller's clock. At 0.25 s the filter has already closed 99.4% of the gap, so
 * the clamp is invisible for every dt anyone will ever see.
 */
export const MAX_SMOOTH_DT_S = 0.25;

/**
 * Move `current` toward `target` with an exponential filter of time constant
 * `tau`, over an elapsed time `dt`.
 *
 * Degenerate inputs are all defined:
 *   - `current` not finite → snap to `target`. This is the SEED case: an
 *     unseeded joint has no history to filter from, so filtering it would mean
 *     filtering from zero, which on a joint that rests at 1.2 rad is a lurch.
 *   - `target` not finite → hold `current`. One bad frame must not move the arm.
 *   - `dt <= 0` → hold `current`. No time passed.
 *   - `tau <= 0` → snap. A zero time constant is "no filter", not a divide by
 *     zero.
 */
export function smoothTowards(
  current: number,
  target: number,
  tau: number,
  dt: number,
): number {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  if (!Number.isFinite(tau) || tau <= 0) return target;
  const step = Math.min(dt, MAX_SMOOTH_DT_S);
  const alpha = 1 - Math.exp(-step / tau);
  return current + (target - current) * alpha;
}

/**
 * Fill in any target the store does not yet hold from the robot's LAST REPORTED
 * pose, for the joints named in `joints`.
 *
 * Two bugs in one:
 *   - The first frame after the first grip press wrote the target with NO
 *     filtering at all (`cur[j] === undefined ? value : filter(...)`), so the
 *     arm's first sample was an unfiltered step from wherever it happened to be
 *     to wherever the operator's hand was.
 *   - The store was never seeded from the robot's actual pose, even though the
 *     modal already holds it from the socket's `{type:'state'}` messages. So
 *     even a filtered first frame would have been filtering from the wrong
 *     place.
 *
 * Seeding from the reported pose means the filter starts where the ARM is, and
 * the first commanded motion is a smooth departure from the robot's own
 * position rather than a jump.
 *
 * A joint with no reported position is left absent on purpose: `smoothTowards`
 * snaps on a non-finite current, which is the only sensible answer when nobody
 * knows where the joint is.
 */
export function seedTargets(
  targets: JointTargets,
  robotPositions: Readonly<JointTargets>,
  joints: Iterable<string>,
): JointTargets {
  const out: JointTargets = { ...targets };
  for (const joint of joints) {
    if (Number.isFinite(out[joint])) continue;
    const reported = robotPositions[joint];
    if (Number.isFinite(reported)) out[joint] = reported;
  }
  return out;
}

/**
 * Drop every target whose joint is no longer being commanded.
 *
 * THE BUG THIS FIXES: the target store was never pruned. Release the left arm's
 * grip and its joints stayed in the store frozen at their last value — and
 * because the whole store is what gets streamed, every subsequent frame of the
 * RIGHT arm re-sent the left arm's frozen pose too. Press Home and the robot
 * homed for exactly one frame before the next right-arm tick shoved the left arm
 * back where it was. "Freeze the released arm" was supposed to mean "stop
 * commanding it", not "keep commanding it forever".
 */
export function pruneReleased(
  targets: Readonly<JointTargets>,
  engagedJoints: Iterable<string>,
): JointTargets {
  const keep = new Set(engagedJoints);
  const out: JointTargets = {};
  for (const [joint, value] of Object.entries(targets)) {
    if (keep.has(joint)) out[joint] = value;
  }
  return out;
}

export interface AdvanceTargetsInput {
  /** The store as it stands. */
  targets: Readonly<JointTargets>;
  /** What the retargeting wants this frame, keyed by joint name. */
  want: Readonly<JointTargets>;
  /** The robot's last reported pose, for seeding. */
  robotPositions: Readonly<JointTargets>;
  /** Seconds since the last frame. */
  dt: number;
  tau?: number;
}

/**
 * One frame of the target store: prune to what is engaged, seed anything new
 * from the robot's own pose, then filter toward what the operator is asking for.
 *
 * The whole per-frame update as a single pure reducer, so the ordering — prune
 * BEFORE seed, seed BEFORE filter — is stated once and tested, instead of living
 * as three statements inside a `useFrame` where nobody can see it.
 */
export function advanceTargets(input: AdvanceTargetsInput): JointTargets {
  const { targets, want, robotPositions, dt } = input;
  const tau = input.tau ?? POSE_TAU_S;
  const joints = Object.keys(want);
  const seeded = seedTargets(pruneReleased(targets, joints), robotPositions, joints);
  const out: JointTargets = {};
  for (const joint of joints) {
    out[joint] = smoothTowards(seeded[joint], want[joint], tau, dt);
  }
  return out;
}

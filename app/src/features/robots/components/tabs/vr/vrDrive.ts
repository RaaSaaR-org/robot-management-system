/**
 * @file vrDrive.ts
 * @description Thumbstick conditioning for VR base driving, and the choice of
 *              WHICH hand's stick is actually driving. Pure — no React, no
 *              three.js, no WebXR.
 * @feature robots
 */

import { STICK_DEADZONE } from './vrConstants';
import type { StickVector } from './vrHeading';

/**
 * Rescale a thumbstick axis so the deadzone is dead and the rest still reaches
 * full travel — a plain cutoff would make the stick jump to 0.15 the moment it
 * leaves the centre.
 */
export function stickAxis(v: number | undefined): number {
  const raw = v ?? 0;
  if (!Number.isFinite(raw)) return 0;
  const mag = Math.abs(raw);
  if (mag < STICK_DEADZONE) return 0;
  return Math.sign(raw) * ((mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

/**
 * Pick the stick that is actually being pushed, out of the candidates the rig
 * offers (one per hand, `null` for a hand that is absent or holding an arm).
 *
 * THE BUG THIS REPLACES: the rig wrote `driveStick(left) ?? driveStick(right)`.
 * That reads as "either stick drives", and the UI promises exactly that — but
 * `driveStick` returns null only when the controller is ABSENT or GRIPPED, so a
 * tracked, un-gripped LEFT controller sitting at rest returns a perfectly
 * truthy `{fwd: 0, left: 0}` and `??` stops there. The right stick was never
 * read at all unless the left hand happened to be squeezing an arm. Every
 * right-handed operator driving with their right thumb got nothing.
 *
 * Largest hypot wins, so pushing either stick drives and pushing both does the
 * thing the operator is leaning hardest into rather than an average of two
 * disagreeing intentions. Ties go to the first candidate, which keeps the
 * output stable frame to frame when both sticks are at rest.
 *
 * Returns null only when NO hand can drive; a resting stick still returns its
 * zero vector, because the caller needs that zero to send the one final stop
 * frame.
 */
export function pickDriveStick(
  candidates: ReadonlyArray<StickVector | null | undefined>,
): StickVector | null {
  let best: StickVector | null = null;
  let bestMag = -1;
  for (const c of candidates) {
    // A non-finite axis is bad data, not a big push: hypot would be NaN, which
    // loses every comparison and would silently win by being the only entry.
    if (!c || !Number.isFinite(c.fwd) || !Number.isFinite(c.left)) continue;
    const mag = Math.hypot(c.fwd, c.left);
    if (mag > bestMag) {
      best = c;
      bestMag = mag;
    }
  }
  return best;
}

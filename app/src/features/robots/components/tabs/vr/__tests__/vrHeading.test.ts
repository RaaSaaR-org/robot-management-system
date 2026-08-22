/**
 * @file vrHeading.test.ts
 * @description Tests for the VR heading pipeline: roll-invariant bearing
 *              extraction and the gaze at which it refuses to answer,
 *              single-frame rate rejection, the closed-loop body-yaw controller
 *              and the stick rotation that goes with it.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  wrapAngle,
  headingFromCamera,
  limitHeadingStep,
  headingController,
  rotateStick,
  HEADING_DEADZONE_RAD,
  HEADING_KP,
  MAX_HEAD_TURN_RAD_S,
} from '../vrHeading';

/** A headset pose, in the same YXZ convention the rig reads grip poses in. */
function pose(yaw: number, pitch = 0, roll = 0): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
}

/** The OLD rule: bearing from the horizontal projection of forward alone. */
function forwardOnlyHeading(q: THREE.Quaternion): number {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  f.y = 0;
  return wrapAngle(Math.atan2(f.x, f.z) - Math.PI);
}

const D2R = Math.PI / 180;

describe('wrapAngle', () => {
  it('leaves an angle already in range alone', () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(1)).toBeCloseTo(1);
  });

  it('never takes the long way round', () => {
    expect(wrapAngle(170 * D2R - -170 * D2R)).toBeCloseTo(-20 * D2R, 9);
  });

  it('wraps multiple turns', () => {
    expect(wrapAngle(5 * Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(wrapAngle(-5 * Math.PI)).toBeCloseTo(-Math.PI, 9);
  });
});

describe('headingFromCamera', () => {
  it('agrees with the rig convention for a level head', () => {
    for (const yaw of [0, 0.5, -1.2, 3.0, -3.0]) {
      expect(headingFromCamera(pose(yaw))).toBeCloseTo(wrapAngle(yaw), 9);
    }
  });

  it('is exact at the downward gaze an operator actually holds, at any head roll', () => {
    // Watching a G1's hands is ~45 deg down. The projection is cos(pitch) long,
    // so it is still 0.71 there — and it is the yaw factor of the YXZ
    // decomposition, so head roll does not move it by a bit.
    for (const roll of [0, 15 * D2R, 30 * D2R, -40 * D2R]) {
      expect(headingFromCamera(pose(0.9, -45 * D2R, roll))).toBeCloseTo(0.9, 9);
      expect(headingFromCamera(pose(0.9, -70 * D2R, roll))).toBeCloseTo(0.9, 9);
    }
  });

  it('is not fooled by head roll — the bug the two-axis rule introduced', () => {
    // Taking whichever of forward/right had the LONGER horizontal projection
    // reported 39.8 deg for a true 30 deg at pitch -40 with 15 deg of roll, and
    // 59.9 deg at pitch -85 with 30 deg of roll, because the right axis carries
    // yaw+roll rather than yaw. Every one of those samples is well outside the
    // 2 deg error deadzone, so it yawed the walking robot.
    for (const [pitch, roll] of [[-40, 15], [-40, 25], [-70, 30]] as const) {
      const h = headingFromCamera(pose(30 * D2R, pitch * D2R, roll * D2R));
      expect(Math.abs(wrapAngle(h! - 30 * D2R))).toBeLessThan(HEADING_DEADZONE_RAD);
    }
  });

  it('refuses a near-vertical gaze rather than reporting jitter as a turn', () => {
    // -85 deg: the horizontal forward vector is only cos(85) = 0.087 long, so
    // 0.2 deg of ordinary inside-out wobble came out as 2.29 deg of heading —
    // a commanded 165 deg/s turn from a head that did not move. There is no
    // roll-free bearing to fall back to at that gaze, so we report none and the
    // caller holds its last good one.
    const yaw = Math.PI / 2;
    const clean = pose(yaw, -85 * D2R);
    const jittered = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2 * D2R)
      .multiply(clean);
    const forwardError = Math.abs(
      wrapAngle(forwardOnlyHeading(jittered) - forwardOnlyHeading(clean)),
    );

    expect(forwardError).toBeGreaterThan(2 * D2R); // the 2.29 deg from the bug report
    expect(headingFromCamera(clean)).toBeNull();
    expect(headingFromCamera(jittered)).toBeNull();
    expect(headingFromCamera(pose(-2.0, -Math.PI / 2))).toBeNull();
  });

  it('still answers right up to the conditioning threshold, and jitter stays under the deadzone', () => {
    // 75.5 deg of pitch is where the projection reaches 0.25. One more degree of
    // gaze and we hold instead; at exactly this gaze the 0.2 deg wobble must
    // still land inside the 2 deg deadzone, which is what picked the threshold.
    const yaw = Math.PI / 2;
    const clean = pose(yaw, -75 * D2R);
    const jittered = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2 * D2R)
      .multiply(clean);
    const a = headingFromCamera(clean);
    const b = headingFromCamera(jittered);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(wrapAngle(b! - a!))).toBeLessThan(HEADING_DEADZONE_RAD);
  });

  it('normalizes a non-unit quaternion instead of trusting its scale', () => {
    const q = pose(1.1);
    const scaled = { x: q.x * 7, y: q.y * 7, z: q.z * 7, w: q.w * 7 };
    expect(headingFromCamera(scaled)).toBeCloseTo(1.1, 9);
  });

  it('returns null for a degenerate quaternion', () => {
    expect(headingFromCamera({ x: 0, y: 0, z: 0, w: 0 })).toBeNull();
    expect(headingFromCamera({ x: Number.NaN, y: 0, z: 0, w: 1 })).toBeNull();
    expect(headingFromCamera({ x: 0, y: 0, z: 0, w: Infinity })).toBeNull();
  });

  it('always returns a wrapped bearing', () => {
    for (const yaw of [-9, -4, 4, 9]) {
      const h = headingFromCamera(pose(yaw))!;
      expect(h).toBeGreaterThanOrEqual(-Math.PI);
      expect(h).toBeLessThan(Math.PI);
    }
  });
});

describe('limitHeadingStep', () => {
  const dt = 1 / 72;

  it('accepts the first sample, which has no rate to measure', () => {
    expect(limitHeadingStep(Number.NaN, 1.2, dt)).toEqual({ heading: 1.2, rejected: false });
  });

  it('accepts an ordinary head turn', () => {
    // 200 deg/s, well inside a human neck.
    const next = 0 + 200 * D2R * dt;
    expect(limitHeadingStep(0, next, dt).rejected).toBe(false);
  });

  it('rejects a single-frame teleport', () => {
    const r = limitHeadingStep(0, Math.PI, dt);
    expect(r.rejected).toBe(true);
    expect(r.heading).toBe(0);
  });

  it('measures the step the SHORT way round', () => {
    // +3.1 to -3.1 is 0.083 rad across the wrap, not 6.2.
    expect(limitHeadingStep(3.1, -3.1, dt).rejected).toBe(false);
  });

  it('rejects a zero or negative dt: no time passed, so any change is infinite', () => {
    expect(limitHeadingStep(0, 0.001, 0).rejected).toBe(true);
    expect(limitHeadingStep(0, 0.001, -1).rejected).toBe(true);
    expect(limitHeadingStep(0, 0.001, Number.NaN).rejected).toBe(true);
  });

  it('rejects a non-finite sample', () => {
    expect(limitHeadingStep(0.5, Number.NaN, dt)).toEqual({ heading: 0.5, rejected: true });
  });

  it('honours a caller-supplied bound', () => {
    expect(limitHeadingStep(0, 0.1, 1, 0.05).rejected).toBe(true);
    expect(limitHeadingStep(0, 0.1, 1, 0.5).rejected).toBe(false);
  });

  it('lets the ill-conditioned-gaze noise through — that is not its job', () => {
    // 165 deg/s, the figure from the bug report. `headingFromCamera` refusing
    // to answer at that gaze is what removes it; this limiter only catches
    // impossible jumps.
    expect(165 * D2R).toBeLessThan(MAX_HEAD_TURN_RAD_S);
  });
});

describe('headingController', () => {
  const maxRate = 45 * D2R;

  it('commands nothing when the robot is already facing the wearer', () => {
    const r = headingController({ wearer: 1.0, robot: 1.0, dt: 0.1, maxRate });
    expect(r.omega).toBe(0);
    expect(r.robotHeading).toBe(1.0);
  });

  it('deadzones a sub-2-degree error so the base can idle', () => {
    const r = headingController({ wearer: 1 * D2R, robot: 0, dt: 0.1, maxRate });
    expect(r.omega).toBe(0);
    expect(r.robotHeading).toBe(0);
    expect(Math.abs(r.error)).toBeLessThan(HEADING_DEADZONE_RAD);
  });

  it('applies KP below saturation', () => {
    const error = 0.2;
    const r = headingController({ wearer: error, robot: 0, dt: 0.01, maxRate: 10 });
    expect(r.omega).toBeCloseTo(HEADING_KP * error, 12);
  });

  it('clips to maxRate on a large error', () => {
    const r = headingController({ wearer: Math.PI / 2, robot: 0, dt: 0.01, maxRate });
    expect(r.omega).toBeCloseTo(maxRate, 12);
    expect(r.robotHeading).toBeCloseTo(maxRate * 0.01, 12);
  });

  it('turns the short way across the wrap', () => {
    const r = headingController({ wearer: -3.0, robot: 3.0, dt: 0.01, maxRate });
    expect(r.omega).toBeGreaterThan(0); // 0.283 rad CCW, not 6.0 rad CW
  });

  it('integrates only what it COMMANDED, so clipping slows the turn instead of losing it', () => {
    // The bug: an open-loop differentiated heading asked for 225 deg/s to do
    // 180 deg in 0.8 s, delivered 45, and threw the other 180 away — leaving the
    // robot ~144 deg off with no mechanism to ever recover it.
    let robot = 0;
    const wearer = Math.PI; // the wearer turned 180 deg, instantly
    const dt = 1 / 72;
    let commanded = 0;
    for (let i = 0; i < 72 * 10; i += 1) {
      const r = headingController({ wearer, robot, dt, maxRate });
      commanded += Math.abs(r.omega) * dt;
      robot = r.robotHeading;
    }
    expect(Math.abs(wrapAngle(wearer - robot))).toBeLessThan(HEADING_DEADZONE_RAD);
    // Every radian of the turn was actually commanded — none of it evaporated.
    expect(commanded).toBeGreaterThan(Math.PI - HEADING_DEADZONE_RAD);
  });

  it('follows a wearer who is still turning', () => {
    let robot = 0;
    let wearer = 0;
    const dt = 1 / 72;
    // 0.8 s of body turn at 225 deg/s, then stand still.
    for (let i = 0; i < 72 * 8; i += 1) {
      if (i < 72 * 0.8) wearer = wrapAngle(wearer + 225 * D2R * dt);
      robot = headingController({ wearer, robot, dt, maxRate }).robotHeading;
    }
    expect(Math.abs(wrapAngle(wearer - robot))).toBeLessThan(HEADING_DEADZONE_RAD);
  });

  it('never commands faster than maxRate at any point of a large turn', () => {
    let robot = 0;
    for (let i = 0; i < 500; i += 1) {
      const r = headingController({ wearer: Math.PI, robot, dt: 1 / 72, maxRate });
      expect(Math.abs(r.omega)).toBeLessThanOrEqual(maxRate + 1e-12);
      robot = r.robotHeading;
    }
  });

  it('holds on degenerate input rather than commanding a NaN at a robot', () => {
    for (const bad of [
      { wearer: Number.NaN, robot: 0.3, dt: 0.01, maxRate },
      { wearer: 0.3, robot: Number.NaN, dt: 0.01, maxRate },
      { wearer: 1, robot: 0.3, dt: 0, maxRate },
      { wearer: 1, robot: 0.3, dt: -0.01, maxRate },
      { wearer: 1, robot: 0.3, dt: Number.NaN, maxRate },
      { wearer: 1, robot: 0.3, dt: 0.01, maxRate: 0 },
      { wearer: 1, robot: 0.3, dt: 0.01, maxRate: Number.NaN },
    ]) {
      const r = headingController(bad);
      expect(r.omega).toBe(0);
      expect(Number.isFinite(r.robotHeading)).toBe(true);
    }
    expect(headingController({ wearer: 1, robot: Number.NaN, dt: 0.01, maxRate }).robotHeading).toBe(0);
  });

  it('keeps the robot heading wrapped so it never drifts out of range', () => {
    let robot = 0;
    for (let i = 0; i < 2000; i += 1) {
      robot = headingController({ wearer: 3.0, robot, dt: 1 / 72, maxRate }).robotHeading;
      robot = headingController({ wearer: -3.0, robot, dt: 1 / 72, maxRate }).robotHeading;
      expect(robot).toBeGreaterThanOrEqual(-Math.PI);
      expect(robot).toBeLessThan(Math.PI);
    }
  });
});

describe('rotateStick', () => {
  it('is the identity when the robot is already aligned', () => {
    expect(rotateStick({ fwd: 0.7, left: -0.2 }, 0)).toEqual({ fwd: 0.7, left: -0.2 });
  });

  it('rotates forward into the robot frame while it is catching up', () => {
    // The wearer is 90 deg CCW of the robot, so their "forward" is the robot's left.
    const r = rotateStick({ fwd: 1, left: 0 }, Math.PI / 2);
    expect(r.fwd).toBeCloseTo(0, 12);
    expect(r.left).toBeCloseTo(1, 12);
  });

  it('rotates the other way for a negative error', () => {
    const r = rotateStick({ fwd: 1, left: 0 }, -Math.PI / 2);
    expect(r.fwd).toBeCloseTo(0, 12);
    expect(r.left).toBeCloseTo(-1, 12);
  });

  it('preserves magnitude', () => {
    for (const e of [0.1, 1, -2.5, 3]) {
      const r = rotateStick({ fwd: 0.6, left: 0.8 }, e);
      expect(Math.hypot(r.fwd, r.left)).toBeCloseTo(1, 12);
    }
  });

  it('returns a standstill for degenerate input rather than a NaN velocity', () => {
    expect(rotateStick({ fwd: Number.NaN, left: 0 }, 0)).toEqual({ fwd: 0, left: 0 });
    expect(rotateStick({ fwd: 1, left: Number.NaN }, 0)).toEqual({ fwd: 0, left: 0 });
    expect(rotateStick({ fwd: 1, left: 0 }, Number.NaN)).toEqual({ fwd: 0, left: 0 });
  });
});

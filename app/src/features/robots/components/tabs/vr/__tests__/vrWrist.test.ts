/**
 * @file vrWrist.test.ts
 * @description Tests for the WebXR -> robot frame arithmetic: the axis map and
 *              the proof it is a rotation rather than a mirror, the head
 *              subtraction that keeps the rig calibration-free, the un-yaw by
 *              the ROBOT's bearing, and the palm frame built from hand
 *              keypoints rather than from a spec convention.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  AXIS_MAP,
  isStopPinch,
  STOP_PINCH_M,
  wristToRobotFrame,
  handKeypointsToRobotFrame,
  type XrRigidTransform,
  type TrackedHandJoints,
} from '../vrWrist';

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function xf(position: Vec3, orientation: Quat = IDENTITY): XrRigidTransform {
  return { position, orientation };
}

/**
 * A rotation of `rad` about `axis`, in the (x, y, z, w) shape WebXR reports.
 *
 * Built with three.js rather than with the module's own (unexported) quaternion
 * helpers on purpose: a test that multiplies quaternions the same way the code
 * under test does agrees with it even when both are wrong.
 */
function turn(axis: readonly [number, number, number], rad: number): Quat {
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(),
    rad,
  );
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function expectClose(
  actual: readonly number[] | undefined,
  expected: readonly number[],
  digits = 9,
): void {
  expect(actual).toBeDefined();
  expect(actual).toHaveLength(expected.length);
  expected.forEach((want, i) => expect(actual![i]).toBeCloseTo(want, digits));
}

/**
 * Two quaternions are the SAME rotation when they agree up to sign — q and -q
 * name one orientation. Asserted component-wise, an un-yaw that happens to come
 * out negated (any heading near a full turn does this) reads as a 180 deg error
 * that is not there.
 */
function expectSameRotation(
  actual: readonly [number, number, number, number],
  expected: readonly [number, number, number, number],
  digits = 9,
): void {
  const dot = actual[0] * expected[0] + actual[1] * expected[1]
    + actual[2] * expected[2] + actual[3] * expected[3];
  expect(Math.abs(dot)).toBeCloseTo(1, digits);
}

const SQRT_HALF = Math.SQRT1_2;

describe('AXIS_MAP', () => {
  it('renames the axes the way the docstring says: robot x is XR -z, y is XR -x, z is XR +y', () => {
    const q = new THREE.Quaternion(AXIS_MAP[0], AXIS_MAP[1], AXIS_MAP[2], AXIS_MAP[3]);
    const col = (v: readonly [number, number, number]): THREE.Vector3 =>
      new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q);

    // Columns of [[0,0,-1],[-1,0,0],[0,1,0]].
    expectClose(col([1, 0, 0]).toArray(), [0, -1, 0]);
    expectClose(col([0, 1, 0]).toArray(), [0, 0, 1]);
    expectClose(col([0, 0, 1]).toArray(), [-1, 0, 0]);
  });

  it('is a proper rotation — a reflection here would swap the robot hands unnoticed', () => {
    // det = c0 . (c1 x c2) over the rotated basis vectors. A mirrored basis
    // gives -1, mapping the operator's left hand onto the robot's right, and
    // every downstream stage (IK, safety, the HUD) would accept it silently.
    const q = new THREE.Quaternion(AXIS_MAP[0], AXIS_MAP[1], AXIS_MAP[2], AXIS_MAP[3]);
    const c0 = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const c1 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const c2 = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const det = c0.dot(new THREE.Vector3().crossVectors(c1, c2));
    expect(det).toBeCloseTo(1, 12);
  });

  it('is a unit quaternion, so the conjugation below is a rotation and not a scaling', () => {
    expect(Math.hypot(...AXIS_MAP)).toBeCloseTo(1, 12);
  });
});

describe('wristToRobotFrame — position', () => {
  it('maps forward, left and up onto robot +x, +y, +z', () => {
    const at = (p: Vec3): number[] => wristToRobotFrame(xf(p), xf(ORIGIN), 0)!.p;

    // WebXR: -Z is where the wearer is looking, -X is their left, +Y is up.
    expectClose(at({ x: 0, y: 0, z: -1 }), [1, 0, 0]);
    expectClose(at({ x: -1, y: 0, z: 0 }), [0, 1, 0]);
    expectClose(at({ x: 0, y: 1, z: 0 }), [0, 0, 1]);
  });

  it('measures from the HEAD, so the room and the wearer height drop out', () => {
    // This is the property that lets the rig have no calibration step: shift the
    // wearer (or move where VrOrigin put the XR origin) and nothing moves.
    const wrist = { x: 0.25, y: -0.15, z: -0.55 };
    const head = { x: 0, y: 1.6, z: 0 };
    const base = wristToRobotFrame(xf(wrist), xf(head), 0.9)!;

    const shift = { x: 3.7, y: 1.2, z: -0.4 };
    const moved = wristToRobotFrame(
      xf({ x: wrist.x + shift.x, y: wrist.y + shift.y, z: wrist.z + shift.z }),
      xf({ x: head.x + shift.x, y: head.y + shift.y, z: head.z + shift.z }),
      0.9,
    )!;

    expectClose(moved.p, base.p);
    expectClose(moved.q, base.q);
  });

  it('ignores the head ORIENTATION — the shoulder is bolted to the robot, not the neck', () => {
    const wrist = xf({ x: 0.2, y: -0.1, z: -0.4 }, turn([1, 1, 0], 0.6));
    const head = { x: 0.1, y: 1.55, z: -0.05 };
    const looking = wristToRobotFrame(wrist, xf(head, turn([0, 1, 0], 1.1)), 0.3)!;
    const level = wristToRobotFrame(wrist, xf(head, IDENTITY), 0.3)!;

    expectClose(looking.p, level.p);
    expectClose(looking.q, level.q);
  });

  it('un-yaws by the robot bearing: a controller straight ahead sits to the robot RIGHT at +pi/2', () => {
    // A heading of +pi/2 points the robot along XR (-1, 0, 0), so its own +y
    // (left) is XR +z. The controller at XR -Z is one metre down that axis in
    // the negative direction, and nothing in front of the robot at all.
    const p = wristToRobotFrame(xf({ x: 0, y: 0, z: -1 }), xf(ORIGIN), Math.PI / 2)!.p;
    expectClose(p, [0, -1, 0]);
  });

  it('un-yawing equals rotating the world offset by -heading about XR +Y', () => {
    const head = { x: 0.3, y: 1.6, z: -0.2 };
    const wrist = { x: 0.55, y: 1.45, z: -0.75 };
    for (const heading of [0.4, -1.25, Math.PI / 2, 2.9, -3.0]) {
      const d = new THREE.Vector3(wrist.x - head.x, wrist.y - head.y, wrist.z - head.z);
      const preRotated = d
        .clone()
        .applyQuaternion(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading),
        );

      const viaHeading = wristToRobotFrame(xf(wrist), xf(head), heading)!;
      const viaRotation = wristToRobotFrame(
        xf({ x: preRotated.x, y: preRotated.y, z: preRotated.z }),
        xf(ORIGIN),
        0,
      )!;
      expectClose(viaHeading.p, viaRotation.p);
    }
  });

  it('treats a heading of 2pi as a heading of 0', () => {
    const wrist = xf({ x: 0.2, y: -0.1, z: -0.6 }, turn([0, 1, 0], 0.8));
    const zero = wristToRobotFrame(wrist, xf(ORIGIN), 0)!;
    const full = wristToRobotFrame(wrist, xf(ORIGIN), 2 * Math.PI)!;
    expectClose(full.p, zero.p);
    // Components, not just the rotation: the un-yaw of a full turn is -identity,
    // so `full.q` is the exact negation of `zero.q`. Same orientation, and the
    // position is bit-identical either way — but anyone who SLERPs or lerps
    // consecutive wrist targets must pick the near sign first, and a heading
    // wrapping through +-pi flips it mid-motion.
    expectSameRotation(full.q, zero.q);
  });
});

describe('wristToRobotFrame — orientation', () => {
  it('passes an identity controller pose through as identity', () => {
    // The G1 needs no grip-to-palm correction constant precisely because this
    // is true: its palm frame at q = 0 IS its torso frame, so a controller held
    // level and pointing where the wearer looks is already the answer. A
    // non-identity result here means someone has folded a fudge factor in.
    const q = wristToRobotFrame(xf(ORIGIN, IDENTITY), xf(ORIGIN), 0)!.q;
    expectClose(q, [0, 0, 0, 1]);
  });

  it('turns a yaw about XR +Y into a yaw about robot +z', () => {
    const q = wristToRobotFrame(xf(ORIGIN, turn([0, 1, 0], Math.PI / 2)), xf(ORIGIN), 0)!.q;
    expectClose(q, [0, 0, SQRT_HALF, SQRT_HALF]);
  });

  it('turns a roll about the direction the controller points into a roll about robot +x', () => {
    // XR -Z is where the controller points; robot +x is where the wrist points.
    // Rolling the handle must roll the robot wrist, not bend it — this is the
    // half of the change of basis that has to be applied on BOTH sides.
    const angle = Math.PI / 6;
    const q = wristToRobotFrame(xf(ORIGIN, turn([0, 0, -1], angle)), xf(ORIGIN), 0)!.q;
    expectClose(q, [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]);
  });

  it('subtracts the robot bearing from the controller yaw', () => {
    // The operator turns their body 40 deg and the robot follows: the arm has
    // not moved relative to the robot, so the commanded wrist must not move.
    const heading = 0.7;
    const q = wristToRobotFrame(xf(ORIGIN, turn([0, 1, 0], heading)), xf(ORIGIN), heading)!.q;
    expectClose(q, [0, 0, 0, 1]);
  });

  it('renames the rotation axis and leaves the angle alone, for any axis', () => {
    // The general statement of the two cases above: a change of basis by
    // conjugation sends a turn about `a` to the same-sized turn about AXIS_MAP
    // applied to `a`. An axis map that had stopped being orthonormal would move
    // the angle, and the wrist would arrive bent rather than turned.
    const map = new THREE.Quaternion(AXIS_MAP[0], AXIS_MAP[1], AXIS_MAP[2], AXIS_MAP[3]);
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.7, 0.2]] as const) {
      for (const angle of [0.2, 1.4, 2.8]) {
        const q = wristToRobotFrame(xf(ORIGIN, turn(axis, angle)), xf(ORIGIN), 0)!.q;
        const wantAxis = new THREE.Vector3(axis[0], axis[1], axis[2])
          .normalize()
          .applyQuaternion(map);
        const want = new THREE.Quaternion().setFromAxisAngle(wantAxis, angle);
        expectSameRotation(q, [want.x, want.y, want.z, want.w]);
      }
    }
  });

  it('returns a unit quaternion for every unit input', () => {
    // The wrist target is fed straight into IK; a non-unit quaternion there is
    // a scaled rotation matrix and the solver has no way to notice.
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [-0.4, 0.9, 0.2]] as const;
    for (const axis of axes) {
      for (const angle of [0, 0.3, 1.9, -2.7, Math.PI]) {
        for (const heading of [0, 1.2, -2.4, 5.9]) {
          const q = wristToRobotFrame(
            xf({ x: 0.1, y: -0.2, z: -0.5 }, turn(axis, angle)),
            xf({ x: 0, y: 1.6, z: 0 }),
            heading,
          )!.q;
          expect(Math.hypot(...q)).toBeCloseTo(1, 9);
        }
      }
    }
  });
});

describe('wristToRobotFrame — refusing to answer', () => {
  // Every null below is a HOLD at the caller. A partial answer would be an arm
  // command expressed in a frame the robot is not in.
  const head = xf({ x: 0, y: 1.6, z: 0 });
  const wrist = xf({ x: 0.2, y: 1.4, z: -0.5 });

  it('returns null for a missing wrist or head', () => {
    expect(wristToRobotFrame(null, head, 0)).toBeNull();
    expect(wristToRobotFrame(undefined, head, 0)).toBeNull();
    expect(wristToRobotFrame(wrist, null, 0)).toBeNull();
    expect(wristToRobotFrame(wrist, undefined, 0)).toBeNull();
  });

  it('returns null for a NaN in any component of either pose', () => {
    const fields = ['x', 'y', 'z'] as const;
    for (const f of fields) {
      expect(wristToRobotFrame(
        xf({ ...wrist.position, [f]: Number.NaN }), head, 0,
      )).toBeNull();
      expect(wristToRobotFrame(
        wrist, xf({ ...head.position, [f]: Number.NaN }), 0,
      )).toBeNull();
    }
    for (const f of ['x', 'y', 'z', 'w'] as const) {
      expect(wristToRobotFrame(
        xf(wrist.position, { ...IDENTITY, [f]: Number.NaN }), head, 0,
      )).toBeNull();
      expect(wristToRobotFrame(
        wrist, xf(head.position, { ...IDENTITY, [f]: Number.NaN }), 0,
      )).toBeNull();
    }
  });

  it('returns null for an infinite component', () => {
    expect(wristToRobotFrame(
      xf({ ...wrist.position, z: Number.POSITIVE_INFINITY }), head, 0,
    )).toBeNull();
  });

  it('returns null for a heading nobody has measured yet', () => {
    for (const heading of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(wristToRobotFrame(wrist, head, heading)).toBeNull();
    }
  });
});

/**
 * A flat hand in an arbitrary raw frame: the palm runs along -Z, the index side
 * is +X. Which frame it is stated in is exactly what the module must not care
 * about, so the numbers here carry no meaning beyond their geometry.
 */
const FLAT_HAND: Record<keyof TrackedHandJoints, Vec3> = {
  wrist: { x: 0, y: 0, z: 0 },
  middleProximal: { x: 0, y: 0, z: -0.09 },
  indexProximal: { x: 0.02, y: 0, z: -0.095 },
  middleTip: { x: 0, y: 0, z: -0.17 },
  indexTip: { x: 0.02, y: 0, z: -0.16 },
  thumbTip: { x: 0.045, y: 0, z: -0.06 },
};

describe('handKeypointsToRobotFrame', () => {
  it('puts the wrist at the origin and the fingers out along +x', () => {
    const k = handKeypointsToRobotFrame(FLAT_HAND)!;
    expect(k).not.toBeNull();
    expectClose(k.wrist, [0, 0, 0]);

    for (const tip of [k.thumb, k.index, k.middle]) expect(tip[0]).toBeGreaterThan(0);

    // +x is wrist -> middle knuckle, so the middle finger of a flat hand lies on
    // it exactly; the index sits one knuckle spacing to the +z side.
    expectClose(k.middle, [0.17, 0, 0]);
    expectClose(k.index, [0.16, 0, 0.02]);
  });

  it('puts the index on the +z side of the middle — the Dex3 index sits there on BOTH hands', () => {
    const k = handKeypointsToRobotFrame(FLAT_HAND)!;
    expect(k.index[2]).toBeGreaterThan(k.middle[2]);
  });

  it('is an isometry — projecting onto the palm axes must not stretch the hand', () => {
    const k = handKeypointsToRobotFrame(FLAT_HAND)!;
    const raw = (p: Vec3): number => Math.hypot(p.x, p.y, p.z); // wrist is at 0
    expect(Math.hypot(...k.thumb)).toBeCloseTo(raw(FLAT_HAND.thumbTip), 9);
    expect(Math.hypot(...k.index)).toBeCloseTo(raw(FLAT_HAND.indexTip), 9);
    expect(Math.hypot(...k.middle)).toBeCloseTo(raw(FLAT_HAND.middleTip), 9);
  });

  it('is unchanged by a rigid transform of the whole hand', () => {
    // The reason the frame is built from the keypoints instead of read off the
    // wrist joint's orientation: this holds whatever axis convention WebXR
    // reports hand joints in, so no one has to be right about the spec.
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, -1.3, 2.1, 'XYZ'));
    const shift = new THREE.Vector3(3.7, -1.2, 0.4);
    const move = (p: Vec3): Vec3 => {
      const v = new THREE.Vector3(p.x, p.y, p.z).applyQuaternion(rot).add(shift);
      return { x: v.x, y: v.y, z: v.z };
    };
    const moved: TrackedHandJoints = {
      wrist: move(FLAT_HAND.wrist),
      thumbTip: move(FLAT_HAND.thumbTip),
      indexProximal: move(FLAT_HAND.indexProximal),
      indexTip: move(FLAT_HAND.indexTip),
      middleProximal: move(FLAT_HAND.middleProximal),
      middleTip: move(FLAT_HAND.middleTip),
    };

    const base = handKeypointsToRobotFrame(FLAT_HAND)!;
    const after = handKeypointsToRobotFrame(moved)!;
    expectClose(after.wrist, base.wrist);
    expectClose(after.thumb, base.thumb);
    expectClose(after.index, base.index);
    expectClose(after.middle, base.middle);
  });

  it('returns null for a joint the tracker did not report', () => {
    for (const missing of Object.keys(FLAT_HAND) as (keyof TrackedHandJoints)[]) {
      expect(handKeypointsToRobotFrame({ ...FLAT_HAND, [missing]: null })).toBeNull();
      expect(handKeypointsToRobotFrame({ ...FLAT_HAND, [missing]: undefined })).toBeNull();
    }
  });

  it('returns null for a NaN joint', () => {
    for (const bad of Object.keys(FLAT_HAND) as (keyof TrackedHandJoints)[]) {
      expect(handKeypointsToRobotFrame({
        ...FLAT_HAND,
        [bad]: { ...FLAT_HAND[bad], y: Number.NaN },
      })).toBeNull();
    }
  });

  it('returns null for a degenerate palm rather than a frame built on noise', () => {
    // Wrist on top of the middle knuckle: there is no palm direction, and
    // normalizing the zero vector would hand the caller an arbitrary rotation.
    expect(handKeypointsToRobotFrame({
      ...FLAT_HAND,
      middleProximal: { ...FLAT_HAND.wrist },
    })).toBeNull();

    // Index knuckle collinear with the palm axis: no across-the-palm direction,
    // so the second axis is undefined too.
    expect(handKeypointsToRobotFrame({
      ...FLAT_HAND,
      indexProximal: { x: 0, y: 0, z: -0.12 },
    })).toBeNull();
  });
});

describe('the hands-only stop gesture', () => {
  const at = (x: number, y: number, z: number) => ({ x, y, z });

  it('fires on thumb to little finger, and not on the pinches that are work', () => {
    // Thumb-index and thumb-middle are the two pairs DexPilot retargets into a
    // grasp; the little finger is the one digit the retargeting never reads,
    // which is the whole reason the stop is bound to it. A gesture that also
    // means "pick that up" is not a stop.
    expect(isStopPinch(at(0, 0, 0), at(0.01, 0, 0))).toBe(true);
    expect(isStopPinch(at(0, 0, 0), at(0, 0, STOP_PINCH_M * 0.9))).toBe(true);
    expect(isStopPinch(at(0, 0, 0), at(0, 0, STOP_PINCH_M * 1.1))).toBe(false);
    // An open hand: the little finger is a hand's width away.
    expect(isStopPinch(at(0.098, 0.022, 0.058), at(0.16, 0, -0.05))).toBe(false);
  });

  it('is false rather than true when a joint is missing', () => {
    // It gates a stop, so an absent joint must not fire one — but note the
    // failure direction is deliberate in BOTH senses: a hand that stops being
    // tracked also stops driving the arm, so refusing to fire here does not
    // leave the robot running on an untracked hand.
    expect(isStopPinch(null, at(0, 0, 0))).toBe(false);
    expect(isStopPinch(at(0, 0, 0), undefined)).toBe(false);
    expect(isStopPinch(at(Number.NaN, 0, 0), at(0, 0, 0))).toBe(false);
  });
});

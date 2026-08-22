/**
 * @file vrRetarget.test.ts
 * @description Tests for the WebXR controller -> robot arm retargeting math
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  buildJointMap,
  endEffectorMode,
  retargetArm,
  softRange,
  ORIENTATION_GAIN,
  ORIENTATION_SOFT_RANGES,
  HAND_FLEXION_SUFFIXES,
  HAND_ABDUCTION_SUFFIXES,
  type VrJoint,
  type ControllerOrientation,
  type ControllerAxes,
} from '../vrRetarget';
import { STICK_DEADZONE } from '../vrConstants';

/**
 * The fraction of a joint's travel a raw stick reading commands.
 *
 * Derived, not written out: the deadzone used to be a second literal declared
 * privately inside `vrRetarget` (0.12) while `vrDrive` used the exported one
 * (0.15), for the same physical thumbstick. Spelling the number into an
 * assertion is how the two drifted apart in the first place.
 */
function travel(raw: number): number {
  const a = Math.abs(raw);
  if (a < STICK_DEADZONE) return 0;
  return Math.sign(raw) * ((a - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

// A symmetric ±90° (π/2) joint: mid = 0, half = π/2.
function symJoint(name: string): VrJoint {
  return { name, limitLower: -Math.PI / 2, limitUpper: Math.PI / 2, defaultPosition: 0 };
}

/** Build a full 6-joint arm for the given side using symmetric ±π/2 joints. */
function fullArm(side: 'left' | 'right'): VrJoint[] {
  return [
    `${side}_shoulder_pitch_joint`,
    `${side}_shoulder_yaw_joint`,
    `${side}_shoulder_roll_joint`,
    `${side}_elbow_joint`,
    `${side}_wrist_roll_joint`,
    `${side}_wrist_pitch_joint`,
  ].map(symJoint);
}

/**
 * The REAL G1 shoulder pitch, from
 * `robot-agent/src/robot/joint-configs/g1.config.ts`. Its travel is wildly
 * asymmetric, which is the whole reason the old normalized map was broken.
 */
function g1ShoulderPitch(side: 'left' | 'right'): VrJoint {
  return {
    name: `${side}_shoulder_pitch_joint`,
    limitLower: -3.0892,
    limitUpper: 2.6704,
    defaultPosition: 0,
  };
}

/** The Dex3-1 hand, exactly as `g1-edu.config.ts` advertises it. */
function dex3Hand(side: 'left' | 'right'): VrJoint[] {
  const p = `${side}_hand`;
  return [
    { name: `${p}_thumb_0_joint`, limitLower: -1.0472, limitUpper: 1.0472, defaultPosition: 0 },
    { name: `${p}_thumb_1_joint`, limitLower: 0, limitUpper: 1.5708, defaultPosition: 0 },
    { name: `${p}_thumb_2_joint`, limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
    { name: `${p}_index_0_joint`, limitLower: -0.5236, limitUpper: 0.5236, defaultPosition: 0 },
    { name: `${p}_index_1_joint`, limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
    { name: `${p}_middle_0_joint`, limitLower: -0.5236, limitUpper: 0.5236, defaultPosition: 0 },
    { name: `${p}_middle_1_joint`, limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
  ];
}

const ZERO_ORIENT: ControllerOrientation = { pitch: 0, yaw: 0, roll: 0 };
const ZERO_AXES: ControllerAxes = { x: 0, y: 0 };

describe('buildJointMap', () => {
  it('maps joints by name for O(1) lookup', () => {
    const joints = [symJoint('a'), symJoint('b')];
    const map = buildJointMap(joints);
    expect(map.a).toBe(joints[0]);
    expect(map.b).toBe(joints[1]);
    expect(Object.keys(map)).toHaveLength(2);
  });

  it('returns an empty map for empty input', () => {
    expect(buildJointMap([])).toEqual({});
  });

  it('last duplicate name wins', () => {
    const first = symJoint('dup');
    const second: VrJoint = { ...symJoint('dup'), defaultPosition: 9 };
    const map = buildJointMap([first, second]);
    expect(map.dup).toBe(second);
    expect(map.dup.defaultPosition).toBe(9);
  });
});

describe('softRange', () => {
  it('narrows the G1 shoulder pitch to the window where the hand moves forward/up', () => {
    const r = softRange(g1ShoulderPitch('left'), 'shoulder_pitch');
    expect(r.lo).toBeCloseTo(-1.5708, 6);
    expect(r.hi).toBeCloseTo(0.7854, 6);
    expect(r.home).toBe(0);
  });

  it('never widens a limit the robot actually advertised', () => {
    // A tighter shoulder than our comfort window: the ROBOT wins both ends.
    const tight: VrJoint = {
      name: 'left_shoulder_pitch_joint',
      limitLower: -0.5,
      limitUpper: 0.3,
      defaultPosition: 0,
    };
    const r = softRange(tight, 'shoulder_pitch');
    expect(r.lo).toBe(-0.5);
    expect(r.hi).toBe(0.3);
  });

  it('falls back to the mechanical limits for a joint with no soft window', () => {
    const r = softRange(symJoint('left_elbow_joint'), 'elbow');
    expect(r.lo).toBeCloseTo(-Math.PI / 2);
    expect(r.hi).toBeCloseTo(Math.PI / 2);
  });

  it('stretches the window to include a rest pose that sits outside it', () => {
    // Rest at +1.2, which is outside shoulder_pitch's [-1.5708, +0.7854].
    // Clamping it would move the arm the instant the clutch was gripped.
    const odd: VrJoint = {
      name: 'left_shoulder_pitch_joint',
      limitLower: -3.0892,
      limitUpper: 2.6704,
      defaultPosition: 1.2,
    };
    const r = softRange(odd, 'shoulder_pitch');
    expect(r.home).toBe(1.2);
    expect(r.hi).toBe(1.2);
    expect(r.lo).toBeCloseTo(-1.5708, 6);
  });

  it('falls back to the mechanical limits when the soft window is disjoint from them', () => {
    const elsewhere: VrJoint = {
      name: 'left_shoulder_pitch_joint',
      limitLower: 2.0,
      limitUpper: 2.5,
      defaultPosition: 2.2,
    };
    const r = softRange(elsewhere, 'shoulder_pitch');
    expect(r.lo).toBe(2.0);
    expect(r.hi).toBe(2.5);
  });

  it('clamps a rest position that sits outside its own limits', () => {
    const r = softRange({ ...symJoint('left_elbow_joint'), defaultPosition: 99 }, 'elbow');
    expect(r.home).toBeCloseTo(Math.PI / 2);
  });

  it('survives non-finite limits and rest positions', () => {
    const junk: VrJoint = {
      name: 'left_elbow_joint',
      limitLower: Number.NaN,
      limitUpper: Number.NaN,
      defaultPosition: Number.NaN,
    };
    const r = softRange(junk, 'elbow');
    expect(r.home).toBe(0);
    expect(r.lo).toBe(-Infinity);
    expect(r.hi).toBe(Infinity);
  });
});

describe('retargetArm', () => {
  it('returns an empty result when no joints exist', () => {
    const out = retargetArm('left', {}, ZERO_ORIENT, ZERO_AXES, 0);
    expect(out.angles).toEqual({});
    expect(out.saturated).toEqual([]);
  });

  it('only emits joints present in the map (fewer-DOF embodiments)', () => {
    const map = buildJointMap([symJoint('left_elbow_joint')]);
    const out = retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 1 }, 0);
    expect(Object.keys(out.angles)).toEqual(['left_elbow_joint']);
  });

  it('maps each controller signal to the matching joint', () => {
    const map = buildJointMap(fullArm('left'));
    const orientation: ControllerOrientation = {
      pitch: Math.PI / 2,
      yaw: Math.PI / 2,
      roll: Math.PI / 2,
    };
    const out = retargetArm('left', map, orientation, { x: 1, y: 1 }, 1);

    // Pitch is inverted (raising the controller raises the arm in FRONT of the
    // robot, which on the G1 is a NEGATIVE shoulder pitch), so +π/2 -> -π/2.
    expect(out.angles.left_shoulder_pitch_joint).toBeCloseTo(-Math.PI / 2);
    // Gain 1.0: +π/2 of controller is +π/2 of joint, which this arm can reach.
    expect(out.angles.left_shoulder_yaw_joint).toBeCloseTo(Math.PI / 2);
    expect(out.angles.left_wrist_roll_joint).toBeCloseTo(Math.PI / 2);
    // full thumbstick deflection -> upper limit
    expect(out.angles.left_shoulder_roll_joint).toBeCloseTo(Math.PI / 2);
    expect(out.angles.left_elbow_joint).toBeCloseTo(Math.PI / 2);
  });

  it("rest pose (zero everything) lands on the joints' rest positions", () => {
    const map = buildJointMap(fullArm('left'));
    const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0);
    expect(out.angles.left_shoulder_pitch_joint).toBeCloseTo(0);
    expect(out.angles.left_shoulder_yaw_joint).toBeCloseTo(0);
    expect(out.angles.left_shoulder_roll_joint).toBeCloseTo(0);
    expect(out.angles.left_elbow_joint).toBeCloseTo(0);
    expect(out.angles.left_wrist_roll_joint).toBeCloseTo(0);
    expect(out.saturated).toEqual([]);
  });

  describe('orientation -> angle math (fixed gain, soft range)', () => {
    it('tracks the controller one-for-one inside the soft range', () => {
      const map = buildJointMap(fullArm('left'));
      // gain 1.0: π/4 of controller yaw is π/4 of shoulder yaw, whatever the
      // joint's travel happens to be.
      const out = retargetArm('left', map, { pitch: 0, yaw: Math.PI / 4, roll: 0 }, ZERO_AXES, 0);
      expect(out.angles.left_shoulder_yaw_joint).toBeCloseTo(Math.PI / 4);
    });

    it('clamps orientation beyond the soft range and REPORTS the saturation', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, { pitch: 0, yaw: Math.PI, roll: 0 }, ZERO_AXES, 0);
      expect(out.angles.left_shoulder_yaw_joint).toBeCloseTo(Math.PI / 2);
      expect(out.saturated).toContain('left_shoulder_yaw_joint');
    });

    it('raising the controller drives the shoulder toward its FORWARD limit', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, { pitch: Math.PI / 4, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.angles.left_shoulder_pitch_joint).toBeCloseTo(-Math.PI / 4);
    });

    it('stops the shoulder at +45 deg going the other way, not at its end stop', () => {
      // WAS: -π of controller pitch drove the joint to its +π/2 limit (and, on a
      // real G1, all the way to +2.6704). The soft range stops at +0.7854 —
      // past that the hand is behind the robot and travelling further back.
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, { pitch: -Math.PI, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.angles.left_shoulder_pitch_joint).toBeCloseTo(0.7854, 6);
      expect(out.saturated).toContain('left_shoulder_pitch_joint');
    });

    it('never drives a real G1 shoulder past the forward/up window', () => {
      const map = buildJointMap([g1ShoulderPitch('left')]);
      // 120 deg nose-up: the old map put this at -2.0595 rad, i.e. the hand
      // BEHIND and BELOW the robot. The soft range holds it at -π/2.
      const out = retargetArm('left', map, { pitch: 2.0944, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.angles.left_shoulder_pitch_joint).toBeCloseTo(-1.5708, 6);
      expect(out.saturated).toEqual(['left_shoulder_pitch_joint']);
    });

    it('SYMMETRY: equal-and-opposite controller pitch deflects the joint equally', () => {
      // This is the test that fails on the old normalized map. Dividing by π/2
      // and multiplying by (limit - home) made the gain the END STOP: on the G1
      // shoulder pitch that is 3.0892/(π/2) = 1.967 rad/rad one way and
      // 2.6704/(π/2) = 1.700 the other, so ±0.5 rad of wrist gave -0.9833 and
      // +0.8501 — the same movement meaning two different things depending on
      // which way it went.
      const map = buildJointMap([g1ShoulderPitch('left')]);
      const up = retargetArm('left', map, { pitch: 0.5, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      const down = retargetArm('left', map, { pitch: -0.5, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      const home = 0;
      expect(up.angles.left_shoulder_pitch_joint - home).toBeCloseTo(
        -(down.angles.left_shoulder_pitch_joint - home),
        12,
      );
      // And the gain really is one radian per radian.
      expect(up.angles.left_shoulder_pitch_joint).toBeCloseTo(-0.5 * ORIENTATION_GAIN, 12);
    });

    it('does not report saturation for a pose held exactly on the stop', () => {
      const map = buildJointMap([g1ShoulderPitch('left')]);
      const out = retargetArm('left', map, { pitch: 1.5708, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.angles.left_shoulder_pitch_joint).toBeCloseTo(-1.5708, 6);
      expect(out.saturated).toEqual([]);
    });

    it('produces byte-identical angles to the documented formula', () => {
      // Guards the saturation reporting against perturbing the numbers it
      // reports on: `home + rad * gain`, clamped, and nothing else.
      const joint = g1ShoulderPitch('left');
      const map = buildJointMap([joint]);
      for (const pitch of [0, 0.1, 0.7853981633974483, -1.234, 3]) {
        const { lo, hi, home } = softRange(joint, 'shoulder_pitch');
        const expected = Math.max(lo, Math.min(hi, home + -pitch * ORIENTATION_GAIN));
        const out = retargetArm('left', map, { pitch, yaw: 0, roll: 0 }, ZERO_AXES, 0);
        expect(out.angles.left_shoulder_pitch_joint).toBe(expected);
      }
    });
  });

  describe('thumbstick deadzone', () => {
    it('rejects drift below the deadzone', () => {
      const map = buildJointMap(fullArm('left'));
      const drift = STICK_DEADZONE * 0.6;
      const out = retargetArm('left', map, ZERO_ORIENT, { x: drift, y: drift / 2 }, 0);
      expect(out.angles.left_shoulder_roll_joint).toBeCloseTo(0);
      expect(out.angles.left_elbow_joint).toBeCloseTo(0);
    });

    it('rescales remaining travel so full deflection still reaches the limit', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, { x: 1, y: -1 }, 0);
      expect(out.angles.left_shoulder_roll_joint).toBeCloseTo(Math.PI / 2);
      expect(out.angles.left_elbow_joint).toBeCloseTo(-Math.PI / 2);
    });

    it('applies deadzone rescale to mid-range values', () => {
      const map = buildJointMap(fullArm('left'));
      // Rescaled travel of a symmetric ±π/2 joint: mid + travel * half.
      const out = retargetArm('left', map, ZERO_ORIENT, { x: 0.56, y: 0 }, 0);
      expect(out.angles.left_shoulder_roll_joint).toBeCloseTo(travel(0.56) * (Math.PI / 2));
    });

    it('a pegged stick sits on the end stop WITHOUT reporting saturation', () => {
      // Deliberate: reaching the stop is what full stick travel is FOR, so
      // reporting it would mean a permanent rumble instead of a signal.
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, { x: 1, y: 1 }, 0);
      expect(out.saturated).toEqual([]);
    });
  });

  describe('trigger -> end effector', () => {
    describe('fallback: wrist curl when the robot has no hand and no gripper', () => {
      it('reports the mode so the UI legend can say so', () => {
        expect(endEffectorMode('left', buildJointMap(fullArm('left')))).toBe('wrist');
      });

      it('rest trigger keeps the wrist at neutral midpoint', () => {
        const map = buildJointMap(fullArm('left'));
        const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0);
        expect(out.angles.left_wrist_pitch_joint).toBeCloseTo(0);
      });

      it('full trigger pull drives wrist to the upper limit', () => {
        const map = buildJointMap(fullArm('left'));
        const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 1);
        expect(out.angles.left_wrist_pitch_joint).toBeCloseTo(Math.PI / 2);
      });

      it('half trigger sits halfway between midpoint and upper limit', () => {
        const map = buildJointMap(fullArm('left'));
        const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0.5);
        expect(out.angles.left_wrist_pitch_joint).toBeCloseTo(Math.PI / 4);
      });

      it('clamps trigger above 1', () => {
        const map = buildJointMap(fullArm('left'));
        const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 5);
        expect(out.angles.left_wrist_pitch_joint).toBeCloseTo(Math.PI / 2);
      });

      it('never drives the wrist below neutral even with negative trigger', () => {
        const map = buildJointMap(fullArm('left'));
        const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, -1);
        expect(out.angles.left_wrist_pitch_joint).toBeCloseTo(0);
      });

      it('curls the wrist from rest, not from mid-limit', () => {
        const map = buildJointMap([
          { name: 'left_wrist_pitch_joint', limitLower: -0.5, limitUpper: 1.5, defaultPosition: 0 },
        ]);
        expect(
          retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0).angles.left_wrist_pitch_joint,
        ).toBeCloseTo(0);
        expect(
          retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0.5).angles.left_wrist_pitch_joint,
        ).toBeCloseTo(0.75);
        expect(
          retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 1).angles.left_wrist_pitch_joint,
        ).toBeCloseTo(1.5);
      });
    });

    describe('a Dex3-1 hand takes priority over everything', () => {
      const map = buildJointMap([...fullArm('left'), ...dex3Hand('left')]);

      it('reports the mode', () => {
        expect(endEffectorMode('left', map)).toBe('hand');
      });

      it('closes every flexion joint proportionally to the trigger', () => {
        const half = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0.5).angles;
        expect(half.left_hand_thumb_1_joint).toBeCloseTo(1.5708 / 2, 6);
        expect(half.left_hand_thumb_2_joint).toBeCloseTo(1.7453 / 2, 6);
        expect(half.left_hand_index_1_joint).toBeCloseTo(1.7453 / 2, 6);
        expect(half.left_hand_middle_1_joint).toBeCloseTo(1.7453 / 2, 6);
      });

      it('a full pull is a full fist', () => {
        const full = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 1).angles;
        for (const s of HAND_FLEXION_SUFFIXES) {
          expect(full[`left_hand_${s}_joint`]).toBeCloseTo(map[`left_hand_${s}_joint`].limitUpper, 9);
        }
      });

      it('holds the abduction/spread joints at rest at every trigger position', () => {
        for (const trigger of [0, 0.3, 1]) {
          const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, trigger).angles;
          for (const s of HAND_ABDUCTION_SUFFIXES) {
            expect(out[`left_hand_${s}_joint`]).toBe(0);
          }
        }
      });

      it('leaves wrist_pitch uncommanded once there is a real hand to close', () => {
        const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 1).angles;
        expect(out.left_wrist_pitch_joint).toBeUndefined();
      });

      it('works with a partial hand (only some fingers advertised)', () => {
        const partial = buildJointMap([
          ...fullArm('left'),
          { name: 'left_hand_index_1_joint', limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
        ]);
        expect(endEffectorMode('left', partial)).toBe('hand');
        const out = retargetArm('left', partial, ZERO_ORIENT, ZERO_AXES, 1).angles;
        expect(out.left_hand_index_1_joint).toBeCloseTo(1.7453, 9);
      });

      it('a spread-only hand is NOT a hand — nothing there closes', () => {
        const spreadOnly = buildJointMap([
          ...fullArm('left'),
          { name: 'left_hand_index_0_joint', limitLower: -0.5236, limitUpper: 0.5236, defaultPosition: 0 },
        ]);
        expect(endEffectorMode('left', spreadOnly)).toBe('wrist');
      });

      it('the other hand is untouched by this arm', () => {
        const both = buildJointMap([...dex3Hand('left'), ...dex3Hand('right')]);
        const out = retargetArm('left', both, ZERO_ORIENT, ZERO_AXES, 1).angles;
        expect(Object.keys(out).every((n) => n.startsWith('left_'))).toBe(true);
      });
    });

    describe('a parallel gripper is second choice', () => {
      // SO-101 names it `gripper`, with no side prefix — it only has one arm.
      const so101 = buildJointMap([
        { name: 'gripper', limitLower: -0.174533, limitUpper: 1.74533, defaultPosition: 0 },
      ]);

      it('reports the mode for an unprefixed gripper', () => {
        expect(endEffectorMode('left', so101)).toBe('gripper');
      });

      it('squeezing closes it (higher angle is more closed on the SO-101)', () => {
        expect(retargetArm('left', so101, ZERO_ORIENT, ZERO_AXES, 0).angles.gripper).toBeCloseTo(0);
        expect(retargetArm('left', so101, ZERO_ORIENT, ZERO_AXES, 1).angles.gripper).toBeCloseTo(1.74533);
      });

      it('prefers a side-prefixed gripper when the robot advertises one', () => {
        const twoArmed = buildJointMap([
          { name: 'left_gripper_joint', limitLower: 0, limitUpper: 1, defaultPosition: 0 },
          { name: 'gripper', limitLower: 0, limitUpper: 2, defaultPosition: 0 },
        ]);
        const out = retargetArm('left', twoArmed, ZERO_ORIENT, ZERO_AXES, 1).angles;
        expect(out.left_gripper_joint).toBeCloseTo(1);
        expect(out.gripper).toBeUndefined();
      });

      it('yields to a hand when both exist', () => {
        const both = buildJointMap([
          ...dex3Hand('left'),
          { name: 'gripper', limitLower: 0, limitUpper: 1, defaultPosition: 0 },
        ]);
        expect(endEffectorMode('left', both)).toBe('hand');
        expect(retargetArm('left', both, ZERO_ORIENT, ZERO_AXES, 1).angles.gripper).toBeUndefined();
      });
    });

    it('reports "none" when the robot has nothing to squeeze', () => {
      const map = buildJointMap([symJoint('left_elbow_joint')]);
      expect(endEffectorMode('left', map)).toBe('none');
    });
  });

  describe('wrist_yaw is deliberately driven by nothing', () => {
    it('never appears in the output', () => {
      const map = buildJointMap([
        ...fullArm('left'),
        { name: 'left_wrist_yaw_joint', limitLower: -1.61443, limitUpper: 1.61443, defaultPosition: 0 },
      ]);
      const out = retargetArm(
        'left',
        map,
        { pitch: 0.4, yaw: 0.4, roll: 0.4 },
        { x: 0.9, y: -0.9 },
        1,
      );
      expect(out.angles.left_wrist_yaw_joint).toBeUndefined();
    });
  });

  describe('right arm mirroring of lateral signals', () => {
    it('mirrors yaw, roll, and thumbstick X but not pitch/elbow', () => {
      const leftMap = buildJointMap(fullArm('left'));
      const rightMap = buildJointMap(fullArm('right'));
      const orientation: ControllerOrientation = {
        pitch: Math.PI / 4,
        yaw: Math.PI / 4,
        roll: Math.PI / 4,
      };
      const axes: ControllerAxes = { x: 0.56, y: 0.56 };

      const left = retargetArm('left', leftMap, orientation, axes, 0).angles;
      const right = retargetArm('right', rightMap, orientation, axes, 0).angles;

      expect(right.right_shoulder_yaw_joint).toBeCloseTo(-left.left_shoulder_yaw_joint);
      expect(right.right_wrist_roll_joint).toBeCloseTo(-left.left_wrist_roll_joint);
      expect(right.right_shoulder_roll_joint).toBeCloseTo(-left.left_shoulder_roll_joint);

      expect(right.right_shoulder_pitch_joint).toBeCloseTo(left.left_shoulder_pitch_joint);
      expect(left.left_shoulder_pitch_joint).toBeLessThan(0);
      expect(right.right_elbow_joint).toBeCloseTo(left.left_elbow_joint);
    });
  });

  it('respects asymmetric joint limits (rest/limit offset)', () => {
    // Joint range [0, 2]: rest = 1.
    const joint: VrJoint = {
      name: 'left_elbow_joint',
      limitLower: 0,
      limitUpper: 2,
      defaultPosition: 1,
    };
    const map = buildJointMap([joint]);

    expect(retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 1 }, 0).angles.left_elbow_joint).toBeCloseTo(2);
    expect(retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 0 }, 0).angles.left_elbow_joint).toBeCloseTo(1);
    expect(retargetArm('left', map, ZERO_ORIENT, { x: 0, y: -1 }, 0).angles.left_elbow_joint).toBeCloseTo(0);
  });

  describe('rest anchoring (asymmetric ranges must not bias the neutral pose)', () => {
    // The G1 elbow: it flexes twice as far as it extends, and rests straight.
    const g1Elbow: VrJoint = {
      name: 'left_elbow_joint',
      limitLower: -1.0472,
      limitUpper: 2.0944,
      defaultPosition: 0,
    };

    it('a centred thumbstick leaves the joint at its rest position, not mid-limit', () => {
      const map = buildJointMap([g1Elbow]);
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0);
      // Anchoring on the mid-limit put this at +0.5236 rad — a 30° flex the
      // wearer never asked for, held for as long as they touched nothing.
      expect(out.angles.left_elbow_joint).toBeCloseTo(0);
    });

    it('still reaches both end stops at full deflection', () => {
      const map = buildJointMap([g1Elbow]);
      expect(
        retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 1 }, 0).angles.left_elbow_joint,
      ).toBeCloseTo(2.0944);
      expect(
        retargetArm('left', map, ZERO_ORIENT, { x: 0, y: -1 }, 0).angles.left_elbow_joint,
      ).toBeCloseTo(-1.0472);
    });

    it('scales each direction to its own limit', () => {
      const map = buildJointMap([g1Elbow]);
      // Rest is 0, the stops are +2.0944 and -1.0472, so each direction gets its
      // own half-range rather than a shared one.
      expect(
        retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 0.56 }, 0).angles.left_elbow_joint,
      ).toBeCloseTo(travel(0.56) * 2.0944);
      expect(
        retargetArm('left', map, ZERO_ORIENT, { x: 0, y: -0.56 }, 0).angles.left_elbow_joint,
      ).toBeCloseTo(-travel(0.56) * 1.0472);
    });

    it('clamps a rest position that sits outside its own limits', () => {
      const map = buildJointMap([{ ...g1Elbow, defaultPosition: 99 }]);
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0);
      expect(out.angles.left_elbow_joint).toBeCloseTo(2.0944);
    });
  });

  describe('degenerate input', () => {
    const map = buildJointMap(fullArm('left'));

    it('emits NO command for a joint whose signal is NaN, rather than a NaN or a jump to rest', () => {
      const out = retargetArm(
        'left',
        map,
        { pitch: Number.NaN, yaw: 0.2, roll: 0 },
        { x: Number.NaN, y: 0.5 },
        Number.NaN,
      );
      expect(out.angles.left_shoulder_pitch_joint).toBeUndefined();
      expect(out.angles.left_shoulder_roll_joint).toBeUndefined();
      expect(out.angles.left_wrist_pitch_joint).toBeUndefined();
      // The joints whose signals WERE finite still move.
      expect(out.angles.left_shoulder_yaw_joint).toBeCloseTo(0.2);
      expect(out.angles.left_elbow_joint).toBeCloseTo(travel(0.5) * (Math.PI / 2));
    });

    it('never emits a NaN angle for an Infinity signal', () => {
      const out = retargetArm(
        'left',
        map,
        { pitch: Infinity, yaw: -Infinity, roll: 0 },
        ZERO_AXES,
        0,
      );
      for (const v of Object.values(out.angles)) expect(Number.isFinite(v)).toBe(true);
      expect(out.angles.left_shoulder_pitch_joint).toBeUndefined();
    });

    it('refuses to drive a joint the robot advertised without usable limits', () => {
      const junk = buildJointMap([
        { name: 'left_elbow_joint', limitLower: Number.NaN, limitUpper: Number.NaN, defaultPosition: 0.3 },
      ]);
      const out = retargetArm('left', junk, ZERO_ORIENT, { x: 0, y: 1 }, 0);
      expect(out.angles.left_elbow_joint).toBe(0.3);
    });
  });

  it('exposes the soft ranges as one table, keyed by suffix so it crosses embodiments', () => {
    expect(Object.keys(ORIENTATION_SOFT_RANGES).sort()).toEqual([
      'shoulder_pitch',
      'shoulder_yaw',
      'wrist_roll',
    ]);
    // A suffix key, not a joint name: the same window has to apply to
    // `left_shoulder_pitch_joint` and `right_shoulder_pitch_joint` alike.
    const l = retargetArm('left', buildJointMap([g1ShoulderPitch('left')]), { pitch: -3, yaw: 0, roll: 0 }, ZERO_AXES, 0);
    const r = retargetArm('right', buildJointMap([g1ShoulderPitch('right')]), { pitch: -3, yaw: 0, roll: 0 }, ZERO_AXES, 0);
    expect(l.angles.left_shoulder_pitch_joint).toBe(r.angles.right_shoulder_pitch_joint);
  });
});

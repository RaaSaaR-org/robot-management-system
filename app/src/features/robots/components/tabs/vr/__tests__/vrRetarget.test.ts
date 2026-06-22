/**
 * @file vrRetarget.test.ts
 * @description Tests for the WebXR controller -> robot arm retargeting math
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  buildJointMap,
  retargetArm,
  type VrJoint,
  type ControllerOrientation,
  type ControllerAxes,
} from '../vrRetarget';

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

describe('retargetArm', () => {
  it('returns an empty object when no joints exist', () => {
    const out = retargetArm('left', {}, ZERO_ORIENT, ZERO_AXES, 0);
    expect(out).toEqual({});
  });

  it('only emits joints present in the map (fewer-DOF embodiments)', () => {
    const map = buildJointMap([symJoint('left_elbow_joint')]);
    const out = retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 1 }, 0);
    expect(Object.keys(out)).toEqual(['left_elbow_joint']);
  });

  it('maps each controller signal to the matching joint', () => {
    const map = buildJointMap(fullArm('left'));
    const orientation: ControllerOrientation = {
      pitch: Math.PI / 2, // full positive -> upper limit
      yaw: Math.PI / 2,
      roll: Math.PI / 2,
    };
    const out = retargetArm('left', map, orientation, { x: 1, y: 1 }, 1);

    // pitch/yaw/roll at +π/2 normalize to +1 -> upper limit (π/2)
    expect(out.left_shoulder_pitch_joint).toBeCloseTo(Math.PI / 2);
    expect(out.left_shoulder_yaw_joint).toBeCloseTo(Math.PI / 2);
    expect(out.left_wrist_roll_joint).toBeCloseTo(Math.PI / 2);
    // full thumbstick deflection -> upper limit
    expect(out.left_shoulder_roll_joint).toBeCloseTo(Math.PI / 2);
    expect(out.left_elbow_joint).toBeCloseTo(Math.PI / 2);
  });

  it('rest pose (zero everything) lands at joint midpoints', () => {
    const map = buildJointMap(fullArm('left'));
    const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0);
    expect(out.left_shoulder_pitch_joint).toBeCloseTo(0);
    expect(out.left_shoulder_yaw_joint).toBeCloseTo(0);
    expect(out.left_shoulder_roll_joint).toBeCloseTo(0);
    expect(out.left_elbow_joint).toBeCloseTo(0);
    expect(out.left_wrist_roll_joint).toBeCloseTo(0);
  });

  describe('orientation -> angle math (normAngle over ±90°)', () => {
    it('half a right-angle pitch maps to a quarter of the range', () => {
      const map = buildJointMap(fullArm('left'));
      // pitch = π/4 -> normAngle = 0.5 -> mid(0) + 0.5*half(π/2) = π/4
      const out = retargetArm('left', map, { pitch: Math.PI / 4, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.left_shoulder_pitch_joint).toBeCloseTo(Math.PI / 4);
    });

    it('clamps orientation beyond ±90° to the joint limit', () => {
      const map = buildJointMap(fullArm('left'));
      // pitch = π (>π/2) -> normAngle clamps to 1 -> upper limit
      const out = retargetArm('left', map, { pitch: Math.PI, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.left_shoulder_pitch_joint).toBeCloseTo(Math.PI / 2);
    });

    it('negative pitch drives toward the lower limit', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, { pitch: -Math.PI, yaw: 0, roll: 0 }, ZERO_AXES, 0);
      expect(out.left_shoulder_pitch_joint).toBeCloseTo(-Math.PI / 2);
    });
  });

  describe('thumbstick deadzone', () => {
    it('rejects drift below the deadzone (0.12)', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, { x: 0.1, y: 0.05 }, 0);
      // both below deadzone -> zero signal -> midpoint
      expect(out.left_shoulder_roll_joint).toBeCloseTo(0);
      expect(out.left_elbow_joint).toBeCloseTo(0);
    });

    it('rescales remaining travel so full deflection still reaches the limit', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, { x: 1, y: -1 }, 0);
      expect(out.left_shoulder_roll_joint).toBeCloseTo(Math.PI / 2);
      expect(out.left_elbow_joint).toBeCloseTo(-Math.PI / 2);
    });

    it('applies deadzone rescale to mid-range values', () => {
      const map = buildJointMap(fullArm('left'));
      // x = 0.56 -> (0.56-0.12)/(1-0.12) = 0.5 -> mid + 0.5*half = π/4
      const out = retargetArm('left', map, ZERO_ORIENT, { x: 0.56, y: 0 }, 0);
      expect(out.left_shoulder_roll_joint).toBeCloseTo(Math.PI / 4);
    });
  });

  describe('trigger -> wrist curl (unipolar)', () => {
    it('rest trigger keeps the wrist at neutral midpoint', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0);
      expect(out.left_wrist_pitch_joint).toBeCloseTo(0);
    });

    it('full trigger pull drives wrist to the upper limit', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 1);
      expect(out.left_wrist_pitch_joint).toBeCloseTo(Math.PI / 2);
    });

    it('half trigger sits halfway between midpoint and upper limit', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 0.5);
      // mid(0) + 0.5 * (upper(π/2) - mid(0)) = π/4
      expect(out.left_wrist_pitch_joint).toBeCloseTo(Math.PI / 4);
    });

    it('clamps trigger above 1', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, 5);
      expect(out.left_wrist_pitch_joint).toBeCloseTo(Math.PI / 2);
    });

    it('never drives the wrist below neutral even with negative trigger', () => {
      const map = buildJointMap(fullArm('left'));
      const out = retargetArm('left', map, ZERO_ORIENT, ZERO_AXES, -1);
      expect(out.left_wrist_pitch_joint).toBeCloseTo(0);
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

      const left = retargetArm('left', leftMap, orientation, axes, 0);
      const right = retargetArm('right', rightMap, orientation, axes, 0);

      // Mirrored lateral signals: opposite sign on right
      expect(right.right_shoulder_yaw_joint).toBeCloseTo(-left.left_shoulder_yaw_joint);
      expect(right.right_wrist_roll_joint).toBeCloseTo(-left.left_wrist_roll_joint);
      expect(right.right_shoulder_roll_joint).toBeCloseTo(-left.left_shoulder_roll_joint);

      // Non-mirrored signals: identical
      expect(right.right_shoulder_pitch_joint).toBeCloseTo(left.left_shoulder_pitch_joint);
      expect(right.right_elbow_joint).toBeCloseTo(left.left_elbow_joint);
    });
  });

  it('respects asymmetric joint limits (mid/half offset)', () => {
    // Joint range [0, 2]: mid = 1, half = 1.
    const joint: VrJoint = {
      name: 'left_elbow_joint',
      limitLower: 0,
      limitUpper: 2,
      defaultPosition: 1,
    };
    const map = buildJointMap([joint]);

    // Full positive deflection -> upper limit
    expect(retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 1 }, 0).left_elbow_joint).toBeCloseTo(2);
    // Rest -> midpoint
    expect(retargetArm('left', map, ZERO_ORIENT, { x: 0, y: 0 }, 0).left_elbow_joint).toBeCloseTo(1);
    // Full negative deflection -> lower limit
    expect(retargetArm('left', map, ZERO_ORIENT, { x: 0, y: -1 }, 0).left_elbow_joint).toBeCloseTo(0);
  });
});

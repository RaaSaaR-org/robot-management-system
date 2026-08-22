/**
 * @file dex3-layout.test.ts
 * @description The recorded joint vector: its width, its order, and the
 *              left/right asymmetry that a mirror would silently break.
 * @feature recording
 */

import { describe, it, expect } from 'vitest';
import {
  G1_ARM_JOINTS,
  G1_LEFT_HAND_JOINTS,
  G1_RIGHT_HAND_JOINTS,
  G1_DEX3_JOINTS,
  G1_DEX3_ROBOT_TYPE,
  layoutFor,
  extractVector,
} from '../dex3-layout.js';

describe('the Unitree_G1_Dex3 vector', () => {
  it('is 28 wide: 14 arm joints then 14 hand joints', () => {
    expect(G1_ARM_JOINTS).toHaveLength(14);
    expect(G1_LEFT_HAND_JOINTS).toHaveLength(7);
    expect(G1_RIGHT_HAND_JOINTS).toHaveLength(7);
    expect(G1_DEX3_JOINTS).toHaveLength(28);
    expect(G1_DEX3_JOINTS.slice(0, 14)).toEqual([...G1_ARM_JOINTS]);
  });

  it('carries no leg or waist joint', () => {
    // A column the operator never drives is a constant a policy will learn to
    // predict perfectly and gain nothing from.
    for (const name of G1_DEX3_JOINTS) {
      expect(name).not.toMatch(/hip|knee|ankle|waist/);
    }
  });

  it('starts each arm at the shoulder and ends at the wrist', () => {
    expect(G1_ARM_JOINTS[0]).toBe('left_shoulder_pitch_joint');
    expect(G1_ARM_JOINTS[6]).toBe('left_wrist_yaw_joint');
    expect(G1_ARM_JOINTS[7]).toBe('right_shoulder_pitch_joint');
    expect(G1_ARM_JOINTS[13]).toBe('right_wrist_yaw_joint');
  });
});

describe('the hand ordering is asymmetric, on purpose', () => {
  // This is the single test that would catch a mirrored hand. joints.py:25-27:
  // "middle before index on the left, index before middle on the right ... it
  // comes from the hardware, not from a transcription mistake here."
  it('puts middle before index on the LEFT hand', () => {
    expect(G1_LEFT_HAND_JOINTS).toEqual([
      'left_hand_thumb_0_joint',
      'left_hand_thumb_1_joint',
      'left_hand_thumb_2_joint',
      'left_hand_middle_0_joint',
      'left_hand_middle_1_joint',
      'left_hand_index_0_joint',
      'left_hand_index_1_joint',
    ]);
  });

  it('puts index before middle on the RIGHT hand', () => {
    expect(G1_RIGHT_HAND_JOINTS).toEqual([
      'right_hand_thumb_0_joint',
      'right_hand_thumb_1_joint',
      'right_hand_thumb_2_joint',
      'right_hand_index_0_joint',
      'right_hand_index_1_joint',
      'right_hand_middle_0_joint',
      'right_hand_middle_1_joint',
    ]);
  });

  it('is not the same list with the side swapped', () => {
    const mirrored = G1_LEFT_HAND_JOINTS.map((n) => n.replace('left', 'right'));
    expect(mirrored).not.toEqual([...G1_RIGHT_HAND_JOINTS]);
  });

  it('disagrees with the teleop joint config, which is also correct', () => {
    // g1-edu.config.ts lists index before middle on BOTH hands. That order
    // drives the UI; this one is the wire and dataset order. Pinning the
    // disagreement here stops someone "fixing" one of them into the other.
    const { joints } = layoutFor('g1_edu');
    const leftMiddle0 = joints.indexOf('left_hand_middle_0_joint');
    const leftIndex0 = joints.indexOf('left_hand_index_0_joint');
    expect(leftMiddle0).toBeLessThan(leftIndex0);
  });
});

describe('layoutFor', () => {
  it('records a G1 EDU as Unitree_G1_Dex3', () => {
    const layout = layoutFor('g1_edu');
    expect(layout.robotType).toBe(G1_DEX3_ROBOT_TYPE);
    expect(layout.joints).toHaveLength(28);
  });

  it('records anything else under its own name and its own joints', () => {
    const layout = layoutFor('so101');
    expect(layout.robotType).toBe('so101');
    expect(layout.joints.length).toBeGreaterThan(0);
    expect(layout.robotType).not.toBe(G1_DEX3_ROBOT_TYPE);
  });

  it('gives a generic robot an empty layout rather than inventing one', () => {
    expect(layoutFor('generic').joints).toHaveLength(0);
  });
});

describe('extractVector', () => {
  const pose = { a: 1, b: 2, c: 3 };

  it('reads values in layout order, not pose order', () => {
    expect(extractVector(['c', 'a'], pose).values).toEqual([3, 1]);
  });

  it('reports what the pose did not carry instead of storing a zero', () => {
    const got = extractVector(['a', 'zzz'], pose);
    expect(got.missing).toEqual(['zzz']);
    // The slot is zero, but the caller was told — which is the whole point.
    expect(got.values).toEqual([1, 0]);
  });

  it('treats NaN and Infinity as missing', () => {
    const got = extractVector(['x', 'y'], { x: Number.NaN, y: Number.POSITIVE_INFINITY });
    expect(got.missing).toEqual(['x', 'y']);
  });

  it('accepts a genuine zero', () => {
    const got = extractVector(['z'], { z: 0 });
    expect(got.missing).toEqual([]);
    expect(got.values).toEqual([0]);
  });
});

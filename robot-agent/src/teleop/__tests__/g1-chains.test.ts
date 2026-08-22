/**
 * @file g1-chains.test.ts
 * @description Pins the numbers in the generated chain table that a careless
 *              edit would round away, and the forward kinematics they imply.
 * @feature teleop
 */

import { describe, it, expect } from 'vitest';
import {
  G1_ARM_CHAINS,
  G1_FINGER_CHAINS,
  HEAD_SITE_IN_TORSO,
} from '../g1-chains.generated.js';
import { forwardKinematics } from '../kinematics.js';

const ARM_ORDER = [
  'shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow',
  'wrist_roll', 'wrist_pitch', 'wrist_yaw',
];

describe('the arm chains', () => {
  it('are seven joints each, shoulder outwards, hanging off the torso', () => {
    for (const side of ['left', 'right'] as const) {
      const chain = G1_ARM_CHAINS[side];
      expect(chain.root).toBe('torso_link');
      expect(chain.links.map((l) => l.joint)).toEqual(
        ARM_ORDER.map((j) => `${side}_${j}_joint`),
      );
      expect(chain.tipOf).toBe(`${side}_wrist_yaw_link`);
    }
  });

  it('carries the shoulder mount as a 16.00335° tilt, not as 16°', () => {
    // The only non-trivial rotations in the whole table. Rounded to "16° about
    // x" the arms look almost right and reach about a centimetre wrong, which
    // is inside what an operator would put down to their own aim.
    const left = G1_ARM_CHAINS.left.links[0]!.quat;
    expect(left[0]).toBeCloseTo(0.990264, 6);
    expect(left[1]).toBeCloseTo(0.139201, 6);
    // Not zero, and not noise to be tidied away: the axis really is off x.
    expect(left[2]).not.toBe(0);
    expect(left[3]).not.toBe(0);
    const angle = 2 * Math.acos(left[0]) * (180 / Math.PI);
    expect(angle).toBeCloseTo(16.00335, 4);
  });

  it('does NOT mirror the shoulder-roll limits between the sides', () => {
    // Copying the left row and flipping the y offsets is the obvious way to
    // write this table by hand, and it gives the right arm a range that lets it
    // swing into the torso.
    const l = G1_ARM_CHAINS.left.links[1]!;
    const r = G1_ARM_CHAINS.right.links[1]!;
    expect(l.lower).toBeCloseTo(-1.5882, 4);
    expect(l.upper).toBeCloseTo(2.2515, 4);
    expect(r.lower).toBeCloseTo(-2.2515, 4);
    expect(r.upper).toBeCloseTo(1.5882, 4);
    expect(l.lower).not.toBeCloseTo(r.lower, 3);
  });

  it('puts the palm point at the midpoint of the index and middle knuckles', () => {
    expect(G1_ARM_CHAINS.left.tip[0]).toBeCloseTo(0.1192, 6);
    expect(G1_ARM_CHAINS.left.tip[1]).toBeCloseTo(0.0046, 6);
    expect(G1_ARM_CHAINS.left.tip[2]).toBeCloseTo(0, 9);
    expect(G1_ARM_CHAINS.right.tip[1]).toBeCloseTo(-0.0046, 6);
  });

  it('reaches the wrist positions MuJoCo reaches at q = 0', () => {
    // Cross-checked against `mj_forward` on g1_dex3_pickplace_scene.xml; the
    // python side of that check is `hardware/sim_g1_dds/test_teleop_chains.py`.
    const zero = new Array(7).fill(0);
    const left = forwardKinematics(G1_ARM_CHAINS.left, zero);
    expect(left.tip[0]).toBeCloseTo(0.322939, 5);
    expect(left.tip[1]).toBeCloseTo(0.153239, 5);
    expect(left.tip[2]).toBeCloseTo(0.051227, 5);
    const right = forwardKinematics(G1_ARM_CHAINS.right, zero);
    expect(right.tip[0]).toBeCloseTo(0.322939, 5);
    expect(right.tip[1]).toBeCloseTo(-0.153229, 5);
    expect(right.tip[2]).toBeCloseTo(0.051227, 5);
  });

  it('is symmetric to 1e-4, not to 1e-9', () => {
    // The upstream Unitree data really does put the left shoulder at y=0.10022
    // and the right at y=-0.10021. A test asserting exact mirror symmetry would
    // fail forever, so this one states the real tolerance.
    const zero = new Array(7).fill(0);
    const l = forwardKinematics(G1_ARM_CHAINS.left, zero).tip;
    const r = forwardKinematics(G1_ARM_CHAINS.right, zero).tip;
    expect(Math.abs(l[1] + r[1])).toBeGreaterThan(0);
    expect(Math.abs(l[1] + r[1])).toBeLessThan(1e-4);
  });

  it('is oriented like the torso at q = 0', () => {
    // The head-relative wrist mapping depends on this: the palm frame at zero
    // IS the torso frame, so a controller held pointing forward maps to a hand
    // pointing forward with no correction quaternion anywhere.
    const rot = forwardKinematics(G1_ARM_CHAINS.left, new Array(7).fill(0)).tipRot;
    for (let i = 0; i < 9; i++) {
      expect(rot[i]!).toBeCloseTo(i % 4 === 0 ? 1 : 0, 3);
    }
  });
});

describe('the finger chains', () => {
  it('hang off the wrist and end at a fingertip', () => {
    for (const side of ['left', 'right'] as const) {
      for (const finger of ['thumb', 'index', 'middle'] as const) {
        const chain = G1_FINGER_CHAINS[side][finger];
        expect(chain.root).toBe(`${side}_wrist_yaw_link`);
        expect(chain.links.every((l) => l.joint.startsWith(`${side}_hand_${finger}_`))).toBe(true);
      }
      expect(G1_FINGER_CHAINS[side].thumb.links).toHaveLength(3);
      expect(G1_FINGER_CHAINS[side].index.links).toHaveLength(2);
      expect(G1_FINGER_CHAINS[side].middle.links).toHaveLength(2);
    }
  });

  it('closes in OPPOSITE directions on the two hands', () => {
    // The single fact that mirrors a hand if it is got wrong. The left index
    // flexes toward negative and the right toward positive, and any table
    // written by find-and-replacing "left" with "right" gets this backwards.
    expect(G1_FINGER_CHAINS.left.index.links[0]!.lower).toBeCloseTo(-1.5708, 4);
    expect(G1_FINGER_CHAINS.left.index.links[0]!.upper).toBeCloseTo(0, 9);
    expect(G1_FINGER_CHAINS.right.index.links[0]!.lower).toBeCloseTo(0, 9);
    expect(G1_FINGER_CHAINS.right.index.links[0]!.upper).toBeCloseTo(1.5708, 4);
  });

  it('puts the index on the +z side of both hands', () => {
    // `vrWrist.ts` builds the human hand frame with +z toward the index for
    // BOTH hands on the strength of this.
    for (const side of ['left', 'right'] as const) {
      expect(G1_FINGER_CHAINS[side].index.links[0]!.pos[2]).toBeCloseTo(0.0285, 6);
      expect(G1_FINGER_CHAINS[side].middle.links[0]!.pos[2]).toBeCloseTo(-0.0285, 6);
    }
  });

  it('spreads the fingers open at q = 0', () => {
    const open = (side: 'left' | 'right', finger: 'index' | 'middle') =>
      forwardKinematics(G1_FINGER_CHAINS[side][finger], [0, 0]).tip;
    expect(open('left', 'index')[0]).toBeCloseTo(0.213, 3);
    expect(open('left', 'index')[2]).toBeCloseTo(0.0285, 4);
    expect(open('left', 'middle')[2]).toBeCloseTo(-0.0285, 4);
  });
});

describe('the head site', () => {
  it('is a pure translation off the torso', () => {
    // The `head_camera` CAMERA at the same point is yawed and tilted per scene;
    // the SITE is not, which is why the mapping uses it.
    expect([...HEAD_SITE_IN_TORSO]).toEqual([0.08, 0, 0.42]);
  });
});

describe('the teleop joint config agrees with the model', () => {
  it('declares the same limits the MJCF does, for all 28 driven joints', async () => {
    // THE BUG THIS PINS. The Dex3 limits in `g1-edu.config.ts` were hand-written
    // "reasonable placeholders" and were SYMMETRIC between the sides, which the
    // hardware is not. `left_hand_index_1_joint` was declared [0, 1.7453] where
    // the model says [-1.7453, 0] — two ranges that overlap at the single point
    // zero — so every command to close the LEFT hand was clamped to 0 by
    // `setTeleopJoint` and the hand could not be closed by any input path at
    // all. Nine of the fourteen finger joints disagreed; all fourteen arm joints
    // agreed, which is why it survived until something drove the fingers.
    //
    // The config now reads the finger limits out of this table. The arm limits
    // are still declared independently in `g1.config.ts`, so this test is a
    // real comparison for those and a guard against the config drifting back.
    const { getJointConfig } = await import('../../robot/joint-configs/index.js');
    const config = new Map(getJointConfig('g1_edu').map((j) => [j.name, j]));

    const links = (['left', 'right'] as const).flatMap((side) => [
      ...G1_ARM_CHAINS[side].links,
      ...(['thumb', 'index', 'middle'] as const)
        .flatMap((finger) => G1_FINGER_CHAINS[side][finger].links),
    ]);
    expect(links).toHaveLength(28);

    for (const link of links) {
      const declared = config.get(link.joint);
      expect(declared, `${link.joint} is missing from the G1 EDU joint config`).toBeDefined();
      expect(declared!.limitLower, `${link.joint} lower`).toBeCloseTo(link.lower, 4);
      expect(declared!.limitUpper, `${link.joint} upper`).toBeCloseTo(link.upper, 4);
    }
  });

  it('leaves the open hand inside every finger limit', () => {
    // `defaultPosition` is 0 for all fourteen. If a future model put a joint's
    // range entirely off zero, the default would be an illegal pose and the hand
    // would be clamped somewhere nobody chose.
    for (const side of ['left', 'right'] as const) {
      for (const finger of ['thumb', 'index', 'middle'] as const) {
        for (const link of G1_FINGER_CHAINS[side][finger].links) {
          expect(link.lower).toBeLessThanOrEqual(0);
          expect(link.upper).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

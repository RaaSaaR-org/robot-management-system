/**
 * @file dexpilot.test.ts
 * @description Finger retargeting: the left/right ordering that a mirrored
 *              table would break, the pinch, and the trigger fallback.
 * @feature teleop
 */

import { describe, it, expect } from 'vitest';
import {
  ESCAPE_DIST_M,
  FingerRetargeter,
  PROJECT_DIST_M,
  gripPose,
  jointNames,
  type HandKeypoints,
} from '../dexpilot.js';
import { G1_FINGER_CHAINS, type Side } from '../g1-chains.generated.js';
import { forwardKinematics } from '../kinematics.js';

/** A relaxed open hand in the robot's hand frame: fingers along +x, index at +z. */
function openHand(side: Side): HandKeypoints {
  const palm = side === 'left' ? -1 : 1; // the thumb sits on the palm side
  return {
    wrist: [0, 0, 0],
    thumb: [0.075, palm * 0.075, 0],
    index: [0.19, palm * 0.005, 0.028],
    middle: [0.19, palm * 0.005, -0.028],
  };
}

/** Thumb tip brought onto the index tip. */
function pinchHand(side: Side): HandKeypoints {
  const open = openHand(side);
  return { ...open, thumb: [open.index[0] - 0.005, open.index[1] + 0.004, open.index[2] - 0.002] };
}

/** Settle the filter, then read a converged answer. */
function settle(r: FingerRetargeter, human: HandKeypoints, steps = 60): number[] {
  let q: number[] | null = null;
  for (let i = 0; i < steps; i++) q = r.solve(human, q).q;
  return q!;
}

function tipsOf(side: Side, q: readonly number[]): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  let at = 0;
  for (const finger of ['thumb', 'index', 'middle'] as const) {
    const chain = G1_FINGER_CHAINS[side][finger];
    out[finger] = forwardKinematics(chain, q.slice(at, at + chain.links.length)).tip;
    at += chain.links.length;
  }
  return out;
}

describe('the joint order this module works in', () => {
  it('is thumb, index, middle on BOTH hands — and that is not the wire order', () => {
    // `hardware/sim_g1_dds/joints.py:25-27`: the DDS wire lists MIDDLE before
    // INDEX on the left hand and index before middle on the right, and the
    // asymmetry comes from the hardware. This module never touches a wire
    // index; it maps back by NAME, and this test is what says so.
    expect(jointNames('left')).toEqual([
      'left_hand_thumb_0_joint', 'left_hand_thumb_1_joint', 'left_hand_thumb_2_joint',
      'left_hand_index_0_joint', 'left_hand_index_1_joint',
      'left_hand_middle_0_joint', 'left_hand_middle_1_joint',
    ]);
    expect(jointNames('right')).toEqual([
      'right_hand_thumb_0_joint', 'right_hand_thumb_1_joint', 'right_hand_thumb_2_joint',
      'right_hand_index_0_joint', 'right_hand_index_1_joint',
      'right_hand_middle_0_joint', 'right_hand_middle_1_joint',
    ]);
  });

  it('is seven joints, and every name belongs to its own hand', () => {
    for (const side of ['left', 'right'] as const) {
      const names = jointNames(side);
      expect(names).toHaveLength(7);
      expect(names.every((n) => n.startsWith(`${side}_hand_`))).toBe(true);
    }
  });
});

describe('the two hands are mirrors, and the code knows it', () => {
  it('answers a mirrored human hand with a mirrored robot hand', () => {
    // THE test for a mirrored hand. The two solves share no code path that
    // could accidentally agree: they read different chains, with different
    // limits, from different halves of the generated table. If someone builds
    // one side's table from the other's by swapping "left" for "right", the
    // signs below stop matching.
    const left = settle(new FingerRetargeter('left', 1), openHand('left'));
    const right = settle(new FingerRetargeter('right', 1), openHand('right'));
    expect(left).toHaveLength(7);
    for (let i = 0; i < 7; i++) {
      expect(left[i]!).toBeCloseTo(-right[i]!, 6);
    }
  });

  it('curls each hand toward its own palm, not toward the robot\'s other side', () => {
    // The consequence of getting the mirror wrong: one hand opens while the
    // other closes. Stated in TIP POSITIONS, which is what an operator sees.
    for (const side of ['left', 'right'] as const) {
      const open = tipsOf(side, settle(new FingerRetargeter(side, 1), openHand(side)));
      const shut = tipsOf(side, settle(new FingerRetargeter(side, 1), pinchHand(side)));
      // A closing finger pulls its tip toward the palm — which is -y on the
      // left hand and +y on the right, because that is where each thumb is.
      const palmSign = side === 'left' ? -1 : 1;
      expect(palmSign * shut.index![1]!).toBeGreaterThan(palmSign * open.index![1]!);
    }
  });
});

describe('the pinch', () => {
  it('brings the robot thumb and index together when the human ones touch', () => {
    for (const side of ['left', 'right'] as const) {
      const r = new FingerRetargeter(side, 1);
      const openTips = tipsOf(side, settle(r, openHand(side)));
      const openGap = Math.hypot(
        openTips.thumb![0] - openTips.index![0],
        openTips.thumb![1] - openTips.index![1],
        openTips.thumb![2] - openTips.index![2],
      );
      const shutTips = tipsOf(side, settle(r, pinchHand(side)));
      const shutGap = Math.hypot(
        shutTips.thumb![0] - shutTips.index![0],
        shutTips.thumb![1] - shutTips.index![1],
        shutTips.thumb![2] - shutTips.index![2],
      );
      expect(shutGap).toBeLessThan(openGap / 2);
      // The Dex3's thumb is short: it does not literally touch. What matters is
      // that it commits rather than hovering half-open, which is exactly what
      // DexPilot's snap-to-zero is for.
      expect(shutGap).toBeLessThan(0.03);
    }
  });

  it('latches: it closes at PROJECT_DIST_M and only lets go past ESCAPE_DIST_M', () => {
    // Without the hysteresis a hand held right at the threshold chatters the
    // fingers at the stream rate, which on hardware is audible.
    const r = new FingerRetargeter('left', 1);
    // The thumb approaches the index on the far side FROM the middle finger, so
    // that only one pair is ever near its threshold — otherwise thumb-middle
    // latches at the same time and the test is measuring two things at once.
    const at = (gap: number): HandKeypoints => {
      const open = openHand('left');
      return { ...open, thumb: [open.index[0], open.index[1], open.index[2] + gap] };
    };
    const thumbIndex = (r: { pinched: [string, string][] }): boolean =>
      r.pinched.some(([a, b]) => a === 'thumb' && b === 'index');
    const between = (PROJECT_DIST_M + ESCAPE_DIST_M) / 2;
    expect(between).toBeGreaterThan(PROJECT_DIST_M);
    expect(between).toBeLessThan(ESCAPE_DIST_M);

    // Approaching from open, a gap in the middle of the band is NOT a pinch.
    expect(thumbIndex(r.solve(at(between), null))).toBe(false);
    // Close past the project distance: latched.
    expect(thumbIndex(r.solve(at(PROJECT_DIST_M * 0.5), null))).toBe(true);
    // Reopen only into the band: still latched.
    expect(thumbIndex(r.solve(at(between), null))).toBe(true);
    // Past the escape distance: released.
    expect(thumbIndex(r.solve(at(ESCAPE_DIST_M * 1.5), null))).toBe(false);
  });

  it('forgets its latches on reset', () => {
    const r = new FingerRetargeter('left', 1);
    const open = openHand('left');
    const mid = (PROJECT_DIST_M + ESCAPE_DIST_M) / 2;
    const parted: HandKeypoints = {
      ...open,
      thumb: [open.index[0], open.index[1], open.index[2] + mid],
    };
    r.solve({ ...open, thumb: open.index }, null);
    // Latched: reopening only into the hysteresis band keeps it closed…
    expect(r.solve(parted, null).pinched.some(([a, b]) => a === 'thumb' && b === 'index')).toBe(true);
    // …until the retargeter is told the session is over.
    r.reset();
    expect(r.solve(parted, null).pinched.some(([a, b]) => a === 'thumb' && b === 'index')).toBe(false);
  });
});

describe('the solver itself', () => {
  it('never returns a joint outside its advertised range', () => {
    for (const side of ['left', 'right'] as const) {
      const r = new FingerRetargeter(side, 1);
      // Including inputs no hand could make.
      for (const human of [openHand(side), pinchHand(side),
        { wrist: [0, 0, 0], thumb: [0.4, 0, 0], index: [0.4, 0, 0], middle: [-0.4, 0, 0] } as HandKeypoints]) {
        const q = settle(r, human, 30);
        let at = 0;
        for (const finger of ['thumb', 'index', 'middle'] as const) {
          for (const link of G1_FINGER_CHAINS[side][finger].links) {
            expect(q[at]!).toBeGreaterThanOrEqual(link.lower - 1e-12);
            expect(q[at]!).toBeLessThanOrEqual(link.upper + 1e-12);
            at++;
          }
        }
      }
    }
  });

  it('low-passes its output, so a step input arrives as a ramp', () => {
    // Finger tracking is the noisiest thing a headset produces and these joints
    // are small and fast; raw output buzzes visibly.
    const r = new FingerRetargeter('left', 0.2);
    const settled = settle(r, openHand('left'), 80);
    const jumped = r.solve(pinchHand('left'), settled).q;
    const target = settle(new FingerRetargeter('left', 1), pinchHand('left'));
    // One frame gets roughly a fifth of the way, not all of it.
    const travelled = Math.abs(jumped[3]! - settled[3]!);
    const distance = Math.abs(target[3]! - settled[3]!);
    expect(travelled).toBeLessThan(distance * 0.6);
    expect(travelled).toBeGreaterThan(0);
  });
});

describe('gripPose — the trigger as one grasp axis', () => {
  it('opens at 0 and closes at 1, in opposite directions on the two hands', () => {
    // The controller fallback. The left index closes toward negative and the
    // right toward positive; reading that off the LIMITS rather than writing
    // two tables is what stops a mirrored table shipping.
    const l = gripPose('left', 1);
    const r = gripPose('right', 1);
    expect(l.left_hand_index_1_joint!).toBeLessThan(0);
    expect(r.right_hand_index_1_joint!).toBeGreaterThan(0);
    expect(l.left_hand_index_1_joint!).toBeCloseTo(-r.right_hand_index_1_joint!, 9);

    const open = gripPose('left', 0);
    // `toBeCloseTo`, not `toBe`: closing toward a negative limit at grip 0
    // produces -0, which is the same angle and a different value to `Object.is`.
    for (const v of Object.values(open)) expect(v).toBeCloseTo(0, 12);
  });

  it('leaves the thumb ROTATION alone', () => {
    // thumb_0 swings the thumb across the palm. Sweeping it with the trigger
    // closes the thumb into the fingers instead of around what is between them.
    expect(gripPose('left', 1).left_hand_thumb_0_joint).toBe(0);
    expect(gripPose('right', 1).right_hand_thumb_0_joint).toBe(0);
  });

  it('stops short of the mechanical stop', () => {
    // A position-controlled joint commanded exactly to its limit sits there
    // fighting the stop, which on the real Dex3 is heat rather than grip.
    const closed = gripPose('left', 1);
    const link = G1_FINGER_CHAINS.left.index.links[1]!;
    expect(closed.left_hand_index_1_joint!).toBeGreaterThan(link.lower);
    expect(Math.abs(closed.left_hand_index_1_joint!)).toBeGreaterThan(Math.abs(link.lower) * 0.8);
  });

  it('stays inside every limit, for any trigger value including nonsense', () => {
    for (const side of ['left', 'right'] as const) {
      for (const grip of [-1, 0, 0.5, 1, 5, Number.NaN]) {
        const pose = gripPose(side, grip);
        for (const finger of ['thumb', 'index', 'middle'] as const) {
          for (const link of G1_FINGER_CHAINS[side][finger].links) {
            const v = pose[link.joint]!;
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(link.lower);
            expect(v).toBeLessThanOrEqual(link.upper);
          }
        }
      }
    }
  });
});

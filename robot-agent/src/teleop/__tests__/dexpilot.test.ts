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
  openHandReference,
  type HandKeypoints,
} from '../dexpilot.js';
import { G1_FINGER_CHAINS, type Side } from '../g1-chains.generated.js';
import { forwardKinematics } from '../kinematics.js';

/**
 * A relaxed open HUMAN hand, in the frame the browser sends: origin at the
 * wrist joint, +x along the fingers, +z toward the index side, y the palm
 * normal (which mirrors between hands, hence `palm`).
 *
 * Written from anthropometry and deliberately NOT equal to the module's own
 * `HUMAN_OPEN_HAND` — a fixture copied from the constant the calibration is
 * built on proves only that the code agrees with itself. This one has a
 * slightly longer index, a wider fingertip spread and a flatter thumb.
 *
 * The previous version of this fixture was written in the ROBOT's geometry —
 * fingertips 56 mm apart (the Dex3's own spacing; a human's are ~25 mm) and the
 * thumb 75 mm off the palm plane (a human's is ~20 mm) — which is how a solver
 * that curled an open hand 100 degrees passed every test in this file.
 */
function openHand(side: Side): HandKeypoints {
  const palm = side === 'left' ? -1 : 1; // the thumb sits on the palm side
  return {
    wrist: [0, 0, 0],
    thumb: [0.093, palm * 0.017, 0.062],
    index: [0.181, palm * 0.002, 0.016],
    middle: [0.194, 0, -0.009],
  };
}

/**
 * Thumb tip brought onto a fully extended index tip. A hard case on purpose:
 * the thumb travels the whole way alone, which is near the edge of what a human
 * hand can do and the edge of what the Dex3's short thumb can follow.
 */
function pinchHand(side: Side): HandKeypoints {
  const open = openHand(side);
  return { ...open, thumb: [open.index[0] - 0.005, open.index[1] + 0.004, open.index[2] - 0.002] };
}

/** How a person actually pinches: the index comes to meet the thumb. */
function realPinch(side: Side): HandKeypoints {
  const palm = side === 'left' ? -1 : 1;
  return {
    wrist: [0, 0, 0],
    thumb: [0.120, palm * 0.045, 0.020],
    index: [0.124, palm * 0.043, 0.018],
    middle: openHand(side).middle,
  };
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
    // THE test for a mirrored hand, stated in TIP POSITIONS. The two solves
    // share no code path that could accidentally agree: they read different
    // chains, with different limits, from different halves of the generated
    // table. Positions rather than joint values because a joint value's sign is
    // a convention of its axis and a position is what the operator sees.
    const left = tipsOf('left', settle(new FingerRetargeter('left', 1), openHand('left')));
    const right = tipsOf('right', settle(new FingerRetargeter('right', 1), openHand('right')));
    for (const finger of ['thumb', 'index', 'middle'] as const) {
      expect(left[finger]![0]!).toBeCloseTo(right[finger]![0]!, 6);
      expect(left[finger]![1]!).toBeCloseTo(-right[finger]![1]!, 6);
      expect(left[finger]![2]!).toBeCloseTo(right[finger]![2]!, 6);
    }
  });

  it('mirrors each joint the way its own axis says it should', () => {
    // The joint-value form of the same statement, and it is NOT "every value
    // negates". Mirroring is about y, so a joint whose axis is y — thumb_0, the
    // one that swings the thumb across the palm — mirrors with the SAME sign,
    // and the six z-axis flexion joints with the opposite one. The expected
    // sign is read off the two tables rather than written down, so a table
    // built by find-and-replacing "left" for "right" fails here.
    const left = settle(new FingerRetargeter('left', 1), openHand('left'));
    const right = settle(new FingerRetargeter('right', 1), openHand('right'));
    expect(left).toHaveLength(7);
    let at = 0;
    let sameSign = 0;
    for (const finger of ['thumb', 'index', 'middle'] as const) {
      const L = G1_FINGER_CHAINS.left[finger].links;
      const R = G1_FINGER_CHAINS.right[finger].links;
      for (let i = 0; i < L.length; i++) {
        const aL = L[i]!.axis;
        const aR = R[i]!.axis;
        // A rotation mirrored about y is a rotation about (-M a) by the same
        // angle, M = diag(1,-1,1). So the stored left axis being the NEGATIVE
        // of the mirrored right axis means the two hands share a sign.
        const dot = aL[0]! * aR[0]! + aL[1]! * -aR[1]! + aL[2]! * aR[2]!;
        const sign = dot < 0 ? 1 : -1;
        if (sign === 1) sameSign++;
        expect(left[at]!).toBeCloseTo(sign * right[at]!, 6);
        at++;
      }
    }
    // And the law is not vacuous: exactly one joint per hand mirrors the same
    // way round. A blanket `left === -right` passes only while thumb_0 sits at
    // zero, which is what the fixture used to arrange by accident.
    expect(sameSign).toBe(1);
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

describe('an open hand is an open hand', () => {
  // THE regression this file was missing. Before the two hands were calibrated
  // against each other, a flat open human hand drove `index_1` to -1.737 rad
  // against a -1.745 stop — MORE closed than `gripPose(side, 1)`, the
  // full-trigger fist. Every test in this file passed, because the fixture they
  // all shared was written in the robot's geometry rather than a hand's.

  it('leaves every joint near zero for the hand the calibration is built on', () => {
    for (const side of ['left', 'right'] as const) {
      const q = settle(new FingerRetargeter(side, 1), openHandReference(side));
      for (let i = 0; i < q.length; i++) expect(Math.abs(q[i]!)).toBeLessThan(1e-3);
    }
  });

  it('leaves it open for any plausible adult hand, not just that one', () => {
    // A grid over the anthropometry that actually varies between operators:
    // index and middle length, fingertip spread, and where the thumb rests.
    // The reference hand is one point in it; the bound has to hold at all of
    // them, because nobody is going to measure their hand before putting the
    // headset on.
    const fist = gripPose('left', 1).left_hand_index_1_joint!;
    let worst = 0;
    let worstJoint = '';
    let count = 0;
    for (const side of ['left', 'right'] as const) {
      const names = jointNames(side);
      const palm = side === 'left' ? -1 : 1;
      for (const indexX of [0.164, 0.176, 0.188]) {
        for (const middleX of [0.178, 0.190, 0.202]) {
          for (const indexZ of [0.006, 0.014, 0.024]) {
            for (const thumbX of [0.086, 0.098, 0.112]) {
              for (const thumbZ of [0.046, 0.058, 0.072]) {
                for (const thumbY of [0.004, 0.022, 0.040]) {
                  const q = settle(new FingerRetargeter(side, 1), {
                    wrist: [0, 0, 0],
                    thumb: [thumbX, palm * thumbY, thumbZ],
                    index: [indexX, 0, indexZ],
                    middle: [middleX, 0, -0.010],
                  }, 30);
                  count++;
                  for (let i = 0; i < q.length; i++) {
                    if (Math.abs(q[i]!) > worst) {
                      worst = Math.abs(q[i]!);
                      worstJoint = names[i]!;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(count).toBe(1458);
    // 0.22 rad measured, so 0.3 leaves room for the geometry to be re-derived
    // without re-tuning. What it must never approach again is the 1.57 rad of
    // the full-trigger fist.
    expect(worst, `worst joint ${worstJoint}`).toBeLessThan(0.3);
    expect(worst).toBeLessThan(Math.abs(fist) / 4);
  });

  it('still curls when the human hand curls — the fix is not a hand held open', () => {
    // The other half: a solver that ignored its input would also pass the two
    // tests above. A human hand closing from flat to a fist has to take the
    // robot's fingers a long way, monotonically.
    const side = 'right' as const;
    const flex: number[] = [];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = t * 1.9;
      const q = settle(new FingerRetargeter(side, 1), {
        wrist: [0, 0, 0],
        thumb: openHand(side).thumb,
        index: [0.06 + 0.121 * Math.cos(a), 0.121 * Math.sin(a), 0.016],
        middle: [0.065 + 0.129 * Math.cos(a), 0.129 * Math.sin(a), -0.009],
      }, 30);
      flex.push(q[3]!); // right_hand_index_0_joint, positive is closing
    }
    expect(flex[0]!).toBeLessThan(0.05);
    for (let i = 1; i < flex.length; i++) expect(flex[i]!).toBeGreaterThan(flex[i - 1]! - 0.05);
    // Two thirds of the travel `gripPose` uses at full trigger.
    expect(flex[flex.length - 1]!).toBeGreaterThan(
      gripPose(side, 1).right_hand_index_0_joint! * 0.6,
    );
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
      expect(shutGap).toBeLessThan(openGap / 5);
      // 33 mm, not zero — and NOT because the hand cannot: searched over its
      // joint ranges the Dex3 closes its thumb to within 0.8 mm of its index.
      // What holds it open here is the objective, correctly: the human's
      // thumb-middle pair is still wide, and one thumb cannot satisfy both. It
      // is a hard input by design (see `pinchHand`) — `realPinch` below is what
      // a person's pinch actually costs.
      expect(shutGap).toBeLessThan(0.035);
    }
  });

  it('closes to a grip when the human pinch is one a human actually makes', () => {
    // The index comes to meet the thumb rather than the thumb travelling alone,
    // which is both how people pinch and what the Dex3's short thumb can
    // follow. 15 mm between the fingertips is a grasp; 33 mm is not.
    for (const side of ['left', 'right'] as const) {
      const tips = tipsOf(side, settle(new FingerRetargeter(side, 1), realPinch(side)));
      const gap = Math.hypot(
        tips.thumb![0] - tips.index![0],
        tips.thumb![1] - tips.index![1],
        tips.thumb![2] - tips.index![2],
      );
      expect(gap).toBeLessThan(0.02);
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

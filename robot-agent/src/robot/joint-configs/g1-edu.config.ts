/**
 * @file g1-edu.config.ts
 * @description Joint configuration for Unitree G1 EDU with Dex3-1 dexterous hands (43 DOF)
 * @feature robot-types
 * @status live
 */

import type { JointConfig } from '../types.js';
import { G1_JOINTS } from './g1.config.js';
import { G1_FINGER_CHAINS } from '../../teleop/g1-chains.generated.js';

/**
 * Unitree Dex3-1 dexterous hand — 7 DOF per hand: thumb (3), index (2),
 * middle (2).
 *
 * THE LIMITS AND AXES COME FROM THE GENERATED CHAIN TABLE, which is read out of
 * the same MJCF the simulator loads and cross-checked against MuJoCo's own
 * `jnt_range` by `hardware/sim_g1_dds/test_teleop_chains.py`. They used to be
 * hand-written "reasonable placeholders for simulation/visualization", and the
 * placeholders were wrong in a way that quietly disabled half the hand:
 *
 * - They were SYMMETRIC between the sides, and the hardware is not. The left
 *   index flexes toward negative and the right toward positive.
 * - So `left_hand_index_1_joint` was declared `[0, 1.7453]` where the model says
 *   `[-1.7453, 0]` — two ranges that overlap at the single point 0, leaving the
 *   joint with NO usable travel: every command to flex it was clamped to zero
 *   by `setTeleopJoint`, by any input path, silently.
 * - FOUR joints were dead that way, and the damage was mirrored, which is
 *   exactly what a symmetric table does to an asymmetric hand: the LEFT hand
 *   lost `index_1` and `middle_1` — its fingers could not flex, though its
 *   thumb was untouched — and the RIGHT hand lost `thumb_1` and `thumb_2`, so
 *   its thumb could not close while its fingers were fine. Four more
 *   (`index_0` and `middle_0` on both sides) kept 37% of their travel.
 * - Nine of the fourteen disagreed with the model in total; all fourteen ARM
 *   joints agreed, which is why this went unnoticed for as long as nothing
 *   drove the fingers.
 *
 * Reading them from the table rather than transcribing them a third time is the
 * point. `axis` has no consumer today, so it is metadata — but it was also
 * wrong (every flexion joint was declared 'x' where the model says 'z') and a
 * wrong fact waiting for its first reader is worth correcting while it is cheap.
 */
function dex3HandJoints(side: 'left' | 'right'): JointConfig[] {
  const axisOf = (v: readonly [number, number, number]): 'x' | 'y' | 'z' => {
    const i = v.findIndex((c) => Math.abs(c) > 0.5);
    return (['x', 'y', 'z'] as const)[i === -1 ? 2 : i]!;
  };
  // Thumb, index, middle — the order the Dex3 chains are declared in. NOT the
  // DDS wire order, which lists middle before index on the LEFT hand only
  // (`hardware/sim_g1_dds/joints.py:25-27`); nothing here indexes by position.
  return (['thumb', 'index', 'middle'] as const).flatMap((finger) =>
    G1_FINGER_CHAINS[side][finger].links.map((link) => ({
      name: link.joint,
      axis: axisOf(link.axis),
      limitLower: link.lower,
      limitUpper: link.upper,
      // Both limits bracket zero on every one of these joints, so the open hand
      // is a legal pose on both sides.
      defaultPosition: 0,
    })),
  );
}

/**
 * G1 EDU joint configuration: the 29-DOF G1 body plus two Dex3-1 hands (14 DOF).
 * Total: 43 active joints.
 */
export const G1_EDU_JOINTS: JointConfig[] = [
  ...G1_JOINTS,
  ...dex3HandJoints('left'),
  ...dex3HandJoints('right'),
];

/**
 * @file g1-edu.config.ts
 * @description Joint configuration for Unitree G1 EDU with Dex3-1 dexterous hands (43 DOF)
 * @feature robot-types
 * @status live
 */

import type { JointConfig } from '../types.js';
import { G1_JOINTS } from './g1.config.js';

/**
 * Unitree Dex3-1 dexterous hand — 7 DOF per hand.
 * Layout: thumb (3 DOF), index (2 DOF), middle (2 DOF).
 *
 * NOTE: Limits below are reasonable placeholders for simulation/visualization.
 * Tune against the official Dex3-1 URDF before using for real-hardware control.
 */
function dex3HandJoints(side: 'left' | 'right'): JointConfig[] {
  const p = `${side}_hand`;
  return [
    // Thumb (3 DOF)
    { name: `${p}_thumb_0_joint`, axis: 'z', limitLower: -1.0472, limitUpper: 1.0472, defaultPosition: 0 },
    { name: `${p}_thumb_1_joint`, axis: 'x', limitLower: 0, limitUpper: 1.5708, defaultPosition: 0 },
    { name: `${p}_thumb_2_joint`, axis: 'x', limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
    // Index finger (2 DOF)
    { name: `${p}_index_0_joint`, axis: 'z', limitLower: -0.5236, limitUpper: 0.5236, defaultPosition: 0 },
    { name: `${p}_index_1_joint`, axis: 'x', limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
    // Middle finger (2 DOF)
    { name: `${p}_middle_0_joint`, axis: 'z', limitLower: -0.5236, limitUpper: 0.5236, defaultPosition: 0 },
    { name: `${p}_middle_1_joint`, axis: 'x', limitLower: 0, limitUpper: 1.7453, defaultPosition: 0 },
  ];
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

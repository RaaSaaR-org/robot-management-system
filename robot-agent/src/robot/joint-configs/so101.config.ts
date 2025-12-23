/**
 * @file so101.config.ts
 * @description Joint configuration for SO-ARM100 SO101 robotic arm
 * @feature robot-types
 */

import type { JointConfig } from '../types.js';

/**
 * SO101 robotic arm joint configuration
 * Based on SO-ARM100/Simulation/SO101/so101_new_calib.urdf
 * 6 active joints: 5 arm + 1 gripper
 */
export const SO101_JOINTS: JointConfig[] = [
  // Arm joints (base to end-effector)
  { name: 'shoulder_pan', axis: 'z', limitLower: -1.91986, limitUpper: 1.91986, defaultPosition: 0 },
  { name: 'shoulder_lift', axis: 'z', limitLower: -1.74533, limitUpper: 1.74533, defaultPosition: 0 },
  { name: 'elbow_flex', axis: 'z', limitLower: -1.69, limitUpper: 1.69, defaultPosition: 0 },
  { name: 'wrist_flex', axis: 'z', limitLower: -1.65806, limitUpper: 1.65806, defaultPosition: 0 },
  { name: 'wrist_roll', axis: 'z', limitLower: -2.74385, limitUpper: 2.84121, defaultPosition: 0 },

  // Gripper
  { name: 'gripper', axis: 'z', limitLower: -0.174533, limitUpper: 1.74533, defaultPosition: 0 },
];

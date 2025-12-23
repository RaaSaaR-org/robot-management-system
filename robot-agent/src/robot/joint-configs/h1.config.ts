/**
 * @file h1.config.ts
 * @description Joint configuration for Unitree H1 humanoid robot
 * @feature robot-types
 */

import type { JointConfig } from '../types.js';

/**
 * H1 humanoid robot joint configuration
 * Based on h1_description/urdf/h1.urdf
 * 19 active joints: 10 leg, 1 torso, 8 arm
 */
export const H1_JOINTS: JointConfig[] = [
  // Left Leg (5 joints)
  { name: 'left_hip_yaw_joint', axis: 'z', limitLower: -0.43, limitUpper: 0.43, defaultPosition: 0 },
  { name: 'left_hip_roll_joint', axis: 'x', limitLower: -0.43, limitUpper: 0.43, defaultPosition: 0 },
  { name: 'left_hip_pitch_joint', axis: 'y', limitLower: -3.14, limitUpper: 2.53, defaultPosition: 0 },
  { name: 'left_knee_joint', axis: 'y', limitLower: -0.26, limitUpper: 2.05, defaultPosition: 0 },
  { name: 'left_ankle_joint', axis: 'y', limitLower: -0.87, limitUpper: 0.52, defaultPosition: 0 },

  // Right Leg (5 joints)
  { name: 'right_hip_yaw_joint', axis: 'z', limitLower: -0.43, limitUpper: 0.43, defaultPosition: 0 },
  { name: 'right_hip_roll_joint', axis: 'x', limitLower: -0.43, limitUpper: 0.43, defaultPosition: 0 },
  { name: 'right_hip_pitch_joint', axis: 'y', limitLower: -3.14, limitUpper: 2.53, defaultPosition: 0 },
  { name: 'right_knee_joint', axis: 'y', limitLower: -0.26, limitUpper: 2.05, defaultPosition: 0 },
  { name: 'right_ankle_joint', axis: 'y', limitLower: -0.87, limitUpper: 0.52, defaultPosition: 0 },

  // Torso (1 joint)
  { name: 'torso_joint', axis: 'z', limitLower: -2.35, limitUpper: 2.35, defaultPosition: 0 },

  // Left Arm (4 joints)
  { name: 'left_shoulder_pitch_joint', axis: 'y', limitLower: -2.87, limitUpper: 2.87, defaultPosition: 0 },
  { name: 'left_shoulder_roll_joint', axis: 'x', limitLower: -0.34, limitUpper: 3.11, defaultPosition: 0 },
  { name: 'left_shoulder_yaw_joint', axis: 'z', limitLower: -1.3, limitUpper: 4.45, defaultPosition: 0 },
  { name: 'left_elbow_joint', axis: 'y', limitLower: -1.25, limitUpper: 2.61, defaultPosition: 0 },

  // Right Arm (4 joints)
  { name: 'right_shoulder_pitch_joint', axis: 'y', limitLower: -2.87, limitUpper: 2.87, defaultPosition: 0 },
  { name: 'right_shoulder_roll_joint', axis: 'x', limitLower: -3.11, limitUpper: 0.34, defaultPosition: 0 },
  { name: 'right_shoulder_yaw_joint', axis: 'z', limitLower: -4.45, limitUpper: 1.3, defaultPosition: 0 },
  { name: 'right_elbow_joint', axis: 'y', limitLower: -1.25, limitUpper: 2.61, defaultPosition: 0 },
];

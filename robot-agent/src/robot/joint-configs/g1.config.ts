/**
 * @file g1.config.ts
 * @description Joint configuration for Unitree G1 humanoid robot (29 DOF)
 * @feature robot-types
 */

import type { JointConfig } from '../types.js';

/**
 * G1 humanoid robot joint configuration
 * Based on g1_description/g1_29dof_rev_1_0.urdf
 * 29 active joints: 12 leg, 3 waist, 14 arm
 */
export const G1_JOINTS: JointConfig[] = [
  // Left Leg (6 joints)
  { name: 'left_hip_pitch_joint', axis: 'y', limitLower: -2.5307, limitUpper: 2.8798, defaultPosition: 0 },
  { name: 'left_hip_roll_joint', axis: 'x', limitLower: -0.5236, limitUpper: 2.9671, defaultPosition: 0 },
  { name: 'left_hip_yaw_joint', axis: 'z', limitLower: -2.7576, limitUpper: 2.7576, defaultPosition: 0 },
  { name: 'left_knee_joint', axis: 'y', limitLower: -0.087267, limitUpper: 2.8798, defaultPosition: 0 },
  { name: 'left_ankle_pitch_joint', axis: 'y', limitLower: -0.87267, limitUpper: 0.5236, defaultPosition: 0 },
  { name: 'left_ankle_roll_joint', axis: 'x', limitLower: -0.2618, limitUpper: 0.2618, defaultPosition: 0 },

  // Right Leg (6 joints)
  { name: 'right_hip_pitch_joint', axis: 'y', limitLower: -2.5307, limitUpper: 2.8798, defaultPosition: 0 },
  { name: 'right_hip_roll_joint', axis: 'x', limitLower: -2.9671, limitUpper: 0.5236, defaultPosition: 0 },
  { name: 'right_hip_yaw_joint', axis: 'z', limitLower: -2.7576, limitUpper: 2.7576, defaultPosition: 0 },
  { name: 'right_knee_joint', axis: 'y', limitLower: -0.087267, limitUpper: 2.8798, defaultPosition: 0 },
  { name: 'right_ankle_pitch_joint', axis: 'y', limitLower: -0.87267, limitUpper: 0.5236, defaultPosition: 0 },
  { name: 'right_ankle_roll_joint', axis: 'x', limitLower: -0.2618, limitUpper: 0.2618, defaultPosition: 0 },

  // Waist (3 joints)
  { name: 'waist_yaw_joint', axis: 'z', limitLower: -2.618, limitUpper: 2.618, defaultPosition: 0 },
  { name: 'waist_roll_joint', axis: 'x', limitLower: -0.52, limitUpper: 0.52, defaultPosition: 0 },
  { name: 'waist_pitch_joint', axis: 'y', limitLower: -0.52, limitUpper: 0.52, defaultPosition: 0 },

  // Left Arm (7 joints)
  { name: 'left_shoulder_pitch_joint', axis: 'y', limitLower: -3.0892, limitUpper: 2.6704, defaultPosition: 0 },
  { name: 'left_shoulder_roll_joint', axis: 'x', limitLower: -1.5882, limitUpper: 2.2515, defaultPosition: 0 },
  { name: 'left_shoulder_yaw_joint', axis: 'z', limitLower: -2.618, limitUpper: 2.618, defaultPosition: 0 },
  { name: 'left_elbow_joint', axis: 'y', limitLower: -1.0472, limitUpper: 2.0944, defaultPosition: 0 },
  { name: 'left_wrist_roll_joint', axis: 'x', limitLower: -1.972222, limitUpper: 1.972222, defaultPosition: 0 },
  { name: 'left_wrist_pitch_joint', axis: 'y', limitLower: -1.61443, limitUpper: 1.61443, defaultPosition: 0 },
  { name: 'left_wrist_yaw_joint', axis: 'z', limitLower: -1.61443, limitUpper: 1.61443, defaultPosition: 0 },

  // Right Arm (7 joints)
  { name: 'right_shoulder_pitch_joint', axis: 'y', limitLower: -3.0892, limitUpper: 2.6704, defaultPosition: 0 },
  { name: 'right_shoulder_roll_joint', axis: 'x', limitLower: -2.2515, limitUpper: 1.5882, defaultPosition: 0 },
  { name: 'right_shoulder_yaw_joint', axis: 'z', limitLower: -2.618, limitUpper: 2.618, defaultPosition: 0 },
  { name: 'right_elbow_joint', axis: 'y', limitLower: -1.0472, limitUpper: 2.0944, defaultPosition: 0 },
  { name: 'right_wrist_roll_joint', axis: 'x', limitLower: -1.972222, limitUpper: 1.972222, defaultPosition: 0 },
  { name: 'right_wrist_pitch_joint', axis: 'y', limitLower: -1.61443, limitUpper: 1.61443, defaultPosition: 0 },
  { name: 'right_wrist_yaw_joint', axis: 'z', limitLower: -1.61443, limitUpper: 1.61443, defaultPosition: 0 },
];

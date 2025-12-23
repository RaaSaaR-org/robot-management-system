/**
 * @file index.ts
 * @description Joint configuration exports
 * @feature robot-types
 */

export { H1_JOINTS } from './h1.config.js';
export { SO101_JOINTS } from './so101.config.js';

import type { JointConfig, RobotType } from '../types.js';
import { H1_JOINTS } from './h1.config.js';
import { SO101_JOINTS } from './so101.config.js';

/**
 * Get joint configuration for a given robot type
 */
export function getJointConfig(robotType: RobotType): JointConfig[] {
  switch (robotType) {
    case 'h1':
      return H1_JOINTS;
    case 'so101':
      return SO101_JOINTS;
    case 'generic':
    default:
      return [];
  }
}

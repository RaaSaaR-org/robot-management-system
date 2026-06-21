/**
 * @file index.ts
 * @description Joint configuration exports
 * @feature robot-types
 * @status live
 */

export { H1_JOINTS } from './h1.config.js';
export { G1_JOINTS } from './g1.config.js';
export { G1_EDU_JOINTS } from './g1-edu.config.js';
export { SO101_JOINTS } from './so101.config.js';

import type { JointConfig, RobotType } from '../types.js';
import { H1_JOINTS } from './h1.config.js';
import { G1_JOINTS } from './g1.config.js';
import { G1_EDU_JOINTS } from './g1-edu.config.js';
import { SO101_JOINTS } from './so101.config.js';

/**
 * Get joint configuration for a given robot type
 */
export function getJointConfig(robotType: RobotType): JointConfig[] {
  switch (robotType) {
    case 'h1':
      return H1_JOINTS;
    case 'g1':
      return G1_JOINTS;
    case 'g1_edu':
      return G1_EDU_JOINTS;
    case 'so101':
      return SO101_JOINTS;
    case 'generic':
    default:
      return [];
  }
}

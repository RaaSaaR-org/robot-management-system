/**
 * @file simRobot.ts
 * @description Whether a robot is a simulated one — the fleet's one rule for
 *              it, shared by the session page and the Teleop tab (TASK-453)
 * @feature robots
 */

import type { Robot } from '../types/robots.types';

/** A simulated robot: its id starts with `sim-`, or its model says sim. */
export function isSimRobot(robot: Pick<Robot, 'id' | 'model'>): boolean {
  return robot.id.startsWith('sim-') || /sim/i.test(robot.model ?? '');
}

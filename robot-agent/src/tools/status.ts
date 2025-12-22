/**
 * @file status.ts
 * @description Genkit tools for robot status queries and emergency controls
 */

import { ai, z } from '../agent/genkit.js';
import type { RobotStateManager } from '../robot/state.js';

// Global reference to robot state manager (set by main)
let robotStateManager: RobotStateManager;

export function setRobotStateManager(manager: RobotStateManager): void {
  robotStateManager = manager;
}

export const getRobotStatus = ai.defineTool(
  {
    name: 'getRobotStatus',
    description:
      'Get the current status of the robot including location, battery level, status, and any held objects. Call with no parameters.',
    inputSchema: z.object({
      verbose: z.boolean().optional().describe('Whether to include detailed info'),
    }),
  },
  async () => {
    console.log('[Tool:getRobotStatus]');

    if (!robotStateManager) {
      return {
        success: false,
        message: 'Robot state manager not initialized',
      };
    }

    const state = robotStateManager.getState();

    return {
      success: true,
      robotId: state.id,
      robotName: state.name,
      status: state.status,
      location: state.location,
      batteryLevel: Math.round(state.batteryLevel),
      batteryStatus:
        state.batteryLevel > 50
          ? 'Good'
          : state.batteryLevel > 20
            ? 'Low'
            : 'Critical',
      heldObject: state.heldObject || null,
      currentTask: state.currentTaskName || null,
      speed: state.speed,
      errors: state.errors,
      warnings: state.warnings,
    };
  }
);

export const emergencyStop = ai.defineTool(
  {
    name: 'emergencyStop',
    description:
      'Immediately halt all robot operations. Use this for emergency situations or when immediate stop is required. Call with no parameters.',
    inputSchema: z.object({
      reason: z.string().optional().describe('Reason for emergency stop'),
    }),
  },
  async () => {
    console.log('[Tool:emergencyStop] EMERGENCY STOP ACTIVATED');

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized' };
    }

    const result = await robotStateManager.emergencyStop();
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.message,
      finalLocation: state.location,
      status: state.status,
    };
  }
);

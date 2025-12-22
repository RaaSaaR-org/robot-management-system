/**
 * @file manipulation.ts
 * @description Genkit tools for robot manipulation commands (pickup, drop)
 */

import { ai, z } from '../agent/genkit.js';
import type { RobotStateManager } from '../robot/state.js';

// Global reference to robot state manager (set by main)
let robotStateManager: RobotStateManager;

export function setRobotStateManager(manager: RobotStateManager): void {
  robotStateManager = manager;
}

export const pickupObject = ai.defineTool(
  {
    name: 'pickupObject',
    description:
      'Pick up an object at the current location. The robot must not already be holding something.',
    inputSchema: z.object({
      objectId: z.string().describe('Identifier or name of the object to pick up'),
    }),
  },
  async ({ objectId }) => {
    console.log('[Tool:pickupObject]', objectId);

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized' };
    }

    const result = await robotStateManager.pickup(objectId);
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.message,
      heldObject: state.heldObject || null,
      location: state.location,
    };
  }
);

export const dropObject = ai.defineTool(
  {
    name: 'dropObject',
    description:
      'Drop the currently held object at the current location. The robot must be holding something. Call with no parameters.',
    inputSchema: z.object({
      gentle: z.boolean().optional().describe('Whether to drop gently'),
    }),
  },
  async () => {
    console.log('[Tool:dropObject]');

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized' };
    }

    const result = await robotStateManager.drop();
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.message,
      droppedAt: state.location,
    };
  }
);

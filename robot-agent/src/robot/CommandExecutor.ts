/**
 * @file CommandExecutor.ts
 * @description Handles robot command execution
 * @feature robot
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SimulatedRobotState,
  RobotLocation,
  RobotCommand,
  CommandResult,
  CommandType,
} from './types.js';
import {
  getChargingStationLocation,
  getHomeLocation,
} from '../tools/navigation.js';

/**
 * Callback to update robot state
 */
export type StateUpdater = (updater: (state: SimulatedRobotState) => void) => void;

/**
 * Configuration for command executor
 */
export interface CommandExecutorConfig {
  speedUnitsPerSecond: number;
}

/**
 * Handles execution of robot commands (move, pickup, drop, etc.)
 */
export class CommandExecutor {
  private commandHistory: RobotCommand[] = [];
  private readonly config: CommandExecutorConfig;
  private stateGetter: () => SimulatedRobotState;
  private stateUpdater: StateUpdater;

  constructor(
    config: CommandExecutorConfig,
    stateGetter: () => SimulatedRobotState,
    stateUpdater: StateUpdater
  ) {
    this.config = config;
    this.stateGetter = stateGetter;
    this.stateUpdater = stateUpdater;
  }

  /**
   * Get command history
   */
  getHistory(): RobotCommand[] {
    return [...this.commandHistory];
  }

  /**
   * Execute a command by type
   */
  async execute(type: CommandType, payload: Record<string, unknown> = {}): Promise<RobotCommand> {
    const state = this.stateGetter();
    const command: RobotCommand = {
      id: uuidv4(),
      robotId: state.id,
      type,
      payload,
      status: 'pending',
      priority: (payload.priority as 'low' | 'normal' | 'high' | 'critical') || 'normal',
      createdAt: new Date().toISOString(),
    };

    this.commandHistory.unshift(command);
    if (this.commandHistory.length > 100) {
      this.commandHistory.pop();
    }

    command.status = 'executing';
    command.startedAt = new Date().toISOString();

    let result: CommandResult;

    switch (type) {
      case 'move':
        const destination = payload.destination as RobotLocation | undefined;
        if (destination) {
          result = await this.moveTo(destination);
        } else {
          result = { success: false, message: 'No destination provided' };
        }
        break;
      case 'stop':
        result = await this.stop();
        break;
      case 'pickup':
        const objectId = payload.objectId as string | undefined;
        if (objectId) {
          result = await this.pickup(objectId);
        } else {
          result = { success: false, message: 'No object ID provided' };
        }
        break;
      case 'drop':
        result = await this.drop();
        break;
      case 'charge':
        result = await this.goToCharge();
        break;
      case 'return_home':
        result = await this.returnHome();
        break;
      case 'emergency_stop':
        result = await this.emergencyStop();
        break;
      default:
        result = { success: false, message: `Unknown command type: ${type}` };
    }

    command.status = result.success ? 'completed' : 'failed';
    command.completedAt = new Date().toISOString();
    command.result = result.data;
    if (!result.success) {
      command.errorMessage = result.message;
    }

    return command;
  }

  /**
   * Move to a location
   */
  async moveTo(location: RobotLocation): Promise<CommandResult> {
    const state = this.stateGetter();

    if (state.status === 'charging') {
      return { success: false, message: 'Cannot move while charging. Unplug first.' };
    }
    if (state.status === 'error') {
      return { success: false, message: 'Robot is in error state. Clear errors first.' };
    }
    if (state.batteryLevel < 5) {
      return { success: false, message: 'Battery too low to move. Charge required.' };
    }

    const distance = this.calculateDistance(state.location, location);
    const estimatedTime = Math.ceil(distance / this.config.speedUnitsPerSecond);

    this.stateUpdater((s) => {
      s.targetLocation = location;
      s.status = 'busy';
      s.currentTaskName = `Moving to (${location.x.toFixed(1)}, ${location.y.toFixed(1)})`;
    });

    return {
      success: true,
      message: `Moving to location (${location.x.toFixed(1)}, ${location.y.toFixed(1)})`,
      estimatedTime,
      data: { distance, destination: location },
    };
  }

  /**
   * Pick up an object
   */
  async pickup(objectId: string): Promise<CommandResult> {
    const state = this.stateGetter();

    if (state.heldObject) {
      return { success: false, message: `Already holding object: ${state.heldObject}` };
    }
    if (state.status === 'busy') {
      return { success: false, message: 'Robot is busy. Wait for current task to complete.' };
    }

    this.stateUpdater((s) => {
      s.heldObject = objectId;
      s.currentTaskName = `Holding: ${objectId}`;
      s.updatedAt = new Date().toISOString();
    });

    return {
      success: true,
      message: `Picked up object: ${objectId}`,
      data: { objectId },
    };
  }

  /**
   * Drop held object
   */
  async drop(): Promise<CommandResult> {
    const state = this.stateGetter();

    if (!state.heldObject) {
      return { success: false, message: 'Not holding any object' };
    }

    const droppedObject = state.heldObject;

    this.stateUpdater((s) => {
      s.heldObject = undefined;
      s.currentTaskName = undefined;
      s.updatedAt = new Date().toISOString();
    });

    return {
      success: true,
      message: `Dropped object: ${droppedObject}`,
      data: { objectId: droppedObject, location: state.location },
    };
  }

  /**
   * Stop movement
   */
  async stop(): Promise<CommandResult> {
    const state = this.stateGetter();

    this.stateUpdater((s) => {
      s.targetLocation = undefined;
      s.speed = 0;
      if (s.status === 'busy') {
        s.status = 'online';
      }
      s.currentTaskName = undefined;
      s.updatedAt = new Date().toISOString();
    });

    return {
      success: true,
      message: 'Movement stopped',
      data: { location: state.location },
    };
  }

  /**
   * Emergency stop - immediate halt
   */
  async emergencyStop(): Promise<CommandResult> {
    const state = this.stateGetter();

    this.stateUpdater((s) => {
      s.targetLocation = undefined;
      s.speed = 0;
      s.status = 'online';
      s.currentTaskName = 'Emergency stop activated';
      s.warnings.push('Emergency stop was activated');
      s.updatedAt = new Date().toISOString();
    });

    return {
      success: true,
      message: 'EMERGENCY STOP ACTIVATED - All movement halted',
      data: { location: state.location },
    };
  }

  /**
   * Navigate to charging station
   */
  async goToCharge(): Promise<CommandResult> {
    const chargingStation = await getChargingStationLocation();
    const result = await this.moveTo(chargingStation);
    if (result.success) {
      result.message = `Navigating to charging station at (${chargingStation.x}, ${chargingStation.y})`;
    }
    return result;
  }

  /**
   * Return to home location
   */
  async returnHome(): Promise<CommandResult> {
    const home = await getHomeLocation();
    const result = await this.moveTo(home);
    if (result.success) {
      result.message = `Returning to home base at (${home.x}, ${home.y})`;
    }
    return result;
  }

  /**
   * Calculate distance between two locations
   */
  private calculateDistance(from: RobotLocation, to: RobotLocation): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

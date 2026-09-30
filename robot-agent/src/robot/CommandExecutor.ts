/**
 * @file CommandExecutor.ts
 * @description Handles robot command execution
 * @feature robot
 * @status live
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SimulatedRobotState,
  RobotLocation,
  RobotCommand,
  CommandResult,
  CommandType,
} from './types.js';
import type { Action, ActionResult } from '../vla/types.js';
import {
  getChargingStationLocation,
  getHomeLocation,
  resolveMoveTarget,
} from '../tools/navigation.js';
import {
  agentModeController,
  type MoveWalkOutcome,
  type MoveWalkStart,
  type MoveWalkTarget,
} from '../agent-mode/agent-mode-controller.js';

/**
 * Callback to update robot state
 */
export type StateUpdater = (updater: (state: SimulatedRobotState) => void) => void;

/**
 * Stops whatever Agent Mode is executing. Injectable so tests do not have to
 * reach the process-wide controller singleton; the default is that singleton.
 */
export type AgentEstop = (
  reason: string
) => Promise<{ stopped: boolean; delivered?: boolean; deliveryError?: string }>;

const defaultAgentEstop: AgentEstop = (reason) => agentModeController.estop(reason);

/**
 * Real locomotion for `move` (TASK-336). On a robot whose pose comes from the
 * hardware sidecar (the MuJoCo `sim_g1_dds`, a real G1) the kinematic
 * `SimulationEngine` moves nothing, so a move is handed to the Agent Mode walk
 * path instead. Injectable so tests need neither the sidecar nor the
 * process-wide controller.
 */
export interface MoveLocomotion {
  /** True while the robot's position comes from the hardware sidecar. */
  engaged(): boolean;
  /** Start walking; the result's `done` settles when the walk has finished. */
  walkTo(target: MoveWalkTarget): Promise<MoveWalkStart>;
  /** Abort a walk {@link MoveLocomotion.walkTo} started; false when none is running. */
  stop(reason: string): boolean;
}

/**
 * The production {@link MoveLocomotion}: the process-wide Agent Mode
 * controller's walk path, engaged whenever `engaged` says the pose comes from
 * the sidecar.
 */
export function agentModeLocomotion(engaged: () => boolean): MoveLocomotion {
  return {
    engaged,
    walkTo: (target) => agentModeController.walkTo(target),
    stop: (reason) => agentModeController.stopMoveWalk(reason),
  };
}

/**
 * Configuration for command executor
 */
export interface CommandExecutorConfig {
  speedUnitsPerSecond: number;
  /** Override for the Agent Mode E-Stop hook (tests). */
  agentEstop?: AgentEstop;
  /** Real locomotion for `move` on a sidecar-backed robot; absent = kinematic only. */
  locomotion?: MoveLocomotion;
}

/** A move that was accepted, plus — on real locomotion — when it really ends. */
interface MoveStart {
  result: CommandResult;
  /** Present only for a walk: settles with how the walk ended. */
  walk?: Promise<MoveWalkOutcome>;
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
    let walk: Promise<MoveWalkOutcome> | undefined;

    switch (type) {
      case 'move':
        const destination = payload.destination as
          | { x?: number; y?: number; place?: string; floor?: string }
          | undefined;
        if (destination) {
          // A place by name, or coordinates — either way, never into a keepout.
          const target = resolveMoveTarget(destination);
          if (target.ok) {
            ({ result, walk } = await this.beginMove(target.location));
          } else {
            result = { success: false, message: target.message, ...(target.keepout ? { data: { keepout: target.keepout } } : {}) };
          }
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
        ({ result, walk } = await this.beginCharge());
        break;
      case 'return_home':
        ({ result, walk } = await this.beginReturnHome());
        break;
      case 'emergency_stop':
        result = await this.emergencyStop();
        break;
      default:
        result = { success: false, message: `Unknown command type: ${type}` };
    }

    if (result.success && walk) {
      // A real walk (TASK-336): the command stays `executing` until the robot
      // has actually arrived or given up. The history holds this same object,
      // so `GET /commands` shows the final status once it lands.
      command.result = { ...result.data, message: result.message };
      void walk.then((outcome) => {
        command.status = outcome.ok ? 'completed' : 'failed';
        command.completedAt = new Date().toISOString();
        if (outcome.ok) command.result = { ...command.result, message: outcome.message };
        else command.errorMessage = outcome.message;
      });
      return command;
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
    return (await this.beginMove(location)).result;
  }

  /**
   * Start a move. On a pure-sim robot this sets the kinematic target and is
   * done; on a sidecar-backed robot it starts a real walk and returns it as
   * `walk`, which settles only when the walk ends (TASK-336).
   */
  private async beginMove(location: RobotLocation): Promise<MoveStart> {
    const state = this.stateGetter();

    if (state.status === 'charging') {
      return { result: { success: false, message: 'Cannot move while charging. Unplug first.' } };
    }
    if (state.status === 'error') {
      return { result: { success: false, message: 'Robot is in error state. Clear errors first.' } };
    }
    if (state.batteryLevel < 5) {
      return { result: { success: false, message: 'Battery too low to move. Charge required.' } };
    }

    const distance = this.calculateDistance(state.location, location);

    const locomotion = this.config.locomotion;
    if (locomotion?.engaged()) return this.beginWalk(locomotion, location, distance);

    const estimatedTime = Math.ceil(distance / this.config.speedUnitsPerSecond);
    this.stateUpdater((s) => {
      s.targetLocation = location;
      s.status = 'busy';
      s.currentTaskName = `Moving to (${location.x.toFixed(1)}, ${location.y.toFixed(1)})`;
    });

    return {
      result: {
        success: true,
        message: `Moving to location (${location.x.toFixed(1)}, ${location.y.toFixed(1)})`,
        estimatedTime,
        data: { distance, destination: location },
      },
    };
  }

  /**
   * Hand a move to real locomotion. No `targetLocation` is set: the kinematic
   * engine must not drag the pose around while odometry owns it. The robot is
   * `busy` for exactly as long as the walk runs.
   */
  private async beginWalk(
    locomotion: MoveLocomotion,
    location: RobotLocation,
    distance: number,
  ): Promise<MoveStart> {
    let start: MoveWalkStart;
    try {
      start = await locomotion.walkTo({ x: location.x, y: location.y, place: location.place ?? null });
    } catch (error) {
      start = { ok: false, message: `move failed to start: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!start.ok) {
      return { result: { success: false, message: start.message, data: { destination: location } } };
    }

    const taskName = `Walking to ${location.place ?? `(${location.x.toFixed(1)}, ${location.y.toFixed(1)})`}`;
    this.stateUpdater((s) => {
      s.status = 'busy';
      s.currentTaskName = taskName;
    });
    const walk = start.done.then((outcome) => {
      this.stateUpdater((s) => {
        // Only undo what this walk set: an E-Stop or an error that landed in
        // the meantime owns the status now.
        if (s.status === 'busy' && s.currentTaskName === taskName) {
          s.status = 'online';
          s.currentTaskName = undefined;
        }
      });
      return outcome;
    });

    return {
      result: {
        success: true,
        message: `${start.message} — the command completes when the robot arrives`,
        data: { distance, destination: location, locomotion: 'walk', planId: start.planId },
      },
      walk,
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
    // A `move` on real locomotion is an Agent Mode walk (TASK-336); clearing
    // the kinematic target below would not stop it.
    const walkStopped = this.config.locomotion?.stop('Stop command received') ?? false;

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
      message: walkStopped ? 'Movement stopped — the running walk was aborted' : 'Movement stopped',
      data: { location: state.location, ...(walkStopped ? { walkAborted: true } : {}) },
    };
  }

  /**
   * Emergency stop — commands an immediate halt.
   *
   * TASK-194: this is the `emergency_stop` command path (`roboctl estop`, the
   * server's fleet commands, the Genkit `emergencyStop` tool). Clearing the
   * simulated target and speed does NOT stop an Agent Mode plan — that drives
   * the robot through its own LocoClient loop — so the stop is forwarded to the
   * Agent Mode controller, which aborts the plan, damps the base and latches the
   * SafetyMonitor's E-stop.
   *
   * HONESTY (TASK-194): the returned message says what was *commanded*. This
   * executor has no feedback channel that could confirm the physical robot
   * stopped, so it must not claim "all movement halted".
   */
  async emergencyStop(): Promise<CommandResult> {
    const state = this.stateGetter();

    // Local state first, and deliberately so: it is synchronous and cannot fail,
    // whereas the Agent Mode stop below goes over HTTP to the sidecar. Every one
    // of those requests is bounded by an AbortSignal.timeout, but "bounded" still
    // means seconds. Nothing about an E-Stop should wait on a network round trip
    // that a slow or dead sidecar can stretch out.
    this.stateUpdater((s) => {
      s.targetLocation = undefined;
      s.speed = 0;
      s.status = 'online';
      s.currentTaskName = 'Emergency stop activated';
      s.warnings.push('Emergency stop was activated');
      s.updatedAt = new Date().toISOString();
    });

    let agentModeStopped = false;
    let agentModeError: string | undefined;
    try {
      const result = await (this.config.agentEstop ?? defaultAgentEstop)(
        'Emergency stop command received'
      );
      agentModeStopped = result.stopped;
      // Latched locally but not confirmed by the sidecar — say so, the same
      // way a thrown stop is reported.
      if (result.delivered === false) {
        agentModeError = result.deliveryError ?? 'stop/damp not confirmed by the sidecar';
      }
    } catch (error) {
      agentModeError = error instanceof Error ? error.message : String(error);
      console.error('[CommandExecutor] Agent Mode E-Stop failed:', agentModeError);
    }

    const parts = ['EMERGENCY STOP commanded'];
    parts.push(
      agentModeStopped
        ? 'the running Agent Mode plan was aborted'
        : 'no Agent Mode plan was running'
    );
    if (agentModeError) parts.push(`Agent Mode E-Stop FAILED: ${agentModeError}`);
    parts.push('physical halt not verified by this agent');

    return {
      // An E-Stop that could not reach Agent Mode is reported as a failure —
      // the caller must not read it as "the robot is stopped".
      success: agentModeError === undefined,
      message: parts.join(' — '),
      data: {
        location: state.location,
        agentModeStopped,
        ...(agentModeError ? { agentModeError } : {}),
      },
    };
  }

  /**
   * Navigate to charging station
   */
  async goToCharge(): Promise<CommandResult> {
    return (await this.beginCharge()).result;
  }

  private async beginCharge(): Promise<MoveStart> {
    let chargingStation;
    try {
      chargingStation = await getChargingStationLocation();
    } catch (error) {
      return { result: { success: false, message: error instanceof Error ? error.message : String(error) } };
    }
    const start = await this.beginMove(chargingStation);
    if (start.result.success) {
      start.result.message = `Navigating to charging station at (${chargingStation.x}, ${chargingStation.y})`;
    }
    return start;
  }

  /**
   * Return to home location
   */
  async returnHome(): Promise<CommandResult> {
    return (await this.beginReturnHome()).result;
  }

  private async beginReturnHome(): Promise<MoveStart> {
    const home = await getHomeLocation();
    const start = await this.beginMove(home);
    if (start.result.success) {
      start.result.message = `Returning to home base at (${home.x}, ${home.y})`;
    }
    return start;
  }

  /**
   * Calculate distance between two locations
   */
  private calculateDistance(from: RobotLocation, to: RobotLocation): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ============================================================================
  // VLA Action Execution (Task 46)
  // ============================================================================

  /**
   * Execute a VLA action on the robot.
   * Maps normalized joint commands to robot state updates.
   *
   * @param action VLA action with normalized joint commands [-1, 1]
   * @returns ActionResult indicating success or failure
   */
  async executeVLAAction(action: Action): Promise<ActionResult> {
    const state = this.stateGetter();
    const timestamp = Date.now();

    // Validate robot is in a state that can accept VLA commands
    if (state.status === 'error') {
      return {
        success: false,
        error: 'Robot is in error state. Cannot execute VLA action.',
        timestamp,
      };
    }

    if (state.status === 'charging') {
      return {
        success: false,
        error: 'Robot is charging. Disconnect charger before VLA control.',
        timestamp,
      };
    }

    // Validate action within safety limits
    const validationResult = this.validateVLAAction(action);
    if (!validationResult.valid) {
      return {
        success: false,
        error: `Action validation failed: ${validationResult.reason}`,
        timestamp,
      };
    }

    // Apply action to robot state
    // In simulation, we convert normalized joint commands to position deltas
    try {
      this.stateUpdater((s) => {
        // Map joint commands to position changes (simplified simulation)
        // Assuming jointCommands[0] = forward/backward velocity, jointCommands[1] = left/right velocity
        const forwardVelocity = action.jointCommands[0] ?? 0;
        const lateralVelocity = action.jointCommands[1] ?? 0;

        // Scale by velocity factor (normalized [-1, 1] -> actual units)
        const velocityScale = this.config.speedUnitsPerSecond * 0.02; // 20ms tick

        const dx = forwardVelocity * velocityScale;
        const dy = lateralVelocity * velocityScale;

        // Update position
        s.location = {
          x: s.location.x + dx,
          y: s.location.y + dy,
          place: s.location.place,
        };

        // Update heading based on movement direction
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          s.location.heading = Math.atan2(dy, dx) * (180 / Math.PI);
        }

        // Update gripper state
        if (action.gripperCommand !== undefined) {
          // gripperCommand: 0 = open, 1 = closed
          // Map to held object state (simplified)
          if (action.gripperCommand > 0.5 && !s.heldObject) {
            s.currentTaskName = 'VLA: Gripper closed';
          } else if (action.gripperCommand < 0.5 && s.heldObject) {
            s.currentTaskName = 'VLA: Gripper open';
          }
        }

        // Update speed indicator
        s.speed = Math.sqrt(dx * dx + dy * dy) / 0.02; // Convert back to units/sec

        // Mark as busy during VLA control
        if (s.status === 'online') {
          s.status = 'busy';
        }

        s.updatedAt = new Date().toISOString();
      });

      return {
        success: true,
        appliedAction: action,
        timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to apply VLA action: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp,
      };
    }
  }

  /**
   * Validate a VLA action against safety constraints.
   */
  private validateVLAAction(action: Action): { valid: boolean; reason?: string } {
    // Check jointCommands is defined and is an array
    if (!action.jointCommands || !Array.isArray(action.jointCommands)) {
      return {
        valid: false,
        reason: 'jointCommands is required and must be an array',
      };
    }

    // Check gripperCommand is defined
    if (typeof action.gripperCommand !== 'number') {
      return {
        valid: false,
        reason: 'gripperCommand is required and must be a number',
      };
    }

    // Check joint commands are in valid range [-1, 1]
    for (let i = 0; i < action.jointCommands.length; i++) {
      const cmd = action.jointCommands[i];
      if (cmd < -1 || cmd > 1) {
        return {
          valid: false,
          reason: `Joint command ${i} out of range: ${cmd} (expected [-1, 1])`,
        };
      }
    }

    // Check gripper command is in valid range [0, 1]
    if (action.gripperCommand < 0 || action.gripperCommand > 1) {
      return {
        valid: false,
        reason: `Gripper command out of range: ${action.gripperCommand} (expected [0, 1])`,
      };
    }

    // Check timestamp is reasonable (not too old or too far in future)
    const now = Date.now() / 1000;
    const maxDrift = 5; // 5 seconds max drift
    if (Math.abs(action.timestamp - now) > maxDrift) {
      return {
        valid: false,
        reason: `Action timestamp too far from current time: ${action.timestamp} vs ${now}`,
      };
    }

    return { valid: true };
  }

  /**
   * Stop VLA control and return to idle state.
   */
  stopVLAControl(): void {
    this.stateUpdater((s) => {
      s.speed = 0;
      if (s.status === 'busy') {
        s.status = 'online';
      }
      s.currentTaskName = undefined;
      s.updatedAt = new Date().toISOString();
    });
  }
}

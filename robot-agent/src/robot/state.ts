/**
 * @file state.ts
 * @description Robot state management with simulation
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SimulatedRobotState,
  RobotConfig,
  RobotStatus,
  RobotLocation,
  Robot,
  RobotTelemetry,
  RobotCommand,
  CommandResult,
  CommandType,
  PushedTask,
} from './types.js';
import { generateTelemetry } from './telemetry.js';
import {
  getChargingStationLocation,
  getHomeLocation,
} from '../tools/navigation.js';

type StateListener = (state: SimulatedRobotState) => void;

export class RobotStateManager {
  private state: SimulatedRobotState;
  private simulationInterval: NodeJS.Timeout | null = null;
  private listeners: Set<StateListener> = new Set();
  private commandHistory: RobotCommand[] = [];
  private readonly SIMULATION_TICK_MS = 100;
  private readonly SPEED_UNITS_PER_SECOND = 2.0;
  private readonly BATTERY_DRAIN_PER_SECOND = 0.01;

  // Cached charging station location (prefetched from server)
  private cachedChargingStation: RobotLocation | null = null;

  // Task queue (pushed from server)
  private taskQueue: PushedTask[] = [];
  private currentTask: PushedTask | null = null;
  private readonly MAX_QUEUE_SIZE = 5;

  constructor(config: RobotConfig) {
    const now = new Date().toISOString();
    this.state = {
      id: config.id,
      name: config.name,
      model: config.model,
      serialNumber: `SIM-${Date.now()}`,
      robotClass: config.robotClass,
      robotType: config.robotType,
      maxPayloadKg: config.maxPayloadKg,
      description: config.description,
      status: 'online',
      batteryLevel: 95 + Math.random() * 5,
      location: { ...config.initialLocation, heading: 0 },
      capabilities: config.capabilities,
      firmware: 'sim-v1.0.0',
      ipAddress: '127.0.0.1',
      speed: 0,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
      errors: [],
      warnings: [],
    };
  }

  // ============================================================================
  // STATE ACCESSORS
  // ============================================================================

  getState(): SimulatedRobotState {
    return { ...this.state };
  }

  getRobotInterface(): Robot {
    return {
      id: this.state.id,
      name: this.state.name,
      model: this.state.model,
      serialNumber: this.state.serialNumber,
      status: this.state.status,
      batteryLevel: Math.round(this.state.batteryLevel),
      location: { ...this.state.location },
      lastSeen: this.state.lastSeen,
      currentTaskId: this.state.currentTaskId,
      currentTaskName: this.state.currentTaskName,
      capabilities: [...this.state.capabilities],
      firmware: this.state.firmware,
      ipAddress: this.state.ipAddress,
      metadata: {
        heldObject: this.state.heldObject,
        isSimulated: true,
        robotClass: this.state.robotClass,
        robotType: this.state.robotType,
        maxPayloadKg: this.state.maxPayloadKg,
        description: this.state.description,
      },
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  getTelemetry(): RobotTelemetry {
    return generateTelemetry(this.state);
  }

  getCommandHistory(): RobotCommand[] {
    return [...this.commandHistory];
  }

  // ============================================================================
  // COMMAND HANDLERS
  // ============================================================================

  async moveTo(location: RobotLocation): Promise<CommandResult> {
    if (this.state.status === 'charging') {
      return { success: false, message: 'Cannot move while charging. Unplug first.' };
    }
    if (this.state.status === 'error') {
      return { success: false, message: 'Robot is in error state. Clear errors first.' };
    }
    if (this.state.batteryLevel < 5) {
      return { success: false, message: 'Battery too low to move. Charge required.' };
    }

    const distance = this.calculateDistance(this.state.location, location);
    const estimatedTime = Math.ceil(distance / this.SPEED_UNITS_PER_SECOND);

    this.state.targetLocation = location;
    this.state.status = 'busy';
    this.state.currentTaskName = `Moving to (${location.x.toFixed(1)}, ${location.y.toFixed(1)})`;
    this.notifyListeners();

    return {
      success: true,
      message: `Moving to location (${location.x.toFixed(1)}, ${location.y.toFixed(1)})`,
      estimatedTime,
      data: { distance, destination: location },
    };
  }

  async pickup(objectId: string): Promise<CommandResult> {
    if (this.state.heldObject) {
      return { success: false, message: `Already holding object: ${this.state.heldObject}` };
    }
    if (this.state.status === 'busy') {
      return { success: false, message: 'Robot is busy. Wait for current task to complete.' };
    }

    this.state.heldObject = objectId;
    this.state.currentTaskName = `Holding: ${objectId}`;
    this.state.updatedAt = new Date().toISOString();
    this.notifyListeners();

    return {
      success: true,
      message: `Picked up object: ${objectId}`,
      data: { objectId },
    };
  }

  async drop(): Promise<CommandResult> {
    if (!this.state.heldObject) {
      return { success: false, message: 'Not holding any object' };
    }

    const droppedObject = this.state.heldObject;
    this.state.heldObject = undefined;
    this.state.currentTaskName = undefined;
    this.state.updatedAt = new Date().toISOString();
    this.notifyListeners();

    return {
      success: true,
      message: `Dropped object: ${droppedObject}`,
      data: { objectId: droppedObject, location: this.state.location },
    };
  }

  async stop(): Promise<CommandResult> {
    this.state.targetLocation = undefined;
    this.state.speed = 0;
    if (this.state.status === 'busy') {
      this.state.status = 'online';
    }
    this.state.currentTaskName = undefined;
    this.state.updatedAt = new Date().toISOString();
    this.notifyListeners();

    return {
      success: true,
      message: 'Movement stopped',
      data: { location: this.state.location },
    };
  }

  async emergencyStop(): Promise<CommandResult> {
    this.state.targetLocation = undefined;
    this.state.speed = 0;
    this.state.status = 'online';
    this.state.currentTaskName = 'Emergency stop activated';
    this.state.warnings.push('Emergency stop was activated');
    this.state.updatedAt = new Date().toISOString();
    this.notifyListeners();

    return {
      success: true,
      message: 'EMERGENCY STOP ACTIVATED - All movement halted',
      data: { location: this.state.location },
    };
  }

  async goToCharge(): Promise<CommandResult> {
    // Get charging station from server (single source of truth)
    const chargingStation = await getChargingStationLocation();
    const result = await this.moveTo(chargingStation);
    if (result.success) {
      result.message = `Navigating to charging station at (${chargingStation.x}, ${chargingStation.y})`;
    }
    return result;
  }

  async returnHome(): Promise<CommandResult> {
    // Get home location from server (single source of truth)
    const home = await getHomeLocation();
    const result = await this.moveTo(home);
    if (result.success) {
      result.message = `Returning to home base at (${home.x}, ${home.y})`;
    }
    return result;
  }

  // ============================================================================
  // COMMAND EXECUTION
  // ============================================================================

  async executeCommand(type: CommandType, payload: Record<string, unknown> = {}): Promise<RobotCommand> {
    const command: RobotCommand = {
      id: uuidv4(),
      robotId: this.state.id,
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

  // ============================================================================
  // SIMULATION
  // ============================================================================

  startSimulation(): void {
    if (this.simulationInterval) return;

    console.log(`[RobotState] Starting simulation for ${this.state.name}`);

    // Prefetch charging station location from server
    getChargingStationLocation()
      .then((loc) => {
        this.cachedChargingStation = loc;
        console.log(
          `[RobotState] Cached charging station location: (${loc.x}, ${loc.y})`
        );
      })
      .catch((error) => {
        console.error('[RobotState] Failed to fetch charging station location:', error);
        // Use fallback default location
        this.cachedChargingStation = { x: 0, y: 0, floor: '1', zone: 'charging' };
      });

    this.simulationInterval = setInterval(() => {
      this.simulationTick();
    }, this.SIMULATION_TICK_MS);
  }

  stopSimulation(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
      console.log(`[RobotState] Stopped simulation for ${this.state.name}`);
    }
  }

  private simulationTick(): void {
    const deltaTime = this.SIMULATION_TICK_MS / 1000;
    let stateChanged = false;

    // Update position if moving
    if (this.state.targetLocation && this.state.status === 'busy') {
      const moved = this.updatePosition(deltaTime);
      stateChanged = moved;
    }

    // Drain battery
    if (this.state.status !== 'charging') {
      const drainRate = this.state.status === 'busy' ? this.BATTERY_DRAIN_PER_SECOND * 2 : this.BATTERY_DRAIN_PER_SECOND;
      this.state.batteryLevel = Math.max(0, this.state.batteryLevel - drainRate * deltaTime);

      // Check low battery
      if (this.state.batteryLevel < 20 && !this.state.warnings.includes('Low battery')) {
        this.state.warnings.push('Low battery');
        stateChanged = true;
      }
      if (this.state.batteryLevel < 5 && this.state.status !== 'error') {
        this.state.errors.push('Critical battery level');
        this.state.status = 'error';
        this.state.targetLocation = undefined;
        stateChanged = true;
      }
    } else {
      // Charge battery
      this.state.batteryLevel = Math.min(100, this.state.batteryLevel + 0.5 * deltaTime);
      if (this.state.batteryLevel >= 100) {
        this.state.status = 'online';
        this.state.warnings = this.state.warnings.filter(w => w !== 'Low battery');
        stateChanged = true;
      }
    }

    // Update lastSeen
    this.state.lastSeen = new Date().toISOString();

    if (stateChanged) {
      this.state.updatedAt = new Date().toISOString();
      this.notifyListeners();
    }
  }

  private updatePosition(deltaTime: number): boolean {
    if (!this.state.targetLocation) return false;

    const dx = this.state.targetLocation.x - this.state.location.x;
    const dy = this.state.targetLocation.y - this.state.location.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.1) {
      // Arrived at destination
      this.state.location.x = this.state.targetLocation.x;
      this.state.location.y = this.state.targetLocation.y;
      this.state.location.zone = this.state.targetLocation.zone;
      this.state.location.floor = this.state.targetLocation.floor;
      this.state.targetLocation = undefined;
      this.state.speed = 0;
      this.state.status = 'online';
      this.state.currentTaskName = undefined;

      // Check if arrived at charging station (use cached location from server)
      if (this.cachedChargingStation) {
        if (
          Math.abs(this.state.location.x - this.cachedChargingStation.x) < 1 &&
          Math.abs(this.state.location.y - this.cachedChargingStation.y) < 1
        ) {
          this.state.status = 'charging';
          this.state.currentTaskName = 'Charging';
        }
      }

      return true;
    }

    // Move towards target
    const moveDistance = this.SPEED_UNITS_PER_SECOND * deltaTime;
    const ratio = Math.min(moveDistance / distance, 1);

    this.state.location.x += dx * ratio;
    this.state.location.y += dy * ratio;
    this.state.speed = this.SPEED_UNITS_PER_SECOND;

    // Update heading
    this.state.location.heading = Math.atan2(dy, dx) * (180 / Math.PI);

    return true;
  }

  private calculateDistance(from: RobotLocation, to: RobotLocation): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const stateCopy = this.getState();
    for (const listener of this.listeners) {
      listener(stateCopy);
    }
  }

  // ============================================================================
  // TASK QUEUE MANAGEMENT (for server push model)
  // ============================================================================

  /**
   * Accept a task pushed from the server
   * @returns true if task was accepted, false if robot can't accept tasks
   */
  async acceptTask(task: PushedTask): Promise<boolean> {
    // Check if robot can accept tasks
    if (this.state.status === 'error' || this.state.status === 'maintenance') {
      return false;
    }

    // Check queue size
    if (this.taskQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`[RobotState] Task queue full, rejecting task ${task.id}`);
      return false;
    }

    // Add task to queue (sorted by priority)
    this.taskQueue.push(task);
    this.sortTaskQueue();

    console.log(`[RobotState] Task ${task.id} added to queue (${this.taskQueue.length}/${this.MAX_QUEUE_SIZE})`);

    // If no current task, start executing
    if (!this.currentTask && this.state.status !== 'busy') {
      this.executeNextTask();
    }

    return true;
  }

  /**
   * Get the task queue
   */
  getTaskQueue(): PushedTask[] {
    return [...this.taskQueue];
  }

  /**
   * Get the task queue length
   */
  getTaskQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * Get the current task being executed
   */
  getCurrentTask(): PushedTask | null {
    return this.currentTask;
  }

  /**
   * Cancel a task by ID
   * @returns true if task was cancelled, false if not found
   */
  async cancelTask(taskId: string): Promise<boolean> {
    // Check current task
    if (this.currentTask && this.currentTask.id === taskId) {
      await this.stop();
      this.currentTask = null;
      this.executeNextTask();
      return true;
    }

    // Check queue
    const index = this.taskQueue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.taskQueue.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Sort task queue by priority (critical > high > normal > low)
   */
  private sortTaskQueue(): void {
    const priorityWeight = {
      critical: 4,
      high: 3,
      normal: 2,
      low: 1,
    };

    this.taskQueue.sort((a, b) => {
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    });
  }

  /**
   * Execute the next task in the queue
   */
  private async executeNextTask(): Promise<void> {
    if (this.taskQueue.length === 0) {
      this.currentTask = null;
      return;
    }

    const task = this.taskQueue.shift()!;
    this.currentTask = task;
    this.state.currentTaskId = task.id;
    this.state.currentTaskName = task.instruction;

    console.log(`[RobotState] Executing task ${task.id}: ${task.instruction}`);

    // Map task action to command
    let result: CommandResult;
    switch (task.actionType) {
      case 'move_to_location':
        const location = task.actionConfig.location as RobotLocation | undefined;
        if (location) {
          result = await this.moveTo(location);
        } else {
          result = { success: false, message: 'No location provided' };
        }
        break;

      case 'pickup_object':
        const objectId = task.actionConfig.objectId as string | undefined;
        if (objectId) {
          result = await this.pickup(objectId);
        } else {
          result = { success: false, message: 'No object ID provided' };
        }
        break;

      case 'drop_object':
        result = await this.drop();
        break;

      case 'charge':
        result = await this.goToCharge();
        break;

      case 'return_home':
        result = await this.returnHome();
        break;

      case 'wait':
        const duration = (task.actionConfig.durationMs as number) ?? 1000;
        await new Promise(resolve => setTimeout(resolve, duration));
        result = { success: true, message: `Waited ${duration}ms` };
        break;

      case 'inspect':
      case 'custom':
      default:
        // For now, simulate a successful completion
        console.log(`[RobotState] Simulating ${task.actionType} action`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = { success: true, message: `Completed ${task.actionType}` };
        break;
    }

    // Task completed or failed - notify and move to next
    console.log(`[RobotState] Task ${task.id} ${result.success ? 'completed' : 'failed'}: ${result.message}`);
    this.currentTask = null;
    this.state.currentTaskId = undefined;
    this.state.currentTaskName = undefined;
    this.notifyListeners();

    // TODO: Notify server of task completion via HTTP callback
    // This would be done in a real implementation

    // Execute next task if available
    this.executeNextTask();
  }
}

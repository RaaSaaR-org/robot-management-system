/**
 * @file state.ts
 * @description Robot state management facade - coordinates state, commands, simulation, tasks, and safety
 * @feature robot
 */

import type {
  SimulatedRobotState,
  RobotConfig,
  Robot,
  RobotTelemetry,
  RobotCommand,
  CommandResult,
  CommandType,
  RobotLocation,
  PushedTask,
} from './types.js';
import { generateTelemetry } from './telemetry.js';
import { StatePublisher, type StateListener } from './StatePublisher.js';
import { CommandExecutor } from './CommandExecutor.js';
import { SimulationEngine } from './SimulationEngine.js';
import { TaskQueue } from './TaskQueue.js';
import {
  SafetyMonitor,
  type SafetyStatus,
  type SafetyEvent,
  type SafetyEventCallback,
  type EStopState,
  type OperatingMode,
} from '../safety/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SIMULATION_CONFIG = {
  tickIntervalMs: 100,
  speedUnitsPerSecond: 2.0,
  batteryDrainPerSecond: 0.01,
  batteryChargePerSecond: 0.5,
};

const TASK_QUEUE_CONFIG = {
  maxQueueSize: 5,
};

const SAFETY_CONFIG = {
  communicationTimeoutMs: 1000, // 1 second default
  maxManualSpeedMmPerSec: 250,  // ISO 10218-1 limit
  maxAutoSpeedMmPerSec: 1500,
  forceLimitN: 140,              // Conservative default
  estopRequiresManualReset: true,
};

// ============================================================================
// ROBOT STATE MANAGER
// ============================================================================

/**
 * RobotStateManager - Facade coordinating robot state, commands, simulation, tasks, and safety
 */
export class RobotStateManager {
  private state: SimulatedRobotState;
  private publisher: StatePublisher;
  private commandExecutor: CommandExecutor;
  private simulation: SimulationEngine;
  private taskQueue: TaskQueue;
  private safetyMonitor: SafetyMonitor;

  constructor(config: RobotConfig) {
    // Initialize state
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

    // Initialize publisher
    this.publisher = new StatePublisher();

    // Create state accessor and updater functions
    const stateGetter = () => this.state;
    const stateUpdater = (updater: (state: SimulatedRobotState) => void) => {
      updater(this.state);
    };
    const changeNotifier = () => this.notifyListeners();

    // Initialize command executor
    this.commandExecutor = new CommandExecutor(
      { speedUnitsPerSecond: SIMULATION_CONFIG.speedUnitsPerSecond },
      stateGetter,
      stateUpdater
    );

    // Initialize simulation engine
    this.simulation = new SimulationEngine(
      stateGetter,
      stateUpdater,
      changeNotifier,
      SIMULATION_CONFIG
    );

    // Initialize task queue with command functions
    this.taskQueue = new TaskQueue(
      stateGetter,
      stateUpdater,
      changeNotifier,
      {
        moveTo: (loc) => this.moveTo(loc),
        pickup: (id) => this.pickup(id),
        drop: () => this.drop(),
        goToCharge: () => this.goToCharge(),
        returnHome: () => this.returnHome(),
        stop: () => this.stop(),
      },
      TASK_QUEUE_CONFIG
    );

    // Initialize safety monitor
    this.safetyMonitor = new SafetyMonitor(
      stateGetter,
      stateUpdater,
      changeNotifier,
      SAFETY_CONFIG
    );
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
    return this.commandExecutor.getHistory();
  }

  // ============================================================================
  // COMMAND HANDLERS (delegated to CommandExecutor)
  // ============================================================================

  async moveTo(location: RobotLocation): Promise<CommandResult> {
    const result = await this.commandExecutor.moveTo(location);
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async pickup(objectId: string): Promise<CommandResult> {
    const result = await this.commandExecutor.pickup(objectId);
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async drop(): Promise<CommandResult> {
    const result = await this.commandExecutor.drop();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async stop(): Promise<CommandResult> {
    const result = await this.commandExecutor.stop();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async emergencyStop(): Promise<CommandResult> {
    const result = await this.commandExecutor.emergencyStop();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async goToCharge(): Promise<CommandResult> {
    const result = await this.commandExecutor.goToCharge();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async returnHome(): Promise<CommandResult> {
    const result = await this.commandExecutor.returnHome();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  // ============================================================================
  // COMMAND EXECUTION
  // ============================================================================

  async executeCommand(type: CommandType, payload: Record<string, unknown> = {}): Promise<RobotCommand> {
    return this.commandExecutor.execute(type, payload);
  }

  // ============================================================================
  // SIMULATION (delegated to SimulationEngine)
  // ============================================================================

  startSimulation(): void {
    this.simulation.start();
  }

  stopSimulation(): void {
    this.simulation.stop();
  }

  // ============================================================================
  // EVENT LISTENERS (delegated to StatePublisher)
  // ============================================================================

  subscribe(listener: StateListener): () => void {
    return this.publisher.subscribe(listener);
  }

  private notifyListeners(): void {
    this.publisher.notify(this.getState());
  }

  // ============================================================================
  // TASK QUEUE MANAGEMENT (delegated to TaskQueue)
  // ============================================================================

  async acceptTask(task: PushedTask): Promise<boolean> {
    return this.taskQueue.accept(task);
  }

  getTaskQueue(): PushedTask[] {
    return this.taskQueue.getTasks();
  }

  getTaskQueueLength(): number {
    return this.taskQueue.length;
  }

  getCurrentTask(): PushedTask | null {
    return this.taskQueue.getCurrentTask();
  }

  async cancelTask(taskId: string): Promise<boolean> {
    return this.taskQueue.cancel(taskId);
  }

  // ============================================================================
  // SAFETY MANAGEMENT (delegated to SafetyMonitor)
  // ============================================================================

  /**
   * Start safety monitoring (call after simulation starts)
   */
  startSafetyMonitoring(): void {
    this.safetyMonitor.start();
  }

  /**
   * Stop safety monitoring
   */
  stopSafetyMonitoring(): void {
    this.safetyMonitor.stop();
  }

  /**
   * Get current safety status
   */
  getSafetyStatus(): SafetyStatus {
    return this.safetyMonitor.getStatus();
  }

  /**
   * Get E-stop state
   */
  getEStopState(): EStopState {
    return this.safetyMonitor.getEStopState();
  }

  /**
   * Check if E-stop is triggered
   */
  isEStopTriggered(): boolean {
    return this.safetyMonitor.isEStopTriggered();
  }

  /**
   * Trigger emergency stop from external source
   */
  triggerEmergencyStop(
    triggeredBy: 'local' | 'remote' | 'server' | 'zone' | 'system',
    reason: string
  ): void {
    this.safetyMonitor.triggerEmergencyStop(triggeredBy, reason);
  }

  /**
   * Trigger protective stop
   */
  triggerProtectiveStop(reason: string): void {
    this.safetyMonitor.triggerProtectiveStop('protective_stop', reason);
  }

  /**
   * Reset E-stop (requires deliberate action)
   */
  resetEmergencyStop(): boolean {
    return this.safetyMonitor.resetEmergencyStop();
  }

  /**
   * Update server heartbeat (call when server communication is received)
   */
  updateServerHeartbeat(): void {
    this.safetyMonitor.updateServerHeartbeat();
  }

  /**
   * Set operating mode
   */
  setOperatingMode(mode: OperatingMode): void {
    this.safetyMonitor.setOperatingMode(mode);
  }

  /**
   * Get current operating mode
   */
  getOperatingMode(): OperatingMode {
    return this.safetyMonitor.getOperatingMode();
  }

  /**
   * Get safety events log
   */
  getSafetyEvents(limit = 50): SafetyEvent[] {
    return this.safetyMonitor.getSafetyEvents(limit);
  }

  /**
   * Subscribe to safety events
   */
  onSafetyEvent(callback: SafetyEventCallback): () => void {
    return this.safetyMonitor.onSafetyEvent(callback);
  }

  /**
   * Get effective speed limit for current mode
   */
  getEffectiveSpeedLimit(): number {
    return this.safetyMonitor.getEffectiveSpeedLimit();
  }

  // ============================================================================
  // RESET (for testing/recovery)
  // ============================================================================

  reset(): void {
    this.state.batteryLevel = 95 + Math.random() * 5;
    this.state.status = 'online';
    this.state.errors = [];
    this.state.warnings = [];
    this.state.targetLocation = undefined;
    this.state.currentTaskId = undefined;
    this.state.currentTaskName = undefined;
    this.state.heldObject = undefined;
    this.state.speed = 0;
    this.state.updatedAt = new Date().toISOString();

    // Also reset E-stop if triggered
    if (this.safetyMonitor.isEStopTriggered()) {
      this.safetyMonitor.resetEmergencyStop();
    }

    this.notifyListeners();
    console.log(`[RobotStateManager] Robot ${this.state.name} reset to initial state`);
  }
}

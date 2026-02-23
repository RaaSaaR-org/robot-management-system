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
  Zone,
} from './types.js';
import { generateTelemetry } from './telemetry.js';
import { StatePublisher, type StateListener } from './StatePublisher.js';
import { CommandExecutor } from './CommandExecutor.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
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
import { VLAController, type ActionExecutor, type ObservationGenerator } from '../vla/vla-controller.js';
import {
  VLAModelManager,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type VLAInferenceMetrics,
} from '../vla/vla-model-manager.js';
import type { VLAStatus, VLAControllerConfig, Observation } from '../vla/types.js';
import {
  EmbodimentLoader,
  JointMapper,
  CameraConfigManager,
  type EmbodimentConfig,
} from '../embodiment/index.js';
import { StatePersistence, type PersistedState } from './StatePersistence.js';

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
  private vlaController: VLAController | null = null;
  private vlaModelManager: VLAModelManager;
  // Local VLA state — used when delegating to sidecar instead of gRPC VLAController
  private vlaActiveLocal = false;
  private vlaInstructionLocal = '';

  // Embodiment integration (Task 51)
  private jointMapper: JointMapper;
  private cameraConfigManager: CameraConfigManager;

  // State persistence (Task 39)
  private persistence: StatePersistence;

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

    // Initialize VLA model manager (Task 47)
    this.vlaModelManager = new VLAModelManager();

    // Initialize embodiment utilities (Task 51)
    this.jointMapper = new JointMapper();
    this.cameraConfigManager = new CameraConfigManager();

    // Initialize state persistence (Task 39)
    this.persistence = new StatePersistence();
    this.restorePersistedState();
  }

  // ============================================================================
  // STATE PERSISTENCE (Task 39)
  // ============================================================================

  /** Build a PersistedState snapshot from current in-memory state */
  private buildPersistedState(): PersistedState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      robotState: {
        status: this.state.status,
        batteryLevel: this.state.batteryLevel,
        location: { ...this.state.location },
        heldObject: this.state.heldObject,
        speed: this.state.speed,
        errors: [...this.state.errors],
        warnings: [...this.state.warnings],
      },
      taskQueue: this.taskQueue.getTasks(),
    };
  }

  /** Trigger a debounced persist of current state */
  private persistState(): void {
    this.persistence.save(this.buildPersistedState());
  }

  /** Restore persisted state into memory (called once from constructor) */
  private restorePersistedState(): void {
    const persisted = this.persistence.load();
    if (!persisted) return;

    const rs = persisted.robotState;
    this.state.status = rs.status;
    this.state.batteryLevel = rs.batteryLevel;
    this.state.location = { ...rs.location };
    this.state.heldObject = rs.heldObject;
    this.state.speed = rs.speed;
    this.state.errors = [...rs.errors];
    this.state.warnings = [...rs.warnings];

    // Restore queued tasks
    if (persisted.taskQueue.length > 0) {
      this.taskQueue.restoreQueue(persisted.taskQueue);
    }

    console.log(
      `[RobotStateManager] Restored persisted state (battery=${rs.batteryLevel.toFixed(1)}%, status=${rs.status})`,
    );
  }

  /**
   * Synchronous save — call during shutdown (SIGTERM / SIGINT).
   */
  saveStateSync(): void {
    this.persistence.saveSync(this.buildPersistedState());
  }

  /**
   * Get the StatePersistence instance (for shutdown hooks in index.ts).
   */
  getStatePersistence(): StatePersistence {
    return this.persistence;
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
    const telemetry = generateTelemetry(this.state);
    // Always prefer real joint states over simulated defaults.
    // Even if the sidecar is temporarily unreachable, keep showing the last known
    // real pose instead of snapping back to simulated defaults (avoids confusion).
    const realJoints = hardwareClient.getJointStates();
    if (realJoints.length > 0) {
      telemetry.jointStates = realJoints;
      (telemetry as unknown as Record<string, unknown>).hardwareConnected = hardwareClient.isConnected();
    }
    return telemetry;
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
    // Try to connect to real hardware sidecar (non-blocking)
    void hardwareClient.init();
  }

  stopSimulation(): void {
    this.simulation.stop();
  }

  /**
   * Update the zone cache used for real-time zone tracking in the simulation engine.
   */
  setZoneCache(zones: Zone[]): void {
    this.simulation.setZoneCache(zones);
  }

  // ============================================================================
  // EVENT LISTENERS (delegated to StatePublisher)
  // ============================================================================

  subscribe(listener: StateListener): () => void {
    return this.publisher.subscribe(listener);
  }

  private notifyListeners(): void {
    this.publisher.notify(this.getState());
    this.persistState();
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
  // VLA CONTROL (Task 46)
  // ============================================================================

  /**
   * Start VLA control mode with a language instruction.
   *
   * @param instruction Natural language task instruction
   * @param config Optional VLA controller configuration overrides
   */
  async startVLAControl(
    instruction: string,
    config?: Partial<VLAControllerConfig>
  ): Promise<void> {
    if (this.vlaActiveLocal) {
      throw new Error('VLA control is already active');
    }

    // Delegate to the Python sidecar which spawns client_pi.py.
    // client_pi.py handles real camera capture, joint reading, and LeRobot gRPC protocol —
    // all of which are incompatible with the old VLAController/VLAClient (custom proto, placeholder images).
    const host = process.env.VLA_SERVER_HOST ?? '100.125.78.40';
    const serverPort = parseInt(process.env.VLA_SERVER_PORT ?? '8080', 10);
    const robotPort = process.env.VLA_ROBOT_PORT ?? '/dev/ttyACM0';
    const model = process.env.VLA_MODEL ?? 'Elvinky/pi05_so101_pick_place_bottle';

    console.log(`[RobotStateManager/VLA] Starting: instruction="${instruction}" host=${host}:${serverPort} model=${model}`);

    let res: Response;
    try {
      res = await fetch('http://localhost:8765/vla/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, host, port: serverPort, robotPort, model }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.error(`[RobotStateManager/VLA] Sidecar call failed:`, err);
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      console.error(`[RobotStateManager/VLA] Start failed (HTTP ${res.status}): ${text}`);
      throw new Error(`VLA start failed: ${text}`);
    }

    const body = await res.json() as { ok: boolean; pid?: number };
    console.log(`[RobotStateManager/VLA] Sidecar responded: PID=${body.pid}`);

    this.vlaActiveLocal = true;
    this.vlaInstructionLocal = instruction;
    this.notifyListeners();
  }

  /**
   * Stop VLA control mode gracefully.
   */
  async stopVLAControl(): Promise<void> {
    console.log('[RobotStateManager/VLA] Stopping VLA control');
    await fetch('http://localhost:8765/vla/stop', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch((err) => console.error('[RobotStateManager/VLA] Sidecar stop call failed:', err));

    this.vlaActiveLocal = false;
    this.vlaInstructionLocal = '';
    this.notifyListeners();
    console.log('[RobotStateManager/VLA] VLA control stopped');
  }

  /**
   * Pause VLA control (holds current position).
   */
  pauseVLAControl(): void {
    // Pause not supported in sidecar-delegated mode — stop instead
    console.warn('[RobotStateManager] VLA pause not supported in sidecar mode, use stop');
  }

  /**
   * Resume VLA control from paused state.
   */
  resumeVLAControl(): void {
    console.warn('[RobotStateManager] VLA resume not supported in sidecar mode, use start');
  }

  /**
   * Get current VLA control status.
   */
  getVLAStatus(): VLAStatus | null {
    if (!this.vlaActiveLocal) return null;
    // Return a minimal status compatible with VLAStatus shape
    return {
      phase: 'running',
      instruction: this.vlaInstructionLocal,
      bufferDepth: 0,
      lastInferenceMs: 0,
      totalSteps: 0,
      errors: 0,
    } as unknown as VLAStatus;
  }

  /**
   * Check if VLA control is currently active.
   */
  isVLAActive(): boolean {
    return this.vlaActiveLocal;
  }

  // ============================================================================
  // VLA MODEL MANAGEMENT (Task 47)
  // ============================================================================

  /**
   * Switch to a new VLA model version.
   * Used by deployment pipeline for canary/production rollouts.
   *
   * @param request Model switch request with version and artifact URI
   * @returns Result of the switch operation
   */
  async switchVLAModel(request: ModelSwitchRequest): Promise<ModelSwitchResult> {
    const wasActive = this.isVLAActive();
    let currentInstruction: string | undefined;

    // If VLA is active, stop it first
    if (wasActive && this.vlaController) {
      currentInstruction = this.vlaController.getStatus()?.instruction;
      await this.stopVLAControl();
    }

    // Perform model switch
    const result = await this.vlaModelManager.switchModel(request);

    // Log the switch
    if (result.success) {
      console.log(
        `[RobotStateManager] VLA model switched: ${result.previousModelVersion} -> ${result.newModelVersion}`
      );
    } else {
      console.error(`[RobotStateManager] VLA model switch failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Get VLA inference metrics for deployment monitoring.
   */
  getVLAInferenceMetrics(): VLAInferenceMetrics {
    return this.vlaModelManager.getInferenceMetrics();
  }

  /**
   * Get current VLA model version.
   */
  getVLAModelVersion(): string | null {
    return this.vlaModelManager.getCurrentModelVersion();
  }

  // ============================================================================
  // RESET (for testing/recovery)
  // ============================================================================

  reset(): void {
    // Stop VLA control if active
    if (this.vlaController) {
      this.vlaController.stop().catch(() => {});
      this.vlaController = null;
    }

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

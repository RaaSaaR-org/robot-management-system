/**
 * @file state.ts
 * @description Robot state management facade - coordinates state, commands, simulation, tasks, and safety
 * @feature robot
 * @status live
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
  RobotType,
  PointCloudFrame,
  PointCloudPose,
} from './types.js';
import { generateTelemetry } from './telemetry.js';
import { generateSyntheticScan, LIVE_POINTS_PER_FRAME } from './pointcloud-sim.js';
import { PointCloudReplaySource } from './pointcloud-replay.js';
import { createScanRoom, generatePosedScan, seedFromString, type ScanRoom } from './scan-sim.js';
import { getJointConfig } from './joint-configs/index.js';
import type { JointConfig } from './types.js';
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
import {
  VLAModelManager,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type VLAInferenceMetrics,
} from '../vla/vla-model-manager.js';
import type { VLAStatus, VLAControllerConfig, Observation, VLASafetyStatus } from '../vla/types.js';
import {
  EmbodimentLoader,
  JointMapper,
  CameraConfigManager,
  DepthSensorManager,
  type EmbodimentConfig,
  type DepthSensorSpec,
} from '../embodiment/index.js';
import path from 'path';
import { StatePersistence, type PersistedState } from './StatePersistence.js';
import { config as appConfig } from '../config/config.js';

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
  communicationTimeoutMs: 30000, // 30 second timeout (was 1s — too short, caused immediate PROTECTIVE STOP)
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
  private vlaModelManager: VLAModelManager;
  // Local VLA state — used when delegating to sidecar instead of gRPC VLAController
  private vlaActiveLocal = false;
  private vlaInstructionLocal = '';

  // Keyboard teleop override — when active, the simulated joints follow operator
  // input instead of the idle/walk animation. Map of joint name -> position (rad).
  private teleopJoints: Map<string, number> | null = null;

  // Embodiment integration (Task 51)
  private jointMapper: JointMapper;
  private cameraConfigManager: CameraConfigManager;
  private depthSensorManager: DepthSensorManager;

  // Point-cloud frame counter (monotonic, for drop detection on the stream)
  private pointCloudSequence = 0;

  // Real-recording replay source: undefined = unchecked, null = none configured.
  private replaySource: PointCloudReplaySource | null | undefined = undefined;

  // Active digital-twin scan session. Holds ONE fixed room (centered on the
  // twin's world origin = the robot's pose when scanning started) so successive
  // pose-stamped frames accumulate into a single map as the robot walks. Poses
  // are expressed relative to (originX, originY).
  private activeScan:
    | { sessionId: string; room: ScanRoom; startedAt: string; frames: number; originX: number; originY: number }
    | null = null;

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
    this.depthSensorManager = new DepthSensorManager();

    // Initialize state persistence — per-robot file to support multi-instance
    this.persistence = new StatePersistence(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), `../../data/state-${appConfig.robotId}.json`)
    );
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
      // SO-101 is AC-powered → null signals "no battery"
      batteryLevel: this.state.robotType === 'so101' ? null : Math.round(this.state.batteryLevel),
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
        powerSource: this.state.robotType === 'so101' ? 'ac_powered' : 'battery',
      },
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  getTelemetry(): RobotTelemetry {
    const telemetry = generateTelemetry(this.state);
    // Keyboard teleop override: when an operator is teleoperating in simulation,
    // the joints follow their commanded pose instead of the idle/walk animation.
    if (this.teleopJoints) {
      telemetry.jointStates = this.getActiveJointConfig().map((joint) => ({
        name: joint.name,
        position: this.teleopJoints!.get(joint.name) ?? joint.defaultPosition,
        velocity: 0,
      }));
    }
    // Always prefer real joint states over simulated/teleop defaults.
    // Even if the sidecar is temporarily unreachable, keep showing the last known
    // real pose instead of snapping back to simulated defaults (avoids confusion).
    const realJoints = hardwareClient.getJointStates();
    if (realJoints.length > 0) {
      telemetry.jointStates = realJoints;
      (telemetry as unknown as Record<string, unknown>).hardwareConnected = hardwareClient.isConnected();
    }
    return telemetry;
  }

  // ============================================================================
  // POINT CLOUD / DEPTH PERCEPTION
  // ============================================================================

  /**
   * Produce a point-cloud frame for the requested (or primary) depth sensor.
   *
   * This is the single sim↔hardware seam for perception: when the hardware
   * sidecar reports a connected robot we pull a real Livox/RealSense frame;
   * otherwise we synthesize a believable MID-360-style scan. Pulled on demand
   * (no simulation-loop coupling), exactly like {@link getTelemetry}.
   *
   * @param sensorName Specific depth sensor name, or undefined for the primary
   * @param opts.full  Request a full-resolution capture instead of a live frame
   */
  async getPointCloudFrame(
    sensorName?: string,
    opts: { full?: boolean } = {},
  ): Promise<PointCloudFrame> {
    const sequence = this.pointCloudSequence++;
    const spec = this.resolveDepthSensorSpec(sensorName);

    // Hardware seam — real Livox / RealSense via the sidecar when connected.
    if (hardwareClient.isConnected()) {
      try {
        const real = await hardwareClient.snapshotPointCloud(spec?.name ?? 'mid360_lidar');
        return { ...real, robotId: this.state.id, sequence, source: 'hardware', timestamp: new Date().toISOString() };
      } catch (err) {
        console.warn('[RobotStateManager] Hardware point cloud unavailable, using simulation:', err);
      }
    }

    // Replay seam — real recorded scans (KITTI / PCD) played back when configured
    // via POINTCLOUD_REPLAY_FILE / _DIR. Opt-in, so it never displaces hardware.
    const replay = this.getReplaySource();
    if (replay && replay.size > 0) {
      return replay.getFrame(spec, sequence, { full: opts.full, robotId: this.state.id, livePoints: LIVE_POINTS_PER_FRAME });
    }

    const targetPoints = opts.full ? (spec?.points_per_frame ?? 20000) : LIVE_POINTS_PER_FRAME;

    // Scan-session seam — when a digital-twin sweep is active (and we'd
    // otherwise synthesize), return a pose-dependent slice of one fixed world
    // room so frames accumulate into a map. Only replaces the synthetic
    // fallback, never hardware/replay, so live perception is unaffected.
    if (this.activeScan) {
      this.activeScan.frames++;
      return generatePosedScan(
        this.activeScan.room,
        this.state,
        this.currentScanPose(this.activeScan.originX, this.activeScan.originY),
        spec,
        sequence,
        { targetPoints, scanSessionId: this.activeScan.sessionId },
      );
    }

    return generateSyntheticScan(this.state, spec, sequence, { targetPoints });
  }

  /**
   * Robot pose in the twin's world frame: position relative to the scan origin
   * (where scanning started), heading in radians. This is the ONLY place the
   * simulator's degree heading is converted to radians — keep it here to avoid a
   * deg/rad mix.
   */
  private currentScanPose(originX: number, originY: number): PointCloudPose {
    const loc = this.state.location;
    return {
      x: loc.x - originX,
      y: loc.y - originY,
      z: loc.z ?? 0,
      yaw: ((loc.heading ?? 0) * Math.PI) / 180,
    };
  }

  // ============================================================================
  // SCAN SESSIONS (digital-twin sweep)
  // ============================================================================

  /**
   * Begin a scan session: seed one fixed world room and switch the synthetic
   * perception path to pose-dependent slices of it. Idempotent per id — calling
   * again replaces the active session.
   */
  startScanSession(opts: { sessionId?: string } = {}): { sessionId: string; active: true } {
    const sessionId = opts.sessionId ?? `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.activeScan = {
      sessionId,
      room: createScanRoom(seedFromString(sessionId)),
      startedAt: new Date().toISOString(),
      frames: 0,
      // Anchor the twin's world origin at the robot's current location.
      originX: this.state.location.x,
      originY: this.state.location.y,
    };
    console.log(
      `[RobotStateManager] Scan session started: ${sessionId} (origin ${this.state.location.x.toFixed(1)},${this.state.location.y.toFixed(1)})`,
    );
    return { sessionId, active: true };
  }

  /** End the active scan session (perception reverts to the standard sim). */
  stopScanSession(): { sessionId: string | null; frames: number } {
    if (!this.activeScan) return { sessionId: null, frames: 0 };
    const { sessionId, frames } = this.activeScan;
    this.activeScan = null;
    console.log(`[RobotStateManager] Scan session stopped: ${sessionId} (${frames} frames)`);
    return { sessionId, frames };
  }

  /** Current scan-session status. */
  getScanStatus(): { active: boolean; sessionId?: string; frames: number; startedAt?: string } {
    if (!this.activeScan) return { active: false, frames: 0 };
    return {
      active: true,
      sessionId: this.activeScan.sessionId,
      frames: this.activeScan.frames,
      startedAt: this.activeScan.startedAt,
    };
  }

  /**
   * Lazily resolve the real-recording replay source from the environment.
   * `null` once we've checked and found none configured (so we don't re-scan).
   */
  private getReplaySource(): PointCloudReplaySource | undefined {
    if (this.replaySource === undefined) {
      this.replaySource = PointCloudReplaySource.fromEnv() ?? null;
      if (this.replaySource) {
        console.log(
          `[RobotStateManager] Point-cloud replay active (${this.replaySource.size} recording(s): ${this.replaySource.labels.join(', ')})`,
        );
      }
    }
    return this.replaySource ?? undefined;
  }

  /**
   * Resolve a depth sensor spec from the loaded embodiment config (if any).
   * Falls back to undefined, in which case the generator uses MID-360 defaults.
   */
  private resolveDepthSensorSpec(sensorName?: string): DepthSensorSpec | undefined {
    const tag = this.embodimentTagForRobotType(this.state.robotType);
    if (!tag) return undefined;
    const config = EmbodimentLoader.getInstance().getEmbodiment(tag);
    if (!config) return undefined;
    return sensorName
      ? this.depthSensorManager.getDepthSensor(sensorName, config)
      : this.depthSensorManager.getPrimaryDepthSensor(config);
  }

  /** Map a robot type to its embodiment config tag. */
  private embodimentTagForRobotType(type: RobotType): string | undefined {
    switch (type) {
      case 'g1':
        return 'unitree_g1';
      case 'g1_edu':
        return 'unitree_g1_edu_dex3';
      case 'h1':
        return 'unitree_h1';
      default:
        return undefined;
    }
  }

  // ============================================================================
  // KEYBOARD TELEOP (simulation, embodiment-aware)
  // ============================================================================

  /** Joint configuration for the active embodiment (SO-101, G1, G1-EDU, …). */
  getActiveJointConfig(): JointConfig[] {
    return getJointConfig(this.state.robotType);
  }

  /** Whether keyboard teleop is currently driving the simulated joints. */
  isTeleopActive(): boolean {
    return this.teleopJoints !== null;
  }

  /**
   * Enter teleop mode. Seeds the override map from the embodiment's default
   * pose. Idempotent — returns the current teleop pose (radians).
   */
  enableTeleop(): Record<string, number> {
    if (!this.teleopJoints) {
      this.teleopJoints = new Map();
      for (const joint of this.getActiveJointConfig()) {
        this.teleopJoints.set(joint.name, joint.defaultPosition);
      }
    }
    return this.getTeleopPositions();
  }

  /** Leave teleop mode; the simulation resumes its idle/walk animation. */
  disableTeleop(): void {
    this.teleopJoints = null;
    this.notifyListeners();
  }

  /** Reset all teleop joints to their default (home) pose. */
  homeTeleopJoints(): Record<string, number> {
    if (!this.teleopJoints) this.enableTeleop();
    for (const joint of this.getActiveJointConfig()) {
      this.teleopJoints!.set(joint.name, joint.defaultPosition);
    }
    return this.getTeleopPositions();
  }

  /**
   * Apply a delta (radians) to a single teleop joint, clamped to its limits.
   * Returns the new clamped position, or null for an unknown joint.
   *
   * Note: intentionally does NOT notify state listeners — teleop runs at a high
   * tick rate and the telemetry stream re-reads getTelemetry() on its own cadence.
   */
  applyTeleopDelta(jointName: string, deltaRad: number): number | null {
    if (!this.teleopJoints) this.enableTeleop();
    const joint = this.getActiveJointConfig().find((j) => j.name === jointName);
    if (!joint) return null;
    const current = this.teleopJoints!.get(jointName) ?? joint.defaultPosition;
    const next = Math.max(joint.limitLower, Math.min(joint.limitUpper, current + deltaRad));
    this.teleopJoints!.set(jointName, next);
    return next;
  }

  /**
   * Set a single teleop joint to an absolute angle (radians), clamped to its
   * limits. Returns the new clamped position, or null for an unknown joint.
   *
   * Used by pose-streaming teleop (e.g. WebXR / Meta Quest) where the client
   * computes target joint angles each frame rather than incremental deltas.
   * Like applyTeleopDelta, it intentionally does NOT notify state listeners.
   */
  setTeleopJoint(jointName: string, positionRad: number): number | null {
    if (!this.teleopJoints) this.enableTeleop();
    const joint = this.getActiveJointConfig().find((j) => j.name === jointName);
    if (!joint) return null;
    const next = Math.max(joint.limitLower, Math.min(joint.limitUpper, positionRad));
    this.teleopJoints!.set(jointName, next);
    return next;
  }

  /** Current teleop joint positions as a plain map (radians). */
  getTeleopPositions(): Record<string, number> {
    const out: Record<string, number> = {};
    if (this.teleopJoints) {
      for (const [name, pos] of this.teleopJoints) out[name] = pos;
    }
    return out;
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

    // Delegate to the Python sidecar which runs VLARunner.
    // VLARunner handles real camera capture, joint reading, and HTTP inference
    // against the consolidated vla-server.
    const serverUrl = process.env.VLA_SERVER_URL ?? 'http://192.168.178.40:8000';
    const robotPort = process.env.VLA_ROBOT_PORT ?? '/dev/ttyACM0';

    console.log(`[RobotStateManager/VLA] Starting: instruction="${instruction}" server=${serverUrl}`);

    let res: Response;
    try {
      res = await fetch('http://localhost:8765/vla/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, serverUrl, robotPort }),
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

    const body = await res.json() as { ok: boolean };
    console.log(`[RobotStateManager/VLA] VLARunner started`);

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

  /**
   * Get VLA safety monitoring status from the hardware sidecar.
   */
  async getVLASafetyStatus(): Promise<VLASafetyStatus> {
    try {
      const res = await fetch('http://localhost:8765/safety/status', {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        throw new Error(`Sidecar returned HTTP ${res.status}`);
      }
      const data = await res.json() as Record<string, unknown>;
      return {
        validatorEnabled: data.validator_enabled as boolean,
        rateLimiterEnabled: data.rate_limiter_enabled as boolean,
        watchdogHealthy: data.watchdog_healthy as boolean,
        lastLatencyMs: data.last_watchdog_latency_ms as number | null,
        actionsValidated: data.actions_validated as number,
        actionsRejected: data.actions_rejected as number,
        actionsClipped: data.actions_clipped as number,
        rateLimiterMaxDelta: data.rate_limiter_max_delta as number,
        watchdogTimeoutMs: data.watchdog_timeout_ms as number,
        degradationEvents: (data.degradation_events as Array<{
          type: string;
          reason: string;
          timestamp: number;
        }>) ?? [],
      };
    } catch (err) {
      console.error('[RobotStateManager] Failed to fetch VLA safety status:', err);
      // Return defaults when sidecar is unreachable
      return {
        validatorEnabled: true,
        rateLimiterEnabled: true,
        watchdogHealthy: true,
        lastLatencyMs: null,
        actionsValidated: 0,
        actionsRejected: 0,
        actionsClipped: 0,
        rateLimiterMaxDelta: 10.0,
        watchdogTimeoutMs: 100.0,
        degradationEvents: [],
      };
    }
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
    // If VLA is active, stop it first
    if (this.isVLAActive()) {
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
    if (this.vlaActiveLocal) {
      this.stopVLAControl().catch(() => {});
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

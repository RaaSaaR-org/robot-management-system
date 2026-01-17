/**
 * @file vla-controller.ts
 * @description High-level VLA control loop orchestration with safety fallbacks
 * @feature vla
 */

import { EventEmitter } from 'events';
import type {
  Action,
  ActionChunk,
  Observation,
  VLAControllerConfig,
  VLAControllerMode,
  VLAStatus,
  VLAControllerEvent,
  ActionResult,
} from './types.js';
import { ActionBuffer } from './action-buffer.js';
import { ActionInterpolator } from './action-interpolator.js';
import { VLAClient } from './vla-client.js';
import {
  EmbodimentLoader,
  ActionNormalizer,
  type EmbodimentConfig,
} from '../embodiment/index.js';

/** Default controller configuration */
const DEFAULT_CONFIG: VLAControllerConfig = {
  tickIntervalMs: 20, // 50Hz
  bufferCapacity: 16, // 320ms at 50Hz
  prefetchThreshold: 0.5,
  underrunTimeoutMs: 500,
  interpolationMethod: 'linear',
  cloudEndpoint: 'localhost:50051',
  edgeEndpoint: undefined,
  embodimentTag: 'generic',
};

/**
 * Callback for executing VLA actions on the robot.
 */
export type ActionExecutor = (action: Action) => Promise<ActionResult>;

/**
 * Callback for generating observations from robot state.
 */
export type ObservationGenerator = () => Promise<Observation>;

/**
 * VLAController orchestrates the 50Hz VLA control loop.
 *
 * Features:
 * - 50Hz (20ms) control loop for smooth motion
 * - Action buffering for network latency tolerance
 * - Interpolation for smooth action transitions
 * - Safety fallback cascade (hold position → safe retract → local controller)
 * - Cloud/edge endpoint switching
 *
 * @example
 * ```typescript
 * const controller = new VLAController({
 *   cloudEndpoint: 'vla-server:50051',
 *   embodimentTag: 'unitree_h1',
 * });
 *
 * controller.on('underrun', () => {
 *   console.warn('Buffer underrun detected');
 * });
 *
 * await controller.start('Pick up the red cube', executeAction, getObservation);
 * ```
 */
export class VLAController extends EventEmitter {
  private config: VLAControllerConfig;
  private mode: VLAControllerMode = 'inactive';
  private instruction: string = '';

  // Core components
  private buffer: ActionBuffer;
  private interpolator: ActionInterpolator;
  private cloudClient: VLAClient | null = null;
  private edgeClient: VLAClient | null = null;
  private activeClient: VLAClient | null = null;

  // Embodiment configuration (Task 51)
  private embodimentConfig: EmbodimentConfig | null = null;
  private actionNormalizer: ActionNormalizer;

  // Callbacks
  private actionExecutor: ActionExecutor | null = null;
  private observationGenerator: ObservationGenerator | null = null;

  // Control loop
  private tickTimer: NodeJS.Timeout | null = null;
  private lastAction: Action | null = null;
  private lastActionTime: number = 0;
  private underrunStartTime: number = 0;
  private underrunCount: number = 0;

  // Prefetch tracking
  private prefetchInFlight: boolean = false;
  private sessionId: string = '';

  constructor(config: Partial<VLAControllerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize buffer and interpolator
    this.buffer = new ActionBuffer({
      capacity: this.config.bufferCapacity,
      prefetchThreshold: this.config.prefetchThreshold,
    });

    this.interpolator = new ActionInterpolator({
      method: this.config.interpolationMethod,
    });

    // Initialize action normalizer (Task 51)
    this.actionNormalizer = new ActionNormalizer();

    // Set up buffer event handlers
    this.buffer.on('buffer:low', this.handleBufferLow.bind(this));
    this.buffer.on('buffer:empty', this.handleBufferEmpty.bind(this));
  }

  /**
   * Start VLA control with a language instruction.
   *
   * @param instruction Natural language task instruction
   * @param actionExecutor Callback to execute actions on the robot
   * @param observationGenerator Callback to generate observations from robot state
   */
  async start(
    instruction: string,
    actionExecutor: ActionExecutor,
    observationGenerator: ObservationGenerator
  ): Promise<void> {
    if (this.mode !== 'inactive') {
      throw new Error(`Cannot start: controller is ${this.mode}`);
    }

    this.instruction = instruction;
    this.actionExecutor = actionExecutor;
    this.observationGenerator = observationGenerator;
    this.sessionId = `vla-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Load embodiment configuration (Task 51)
    await this.loadEmbodimentConfig();

    // Initialize VLA client
    await this.initializeClients();

    // Prime the buffer with initial actions
    await this.requestActions();

    // Start control loop
    this.mode = 'active';
    this.startControlLoop();

    this.emit('started' as VLAControllerEvent, { instruction });
    console.log(`[VLAController] Started with instruction: "${instruction}"`);
  }

  /**
   * Stop VLA control gracefully.
   * Drains the buffer and stops the control loop.
   */
  async stop(): Promise<void> {
    if (this.mode === 'inactive') {
      return;
    }

    this.mode = 'stopped';
    this.stopControlLoop();

    // Clear buffer
    await this.buffer.clear();

    // Close clients
    await this.closeClients();

    this.emit('stopped' as VLAControllerEvent);
    console.log('[VLAController] Stopped');

    this.mode = 'inactive';
    this.instruction = '';
    this.actionExecutor = null;
    this.observationGenerator = null;
  }

  /**
   * Pause VLA control (holds current position).
   */
  pause(): void {
    if (this.mode !== 'active') {
      return;
    }

    this.mode = 'paused';
    this.stopControlLoop();
    this.emit('paused' as VLAControllerEvent);
    console.log('[VLAController] Paused');
  }

  /**
   * Resume VLA control from paused state.
   */
  resume(): void {
    if (this.mode !== 'paused') {
      return;
    }

    this.mode = 'active';
    this.startControlLoop();
    this.emit('resumed' as VLAControllerEvent);
    console.log('[VLAController] Resumed');
  }

  /**
   * Get current VLA status.
   */
  getStatus(): VLAStatus {
    const bufferStats = this.buffer.getStats();
    const interpolatorStats = this.interpolator.getStats();

    return {
      mode: this.mode,
      bufferLevel: bufferStats.level,
      bufferCount: bufferStats.count,
      inferenceLatencyMs: this.activeClient
        ? (this.activeClient as unknown as { getMetrics: () => { latency: { avg: number } } }).getMetrics?.()?.latency?.avg ?? 0
        : 0,
      networkRttMs: interpolatorStats.rttEstimateMs,
      lastActionTimestamp: this.lastActionTime,
      underrunCount: this.underrunCount,
      instruction: this.instruction || undefined,
      usingEdgeFallback: this.activeClient === this.edgeClient && this.edgeClient !== null,
    };
  }

  /**
   * Get the current control mode.
   */
  getMode(): VLAControllerMode {
    return this.mode;
  }

  /**
   * Check if controller is actively running.
   */
  isActive(): boolean {
    return this.mode === 'active';
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Load embodiment configuration based on embodimentTag (Task 51).
   */
  private async loadEmbodimentConfig(): Promise<void> {
    const loader = EmbodimentLoader.getInstance();
    await loader.initialize();

    try {
      this.embodimentConfig = await loader.loadEmbodiment(this.config.embodimentTag);
      console.log(
        `[VLAController] Loaded embodiment config: ${this.embodimentConfig.embodiment_tag} ` +
        `(${this.embodimentConfig.action.dim} DOF)`
      );
    } catch (error) {
      console.warn(
        `[VLAController] Failed to load embodiment "${this.config.embodimentTag}", using default:`,
        error
      );
      this.embodimentConfig = await loader.getDefault();
      console.log(
        `[VLAController] Using default embodiment: ${this.embodimentConfig.embodiment_tag}`
      );
    }
  }

  /**
   * Denormalize action values using embodiment config (Task 51).
   * VLA models output normalized actions in [-1, 1] range.
   * This converts them to raw joint values for robot execution.
   */
  private denormalizeAction(action: Action): Action {
    if (!this.embodimentConfig) {
      return action; // No config, pass through
    }

    try {
      const rawJointCommands = this.actionNormalizer.denormalizeFlexibleAndClip(
        action.jointCommands,
        this.embodimentConfig
      );

      return {
        ...action,
        jointCommands: rawJointCommands,
      };
    } catch (error) {
      console.warn('[VLAController] Action denormalization failed, using raw values:', error);
      return action;
    }
  }

  /**
   * Get current embodiment configuration.
   */
  getEmbodimentConfig(): EmbodimentConfig | null {
    return this.embodimentConfig;
  }

  /**
   * Initialize VLA clients for cloud and optionally edge endpoints.
   */
  private async initializeClients(): Promise<void> {
    const [cloudHost, cloudPortStr] = this.config.cloudEndpoint.split(':');
    const cloudPort = parseInt(cloudPortStr, 10) || 50051;

    this.cloudClient = new VLAClient({
      host: cloudHost,
      port: cloudPort,
      timeoutMs: 5000,
    });

    try {
      await this.cloudClient.connect();
      this.activeClient = this.cloudClient;
      console.log(`[VLAController] Connected to cloud endpoint: ${this.config.cloudEndpoint}`);
    } catch (error) {
      console.warn('[VLAController] Cloud connection failed:', error);

      // Try edge fallback if configured
      if (this.config.edgeEndpoint) {
        await this.initializeEdgeClient();
      } else {
        throw new Error('Failed to connect to VLA inference endpoint');
      }
    }

    // Initialize edge client as backup
    if (this.config.edgeEndpoint && !this.edgeClient) {
      // Initialize in background, don't fail if it's not available
      this.initializeEdgeClient().catch((err) => {
        console.warn('[VLAController] Edge endpoint not available:', err);
      });
    }
  }

  /**
   * Initialize the edge fallback client.
   */
  private async initializeEdgeClient(): Promise<void> {
    if (!this.config.edgeEndpoint) return;

    const [edgeHost, edgePortStr] = this.config.edgeEndpoint.split(':');
    const edgePort = parseInt(edgePortStr, 10) || 50051;

    this.edgeClient = new VLAClient({
      host: edgeHost,
      port: edgePort,
      timeoutMs: 5000,
    });

    await this.edgeClient.connect();
    console.log(`[VLAController] Connected to edge endpoint: ${this.config.edgeEndpoint}`);

    // Switch to edge if cloud is not available
    if (!this.activeClient || this.activeClient !== this.cloudClient) {
      this.activeClient = this.edgeClient;
      this.emit('endpoint:switched' as VLAControllerEvent, { endpoint: 'edge' });
    }
  }

  /**
   * Close all VLA clients.
   */
  private async closeClients(): Promise<void> {
    if (this.cloudClient) {
      try {
        await this.cloudClient.close();
      } catch {
        // Ignore close errors
      }
      this.cloudClient = null;
    }

    if (this.edgeClient) {
      try {
        await this.edgeClient.close();
      } catch {
        // Ignore close errors
      }
      this.edgeClient = null;
    }

    this.activeClient = null;
  }

  /**
   * Start the 50Hz control loop.
   */
  private startControlLoop(): void {
    this.stopControlLoop();

    this.tickTimer = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[VLAController] Tick error:', error);
        this.emit('error' as VLAControllerEvent, error);
      });
    }, this.config.tickIntervalMs);
  }

  /**
   * Stop the control loop.
   */
  private stopControlLoop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Main control loop tick - executes at 50Hz.
   */
  private async tick(): Promise<void> {
    if (this.mode !== 'active') return;

    const currentTime = Date.now() / 1000; // Unix epoch seconds

    // Try to get action from buffer
    let action = await this.buffer.pop();

    if (action) {
      // Reset underrun timer
      this.underrunStartTime = 0;

      // Optionally interpolate for smoother motion
      const nextAction = await this.buffer.peek();
      if (nextAction && this.config.interpolationMethod !== 'linear') {
        action = this.interpolator.interpolate(action, nextAction, currentTime);
      }

      // Execute action
      await this.executeAction(action);
    } else {
      // Buffer underrun - apply fallback
      await this.handleUnderrun(currentTime);
    }

    // Check if we need to prefetch more actions
    if (this.buffer.needsPrefetch() && !this.prefetchInFlight) {
      this.triggerPrefetch();
    }
  }

  /**
   * Execute an action on the robot.
   * Denormalizes the action using embodiment config before execution (Task 51).
   */
  private async executeAction(action: Action): Promise<void> {
    if (!this.actionExecutor) return;

    try {
      // Denormalize action from VLA model output to raw joint values (Task 51)
      const denormalizedAction = this.denormalizeAction(action);

      const result = await this.actionExecutor(denormalizedAction);
      if (result.success) {
        this.lastAction = denormalizedAction;
        this.lastActionTime = Date.now();
      } else {
        console.warn('[VLAController] Action execution failed:', result.error);
      }
    } catch (error) {
      console.error('[VLAController] Action execution error:', error);
    }
  }

  /**
   * Handle buffer underrun with safety fallback cascade.
   */
  private async handleUnderrun(currentTime: number): Promise<void> {
    this.underrunCount++;
    this.emit('underrun' as VLAControllerEvent, { count: this.underrunCount });

    if (this.underrunStartTime === 0) {
      this.underrunStartTime = currentTime;
    }

    const underrunDuration = (currentTime - this.underrunStartTime) * 1000; // ms

    if (underrunDuration < this.config.underrunTimeoutMs) {
      // Short underrun: hold last position
      await this.fallbackHoldPosition();
    } else {
      // Extended underrun: safe retract
      await this.fallbackSafeRetract();
    }
  }

  /**
   * Safety fallback: hold the last known position.
   */
  private async fallbackHoldPosition(): Promise<void> {
    if (this.lastAction && this.actionExecutor) {
      // Re-execute last action (holds position)
      this.emit('fallback:position-hold' as VLAControllerEvent);
      await this.actionExecutor(this.lastAction);
    }
  }

  /**
   * Safety fallback: initiate safe retract sequence.
   */
  private async fallbackSafeRetract(): Promise<void> {
    this.emit('fallback:safe-retract' as VLAControllerEvent);
    console.warn('[VLAController] Extended underrun - initiating safe retract');

    // Create a safe retract action (all joints to zero velocity)
    if (this.lastAction && this.actionExecutor) {
      const safeAction: Action = {
        jointCommands: this.lastAction.jointCommands.map(() => 0), // Zero velocity
        gripperCommand: this.lastAction.gripperCommand, // Hold gripper state
        timestamp: Date.now() / 1000,
      };
      await this.actionExecutor(safeAction);
    }

    // Consider switching to local safety controller
    if (this.edgeClient && this.activeClient !== this.edgeClient) {
      console.log('[VLAController] Switching to edge endpoint');
      this.activeClient = this.edgeClient;
      this.emit('endpoint:switched' as VLAControllerEvent, { endpoint: 'edge' });
    }
  }

  /**
   * Handle buffer low event.
   */
  private handleBufferLow(event: { count: number; needsPrefetch?: boolean }): void {
    if (event.needsPrefetch && !this.prefetchInFlight) {
      this.triggerPrefetch();
    }
  }

  /**
   * Handle buffer empty event.
   */
  private handleBufferEmpty(): void {
    console.warn('[VLAController] Buffer empty - underrun detected');
  }

  /**
   * Trigger an asynchronous prefetch of more actions.
   */
  private triggerPrefetch(): void {
    if (this.prefetchInFlight || this.mode !== 'active') return;

    this.prefetchInFlight = true;
    this.buffer.markPrefetchRequested();

    this.requestActions()
      .catch((error) => {
        console.error('[VLAController] Prefetch failed:', error);

        // Try endpoint switch on failure
        if (this.activeClient === this.cloudClient && this.edgeClient) {
          console.log('[VLAController] Switching to edge endpoint after prefetch failure');
          this.activeClient = this.edgeClient;
          this.emit('endpoint:switched' as VLAControllerEvent, { endpoint: 'edge' });
        }
      })
      .finally(() => {
        this.prefetchInFlight = false;
      });
  }

  /**
   * Request new actions from the inference server.
   */
  private async requestActions(): Promise<void> {
    if (!this.activeClient || !this.observationGenerator) {
      throw new Error('Controller not properly initialized');
    }

    const startTime = Date.now();

    // Generate current observation
    const observation = await this.observationGenerator();
    observation.languageInstruction = this.instruction;
    observation.sessionId = this.sessionId;

    // Request inference
    const actionChunk: ActionChunk = await this.activeClient.predict(observation);

    // Update RTT estimate
    const rtt = Date.now() - startTime;
    this.interpolator.updateRtt(rtt);

    // Update clock offset if actions have timestamps
    if (actionChunk.actions.length > 0) {
      this.interpolator.updateClockOffset(
        actionChunk.actions[0].timestamp,
        Date.now() / 1000
      );
    }

    // Push actions to buffer
    const added = await this.buffer.push(actionChunk.actions);
    console.log(
      `[VLAController] Received ${actionChunk.actions.length} actions, added ${added} to buffer (${this.buffer.getCount()}/${this.buffer.getCapacity()})`
    );
  }
}

/**
 * @file SafetyMonitor.ts
 * @description Core safety monitoring system per ISO 10218-1, ISO/TS 15066, and MR Annex III
 * @feature safety
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SafetyConfig,
  SafetyStatus,
  SafetyEvent,
  SafetyEventContext,
  SafetyStopType,
  StopCategory,
  EStopState,
  OperatingMode,
  ForceReading,
} from './types.js';
import { DEFAULT_SAFETY_CONFIG } from './types.js';
import type { SimulatedRobotState } from '../robot/types.js';
import { complianceLogClient } from '../compliance/ComplianceLogClient.js';

// ============================================================================
// TYPES
// ============================================================================

type StateGetter = () => SimulatedRobotState;
type StateUpdater = (updater: (state: SimulatedRobotState) => void) => void;
type ChangeNotifier = () => void;

export type SafetyEventCallback = (event: SafetyEvent) => void;

// ============================================================================
// BUTTERWORTH FILTER (2nd order low-pass for force monitoring)
// ============================================================================

/**
 * 2nd order Butterworth low-pass filter for force/torque signals
 * Used to filter high-frequency noise per ISO/TS 15066 recommendations
 */
class ButterworthFilter {
  private a: number[];
  private b: number[];
  private x: number[] = [0, 0, 0];
  private y: number[] = [0, 0, 0];

  constructor(cutoffHz: number, sampleRateHz: number) {
    // Calculate filter coefficients
    const omega = Math.tan((Math.PI * cutoffHz) / sampleRateHz);
    const omega2 = omega * omega;
    const sqrt2 = Math.SQRT2;
    const denom = omega2 + sqrt2 * omega + 1;

    // Numerator coefficients (b)
    this.b = [omega2 / denom, (2 * omega2) / denom, omega2 / denom];

    // Denominator coefficients (a)
    this.a = [
      1,
      (2 * (omega2 - 1)) / denom,
      (omega2 - sqrt2 * omega + 1) / denom,
    ];
  }

  /**
   * Process a single sample through the filter
   */
  process(input: number): number {
    // Shift input samples
    this.x[2] = this.x[1];
    this.x[1] = this.x[0];
    this.x[0] = input;

    // Compute output
    const output =
      this.b[0] * this.x[0] +
      this.b[1] * this.x[1] +
      this.b[2] * this.x[2] -
      this.a[1] * this.y[0] -
      this.a[2] * this.y[1];

    // Shift output samples
    this.y[2] = this.y[1];
    this.y[1] = this.y[0];
    this.y[0] = output;

    return output;
  }

  /**
   * Reset filter state
   */
  reset(): void {
    this.x = [0, 0, 0];
    this.y = [0, 0, 0];
  }
}

// ============================================================================
// SAFETY MONITOR
// ============================================================================

/**
 * SafetyMonitor - Core safety monitoring system
 *
 * Implements:
 * - Force/torque monitoring with Butterworth filtering
 * - Speed limiting (≤250 mm/s TCP in manual mode)
 * - Communication timeout detection
 * - E-stop state management
 * - Protective stop triggering
 * - Safety event logging
 */
export class SafetyMonitor {
  private readonly config: SafetyConfig;
  private stateGetter: StateGetter;
  private stateUpdater: StateUpdater;
  private changeNotifier: ChangeNotifier;

  // E-stop state
  private estopState: EStopState = {
    status: 'armed',
    stopCategory: 2,
    requiresManualReset: true,
  };

  // Operating mode
  private operatingMode: OperatingMode = 'automatic';

  // Server connection tracking
  private serverConnected = true;
  private lastServerHeartbeat: number = Date.now();

  // Force filter
  private forceFilter: ButterworthFilter;
  private currentFilteredForce = 0;

  // Monitoring interval
  private monitoringInterval: NodeJS.Timeout | null = null;

  // Safety event log
  private safetyEvents: SafetyEvent[] = [];
  private eventCallbacks: Set<SafetyEventCallback> = new Set();

  // Speed limiting
  private speedLimitActive = false;
  private speedLimitReason = '';

  constructor(
    stateGetter: StateGetter,
    stateUpdater: StateUpdater,
    changeNotifier: ChangeNotifier,
    config: Partial<SafetyConfig> = {}
  ) {
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
    this.stateGetter = stateGetter;
    this.stateUpdater = stateUpdater;
    this.changeNotifier = changeNotifier;

    // Initialize Butterworth filter for force monitoring
    // Note: In simulation, we run at a lower rate than 1kHz
    const actualSampleRate = 100; // 100Hz in simulation
    this.forceFilter = new ButterworthFilter(
      this.config.forceFilterCutoffHz,
      actualSampleRate
    );
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Start safety monitoring
   */
  start(): void {
    if (this.monitoringInterval) return;

    const state = this.stateGetter();
    console.log(`[SafetyMonitor] Starting safety monitoring for ${state.name}`);

    // Run at 100Hz in simulation (1kHz would be for real hardware)
    const intervalMs = 10; // 100Hz
    this.monitoringInterval = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  /**
   * Stop safety monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[SafetyMonitor] Safety monitoring stopped');
    }
  }

  /**
   * Check if monitoring is active
   */
  get isRunning(): boolean {
    return this.monitoringInterval !== null;
  }

  // ============================================================================
  // MONITORING TICK
  // ============================================================================

  /**
   * Perform a single monitoring tick
   */
  private tick(): void {
    // Check communication timeout
    this.checkCommunicationTimeout();

    // Check speed limits
    this.checkSpeedLimits();

    // Check force limits (simulated)
    this.checkForceLimits();

    // Check if E-stop should trigger fail-safe
    this.checkSystemHealth();
  }

  // ============================================================================
  // COMMUNICATION TIMEOUT
  // ============================================================================

  /**
   * Update server heartbeat timestamp
   * Call this when server communication is received
   */
  updateServerHeartbeat(): void {
    this.lastServerHeartbeat = Date.now();
    if (!this.serverConnected) {
      this.serverConnected = true;
      console.log('[SafetyMonitor] Server connection restored');
    }
  }

  /**
   * Check for communication timeout
   */
  private checkCommunicationTimeout(): void {
    const elapsed = Date.now() - this.lastServerHeartbeat;

    if (elapsed > this.config.communicationTimeoutMs && this.serverConnected) {
      this.serverConnected = false;
      console.warn('[SafetyMonitor] Communication timeout - triggering safe state');

      this.triggerProtectiveStop('communication_timeout', 'Server communication lost');
    }
  }

  /**
   * Simulate lost connection (for testing)
   */
  simulateConnectionLoss(): void {
    this.lastServerHeartbeat = Date.now() - this.config.communicationTimeoutMs - 100;
  }

  // ============================================================================
  // SPEED LIMITING
  // ============================================================================

  /**
   * Check and enforce speed limits
   */
  private checkSpeedLimits(): void {
    const state = this.stateGetter();

    // Convert speed from units/s to mm/s (assume 1 unit = 100mm for simulation)
    const speedMmPerSec = state.speed * 100;

    // Determine active speed limit based on operating mode
    const activeLimit =
      this.operatingMode === 'manual_reduced_speed'
        ? this.config.maxManualSpeedMmPerSec
        : this.config.maxAutoSpeedMmPerSec;

    if (speedMmPerSec > activeLimit) {
      if (!this.speedLimitActive) {
        this.speedLimitActive = true;
        this.speedLimitReason = `Speed ${speedMmPerSec.toFixed(0)} mm/s exceeds limit ${activeLimit} mm/s`;
        console.warn(`[SafetyMonitor] ${this.speedLimitReason}`);

        // In manual reduced speed mode, trigger protective stop
        if (this.operatingMode === 'manual_reduced_speed') {
          this.triggerProtectiveStop('speed_limit_exceeded', this.speedLimitReason);
        }
      }
    } else {
      this.speedLimitActive = false;
      this.speedLimitReason = '';
    }
  }

  /**
   * Get effective speed limit for current mode
   */
  getEffectiveSpeedLimit(): number {
    return this.operatingMode === 'manual_reduced_speed'
      ? this.config.maxManualSpeedMmPerSec
      : this.config.maxAutoSpeedMmPerSec;
  }

  // ============================================================================
  // FORCE MONITORING
  // ============================================================================

  /**
   * Process force reading through filter and check limits
   * Note: In simulation, force values are generated. In real hardware,
   * this would come from force/torque sensors.
   */
  processForceReading(force: ForceReading): void {
    // Apply Butterworth filter to force magnitude
    this.currentFilteredForce = this.forceFilter.process(force.magnitude);

    // Check against limit
    if (this.currentFilteredForce > this.config.forceLimitN) {
      this.triggerProtectiveStop(
        'force_limit_exceeded',
        `Force ${this.currentFilteredForce.toFixed(1)}N exceeds limit ${this.config.forceLimitN}N`
      );
    }
  }

  /**
   * Check force limits (simulated force in this implementation)
   */
  private checkForceLimits(): void {
    // In simulation, we generate synthetic force readings
    // In real hardware, this would read from sensors
    const simulatedForce = this.generateSimulatedForce();
    this.processForceReading(simulatedForce);
  }

  /**
   * Generate simulated force reading for testing
   */
  private generateSimulatedForce(): ForceReading {
    const state = this.stateGetter();

    // Base force proportional to speed (simulating resistance)
    const baseForce = state.speed * 5;

    // Add some noise
    const noise = (Math.random() - 0.5) * 2;

    return {
      fx: baseForce * 0.5 + noise,
      fy: baseForce * 0.3 + noise,
      fz: baseForce * 0.2 + noise,
      tx: 0,
      ty: 0,
      tz: 0,
      magnitude: baseForce + Math.abs(noise),
      timestamp: Date.now(),
    };
  }

  // ============================================================================
  // E-STOP CONTROL
  // ============================================================================

  /**
   * Trigger emergency stop
   * @param triggeredBy Source of E-stop trigger
   * @param reason Human-readable reason
   */
  triggerEmergencyStop(
    triggeredBy: 'local' | 'remote' | 'server' | 'zone' | 'system',
    reason: string
  ): void {
    console.log(`[SafetyMonitor] EMERGENCY STOP triggered by ${triggeredBy}: ${reason}`);

    this.estopState = {
      status: 'triggered',
      triggeredAt: new Date().toISOString(),
      triggeredBy,
      reason,
      stopCategory: 0, // E-stop uses Category 0
      requiresManualReset: this.config.estopRequiresManualReset,
    };

    // Execute immediate stop
    this.executeStop(0);

    // Log safety event
    this.logSafetyEvent('emergency_stop', 0, triggeredBy, reason);
  }

  /**
   * Trigger protective stop (system-initiated)
   */
  triggerProtectiveStop(type: SafetyStopType, reason: string): void {
    console.log(`[SafetyMonitor] PROTECTIVE STOP: ${reason}`);

    this.estopState = {
      status: 'triggered',
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'system',
      reason,
      stopCategory: this.config.defaultStopCategory,
      requiresManualReset: false, // Protective stops can auto-reset
    };

    // Execute stop with configured category
    this.executeStop(this.config.defaultStopCategory);

    // Log safety event
    this.logSafetyEvent(type, this.config.defaultStopCategory, 'system', reason);
  }

  /**
   * Reset E-stop state (requires deliberate action)
   */
  resetEmergencyStop(): boolean {
    if (this.estopState.status !== 'triggered') {
      return true; // Already reset
    }

    console.log('[SafetyMonitor] Resetting E-stop');

    this.estopState.status = 'resetting';
    this.changeNotifier();

    // Perform reset checks
    if (!this.canReset()) {
      console.warn('[SafetyMonitor] Cannot reset - safety conditions not met');
      return false;
    }

    this.estopState = {
      status: 'armed',
      stopCategory: this.config.defaultStopCategory,
      requiresManualReset: this.config.estopRequiresManualReset,
    };

    // Update robot state
    this.stateUpdater((s) => {
      s.status = 'online';
      s.warnings = s.warnings.filter(
        (w) => !w.includes('Emergency stop') && !w.includes('Protective stop')
      );
      s.updatedAt = new Date().toISOString();
    });

    this.changeNotifier();
    console.log('[SafetyMonitor] E-stop reset complete');

    return true;
  }

  /**
   * Check if reset is allowed
   */
  private canReset(): boolean {
    // Check server connection
    if (!this.serverConnected) {
      console.warn('[SafetyMonitor] Cannot reset: Server not connected');
      return false;
    }

    // Check force levels
    if (this.currentFilteredForce > this.config.forceLimitN * 0.8) {
      console.warn('[SafetyMonitor] Cannot reset: Force level too high');
      return false;
    }

    return true;
  }

  /**
   * Execute stop with specified category
   */
  private executeStop(category: StopCategory): void {
    this.stateUpdater((s) => {
      s.targetLocation = undefined;
      s.speed = 0;
      s.status = 'online'; // Stopped but not in error
      s.currentTaskName = category === 0 ? 'EMERGENCY STOP' : 'Protective stop';

      const warning =
        category === 0
          ? `Emergency stop activated: ${this.estopState.reason}`
          : `Protective stop: ${this.estopState.reason}`;

      if (!s.warnings.includes(warning)) {
        s.warnings.push(warning);
      }

      s.updatedAt = new Date().toISOString();
    });

    this.changeNotifier();
  }

  // ============================================================================
  // SYSTEM HEALTH
  // ============================================================================

  /**
   * Check overall system health
   */
  private checkSystemHealth(): void {
    // If safety monitoring itself fails, trigger fail-safe
    // This is a simplified check - real systems would have redundant monitoring
    const state = this.stateGetter();

    // Check for any critical errors that require immediate stop
    if (state.errors.some((e) => e.includes('Critical'))) {
      this.triggerProtectiveStop('system_failure', 'Critical system error detected');
    }
  }

  // ============================================================================
  // OPERATING MODE
  // ============================================================================

  /**
   * Set operating mode
   */
  setOperatingMode(mode: OperatingMode): void {
    const oldMode = this.operatingMode;
    this.operatingMode = mode;

    console.log(`[SafetyMonitor] Operating mode changed: ${oldMode} -> ${mode}`);

    // Reset filter when mode changes
    this.forceFilter.reset();
  }

  /**
   * Get current operating mode
   */
  getOperatingMode(): OperatingMode {
    return this.operatingMode;
  }

  // ============================================================================
  // STATUS & EVENTS
  // ============================================================================

  /**
   * Get current safety status
   */
  getStatus(): SafetyStatus {
    const state = this.stateGetter();

    return {
      estop: { ...this.estopState },
      operatingMode: this.operatingMode,
      serverConnected: this.serverConnected,
      lastServerHeartbeat: new Date(this.lastServerHeartbeat).toISOString(),
      currentForce: {
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        magnitude: this.currentFilteredForce,
        timestamp: Date.now(),
      },
      currentSpeed: state.speed * 100, // Convert to mm/s
      activeForceLimit: this.config.forceLimitN,
      activeSpeedLimit: this.getEffectiveSpeedLimit(),
      systemHealthy: this.estopState.status === 'armed',
      warnings: this.speedLimitActive ? [this.speedLimitReason] : [],
      lastCheckTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Get E-stop state
   */
  getEStopState(): EStopState {
    return { ...this.estopState };
  }

  /**
   * Check if E-stop is triggered
   */
  isEStopTriggered(): boolean {
    return this.estopState.status === 'triggered';
  }

  /**
   * Log a safety event
   */
  private logSafetyEvent(
    type: SafetyStopType,
    stopCategory: StopCategory,
    triggeredBy: 'local' | 'remote' | 'server' | 'zone' | 'system',
    reason: string
  ): void {
    const state = this.stateGetter();

    const context: SafetyEventContext = {
      robotId: state.id,
      robotName: state.name,
      location: {
        x: state.location.x,
        y: state.location.y,
        zone: state.location.zone,
      },
      speed: state.speed,
      forceReading: {
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        magnitude: this.currentFilteredForce,
        timestamp: Date.now(),
      },
      operatingMode: this.operatingMode,
      batteryLevel: state.batteryLevel,
      currentTask: state.currentTaskName,
      serverConnected: this.serverConnected,
    };

    const event: SafetyEvent = {
      id: uuidv4(),
      type,
      timestamp: new Date().toISOString(),
      stopCategory,
      triggeredBy,
      reason,
      context,
    };

    this.safetyEvents.unshift(event);

    // Keep only last 100 events
    if (this.safetyEvents.length > 100) {
      this.safetyEvents.pop();
    }

    // Log to compliance system (safety events are high priority - sent immediately)
    complianceLogClient.logSafetyAction({
      payload: {
        description: `Safety event: ${type}`,
        actionType: type,
        triggerReason: reason,
        robotState: {
          location: {
            x: context.location.x,
            y: context.location.y,
            z: 0,
          },
          speed: context.speed,
          force: context.forceReading?.magnitude,
          operatingMode: context.operatingMode,
        },
        resolutionRequired: stopCategory === 0, // E-stop requires manual reset
        metadata: {
          eventId: event.id,
          stopCategory,
          triggeredBy,
          batteryLevel: context.batteryLevel,
          currentTask: context.currentTask,
          serverConnected: context.serverConnected,
        },
      },
    }).catch((error) => {
      console.error('[SafetyMonitor] Failed to log to compliance system:', error);
    });

    // Notify callbacks
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[SafetyMonitor] Event callback error:', error);
      }
    });
  }

  /**
   * Get safety event log
   */
  getSafetyEvents(limit = 50): SafetyEvent[] {
    return this.safetyEvents.slice(0, limit);
  }

  /**
   * Subscribe to safety events
   */
  onSafetyEvent(callback: SafetyEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): SafetyConfig {
    return { ...this.config };
  }

  /**
   * Update force limit dynamically
   */
  setForceLimit(limitN: number): void {
    (this.config as SafetyConfig).forceLimitN = limitN;
    console.log(`[SafetyMonitor] Force limit set to ${limitN}N`);
  }

  /**
   * Update communication timeout
   */
  setCommunicationTimeout(timeoutMs: number): void {
    (this.config as SafetyConfig).communicationTimeoutMs = timeoutMs;
    console.log(`[SafetyMonitor] Communication timeout set to ${timeoutMs}ms`);
  }
}

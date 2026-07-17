/**
 * @file SafetyMonitor.ts
 * @description Core safety monitoring system per ISO 10218-1, ISO/TS 15066, and MR Annex III.
 *              Arm path (force/speed/comms) plus an embodiment-gated humanoid
 *              fall/tilt safety net (G1 / G1-EDU / H1) — fall DETECTION → stop,
 *              not fall PREVENTION (see TASK-169 Stage 4).
 * @feature safety
 * @status live
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
import type { SimulatedRobotState, RobotType } from '../robot/types.js';
import { complianceLogClient } from '../compliance/ComplianceLogClient.js';
import { hardwareClient } from '../hardware/HardwareClient.js';

// ============================================================================
// TYPES
// ============================================================================

type StateGetter = () => SimulatedRobotState;
type StateUpdater = (updater: (state: SimulatedRobotState) => void) => void;
type ChangeNotifier = () => void;

export type SafetyEventCallback = (event: SafetyEvent) => void;

// ============================================================================
// HUMANOID FALL / TILT SAFETY (G1 / G1-EDU / H1)
// ============================================================================

/**
 * Embodiments that walk on two legs and can therefore tip over. The humanoid
 * fall/tilt net below is enabled only for these; arms (so101) keep the original
 * ARM-shaped behavior unchanged.
 */
const HUMANOID_ROBOT_TYPES: ReadonlySet<RobotType> = new Set<RobotType>([
  'g1',
  'g1_edu',
  'h1',
]);

/**
 * A single IMU sample. SHARED CONTRACT with HardwareClient (owned by the
 * hardware agent): `hardwareClient.getImuNow()` resolves to this shape, or
 * `null` when no IMU telemetry is available yet.
 *
 * Frame: robotics convention (x-forward, y-left, z-up).
 */
export interface ImuReading {
  /** Body orientation [roll, pitch, yaw] in radians. */
  rpy: [number, number, number];
  /** Body angular velocity [wx, wy, wz] in rad/s. Optional — drives the fast-tip check; the tilt stop runs on rpy alone. */
  gyro?: [number, number, number];
  /** Linear acceleration [ax, ay, az] in m/s². Optional — fall detection uses only rpy (+ gyro). */
  accel?: [number, number, number];
}

/** Static joint travel limits fed in at construction for balance-margin checks. */
export interface JointLimit {
  name: string;
  /** Lower travel limit (rad). */
  limitLower: number;
  /** Upper travel limit (rad). */
  limitUpper: number;
}

/**
 * Tunable thresholds for the humanoid fall/tilt net. Conservative defaults;
 * override via constructor opts or the `SAFETY_*` env vars.
 */
export interface HumanoidSafetyConfig {
  /** |roll| or |pitch| (rad) that triggers a protective stop. ~0.5 rad ≈ 28°. */
  tiltStopRad: number;
  /** Earlier warn-band tilt (rad) surfaced as a safety warning. ~0.35 rad ≈ 20°. */
  tiltWarnRad: number;
  /** Body angular-velocity magnitude (rad/s) treated as a fast tip-over. */
  gyroTipStopRadPerSec: number;
  /** Warn when a leg joint sits within this fraction of its travel range of a limit. */
  jointLimitMarginFrac: number;
}

/** Conservative humanoid defaults — catch a tip-over without nuisance trips. */
export const DEFAULT_HUMANOID_SAFETY_CONFIG: HumanoidSafetyConfig = {
  tiltStopRad: 0.5,            // ~28.6°
  tiltWarnRad: 0.35,           // ~20°
  gyroTipStopRadPerSec: 2.5,   // fast body rotation = fall in progress
  jointLimitMarginFrac: 0.03,  // 3% of travel from a hard limit
};

/**
 * Options that enable / tune the humanoid safety net. All optional so existing
 * callers (and the arm path) are unaffected.
 */
export interface SafetyMonitorOptions {
  /** Active embodiment. Humanoid types enable the fall/tilt net; arms do not. */
  robotType?: RobotType;
  /** Override individual humanoid thresholds. */
  humanoid?: Partial<HumanoidSafetyConfig>;
  /** Leg-joint travel limits (hip/knee/ankle) for balance-margin warnings. */
  legJointLimits?: JointLimit[];
}

/** Read a finite float from env, or undefined when unset/invalid. */
function readEnvFloat(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Drop keys whose value is undefined so spreads don't clobber defaults. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((k) => {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  });
  return out;
}

/** Radians → degrees, one decimal, as a string for human-readable reasons. */
function toDeg(rad: number): string {
  return ((rad * 180) / Math.PI).toFixed(1);
}

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
 * - Humanoid fall/tilt net (G1 / G1-EDU / H1, embodiment-gated): orientation +
 *   leg-joint balance margin. This is fall DETECTION → protective stop, NOT
 *   fall PREVENTION — keeping a biped upright needs a balance / whole-body
 *   controller (TASK-169 Stage 4). CoM/ZMP balance is a documented gap.
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
  private serverConnected = false; // Start false — only true after first heartbeat from server
  private lastServerHeartbeat: number = Date.now();
  /** Throttle compliance log sends: same event type max once per 60s */
  private lastComplianceLogByType: Map<string, number> = new Map();

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

  // ── Humanoid fall/tilt safety net (G1 / G1-EDU / H1) ──────────────────────
  // Honesty: fall DETECTION → protective stop, NOT fall PREVENTION. Keeping a
  // biped upright needs a balance / whole-body controller (TASK-169 Stage 4).
  // CoM/ZMP balance margin is a DOCUMENTED GAP — not faked; the net is
  // orientation- + leg-joint-limit-based. All of this is inert on arms.
  private readonly isHumanoid: boolean;
  private readonly humanoidConfig: HumanoidSafetyConfig;
  private readonly legJointLimits: JointLimit[];
  /** Logged ONCE when humanoid + no IMU, so the degraded net is visible. */
  private imuMissingLogged = false;
  /** True while inside the tilt warn-band (transition-logged to avoid flooding). */
  private tiltWarnActive = false;
  /** Active humanoid warnings surfaced via getStatus(); self-clearing per update. */
  private tiltWarning: string | null = null;
  private jointLimitWarnings: string[] = [];

  constructor(
    stateGetter: StateGetter,
    stateUpdater: StateUpdater,
    changeNotifier: ChangeNotifier,
    config: Partial<SafetyConfig> = {},
    options: SafetyMonitorOptions = {}
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

    // Humanoid fall/tilt net — enabled only for bipedal embodiments. Thresholds:
    // defaults < SAFETY_* env overrides < explicit constructor opts.
    this.isHumanoid = options.robotType
      ? HUMANOID_ROBOT_TYPES.has(options.robotType)
      : false;
    this.legJointLimits = options.legJointLimits ?? [];
    const envHumanoid: Partial<HumanoidSafetyConfig> = {
      tiltStopRad: readEnvFloat('SAFETY_TILT_STOP_RAD'),
      tiltWarnRad: readEnvFloat('SAFETY_TILT_WARN_RAD'),
      gyroTipStopRadPerSec: readEnvFloat('SAFETY_GYRO_TIP_RAD_S'),
      jointLimitMarginFrac: readEnvFloat('SAFETY_JOINT_MARGIN_FRAC'),
    };
    this.humanoidConfig = {
      ...DEFAULT_HUMANOID_SAFETY_CONFIG,
      ...stripUndefined(envHumanoid),
      ...stripUndefined(options.humanoid ?? {}),
    };

    if (this.isHumanoid) {
      console.log(
        `[SafetyMonitor] Humanoid fall/tilt net ARMED for ${options.robotType} ` +
          `(tilt-stop ${toDeg(this.humanoidConfig.tiltStopRad)}°, ` +
          `gyro-tip ${this.humanoidConfig.gyroTipStopRadPerSec} rad/s, ` +
          `${this.legJointLimits.length} leg joints)`
      );
    }
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

  /**
   * Whether the active embodiment is a humanoid (enables the fall/tilt net).
   * Used by the state manager to gate IMU/joint polling for bipedal robots.
   */
  get isHumanoidEmbodiment(): boolean {
    return this.isHumanoid;
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
   * Check force limits. TASK-184: when the hardware sidecar is connected and
   * reports real joint efforts (tau_est), the safety input is derived from
   * those instead of the random simulation; the simulation stays the fallback
   * so the check never goes dark.
   */
  private checkForceLimits(): void {
    const realForce = this.readRealForce();
    this.processForceReading(realForce ?? this.generateSimulatedForce());
  }

  /**
   * Derive a force/torque safety reading from REAL joint efforts.
   *
   * The robot has no wrist F/T sensor, so this is a documented PROXY mapping:
   * `magnitude` = the peak |tau_est| (N·m) across all reporting joints, read
   * 1:1 as Newtons (i.e. an assumed 1 m lever arm). Peak — not a norm over all
   * joints — because a biped's legs carry tens of N·m just standing; a sum/norm
   * would sit near the 140 N limit permanently, while an external collision
   * shows up as a spike on individual joints. fx/fy/fz carry the magnitude
   * split evenly (direction is unknown without a real F/T sensor); torque
   * components are left 0 rather than fabricated.
   *
   * Returns null (→ simulation fallback) when the sidecar is disconnected or
   * no joint reported an effort — absence of data must not read as "no force".
   */
  private readRealForce(): ForceReading | null {
    if (!hardwareClient.isConnected()) return null;
    let peak: number | null = null;
    for (const joint of hardwareClient.getJointStates()) {
      if (joint.effort !== undefined && Number.isFinite(joint.effort)) {
        const abs = Math.abs(joint.effort);
        if (peak === null || abs > peak) peak = abs;
      }
    }
    if (peak === null) return null;
    const component = peak / Math.sqrt(3);
    return {
      fx: component,
      fy: component,
      fz: component,
      tx: 0,
      ty: 0,
      tz: 0,
      magnitude: peak,
      timestamp: Date.now(),
    };
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
  // HUMANOID FALL / TILT SAFETY NET
  // ============================================================================

  /**
   * Feed a fresh IMU sample into the humanoid fall/tilt net.
   *
   * Detection ladder (fail-safe, reuses the existing protective-stop machinery,
   * event callbacks and compliance logging — no parallel path):
   *   1. Fast tip-over — gyro magnitude over `gyroTipStopRadPerSec`. Catches a
   *      fall already in progress before the body has rotated far.
   *   2. Body tilt     — |roll| or |pitch| over `tiltStopRad`: the robot is past
   *      recovery → protective stop.
   *   3. Warn band     — tilt over `tiltWarnRad`: surfaced as a warning, no stop.
   *
   * HONESTY: this is fall DETECTION → stop, NOT fall PREVENTION. A real biped
   * stays upright via a balance / whole-body controller (TASK-169 Stage 4); this
   * only brings the robot to a safe stop once a tip-over is detected.
   *
   * No-op on arm embodiments. When `imu` is null (no IMU telemetry) it never
   * false-trips — it logs ONCE that the net is degraded, then returns.
   */
  updateOrientation(imu: ImuReading | null): void {
    if (!this.isHumanoid) return;

    if (imu === null) {
      if (!this.imuMissingLogged) {
        this.imuMissingLogged = true;
        this.tiltWarning = null;
        this.tiltWarnActive = false;
        console.warn(
          '[SafetyMonitor] Humanoid fall-detection INACTIVE — no IMU telemetry ' +
            '(getImuNow() returned null). Tilt/tip safety net is DEGRADED until ' +
            'IMU data is available.'
        );
      }
      return;
    }

    // IMU recovered after a gap — re-arm logging so a later loss is visible again.
    if (this.imuMissingLogged) {
      this.imuMissingLogged = false;
      console.log('[SafetyMonitor] IMU telemetry available — humanoid fall-detection active');
    }

    // Already stopped — don't re-trigger on every poll (floods compliance log).
    if (this.estopState.status === 'triggered') return;

    const [roll, pitch] = imu.rpy;

    // 1. Fast tip-over in progress (angular velocity). Only when gyro is present
    //    (optional signal). Magnitude uses roll/pitch rate ONLY — yaw rate (gz)
    //    is in-place turning and must not trip the tip net.
    if (imu.gyro) {
      const [gx, gy] = imu.gyro;
      const gyroMag = Math.hypot(gx, gy);
      if (gyroMag > this.humanoidConfig.gyroTipStopRadPerSec) {
        this.tiltWarning = null;
        this.tiltWarnActive = false;
        this.triggerProtectiveStop(
          'protective_stop',
          `Fall risk: fast body rotation ${gyroMag.toFixed(2)} rad/s exceeds tip ` +
            `threshold ${this.humanoidConfig.gyroTipStopRadPerSec} rad/s`
        );
        return;
      }
    }

    // 2. Absolute body tilt past the stop threshold.
    const maxTilt = Math.max(Math.abs(roll), Math.abs(pitch));
    if (maxTilt > this.humanoidConfig.tiltStopRad) {
      this.tiltWarning = null;
      this.tiltWarnActive = false;
      this.triggerProtectiveStop(
        'protective_stop',
        `Fall risk: body tilt ${toDeg(maxTilt)}° exceeds ` +
          `${toDeg(this.humanoidConfig.tiltStopRad)}° limit ` +
          `(roll=${toDeg(roll)}°, pitch=${toDeg(pitch)}°)`
      );
      return;
    }

    // 3. Warn band — heads-up before the hard stop. Self-clears below threshold.
    if (maxTilt > this.humanoidConfig.tiltWarnRad) {
      this.tiltWarning = `Body tilt ${toDeg(maxTilt)}° (warn ≥ ${toDeg(this.humanoidConfig.tiltWarnRad)}°)`;
      if (!this.tiltWarnActive) {
        this.tiltWarnActive = true;
        console.warn(`[SafetyMonitor] ${this.tiltWarning}`);
      }
    } else {
      this.tiltWarning = null;
      this.tiltWarnActive = false;
    }
  }

  /**
   * Feed current joint state into the balance-margin net. Warns (does NOT stop)
   * when a leg joint (hip/knee/ankle) sits within `jointLimitMarginFrac` of a
   * hard travel limit — an over-extension that often precedes a stumble. The
   * hard-stop authority stays with {@link updateOrientation}; this only raises
   * warnings surfaced through {@link getStatus}.
   *
   * No-op on arms, when no leg limits were configured, or when joint telemetry
   * is empty (e.g. pure sim with no sidecar). DOCUMENTED GAP: true balance needs
   * CoM/ZMP data we do not have here — we do not fake it.
   */
  updateJointStates(joints: ReadonlyArray<{ name: string; position: number }>): void {
    if (!this.isHumanoid || this.legJointLimits.length === 0 || joints.length === 0) {
      if (this.jointLimitWarnings.length > 0) this.jointLimitWarnings = [];
      return;
    }

    const byName = new Map(joints.map((j) => [j.name, j.position]));
    const warnings: string[] = [];

    for (const limit of this.legJointLimits) {
      const pos = byName.get(limit.name);
      if (pos === undefined) continue;
      const range = limit.limitUpper - limit.limitLower;
      if (range <= 0) continue;
      const margin = range * this.humanoidConfig.jointLimitMarginFrac;
      if (pos <= limit.limitLower + margin || pos >= limit.limitUpper - margin) {
        warnings.push(
          `Leg joint ${limit.name} near limit (${pos.toFixed(2)} rad of ` +
            `[${limit.limitLower.toFixed(2)}, ${limit.limitUpper.toFixed(2)}])`
        );
      }
    }

    this.jointLimitWarnings = warnings;
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
      // E-stop state is not persisted, but robot warnings are: after a restart
      // the estop boots 'armed' while a "Protective stop"/"Emergency stop"
      // warning restored from persisted state would otherwise be uncleareable.
      const state = this.stateGetter();
      if (state.warnings.some((w) => w.includes('Emergency stop') || w.includes('Protective stop'))) {
        this.stateUpdater((s) => {
          s.warnings = s.warnings.filter(
            (w) => !w.includes('Emergency stop') && !w.includes('Protective stop')
          );
          s.updatedAt = new Date().toISOString();
        });
        this.changeNotifier();
      }
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

    // Don't re-trigger if already in protective stop — prevents flooding compliance logs
    if (this.estopState.status === 'triggered') {
      return;
    }

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
      warnings: [
        ...(this.speedLimitActive ? [this.speedLimitReason] : []),
        ...(this.tiltWarning ? [this.tiltWarning] : []),
        ...this.jointLimitWarnings,
      ],
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

    // Log to compliance system — throttled: same type max once per 60s to avoid DB flooding
    const now = Date.now();
    const lastLog = this.lastComplianceLogByType.get(type) ?? 0;
    if (now - lastLog < 60_000) {
      return; // Skip duplicate within throttle window
    }
    this.lastComplianceLogByType.set(type, now);

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

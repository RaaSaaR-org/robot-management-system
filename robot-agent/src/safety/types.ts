/**
 * @file types.ts
 * @description Safety system type definitions per ISO 10218-1, ISO/TS 15066, and MR Annex III
 * @feature safety
 */

// ============================================================================
// STOP CATEGORY TYPES (per ISO 10218-1)
// ============================================================================

/**
 * Stop categories per ISO 10218-1
 * - Category 0: Immediate power removal (uncontrolled stop)
 * - Category 1: Controlled stop, then power removal
 * - Category 2: Controlled stop with power maintained (safety-rated monitored stop)
 */
export type StopCategory = 0 | 1 | 2;

/**
 * Types of safety stops that can occur
 */
export type SafetyStopType =
  | 'emergency_stop'      // User-initiated E-stop
  | 'protective_stop'     // System-initiated protective stop
  | 'communication_timeout' // Server connection lost
  | 'force_limit_exceeded' // Force/torque limit exceeded
  | 'speed_limit_exceeded' // Speed limit exceeded
  | 'zone_violation'      // Entered restricted zone
  | 'system_failure';     // Safety system failure

// ============================================================================
// E-STOP STATE
// ============================================================================

/**
 * E-stop status enumeration
 */
export type EStopStatus = 'armed' | 'triggered' | 'resetting';

/**
 * E-stop state information
 */
export interface EStopState {
  status: EStopStatus;
  triggeredAt?: string;
  triggeredBy?: 'local' | 'remote' | 'server' | 'zone' | 'system';
  reason?: string;
  stopCategory: StopCategory;
  requiresManualReset: boolean;
}

// ============================================================================
// SAFETY MONITORING TYPES
// ============================================================================

/**
 * Operating mode per ISO 10218-1
 */
export type OperatingMode = 'automatic' | 'manual_reduced_speed' | 'manual_full_speed';

/**
 * Force/torque reading
 */
export interface ForceReading {
  fx: number;  // Force X (N)
  fy: number;  // Force Y (N)
  fz: number;  // Force Z (N)
  tx: number;  // Torque X (Nm)
  ty: number;  // Torque Y (Nm)
  tz: number;  // Torque Z (Nm)
  magnitude: number;  // Total force magnitude (N)
  timestamp: number;  // Timestamp in ms
}

/**
 * Speed monitoring data
 */
export interface SpeedReading {
  tcpSpeed: number;      // Tool center point speed (mm/s)
  jointSpeeds: number[]; // Individual joint speeds (rad/s)
  timestamp: number;
}

/**
 * Proximity sensor reading
 */
export interface ProximityReading {
  sensorId: string;
  distance: number;  // Distance in mm
  isTriggered: boolean;
  timestamp: number;
}

// ============================================================================
// ISO/TS 15066 FORCE LIMITS (in Newtons)
// ============================================================================

/**
 * Body region force limits per ISO/TS 15066 Table A.2
 */
export interface BodyRegionForceLimits {
  region: string;
  quasiStatic: number;  // Maximum quasi-static force (N)
  transient: number;    // Maximum transient force (N)
  contactPermissible: boolean;
}

/**
 * Default force limits per ISO/TS 15066
 */
export const ISO_15066_FORCE_LIMITS: Record<string, BodyRegionForceLimits> = {
  skull_forehead: {
    region: 'Skull/Forehead',
    quasiStatic: 130,
    transient: 130, // Contact not permissible, use same as quasi-static
    contactPermissible: false,
  },
  face: {
    region: 'Face',
    quasiStatic: 65,
    transient: 65,
    contactPermissible: false,
  },
  neck_front: {
    region: 'Neck (front)',
    quasiStatic: 35,
    transient: 35,
    contactPermissible: false,
  },
  neck_side_back: {
    region: 'Neck (side/back)',
    quasiStatic: 150,
    transient: 150,
    contactPermissible: true,
  },
  chest: {
    region: 'Chest',
    quasiStatic: 140,
    transient: 280,
    contactPermissible: true,
  },
  abdomen: {
    region: 'Abdomen',
    quasiStatic: 110,
    transient: 220,
    contactPermissible: true,
  },
  pelvis: {
    region: 'Pelvis',
    quasiStatic: 210,
    transient: 420,
    contactPermissible: true,
  },
  upper_arm: {
    region: 'Upper arm/Elbow',
    quasiStatic: 150,
    transient: 300,
    contactPermissible: true,
  },
  lower_arm: {
    region: 'Lower arm',
    quasiStatic: 160,
    transient: 320,
    contactPermissible: true,
  },
  hands_fingers: {
    region: 'Hands/Fingers',
    quasiStatic: 140,
    transient: 280,
    contactPermissible: true,
  },
  thigh_knee: {
    region: 'Thigh/Knee',
    quasiStatic: 220,
    transient: 440,
    contactPermissible: true,
  },
  lower_leg: {
    region: 'Lower leg',
    quasiStatic: 210,
    transient: 420,
    contactPermissible: true,
  },
};

// ============================================================================
// SAFETY CONFIGURATION
// ============================================================================

/**
 * Safety system configuration
 */
export interface SafetyConfig {
  /** Safety monitoring frequency in Hz (target: 1000Hz) */
  monitoringFrequencyHz: number;

  /** Communication timeout before safe state (ms) - default 1000ms */
  communicationTimeoutMs: number;

  /** Maximum TCP speed in manual mode (mm/s) - ISO 10218-1: ≤250 */
  maxManualSpeedMmPerSec: number;

  /** Maximum TCP speed in automatic mode (mm/s) */
  maxAutoSpeedMmPerSec: number;

  /** Force limit for protective stop (N) - conservative default */
  forceLimitN: number;

  /** Torque limit for protective stop (Nm) */
  torqueLimitNm: number;

  /** Default stop category for protective stops */
  defaultStopCategory: StopCategory;

  /** Whether E-stop requires manual reset */
  estopRequiresManualReset: boolean;

  /** Butterworth filter cutoff frequency for force monitoring (Hz) */
  forceFilterCutoffHz: number;
}

/**
 * Default safety configuration
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  monitoringFrequencyHz: 1000,          // 1kHz monitoring (simulated at lower rate)
  communicationTimeoutMs: 1000,          // 1 second timeout
  maxManualSpeedMmPerSec: 250,           // ISO 10218-1 limit
  maxAutoSpeedMmPerSec: 1500,            // Higher limit for auto mode
  forceLimitN: 140,                      // Conservative default (hands/fingers quasi-static)
  torqueLimitNm: 10,                     // Conservative torque limit
  defaultStopCategory: 2,                // Safety-rated monitored stop
  estopRequiresManualReset: true,        // Require deliberate reset
  forceFilterCutoffHz: 100,              // 100Hz Butterworth filter
};

// ============================================================================
// SAFETY EVENT TYPES
// ============================================================================

/**
 * Safety event for logging and reporting
 */
export interface SafetyEvent {
  id: string;
  type: SafetyStopType;
  timestamp: string;
  stopCategory: StopCategory;
  triggeredBy: 'local' | 'remote' | 'server' | 'zone' | 'system';
  reason: string;
  context: SafetyEventContext;
}

/**
 * Context captured during safety event
 */
export interface SafetyEventContext {
  robotId: string;
  robotName: string;
  location: { x: number; y: number; zone?: string };
  speed: number;
  forceReading?: ForceReading;
  operatingMode: OperatingMode;
  batteryLevel: number;
  currentTask?: string;
  serverConnected: boolean;
}

// ============================================================================
// SAFETY STATUS
// ============================================================================

/**
 * Overall safety system status
 */
export interface SafetyStatus {
  /** Current E-stop state */
  estop: EStopState;

  /** Current operating mode */
  operatingMode: OperatingMode;

  /** Server connection status */
  serverConnected: boolean;

  /** Last server heartbeat timestamp */
  lastServerHeartbeat?: string;

  /** Current force reading (if available) */
  currentForce?: ForceReading;

  /** Current speed (mm/s) */
  currentSpeed: number;

  /** Active force limit (N) */
  activeForceLimit: number;

  /** Active speed limit (mm/s) */
  activeSpeedLimit: number;

  /** Safety system health */
  systemHealthy: boolean;

  /** List of active safety warnings */
  warnings: string[];

  /** Timestamp of last safety check */
  lastCheckTimestamp: string;
}

/**
 * @file types.ts
 * @description Safety system type definitions per ISO 10218-1, ISO/TS 15066, and MR Annex III
 * @feature safety
 * @status live
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
// GEOFENCE (TASK-200)
// ============================================================================

/**
 * A keepout the robot is standing in (or within the safety margin of).
 * Everything here is for the operator who has to understand the stop.
 */
export interface ZoneViolation {
  /** Place id from the place graph, e.g. `RACK-A`. */
  placeId: string;
  /** Human name, e.g. `Rack A`. */
  placeName: string;
  /**
   * How far past the margined boundary the robot is, in metres. 0 means "just
   * touching the margin", larger means "deeper in".
   */
  depthM: number;
  /** Where the robot was when this was decided, in the graph frame. */
  poseM: { x: number; y: number };
}

/**
 * WHY an `unknown` verdict is unknown — a TYPED cause, deliberately not prose.
 *
 * Not every `unknown` means the fence stopped being a fence, and TASK-201 is
 * about telling the two apart. The operator-facing label
 * ({@link GeofenceEnforcement}) is derived from this field and from nothing
 * else: deriving it by matching on `reason` would make a safety state depend on
 * the wording of a sentence written for humans, so rephrasing the sentence
 * would silently lose the lapse.
 *
 *  - `no-pose`        — no pose sample at all. There is a fence and it cannot
 *    fence: NOT ENFORCING.
 *  - `pose-drifted`   — the drift budget is spent, so the pose may be tens of
 *    metres wrong. The fence cannot fence: NOT ENFORCING. This is the state
 *    TASK-201 was raised for.
 *  - `no-map`         — no place graph, or a frame that cannot be compared with
 *    one. There is no fence to enforce. A missing or unregistered survey is a
 *    MAP problem, and reporting it as a lapse would alarm on correct behaviour
 *    for every robot nobody has handed a survey to.
 *  - `release-margin` — the pose is TRUSTED and outside every keepout, but
 *    inside the release hysteresis band of one. A `violating` verdict still
 *    fires from here, so the fence IS enforcing; only a release is withheld.
 *  - `reanchor-hold`  — a `clear` verdict withheld because an operator
 *    re-anchored under a latched keepout stop. Again a withheld RELEASE, not a
 *    withheld STOP: the fence is enforcing, and harder than usual.
 */
export type GeofenceUnknownCause =
  | 'no-pose'
  | 'pose-drifted'
  | 'no-map'
  | 'release-margin'
  | 'reanchor-hold';

/**
 * What the geofence knows this instant. THREE states, not a boolean, and that
 * is the whole point (TASK-199's fail-closed split, applied to a real boundary):
 *
 *  - `violating` — a KNOWN, TRUSTED pose inside a keepout. The only state that
 *    triggers a stop.
 *  - `clear`     — a KNOWN, TRUSTED pose comfortably outside every keepout. The
 *    only state that releases one.
 *  - `unknown`   — no pose, or a pose whose drift budget is spent. It does
 *    NEITHER. Triggering here would damp the base several times an hour every
 *    time the sidecar drops a poll; clearing here would release a stop on the
 *    strength of having stopped being able to see the robot.
 */
export type GeofenceStatus =
  | { kind: 'unknown'; cause: GeofenceUnknownCause; reason: string }
  | { kind: 'clear' }
  | { kind: 'violating'; violation: ZoneViolation };

/**
 * Whether the keepout fence is actually fencing — the answer TASK-201 exists to
 * publish.
 *
 *  - `enforcing`     — a violation would stop the robot.
 *  - `not-enforcing` — a violation would NOT stop the robot, and the robot may
 *    walk through a keepout with `estop=armed` and `systemHealthy=true`. This
 *    is a real safety state and it must be said, not inferred.
 *  - `no-map`        — there is no fence at all on this robot. Distinct from
 *    `not-enforcing`: nothing lapsed, nothing was surveyed.
 */
export type GeofenceEnforcement = 'enforcing' | 'not-enforcing' | 'no-map';

/**
 * The one derivation of the operator-facing label from a verdict.
 *
 * Exhaustive over {@link GeofenceUnknownCause} on purpose: widening that union
 * makes `tsc` come back here and demand an answer for the new cause, which is
 * the property that stops a future `unknown` from defaulting into silence — the
 * exact shape of the defect this function was written for.
 *
 * Both `clear` and `violating` are `enforcing`: the fence answered, and an
 * answer either way is the fence working.
 */
export function geofenceEnforcement(status: GeofenceStatus): GeofenceEnforcement {
  if (status.kind !== 'unknown') return 'enforcing';
  switch (status.cause) {
    case 'no-pose':
    case 'pose-drifted':
      return 'not-enforcing';
    case 'no-map':
      return 'no-map';
    case 'release-margin':
    case 'reanchor-hold':
      return 'enforcing';
  }
}

/**
 * Opening words of the warn-only geofence advisory.
 *
 * Deliberately contains NONE of `'Protective stop'`, `'Emergency stop'` or
 * {@link ZONE_VIOLATION_REASON_PREFIX}: `SafetyMonitor` matches all three to
 * decide which latch a warning belongs to, and an advisory caught by one of
 * those filters would be deleted by the next reset — or, worse, read as a stop
 * that is not latched. This advisory is a WARNING, never a stop; it never
 * touches `estopState`, so `systemHealthy` cannot flip because of it.
 */
export const GEOFENCE_ADVISORY_PREFIX = 'Geofence not enforcing';

/**
 * The `/safety` warning for a fence that has stopped fencing, or null when
 * there is nothing to say.
 *
 * Null for `no-map` as well as for `enforcing`: a robot with no survey has no
 * fence to lose, and a warning on every un-surveyed robot is how a warning
 * channel becomes wallpaper.
 */
export function geofenceAdvisory(status: GeofenceStatus): string | null {
  if (geofenceEnforcement(status) !== 'not-enforcing') return null;
  // Narrowed by the guard above: only `unknown` maps to `not-enforcing`.
  const reason = status.kind === 'unknown' ? status.reason : '';
  return (
    `${GEOFENCE_ADVISORY_PREFIX}: keepout places cannot stop the robot — ${reason}. ` +
    'Re-anchor the pose, or move the robot by hand.'
  );
}

/**
 * Prefix every `zone_violation` stop reason starts with. `SafetyMonitor` matches
 * on it to decide whether a latched protective stop is ITS geofence stop —
 * exactly how the communication-timeout stop identifies its own latch — so that
 * clearing the geofence can never silently release a tilt or force stop.
 */
export const ZONE_VIOLATION_REASON_PREFIX = 'Keepout violated';

/** One-line stop reason, written for the operator who has to act on it. */
export function zoneViolationReason(violation: ZoneViolation): string {
  return (
    `${ZONE_VIOLATION_REASON_PREFIX}: ${violation.placeName} (${violation.placeId}) — ` +
    `${violation.depthM.toFixed(2)} m past the safety margin at ` +
    `(${violation.poseM.x.toFixed(2)}, ${violation.poseM.y.toFixed(2)})`
  );
}

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
  communicationTimeoutMs: 30000,         // 30 second timeout (was 1s — too short for startup)
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

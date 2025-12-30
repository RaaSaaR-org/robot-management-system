/**
 * @file safety.types.ts
 * @description Safety system type definitions for the frontend
 * @feature safety
 */

// ============================================================================
// E-STOP TYPES
// ============================================================================

/** E-stop scope */
export type EStopScope = 'robot' | 'zone' | 'fleet';

/** E-stop status */
export type EStopStatus = 'armed' | 'triggered' | 'resetting';

/** Operating mode per ISO 10218-1 */
export type OperatingMode = 'automatic' | 'manual_reduced_speed' | 'manual_full_speed';

/** Stop category per ISO 10218-1 */
export type StopCategory = 0 | 1 | 2;

// ============================================================================
// ROBOT SAFETY STATUS
// ============================================================================

/**
 * E-stop state for a single robot
 */
export interface RobotEStopState {
  status: EStopStatus;
  triggeredAt?: string;
  triggeredBy?: 'local' | 'remote' | 'server' | 'zone' | 'system';
  reason?: string;
  stopCategory: StopCategory;
  requiresManualReset: boolean;
}

/**
 * Full safety status for a robot
 */
export interface RobotSafetyStatus {
  robotId: string;
  robotName: string;
  status: EStopStatus;
  triggeredAt?: string;
  triggeredBy?: 'local' | 'remote' | 'server' | 'zone' | 'system';
  reason?: string;
  stopCategory: StopCategory;
  requiresManualReset: boolean;
  operatingMode: OperatingMode;
  serverConnected: boolean;
  lastServerHeartbeat?: string;
  currentSpeed: number;
  activeSpeedLimit: number;
  activeForceLimit: number;
  systemHealthy: boolean;
  warnings: string[];
  lastCheckTimestamp: string;
}

// ============================================================================
// FLEET SAFETY STATUS
// ============================================================================

/**
 * Fleet-wide safety status
 */
export interface FleetSafetyStatus {
  timestamp: string;
  robots: RobotSafetyStatus[];
  anyTriggered: boolean;
  triggeredCount: number;
}

// ============================================================================
// E-STOP RESULTS
// ============================================================================

/**
 * Result of E-stop operation on a single robot
 */
export interface RobotEStopResult {
  robotId: string;
  robotName: string;
  success: boolean;
  error?: string;
}

/**
 * Result of fleet-wide E-stop
 */
export interface FleetEStopResult {
  scope: EStopScope;
  triggeredAt: string;
  triggeredBy: string;
  reason: string;
  robotResults: RobotEStopResult[];
  successCount: number;
  failureCount: number;
}

/**
 * Result of zone-based E-stop
 */
export interface ZoneEStopResult extends FleetEStopResult {
  zoneId: string;
  zoneName: string;
}

// ============================================================================
// E-STOP EVENTS
// ============================================================================

/**
 * E-stop event from server
 */
export interface EStopEvent {
  id: string;
  scope: EStopScope;
  triggeredAt: string;
  triggeredBy: string;
  reason: string;
  affectedRobots: string[];
  result: FleetEStopResult | ZoneEStopResult;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to trigger E-stop
 */
export interface TriggerEStopRequest {
  reason: string;
  triggeredBy?: string;
}

/**
 * Response from E-stop trigger
 */
export interface TriggerEStopResponse {
  message: string;
  robotId?: string;
  status: EStopStatus;
  triggeredAt: string;
}

/**
 * E-stop event log response
 */
export interface EStopEventLogResponse {
  events: EStopEvent[];
  count: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Display labels for E-stop status */
export const ESTOP_STATUS_LABELS: Record<EStopStatus, string> = {
  armed: 'Armed',
  triggered: 'TRIGGERED',
  resetting: 'Resetting...',
};

/** Display labels for operating modes */
export const OPERATING_MODE_LABELS: Record<OperatingMode, string> = {
  automatic: 'Automatic',
  manual_reduced_speed: 'Manual (Reduced Speed)',
  manual_full_speed: 'Manual (Full Speed)',
};

/** Colors for E-stop status */
export const ESTOP_STATUS_COLORS: Record<EStopStatus, string> = {
  armed: 'green',
  triggered: 'red',
  resetting: 'yellow',
};

/** Speed limit for manual reduced speed mode (mm/s) per ISO 10218-1 */
export const MANUAL_SPEED_LIMIT_MM_S = 250;

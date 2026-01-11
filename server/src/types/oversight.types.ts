/**
 * @file oversight.types.ts
 * @description Type definitions for human oversight infrastructure
 * @feature oversight
 *
 * Implements oversight types for EU AI Act Article 14 compliance:
 * - Art. 14(4)(a): Understand capabilities & limitations
 * - Art. 14(4)(c): Interpret AI outputs correctly
 * - Art. 14(4)(d): Decide not to use / disregard AI output
 * - Art. 14(4)(e): Intervene or stop the system
 * - Art. 14(3): Automation bias prevention
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/**
 * Robot operating modes
 */
export const OperatingModes = ['automatic', 'manual_reduced_speed', 'manual_full_speed'] as const;

export type OperatingMode = (typeof OperatingModes)[number];

/**
 * Anomaly types for detection
 */
export const AnomalyTypes = [
  'confidence_drop',
  'behavior_drift',
  'performance_degradation',
  'safety_warning',
  'communication_loss',
  'sensor_malfunction',
] as const;

export type AnomalyType = (typeof AnomalyTypes)[number];

/**
 * Anomaly severity levels
 */
export const AnomalySeverities = ['low', 'medium', 'high', 'critical'] as const;

export type AnomalySeverity = (typeof AnomalySeverities)[number];

/**
 * Oversight action types for audit logging
 */
export const OversightActionTypes = [
  'manual_mode_activated',
  'manual_mode_deactivated',
  'task_reassigned',
  'task_cancelled',
  'verification_completed',
  'anomaly_acknowledged',
  'anomaly_resolved',
  'decision_overridden',
  'robot_stopped',
  'fleet_stopped',
] as const;

export type OversightActionType = (typeof OversightActionTypes)[number];

/**
 * Verification completion statuses
 */
export const VerificationStatuses = ['completed', 'skipped', 'deferred'] as const;

export type VerificationStatus = (typeof VerificationStatuses)[number];

/**
 * Robot scope types for verification schedules
 */
export const RobotScopes = ['all', 'robot', 'zone'] as const;

export type RobotScope = (typeof RobotScopes)[number];

// ============================================================================
// ISO/AI ACT CONSTANTS
// ============================================================================

/**
 * ISO 10218-1 speed limits for manual mode (mm/s)
 */
export const MANUAL_SPEED_LIMITS = {
  reduced: 250, // Reduced speed manual mode
  full: 1000, // Full speed (requires additional safety measures)
} as const;

/**
 * ISO/TS 15066 force limits for collaborative robots (N)
 */
export const FORCE_LIMITS = {
  hands_fingers_quasi_static: 140,
  hands_fingers_transient: 280,
  skull_forehead: 130,
} as const;

/**
 * Default verification intervals (minutes)
 */
export const DEFAULT_VERIFICATION_INTERVALS = {
  safety_check: 60, // Hourly safety verification
  performance_review: 480, // 8-hour performance review
  daily_audit: 1440, // Daily audit
} as const;

// ============================================================================
// MANUAL CONTROL SESSION TYPES
// ============================================================================

/**
 * Manual control session entity
 */
export interface ManualControlSession {
  id: string;
  robotId: string;
  operatorId: string;
  reason: string;
  startedAt: Date;
  endedAt: Date | null;
  isActive: boolean;
  speedLimitMmPerSec: number;
  forceLimitN: number;

  // Optional joined data
  robotName?: string;
  operatorName?: string;
}

/**
 * Input for activating manual control mode
 */
export interface ActivateManualModeInput {
  robotId: string;
  operatorId: string;
  reason: string;
  mode?: 'reduced_speed' | 'full_speed';
}

/**
 * Response for manual mode activation
 */
export interface ManualModeResponse {
  session: ManualControlSession;
  robot: {
    id: string;
    name: string;
    previousMode: OperatingMode;
    newMode: OperatingMode;
  };
}

// ============================================================================
// VERIFICATION SCHEDULE TYPES
// ============================================================================

/**
 * Verification schedule entity
 */
export interface VerificationSchedule {
  id: string;
  name: string;
  description: string | null;
  intervalMinutes: number;
  robotScope: RobotScope;
  scopeId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  // Optional: computed fields
  lastCompletedAt?: Date | null;
  nextDueAt?: Date;
  isOverdue?: boolean;
  completionRate?: number;
}

/**
 * Verification completion record
 */
export interface VerificationCompletion {
  id: string;
  scheduleId: string;
  operatorId: string;
  robotId: string | null;
  status: VerificationStatus;
  notes: string | null;
  completedAt: Date;

  // Optional joined data
  scheduleName?: string;
  operatorName?: string;
  robotName?: string;
}

/**
 * Input for creating a verification schedule
 */
export interface CreateVerificationScheduleInput {
  name: string;
  description?: string;
  intervalMinutes: number;
  robotScope?: RobotScope;
  scopeId?: string;
}

/**
 * Input for completing a verification
 */
export interface CompleteVerificationInput {
  scheduleId: string;
  operatorId: string;
  robotId?: string;
  status: VerificationStatus;
  notes?: string;
}

/**
 * Due verification with schedule info
 */
export interface DueVerification {
  schedule: VerificationSchedule;
  lastCompletion: VerificationCompletion | null;
  dueAt: Date;
  overdueSinceMinutes: number;
}

// ============================================================================
// ANOMALY RECORD TYPES
// ============================================================================

/**
 * Anomaly record entity
 */
export interface AnomalyRecord {
  id: string;
  robotId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detectedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  resolution: string | null;
  isActive: boolean;

  // Optional joined data
  robotName?: string;
  acknowledgedByName?: string;
}

/**
 * Input for creating an anomaly record
 */
export interface CreateAnomalyInput {
  robotId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  description: string;
}

/**
 * Input for acknowledging an anomaly
 */
export interface AcknowledgeAnomalyInput {
  anomalyId: string;
  operatorId: string;
}

/**
 * Input for resolving an anomaly
 */
export interface ResolveAnomalyInput {
  anomalyId: string;
  resolution: string;
}

// ============================================================================
// OVERSIGHT LOG TYPES
// ============================================================================

/**
 * Oversight log entry
 */
export interface OversightLog {
  id: string;
  actionType: OversightActionType;
  operatorId: string;
  robotId: string | null;
  taskId: string | null;
  decisionId: string | null;
  reason: string;
  details: Record<string, unknown>;
  timestamp: Date;

  // Optional joined data
  operatorName?: string;
  robotName?: string;
  taskName?: string;
}

/**
 * Input for creating an oversight log entry
 */
export interface CreateOversightLogInput {
  actionType: OversightActionType;
  operatorId: string;
  robotId?: string;
  taskId?: string;
  decisionId?: string;
  reason: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// TASK REASSIGNMENT TYPES
// ============================================================================

/**
 * Input for reassigning a task
 */
export interface ReassignTaskInput {
  taskId: string;
  targetRobotId: string | null; // null = unassign
  operatorId: string;
  reason: string;
}

/**
 * Input for cancelling a task with override
 */
export interface CancelTaskOverrideInput {
  taskId: string;
  operatorId: string;
  reason: string;
}

/**
 * Task reassignment result
 */
export interface TaskReassignmentResult {
  taskId: string;
  taskName: string;
  previousRobotId: string | null;
  previousRobotName: string | null;
  newRobotId: string | null;
  newRobotName: string | null;
  reassignedAt: Date;
  reassignedBy: string;
}

// ============================================================================
// CAPABILITIES SUMMARY TYPES
// ============================================================================

/**
 * Robot capability information
 */
export interface RobotCapability {
  name: string;
  description: string;
  isAvailable: boolean;
  confidenceLevel?: number; // 0-100
  limitations?: string[];
}

/**
 * Robot capabilities summary for a single robot
 */
export interface RobotCapabilitiesSummary {
  robotId: string;
  robotName: string;
  model: string;
  firmware: string | null;

  // Operating state
  status: string;
  operatingMode: OperatingMode;
  isInManualMode: boolean;
  manualSession: ManualControlSession | null;

  // Capabilities
  capabilities: RobotCapability[];

  // Current limitations
  limitations: string[];
  warnings: string[];
  errors: string[];

  // Health metrics
  batteryLevel: number | null;
  cpuUsage: number | null;
  memoryUsage: number | null;
  temperature: number | null;

  // AI confidence
  overallConfidence: number | null;
  recentDecisionAccuracy: number | null;

  // Active anomalies
  activeAnomalies: AnomalyRecord[];
}

/**
 * Fleet-wide capabilities overview
 */
export interface FleetCapabilitiesOverview {
  totalRobots: number;
  onlineRobots: number;
  robotsInManualMode: number;
  robotsWithAnomalies: number;

  // Aggregate metrics
  averageConfidence: number | null;
  averageBatteryLevel: number | null;

  // Status breakdown
  statusBreakdown: Record<string, number>;
  modeBreakdown: Record<OperatingMode, number>;

  // Active issues
  totalActiveAnomalies: number;
  anomaliesBySeverity: Record<AnomalySeverity, number>;

  // Due verifications
  overdueVerifications: number;
  dueVerificationsToday: number;

  // Robot summaries
  robots: Array<{
    id: string;
    name: string;
    status: string;
    operatingMode: OperatingMode;
    hasAnomalies: boolean;
    batteryLevel: number | null;
  }>;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for manual sessions
 */
export interface ManualSessionQueryParams {
  robotId?: string;
  operatorId?: string;
  isActive?: boolean;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Query parameters for anomalies
 */
export interface AnomalyQueryParams {
  robotId?: string;
  anomalyType?: AnomalyType | AnomalyType[];
  severity?: AnomalySeverity | AnomalySeverity[];
  isActive?: boolean;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

/**
 * Query parameters for oversight logs
 */
export interface OversightLogQueryParams {
  actionType?: OversightActionType | OversightActionType[];
  operatorId?: string;
  robotId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

/**
 * Query parameters for verification schedules
 */
export interface VerificationScheduleQueryParams {
  isActive?: boolean;
  robotScope?: RobotScope;
  scopeId?: string;
}

/**
 * Paginated response for anomalies
 */
export interface AnomalyListResponse {
  anomalies: AnomalyRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Paginated response for oversight logs
 */
export interface OversightLogListResponse {
  logs: OversightLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================================
// DASHBOARD TYPES
// ============================================================================

/**
 * Oversight dashboard statistics
 */
export interface OversightDashboardStats {
  // Manual control
  activeManualSessions: number;
  manualSessionsToday: number;

  // Anomalies
  activeAnomalies: number;
  unacknowledgedAnomalies: number;
  anomaliesBySeverity: Record<AnomalySeverity, number>;
  anomaliesByType: Record<AnomalyType, number>;

  // Verifications
  totalVerificationSchedules: number;
  overdueVerifications: number;
  completedVerificationsToday: number;
  verificationComplianceRate: number; // 0-100

  // Recent activity
  recentLogs: OversightLog[];
  recentAnomalies: AnomalyRecord[];
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Oversight event types for WebSocket broadcasting
 */
export type OversightEventType =
  | 'manual_mode_changed'
  | 'anomaly_detected'
  | 'anomaly_acknowledged'
  | 'anomaly_resolved'
  | 'verification_due'
  | 'verification_completed'
  | 'task_reassigned'
  | 'oversight_action';

/**
 * Oversight event payload
 */
export interface OversightEvent {
  type: OversightEventType;
  robotId?: string;
  session?: ManualControlSession;
  anomaly?: AnomalyRecord;
  verification?: VerificationSchedule;
  log?: OversightLog;
  timestamp: Date;
}

/**
 * Callback for oversight events
 */
export type OversightEventCallback = (event: OversightEvent) => void;

/**
 * @file oversight.types.ts
 * @description Type definitions for human oversight feature (EU AI Act Art. 14)
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

export type OperatingMode = 'automatic' | 'manual_reduced_speed' | 'manual_full_speed';

export type AnomalyType =
  | 'confidence_drop'
  | 'behavior_drift'
  | 'performance_degradation'
  | 'safety_warning'
  | 'communication_loss'
  | 'sensor_malfunction';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type OversightActionType =
  | 'manual_mode_activated'
  | 'manual_mode_deactivated'
  | 'task_reassigned'
  | 'task_cancelled'
  | 'verification_completed'
  | 'anomaly_acknowledged'
  | 'anomaly_resolved'
  | 'decision_overridden'
  | 'robot_stopped'
  | 'fleet_stopped';

export type VerificationStatus = 'completed' | 'skipped' | 'deferred';

export type RobotScope = 'all' | 'robot' | 'zone';

// ============================================================================
// ISO/AI ACT CONSTANTS
// ============================================================================

export const MANUAL_SPEED_LIMITS = {
  reduced: 250, // mm/s - ISO 10218-1 reduced speed
  full: 1000, // mm/s - Full speed (requires additional safety)
} as const;

export const FORCE_LIMITS = {
  hands_fingers_quasi_static: 140, // N - ISO/TS 15066
  hands_fingers_transient: 280, // N
  skull_forehead: 130, // N
} as const;

// ============================================================================
// MANUAL CONTROL SESSION TYPES
// ============================================================================

export interface ManualControlSession {
  id: string;
  robotId: string;
  operatorId: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  speedLimitMmPerSec: number;
  forceLimitN: number;
  robotName?: string;
  operatorName?: string;
}

export interface ActivateManualModeInput {
  robotId: string;
  operatorId?: string;
  reason: string;
  mode?: 'reduced_speed' | 'full_speed';
}

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

export interface VerificationSchedule {
  id: string;
  name: string;
  description: string | null;
  intervalMinutes: number;
  robotScope: RobotScope;
  scopeId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastCompletedAt?: string | null;
  nextDueAt?: string;
  isOverdue?: boolean;
  completionRate?: number;
}

export interface VerificationCompletion {
  id: string;
  scheduleId: string;
  operatorId: string;
  robotId: string | null;
  status: VerificationStatus;
  notes: string | null;
  completedAt: string;
  scheduleName?: string;
  operatorName?: string;
  robotName?: string;
}

export interface CreateVerificationScheduleInput {
  name: string;
  description?: string;
  intervalMinutes: number;
  robotScope?: RobotScope;
  scopeId?: string;
}

export interface CompleteVerificationInput {
  scheduleId: string;
  operatorId?: string;
  robotId?: string;
  status: VerificationStatus;
  notes?: string;
}

export interface DueVerification {
  schedule: VerificationSchedule;
  lastCompletion: VerificationCompletion | null;
  dueAt: string;
  overdueSinceMinutes: number;
}

// ============================================================================
// ANOMALY RECORD TYPES
// ============================================================================

export interface AnomalyRecord {
  id: string;
  robotId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  isActive: boolean;
  robotName?: string;
  acknowledgedByName?: string;
}

// ============================================================================
// OVERSIGHT LOG TYPES
// ============================================================================

export interface OversightLog {
  id: string;
  actionType: OversightActionType;
  operatorId: string;
  robotId: string | null;
  taskId: string | null;
  decisionId: string | null;
  reason: string;
  details: Record<string, unknown>;
  timestamp: string;
  operatorName?: string;
  robotName?: string;
  taskName?: string;
}

// ============================================================================
// CAPABILITIES SUMMARY TYPES
// ============================================================================

export interface RobotCapability {
  name: string;
  description: string;
  isAvailable: boolean;
  confidenceLevel?: number;
  limitations?: string[];
}

export interface RobotCapabilitiesSummary {
  robotId: string;
  robotName: string;
  model: string;
  firmware: string | null;
  status: string;
  operatingMode: OperatingMode;
  isInManualMode: boolean;
  manualSession: ManualControlSession | null;
  capabilities: RobotCapability[];
  limitations: string[];
  warnings: string[];
  errors: string[];
  batteryLevel: number | null;
  cpuUsage: number | null;
  memoryUsage: number | null;
  temperature: number | null;
  overallConfidence: number | null;
  recentDecisionAccuracy: number | null;
  activeAnomalies: AnomalyRecord[];
}

export interface FleetCapabilitiesOverview {
  totalRobots: number;
  onlineRobots: number;
  robotsInManualMode: number;
  robotsWithAnomalies: number;
  averageConfidence: number | null;
  averageBatteryLevel: number | null;
  statusBreakdown: Record<string, number>;
  modeBreakdown: Record<OperatingMode, number>;
  totalActiveAnomalies: number;
  anomaliesBySeverity: Record<AnomalySeverity, number>;
  overdueVerifications: number;
  dueVerificationsToday: number;
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

export interface ManualSessionQueryParams {
  robotId?: string;
  operatorId?: string;
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface AnomalyQueryParams {
  robotId?: string;
  anomalyType?: AnomalyType | AnomalyType[];
  severity?: AnomalySeverity | AnomalySeverity[];
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface OversightLogQueryParams {
  actionType?: OversightActionType | OversightActionType[];
  operatorId?: string;
  robotId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface VerificationScheduleQueryParams {
  isActive?: boolean;
  robotScope?: RobotScope;
  scopeId?: string;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface AnomalyListResponse {
  anomalies: AnomalyRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

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

export interface OversightDashboardStats {
  activeManualSessions: number;
  manualSessionsToday: number;
  activeAnomalies: number;
  unacknowledgedAnomalies: number;
  anomaliesBySeverity: Record<AnomalySeverity, number>;
  anomaliesByType: Record<AnomalyType, number>;
  totalVerificationSchedules: number;
  overdueVerifications: number;
  completedVerificationsToday: number;
  verificationComplianceRate: number;
  recentLogs: OversightLog[];
  recentAnomalies: AnomalyRecord[];
}

// ============================================================================
// STORE TYPES
// ============================================================================

export interface OversightState {
  // Dashboard
  dashboardStats: OversightDashboardStats | null;
  dashboardLoading: boolean;
  dashboardError: string | null;

  // Manual control
  activeManualSessions: ManualControlSession[];
  manualSessionsLoading: boolean;

  // Anomalies
  anomalies: AnomalyRecord[];
  activeAnomalies: AnomalyRecord[];
  anomaliesLoading: boolean;
  anomaliesTotal: number;
  anomaliesPage: number;

  // Verifications
  verificationSchedules: VerificationSchedule[];
  dueVerifications: DueVerification[];
  verificationsLoading: boolean;

  // Fleet overview
  fleetOverview: FleetCapabilitiesOverview | null;
  fleetOverviewLoading: boolean;

  // Selected robot capabilities
  selectedRobotId: string | null;
  robotCapabilities: RobotCapabilitiesSummary | null;
  robotCapabilitiesLoading: boolean;

  // Oversight logs
  oversightLogs: OversightLog[];
  logsLoading: boolean;
  logsTotal: number;
  logsPage: number;
}

export interface OversightActions {
  // Dashboard
  fetchDashboardStats: () => Promise<void>;

  // Manual control
  fetchActiveManualSessions: () => Promise<void>;
  activateManualMode: (input: ActivateManualModeInput) => Promise<ManualModeResponse>;
  deactivateManualMode: (robotId: string) => Promise<void>;

  // Anomalies
  fetchAnomalies: (params?: AnomalyQueryParams) => Promise<void>;
  fetchActiveAnomalies: (robotId?: string) => Promise<void>;
  acknowledgeAnomaly: (anomalyId: string) => Promise<void>;
  resolveAnomaly: (anomalyId: string, resolution: string) => Promise<void>;

  // Verifications
  fetchVerificationSchedules: (params?: VerificationScheduleQueryParams) => Promise<void>;
  fetchDueVerifications: () => Promise<void>;
  createVerificationSchedule: (input: CreateVerificationScheduleInput) => Promise<VerificationSchedule>;
  completeVerification: (input: CompleteVerificationInput) => Promise<void>;

  // Fleet & robot capabilities
  fetchFleetOverview: () => Promise<void>;
  fetchRobotCapabilities: (robotId: string) => Promise<void>;
  setSelectedRobotId: (robotId: string | null) => void;

  // Oversight logs
  fetchOversightLogs: (params?: OversightLogQueryParams) => Promise<void>;

  // Reset
  reset: () => void;
}

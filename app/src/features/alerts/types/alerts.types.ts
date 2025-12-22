/**
 * @file alerts.types.ts
 * @description TypeScript type definitions for the alerts feature
 * @feature alerts
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/**
 * Alert severity levels ordered by priority (highest to lowest).
 */
export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';

/**
 * Source of the alert.
 */
export type AlertSource = 'robot' | 'task' | 'system' | 'user';

/**
 * Severity priority for sorting (lower number = higher priority).
 */
export const ALERT_SEVERITY_PRIORITY: Record<AlertSeverity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

/**
 * Human-readable labels for alert severities.
 */
export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  critical: 'Critical',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

/**
 * Human-readable labels for alert sources.
 */
export const ALERT_SOURCE_LABELS: Record<AlertSource, string> = {
  robot: 'Robot',
  task: 'Task',
  system: 'System',
  user: 'User',
};

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Represents an alert in the system.
 */
export interface Alert {
  /** Unique identifier */
  id: string;
  /** Severity level */
  severity: AlertSeverity;
  /** Short title */
  title: string;
  /** Detailed message */
  message: string;
  /** Where the alert originated */
  source: AlertSource;
  /** ID of the source entity (robotId, taskId, etc.) */
  sourceId?: string;
  /** ISO timestamp when alert was created */
  timestamp: string;
  /** Whether the alert has been acknowledged */
  acknowledged: boolean;
  /** ISO timestamp when acknowledged */
  acknowledgedAt?: string;
  /** Whether the alert can be dismissed by user */
  dismissable: boolean;
  /** Auto-dismiss after this many milliseconds (undefined = never) */
  autoDismissMs?: number;
}

/**
 * Request payload for creating a new alert.
 */
export interface CreateAlertRequest {
  /** Severity level */
  severity: AlertSeverity;
  /** Short title */
  title: string;
  /** Detailed message */
  message: string;
  /** Where the alert originated */
  source: AlertSource;
  /** ID of the source entity */
  sourceId?: string;
  /** Whether the alert can be dismissed (default: true for non-critical) */
  dismissable?: boolean;
  /** Auto-dismiss after ms (default: undefined for critical/error, 10000 for others) */
  autoDismissMs?: number;
}

// ============================================================================
// STATE TYPES
// ============================================================================

/**
 * Alerts store state.
 */
export interface AlertsState {
  /** All active alerts */
  alerts: Alert[];
  /** Loading state */
  isLoading: boolean;
}

/**
 * Alerts store actions.
 */
export interface AlertsActions {
  /** Add a new alert */
  addAlert: (request: CreateAlertRequest) => Alert;
  /** Remove an alert by ID */
  removeAlert: (id: string) => void;
  /** Acknowledge an alert (for critical alerts) */
  acknowledgeAlert: (id: string) => void;
  /** Clear all alerts */
  clearAllAlerts: () => void;
  /** Clear only acknowledged alerts */
  clearAcknowledgedAlerts: () => void;
}

/**
 * Complete alerts store type.
 */
export type AlertsStore = AlertsState & AlertsActions;

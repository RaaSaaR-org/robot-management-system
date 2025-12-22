/**
 * @file alertsStore.ts
 * @description Zustand store for alert management
 * @feature alerts
 * @dependencies zustand, immer, @/features/alerts/types
 * @stateAccess useAlertsStore (read/write)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  Alert,
  AlertSeverity,
  AlertSource,
  AlertsState,
  AlertsStore,
  CreateAlertRequest,
} from '../types/alerts.types';
import { ALERT_SEVERITY_PRIORITY } from '../types/alerts.types';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique ID for alerts.
 */
function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get default dismissable value based on severity.
 */
function getDefaultDismissable(severity: AlertSeverity): boolean {
  // Critical alerts require acknowledgment, cannot be simply dismissed
  return severity !== 'critical';
}

/**
 * Get default auto-dismiss duration based on severity.
 */
function getDefaultAutoDismissMs(severity: AlertSeverity): number | undefined {
  switch (severity) {
    case 'critical':
    case 'error':
      return undefined; // Don't auto-dismiss
    case 'warning':
      return 15000; // 15 seconds
    case 'info':
      return 10000; // 10 seconds
  }
}

/**
 * Sort alerts by severity (highest first) then by timestamp (newest first).
 */
function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const priorityDiff = ALERT_SEVERITY_PRIORITY[a.severity] - ALERT_SEVERITY_PRIORITY[b.severity];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: AlertsState = {
  alerts: [],
  isLoading: false,
};

// ============================================================================
// STORE
// ============================================================================

export const useAlertsStore = create<AlertsStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      // --------------------------------------------------------------------
      // ACTIONS
      // --------------------------------------------------------------------

      addAlert: (request: CreateAlertRequest): Alert => {
        const alert: Alert = {
          id: generateAlertId(),
          severity: request.severity,
          title: request.title,
          message: request.message,
          source: request.source,
          sourceId: request.sourceId,
          timestamp: new Date().toISOString(),
          acknowledged: false,
          dismissable: request.dismissable ?? getDefaultDismissable(request.severity),
          autoDismissMs: request.autoDismissMs ?? getDefaultAutoDismissMs(request.severity),
        };

        set((state) => {
          state.alerts = sortAlerts([...state.alerts, alert]);
        });

        return alert;
      },

      removeAlert: (id: string): void => {
        set((state) => {
          state.alerts = state.alerts.filter((a) => a.id !== id);
        });
      },

      acknowledgeAlert: (id: string): void => {
        set((state) => {
          const alert = state.alerts.find((a) => a.id === id);
          if (alert) {
            alert.acknowledged = true;
            alert.acknowledgedAt = new Date().toISOString();
          }
        });
      },

      clearAllAlerts: (): void => {
        set((state) => {
          state.alerts = [];
        });
      },

      clearAcknowledgedAlerts: (): void => {
        set((state) => {
          state.alerts = state.alerts.filter((a) => !a.acknowledged);
        });
      },
    })),
    { name: 'alerts-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

/**
 * Select all alerts.
 */
export const selectAlerts = (state: AlertsStore): Alert[] => state.alerts;

/**
 * Select loading state.
 */
export const selectIsLoading = (state: AlertsStore): boolean => state.isLoading;

/**
 * Select unacknowledged alerts.
 */
export const selectUnacknowledgedAlerts = (state: AlertsStore): Alert[] =>
  state.alerts.filter((a) => !a.acknowledged);

/**
 * Select acknowledged alerts.
 */
export const selectAcknowledgedAlerts = (state: AlertsStore): Alert[] =>
  state.alerts.filter((a) => a.acknowledged);

/**
 * Select critical alerts.
 */
export const selectCriticalAlerts = (state: AlertsStore): Alert[] =>
  state.alerts.filter((a) => a.severity === 'critical');

/**
 * Select unacknowledged critical alerts.
 */
export const selectUnacknowledgedCriticalAlerts = (state: AlertsStore): Alert[] =>
  state.alerts.filter((a) => a.severity === 'critical' && !a.acknowledged);

/**
 * Create a selector for alerts by severity.
 */
export const selectAlertsBySeverity =
  (severity: AlertSeverity) =>
  (state: AlertsStore): Alert[] =>
    state.alerts.filter((a) => a.severity === severity);

/**
 * Create a selector for alerts by source.
 */
export const selectAlertsBySource =
  (source: AlertSource, sourceId?: string) =>
  (state: AlertsStore): Alert[] =>
    state.alerts.filter((a) => a.source === source && (!sourceId || a.sourceId === sourceId));

/**
 * Select alert by ID.
 */
export const selectAlertById =
  (id: string) =>
  (state: AlertsStore): Alert | undefined =>
    state.alerts.find((a) => a.id === id);

/**
 * Select count of unacknowledged alerts.
 */
export const selectUnacknowledgedCount = (state: AlertsStore): number =>
  state.alerts.filter((a) => !a.acknowledged).length;

/**
 * Select the most critical unacknowledged alert.
 */
export const selectMostCriticalAlert = (state: AlertsStore): Alert | undefined => {
  const unacknowledged = state.alerts.filter((a) => !a.acknowledged);
  if (unacknowledged.length === 0) return undefined;
  // Already sorted by severity, so first is most critical
  return unacknowledged[0];
};

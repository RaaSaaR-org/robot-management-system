/**
 * @file alertsStore.ts
 * @description Zustand store for alert management with API integration
 * @feature alerts
 * @dependencies zustand, immer, @/features/alerts/types, @/features/alerts/api
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
  AlertHistoryFilters,
} from '../types/alerts.types';
import { ALERT_SEVERITY_PRIORITY } from '../types/alerts.types';
import { alertsApi } from '../api/alertsApi';

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
  error: null,

  history: [],
  historyPagination: {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  },
  historyFilters: {},
  isHistoryLoading: false,

  alertCounts: {
    critical: 0,
    error: 0,
    warning: 0,
    info: 0,
  },
};

// ============================================================================
// STORE
// ============================================================================

export const useAlertsStore = create<AlertsStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // --------------------------------------------------------------------
      // LOCAL ACTIONS
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

      addAlertFromServer: (alert: Alert): void => {
        set((state) => {
          // Check if alert already exists
          const exists = state.alerts.some((a) => a.id === alert.id);
          if (!exists) {
            state.alerts = sortAlerts([...state.alerts, alert]);
          }
        });
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

      acknowledgeAlertAsync: async (id: string): Promise<void> => {
        try {
          const updatedAlert = await alertsApi.acknowledgeAlert(id);
          set((state) => {
            const index = state.alerts.findIndex((a) => a.id === id);
            if (index !== -1) {
              state.alerts[index] = updatedAlert;
            }
            // Also update in history if present
            const historyIndex = state.history.findIndex((a) => a.id === id);
            if (historyIndex !== -1) {
              state.history[historyIndex] = updatedAlert;
            }
          });
        } catch (error) {
          console.error('Failed to acknowledge alert:', error);
          // Still update locally as fallback
          get().acknowledgeAlert(id);
        }
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

      // --------------------------------------------------------------------
      // API ACTIONS
      // --------------------------------------------------------------------

      fetchActiveAlerts: async (): Promise<void> => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const alerts = await alertsApi.getActiveAlerts();
          set((state) => {
            state.alerts = sortAlerts(alerts);
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to fetch alerts';
          });
        }
      },

      fetchAlertHistory: async (page?: number): Promise<void> => {
        const { historyFilters, historyPagination } = get();
        const targetPage = page ?? historyPagination.page;

        set((state) => {
          state.isHistoryLoading = true;
        });

        try {
          const result = await alertsApi.getAlertHistory(
            {
              severity: historyFilters.severity,
              source: historyFilters.source,
              acknowledged: historyFilters.acknowledged,
              startDate: historyFilters.startDate,
              endDate: historyFilters.endDate,
            },
            {
              page: targetPage,
              pageSize: historyPagination.pageSize,
            }
          );

          set((state) => {
            state.history = result.data;
            state.historyPagination = result.pagination;
            state.isHistoryLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch alert history:', error);
          set((state) => {
            state.isHistoryLoading = false;
          });
        }
      },

      setHistoryFilters: (filters: AlertHistoryFilters): void => {
        set((state) => {
          state.historyFilters = filters;
          state.historyPagination.page = 1; // Reset to first page on filter change
        });
        // Fetch with new filters
        get().fetchAlertHistory(1);
      },

      fetchAlertCounts: async (): Promise<void> => {
        try {
          const counts = await alertsApi.getAlertCounts();
          set((state) => {
            state.alertCounts = counts;
          });
        } catch (error) {
          console.error('Failed to fetch alert counts:', error);
        }
      },

      reset: (): void => {
        set(initialState);
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
 * Select error state.
 */
export const selectError = (state: AlertsStore): string | null => state.error;

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

/**
 * Select alert history.
 */
export const selectHistory = (state: AlertsStore): Alert[] => state.history;

/**
 * Select history pagination.
 */
export const selectHistoryPagination = (state: AlertsStore) => state.historyPagination;

/**
 * Select history filters.
 */
export const selectHistoryFilters = (state: AlertsStore) => state.historyFilters;

/**
 * Select history loading state.
 */
export const selectIsHistoryLoading = (state: AlertsStore): boolean => state.isHistoryLoading;

/**
 * Select alert counts.
 */
export const selectAlertCounts = (state: AlertsStore) => state.alertCounts;

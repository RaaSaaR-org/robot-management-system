/**
 * @file useAlerts.ts
 * @description React hooks for alert state and operations
 * @feature alerts
 * @dependencies @/features/alerts/store, @/features/alerts/types
 * @stateAccess useAlertsStore (read/write)
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useAlertsStore,
  selectAlerts,
  selectIsLoading,
  selectError,
  selectHistory,
  selectHistoryPagination,
  selectHistoryFilters,
  selectIsHistoryLoading,
  selectAlertCounts,
} from '../store/alertsStore';
import type {
  Alert,
  AlertSeverity,
  AlertSource,
  CreateAlertRequest,
  AlertHistoryPagination,
  AlertHistoryFilters,
} from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseAlertsReturn {
  /** All alerts */
  alerts: Alert[];
  /** Unacknowledged alerts */
  unacknowledgedAlerts: Alert[];
  /** Critical alerts */
  criticalAlerts: Alert[];
  /** Unacknowledged critical alerts */
  unacknowledgedCriticalAlerts: Alert[];
  /** Most critical unacknowledged alert */
  mostCriticalAlert: Alert | undefined;
  /** Count of unacknowledged alerts */
  unacknowledgedCount: number;
  /** Loading state */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Add a new alert */
  addAlert: (request: CreateAlertRequest) => Alert;
  /** Remove an alert */
  removeAlert: (id: string) => void;
  /** Acknowledge an alert (local only) */
  acknowledgeAlert: (id: string) => void;
  /** Acknowledge an alert via API */
  acknowledgeAlertAsync: (id: string) => Promise<void>;
  /** Clear all alerts */
  clearAll: () => void;
  /** Clear only acknowledged alerts */
  clearAcknowledged: () => void;
  /** Fetch active alerts from server */
  fetchAlerts: () => Promise<void>;
}

export interface UseAlertReturn {
  /** The alert */
  alert: Alert | undefined;
  /** Remove this alert */
  remove: () => void;
  /** Acknowledge this alert */
  acknowledge: () => void;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for accessing alert state and operations.
 *
 * @example
 * ```tsx
 * function AlertCenter() {
 *   const { alerts, unacknowledgedCount, addAlert, acknowledgeAlert } = useAlerts();
 *
 *   const handleAddWarning = () => {
 *     addAlert({
 *       severity: 'warning',
 *       title: 'Low Battery',
 *       message: 'Robot ARM-001 battery is below 20%',
 *       source: 'robot',
 *       sourceId: 'robot-1',
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       <span>Alerts: {unacknowledgedCount}</span>
 *       {alerts.map(alert => <AlertItem key={alert.id} alert={alert} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAlerts(): UseAlertsReturn {
  const alerts = useAlertsStore(selectAlerts);
  const isLoading = useAlertsStore(selectIsLoading);
  const error = useAlertsStore(selectError);

  // Derive filtered values with useMemo to avoid infinite loops
  const unacknowledgedAlerts = useMemo(
    () => alerts.filter((a) => !a.acknowledged),
    [alerts]
  );
  const criticalAlerts = useMemo(
    () => alerts.filter((a) => a.severity === 'critical'),
    [alerts]
  );
  const unacknowledgedCriticalAlerts = useMemo(
    () => alerts.filter((a) => a.severity === 'critical' && !a.acknowledged),
    [alerts]
  );
  const mostCriticalAlert = useMemo(
    () => unacknowledgedAlerts[0],
    [unacknowledgedAlerts]
  );
  const unacknowledgedCount = useMemo(
    () => unacknowledgedAlerts.length,
    [unacknowledgedAlerts]
  );

  const storeAddAlert = useAlertsStore((state) => state.addAlert);
  const storeRemoveAlert = useAlertsStore((state) => state.removeAlert);
  const storeAcknowledgeAlert = useAlertsStore((state) => state.acknowledgeAlert);
  const storeAcknowledgeAlertAsync = useAlertsStore((state) => state.acknowledgeAlertAsync);
  const storeClearAll = useAlertsStore((state) => state.clearAllAlerts);
  const storeClearAcknowledged = useAlertsStore((state) => state.clearAcknowledgedAlerts);
  const storeFetchAlerts = useAlertsStore((state) => state.fetchActiveAlerts);

  const addAlert = useCallback(
    (request: CreateAlertRequest): Alert => {
      return storeAddAlert(request);
    },
    [storeAddAlert]
  );

  const removeAlert = useCallback(
    (id: string): void => {
      storeRemoveAlert(id);
    },
    [storeRemoveAlert]
  );

  const acknowledgeAlert = useCallback(
    (id: string): void => {
      storeAcknowledgeAlert(id);
    },
    [storeAcknowledgeAlert]
  );

  const acknowledgeAlertAsync = useCallback(
    async (id: string): Promise<void> => {
      await storeAcknowledgeAlertAsync(id);
    },
    [storeAcknowledgeAlertAsync]
  );

  const clearAll = useCallback((): void => {
    storeClearAll();
  }, [storeClearAll]);

  const clearAcknowledged = useCallback((): void => {
    storeClearAcknowledged();
  }, [storeClearAcknowledged]);

  const fetchAlerts = useCallback(async (): Promise<void> => {
    await storeFetchAlerts();
  }, [storeFetchAlerts]);

  return useMemo(
    () => ({
      alerts,
      unacknowledgedAlerts,
      criticalAlerts,
      unacknowledgedCriticalAlerts,
      mostCriticalAlert,
      unacknowledgedCount,
      isLoading,
      error,
      addAlert,
      removeAlert,
      acknowledgeAlert,
      acknowledgeAlertAsync,
      clearAll,
      clearAcknowledged,
      fetchAlerts,
    }),
    [
      alerts,
      unacknowledgedAlerts,
      criticalAlerts,
      unacknowledgedCriticalAlerts,
      mostCriticalAlert,
      unacknowledgedCount,
      isLoading,
      error,
      addAlert,
      removeAlert,
      acknowledgeAlert,
      acknowledgeAlertAsync,
      clearAll,
      clearAcknowledged,
      fetchAlerts,
    ]
  );
}

// ============================================================================
// SINGLE ALERT HOOK
// ============================================================================

/**
 * Hook for accessing a single alert.
 *
 * @param id - Alert ID
 *
 * @example
 * ```tsx
 * function AlertItem({ alertId }: { alertId: string }) {
 *   const { alert, acknowledge, remove } = useAlert(alertId);
 *
 *   if (!alert) return null;
 *
 *   return (
 *     <div>
 *       <span>{alert.title}</span>
 *       <button onClick={acknowledge}>Acknowledge</button>
 *       <button onClick={remove}>Dismiss</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAlert(id: string): UseAlertReturn {
  const alerts = useAlertsStore(selectAlerts);
  const alert = useMemo(() => alerts.find((a) => a.id === id), [alerts, id]);
  const storeRemoveAlert = useAlertsStore((state) => state.removeAlert);
  const storeAcknowledgeAlert = useAlertsStore((state) => state.acknowledgeAlert);

  const remove = useCallback((): void => {
    storeRemoveAlert(id);
  }, [id, storeRemoveAlert]);

  const acknowledge = useCallback((): void => {
    storeAcknowledgeAlert(id);
  }, [id, storeAcknowledgeAlert]);

  return useMemo(
    () => ({
      alert,
      remove,
      acknowledge,
    }),
    [alert, remove, acknowledge]
  );
}

// ============================================================================
// FILTERED HOOKS
// ============================================================================

/**
 * Hook to get alerts filtered by severity.
 */
export function useAlertsBySeverity(severity: AlertSeverity): Alert[] {
  const alerts = useAlertsStore(selectAlerts);
  return useMemo(() => alerts.filter((a) => a.severity === severity), [alerts, severity]);
}

/**
 * Hook to get alerts filtered by source.
 */
export function useAlertsBySource(source: AlertSource, sourceId?: string): Alert[] {
  const alerts = useAlertsStore(selectAlerts);
  return useMemo(
    () => alerts.filter((a) => a.source === source && (!sourceId || a.sourceId === sourceId)),
    [alerts, source, sourceId]
  );
}

/**
 * Hook to get alerts for a specific robot.
 */
export function useRobotAlerts(robotId: string): Alert[] {
  return useAlertsBySource('robot', robotId);
}

/**
 * Hook to get alerts for a specific task.
 */
export function useTaskAlerts(taskId: string): Alert[] {
  return useAlertsBySource('task', taskId);
}

// ============================================================================
// HISTORY HOOK
// ============================================================================

export interface UseAlertHistoryReturn {
  /** Alert history */
  history: Alert[];
  /** Pagination info */
  pagination: AlertHistoryPagination;
  /** Current filters */
  filters: AlertHistoryFilters;
  /** Loading state */
  isLoading: boolean;
  /** Fetch history (optionally with page) */
  fetchHistory: (page?: number) => Promise<void>;
  /** Set filters (triggers refetch) */
  setFilters: (filters: AlertHistoryFilters) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Go to specific page */
  goToPage: (page: number) => void;
}

/**
 * Hook for accessing alert history with pagination and filtering.
 *
 * @example
 * ```tsx
 * function AlertHistory() {
 *   const { history, pagination, isLoading, nextPage, prevPage, setFilters } = useAlertHistory();
 *
 *   useEffect(() => {
 *     // Fetch initial history on mount is handled by the hook
 *   }, []);
 *
 *   return (
 *     <div>
 *       {history.map(alert => <AlertItem key={alert.id} alert={alert} />)}
 *       <button onClick={prevPage} disabled={pagination.page <= 1}>Prev</button>
 *       <span>Page {pagination.page} of {pagination.totalPages}</span>
 *       <button onClick={nextPage} disabled={pagination.page >= pagination.totalPages}>Next</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAlertHistory(autoFetch = true): UseAlertHistoryReturn {
  const history = useAlertsStore(selectHistory);
  const pagination = useAlertsStore(selectHistoryPagination);
  const filters = useAlertsStore(selectHistoryFilters);
  const isLoading = useAlertsStore(selectIsHistoryLoading);
  const storeFetchHistory = useAlertsStore((state) => state.fetchAlertHistory);
  const storeSetFilters = useAlertsStore((state) => state.setHistoryFilters);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && history.length === 0) {
      storeFetchHistory(1);
    }
  }, [autoFetch, history.length, storeFetchHistory]);

  const fetchHistory = useCallback(
    async (page?: number): Promise<void> => {
      await storeFetchHistory(page);
    },
    [storeFetchHistory]
  );

  const setFilters = useCallback(
    (newFilters: AlertHistoryFilters): void => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  const nextPage = useCallback((): void => {
    if (pagination.page < pagination.totalPages) {
      storeFetchHistory(pagination.page + 1);
    }
  }, [pagination.page, pagination.totalPages, storeFetchHistory]);

  const prevPage = useCallback((): void => {
    if (pagination.page > 1) {
      storeFetchHistory(pagination.page - 1);
    }
  }, [pagination.page, storeFetchHistory]);

  const goToPage = useCallback(
    (page: number): void => {
      if (page >= 1 && page <= pagination.totalPages) {
        storeFetchHistory(page);
      }
    },
    [pagination.totalPages, storeFetchHistory]
  );

  return useMemo(
    () => ({
      history,
      pagination,
      filters,
      isLoading,
      fetchHistory,
      setFilters,
      nextPage,
      prevPage,
      goToPage,
    }),
    [history, pagination, filters, isLoading, fetchHistory, setFilters, nextPage, prevPage, goToPage]
  );
}

// ============================================================================
// ALERT COUNTS HOOK
// ============================================================================

export interface UseAlertCountsReturn {
  /** Counts by severity */
  counts: Record<AlertSeverity, number>;
  /** Total unacknowledged alerts */
  total: number;
  /** Fetch counts from server */
  fetchCounts: () => Promise<void>;
}

/**
 * Hook for accessing alert counts by severity.
 */
export function useAlertCounts(autoFetch = true): UseAlertCountsReturn {
  const counts = useAlertsStore(selectAlertCounts);
  const storeFetchCounts = useAlertsStore((state) => state.fetchAlertCounts);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      storeFetchCounts();
    }
  }, [autoFetch, storeFetchCounts]);

  const total = useMemo(
    () => counts.critical + counts.error + counts.warning + counts.info,
    [counts]
  );

  const fetchCounts = useCallback(async (): Promise<void> => {
    await storeFetchCounts();
  }, [storeFetchCounts]);

  return useMemo(
    () => ({
      counts,
      total,
      fetchCounts,
    }),
    [counts, total, fetchCounts]
  );
}

/**
 * @file useAlerts.ts
 * @description React hooks for alert state and operations
 * @feature alerts
 * @dependencies @/features/alerts/store, @/features/alerts/types
 * @stateAccess useAlertsStore (read/write)
 */

import { useCallback, useMemo } from 'react';
import { useAlertsStore, selectAlerts, selectIsLoading } from '../store/alertsStore';
import type { Alert, AlertSeverity, AlertSource, CreateAlertRequest } from '../types/alerts.types';

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
  /** Add a new alert */
  addAlert: (request: CreateAlertRequest) => Alert;
  /** Remove an alert */
  removeAlert: (id: string) => void;
  /** Acknowledge an alert */
  acknowledgeAlert: (id: string) => void;
  /** Clear all alerts */
  clearAll: () => void;
  /** Clear only acknowledged alerts */
  clearAcknowledged: () => void;
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
  const storeClearAll = useAlertsStore((state) => state.clearAllAlerts);
  const storeClearAcknowledged = useAlertsStore((state) => state.clearAcknowledgedAlerts);

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

  const clearAll = useCallback((): void => {
    storeClearAll();
  }, [storeClearAll]);

  const clearAcknowledged = useCallback((): void => {
    storeClearAcknowledged();
  }, [storeClearAcknowledged]);

  return useMemo(
    () => ({
      alerts,
      unacknowledgedAlerts,
      criticalAlerts,
      unacknowledgedCriticalAlerts,
      mostCriticalAlert,
      unacknowledgedCount,
      isLoading,
      addAlert,
      removeAlert,
      acknowledgeAlert,
      clearAll,
      clearAcknowledged,
    }),
    [
      alerts,
      unacknowledgedAlerts,
      criticalAlerts,
      unacknowledgedCriticalAlerts,
      mostCriticalAlert,
      unacknowledgedCount,
      isLoading,
      addAlert,
      removeAlert,
      acknowledgeAlert,
      clearAll,
      clearAcknowledged,
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

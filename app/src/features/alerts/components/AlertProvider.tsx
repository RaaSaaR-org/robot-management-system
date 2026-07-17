/**
 * @file AlertProvider.tsx
 * @description Provider component that handles auto-dismiss timers for alerts.
 *              The banner itself is rendered by AppLayout (in normal flow).
 * @feature alerts
 * @dependencies @/features/alerts/hooks
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useAlertsStore, selectAlerts } from '../store/alertsStore';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertProviderProps {
  /** Child components */
  children: ReactNode;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Provider component that wraps the app to handle auto-dismiss timers for alerts.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <AlertProvider>
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </AlertProvider>
 *   );
 * }
 * ```
 */
export function AlertProvider({ children }: AlertProviderProps) {
  const alerts = useAlertsStore(selectAlerts);
  const removeAlert = useAlertsStore((state) => state.removeAlert);

  // Track active timers
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Set up auto-dismiss timers for alerts
  useEffect(() => {
    const currentTimers = timersRef.current;

    // Check each alert for auto-dismiss
    alerts.forEach((alert) => {
      // Skip if no auto-dismiss or already has timer
      if (!alert.autoDismissMs || currentTimers.has(alert.id)) {
        return;
      }

      // Skip if already acknowledged (for critical alerts that were acknowledged)
      if (alert.acknowledged) {
        return;
      }

      // Create timer
      const timer = setTimeout(() => {
        removeAlert(alert.id);
        currentTimers.delete(alert.id);
      }, alert.autoDismissMs);

      currentTimers.set(alert.id, timer);
    });

    // Clean up timers for removed alerts
    currentTimers.forEach((timer, alertId) => {
      if (!alerts.find((a) => a.id === alertId)) {
        clearTimeout(timer);
        currentTimers.delete(alertId);
      }
    });

    // Cleanup on unmount
    return () => {
      currentTimers.forEach((timer) => clearTimeout(timer));
      currentTimers.clear();
    };
  }, [alerts, removeAlert]);

  return <>{children}</>;
}

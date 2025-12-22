/**
 * @file AlertProvider.tsx
 * @description Provider component that handles auto-dismiss timers and renders AlertBanner
 * @feature alerts
 * @dependencies @/features/alerts/hooks, @/features/alerts/components/AlertBanner
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useAlertsStore, selectAlerts } from '../store/alertsStore';
import { AlertBanner } from './AlertBanner';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertProviderProps {
  /** Child components */
  children: ReactNode;
  /** Whether to show the banner */
  showBanner?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Provider component that wraps the app to:
 * 1. Handle auto-dismiss timers for alerts
 * 2. Render the AlertBanner at the top
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
export function AlertProvider({ children, showBanner = true }: AlertProviderProps) {
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

  return (
    <>
      {showBanner && <AlertBanner />}
      {children}
    </>
  );
}

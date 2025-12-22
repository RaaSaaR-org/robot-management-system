/**
 * @file AlertBanner.tsx
 * @description Fixed banner displaying the most critical unacknowledged alert
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/hooks
 */

import { useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { useAlerts } from '../hooks/useAlerts';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import type { Alert, AlertSeverity } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertBannerProps {
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  critical: 'bg-red-500 border-red-600 text-white',
  error: 'bg-red-100 border-red-200 text-red-900 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
  warning: 'bg-yellow-100 border-yellow-200 text-yellow-900 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
  info: 'bg-blue-100 border-blue-200 text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
};

const SEVERITY_BUTTON_STYLES: Record<AlertSeverity, string> = {
  critical: 'bg-white/20 hover:bg-white/30 text-white border-white/30',
  error: 'bg-red-200 hover:bg-red-300 text-red-900 dark:bg-red-800 dark:hover:bg-red-700 dark:text-red-100',
  warning: 'bg-yellow-200 hover:bg-yellow-300 text-yellow-900 dark:bg-yellow-800 dark:hover:bg-yellow-700 dark:text-yellow-100',
  info: 'bg-blue-200 hover:bg-blue-300 text-blue-900 dark:bg-blue-800 dark:hover:bg-blue-700 dark:text-blue-100',
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface AlertBannerContentProps {
  alert: Alert;
  onAcknowledge: () => void;
  onDismiss: () => void;
}

function AlertBannerContent({ alert, onAcknowledge, onDismiss }: AlertBannerContentProps) {
  const isCritical = alert.severity === 'critical';
  const buttonStyle = SEVERITY_BUTTON_STYLES[alert.severity];

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <AlertSeverityBadge severity={alert.severity} showDot />
        <div className="min-w-0">
          <span className="font-medium">{alert.title}</span>
          <span className="mx-2">-</span>
          <span className="opacity-90">{alert.message}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {isCritical ? (
          <button
            onClick={onAcknowledge}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
              buttonStyle
            )}
          >
            Acknowledge
          </button>
        ) : (
          alert.dismissable && (
            <button
              onClick={onDismiss}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
                buttonStyle
              )}
            >
              Dismiss
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Fixed banner that displays the most critical unacknowledged alert.
 * Renders at the top of the viewport with severity-based styling.
 *
 * @example
 * ```tsx
 * function AppLayout({ children }) {
 *   return (
 *     <div>
 *       <AlertBanner />
 *       <main>{children}</main>
 *     </div>
 *   );
 * }
 * ```
 */
export function AlertBanner({ className }: AlertBannerProps) {
  const { mostCriticalAlert, acknowledgeAlert, removeAlert } = useAlerts();

  const handleAcknowledge = useCallback(() => {
    if (mostCriticalAlert) {
      acknowledgeAlert(mostCriticalAlert.id);
    }
  }, [mostCriticalAlert, acknowledgeAlert]);

  const handleDismiss = useCallback(() => {
    if (mostCriticalAlert) {
      removeAlert(mostCriticalAlert.id);
    }
  }, [mostCriticalAlert, removeAlert]);

  if (!mostCriticalAlert) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'fixed top-14 left-56 right-0 z-30 border-b transition-all duration-300 animate-in slide-in-from-top',
        SEVERITY_STYLES[mostCriticalAlert.severity],
        className
      )}
    >
      <AlertBannerContent
        alert={mostCriticalAlert}
        onAcknowledge={handleAcknowledge}
        onDismiss={handleDismiss}
      />
    </div>
  );
}

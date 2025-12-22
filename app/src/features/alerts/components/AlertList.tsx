/**
 * @file AlertList.tsx
 * @description Scrollable list displaying all alerts with actions
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/hooks
 */

import { useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { useAlerts } from '../hooks/useAlerts';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import type { Alert, AlertSeverity } from '../types/alerts.types';
import { ALERT_SOURCE_LABELS } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertListProps {
  /** Maximum height of the list */
  maxHeight?: string;
  /** Whether to show acknowledged alerts */
  showAcknowledged?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const SEVERITY_BORDER_STYLES: Record<AlertSeverity, string> = {
  critical: 'border-l-red-500',
  error: 'border-l-red-400',
  warning: 'border-l-yellow-400',
  info: 'border-l-blue-400',
};

// ============================================================================
// HELPERS
// ============================================================================

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface AlertItemProps {
  alert: Alert;
  onAcknowledge: (id: string) => void;
  onDismiss: (id: string) => void;
}

function AlertItem({ alert, onAcknowledge, onDismiss }: AlertItemProps) {
  const isCritical = alert.severity === 'critical';
  const canDismiss = alert.dismissable && (alert.acknowledged || !isCritical);

  return (
    <div
      className={cn(
        'p-3 bg-theme-elevated rounded-lg border-l-4 transition-opacity',
        SEVERITY_BORDER_STYLES[alert.severity],
        alert.acknowledged && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <AlertSeverityBadge severity={alert.severity} size="sm" />
            <span className="text-xs text-theme-tertiary">
              {ALERT_SOURCE_LABELS[alert.source]}
            </span>
            <span className="text-xs text-theme-tertiary">
              {formatTimestamp(alert.timestamp)}
            </span>
          </div>
          <h4 className="font-medium text-theme-primary text-sm">{alert.title}</h4>
          <p className="text-sm text-theme-secondary mt-0.5">{alert.message}</p>
          {alert.acknowledged && alert.acknowledgedAt && (
            <p className="text-xs text-theme-tertiary mt-1">
              Acknowledged {formatTimestamp(alert.acknowledgedAt)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {isCritical && !alert.acknowledged && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAcknowledge(alert.id)}
            >
              Acknowledge
            </Button>
          )}
          {canDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDismiss(alert.id)}
              aria-label="Dismiss alert"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-theme-tertiary mb-3"
      >
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <p className="text-sm text-theme-secondary">No alerts</p>
      <p className="text-xs text-theme-tertiary mt-1">All systems operating normally</p>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Scrollable list displaying all alerts with acknowledge and dismiss actions.
 *
 * @example
 * ```tsx
 * function AlertsPanel() {
 *   return (
 *     <div>
 *       <h2>Alerts</h2>
 *       <AlertList maxHeight="400px" showAcknowledged={false} />
 *     </div>
 *   );
 * }
 * ```
 */
export function AlertList({
  maxHeight = '400px',
  showAcknowledged = true,
  className,
}: AlertListProps) {
  const { alerts, unacknowledgedAlerts, acknowledgeAlert, removeAlert, clearAcknowledged } =
    useAlerts();

  const displayAlerts = showAcknowledged ? alerts : unacknowledgedAlerts;

  const handleAcknowledge = useCallback(
    (id: string) => {
      acknowledgeAlert(id);
    },
    [acknowledgeAlert]
  );

  const handleDismiss = useCallback(
    (id: string) => {
      removeAlert(id);
    },
    [removeAlert]
  );

  if (displayAlerts.length === 0) {
    return (
      <div className={className}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={className}>
      {showAcknowledged && alerts.some((a) => a.acknowledged) && (
        <div className="flex justify-end mb-2">
          <Button size="sm" variant="ghost" onClick={clearAcknowledged}>
            Clear acknowledged
          </Button>
        </div>
      )}
      <div
        className="space-y-2 overflow-y-auto"
        style={{ maxHeight }}
      >
        {displayAlerts.map((alert) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            onAcknowledge={handleAcknowledge}
            onDismiss={handleDismiss}
          />
        ))}
      </div>
    </div>
  );
}

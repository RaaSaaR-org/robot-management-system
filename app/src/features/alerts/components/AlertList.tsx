/**
 * @file AlertList.tsx
 * @description Scrollable list displaying all alerts with actions
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/hooks
 */

import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { formatDateTime, formatTimeAgo } from '@/shared/utils/format';
import { Button } from '@/shared/components/ui/Button';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { useAlerts } from '../hooks/useAlerts';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import type { Alert, AlertSeverity } from '../types/alerts.types';
import { ALERT_SOURCE_LABELS } from '../types/alerts.types';
import { findingLinkPath, parseFindingLink, stripFindingLink } from '@/features/patrol/utils/patrolFormat';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertListProps {
  /** Maximum height of the list. When omitted, the list flows with the page (no inner scrollbar). */
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
  const diffHours = (Date.now() - new Date(isoString).getTime()) / 3600000;
  // Relative for recent alerts, absolute (fixed English locale) beyond a day
  if (diffHours < 24) return formatTimeAgo(isoString);
  return formatDateTime(isoString, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface RobotRefProps {
  /** Robot ID the alert references */
  sourceId: string;
  /** Resolved robot name, or undefined when the robot no longer exists */
  robotName: string | undefined;
}

/**
 * Robot reference for an alert. Renders a linked chip when the robot still
 * exists; degrades to plain text when the referenced robot has been removed
 * (stale alerts must not render a broken chip/link).
 */
function RobotRef({ sourceId, robotName }: RobotRefProps) {
  if (!robotName) {
    return <span className="text-xs text-theme-tertiary truncate">{sourceId}</span>;
  }
  return (
    <Link
      to={`/robots/${sourceId}`}
      className="inline-flex max-w-full items-center px-1.5 py-0.5 rounded bg-theme-hover text-xs text-theme-secondary hover:text-theme-primary truncate"
    >
      {robotName}
    </Link>
  );
}

interface AlertItemProps {
  alert: Alert;
  /** Resolved name of the referenced robot, if it still exists */
  robotName?: string;
  onAcknowledge: (id: string) => void;
  onDismiss: (id: string) => void;
}

function AlertItem({ alert, robotName, onAcknowledge, onDismiss }: AlertItemProps) {
  const isCritical = alert.severity === 'critical';
  const canDismiss = alert.dismissable && (alert.acknowledged || !isCritical);
  // Degrade gracefully when the server sends a blank/broken title
  const title = alert.title?.trim() || ALERT_SOURCE_LABELS[alert.source] || 'Alert';
  // TASK-212: a robot alert raised for a patrol finding carries
  // `[finding:<id> run:<runId>]` in its message tail. Show it as a link into
  // the run, and keep the machine tag out of the prose.
  const findingLink = alert.source === 'robot' ? parseFindingLink(alert.message) ?? parseFindingLink(alert.title) : null;
  const findingPath = findingLink ? findingLinkPath(findingLink) : null;
  const message = findingLink ? stripFindingLink(alert.message) : alert.message;
  // A skipped-run alert carries a bare `[run:<id>]`: there is no finding to
  // jump to, so promising one ("Open finding") sends the operator looking for
  // something the run does not have.
  const linkLabel = findingLink?.findingId ? 'Open finding →' : 'Open run →';

  return (
    <div
      className={cn(
        'p-3 bg-theme-elevated rounded-lg border-l-4 transition-opacity',
        SEVERITY_BORDER_STYLES[alert.severity],
        alert.acknowledged && 'opacity-60'
      )}
    >
      {/* Stack actions below the text on narrow screens; side-by-side from sm up */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
            <AlertSeverityBadge severity={alert.severity} size="sm" />
            <span className="text-xs text-theme-tertiary">
              {ALERT_SOURCE_LABELS[alert.source]}
            </span>
            {alert.source === 'robot' && alert.sourceId && (
              <RobotRef sourceId={alert.sourceId} robotName={robotName} />
            )}
            <span className="text-xs text-theme-tertiary">
              {formatTimestamp(alert.timestamp)}
            </span>
          </div>
          <h4 className="font-medium text-theme-primary text-sm break-words">{title}</h4>
          <p className="text-sm text-theme-secondary mt-0.5 break-words">{message}</p>
          {findingPath && (
            <Link
              to={findingPath}
              className="inline-flex items-center gap-1 mt-1 text-xs text-cobalt-500 hover:underline"
              data-testid="alert-open-finding"
            >
              {linkLabel}
            </Link>
          )}
          {alert.acknowledged && alert.acknowledgedAt && (
            <p className="text-xs text-theme-tertiary mt-1">
              Acknowledged {formatTimestamp(alert.acknowledgedAt)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 self-end sm:self-start">
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
  maxHeight,
  showAcknowledged = true,
  className,
}: AlertListProps) {
  const { alerts, unacknowledgedAlerts, acknowledgeAlert, removeAlert, clearAcknowledged } =
    useAlerts();
  // Resolve robot names for alert robot chips; alerts referencing deleted
  // robots degrade to plain text (see RobotRef).
  const robots = useRobotsStore(selectRobots);

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
        className={cn('space-y-2', maxHeight && 'overflow-y-auto')}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {displayAlerts.map((alert) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            robotName={
              alert.source === 'robot' && alert.sourceId
                ? robots.find((r) => r.id === alert.sourceId)?.name
                : undefined
            }
            onAcknowledge={handleAcknowledge}
            onDismiss={handleDismiss}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * @file IncidentCard.tsx
 * @description Card component displaying incident summary
 * @feature incidents
 * @dependencies @/shared/utils/cn, @/features/incidents/types
 */

import { cn } from '@/shared/utils/cn';
import { SeverityBadge } from './SeverityBadge';
import { StatusBadge } from './StatusBadge';
import type { Incident, IncidentSeverity } from '../types/incidents.types';
import { INCIDENT_TYPE_LABELS } from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface IncidentCardProps {
  /** Incident data */
  incident: Incident;
  /** Click handler */
  onClick?: (incident: Incident) => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const SEVERITY_BORDER_STYLES: Record<IncidentSeverity, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-red-400',
  medium: 'border-l-yellow-400',
  low: 'border-l-blue-400',
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

function getOverdueNotificationCount(incident: Incident): number {
  if (!incident.notifications) return 0;
  return incident.notifications.filter((n) => n.isOverdue).length;
}

function getPendingNotificationCount(incident: Incident): number {
  if (!incident.notifications) return 0;
  return incident.notifications.filter((n) => n.status === 'pending' || n.status === 'draft').length;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays an incident card with summary information.
 *
 * @example
 * ```tsx
 * <IncidentCard
 *   incident={incident}
 *   onClick={(i) => navigate(`/incidents/${i.id}`)}
 * />
 * ```
 */
export function IncidentCard({ incident, onClick, className }: IncidentCardProps) {
  const overdueCount = getOverdueNotificationCount(incident);
  const pendingCount = getPendingNotificationCount(incident);

  return (
    <div
      className={cn(
        'p-4 bg-theme-elevated rounded-lg border-l-4 transition-all',
        SEVERITY_BORDER_STYLES[incident.severity],
        onClick && 'cursor-pointer hover:bg-theme-hover',
        className
      )}
      onClick={() => onClick?.(incident)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(incident) : undefined}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Badges Row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <SeverityBadge severity={incident.severity} size="sm" />
            <StatusBadge status={incident.status} size="sm" />
            <span className="text-xs text-theme-tertiary">
              {INCIDENT_TYPE_LABELS[incident.type]}
            </span>
          </div>

          {/* Incident Number & Title */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-theme-tertiary">
              {incident.incidentNumber}
            </span>
          </div>
          <h4 className="font-medium text-theme-primary text-sm line-clamp-2">
            {incident.title}
          </h4>

          {/* Description */}
          <p className="text-sm text-theme-secondary mt-1 line-clamp-2">
            {incident.description}
          </p>
        </div>

        {/* Timestamp */}
        <span className="text-xs text-theme-tertiary whitespace-nowrap">
          {formatTimestamp(incident.detectedAt)}
        </span>
      </div>

      {/* Footer with notification status */}
      {(overdueCount > 0 || pendingCount > 0) && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-theme-base">
          {overdueCount > 0 && (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {overdueCount} overdue notification{overdueCount !== 1 ? 's' : ''}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-xs text-theme-secondary flex items-center gap-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {pendingCount} pending
            </span>
          )}
        </div>
      )}

      {/* Risk Score (if assessed) */}
      {incident.riskScore !== null && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-theme-tertiary">Risk Score:</span>
          <span
            className={cn(
              'text-xs font-medium',
              incident.riskScore >= 75 ? 'text-red-500' :
              incident.riskScore >= 50 ? 'text-yellow-500' :
              incident.riskScore >= 25 ? 'text-blue-500' :
              'text-green-500'
            )}
          >
            {incident.riskScore}/100
          </span>
        </div>
      )}
    </div>
  );
}

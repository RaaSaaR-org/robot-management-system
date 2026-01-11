/**
 * @file OversightTimeline.tsx
 * @description Timeline of oversight actions for audit trail
 * @feature oversight
 */

import {
  Hand,
  Power,
  RefreshCw,
  XCircle,
  CheckCircle,
  Eye,
  Wrench,
  AlertTriangle,
  StopCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Badge } from '@/shared/components/ui/Badge';
import type { OversightLog, OversightActionType } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface OversightTimelineProps {
  logs: OversightLog[];
  isLoading?: boolean;
  maxItems?: number;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ACTION_CONFIG: Record<
  OversightActionType,
  { icon: typeof Hand; label: string; variant: 'default' | 'success' | 'warning' | 'error' }
> = {
  manual_mode_activated: {
    icon: Hand,
    label: 'Manual Mode Activated',
    variant: 'warning',
  },
  manual_mode_deactivated: {
    icon: Power,
    label: 'Manual Mode Deactivated',
    variant: 'default',
  },
  task_reassigned: {
    icon: RefreshCw,
    label: 'Task Reassigned',
    variant: 'default',
  },
  task_cancelled: {
    icon: XCircle,
    label: 'Task Cancelled',
    variant: 'warning',
  },
  verification_completed: {
    icon: CheckCircle,
    label: 'Verification Completed',
    variant: 'success',
  },
  anomaly_acknowledged: {
    icon: Eye,
    label: 'Anomaly Acknowledged',
    variant: 'default',
  },
  anomaly_resolved: {
    icon: Wrench,
    label: 'Anomaly Resolved',
    variant: 'success',
  },
  decision_overridden: {
    icon: AlertTriangle,
    label: 'Decision Overridden',
    variant: 'warning',
  },
  robot_stopped: {
    icon: StopCircle,
    label: 'Robot Stopped',
    variant: 'error',
  },
  fleet_stopped: {
    icon: StopCircle,
    label: 'Fleet Stopped',
    variant: 'error',
  },
};

// ============================================================================
// HELPERS
// ============================================================================

function formatTimestamp(timestamp: string): { date: string; time: string } {
  const d = new Date(timestamp);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
  };
}

// ============================================================================
// SUB-COMPONENT
// ============================================================================

interface TimelineItemProps {
  log: OversightLog;
  isLast: boolean;
}

function TimelineItem({ log, isLast }: TimelineItemProps) {
  const config = ACTION_CONFIG[log.actionType] || {
    icon: Clock,
    label: log.actionType,
    variant: 'default' as const,
  };
  const Icon = config.icon;
  const { date, time } = formatTimestamp(log.timestamp);

  return (
    <div className="relative flex gap-4">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-theme-subtle" />
      )}

      {/* Icon */}
      <div
        className={cn(
          'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 bg-theme-bg',
          config.variant === 'success'
            ? 'border-green-500 text-green-500'
            : config.variant === 'warning'
              ? 'border-yellow-500 text-yellow-500'
              : config.variant === 'error'
                ? 'border-red-500 text-red-500'
                : 'border-theme-subtle text-theme-muted'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-theme-primary">{config.label}</span>
              {log.robotName && <Badge variant="default">{log.robotName}</Badge>}
            </div>
            <p className="text-sm text-theme-secondary mt-1">{log.reason}</p>
            {log.operatorName && (
              <p className="text-xs text-theme-muted mt-1">
                by {log.operatorName}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-theme-muted flex-shrink-0">
            <div>{date}</div>
            <div>{time}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function OversightTimeline({
  logs,
  isLoading,
  maxItems = 10,
  className,
}: OversightTimelineProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="h-8 w-8 rounded-full bg-theme-elevated animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 bg-theme-elevated rounded animate-pulse" />
              <div className="h-3 w-48 bg-theme-elevated rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Clock className="h-12 w-12 text-theme-muted mx-auto mb-3" />
        <p className="text-theme-secondary">No oversight actions recorded</p>
        <p className="text-sm text-theme-muted">
          Actions will appear here as operators interact with the system
        </p>
      </div>
    );
  }

  const displayLogs = logs.slice(0, maxItems);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-theme-muted" />
          <h3 className="font-semibold text-theme-primary">Recent Activity</h3>
        </div>
        <span className="text-sm text-theme-muted">
          {logs.length} action{logs.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="relative">
        {displayLogs.map((log, index) => (
          <TimelineItem
            key={log.id}
            log={log}
            isLast={index === displayLogs.length - 1}
          />
        ))}
      </div>

      {logs.length > maxItems && (
        <p className="text-sm text-theme-muted text-center">
          + {logs.length - maxItems} more actions
        </p>
      )}
    </div>
  );
}

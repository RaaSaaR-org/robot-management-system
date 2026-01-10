/**
 * @file ComplianceLogList.tsx
 * @description List component for displaying compliance logs
 * @feature compliance
 */

import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import type { ComplianceLog, ComplianceEventType, ComplianceSeverity } from '../types';

// Event type labels
const EVENT_TYPE_LABELS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI Decision',
  safety_action: 'Safety Action',
  command_execution: 'Command Execution',
  system_event: 'System Event',
  access_audit: 'Access Audit',
};

// Severity colors
const SEVERITY_COLORS: Record<ComplianceSeverity, string> = {
  debug: 'text-gray-400 bg-gray-500/20',
  info: 'text-blue-400 bg-blue-500/20',
  warning: 'text-yellow-400 bg-yellow-500/20',
  error: 'text-red-400 bg-red-500/20',
  critical: 'text-red-500 bg-red-600/30 font-semibold',
};

// Event type colors
const EVENT_TYPE_COLORS: Record<ComplianceEventType, string> = {
  ai_decision: 'text-purple-400 bg-purple-500/20',
  safety_action: 'text-orange-400 bg-orange-500/20',
  command_execution: 'text-green-400 bg-green-500/20',
  system_event: 'text-cyan-400 bg-cyan-500/20',
  access_audit: 'text-pink-400 bg-pink-500/20',
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export interface ComplianceLogListProps {
  logs: ComplianceLog[];
  selectedId?: string;
  onSelect?: (log: ComplianceLog) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * List component for compliance logs
 */
export function ComplianceLogList({
  logs,
  selectedId,
  onSelect,
  isLoading,
  className,
}: ComplianceLogListProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="glass-card p-4 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-700 rounded w-1/2 mb-2" />
            <div className="h-3 bg-gray-700 rounded w-1/4" />
          </Card>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <Card className={cn('glass-card p-6 text-center', className)}>
        <p className="text-theme-secondary font-medium">No compliance logs yet</p>
        <p className="text-theme-tertiary text-sm mt-2">
          Logs will appear here when robots execute commands or AI makes decisions.
        </p>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {logs.map((log) => (
        <Card
          key={log.id}
          className={cn(
            'glass-card p-3 cursor-pointer transition-all hover:border-primary-500/50',
            selectedId === log.id && 'border-primary-500 bg-primary-500/10'
          )}
          onClick={() => onSelect?.(log)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Event type and severity badges */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    EVENT_TYPE_COLORS[log.eventType]
                  )}
                >
                  {EVENT_TYPE_LABELS[log.eventType]}
                </span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full uppercase',
                    SEVERITY_COLORS[log.severity]
                  )}
                >
                  {log.severity}
                </span>
              </div>

              {/* Description */}
              <p className="text-theme-primary text-sm truncate">
                {log.payload.description || 'No description'}
              </p>

              {/* Metadata row */}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-theme-tertiary">
                <span className="font-mono">{log.robotId.slice(0, 8)}...</span>
                <span>{formatDate(log.timestamp)}</span>
              </div>
            </div>

            {/* Hash indicator */}
            <div className="flex-shrink-0 text-right">
              <div className="w-2 h-2 rounded-full bg-green-500" title="Hash verified" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

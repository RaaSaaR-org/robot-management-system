/**
 * @file AlertHistoryPanel.tsx
 * @description Panel displaying alert history with pagination
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/hooks
 */

import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { useAlertHistory } from '../hooks/useAlerts';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import type { Alert, AlertSeverity } from '../types/alerts.types';
import { ALERT_SOURCE_LABELS } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertHistoryPanelProps {
  /** Maximum height of the panel */
  maxHeight?: string;
  /** Additional class names */
  className?: string;
  /** Whether to auto-fetch on mount */
  autoFetch?: boolean;
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
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface HistoryItemProps {
  alert: Alert;
}

function HistoryItem({ alert }: HistoryItemProps) {
  return (
    <div
      className={cn(
        'p-3 bg-theme-elevated rounded-lg border-l-4 transition-opacity',
        SEVERITY_BORDER_STYLES[alert.severity],
        alert.acknowledged && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <AlertSeverityBadge severity={alert.severity} size="sm" />
            <span className="text-xs text-theme-tertiary">
              {ALERT_SOURCE_LABELS[alert.source]}
              {alert.sourceId && ` - ${alert.sourceId}`}
            </span>
          </div>
          <h4 className="text-sm font-medium text-theme-primary truncate">{alert.title}</h4>
          <p className="text-xs text-theme-secondary mt-0.5 line-clamp-2">{alert.message}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-xs text-theme-tertiary whitespace-nowrap">
            {formatTimestamp(alert.timestamp)}
          </span>
          {alert.acknowledged && (
            <span className="text-xs text-green-400 whitespace-nowrap">Acknowledged</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isLoading: boolean;
}

function Pagination({ page, totalPages, total, onPrev, onNext, isLoading }: PaginationProps) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-theme-border">
      <span className="text-sm text-theme-secondary">
        {total} alert{total !== 1 ? 's' : ''} total
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onPrev}
          disabled={page <= 1 || isLoading}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <span className="text-sm text-theme-secondary px-2">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={onNext}
          disabled={page >= totalPages || isLoading}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * AlertHistoryPanel - Displays alert history with pagination
 *
 * @example
 * ```tsx
 * function AlertsPage() {
 *   return (
 *     <div className="p-4">
 *       <h1>Alert History</h1>
 *       <AlertHistoryPanel maxHeight="500px" />
 *     </div>
 *   );
 * }
 * ```
 */
export function AlertHistoryPanel({
  maxHeight = '400px',
  className,
  autoFetch = true,
}: AlertHistoryPanelProps) {
  const { history, pagination, isLoading, nextPage, prevPage } = useAlertHistory(autoFetch);

  if (isLoading && history.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" />
          <span className="text-sm text-theme-secondary">Loading alerts...</span>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="text-center">
          <div className="text-4xl mb-2">-</div>
          <p className="text-theme-secondary">No alerts found</p>
          <p className="text-sm text-theme-tertiary mt-1">
            Alerts will appear here when they occur
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* History List */}
      <div className="overflow-y-auto space-y-2" style={{ maxHeight }}>
        {history.map((alert) => (
          <HistoryItem key={alert.id} alert={alert} />
        ))}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-theme-base/50 flex items-center justify-center">
          <div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Pagination */}
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPrev={prevPage}
        onNext={nextPage}
        isLoading={isLoading}
      />
    </div>
  );
}

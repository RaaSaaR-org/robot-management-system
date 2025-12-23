/**
 * @file AlertFilters.tsx
 * @description Filter controls for alert history (severity, source, date range)
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/types
 */

import { useCallback, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import type { AlertSeverity, AlertSource, AlertHistoryFilters } from '../types/alerts.types';
import { ALERT_SEVERITY_LABELS, ALERT_SOURCE_LABELS } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertFiltersProps {
  /** Current filters */
  filters: AlertHistoryFilters;
  /** Callback when filters change */
  onFiltersChange: (filters: AlertHistoryFilters) => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SEVERITIES: AlertSeverity[] = ['critical', 'error', 'warning', 'info'];
const SOURCES: AlertSource[] = ['robot', 'task', 'system', 'user'];

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/50',
  error: 'bg-red-400/20 text-red-300 border-red-400/50',
  warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
};

const SEVERITY_COLORS_ACTIVE: Record<AlertSeverity, string> = {
  critical: 'bg-red-500 text-white border-red-500',
  error: 'bg-red-400 text-white border-red-400',
  warning: 'bg-yellow-500 text-gray-900 border-yellow-500',
  info: 'bg-blue-500 text-white border-blue-500',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * AlertFilters - Filter controls for alert history
 *
 * @example
 * ```tsx
 * function AlertHistoryPage() {
 *   const { filters, setFilters } = useAlertHistory();
 *
 *   return (
 *     <div>
 *       <AlertFilters filters={filters} onFiltersChange={setFilters} />
 *       <AlertHistoryPanel />
 *     </div>
 *   );
 * }
 * ```
 */
export function AlertFilters({ filters, onFiltersChange, className }: AlertFiltersProps) {
  const [startDate, setStartDate] = useState(filters.startDate || '');
  const [endDate, setEndDate] = useState(filters.endDate || '');

  const toggleSeverity = useCallback(
    (severity: AlertSeverity) => {
      const currentSeverities = filters.severity || [];
      const newSeverities = currentSeverities.includes(severity)
        ? currentSeverities.filter((s) => s !== severity)
        : [...currentSeverities, severity];

      onFiltersChange({
        ...filters,
        severity: newSeverities.length > 0 ? newSeverities : undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const toggleSource = useCallback(
    (source: AlertSource) => {
      const currentSources = filters.source || [];
      const newSources = currentSources.includes(source)
        ? currentSources.filter((s) => s !== source)
        : [...currentSources, source];

      onFiltersChange({
        ...filters,
        source: newSources.length > 0 ? newSources : undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const toggleAcknowledged = useCallback(
    (value: boolean | undefined) => {
      onFiltersChange({
        ...filters,
        acknowledged: value,
      });
    },
    [filters, onFiltersChange]
  );

  const applyDateFilter = useCallback(() => {
    onFiltersChange({
      ...filters,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  }, [filters, onFiltersChange, startDate, endDate]);

  const clearFilters = useCallback(() => {
    setStartDate('');
    setEndDate('');
    onFiltersChange({});
  }, [onFiltersChange]);

  const hasFilters =
    (filters.severity && filters.severity.length > 0) ||
    (filters.source && filters.source.length > 0) ||
    filters.acknowledged !== undefined ||
    filters.startDate ||
    filters.endDate;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Severity Filter */}
      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Severity</label>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((severity) => {
            const isActive = filters.severity?.includes(severity);
            return (
              <button
                key={severity}
                onClick={() => toggleSeverity(severity)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
                  isActive ? SEVERITY_COLORS_ACTIVE[severity] : SEVERITY_COLORS[severity],
                  'hover:opacity-80'
                )}
                aria-pressed={isActive}
              >
                {ALERT_SEVERITY_LABELS[severity]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Source Filter */}
      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Source</label>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((source) => {
            const isActive = filters.source?.includes(source);
            return (
              <button
                key={source}
                onClick={() => toggleSource(source)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
                  isActive
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-theme-elevated text-theme-secondary border-theme-border hover:bg-theme-surface'
                )}
                aria-pressed={isActive}
              >
                {ALERT_SOURCE_LABELS[source]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Acknowledged Filter */}
      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Status</label>
        <div className="flex gap-2">
          <button
            onClick={() => toggleAcknowledged(undefined)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
              filters.acknowledged === undefined
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-theme-elevated text-theme-secondary border-theme-border hover:bg-theme-surface'
            )}
            aria-pressed={filters.acknowledged === undefined}
          >
            All
          </button>
          <button
            onClick={() => toggleAcknowledged(false)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
              filters.acknowledged === false
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-theme-elevated text-theme-secondary border-theme-border hover:bg-theme-surface'
            )}
            aria-pressed={filters.acknowledged === false}
          >
            Active
          </button>
          <button
            onClick={() => toggleAcknowledged(true)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
              filters.acknowledged === true
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-theme-elevated text-theme-secondary border-theme-border hover:bg-theme-surface'
            )}
            aria-pressed={filters.acknowledged === true}
          >
            Acknowledged
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Date Range</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-1.5 text-sm bg-theme-elevated border border-theme-border rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="Start date"
          />
          <span className="text-theme-tertiary">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-1.5 text-sm bg-theme-elevated border border-theme-border rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="End date"
          />
          <Button variant="secondary" size="sm" onClick={applyDateFilter}>
            Apply
          </Button>
        </div>
      </div>

      {/* Clear Filters */}
      {hasFilters && (
        <div className="pt-2">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear All Filters
          </Button>
        </div>
      )}
    </div>
  );
}

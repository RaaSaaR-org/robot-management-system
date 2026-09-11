/**
 * @file AlertFilters.tsx
 * @description Alert history filters as kit Selects and date inputs, laid out
 *              for a Toolbar's `filters` slot (severity, source, state, date range)
 * @feature alerts
 */

import { Input, Select } from '@/shared/components/ui';
import type { AlertSeverity, AlertSource, AlertHistoryFilters } from '../types/alerts.types';
import { ALERT_SEVERITY_LABELS, ALERT_SOURCE_LABELS } from '../types/alerts.types';

export interface AlertFiltersProps {
  /** Current filters */
  filters: AlertHistoryFilters;
  /** Callback when filters change */
  onFiltersChange: (filters: AlertHistoryFilters) => void;
}

const SEVERITIES: AlertSeverity[] = ['critical', 'error', 'warning', 'info'];
const SOURCES: AlertSource[] = ['robot', 'task', 'system', 'user'];

const SEVERITY_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: ALERT_SEVERITY_LABELS[s] }));
const SOURCE_OPTIONS = SOURCES.map((s) => ({ value: s, label: ALERT_SOURCE_LABELS[s] }));
const STATE_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
];

/** True when any history filter is set. */
export function hasAlertFilters(filters: AlertHistoryFilters): boolean {
  return Boolean(
    filters.severity?.length ||
      filters.source?.length ||
      filters.acknowledged !== undefined ||
      filters.startDate ||
      filters.endDate
  );
}

/**
 * Filter controls for alert history; render inside `<Toolbar filters={…} />`.
 *
 * @example
 * <Toolbar filters={<AlertFilters filters={filters} onFiltersChange={setFilters} />} />
 */
export function AlertFilters({ filters, onFiltersChange }: AlertFiltersProps) {
  const state = filters.acknowledged === undefined ? '' : filters.acknowledged ? 'acknowledged' : 'open';

  return (
    <>
      <Select
        aria-label="Severity"
        fullWidth={false}
        className="w-40"
        placeholder="All severities"
        options={SEVERITY_OPTIONS}
        value={filters.severity?.[0] ?? ''}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            severity: e.target.value ? [e.target.value as AlertSeverity] : undefined,
          })
        }
      />
      <Select
        aria-label="Source"
        fullWidth={false}
        className="w-36"
        placeholder="All sources"
        options={SOURCE_OPTIONS}
        value={filters.source?.[0] ?? ''}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            source: e.target.value ? [e.target.value as AlertSource] : undefined,
          })
        }
      />
      <Select
        aria-label="State"
        fullWidth={false}
        className="w-40"
        placeholder="Any state"
        options={STATE_OPTIONS}
        value={state}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            acknowledged: e.target.value === '' ? undefined : e.target.value === 'acknowledged',
          })
        }
      />
      <div className="flex items-center gap-2">
        <Input
          type="date"
          aria-label="From date"
          fullWidth={false}
          className="w-40"
          value={filters.startDate ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value || undefined })}
        />
        <span className="text-[13px] text-ink-tertiary">to</span>
        <Input
          type="date"
          aria-label="To date"
          fullWidth={false}
          className="w-40"
          value={filters.endDate ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value || undefined })}
        />
      </div>
    </>
  );
}

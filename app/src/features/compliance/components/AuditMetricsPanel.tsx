/**
 * @file AuditMetricsPanel.tsx
 * @description Metrics view of the audit trail: totals, entries per event
 *              type and entries per severity.
 * @feature compliance
 */

import { useEffect } from 'react';
import { Activity, Bot, FileText, Siren } from 'lucide-react';
import {
  DataTable, EmptyState, ErrorState, Panel, ProgressBar, SkeletonText, StatRow, StatTile, type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { ComplianceSeverity, EventTypeMetrics } from '../types';
import { SEVERITIES, eventTypeLabel, formatDate, formatRelative, humanize } from './complianceFormat';

const SEVERITY_BAR: Record<ComplianceSeverity, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  error: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'default',
};

const EVENT_COLUMNS: DataTableColumn<EventTypeMetrics>[] = [
  { key: 'eventType', header: 'Event type', sortable: true, cell: (m) => eventTypeLabel(m.eventType) },
  { key: 'count', header: 'Entries', align: 'right', sortable: true, cell: (m) => m.count.toLocaleString() },
  { key: 'lastOccurrence', header: 'Last entry', align: 'right', hideBelow: 'sm', sortable: true,
    sortValue: (m) => (m.lastOccurrence ? new Date(m.lastOccurrence) : null),
    cell: (m) => <span className="text-[13px] text-ink-tertiary">{formatRelative(m.lastOccurrence)}</span> },
];

/** Aggregate numbers of the audit trail, from /compliance/metrics. */
export function AuditMetricsPanel() {
  const { metrics, isLoadingMetrics, error, fetchMetrics } = useComplianceStore();

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  if (!metrics) {
    if (error && !isLoadingMetrics) {
      return <Panel><ErrorState title="Couldn't load metrics" message={error} onRetry={() => void fetchMetrics()} /></Panel>;
    }
    return <Panel><SkeletonText lines={4} /></Panel>;
  }

  const range = metrics.dateRange.start
    ? `${formatDate(metrics.dateRange.start)} – ${formatDate(metrics.dateRange.end)}`
    : 'No entries yet';
  const critical = (metrics.severityCounts.critical ?? 0) + (metrics.severityCounts.error ?? 0);
  const total = Math.max(metrics.totalLogs, 1);

  return (
    <div className="flex flex-col gap-4">
      <StatRow columns={4}>
        <StatTile label="Entries" value={metrics.totalLogs.toLocaleString()} icon={<FileText />} hint={range} />
        <StatTile label="Sessions" value={metrics.uniqueSessions.toLocaleString()} icon={<Activity />} hint="Distinct robot sessions" />
        <StatTile label="Robots" value={metrics.uniqueRobots.toLocaleString()} icon={<Bot />} hint="That wrote to the log" />
        <StatTile
          label="Critical and errors"
          value={critical.toLocaleString()}
          icon={<Siren />}
          tone={critical > 0 ? 'stopped' : 'live'}
          hint={`${Math.round((critical / total) * 100)} % of all entries`}
        />
      </StatRow>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel padding="none">
          <Panel.Header title="By event type" />
          <DataTable
            caption="Entries by event type"
            columns={EVENT_COLUMNS}
            rows={metrics.eventTypeCounts}
            getRowId={(m) => m.eventType}
            defaultSort={{ key: 'count', direction: 'desc' }}
            dense
            empty={<EmptyState size="sm" icon={<FileText />} title="No entries yet" />}
          />
        </Panel>
        <Panel>
          <Panel.Header title="By severity" />
          <Panel.Body className="flex flex-col gap-4">
            {SEVERITIES.map((s) => (
              <ProgressBar
                key={s}
                size="sm"
                value={metrics.severityCounts[s] ?? 0}
                max={total}
                variant={SEVERITY_BAR[s]}
                label={`${humanize(s)} · ${(metrics.severityCounts[s] ?? 0).toLocaleString()}`}
              />
            ))}
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}

/**
 * @file ComplianceLogList.tsx
 * @description Audit log table: time, event type, severity, description and
 *              robot of each compliance log, with the four list states.
 * @feature compliance
 */

import { DataTable, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import type { ComplianceLog } from '../types';
import { eventTypeLabel, formatDateTime, humanize, severityTone } from './complianceFormat';

export interface ComplianceLogListProps {
  logs: ComplianceLog[];
  onSelect?: (log: ComplianceLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  className?: string;
}

const COLUMNS: DataTableColumn<ComplianceLog>[] = [
  {
    key: 'timestamp', header: 'Time', sortable: true, sortValue: (l) => new Date(l.timestamp),
    cell: (l) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDateTime(l.timestamp)}</span>,
  },
  { key: 'eventType', header: 'Event', sortable: true, hideBelow: 'sm', cell: (l) => <span className="whitespace-nowrap text-ink-secondary">{eventTypeLabel(l.eventType)}</span> },
  { key: 'severity', header: 'Severity', sortable: true, cell: (l) => <StatusTag tone={severityTone(l.severity)}>{humanize(l.severity)}</StatusTag> },
  {
    key: 'description', header: 'Description', sortValue: (l) => l.payload.description ?? '',
    cell: (l) => (
      <span className="line-clamp-2 min-w-[12rem] text-ink-primary" title={l.payload.description}>
        {l.payload.description || 'No description'}
      </span>
    ),
  },
  {
    key: 'robotId', header: 'Robot', sortable: true, hideBelow: 'md',
    cell: (l) => <span className="whitespace-nowrap font-mono text-[13px] text-ink-secondary" title={l.robotId}>{l.robotId}</span>,
  },
];

/** Server-paginated audit log table (sorting applies to the current page). */
export function ComplianceLogList({ logs, onSelect, isLoading, error, onRetry, empty, className }: ComplianceLogListProps) {
  return (
    <DataTable
      className={className}
      caption="Audit log"
      columns={COLUMNS}
      rows={logs}
      getRowId={(l) => l.id}
      onRowClick={onSelect}
      isLoading={isLoading}
      error={error}
      errorTitle="Couldn't load the audit log"
      onRetry={onRetry}
      empty={empty}
      dense
    />
  );
}

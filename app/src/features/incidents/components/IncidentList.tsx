/**
 * @file IncidentList.tsx
 * @description Incidents as a DataTable (number, title, severity, status, type,
 *              detected) with a server-pagination footer and all four states
 * @feature incidents
 */

import { useMemo, type ReactNode } from 'react';
import { Plus, Search, ShieldCheck } from 'lucide-react';
import { Button, DataTable, EmptyState, type DataTableColumn } from '@/shared/components/ui';
import { formatDateTime, formatTimeAgo } from '@/shared/utils/format';
import { useIncidents } from '../hooks/useIncidents';
import { SeverityBadge } from './SeverityBadge';
import { StatusBadge } from './StatusBadge';
import { PaginationFooter } from './PaginationFooter';
import { humanizeMachineText } from '../utils/humanize';
import type { Incident } from '../types/incidents.types';
import { INCIDENT_TYPE_LABELS, SEVERITY_PRIORITY } from '../types/incidents.types';

export interface IncidentListProps {
  /** Show only incidents that are not closed */
  showOnlyOpen?: boolean;
  /** Free-text filter over number, title and description */
  query?: string;
  /** Whether the host has filters set (for the filtered-empty state) */
  hasFilters?: boolean;
  /** Clears the host's filters */
  onClearFilters?: () => void;
  /** Row click */
  onIncidentClick?: (incident: Incident) => void;
  /** Opens the report modal (empty state action) */
  onReport?: () => void;
  /** Additional class names */
  className?: string;
}

function detected(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  return hours < 24 ? formatTimeAgo(iso) : formatDateTime(iso, { month: 'short', day: 'numeric', year: 'numeric' });
}

const columns: DataTableColumn<Incident>[] = [
  {
    key: 'incidentNumber',
    header: 'Number',
    hideBelow: 'sm',
    sortable: true,
    cell: (i) => <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-tertiary">{i.incidentNumber}</span>,
  },
  {
    key: 'title',
    header: 'Incident',
    cell: (i) => (
      <div className="min-w-0 max-w-[56ch]">
        <div className="break-words text-sm font-medium text-ink-primary">{i.title}</div>
        <p className="line-clamp-1 text-[13px] text-ink-tertiary">{humanizeMachineText(i.description).summary}</p>
      </div>
    ),
  },
  {
    key: 'severity',
    header: 'Severity',
    hideBelow: 'sm',
    sortable: true,
    sortValue: (i) => SEVERITY_PRIORITY[i.severity],
    cell: (i) => <SeverityBadge severity={i.severity} />,
  },
  { key: 'status', header: 'Status', sortable: true, cell: (i) => <StatusBadge status={i.status} /> },
  {
    key: 'type',
    header: 'Type',
    hideBelow: 'md',
    cell: (i) => <span className="text-[13px] text-ink-secondary">{INCIDENT_TYPE_LABELS[i.type]}</span>,
  },
  {
    key: 'detectedAt',
    header: 'Detected',
    align: 'right',
    hideBelow: 'md',
    sortable: true,
    sortValue: (i) => new Date(i.detectedAt),
    cell: (i) => <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-tertiary">{detected(i.detectedAt)}</span>,
  },
];

/**
 * Incident table; the host owns the toolbar. Put it in `<Panel padding="none">`.
 */
export function IncidentList({
  showOnlyOpen = false,
  query = '',
  hasFilters = false,
  onClearFilters,
  onIncidentClick,
  onReport,
  className,
}: IncidentListProps) {
  const { incidents, isLoading, error, pagination, nextPage, prevPage, fetchIncidents } = useIncidents(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter(
      (i) =>
        (!showOnlyOpen || i.status !== 'closed') &&
        (!q || [i.incidentNumber, i.title, i.description].some((s) => s.toLowerCase().includes(q)))
    );
  }, [incidents, showOnlyOpen, query]);

  const filtered = hasFilters || Boolean(query.trim());
  let empty: ReactNode;
  if (filtered) {
    empty = (
      <EmptyState
        icon={<Search />}
        title="No incidents match"
        description="Try another search, or clear the filters."
        action={onClearFilters && <Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
      />
    );
  } else {
    empty = (
      <EmptyState
        icon={<ShieldCheck />}
        title={showOnlyOpen ? 'No open incidents' : 'No incidents yet'}
        description="Incidents are opened automatically from safety events, or reported by hand."
        action={
          onReport && (
            <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={onReport}>
              Report incident
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className={className}>
      <DataTable
        caption="Incidents"
        columns={columns}
        rows={rows}
        getRowId={(i) => i.id}
        defaultSort={{ key: 'detectedAt', direction: 'desc' }}
        onRowClick={onIncidentClick}
        isLoading={isLoading}
        error={incidents.length === 0 ? error : null}
        errorTitle="Couldn't load incidents"
        onRetry={() => void fetchIncidents(1)}
        empty={empty}
      />
      {pagination.totalPages > 1 && (
        <PaginationFooter
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="incident"
          onPrev={prevPage}
          onNext={nextPage}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

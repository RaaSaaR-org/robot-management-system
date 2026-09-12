/**
 * @file RequestTable.tsx
 * @description GDPR data-subject requests as a kit DataTable
 * @feature gdpr
 */

import { FileText, Plus, Search } from 'lucide-react';
import { Button, DataTable, EmptyState, Panel, type DataTableColumn } from '@/shared/components/ui';
import { formatDate, getDaysUntilDeadline, type GDPRRequest } from '../types';
import { StatusBadge } from './StatusBadge';
import { SLABadge } from './SLABadge';
import { RIGHTS } from './RequestTypeCard';

export interface RequestTableProps {
  rows: GDPRRequest[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (request: GDPRRequest) => void;
  onCreate: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
}

const CLOSED = ['completed', 'cancelled', 'rejected'];

const COLUMNS: DataTableColumn<GDPRRequest>[] = [
  {
    key: 'submittedAt',
    header: 'Submitted',
    sortable: true,
    sortValue: (r) => new Date(r.submittedAt),
    cell: (r) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(r.submittedAt)}</span>,
  },
  {
    key: 'requestType',
    header: 'Type',
    sortable: true,
    sortValue: (r) => RIGHTS[r.requestType]?.label ?? r.requestType,
    cell: (r) => <span className="text-sm text-ink-primary">{RIGHTS[r.requestType]?.label ?? r.requestType}</span>,
  },
  { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'sla',
    header: 'SLA',
    sortable: true,
    sortValue: (r) => (CLOSED.includes(r.status) ? null : getDaysUntilDeadline(r)),
    cell: (r) => <SLABadge request={r} />,
  },
  {
    key: 'id',
    header: 'Reference',
    hideBelow: 'md',
    cell: (r) => <span className="font-mono text-[13px] text-ink-secondary" title={r.id}>{r.id}</span>,
  },
];

export function RequestTable({ rows, isLoading, error, onRetry, onOpen, onCreate, hasFilters, onClearFilters }: RequestTableProps) {
  return (
    <Panel padding="none">
      <DataTable
        caption="Privacy requests"
        columns={COLUMNS}
        rows={rows}
        getRowId={(r) => r.id}
        defaultSort={{ key: 'submittedAt', direction: 'desc' }}
        onRowClick={onOpen}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load privacy requests"
        onRetry={onRetry}
        empty={
          hasFilters ? (
            <EmptyState
              icon={<Search />}
              title="No requests match"
              description="Try another status or type, or clear the filters."
              action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={<FileText />}
              title="No privacy requests yet"
              description="Exercise a GDPR right (access, erasure, portability …) and track its deadline here."
              action={<Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={onCreate}>New request</Button>}
            />
          )
        }
      />
    </Panel>
  );
}

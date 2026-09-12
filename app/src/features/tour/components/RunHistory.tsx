/**
 * @file RunHistory.tsx
 * @description Guide visit history as a DataTable: started, tour, robot, who
 *              started it, status (with the reason), questions (the declined
 *              ones called out) and duration. Search by tour and a status filter
 *              sit above it. Row click opens the visit. Reused on the tour
 *              editor with `hideRoute`. Mirrors the patrol run table.
 * @feature tour
 */

import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search } from 'lucide-react';
import { Button, DataTable, EmptyState, Panel, SearchInput, Select, StatusTag, Toolbar, type DataTableColumn } from '@/shared/components/ui';
import {
  RunStatusTag,
  describeRunReason,
  formatDuration,
  formatStarted,
  runDurationMs,
  runStatusLabel,
} from '@/features/patrol/components/opsUi';
import type { TourRun } from '../types/tour.types';
import { TourRunStatuses } from '../types/tour.types';
import { declinedTurns } from '../utils/tourFormat';

export interface RunHistoryProps {
  runs: TourRun[];
  robotNames: Record<string, string>;
  /** Scoped to one tour: hide the Tour column and the toolbar. */
  hideRoute?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const STATUS_OPTIONS = TourRunStatuses.map((value) => ({ value, label: runStatusLabel(value) }));

export const RunHistory = memo(function RunHistory({ runs, robotNames, hideRoute, isLoading, error, onRetry }: RunHistoryProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => (!status || r.status === status) && (!q || r.routeName.toLowerCase().includes(q)));
  }, [runs, query, status]);
  const hasFilters = Boolean(query || status);

  const columns: DataTableColumn<TourRun>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      sortable: true,
      sortValue: (r) => new Date(r.startedAt),
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums" data-testid="tour-run-row" data-run-id={r.runId} data-status={r.status}>
          {formatStarted(r.startedAt)}
        </span>
      ),
    },
    ...(hideRoute
      ? []
      : [{ key: 'routeName', header: 'Tour', sortable: true, hideBelow: 'sm', cell: (r: TourRun) => r.routeName } as DataTableColumn<TourRun>]),
    { key: 'robot', header: 'Robot', hideBelow: 'md', cell: (r) => robotNames[r.robotId] ?? r.robotId },
    { key: 'origin', header: 'Started by', hideBelow: 'md', cell: (r) => `${r.origin} · ${r.language}` },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.status,
      cell: (r) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <RunStatusTag status={r.status} />
          {/* A tour ended early is still `done`; the reason is the only place that says so. */}
          {r.reason && (
            <span className="max-w-[16rem] truncate text-xs text-ink-tertiary" title={r.reason}>
              {describeRunReason(r.reason)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'questions',
      header: 'Questions',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      sortValue: (r) => r.turns.length,
      cell: (r) => {
        const declined = declinedTurns(r).length;
        if (r.turns.length === 0) return <span className="text-ink-muted">0</span>;
        return (
          <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
            <span>{r.turns.length}</span>
            {declined > 0 && (
              <StatusTag tone="warning" title={`${declined} question(s) the facts did not cover`}>
                {declined} declined
              </StatusTag>
            )}
          </span>
        );
      },
    },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      hideBelow: 'lg',
      sortable: true,
      sortValue: (r) => runDurationMs(r.startedAt, r.finishedAt),
      cell: (r) => (r.finishedAt ? formatDuration(runDurationMs(r.startedAt, r.finishedAt)) : null),
    },
  ];

  const table = (
    <Panel padding="none">
      <DataTable
        caption="Guide visits"
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.runId}
        defaultSort={{ key: 'startedAt', direction: 'desc' }}
        onRowClick={(r) => navigate(`/tour/runs/${encodeURIComponent(r.runId)}`)}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load visits"
        onRetry={onRetry}
        empty={
          hasFilters ? (
            <EmptyState
              icon={<Search />}
              title="No visits match"
              description="Try another tour name, or clear the filters."
              action={
                <Button variant="secondary" onClick={() => { setQuery(''); setStatus(''); }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<History />} title="No visits yet" description="Visits show up here as the robot reports them — including the offers a visitor declined." />
          )
        }
      />
    </Panel>
  );

  if (hideRoute) return <div data-testid="tour-run-history">{table}</div>;
  return (
    <div className="flex flex-col gap-4" data-testid="tour-run-history">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search by tour" />}
        filters={
          <Select
            aria-label="Visit status"
            fullWidth={false}
            className="w-40"
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        }
      />
      {table}
    </div>
  );
});

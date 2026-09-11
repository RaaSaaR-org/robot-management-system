/**
 * @file RunHistory.tsx
 * @description Patrol run history as a DataTable: started, route, robot, mode,
 *              status (with the refusal reason), findings and duration. Search
 *              by route and a status filter sit above it. Row click opens the
 *              run. Reused on the route editor with `hideRoute`.
 * @feature patrol
 */

import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  SearchInput,
  Select,
  StatusTag,
  Toolbar,
  type DataTableColumn,
} from '@/shared/components/ui';
import type { PatrolRun } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS, PATROL_RUN_STATUS_LABELS } from '../types/patrol.types';
import { RunStatusTag, describeRunReason, formatDuration, formatStarted, runDurationMs } from './opsUi';

export interface RunHistoryProps {
  runs: PatrolRun[];
  robotNames: Record<string, string>;
  /** Scoped to one route: hide the Route column and the toolbar. */
  hideRoute?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const STATUS_OPTIONS = Object.entries(PATROL_RUN_STATUS_LABELS).map(([value, label]) => ({ value, label }));

function showReason(run: PatrolRun): boolean {
  return Boolean(run.reason) && (run.status === 'skipped' || run.status === 'aborted' || run.status === 'failed');
}

export const RunHistory = memo(function RunHistory({ runs, robotNames, hideRoute, isLoading, error, onRetry }: RunHistoryProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => (!status || r.status === status) && (!q || r.routeName.toLowerCase().includes(q)));
  }, [runs, query, status]);
  const hasFilters = Boolean(query || status);

  const columns: DataTableColumn<PatrolRun>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      sortable: true,
      sortValue: (r) => new Date(r.startedAt),
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums" data-testid="patrol-run-row" data-run-id={r.runId} data-status={r.status}>
          {formatStarted(r.startedAt)}
        </span>
      ),
    },
    ...(hideRoute
      ? []
      : [{ key: 'routeName', header: 'Route', sortable: true, hideBelow: 'sm', cell: (r: PatrolRun) => r.routeName } as DataTableColumn<PatrolRun>]),
    {
      key: 'robot',
      header: 'Robot',
      hideBelow: 'md',
      cell: (r) => robotNames[r.robotId] ?? r.robotId,
    },
    {
      key: 'mode',
      header: 'Mode',
      hideBelow: 'md',
      cell: (r) => `${PATROL_RUN_MODE_LABELS[r.mode]} · ${r.origin}`,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.status,
      cell: (r) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <RunStatusTag status={r.status} />
          {showReason(r) && (
            <span className="max-w-[16rem] truncate text-xs text-ink-tertiary" title={r.reason ?? undefined}>
              {describeRunReason(r.reason)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'findingCount',
      header: 'Findings',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      cell: (r) =>
        r.findingCount > 0 ? (
          <StatusTag tone="warning">{r.findingCount}</StatusTag>
        ) : (
          <span className="text-ink-muted">0</span>
        ),
    },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (r) => runDurationMs(r.startedAt, r.finishedAt),
      sortable: true,
      cell: (r) => (r.finishedAt ? formatDuration(runDurationMs(r.startedAt, r.finishedAt)) : null),
    },
  ];

  const table = (
    <Panel padding="none">
      <DataTable
        caption="Patrol runs"
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.runId}
        defaultSort={{ key: 'startedAt', direction: 'desc' }}
        onRowClick={(r) => navigate(`/patrol/runs/${encodeURIComponent(r.runId)}`)}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load runs"
        onRetry={onRetry}
        empty={
          hasFilters ? (
            <EmptyState
              icon={<Search />}
              title="No runs match"
              description="Try another route name, or clear the filters."
              action={
                <Button variant="secondary" onClick={() => { setQuery(''); setStatus(''); }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<History />} title="No runs yet" description="Runs show up here as the robot reports them." />
          )
        }
      />
    </Panel>
  );

  if (hideRoute) return <div data-testid="patrol-run-history">{table}</div>;
  return (
    <div className="flex flex-col gap-4" data-testid="patrol-run-history">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search by route" />}
        filters={
          <Select
            aria-label="Run status"
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

/**
 * @file RouteList.tsx
 * @description The Routes tab of /patrol: search + status filter, and the
 *              routes as a DataTable (name with checkpoint count, robot,
 *              schedule, last run, Armed/Off). Row click opens the editor; the
 *              row menu starts, aborts, exports and deletes.
 * @feature patrol
 */

import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Pencil, Play, Plus, Route as RouteIcon, Search, ShieldCheck, Square, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  Panel,
  SearchInput,
  Select,
  Toolbar,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { PatrolRoute, PatrolRun, PatrolRunMode } from '../types/patrol.types';
import { isRunActive } from '../utils/patrolFormat';
import { describeCron } from '../utils/cronText';
import { ArmedTag, RunStatusTag, formatRelative } from './opsUi';

export interface RouteListProps {
  routes: PatrolRoute[];
  /** Last run per route id (newest), for the "Last run" column. */
  lastRunByRoute: Record<string, PatrolRun | undefined>;
  /** Robot id → display name. */
  robotNames: Record<string, string>;
  isLoading?: boolean;
  /** Load error shown only when there is nothing to show. */
  error?: string | null;
  onRetry?: () => void;
  onStart: (route: PatrolRoute, mode: PatrolRunMode) => void;
  onAbort: (route: PatrolRoute) => void;
  onExport: (route: PatrolRoute) => void;
  onDelete: (route: PatrolRoute) => void;
}

const STATUS_OPTIONS = [
  { value: 'armed', label: 'Armed' },
  { value: 'off', label: 'Off' },
];

export const RouteList = memo(function RouteList({
  routes,
  lastRunByRoute,
  robotNames,
  isLoading,
  error,
  onRetry,
  onStart,
  onAbort,
  onExport,
  onDelete,
}: RouteListProps) {
  const { can } = useAuth();
  const canWrite = can('tasks:write');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes.filter(
      (r) =>
        (!status || (status === 'armed') === r.enabled) &&
        (!q || r.name.toLowerCase().includes(q) || (r.robotId && (robotNames[r.robotId] ?? '').toLowerCase().includes(q))),
    );
  }, [routes, query, status, robotNames]);

  const hasFilters = Boolean(query || status);
  const clear = () => {
    setQuery('');
    setStatus('');
  };

  const columns: DataTableColumn<PatrolRoute>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col" data-testid="patrol-route-row" data-route-id={r.id}>
          <span className="truncate">{r.name}</span>
          <span className="text-xs font-normal text-ink-tertiary">
            {r.checkpoints.length} checkpoint{r.checkpoints.length === 1 ? '' : 's'}
          </span>
        </span>
      ),
    },
    {
      key: 'robot',
      header: 'Robot',
      sortable: true,
      hideBelow: 'sm',
      sortValue: (r) => (r.robotId ? (robotNames[r.robotId] ?? r.robotId) : ''),
      cell: (r) => (r.robotId ? (robotNames[r.robotId] ?? r.robotId) : <span className="text-ink-tertiary">Any robot</span>),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      hideBelow: 'md',
      cell: (r) =>
        r.cronExpression ? (
          <span title={r.cronExpression}>{describeCron(r.cronExpression) ?? r.cronExpression}</span>
        ) : (
          <span className="text-ink-tertiary">Manual</span>
        ),
    },
    {
      key: 'lastRun',
      header: 'Last run',
      hideBelow: 'sm',
      sortable: true,
      sortValue: (r) => (lastRunByRoute[r.id] ? new Date(lastRunByRoute[r.id]!.startedAt) : null),
      cell: (r) => {
        const last = lastRunByRoute[r.id];
        if (!last) return <span className="text-ink-tertiary">Never</span>;
        return (
          <span className="flex flex-wrap items-center gap-2">
            <RunStatusTag status={last.status} />
            <span className="tabular-nums text-ink-tertiary">{formatRelative(last.startedAt)}</span>
          </span>
        );
      },
    },
    {
      key: 'enabled',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.enabled,
      cell: (r) => <ArmedTag enabled={r.enabled} />,
    },
  ];

  // Writes need a member role or above; reading a route and exporting it do
  // not, so Edit (the editor is read-only for a viewer) and Export stay.
  const rowActions = (r: PatrolRoute): RowActionItem[] => {
    const live = isRunActive(lastRunByRoute[r.id]);
    const noCheckpoints = r.checkpoints.length === 0;
    const items: RowActionItem[] = live
      ? [{ label: 'Abort run', icon: <Square />, disabled: !canWrite, onSelect: () => onAbort(r) }]
      : [
          { label: 'Start run', icon: <Play />, disabled: !canWrite || noCheckpoints, onSelect: () => onStart(r, 'patrol') },
          { label: 'Baseline run', icon: <ShieldCheck />, disabled: !canWrite || noCheckpoints, onSelect: () => onStart(r, 'baseline') },
        ];
    items.push(
      { label: 'Edit', icon: <Pencil />, onSelect: () => navigate(`/patrol/routes/${encodeURIComponent(r.id)}`) },
      { label: 'Export VDA5050', icon: <Download />, onSelect: () => onExport(r) },
      { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, disabled: !canWrite, onSelect: () => onDelete(r) },
    );
    return items;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="patrol-route-list">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search routes" />}
        filters={
          <Select
            aria-label="Status"
            fullWidth={false}
            className="w-40"
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        }
      />
      <Panel padding="none">
        <DataTable
          caption="Patrol routes"
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          defaultSort={{ key: 'name', direction: 'asc' }}
          onRowClick={(r) => navigate(`/patrol/routes/${encodeURIComponent(r.id)}`)}
          rowActions={rowActions}
          rowActionsLabel={(r) => `Actions for ${r.name}`}
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load routes"
          onRetry={onRetry}
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />}
                title="No routes match"
                description="Try another name, or clear the filters."
                action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<RouteIcon />}
                title="No routes yet"
                description="A route is the ordered list of places a robot walks, with a schedule and a baseline of what is normal."
                action={
                  canWrite ? (
                    <LinkButton to="/patrol/routes/new" leftIcon={<Plus className="h-4 w-4" />} data-testid="patrol-new-route-empty">
                      New route
                    </LinkButton>
                  ) : undefined
                }
              />
            )
          }
        />
      </Panel>
    </div>
  );
});

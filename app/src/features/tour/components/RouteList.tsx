/**
 * @file RouteList.tsx
 * @description The Tours tab of /tour: search + status filter, and the tours
 *              as a DataTable (name with stops, duration and greet-on-sight,
 *              robot, language, last visit, Armed/Off). Row click opens the
 *              editor; the row menu starts, ends and deletes. Mirrors the
 *              patrol route table.
 * @feature tour
 */

import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Play, Plus, Route as RouteIcon, Search, Square, Trash2 } from 'lucide-react';
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
import { ArmedTag, RunStatusTag, formatRelative } from '@/features/patrol/components/opsUi';
import type { TourRoute, TourRun } from '../types/tour.types';
import { estimateTourSeconds, formatEstimate, isRunActive } from '../utils/tourFormat';

export interface RouteListProps {
  routes: TourRoute[];
  /** Last run per route id (newest), for the "Last visit" column. */
  lastRunByRoute: Record<string, TourRun | undefined>;
  /** Robot id → display name. */
  robotNames: Record<string, string>;
  isLoading?: boolean;
  /** Load error shown only when there is nothing to show. */
  error?: string | null;
  onRetry?: () => void;
  onStart: (route: TourRoute) => void;
  onAbort: (route: TourRoute) => void;
  onDelete: (route: TourRoute) => void;
}

export const LANGUAGE_LABEL: Record<string, string> = { de: 'German', en: 'English' };

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
  onDelete,
}: RouteListProps) {
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

  const columns: DataTableColumn<TourRoute>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col" data-testid="tour-route-row" data-route-id={r.id}>
          <span className="truncate">{r.name}</span>
          <span className="text-xs font-normal text-ink-tertiary">
            <span data-testid="tour-route-stops">
              {r.stops.length} stop{r.stops.length === 1 ? '' : 's'}
            </span>
            {' · '}
            <span data-testid="tour-route-duration">{formatEstimate(estimateTourSeconds(r))}</span>
            {/* The one setting that decides whether the robot talks to a stranger unasked. */}
            {r.autoGreet && (
              <>
                {' · '}
                <span data-testid="tour-route-autogreet">Greets on sight</span>
              </>
            )}
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
      key: 'language',
      header: 'Language',
      hideBelow: 'md',
      sortable: true,
      cell: (r) => LANGUAGE_LABEL[r.language] ?? r.language,
    },
    {
      key: 'lastRun',
      header: 'Last visit',
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

  const rowActions = (r: TourRoute): RowActionItem[] => {
    const live = isRunActive(lastRunByRoute[r.id]);
    return [
      live
        ? { label: 'End tour', icon: <Square />, onSelect: () => onAbort(r) }
        : { label: 'Start tour', icon: <Play />, disabled: r.stops.length === 0, onSelect: () => onStart(r) },
      { label: 'Edit', icon: <Pencil />, onSelect: () => navigate(`/tour/routes/${encodeURIComponent(r.id)}`) },
      { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => onDelete(r) },
    ];
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tour-route-list">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search tours" />}
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
          caption="Guide tours"
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          defaultSort={{ key: 'name', direction: 'asc' }}
          onRowClick={(r) => navigate(`/tour/routes/${encodeURIComponent(r.id)}`)}
          rowActions={rowActions}
          rowActionsLabel={(r) => `Actions for ${r.name}`}
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load tours"
          onRetry={onRetry}
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />}
                title="No tours match"
                description="Try another name, or clear the filters."
                action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<RouteIcon />}
                title="No tours yet"
                description="A tour is the ordered list of places the robot walks a visitor to, with what it says at each one."
                action={
                  <LinkButton to="/tour/routes/new" leftIcon={<Plus className="h-4 w-4" />} data-testid="tour-new-route-empty">
                    New tour
                  </LinkButton>
                }
              />
            )
          }
        />
      </Panel>
    </div>
  );
});

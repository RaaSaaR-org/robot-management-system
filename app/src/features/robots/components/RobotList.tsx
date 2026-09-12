/**
 * @file RobotList.tsx
 * @description The fleet's robot list: toolbar (search, status, view, register), a card
 *   grid or a table, all four list states, pagination and unregister.
 * @feature robots
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Gauge, Plus, Search, Trash2 } from 'lucide-react';
import {
  Button, DataTable, EmptyState, ErrorState, Panel, SearchInput, SegmentedControl, Select,
  SkeletonRows, Toolbar, confirm, errorMessage, toast, type DataTableColumn, type RowActionItem,
} from '@/shared/components/ui';
import { useRobots } from '../hooks/useRobots';
import { useRobotsStore } from '../store/robotsStore';
import { RobotCard, robotBattery, robotLastSeen, robotPlace } from './RobotCard';
import { RobotStatusTag } from './common/RobotStatusTag';
import type { Robot, RobotStatus } from '../types/robots.types';

type ViewMode = 'grid' | 'table';
const VIEW_KEY = 'robots.view';

const STATUS_OPTIONS: { value: RobotStatus; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'busy', label: 'Busy' },
  { value: 'charging', label: 'Charging' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'protective_stop', label: 'Protective stop' },
  { value: 'error', label: 'Error' },
  { value: 'offline', label: 'Offline' },
];

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

export interface RobotListProps {
  /** Opens the register modal (the list's primary action) */
  onRegister: () => void;
}

/** Robots in the fleet, as cards or a table. */
export function RobotList({ onRegister }: RobotListProps) {
  const navigate = useNavigate();
  const { robots, isLoading, error, filters, pagination, fetchRobots, setFilters, clearFilters, setPage } =
    useRobots();
  const unregisterRobot = useRobotsStore((s) => s.unregisterRobot);
  const clearError = useRobotsStore((s) => s.clearError);
  const [view, setViewState] = useState<ViewMode>(readView);
  const [search, setSearch] = useState(filters.search ?? '');

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  // Debounced search into the store filter (server-side search, as before).
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search || undefined) !== filters.search) setFilters({ search: search || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [search, filters.search, setFilters]);

  const setView = (v: ViewMode) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const status = typeof filters.status === 'string' ? filters.status : '';
  const hasFilters = Boolean(status || filters.search || search);
  const clearAll = () => {
    setSearch('');
    clearFilters();
  };

  // The live server ignores ?search and ?status, so apply both here too; a
  // server (or the demo mocks) that already filtered just passes through.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return robots.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.name, r.model, r.serialNumber].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [robots, search, status]);

  const askUnregister = async (robot: Robot) => {
    const ok = await confirm({
      title: `Unregister ${robot.name}?`,
      description:
        'The robot leaves the fleet and stops receiving tasks. Register its agent URL again to bring it back.',
      confirmLabel: 'Unregister',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await unregisterRobot(robot.id);
      toast.success('Robot unregistered', { description: robot.name });
    } catch (err) {
      // The toast reports it; the list keeps showing the robots.
      clearError();
      toast.error("Couldn't unregister robot", { description: errorMessage(err) });
    }
  };

  const actionsFor = (robot: Robot): RowActionItem[] => [
    { label: 'Open control center', icon: <Gauge />, onSelect: () => navigate(`/robots/${robot.id}/cockpit`) },
    { label: 'Unregister', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void askUnregister(robot) },
  ];

  const columns = useMemo<DataTableColumn<Robot>[]>(
    () => [
      {
        key: 'name', header: 'Name', sortable: true,
        cell: (r) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-ink-primary">{r.name}</div>
            <div className="truncate text-[13px] text-ink-tertiary">{r.model}</div>
          </div>
        ),
      },
      { key: 'status', header: 'Status', sortable: true, cell: (r) => <RobotStatusTag status={r.status} /> },
      {
        key: 'battery', header: 'Battery', align: 'right', sortable: true, hideBelow: 'sm',
        sortValue: (r) => r.batteryLevel,
        cell: (r) => {
          const b = robotBattery(r);
          return (
            <span className="tabular-nums text-ink-secondary">
              {b.value}
              {b.unit && <span className="text-ink-tertiary">{b.unit}</span>}
            </span>
          );
        },
      },
      { key: 'zone', header: 'Place', hideBelow: 'md', sortValue: robotPlace, cell: robotPlace },
      { key: 'task', header: 'Task', hideBelow: 'lg', cell: (r) => r.currentTaskName ?? '—' },
      {
        key: 'lastSeen', header: 'Last seen', align: 'right', sortable: true, hideBelow: 'md',
        sortValue: (r) => (r.lastSeen ? new Date(r.lastSeen) : null), cell: robotLastSeen,
      },
    ],
    [],
  );

  const empty = hasFilters ? (
    <EmptyState
      icon={<Search />}
      title="No robots match"
      description="Try another name or status, or clear the filters."
      action={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
    />
  ) : (
    <EmptyState
      icon={<Bot />}
      title="No robots yet"
      description="A robot joins the fleet when you register its agent URL."
      action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={onRegister}>Register robot</Button>}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search robots" aria-label="Search robots" />}
        filters={
          <Select
            aria-label="Status"
            fullWidth={false}
            className="w-44"
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setFilters({ status: (e.target.value || undefined) as RobotStatus | undefined })}
          />
        }
        actions={
          <>
            <SegmentedControl
              label="View"
              options={[{ value: 'grid', label: 'Grid' }, { value: 'table', label: 'Table' }]}
              value={view}
              onChange={(v) => setView(v as ViewMode)}
            />
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={onRegister}>Register robot</Button>
          </>
        }
      />

      {view === 'table' ? (
        <Panel padding="none">
          <DataTable
            caption="Robots"
            columns={columns}
            rows={visible}
            getRowId={(r) => r.id}
            defaultSort={{ key: 'name', direction: 'asc' }}
            onRowClick={(r) => navigate(`/robots/${r.id}`)}
            rowActions={actionsFor}
            rowActionsLabel={(r) => `Actions for ${r.name}`}
            isLoading={isLoading && robots.length === 0}
            error={error}
            errorTitle="Couldn't load robots"
            onRetry={() => void fetchRobots()}
            empty={empty}
          />
        </Panel>
      ) : isLoading && robots.length === 0 ? (
        <Panel><SkeletonRows rows={4} /></Panel>
      ) : error ? (
        <Panel><ErrorState title="Couldn't load robots" message={error} onRetry={() => void fetchRobots()} /></Panel>
      ) : visible.length === 0 ? (
        <Panel>{empty}</Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((robot) => (
            <RobotCard
              key={robot.id}
              robot={robot}
              onClick={() => navigate(`/robots/${robot.id}`)}
              actions={actionsFor(robot)}
            />
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-tertiary">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>
              Previous
            </Button>
            <Button variant="ghost" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

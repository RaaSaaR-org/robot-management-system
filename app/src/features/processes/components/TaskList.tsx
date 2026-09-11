/**
 * @file TaskList.tsx
 * @description The automations list: toolbar (search, status, priority, view),
 *              a DataTable or a card grid, the four list states and server
 *              pagination. Acts (pause, resume, retry, cancel) via row actions.
 * @feature processes
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Search, Workflow } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Panel,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  Select,
  SkeletonRows,
  Toolbar,
  type DataTableColumn,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils/format';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { useTasksStore } from '../store';
import { useTasks } from '../hooks/useTasks';
import {
  PROCESS_PRIORITY_LABELS,
  PROCESS_STATUS_LABELS,
  type Process,
  type ProcessAction,
  type ProcessPriority,
  type ProcessStatus,
} from '../types';
import { TaskCard } from './TaskCard';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskPriorityBadge } from './TaskPriorityBadge';
import { processActionItems, runProcessAct } from './processActs';

export interface TaskListProps {
  /** Called with the id when a row or card is opened */
  onSelectTask?: (taskId: string) => void;
  /** Filter by robot id */
  robotId?: string;
  /** Initial view */
  viewMode?: 'table' | 'cards';
  /** Show the toolbar */
  showFilters?: boolean;
  /** Opens the create modal (used by the empty state) */
  onCreateTask?: () => void;
  className?: string;
}

type View = 'table' | 'cards';

const STATUS_OPTIONS = (Object.keys(PROCESS_STATUS_LABELS) as ProcessStatus[]).map((s) => ({
  value: s,
  label: PROCESS_STATUS_LABELS[s],
}));
const PRIORITY_OPTIONS = (Object.keys(PROCESS_PRIORITY_LABELS) as ProcessPriority[]).map((p) => ({
  value: p,
  label: PROCESS_PRIORITY_LABELS[p],
}));
const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'table', label: 'Table' },
  { value: 'cards', label: 'Cards' },
];

export function TaskList({
  onSelectTask,
  robotId,
  viewMode = 'table',
  showFilters = true,
  onCreateTask,
  className,
}: TaskListProps) {
  const { tasks, isLoading, error, filters, pagination, fetchTasks, setFilters, clearFilters, setPage, clearError } =
    useTasks();
  const pauseTask = useTasksStore((s) => s.pauseTask);
  const resumeTask = useTasksStore((s) => s.resumeTask);
  const cancelTask = useTasksStore((s) => s.cancelTask);
  const retryTask = useTasksStore((s) => s.retryTask);
  const acts: Record<ProcessAction, (id: string) => Promise<Process>> = {
    pause: pauseTask,
    resume: resumeTask,
    cancel: cancelTask,
    retry: retryTask,
  };
  const { robots, fetchRobots } = useRobots();
  const [view, setView] = useState<View>(viewMode);
  const [query, setQuery] = useState(filters.search ?? '');

  useEffect(() => {
    if (robotId && filters.robotId !== robotId) setFilters({ robotId });
  }, [robotId, filters.robotId, setFilters]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (robots.length === 0) void fetchRobots();
  }, [robots.length, fetchRobots]);

  // Debounced server-side search
  useEffect(() => {
    const t = setTimeout(() => {
      if ((query || undefined) !== filters.search) setFilters({ search: query || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [query, filters.search, setFilters]);

  const robotName = useMemo(() => {
    const byId = new Map(robots.map((r) => [r.id, r.name]));
    return (t: Process) => t.robotName ?? (t.robotId ? byId.get(t.robotId) ?? t.robotId : 'Unassigned');
  }, [robots]);

  // The instance list endpoint ignores ?search=, so the loaded page is filtered here as well.
  const visible = useMemo(() => {
    const q = (filters.search ?? '').trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => [t.name, t.description, t.id].some((v) => v?.toLowerCase().includes(q)));
  }, [tasks, filters.search]);

  const status = typeof filters.status === 'string' ? filters.status : '';
  const priority = typeof filters.priority === 'string' ? filters.priority : '';
  const hasFilters = Boolean(query || status || priority);

  const clearAll = () => {
    setQuery('');
    clearFilters();
    if (robotId) setFilters({ robotId });
  };

  const onAct = (action: ProcessAction, task: Process) => {
    void runProcessAct(action, task, () => acts[action](task.id)).then(() => clearError());
  };

  const columns: DataTableColumn<Process>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (t) => (
        <div className="min-w-0 max-w-[22rem]">
          <div className="truncate font-medium text-ink-primary">{t.name}</div>
          {t.description && <div className="truncate text-xs text-ink-tertiary">{t.description}</div>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, cell: (t) => <TaskStatusBadge status={t.status} showPulse /> },
    { key: 'priority', header: 'Priority', hideBelow: 'sm', cell: (t) => <TaskPriorityBadge priority={t.priority} /> },
    { key: 'robot', header: 'Robot', hideBelow: 'md', sortValue: robotName, cell: (t) => robotName(t) },
    {
      key: 'progress',
      header: 'Progress',
      hideBelow: 'sm',
      sortable: true,
      className: 'w-40',
      cell: (t) => <ProgressBar value={t.progress} size="sm" />,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      sortable: true,
      hideBelow: 'md',
      sortValue: (t) => new Date(t.updatedAt),
      cell: (t) => <span className="text-ink-tertiary">{formatTimeAgo(t.updatedAt)}</span>,
    },
  ];

  const empty: ReactNode = hasFilters ? (
    <EmptyState
      icon={<Search />}
      title="No automations match"
      description="Try another name, or clear the filters."
      action={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
    />
  ) : (
    <EmptyState
      icon={<Workflow />}
      title="No automations yet"
      description="An automation is a multi-step job a robot runs on its own."
      action={
        onCreateTask ? (
          <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={onCreateTask}>
            New automation
          </Button>
        ) : undefined
      }
    />
  );

  const firstLoad = isLoading && tasks.length === 0;
  const listError = tasks.length === 0 ? error : null;

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      {showFilters && (
        <Toolbar
          search={<SearchInput value={query} onChange={setQuery} placeholder="Search automations" />}
          filters={
            <>
              <Select
                aria-label="Status"
                fullWidth={false}
                className="w-full sm:w-44"
                placeholder="All statuses"
                options={STATUS_OPTIONS}
                value={status}
                onChange={(e) => setFilters({ status: (e.target.value || undefined) as ProcessStatus | undefined })}
              />
              <Select
                aria-label="Priority"
                fullWidth={false}
                className="w-full sm:w-44"
                placeholder="All priorities"
                options={PRIORITY_OPTIONS}
                value={priority}
                onChange={(e) => setFilters({ priority: (e.target.value || undefined) as ProcessPriority | undefined })}
              />
            </>
          }
          actions={<SegmentedControl label="View" options={VIEW_OPTIONS} value={view} onChange={setView} />}
        />
      )}

      {view === 'table' ? (
        <Panel padding="none">
          <DataTable
            caption="Automations"
            columns={columns}
            rows={visible}
            getRowId={(t) => t.id}
            onRowClick={onSelectTask ? (t) => onSelectTask(t.id) : undefined}
            rowActions={(t) => processActionItems(t, onAct)}
            rowActionsLabel={(t) => `Actions for ${t.name}`}
            isLoading={isLoading}
            error={listError}
            errorTitle="Couldn't load automations"
            onRetry={() => void fetchTasks()}
            empty={empty}
          />
        </Panel>
      ) : firstLoad ? (
        <Panel><SkeletonRows rows={4} columns={3} /></Panel>
      ) : listError ? (
        <Panel><ErrorState title="Couldn't load automations" message={listError} onRetry={() => void fetchTasks()} /></Panel>
      ) : visible.length === 0 ? (
        <Panel>{empty}</Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              robotName={robotName(t)}
              onClick={onSelectTask ? () => onSelectTask(t.id) : undefined}
              actions={processActionItems(t, onAct)}
            />
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-tertiary">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} automations
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={pagination.page <= 1 || isLoading} onClick={() => setPage(pagination.page - 1)}>
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

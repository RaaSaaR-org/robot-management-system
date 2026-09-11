/**
 * @file TaskListPage.tsx
 * @description Agent tasks: work handed to agents over A2A, filterable, with a detail modal
 * @feature a2a
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, MessageSquare, RefreshCw, Search } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Panel,
  SearchInput,
  SegmentedControl,
  Toolbar,
  type DataTableColumn,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { A2ATabs } from '../components/A2ATabs';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import { useA2AStore } from '../store';
import { getEffectiveTaskState, getMessageText } from '../types';
import type { A2ATask, A2ATaskState } from '../types';

type TaskFilter = 'all' | 'active' | 'completed' | 'failed';

const FILTER_STATES: Record<Exclude<TaskFilter, 'all'>, A2ATaskState[]> = {
  active: ['submitted', 'working', 'input_required'],
  completed: ['completed'],
  failed: ['failed', 'canceled'],
};

function taskText(t: A2ATask): string {
  const first = t.history?.find((m) => m.role === 'user');
  const msg = first ?? t.status.message;
  return msg ? getMessageText(msg).replace(/\s+/g, ' ').trim() : '';
}

function taskAgent(t: A2ATask): string {
  const agentMsg = t.history?.find((m) => m.role === 'agent') ?? t.status.message;
  const name = (agentMsg?.metadata as Record<string, unknown> | undefined)?.agentName;
  return typeof name === 'string' ? name : '';
}

function taskUpdated(t: A2ATask): string | undefined {
  return t.status.timestamp ?? t.updatedAt ?? t.createdAt;
}

const columns: DataTableColumn<A2ATask>[] = [
  {
    key: 'task',
    header: 'Task',
    cell: (t) => (
      <div className="flex min-w-0 items-baseline gap-2">
        <code className="shrink-0 font-mono text-xs text-ink-tertiary">{t.id.slice(0, 8)}</code>
        <span className="block max-w-[26rem] truncate text-ink-primary">{taskText(t) || 'No message'}</span>
      </div>
    ),
  },
  { key: 'agent', header: 'Agent', hideBelow: 'md', sortable: true, sortValue: taskAgent, cell: (t) => taskAgent(t) || null },
  {
    key: 'state',
    header: 'State',
    sortable: true,
    sortValue: (t) => getEffectiveTaskState(t),
    cell: (t) => <TaskStatusBadge state={getEffectiveTaskState(t)} />,
  },
  {
    key: 'updated',
    header: 'Updated',
    align: 'right',
    sortable: true,
    hideBelow: 'sm',
    sortValue: (t) => new Date(taskUpdated(t) ?? 0),
    cell: (t) => {
      const u = taskUpdated(t);
      return u ? <span className="whitespace-nowrap text-ink-tertiary">{formatTimeAgo(u)}</span> : null;
    },
  },
];

/**
 * Task list (recipe 1). Tasks are created from chat, so there is no primary here.
 */
export function TaskListPage() {
  const tasks = useA2AStore((s) => s.tasks);
  const fetchTasks = useA2AStore((s) => s.fetchTasks);
  const fetchAgents = useA2AStore((s) => s.fetchAgents);
  const [loading, setLoading] = useState(tasks.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [selected, setSelected] = useState<A2ATask | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    useA2AStore.setState({ error: null });
    await fetchTasks();
    setLoadError(useA2AStore.getState().error);
    setLoading(false);
  }, [fetchTasks]);

  useEffect(() => {
    void load();
    void fetchAgents();
  }, [load, fetchAgents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter !== 'all' && !FILTER_STATES[filter].includes(getEffectiveTaskState(t))) return false;
      if (!q) return true;
      return [t.id, taskText(t), taskAgent(t)].some((s) => s.toLowerCase().includes(q));
    });
  }, [tasks, query, filter]);

  const hasFilters = Boolean(query) || filter !== 'all';
  const clear = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        title="Agent tasks"
        description="Work handed to agents over A2A, newest first."
        actions={
          <Button variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />
      <A2ATabs />
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search tasks" />}
        filters={
          <SegmentedControl<TaskFilter>
            label="State"
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed', label: 'Failed' },
            ]}
            value={filter}
            onChange={setFilter}
          />
        }
      />
      <Panel padding="none">
        <DataTable
          caption="Agent tasks"
          columns={columns}
          rows={filtered}
          getRowId={(t) => t.id}
          defaultSort={{ key: 'updated', direction: 'desc' }}
          onRowClick={setSelected}
          isLoading={loading}
          error={tasks.length === 0 ? loadError : null}
          errorTitle="Couldn't load tasks"
          onRetry={() => void load()}
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />}
                title="No tasks match"
                description="Try another search or state, or clear the filters."
                action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<ClipboardList />}
                title="No agent tasks yet"
                description="A task appears here when you send an agent a message in chat."
                action={
                  <LinkButton to="/a2a" variant="secondary" leftIcon={<MessageSquare className="h-4 w-4" strokeWidth={1.75} />}>
                    Open chat
                  </LinkButton>
                }
              />
            )
          }
        />
      </Panel>
      <TaskDetailModal task={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

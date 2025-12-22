/**
 * @file TaskListPage.tsx
 * @description Task list page with filters for A2A tasks
 * @feature a2a
 */

import { memo, useState, useMemo } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { TaskStatusCard } from '../components/TaskStatusCard';
import { A2ALayout } from '../components/A2ALayout';
import { useA2A } from '../hooks/useA2A';
import type { A2ATaskState } from '../types';

// ============================================================================
// TYPES
// ============================================================================

type TaskFilter = 'all' | 'active' | 'completed' | 'failed';

// ============================================================================
// ICONS
// ============================================================================

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

// ============================================================================
// FILTER BAR
// ============================================================================

interface FilterBarProps {
  current: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  counts: Record<TaskFilter, number>;
}

const FilterBar = memo(function FilterBar({ current, onChange, counts }: FilterBarProps) {
  const filters: { id: TaskFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'completed', label: 'Completed' },
    { id: 'failed', label: 'Failed' },
  ];

  return (
    <div className="flex gap-1 p-1 glass-subtle rounded-lg w-fit">
      {filters.map((filter) => (
        <button
          key={filter.id}
          onClick={() => onChange(filter.id)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5',
            current === filter.id
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
          )}
        >
          {filter.label}
          {counts[filter.id] > 0 && (
            <span
              className={cn(
                'min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs flex items-center justify-center',
                current === filter.id
                  ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              )}
            >
              {counts[filter.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

// ============================================================================
// EMPTY STATE
// ============================================================================

const EmptyState = memo(function EmptyState({ filter }: { filter: TaskFilter }) {
  const messages: Record<TaskFilter, { title: string; description: string }> = {
    all: {
      title: 'No tasks yet',
      description: 'Tasks will appear here when you interact with agents.',
    },
    active: {
      title: 'No active tasks',
      description: 'All tasks are either completed or failed.',
    },
    completed: {
      title: 'No completed tasks',
      description: 'Tasks that complete successfully will appear here.',
    },
    failed: {
      title: 'No failed tasks',
      description: 'Tasks that fail will appear here.',
    },
  };

  const { title, description } = messages[filter];

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="glass-subtle rounded-full p-6 mb-4">
        <ClipboardIcon className="h-10 w-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm">
        {description}
      </p>
    </div>
  );
});

// ============================================================================
// TASK LIST PAGE
// ============================================================================

const ACTIVE_STATES: A2ATaskState[] = ['submitted', 'working', 'input_required'];
const COMPLETED_STATES: A2ATaskState[] = ['completed'];
const FAILED_STATES: A2ATaskState[] = ['failed', 'canceled'];

/**
 * Task list page - shows all tasks with filtering
 */
export const TaskListPage = memo(function TaskListPage() {
  const { tasks, refresh } = useA2A();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Compute filtered tasks
  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'active':
        return tasks.filter((t) => ACTIVE_STATES.includes(t.status.state));
      case 'completed':
        return tasks.filter((t) => COMPLETED_STATES.includes(t.status.state));
      case 'failed':
        return tasks.filter((t) => FAILED_STATES.includes(t.status.state));
      default:
        return tasks;
    }
  }, [tasks, filter]);

  // Compute counts for filter badges
  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((t) => ACTIVE_STATES.includes(t.status.state)).length,
      completed: tasks.filter((t) => COMPLETED_STATES.includes(t.status.state)).length,
      failed: tasks.filter((t) => FAILED_STATES.includes(t.status.state)).length,
    }),
    [tasks]
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Sort tasks by most recent first
  const sortedTasks = useMemo(
    () =>
      [...filteredTasks].sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return dateB - dateA;
      }),
    [filteredTasks]
  );

  return (
    <A2ALayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 md:px-6 border-b border-glass-subtle glass-elevated">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Tasks
            </h1>
            <Badge variant="default" size="sm">
              {tasks.length}
            </Badge>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-1.5"
          >
            <RefreshIcon
              className={cn('w-4 h-4', isRefreshing && 'animate-spin')}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </header>

        {/* Filter Bar */}
        <div className="flex-shrink-0 px-4 md:px-6 py-3 border-b border-glass-subtle overflow-x-auto">
          <FilterBar current={filter} onChange={setFilter} counts={counts} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {sortedTasks.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div className="p-4 md:p-6 space-y-3 max-w-3xl mx-auto">
              {sortedTasks.map((task) => (
                <TaskStatusCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </A2ALayout>
  );
});

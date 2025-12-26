/**
 * @file TaskList.tsx
 * @description Grid/list display of tasks with filtering and pagination
 * @feature processes
 * @dependencies @/shared/components/ui, @/features/processes/hooks
 */

import { useState, useEffect } from 'react';
import { Input, Button, Spinner } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { TaskCard } from './TaskCard';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskPriorityBadge } from './TaskPriorityBadge';
import { useTasks } from '../hooks/useTasks';
import { type ProcessStatus as TaskStatus, type ProcessPriority as TaskPriority, PROCESS_STATUS_LABELS as TASK_STATUS_LABELS, PROCESS_PRIORITY_LABELS as TASK_PRIORITY_LABELS } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskListProps {
  /** Callback when a task is selected */
  onSelectTask?: (taskId: string) => void;
  /** Currently selected task ID */
  selectedTaskId?: string | null;
  /** Filter by robot ID */
  robotId?: string;
  /** Display mode */
  viewMode?: 'grid' | 'list';
  /** Show filter controls */
  showFilters?: boolean;
  /** Show create task button */
  showCreateButton?: boolean;
  /** Create task callback */
  onCreateTask?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STATUS FILTER OPTIONS
// ============================================================================

const STATUS_OPTIONS: (TaskStatus | 'all')[] = [
  'all',
  'pending',
  'queued',
  'in_progress',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

const PRIORITY_OPTIONS: (TaskPriority | 'all')[] = [
  'all',
  'critical',
  'high',
  'normal',
  'low',
];

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a filterable, paginated list or grid of tasks.
 *
 * @example
 * ```tsx
 * function TasksPage() {
 *   const navigate = useNavigate();
 *
 *   return (
 *     <TaskList
 *       onSelectTask={(id) => navigate(`/tasks/${id}`)}
 *       showFilters
 *       showCreateButton
 *       onCreateTask={() => setShowCreateModal(true)}
 *     />
 *   );
 * }
 * ```
 */
export function TaskList({
  onSelectTask,
  selectedTaskId,
  robotId,
  viewMode: initialViewMode = 'grid',
  showFilters = true,
  showCreateButton = false,
  onCreateTask,
  className,
}: TaskListProps) {
  const {
    tasks,
    isLoading,
    error,
    filters,
    pagination,
    fetchTasks,
    setFilters,
    clearFilters,
    setPage,
  } = useTasks();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode);
  const [searchValue, setSearchValue] = useState(filters.search ?? '');

  // Set robot filter if provided
  useEffect(() => {
    if (robotId && filters.robotId !== robotId) {
      setFilters({ robotId });
    }
  }, [robotId, filters.robotId, setFilters]);

  // Fetch tasks on mount
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchValue !== filters.search) {
        setFilters({ search: searchValue || undefined });
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchValue, filters.search, setFilters]);

  const handleStatusFilter = (status: TaskStatus | 'all') => {
    setFilters({ status: status === 'all' ? undefined : status });
  };

  const handlePriorityFilter = (priority: TaskPriority | 'all') => {
    setFilters({ priority: priority === 'all' ? undefined : priority });
  };

  const currentStatus = filters.status as TaskStatus | undefined;
  const currentPriority = filters.priority as TaskPriority | undefined;

  // Loading state
  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" color="cobalt" label="Loading processes..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-medium text-theme-primary">Failed to load processes</h3>
        <p className="mt-1 text-sm text-theme-secondary">{error}</p>
        <Button variant="primary" size="sm" className="mt-4" onClick={() => fetchTasks()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with search and create button */}
      {showFilters && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Search */}
          <div className="w-full sm:max-w-xs">
            <Input
              placeholder="Search processes..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              leftIcon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              }
            />
          </div>

          {/* Create button + View toggle */}
          <div className="flex items-center gap-4">
            {showCreateButton && onCreateTask && (
              <Button variant="primary" size="sm" onClick={onCreateTask}>
                <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Create Process
              </Button>
            )}

            {/* View mode toggle - glass container */}
            <div className="glass-subtle rounded-lg p-0.5 flex items-center">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-2 rounded-md transition-all duration-200',
                  viewMode === 'grid'
                    ? 'bg-cobalt-500 text-white shadow-sm'
                    : 'text-theme-tertiary hover:text-theme-primary'
                )}
                aria-label="Grid view"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-2 rounded-md transition-all duration-200',
                  viewMode === 'list'
                    ? 'bg-cobalt-500 text-white shadow-sm'
                    : 'text-theme-tertiary hover:text-theme-primary'
                )}
                aria-label="List view"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters row */}
      {showFilters && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Status filter - glass pill container */}
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="card-label shrink-0">Status</span>
            <div className="glass-subtle rounded-xl p-1 flex items-center gap-1">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusFilter(status)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-lg transition-all duration-200 whitespace-nowrap',
                    (status === 'all' && !currentStatus) || currentStatus === status
                      ? 'bg-cobalt-500 text-white shadow-sm'
                      : 'text-theme-secondary hover:text-theme-primary hover:bg-white/5'
                  )}
                >
                  {status === 'all' ? 'All' : TASK_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </div>

          {/* Priority filter - glass pill container */}
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="card-label shrink-0">Priority</span>
            <div className="glass-subtle rounded-xl p-1 flex items-center gap-1">
              {PRIORITY_OPTIONS.map((priority) => (
                <button
                  key={priority}
                  onClick={() => handlePriorityFilter(priority)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-lg transition-all duration-200 whitespace-nowrap',
                    (priority === 'all' && !currentPriority) || currentPriority === priority
                      ? 'bg-cobalt-500 text-white shadow-sm'
                      : 'text-theme-secondary hover:text-theme-primary hover:bg-white/5'
                  )}
                >
                  {priority === 'all' ? 'All' : TASK_PRIORITY_LABELS[priority]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Active filters summary */}
      {(currentStatus || currentPriority || filters.search || filters.robotId) && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="card-meta">Filters:</span>
          {currentStatus && <TaskStatusBadge status={currentStatus} size="sm" />}
          {currentPriority && <TaskPriorityBadge priority={currentPriority} size="sm" />}
          {filters.search && (
            <span className="px-2 py-0.5 glass-subtle rounded-lg text-theme-primary">
              "{filters.search}"
            </span>
          )}
          {filters.robotId && (
            <span className="px-2 py-0.5 glass-subtle rounded-lg text-theme-primary">
              Robot: {filters.robotId}
            </span>
          )}
          <button
            onClick={clearFilters}
            className="text-cobalt-400 hover:text-cobalt-300 ml-2 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Task list/grid */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="glass-subtle rounded-2xl p-5">
            <svg
              className="h-8 w-8 text-theme-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-medium text-theme-primary">No processes found</h3>
          <p className="mt-1 card-meta">
            {currentStatus || currentPriority || filters.search
              ? 'Try adjusting your filters'
              : 'No processes have been created yet'}
          </p>
          {showCreateButton && onCreateTask && (
            <Button variant="primary" size="sm" className="mt-4" onClick={onCreateTask}>
              Create Process
            </Button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            viewMode === 'grid'
              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
              : 'flex flex-col gap-3'
          )}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={onSelectTask ? () => onSelectTask(task.id) : undefined}
              selected={selectedTaskId === task.id}
              compact={viewMode === 'list'}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-glass-subtle pt-4">
          <p className="card-meta">
            Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total} processes
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-theme-secondary">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Loading overlay for subsequent fetches */}
      {isLoading && tasks.length > 0 && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <Spinner size="lg" color="cobalt" />
        </div>
      )}
    </div>
  );
}

/**
 * @file useTasks.ts
 * @description React hooks for task state and operations
 * @feature tasks
 * @dependencies @/features/tasks/store, @/features/tasks/types, @/features/tasks/api
 * @stateAccess useTasksStore (read/write)
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useTasksStore,
  selectTasks,
  selectSelectedTaskId,
  selectSelectedTask,
  selectTaskDetail,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectIsExecuting,
  selectError,
  selectTaskById,
  selectActiveTasks,
} from '../store/tasksStore';
import type {
  Process as Task,
  ProcessStatus as TaskStatus,
  ProcessFilters as TaskFilters,
  ProcessPagination as TaskPagination,
  CreateProcessRequest as CreateTaskRequest,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseTasksReturn {
  /** List of tasks */
  tasks: Task[];
  /** Currently selected task */
  selectedTask: Task | null;
  /** Selected task ID */
  selectedTaskId: string | null;
  /** Current filters */
  filters: TaskFilters;
  /** Pagination info */
  pagination: TaskPagination;
  /** Loading state */
  isLoading: boolean;
  /** Executing action state */
  isExecuting: boolean;
  /** Error message */
  error: string | null;
  /** Fetch tasks */
  fetchTasks: () => Promise<void>;
  /** Select a task */
  selectTask: (id: string | null) => void;
  /** Update filters */
  setFilters: (filters: Partial<TaskFilters>) => void;
  /** Clear all filters */
  clearFilters: () => void;
  /** Change page */
  setPage: (page: number) => void;
  /** Create a new task */
  createTask: (data: CreateTaskRequest) => Promise<Task>;
  /** Clear error */
  clearError: () => void;
}

export interface UseTaskReturn {
  /** Task data */
  task: Task | null;
  /** Loading state */
  isLoading: boolean;
  /** Executing action state */
  isExecuting: boolean;
  /** Error message */
  error: string | null;
  /** Refresh task data */
  refresh: () => Promise<void>;
  /** Pause the task */
  pauseTask: () => Promise<Task>;
  /** Resume the task */
  resumeTask: () => Promise<Task>;
  /** Cancel the task */
  cancelTask: () => Promise<Task>;
  /** Retry the task */
  retryTask: () => Promise<Task>;
}

export interface UseTaskListReturn {
  /** List of tasks */
  tasks: Task[];
  /** Pagination info */
  pagination: TaskPagination;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh list */
  refresh: () => Promise<void>;
  /** Go to page */
  goToPage: (page: number) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Has next page */
  hasNextPage: boolean;
  /** Has previous page */
  hasPrevPage: boolean;
}

export interface UseTaskQueueReturn {
  /** List of active tasks */
  tasks: Task[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh queue */
  refresh: () => Promise<void>;
}

export interface UseTaskActionsReturn {
  /** Pause the task */
  pause: () => Promise<Task>;
  /** Resume the task */
  resume: () => Promise<Task>;
  /** Cancel the task */
  cancel: () => Promise<Task>;
  /** Retry the task */
  retry: () => Promise<Task>;
  /** Action in progress */
  isExecuting: boolean;
  /** Last error */
  error: string | null;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for accessing task list state and operations.
 *
 * @example
 * ```tsx
 * function TasksPage() {
 *   const { tasks, isLoading, fetchTasks, setFilters } = useTasks();
 *
 *   useEffect(() => {
 *     fetchTasks();
 *   }, [fetchTasks]);
 *
 *   return (
 *     <div>
 *       {tasks.map(task => <TaskCard key={task.id} task={task} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTasks(): UseTasksReturn {
  const tasks = useTasksStore(selectTasks);
  const selectedTaskId = useTasksStore(selectSelectedTaskId);
  const selectedTask = useTasksStore(selectSelectedTask);
  const filters = useTasksStore(selectFilters);
  const pagination = useTasksStore(selectPagination);
  const isLoading = useTasksStore(selectIsLoading);
  const isExecuting = useTasksStore(selectIsExecuting);
  const error = useTasksStore(selectError);

  const storeFetchTasks = useTasksStore((state) => state.fetchTasks);
  const storeSelectTask = useTasksStore((state) => state.selectTask);
  const storeSetFilters = useTasksStore((state) => state.setFilters);
  const storeClearFilters = useTasksStore((state) => state.clearFilters);
  const storeSetPage = useTasksStore((state) => state.setPage);
  const storeCreateTask = useTasksStore((state) => state.createTask);
  const storeClearError = useTasksStore((state) => state.clearError);

  const fetchTasks = useCallback(async () => {
    await storeFetchTasks();
  }, [storeFetchTasks]);

  const selectTask = useCallback(
    (id: string | null) => {
      storeSelectTask(id);
    },
    [storeSelectTask]
  );

  const setFilters = useCallback(
    (newFilters: Partial<TaskFilters>) => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  const clearFilters = useCallback(() => {
    storeClearFilters();
  }, [storeClearFilters]);

  const setPage = useCallback(
    (page: number) => {
      storeSetPage(page);
    },
    [storeSetPage]
  );

  const createTask = useCallback(
    async (data: CreateTaskRequest) => {
      return storeCreateTask(data);
    },
    [storeCreateTask]
  );

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  return useMemo(
    () => ({
      tasks,
      selectedTask,
      selectedTaskId,
      filters,
      pagination,
      isLoading,
      isExecuting,
      error,
      fetchTasks,
      selectTask,
      setFilters,
      clearFilters,
      setPage,
      createTask,
      clearError,
    }),
    [
      tasks,
      selectedTask,
      selectedTaskId,
      filters,
      pagination,
      isLoading,
      isExecuting,
      error,
      fetchTasks,
      selectTask,
      setFilters,
      clearFilters,
      setPage,
      createTask,
      clearError,
    ]
  );
}

// ============================================================================
// SINGLE TASK HOOK
// ============================================================================

/**
 * Hook for accessing a single task's data and operations.
 * Automatically fetches task data on mount.
 *
 * @param id - Task ID
 *
 * @example
 * ```tsx
 * function TaskDetailPage({ taskId }: { taskId: string }) {
 *   const { task, isLoading, pauseTask, cancelTask } = useTask(taskId);
 *
 *   if (isLoading) return <Spinner />;
 *   if (!task) return <div>Task not found</div>;
 *
 *   return <TaskDetailPanel task={task} />;
 * }
 * ```
 */
export function useTask(id: string): UseTaskReturn {
  const isLoading = useTasksStore(selectIsLoading);
  const isExecuting = useTasksStore(selectIsExecuting);
  const error = useTasksStore(selectError);
  const taskDetail = useTasksStore(selectTaskDetail);
  const taskFromList = useTasksStore(selectTaskById(id));

  const storeFetchTask = useTasksStore((state) => state.fetchTask);
  const storePauseTask = useTasksStore((state) => state.pauseTask);
  const storeResumeTask = useTasksStore((state) => state.resumeTask);
  const storeCancelTask = useTasksStore((state) => state.cancelTask);
  const storeRetryTask = useTasksStore((state) => state.retryTask);

  // Use detail if available, otherwise fall back to list
  const task = taskDetail?.id === id ? taskDetail : taskFromList;

  // Fetch task on mount
  useEffect(() => {
    storeFetchTask(id);
  }, [id, storeFetchTask]);

  const refresh = useCallback(async () => {
    await storeFetchTask(id);
  }, [id, storeFetchTask]);

  const pauseTask = useCallback(async () => {
    return storePauseTask(id);
  }, [id, storePauseTask]);

  const resumeTask = useCallback(async () => {
    return storeResumeTask(id);
  }, [id, storeResumeTask]);

  const cancelTask = useCallback(async () => {
    return storeCancelTask(id);
  }, [id, storeCancelTask]);

  const retryTask = useCallback(async () => {
    return storeRetryTask(id);
  }, [id, storeRetryTask]);

  return useMemo(
    () => ({
      task,
      isLoading,
      isExecuting,
      error,
      refresh,
      pauseTask,
      resumeTask,
      cancelTask,
      retryTask,
    }),
    [task, isLoading, isExecuting, error, refresh, pauseTask, resumeTask, cancelTask, retryTask]
  );
}

// ============================================================================
// TASK LIST HOOK
// ============================================================================

/**
 * Hook for task list with pagination controls.
 *
 * @example
 * ```tsx
 * function TaskListWithPagination() {
 *   const { tasks, pagination, nextPage, prevPage, hasNextPage } = useTaskList();
 *
 *   return (
 *     <>
 *       <TaskGrid tasks={tasks} />
 *       <Pagination
 *         page={pagination.page}
 *         total={pagination.totalPages}
 *         onNext={nextPage}
 *         onPrev={prevPage}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function useTaskList(): UseTaskListReturn {
  const tasks = useTasksStore(selectTasks);
  const pagination = useTasksStore(selectPagination);
  const isLoading = useTasksStore(selectIsLoading);
  const error = useTasksStore(selectError);

  const storeFetchTasks = useTasksStore((state) => state.fetchTasks);
  const storeSetPage = useTasksStore((state) => state.setPage);

  const refresh = useCallback(async () => {
    await storeFetchTasks();
  }, [storeFetchTasks]);

  const goToPage = useCallback(
    (page: number) => {
      storeSetPage(page);
    },
    [storeSetPage]
  );

  const nextPage = useCallback(() => {
    if (pagination.page < pagination.totalPages) {
      storeSetPage(pagination.page + 1);
    }
  }, [pagination.page, pagination.totalPages, storeSetPage]);

  const prevPage = useCallback(() => {
    if (pagination.page > 1) {
      storeSetPage(pagination.page - 1);
    }
  }, [pagination.page, storeSetPage]);

  const hasNextPage = pagination.page < pagination.totalPages;
  const hasPrevPage = pagination.page > 1;

  return useMemo(
    () => ({
      tasks,
      pagination,
      isLoading,
      error,
      refresh,
      goToPage,
      nextPage,
      prevPage,
      hasNextPage,
      hasPrevPage,
    }),
    [tasks, pagination, isLoading, error, refresh, goToPage, nextPage, prevPage, hasNextPage, hasPrevPage]
  );
}

// ============================================================================
// TASK QUEUE HOOK
// ============================================================================

/**
 * Hook for accessing the task queue (active tasks).
 * Optionally filter by robot ID.
 *
 * @param robotId - Optional robot ID to filter by
 *
 * @example
 * ```tsx
 * function ActiveTasksPanel({ robotId }: { robotId?: string }) {
 *   const { tasks, isLoading, refresh } = useTaskQueue(robotId);
 *
 *   return (
 *     <div>
 *       <h3>Active Tasks</h3>
 *       {tasks.map(task => <TaskCard key={task.id} task={task} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTaskQueue(robotId?: string): UseTaskQueueReturn {
  const allTasks = useTasksStore(selectActiveTasks);
  const isLoading = useTasksStore(selectIsLoading);
  const error = useTasksStore(selectError);

  const storeFetchTasks = useTasksStore((state) => state.fetchTasks);
  const storeSetFilters = useTasksStore((state) => state.setFilters);

  // Filter by robot if provided
  const tasks = useMemo(() => {
    if (!robotId) return allTasks;
    return allTasks.filter((t) => t.robotId === robotId);
  }, [allTasks, robotId]);

  // Set initial filter if robotId provided
  useEffect(() => {
    if (robotId) {
      storeSetFilters({ robotId, status: ['pending', 'queued', 'in_progress', 'paused'] });
    }
  }, [robotId, storeSetFilters]);

  const refresh = useCallback(async () => {
    await storeFetchTasks();
  }, [storeFetchTasks]);

  return useMemo(
    () => ({
      tasks,
      isLoading,
      error,
      refresh,
    }),
    [tasks, isLoading, error, refresh]
  );
}

// ============================================================================
// TASK ACTIONS HOOK
// ============================================================================

/**
 * Hook for task action operations.
 *
 * @param taskId - Task ID
 *
 * @example
 * ```tsx
 * function TaskControls({ taskId }: { taskId: string }) {
 *   const { pause, resume, cancel, isExecuting } = useTaskActions(taskId);
 *
 *   return (
 *     <div>
 *       <Button onClick={() => pause()} disabled={isExecuting}>Pause</Button>
 *       <Button onClick={() => cancel()} variant="destructive">Cancel</Button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTaskActions(taskId: string): UseTaskActionsReturn {
  const isExecuting = useTasksStore(selectIsExecuting);
  const error = useTasksStore(selectError);

  const storePauseTask = useTasksStore((state) => state.pauseTask);
  const storeResumeTask = useTasksStore((state) => state.resumeTask);
  const storeCancelTask = useTasksStore((state) => state.cancelTask);
  const storeRetryTask = useTasksStore((state) => state.retryTask);

  const pause = useCallback(async () => {
    return storePauseTask(taskId);
  }, [taskId, storePauseTask]);

  const resume = useCallback(async () => {
    return storeResumeTask(taskId);
  }, [taskId, storeResumeTask]);

  const cancel = useCallback(async () => {
    return storeCancelTask(taskId);
  }, [taskId, storeCancelTask]);

  const retry = useCallback(async () => {
    return storeRetryTask(taskId);
  }, [taskId, storeRetryTask]);

  return useMemo(
    () => ({
      pause,
      resume,
      cancel,
      retry,
      isExecuting,
      error,
    }),
    [pause, resume, cancel, retry, isExecuting, error]
  );
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Hook to get a task by ID from the store.
 */
export function useTaskById(id: string): Task | null {
  return useTasksStore(selectTaskById(id));
}

/**
 * Hook to get tasks filtered by robot ID.
 */
export function useTasksByRobotId(robotId: string): Task[] {
  const tasks = useTasksStore(selectTasks);
  return useMemo(() => tasks.filter((t) => t.robotId === robotId), [tasks, robotId]);
}

/**
 * Hook to get tasks filtered by status.
 */
export function useTasksByStatus(status: TaskStatus): Task[] {
  const tasks = useTasksStore(selectTasks);
  return useMemo(() => tasks.filter((t) => t.status === status), [tasks, status]);
}

/**
 * Hook to get active tasks (pending, queued, in_progress, paused).
 */
export function useActiveTasks(): Task[] {
  return useTasksStore(selectActiveTasks);
}

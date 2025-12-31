/**
 * @file tasksStore.ts
 * @description Zustand store for task state management
 * @feature processes
 * @dependencies @/store, @/features/processes/api, @/features/processes/types
 * @stateAccess Creates: useTasksStore
 */

import { createStore } from '@/store';
import { tasksApi } from '../api/tasksApi';
import type {
  ProcessesStore as TasksStore,
  Process as Task,
  ProcessStatus as TaskStatus,
  ProcessFilters as TaskFilters,
  CreateProcessRequest as CreateTaskRequest,
  ProcessErrorCode as TaskErrorCode,
} from '../types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  tasks: [] as Task[],
  selectedTaskId: null as string | null,
  filters: {} as TaskFilters,
  pagination: {
    page: 1,
    pageSize: 12,
    total: 0,
    totalPages: 0,
  },
  isLoading: false,
  isExecuting: false,
  error: null as string | null,
  taskDetail: null as Task | null,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const ERROR_MESSAGES: Record<TaskErrorCode, string> = {
  TASK_NOT_FOUND: 'Task not found',
  TASK_ALREADY_COMPLETED: 'Task has already been completed',
  TASK_ALREADY_CANCELLED: 'Task has already been cancelled',
  TASK_NOT_PAUSEABLE: 'This task cannot be paused',
  TASK_NOT_RESUMEABLE: 'This task cannot be resumed',
  TASK_NOT_CANCELLABLE: 'This task cannot be cancelled',
  TASK_NOT_RETRYABLE: 'This task cannot be retried',
  ROBOT_NOT_AVAILABLE: 'The assigned robot is not available',
  INVALID_TASK_DATA: 'Invalid task data provided',
  PERMISSION_DENIED: 'You do not have permission to perform this action',
  NETWORK_ERROR: 'Unable to connect to the server',
  UNKNOWN_ERROR: 'An unexpected error occurred',
};

// ============================================================================
// STORE
// ============================================================================

export const useTasksStore = createStore<TasksStore>(
  (set, get) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Fetch Tasks
    // --------------------------------------------------------------------------
    fetchTasks: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const { filters, pagination } = get();
        const response = await tasksApi.listTasks({
          ...filters,
          page: pagination.page,
          pageSize: pagination.pageSize,
        });

        set((state) => {
          state.tasks = response.tasks;
          state.pagination = response.pagination;
          state.isLoading = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Single Task
    // --------------------------------------------------------------------------
    fetchTask: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const task = await tasksApi.getTask(id);

        set((state) => {
          state.taskDetail = task;
          state.isLoading = false;
          // Also update in list if present
          const index = state.tasks.findIndex((t) => t.id === id);
          if (index !== -1) {
            state.tasks[index] = task;
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Create Task
    // --------------------------------------------------------------------------
    createTask: async (data: CreateTaskRequest) => {
      set((state) => {
        state.isExecuting = true;
        state.error = null;
      });

      try {
        const task = await tasksApi.createTask(data);

        set((state) => {
          state.tasks.unshift(task);
          state.pagination.total += 1;
          state.isExecuting = false;
        });

        return task;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isExecuting = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Select Task
    // --------------------------------------------------------------------------
    selectTask: (id: string | null) => {
      set((state) => {
        state.selectedTaskId = id;
        if (id === null) {
          state.taskDetail = null;
        }
      });
    },

    // --------------------------------------------------------------------------
    // Set Filters
    // --------------------------------------------------------------------------
    setFilters: (filters: Partial<TaskFilters>) => {
      set((state) => {
        state.filters = { ...state.filters, ...filters };
        state.pagination.page = 1; // Reset to first page on filter change
      });
      // Auto-fetch with new filters
      get().fetchTasks();
    },

    // --------------------------------------------------------------------------
    // Clear Filters
    // --------------------------------------------------------------------------
    clearFilters: () => {
      set((state) => {
        state.filters = {};
        state.pagination.page = 1;
      });
      get().fetchTasks();
    },

    // --------------------------------------------------------------------------
    // Set Page
    // --------------------------------------------------------------------------
    setPage: (page: number) => {
      set((state) => {
        state.pagination.page = page;
      });
      get().fetchTasks();
    },

    // --------------------------------------------------------------------------
    // Pause Task
    // --------------------------------------------------------------------------
    pauseTask: async (id: string) => {
      set((state) => {
        state.isExecuting = true;
        state.error = null;
      });

      try {
        const task = await tasksApi.pauseTask(id);
        updateTaskInState(set, task);
        set((state) => {
          state.isExecuting = false;
        });
        return task;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isExecuting = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Resume Task
    // --------------------------------------------------------------------------
    resumeTask: async (id: string) => {
      set((state) => {
        state.isExecuting = true;
        state.error = null;
      });

      try {
        const task = await tasksApi.resumeTask(id);
        updateTaskInState(set, task);
        set((state) => {
          state.isExecuting = false;
        });
        return task;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isExecuting = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Cancel Task
    // --------------------------------------------------------------------------
    cancelTask: async (id: string) => {
      set((state) => {
        state.isExecuting = true;
        state.error = null;
      });

      try {
        const task = await tasksApi.cancelTask(id);
        updateTaskInState(set, task);
        set((state) => {
          state.isExecuting = false;
        });
        return task;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isExecuting = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Retry Task
    // --------------------------------------------------------------------------
    retryTask: async (id: string) => {
      set((state) => {
        state.isExecuting = true;
        state.error = null;
      });

      try {
        const task = await tasksApi.retryTask(id);
        updateTaskInState(set, task);
        set((state) => {
          state.isExecuting = false;
        });
        return task;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isExecuting = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Update Task Status (for WebSocket updates)
    // --------------------------------------------------------------------------
    updateTaskStatus: (taskId: string, status: TaskStatus) => {
      set((state) => {
        // Update in list
        const task = state.tasks.find((t) => t.id === taskId);
        if (task) {
          task.status = status;
          task.updatedAt = new Date().toISOString();
        }
        // Update in detail if viewing
        if (state.taskDetail?.id === taskId) {
          state.taskDetail.status = status;
          state.taskDetail.updatedAt = new Date().toISOString();
        }
      });
    },

    // --------------------------------------------------------------------------
    // Update Task Data (for WebSocket updates)
    // --------------------------------------------------------------------------
    updateTask: (taskUpdate: Partial<Task> & { id: string }) => {
      set((state) => {
        // Update in list
        const index = state.tasks.findIndex((t) => t.id === taskUpdate.id);
        if (index !== -1) {
          state.tasks[index] = { ...state.tasks[index], ...taskUpdate };
        }
        // Update in detail if viewing
        if (state.taskDetail?.id === taskUpdate.id) {
          state.taskDetail = { ...state.taskDetail, ...taskUpdate };
        }
      });
    },

    // --------------------------------------------------------------------------
    // Update Process from WebSocket (for real-time updates)
    // --------------------------------------------------------------------------
    updateProcessFromWebSocket: (process: Task) => {
      set((state) => {
        // Update in list if exists, otherwise add to front
        const index = state.tasks.findIndex((t) => t.id === process.id);
        if (index !== -1) {
          state.tasks[index] = process;
        } else {
          // New process - add to front of list
          state.tasks.unshift(process);
          state.pagination.total += 1;
        }
        // Update in detail if viewing this process
        if (state.taskDetail?.id === process.id) {
          state.taskDetail = process;
        }
      });
    },

    // --------------------------------------------------------------------------
    // Clear Error
    // --------------------------------------------------------------------------
    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    // --------------------------------------------------------------------------
    // Reset Store
    // --------------------------------------------------------------------------
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  {
    name: 'TasksStore',
    persist: false, // Task data should always be fresh from API
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select all tasks */
export const selectTasks = (state: TasksStore) => state.tasks;

/** Select selected task ID */
export const selectSelectedTaskId = (state: TasksStore) => state.selectedTaskId;

/** Select task detail */
export const selectTaskDetail = (state: TasksStore) => state.taskDetail;

/** Select filters */
export const selectFilters = (state: TasksStore) => state.filters;

/** Select pagination */
export const selectPagination = (state: TasksStore) => state.pagination;

/** Select loading state */
export const selectIsLoading = (state: TasksStore) => state.isLoading;

/** Select executing state */
export const selectIsExecuting = (state: TasksStore) => state.isExecuting;

/** Select error */
export const selectError = (state: TasksStore) => state.error;

/** Select task by ID from list */
export const selectTaskById = (id: string) => (state: TasksStore) =>
  state.tasks.find((t) => t.id === id) ?? null;

/** Select tasks by status */
export const selectTasksByStatus = (status: TaskStatus) => (state: TasksStore) =>
  state.tasks.filter((t) => t.status === status);

/** Select tasks by robot ID */
export const selectTasksByRobotId = (robotId: string) => (state: TasksStore) =>
  state.tasks.filter((t) => t.robotId === robotId);

/** Select active tasks (pending, queued, in_progress, paused) */
export const selectActiveTasks = (state: TasksStore) =>
  state.tasks.filter((t) =>
    ['pending', 'queued', 'in_progress', 'paused'].includes(t.status)
  );

/** Select pending tasks */
export const selectPendingTasks = (state: TasksStore) =>
  state.tasks.filter((t) => t.status === 'pending' || t.status === 'queued');

/** Select in-progress tasks */
export const selectInProgressTasks = (state: TasksStore) =>
  state.tasks.filter((t) => t.status === 'in_progress');

/** Select selected task from list */
export const selectSelectedTask = (state: TasksStore) =>
  state.selectedTaskId
    ? state.tasks.find((t) => t.id === state.selectedTaskId) ?? null
    : null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Update a task in both list and detail state
 */
function updateTaskInState(
  set: (fn: (state: TasksStore) => void) => void,
  task: Task
) {
  set((state) => {
    // Update in list
    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index !== -1) {
      state.tasks[index] = task;
    }
    // Update in detail if viewing
    if (state.taskDetail?.id === task.id) {
      state.taskDetail = task;
    }
  });
}

/**
 * Extract error message from API error
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    // Check for API error format
    if ('code' in error && typeof error.code === 'string') {
      const code = error.code as TaskErrorCode;
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }

    // Check for message property
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    // Check for response.data.message (Axios error format)
    if ('response' in error) {
      const response = error.response as { data?: { message?: string } };
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

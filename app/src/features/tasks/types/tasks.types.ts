/**
 * @file tasks.types.ts
 * @description Type definitions for task entities, steps, and store
 * @feature tasks
 * @dependencies @/features/robots/types
 */


// ============================================================================
// STATUS TYPES
// ============================================================================

/** Task execution status */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Task priority levels */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/** Task step status */
export type TaskStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

/** Task action commands */
export type TaskAction = 'pause' | 'resume' | 'cancel' | 'retry';

// ============================================================================
// TASK STEP ENTITY
// ============================================================================

/** Individual step within a task */
export interface TaskStep {
  id: string;
  name: string;
  description?: string;
  status: TaskStepStatus;
  order: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// TASK ENTITY
// ============================================================================

/** Core task entity */
export interface Task {
  id: string;
  name: string;
  description?: string;
  robotId: string;
  robotName?: string;
  status: TaskStatus;
  priority: TaskPriority;
  steps: TaskStep[];
  progress: number;
  currentStepIndex: number;
  estimatedDuration?: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// CREATE TASK TYPES
// ============================================================================

/** Task step for creation (without id and status) */
export interface CreateTaskStep {
  name: string;
  description?: string;
}

/** Task creation request */
export interface CreateTaskRequest {
  name: string;
  description?: string;
  robotId: string;
  priority?: TaskPriority;
  steps?: CreateTaskStep[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// FILTER & PAGINATION TYPES
// ============================================================================

/** Task list filter parameters */
export interface TaskFilters {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  robotId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Pagination parameters */
export interface TaskPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/** Parameters for listing tasks */
export interface TaskListParams {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  robotId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: keyof Task;
  sortOrder?: 'asc' | 'desc';
}

/** Response for task list endpoint */
export interface TaskListResponse {
  tasks: Task[];
  pagination: TaskPagination;
}

/** Request for task action */
export interface TaskActionRequest {
  action: TaskAction;
}

/** Response for task action */
export interface TaskActionResponse {
  task: Task;
  message: string;
}

// ============================================================================
// STORE TYPES
// ============================================================================

/** Tasks store state */
export interface TasksState {
  /** List of tasks */
  tasks: Task[];
  /** Currently selected task ID */
  selectedTaskId: string | null;
  /** Current filters */
  filters: TaskFilters;
  /** Pagination state */
  pagination: TaskPagination;
  /** Loading state */
  isLoading: boolean;
  /** Action execution state */
  isExecuting: boolean;
  /** Error message */
  error: string | null;
  /** Individual task detail (when viewing single task) */
  taskDetail: Task | null;
}

/** Tasks store actions */
export interface TasksActions {
  /** Fetch tasks with current filters */
  fetchTasks: () => Promise<void>;
  /** Fetch a single task by ID */
  fetchTask: (id: string) => Promise<void>;
  /** Create a new task */
  createTask: (data: CreateTaskRequest) => Promise<Task>;
  /** Select a task */
  selectTask: (id: string | null) => void;
  /** Update filters */
  setFilters: (filters: Partial<TaskFilters>) => void;
  /** Clear all filters */
  clearFilters: () => void;
  /** Set page number */
  setPage: (page: number) => void;
  /** Pause a task */
  pauseTask: (id: string) => Promise<Task>;
  /** Resume a paused task */
  resumeTask: (id: string) => Promise<Task>;
  /** Cancel a task */
  cancelTask: (id: string) => Promise<Task>;
  /** Retry a failed task */
  retryTask: (id: string) => Promise<Task>;
  /** Update task status (for WebSocket updates) */
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  /** Update task data (for WebSocket updates) */
  updateTask: (task: Partial<Task> & { id: string }) => void;
  /** Clear error */
  clearError: () => void;
  /** Reset store to initial state */
  reset: () => void;
}

/** Combined tasks store type */
export type TasksStore = TasksState & TasksActions;

// ============================================================================
// ERROR TYPES
// ============================================================================

/** Task-related error codes */
export type TaskErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_ALREADY_COMPLETED'
  | 'TASK_ALREADY_CANCELLED'
  | 'TASK_NOT_PAUSEABLE'
  | 'TASK_NOT_RESUMEABLE'
  | 'TASK_NOT_CANCELLABLE'
  | 'TASK_NOT_RETRYABLE'
  | 'ROBOT_NOT_AVAILABLE'
  | 'INVALID_TASK_DATA'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/** Task error */
export interface TaskError {
  code: TaskErrorCode;
  message: string;
  taskId?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Status display labels */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  in_progress: 'In Progress',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Status colors for UI (maps to Badge variants) */
export const TASK_STATUS_COLORS: Record<TaskStatus, 'success' | 'default' | 'info' | 'error' | 'warning'> = {
  pending: 'default',
  queued: 'info',
  in_progress: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

/** Priority display labels */
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

/** Priority colors for UI */
export const TASK_PRIORITY_COLORS: Record<TaskPriority, 'success' | 'default' | 'info' | 'error' | 'warning'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  critical: 'error',
};

/** Step status display labels */
export const TASK_STEP_STATUS_LABELS: Record<TaskStepStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Default pagination */
export const DEFAULT_TASK_PAGINATION: TaskPagination = {
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

/** Default filters */
export const DEFAULT_TASK_FILTERS: TaskFilters = {};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a task is currently active (running or paused)
 */
export function isTaskActive(task: Task): boolean {
  return task.status === 'in_progress' || task.status === 'paused' || task.status === 'queued';
}

/**
 * Check if a task can be paused
 */
export function isTaskPauseable(task: Task): boolean {
  return task.status === 'in_progress';
}

/**
 * Check if a task can be resumed
 */
export function isTaskResumeable(task: Task): boolean {
  return task.status === 'paused';
}

/**
 * Check if a task can be cancelled
 */
export function isTaskCancellable(task: Task): boolean {
  return task.status === 'pending' || task.status === 'queued' || task.status === 'in_progress' || task.status === 'paused';
}

/**
 * Check if a task can be retried
 */
export function isTaskRetryable(task: Task): boolean {
  return task.status === 'failed' || task.status === 'cancelled';
}

/**
 * Check if a task has ended (completed, failed, or cancelled)
 */
export function isTaskEnded(task: Task): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
}

/**
 * Calculate task progress from steps
 */
export function calculateTaskProgress(steps: TaskStep[]): number {
  if (steps.length === 0) return 0;
  const completedSteps = steps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped'
  ).length;
  return Math.round((completedSteps / steps.length) * 100);
}

/**
 * Get the current step index from task steps
 */
export function getCurrentStepIndex(steps: TaskStep[]): number {
  const inProgressIndex = steps.findIndex((step) => step.status === 'in_progress');
  if (inProgressIndex !== -1) return inProgressIndex;

  const pendingIndex = steps.findIndex((step) => step.status === 'pending');
  if (pendingIndex !== -1) return pendingIndex;

  return steps.length - 1;
}

/**
 * Format task duration for display
 */
export function formatTaskDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '-';

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const durationMs = end - start;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get priority sort weight (higher = more important)
 */
export function getPrioritySortWeight(priority: TaskPriority): number {
  const weights: Record<TaskPriority, number> = {
    critical: 4,
    high: 3,
    normal: 2,
    low: 1,
  };
  return weights[priority];
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for TaskStatus
 */
export function isTaskStatus(value: string): value is TaskStatus {
  return ['pending', 'queued', 'in_progress', 'paused', 'completed', 'failed', 'cancelled'].includes(value);
}

/**
 * Type guard for TaskPriority
 */
export function isTaskPriority(value: string): value is TaskPriority {
  return ['low', 'normal', 'high', 'critical'].includes(value);
}

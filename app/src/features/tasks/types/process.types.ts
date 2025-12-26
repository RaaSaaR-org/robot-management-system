/**
 * @file process.types.ts
 * @description Type definitions for process entities, steps, and store
 * @feature tasks
 *
 * Note: "Process" is the user-facing term for workflows with steps.
 * This is distinct from A2A Tasks which are internal protocol-level tasks.
 */

// ============================================================================
// STATUS TYPES
// ============================================================================

/** Process execution status */
export type ProcessStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Process priority levels */
export type ProcessPriority = 'low' | 'normal' | 'high' | 'critical';

/** Process step status */
export type ProcessStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

/** Process action commands */
export type ProcessAction = 'pause' | 'resume' | 'cancel' | 'retry';

// ============================================================================
// PROCESS STEP ENTITY
// ============================================================================

/** Individual step within a process */
export interface ProcessStep {
  id: string;
  name: string;
  description?: string;
  status: ProcessStepStatus;
  order: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// PROCESS ENTITY
// ============================================================================

/** Core process entity */
export interface Process {
  id: string;
  name: string;
  description?: string;
  robotId: string;
  robotName?: string;
  status: ProcessStatus;
  priority: ProcessPriority;
  steps: ProcessStep[];
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
// CREATE PROCESS TYPES
// ============================================================================

/** Process step for creation (without id and status) */
export interface CreateProcessStep {
  name: string;
  description?: string;
}

/** Process creation request */
export interface CreateProcessRequest {
  name: string;
  description?: string;
  robotId: string;
  priority?: ProcessPriority;
  steps?: CreateProcessStep[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// FILTER & PAGINATION TYPES
// ============================================================================

/** Process list filter parameters */
export interface ProcessFilters {
  status?: ProcessStatus | ProcessStatus[];
  priority?: ProcessPriority | ProcessPriority[];
  robotId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Pagination parameters */
export interface ProcessPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/** Parameters for listing processes */
export interface ProcessListParams {
  status?: ProcessStatus | ProcessStatus[];
  priority?: ProcessPriority | ProcessPriority[];
  robotId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: keyof Process;
  sortOrder?: 'asc' | 'desc';
}

/** Response for process list endpoint */
export interface ProcessListResponse {
  /** List of processes (named 'tasks' for API compatibility) */
  tasks: Process[];
  pagination: ProcessPagination;
}

/** Request for process action */
export interface ProcessActionRequest {
  action: ProcessAction;
}

/** Response for process action */
export interface ProcessActionResponse {
  /** The affected process (named 'task' for API compatibility) */
  task: Process;
  message: string;
}

// ============================================================================
// STORE TYPES
// ============================================================================

/** Processes store state */
export interface ProcessesState {
  /** List of processes (named 'tasks' for API/store compatibility) */
  tasks: Process[];
  /** Currently selected process ID (named 'selectedTaskId' for compatibility) */
  selectedTaskId: string | null;
  /** Current filters */
  filters: ProcessFilters;
  /** Pagination state */
  pagination: ProcessPagination;
  /** Loading state */
  isLoading: boolean;
  /** Action execution state */
  isExecuting: boolean;
  /** Error message */
  error: string | null;
  /** Individual process detail (named 'taskDetail' for compatibility) */
  taskDetail: Process | null;
}

/** Processes store actions */
export interface ProcessesActions {
  /** Fetch processes with current filters */
  fetchTasks: () => Promise<void>;
  /** Fetch a single process by ID */
  fetchTask: (id: string) => Promise<void>;
  /** Create a new process */
  createTask: (data: CreateProcessRequest) => Promise<Process>;
  /** Select a process */
  selectTask: (id: string | null) => void;
  /** Update filters */
  setFilters: (filters: Partial<ProcessFilters>) => void;
  /** Clear all filters */
  clearFilters: () => void;
  /** Set page number */
  setPage: (page: number) => void;
  /** Pause a process */
  pauseTask: (id: string) => Promise<Process>;
  /** Resume a paused process */
  resumeTask: (id: string) => Promise<Process>;
  /** Cancel a process */
  cancelTask: (id: string) => Promise<Process>;
  /** Retry a failed process */
  retryTask: (id: string) => Promise<Process>;
  /** Update process status (for WebSocket updates) */
  updateTaskStatus: (taskId: string, status: ProcessStatus) => void;
  /** Update process data (for WebSocket updates) */
  updateTask: (task: Partial<Process> & { id: string }) => void;
  /** Clear error */
  clearError: () => void;
  /** Reset store to initial state */
  reset: () => void;
}

/** Combined processes store type */
export type ProcessesStore = ProcessesState & ProcessesActions;

// ============================================================================
// ERROR TYPES
// ============================================================================

/** Process-related error codes (using TASK_* naming for API compatibility) */
export type ProcessErrorCode =
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

/** Process error */
export interface ProcessError {
  code: ProcessErrorCode;
  message: string;
  processId?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Status display labels */
export const PROCESS_STATUS_LABELS: Record<ProcessStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  in_progress: 'In Progress',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Status colors for UI (maps to Badge variants) */
export const PROCESS_STATUS_COLORS: Record<ProcessStatus, 'success' | 'default' | 'info' | 'error' | 'warning'> = {
  pending: 'default',
  queued: 'info',
  in_progress: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

/** Priority display labels */
export const PROCESS_PRIORITY_LABELS: Record<ProcessPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

/** Priority colors for UI */
export const PROCESS_PRIORITY_COLORS: Record<ProcessPriority, 'success' | 'default' | 'info' | 'error' | 'warning'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  critical: 'error',
};

/** Step status display labels */
export const PROCESS_STEP_STATUS_LABELS: Record<ProcessStepStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Default pagination */
export const DEFAULT_PROCESS_PAGINATION: ProcessPagination = {
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

/** Default filters */
export const DEFAULT_PROCESS_FILTERS: ProcessFilters = {};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a process is currently active (running or paused)
 */
export function isProcessActive(process: Process): boolean {
  return process.status === 'in_progress' || process.status === 'paused' || process.status === 'queued';
}

/**
 * Check if a process can be paused
 */
export function isProcessPauseable(process: Process): boolean {
  return process.status === 'in_progress';
}

/**
 * Check if a process can be resumed
 */
export function isProcessResumeable(process: Process): boolean {
  return process.status === 'paused';
}

/**
 * Check if a process can be cancelled
 */
export function isProcessCancellable(process: Process): boolean {
  return process.status === 'pending' || process.status === 'queued' || process.status === 'in_progress' || process.status === 'paused';
}

/**
 * Check if a process can be retried
 */
export function isProcessRetryable(process: Process): boolean {
  return process.status === 'failed' || process.status === 'cancelled';
}

/**
 * Check if a process has ended (completed, failed, or cancelled)
 */
export function isProcessEnded(process: Process): boolean {
  return process.status === 'completed' || process.status === 'failed' || process.status === 'cancelled';
}

/**
 * Calculate process progress from steps
 */
export function calculateProcessProgress(steps: ProcessStep[]): number {
  if (steps.length === 0) return 0;
  const completedSteps = steps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped'
  ).length;
  return Math.round((completedSteps / steps.length) * 100);
}

/**
 * Get the current step index from process steps
 */
export function getCurrentStepIndex(steps: ProcessStep[]): number {
  const inProgressIndex = steps.findIndex((step) => step.status === 'in_progress');
  if (inProgressIndex !== -1) return inProgressIndex;

  const pendingIndex = steps.findIndex((step) => step.status === 'pending');
  if (pendingIndex !== -1) return pendingIndex;

  return steps.length - 1;
}

/**
 * Format process duration for display
 */
export function formatProcessDuration(startedAt?: string, completedAt?: string): string {
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
export function getPrioritySortWeight(priority: ProcessPriority): number {
  const weights: Record<ProcessPriority, number> = {
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
 * Type guard for ProcessStatus
 */
export function isProcessStatus(value: string): value is ProcessStatus {
  return ['pending', 'queued', 'in_progress', 'paused', 'completed', 'failed', 'cancelled'].includes(value);
}

/**
 * Type guard for ProcessPriority
 */
export function isProcessPriority(value: string): value is ProcessPriority {
  return ['low', 'normal', 'high', 'critical'].includes(value);
}

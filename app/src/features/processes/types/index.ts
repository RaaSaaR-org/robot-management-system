/**
 * @file index.ts
 * @description Barrel export for processes types
 * @feature processes
 *
 * Note: "Process" is the user-facing term. The folder is still named "tasks"
 * for backwards compatibility, but all types use "Process" naming.
 */

// Primary exports - Process terminology
export * from './process.types';

// Legacy aliases for backwards compatibility during migration
// These map old Task* names to new Process* names
export {
  type Process as Task,
  type ProcessStatus as TaskStatus,
  type ProcessPriority as TaskPriority,
  type ProcessStep as TaskStep,
  type ProcessStepStatus as TaskStepStatus,
  type ProcessAction as TaskAction,
  type CreateProcessRequest as CreateTaskRequest,
  type CreateProcessStep as CreateTaskStep,
  type ProcessFilters as TaskFilters,
  type ProcessPagination as TaskPagination,
  type ProcessListParams as TaskListParams,
  type ProcessListResponse as TaskListResponse,
  type ProcessActionRequest as TaskActionRequest,
  type ProcessActionResponse as TaskActionResponse,
  type ProcessesState as TasksState,
  type ProcessesActions as TasksActions,
  type ProcessesStore as TasksStore,
  type ProcessErrorCode as TaskErrorCode,
  type ProcessError as TaskError,
  // Utility functions
  isProcessActive as isTaskActive,
  isProcessPauseable as isTaskPauseable,
  isProcessResumeable as isTaskResumeable,
  isProcessCancellable as isTaskCancellable,
  isProcessRetryable as isTaskRetryable,
  isProcessEnded as isTaskEnded,
  calculateProcessProgress as calculateTaskProgress,
  formatProcessDuration as formatTaskDuration,
  getPrioritySortWeight,
  isProcessStatus as isTaskStatus,
  isProcessPriority as isTaskPriority,
  // Constants
  PROCESS_STATUS_LABELS as TASK_STATUS_LABELS,
  PROCESS_STATUS_COLORS as TASK_STATUS_COLORS,
  PROCESS_PRIORITY_LABELS as TASK_PRIORITY_LABELS,
  PROCESS_PRIORITY_COLORS as TASK_PRIORITY_COLORS,
  PROCESS_STEP_STATUS_LABELS as TASK_STEP_STATUS_LABELS,
  DEFAULT_PROCESS_PAGINATION as DEFAULT_TASK_PAGINATION,
  DEFAULT_PROCESS_FILTERS as DEFAULT_TASK_FILTERS,
} from './process.types';

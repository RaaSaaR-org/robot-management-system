/**
 * @file index.ts
 * @description Barrel export for tasks/processes store
 * @feature processes
 */

export * from './tasksStore';

// Process store alias (user-facing terminology)
export { useTasksStore as useProcessesStore } from './tasksStore';

// Selector aliases
export {
  selectTasks as selectProcesses,
  selectSelectedTaskId as selectSelectedProcessId,
  selectTaskDetail as selectProcessDetail,
  selectFilters as selectProcessFilters,
  selectPagination as selectProcessPagination,
  selectIsLoading as selectProcessIsLoading,
  selectIsExecuting as selectProcessIsExecuting,
  selectError as selectProcessError,
  selectTaskById as selectProcessById,
  selectTasksByStatus as selectProcessesByStatus,
  selectTasksByRobotId as selectProcessesByRobotId,
  selectActiveTasks as selectActiveProcesses,
  selectPendingTasks as selectPendingProcesses,
  selectInProgressTasks as selectInProgressProcesses,
  selectSelectedTask as selectSelectedProcess,
} from './tasksStore';

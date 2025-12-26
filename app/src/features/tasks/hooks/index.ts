/**
 * @file index.ts
 * @description Barrel export for tasks/processes hooks
 * @feature tasks
 */

export * from './useTasks';

// Process hook aliases (user-facing terminology)
export {
  useTasks as useProcesses,
  useTask as useProcess,
  useTaskList as useProcessList,
  useTaskQueue as useProcessQueue,
  useTaskActions as useProcessActions,
  useTaskById as useProcessById,
  useTasksByRobotId as useProcessesByRobotId,
  useTasksByStatus as useProcessesByStatus,
  useActiveTasks as useActiveProcesses,
} from './useTasks';

// Type aliases
export type {
  UseTasksReturn as UseProcessesReturn,
  UseTaskReturn as UseProcessReturn,
  UseTaskListReturn as UseProcessListReturn,
  UseTaskQueueReturn as UseProcessQueueReturn,
  UseTaskActionsReturn as UseProcessActionsReturn,
} from './useTasks';

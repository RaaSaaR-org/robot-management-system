/**
 * @file index.ts
 * @description Barrel export for command feature
 * @feature command
 */

// Types
export * from './types';

// API
export { commandApi } from './api';

// Store
export {
  useCommandStore,
  selectCurrentText,
  selectInterpretation,
  selectIsInterpreting,
  selectIsExecuting,
  selectHistory,
  selectIsLoadingHistory,
  selectError,
  selectCanExecute,
  selectHistoryByRobotId,
} from './store';

// Hooks
export { useCommand, useCommandHistory, useRobotCommandHistory } from './hooks';
export type {
  UseCommandReturn,
  UseCommandHistoryReturn,
  UseRobotCommandHistoryReturn,
} from './hooks';

// Components
export {
  CommandBar,
  CommandPreview,
  CommandConfirmation,
  CommandHistory,
} from './components';
export type {
  CommandBarProps,
  CommandPreviewProps,
  CommandConfirmationProps,
  CommandHistoryProps,
} from './components';

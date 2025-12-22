/**
 * @file useCommand.ts
 * @description React hooks for natural language command operations
 * @feature command
 * @dependencies @/features/command/store, @/features/command/types
 * @stateAccess useCommandStore (read/write)
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useCommandStore,
  selectCurrentText,
  selectInterpretation,
  selectIsInterpreting,
  selectIsExecuting,
  selectHistory,
  selectIsLoadingHistory,
  selectError,
  selectCanExecute,
} from '../store/commandStore';
import type {
  CommandInterpretation,
  CommandHistoryEntry,
  InterpretCommandRequest,
} from '../types/command.types';
import type { RobotCommand } from '@/features/robots/types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseCommandReturn {
  /** Current input text */
  currentText: string;
  /** Current VLA interpretation */
  interpretation: CommandInterpretation | null;
  /** Whether interpretation is in progress */
  isInterpreting: boolean;
  /** Whether command execution is in progress */
  isExecuting: boolean;
  /** Whether there's a valid interpretation ready to execute */
  canExecute: boolean;
  /** Error message */
  error: string | null;
  /** Set the current input text */
  setCurrentText: (text: string) => void;
  /** Interpret the current text for a robot */
  interpretCommand: (robotId: string) => Promise<void>;
  /** Execute the current interpretation on a robot */
  executeCommand: (robotId: string) => Promise<RobotCommand>;
  /** Clear the current interpretation */
  clearInterpretation: () => void;
  /** Clear error */
  clearError: () => void;
}

export interface UseCommandHistoryReturn {
  /** Command history entries */
  history: CommandHistoryEntry[];
  /** Whether history is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh history */
  refresh: (robotId?: string) => Promise<void>;
}

export interface UseRobotCommandHistoryReturn {
  /** Command history for specific robot */
  history: CommandHistoryEntry[];
  /** Whether history is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh history for this robot */
  refresh: () => Promise<void>;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for natural language command input and interpretation.
 *
 * @example
 * ```tsx
 * function CommandInput({ robotId }: { robotId: string }) {
 *   const {
 *     currentText,
 *     setCurrentText,
 *     interpretation,
 *     interpretCommand,
 *     executeCommand,
 *     isInterpreting,
 *     canExecute,
 *   } = useCommand();
 *
 *   const handleSubmit = async () => {
 *     await interpretCommand(robotId);
 *   };
 *
 *   const handleExecute = async () => {
 *     await executeCommand(robotId);
 *   };
 *
 *   return (
 *     <div>
 *       <input value={currentText} onChange={(e) => setCurrentText(e.target.value)} />
 *       <button onClick={handleSubmit} disabled={isInterpreting}>
 *         Interpret
 *       </button>
 *       {interpretation && <CommandPreview interpretation={interpretation} />}
 *       {canExecute && <button onClick={handleExecute}>Execute</button>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCommand(): UseCommandReturn {
  const currentText = useCommandStore(selectCurrentText);
  const interpretation = useCommandStore(selectInterpretation);
  const isInterpreting = useCommandStore(selectIsInterpreting);
  const isExecuting = useCommandStore(selectIsExecuting);
  const canExecute = useCommandStore(selectCanExecute);
  const error = useCommandStore(selectError);

  const storeSetCurrentText = useCommandStore((state) => state.setCurrentText);
  const storeInterpretCommand = useCommandStore((state) => state.interpretCommand);
  const storeExecuteCommand = useCommandStore((state) => state.executeCommand);
  const storeClearInterpretation = useCommandStore((state) => state.clearInterpretation);
  const storeClearError = useCommandStore((state) => state.clearError);

  const setCurrentText = useCallback(
    (text: string) => {
      storeSetCurrentText(text);
    },
    [storeSetCurrentText]
  );

  const interpretCommand = useCallback(
    async (robotId: string) => {
      if (!currentText.trim()) return;

      const request: InterpretCommandRequest = {
        text: currentText,
        robotId,
      };

      await storeInterpretCommand(request);
    },
    [currentText, storeInterpretCommand]
  );

  const executeCommand = useCallback(
    async (robotId: string) => {
      return storeExecuteCommand(robotId);
    },
    [storeExecuteCommand]
  );

  const clearInterpretation = useCallback(() => {
    storeClearInterpretation();
  }, [storeClearInterpretation]);

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  return useMemo(
    () => ({
      currentText,
      interpretation,
      isInterpreting,
      isExecuting,
      canExecute,
      error,
      setCurrentText,
      interpretCommand,
      executeCommand,
      clearInterpretation,
      clearError,
    }),
    [
      currentText,
      interpretation,
      isInterpreting,
      isExecuting,
      canExecute,
      error,
      setCurrentText,
      interpretCommand,
      executeCommand,
      clearInterpretation,
      clearError,
    ]
  );
}

// ============================================================================
// HISTORY HOOK
// ============================================================================

/**
 * Hook for accessing command history.
 *
 * @example
 * ```tsx
 * function CommandHistoryPanel() {
 *   const { history, isLoading, refresh } = useCommandHistory();
 *
 *   useEffect(() => {
 *     refresh();
 *   }, [refresh]);
 *
 *   return (
 *     <div>
 *       {history.map((entry) => (
 *         <CommandHistoryItem key={entry.id} entry={entry} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCommandHistory(): UseCommandHistoryReturn {
  const history = useCommandStore(selectHistory);
  const isLoading = useCommandStore(selectIsLoadingHistory);
  const error = useCommandStore(selectError);

  const storeFetchHistory = useCommandStore((state) => state.fetchHistory);

  const refresh = useCallback(
    async (robotId?: string) => {
      await storeFetchHistory({ robotId });
    },
    [storeFetchHistory]
  );

  return useMemo(
    () => ({
      history,
      isLoading,
      error,
      refresh,
    }),
    [history, isLoading, error, refresh]
  );
}

// ============================================================================
// ROBOT-SPECIFIC HISTORY HOOK
// ============================================================================

/**
 * Hook for accessing command history for a specific robot.
 * Automatically fetches history on mount.
 *
 * @param robotId - Robot ID to filter history by
 *
 * @example
 * ```tsx
 * function RobotCommandHistory({ robotId }: { robotId: string }) {
 *   const { history, isLoading } = useRobotCommandHistory(robotId);
 *
 *   return (
 *     <div>
 *       <h3>Recent Commands</h3>
 *       {history.map((entry) => (
 *         <div key={entry.id}>{entry.originalText}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useRobotCommandHistory(robotId: string): UseRobotCommandHistoryReturn {
  const allHistory = useCommandStore(selectHistory);
  const history = useMemo(
    () => allHistory.filter((entry) => entry.robotId === robotId),
    [allHistory, robotId]
  );
  const isLoading = useCommandStore(selectIsLoadingHistory);
  const error = useCommandStore(selectError);

  const storeFetchHistory = useCommandStore((state) => state.fetchHistory);

  const refresh = useCallback(async () => {
    await storeFetchHistory({ robotId });
  }, [robotId, storeFetchHistory]);

  // Fetch history on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      history,
      isLoading,
      error,
      refresh,
    }),
    [history, isLoading, error, refresh]
  );
}

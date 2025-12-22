/**
 * @file commandStore.ts
 * @description Zustand store for natural language command state management
 * @feature command
 * @dependencies zustand, immer, @/features/command/types, @/features/command/api
 * @stateAccess useCommandStore (read/write)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  CommandState,
  CommandStore,
  CommandInterpretation,
  CommandHistoryEntry,
  InterpretCommandRequest,
} from '../types/command.types';
import { commandApi } from '../api/commandApi';
import type { RobotCommand } from '@/features/robots/types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: CommandState = {
  currentText: '',
  interpretation: null,
  isInterpreting: false,
  isExecuting: false,
  history: [],
  isLoadingHistory: false,
  error: null,
};

// ============================================================================
// STORE
// ============================================================================

export const useCommandStore = create<CommandStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // --------------------------------------------------------------------
      // TEXT INPUT
      // --------------------------------------------------------------------

      setCurrentText: (text: string) => {
        set((state) => {
          state.currentText = text;
          // Clear interpretation when text changes significantly
          if (state.interpretation && text !== state.interpretation.originalText) {
            state.interpretation = null;
          }
        });
      },

      // --------------------------------------------------------------------
      // INTERPRETATION
      // --------------------------------------------------------------------

      interpretCommand: async (request: InterpretCommandRequest) => {
        set((state) => {
          state.isInterpreting = true;
          state.error = null;
        });

        try {
          const interpretation = await commandApi.interpretCommand(request);

          set((state) => {
            state.interpretation = interpretation;
            state.isInterpreting = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to interpret command';
          set((state) => {
            state.error = message;
            state.isInterpreting = false;
          });
          throw error;
        }
      },

      clearInterpretation: () => {
        set((state) => {
          state.interpretation = null;
          state.error = null;
        });
      },

      // --------------------------------------------------------------------
      // EXECUTION
      // --------------------------------------------------------------------

      executeCommand: async (robotId: string): Promise<RobotCommand> => {
        const { interpretation } = get();

        if (!interpretation) {
          throw new Error('No interpretation to execute');
        }

        set((state) => {
          state.isExecuting = true;
          state.error = null;
        });

        try {
          const command = await commandApi.executeCommand(robotId, interpretation);

          // Clear state after successful execution
          set((state) => {
            state.currentText = '';
            state.interpretation = null;
            state.isExecuting = false;
          });

          return command;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to execute command';
          set((state) => {
            state.error = message;
            state.isExecuting = false;
          });
          throw error;
        }
      },

      // --------------------------------------------------------------------
      // HISTORY
      // --------------------------------------------------------------------

      fetchHistory: async (params?: { page?: number; pageSize?: number; robotId?: string }) => {
        set((state) => {
          state.isLoadingHistory = true;
          state.error = null;
        });

        try {
          const response = await commandApi.getHistory(params);

          set((state) => {
            state.history = response.entries;
            state.isLoadingHistory = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch history';
          set((state) => {
            state.error = message;
            state.isLoadingHistory = false;
          });
          throw error;
        }
      },

      addToHistory: (entry: CommandHistoryEntry) => {
        set((state) => {
          state.history = [entry, ...state.history];
        });
      },

      // --------------------------------------------------------------------
      // UTILITY
      // --------------------------------------------------------------------

      clearError: () => {
        set((state) => {
          state.error = null;
        });
      },

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    { name: 'command-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select current input text */
export const selectCurrentText = (state: CommandStore): string => state.currentText;

/** Select current interpretation */
export const selectInterpretation = (state: CommandStore): CommandInterpretation | null =>
  state.interpretation;

/** Select interpreting state */
export const selectIsInterpreting = (state: CommandStore): boolean => state.isInterpreting;

/** Select executing state */
export const selectIsExecuting = (state: CommandStore): boolean => state.isExecuting;

/** Select command history */
export const selectHistory = (state: CommandStore): CommandHistoryEntry[] => state.history;

/** Select history loading state */
export const selectIsLoadingHistory = (state: CommandStore): boolean => state.isLoadingHistory;

/** Select error message */
export const selectError = (state: CommandStore): string | null => state.error;

/** Select whether there's a valid interpretation ready to execute */
export const selectCanExecute = (state: CommandStore): boolean =>
  state.interpretation !== null && !state.isInterpreting && !state.isExecuting;

/** Select history for a specific robot */
export const selectHistoryByRobotId =
  (robotId: string) =>
  (state: CommandStore): CommandHistoryEntry[] =>
    state.history.filter((entry) => entry.robotId === robotId);

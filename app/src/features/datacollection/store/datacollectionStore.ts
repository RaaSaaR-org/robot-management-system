/**
 * @file datacollectionStore.ts
 * @description Zustand store for data collection state management
 * @feature datacollection
 * @dependencies @/store, @/features/datacollection/api, @/features/datacollection/types
 * @stateAccess Creates: useDataCollectionStore
 */

import { createStore } from '@/store';
import { datacollectionApi } from '../api/datacollectionApi';
import { DEFAULT_SESSION_PAGINATION } from '../types/datacollection.types';
import type {
  DataCollectionStore,
  TeleoperationSession,
  UncertaintyAnalysis,
  CollectionPriority,
  CollectionTarget,
  QualityFeedback,
  SessionFilters,
  SessionPagination,
  DataCollectionErrorCode,
  CreateSessionRequest,
  ExportSessionRequest,
  ExportResultResponse,
  LogPredictionRequest,
  GetUncertaintyParams,
  GetPrioritiesParams,
} from '../types/datacollection.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  // Teleoperation
  sessions: [] as TeleoperationSession[],
  selectedSession: null as TeleoperationSession | null,
  activeSession: null as TeleoperationSession | null,
  qualityFeedback: null as QualityFeedback | null,
  sessionFilters: {} as SessionFilters,
  sessionPagination: { ...DEFAULT_SESSION_PAGINATION } as SessionPagination,
  // Active Learning
  uncertaintyAnalysis: null as UncertaintyAnalysis | null,
  collectionPriorities: [] as CollectionPriority[],
  collectionTargets: [] as CollectionTarget[],
  // UI State
  isLoading: false,
  error: null as string | null,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const ERROR_MESSAGES: Record<DataCollectionErrorCode, string> = {
  SESSION_NOT_FOUND: 'Session not found',
  SESSION_ALREADY_STARTED: 'Session has already been started',
  SESSION_NOT_RECORDING: 'Session is not currently recording',
  ROBOT_NOT_AVAILABLE: 'Robot is not available for teleoperation',
  EXPORT_FAILED: 'Failed to export session',
  NETWORK_ERROR: 'Unable to connect to the server',
  UNKNOWN_ERROR: 'An unexpected error occurred',
};

// ============================================================================
// STORE
// ============================================================================

export const useDataCollectionStore = createStore<DataCollectionStore>(
  (set, get) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Fetch Sessions
    // --------------------------------------------------------------------------
    fetchSessions: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const { sessionFilters, sessionPagination } = get();
        const response = await datacollectionApi.listSessions({
          ...sessionFilters,
          page: sessionPagination.page,
          limit: sessionPagination.limit,
        });

        set((state) => {
          state.sessions = response.sessions;
          state.sessionPagination = response.pagination;
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
    // Fetch Single Session
    // --------------------------------------------------------------------------
    fetchSession: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const session = await datacollectionApi.getSession(id);

        set((state) => {
          state.selectedSession = session;
          state.isLoading = false;
          // Update in list if present
          const index = state.sessions.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.sessions[index] = session;
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
    // Create Session
    // --------------------------------------------------------------------------
    createSession: async (data: CreateSessionRequest) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const session = await datacollectionApi.createSession(data);

        set((state) => {
          state.sessions.unshift(session);
          state.selectedSession = session;
          state.isLoading = false;
        });

        return session;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Start Session
    // --------------------------------------------------------------------------
    startSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.startSession(id);

        set((state) => {
          state.activeSession = session;
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Pause Session
    // --------------------------------------------------------------------------
    pauseSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.pauseSession(id);

        set((state) => {
          if (state.activeSession?.id === id) {
            state.activeSession = session;
          }
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Resume Session
    // --------------------------------------------------------------------------
    resumeSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.resumeSession(id);

        set((state) => {
          state.activeSession = session;
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // End Session
    // --------------------------------------------------------------------------
    endSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.endSession(id);

        set((state) => {
          if (state.activeSession?.id === id) {
            state.activeSession = null;
          }
          state.selectedSession = session;
          state.qualityFeedback = null;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Annotate Session
    // --------------------------------------------------------------------------
    annotateSession: async (id: string, languageInstr: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.annotateSession(id, { languageInstr });

        set((state) => {
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Export Session
    // --------------------------------------------------------------------------
    exportSession: async (
      id: string,
      data: ExportSessionRequest
    ): Promise<ExportResultResponse> => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const result = await datacollectionApi.exportSession(id, data);

        // Refresh session to get updated exportedDatasetId
        const session = await datacollectionApi.getSession(id);

        set((state) => {
          state.selectedSession = session;
          state.isLoading = false;
          updateSessionInList(state, session);
        });

        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Select Session
    // --------------------------------------------------------------------------
    selectSession: (session: TeleoperationSession | null) => {
      set((state) => {
        state.selectedSession = session;
      });
    },

    // --------------------------------------------------------------------------
    // Set Active Session
    // --------------------------------------------------------------------------
    setActiveSession: (session: TeleoperationSession | null) => {
      set((state) => {
        state.activeSession = session;
      });
    },

    // --------------------------------------------------------------------------
    // Set Quality Feedback
    // --------------------------------------------------------------------------
    setQualityFeedback: (feedback: QualityFeedback | null) => {
      set((state) => {
        state.qualityFeedback = feedback;
      });
    },

    // --------------------------------------------------------------------------
    // Set Session Filters
    // --------------------------------------------------------------------------
    setSessionFilters: (filters: Partial<SessionFilters>) => {
      set((state) => {
        state.sessionFilters = { ...state.sessionFilters, ...filters };
        state.sessionPagination.page = 1;
      });
      get().fetchSessions();
    },

    // --------------------------------------------------------------------------
    // Clear Session Filters
    // --------------------------------------------------------------------------
    clearSessionFilters: () => {
      set((state) => {
        state.sessionFilters = {};
        state.sessionPagination.page = 1;
      });
      get().fetchSessions();
    },

    // --------------------------------------------------------------------------
    // Set Session Page
    // --------------------------------------------------------------------------
    setSessionPage: (page: number) => {
      set((state) => {
        state.sessionPagination.page = page;
      });
      get().fetchSessions();
    },

    // --------------------------------------------------------------------------
    // Fetch Uncertainty
    // --------------------------------------------------------------------------
    fetchUncertainty: async (params: GetUncertaintyParams) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const analysis = await datacollectionApi.getUncertainty(params);

        set((state) => {
          state.uncertaintyAnalysis = analysis;
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
    // Fetch Priorities
    // --------------------------------------------------------------------------
    fetchPriorities: async (params?: GetPrioritiesParams) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await datacollectionApi.getPriorities(params);

        set((state) => {
          state.collectionPriorities = response.priorities;
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
    // Log Prediction
    // --------------------------------------------------------------------------
    logPrediction: async (data: LogPredictionRequest) => {
      try {
        await datacollectionApi.logPrediction(data);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
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
    name: 'DataCollectionStore',
    persist: false,
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function updateSessionInList(
  state: DataCollectionStore,
  session: TeleoperationSession
) {
  const index = state.sessions.findIndex((s) => s.id === session.id);
  if (index !== -1) {
    state.sessions[index] = session;
  }
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('code' in error && typeof error.code === 'string') {
      const code = error.code as DataCollectionErrorCode;
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if ('response' in error) {
      const response = error.response as { data?: { message?: string } };
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

// ============================================================================
// SELECTORS
// ============================================================================

export const selectSessions = (state: DataCollectionStore) => state.sessions;
export const selectSelectedSession = (state: DataCollectionStore) => state.selectedSession;
export const selectActiveSession = (state: DataCollectionStore) => state.activeSession;
export const selectQualityFeedback = (state: DataCollectionStore) => state.qualityFeedback;
export const selectSessionFilters = (state: DataCollectionStore) => state.sessionFilters;
export const selectSessionPagination = (state: DataCollectionStore) => state.sessionPagination;
export const selectUncertaintyAnalysis = (state: DataCollectionStore) => state.uncertaintyAnalysis;
export const selectCollectionPriorities = (state: DataCollectionStore) => state.collectionPriorities;
export const selectCollectionTargets = (state: DataCollectionStore) => state.collectionTargets;
export const selectIsLoading = (state: DataCollectionStore) => state.isLoading;
export const selectError = (state: DataCollectionStore) => state.error;

export const selectSessionById = (id: string) => (state: DataCollectionStore) =>
  state.sessions.find((s) => s.id === id) ?? null;

export const selectHighPriorityTargets = (state: DataCollectionStore) =>
  state.collectionPriorities.filter((p) => p.priorityScore >= 0.6);

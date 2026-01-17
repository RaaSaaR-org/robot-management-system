/**
 * @file fleetlearningStore.ts
 * @description Zustand store for fleet learning (federated learning) state management
 * @feature fleetlearning
 * @dependencies zustand, fleetlearningApi
 */

import { createStore } from '@/store';
import { fleetlearningApi } from '../api/fleetlearningApi';
import type {
  FederatedRound,
  RoundFilters,
  FleetLearningState,
  FleetLearningStore,
  CreateFederatedRoundRequest,
  GetROHEParams,
} from '../types/fleetlearning.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: FleetLearningState = {
  rounds: [],
  selectedRound: null,
  participants: [],
  privacyBudgets: [],
  roheMetrics: null,
  convergenceData: [],
  filters: {},
  pagination: {
    limit: 20,
    offset: 0,
    total: 0,
  },
  isLoading: false,
  error: null,
};

// ============================================================================
// STORE
// ============================================================================

export const useFleetLearningStore = createStore<FleetLearningStore>(
  (set, get) => ({
    ...initialState,

    // ========================================================================
    // ROUNDS ACTIONS
    // ========================================================================

    fetchRounds: async () => {
      const { filters, pagination } = get();
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const response = await fleetlearningApi.listRounds({
          status: filters.status,
          globalModelVersion: filters.globalModelVersion,
          limit: pagination.limit,
          offset: pagination.offset,
        });
        set((state) => {
          state.rounds = response.rounds;
          state.pagination.total = response.total;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch rounds';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    fetchRound: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const response = await fleetlearningApi.getRound(id);
        set((state) => {
          state.selectedRound = response.round;
          state.participants = response.participants;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch round';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    createRound: async (data: CreateFederatedRoundRequest) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const round = await fleetlearningApi.createRound(data);
        set((state) => {
          state.rounds = [round, ...state.rounds];
          state.isLoading = false;
        });
        return round;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create round';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
        throw error;
      }
    },

    startRound: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const round = await fleetlearningApi.startRound(id);
        set((state) => {
          state.rounds = state.rounds.map((r) => (r.id === id ? round : r));
          if (state.selectedRound?.id === id) {
            state.selectedRound = round;
          }
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start round';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
        throw error;
      }
    },

    cancelRound: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const round = await fleetlearningApi.cancelRound(id);
        set((state) => {
          state.rounds = state.rounds.map((r) => (r.id === id ? round : r));
          if (state.selectedRound?.id === id) {
            state.selectedRound = round;
          }
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel round';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
        throw error;
      }
    },

    selectRound: (round: FederatedRound | null) => {
      set((state) => {
        state.selectedRound = round;
        state.participants = [];
      });
    },

    // ========================================================================
    // PARTICIPANTS ACTIONS
    // ========================================================================

    fetchParticipants: async (roundId: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const participants = await fleetlearningApi.getParticipants(roundId);
        set((state) => {
          state.participants = participants;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch participants';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    // ========================================================================
    // PRIVACY ACTIONS
    // ========================================================================

    fetchPrivacyBudgets: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const response = await fleetlearningApi.listPrivacyBudgets();
        set((state) => {
          state.privacyBudgets = response.budgets;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch privacy budgets';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    // ========================================================================
    // ROHE ACTIONS
    // ========================================================================

    fetchROHEMetrics: async (params?: GetROHEParams) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const metrics = await fleetlearningApi.getROHEMetrics(params);
        set((state) => {
          state.roheMetrics = metrics;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch ROHE metrics';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    // ========================================================================
    // CONVERGENCE ACTIONS
    // ========================================================================

    fetchConvergenceData: async (modelVersion?: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const data = await fleetlearningApi.getConvergenceData(modelVersion);
        set((state) => {
          state.convergenceData = data;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch convergence data';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    // ========================================================================
    // FILTER ACTIONS
    // ========================================================================

    setFilters: (filters: Partial<RoundFilters>) => {
      set((state) => {
        state.filters = { ...state.filters, ...filters };
        state.pagination.offset = 0;
      });
    },

    clearFilters: () => {
      set((state) => {
        state.filters = {};
        state.pagination.offset = 0;
      });
    },

    setPage: (offset: number) => {
      set((state) => {
        state.pagination.offset = offset;
      });
    },

    // ========================================================================
    // ERROR HANDLING
    // ========================================================================

    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  {
    name: 'fleetlearning-store',
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectRounds = (state: FleetLearningStore) => state.rounds;
export const selectSelectedRound = (state: FleetLearningStore) => state.selectedRound;
export const selectParticipants = (state: FleetLearningStore) => state.participants;
export const selectPrivacyBudgets = (state: FleetLearningStore) => state.privacyBudgets;
export const selectROHEMetrics = (state: FleetLearningStore) => state.roheMetrics;
export const selectConvergenceData = (state: FleetLearningStore) => state.convergenceData;
export const selectFilters = (state: FleetLearningStore) => state.filters;
export const selectPagination = (state: FleetLearningStore) => state.pagination;
export const selectIsLoading = (state: FleetLearningStore) => state.isLoading;
export const selectError = (state: FleetLearningStore) => state.error;

/**
 * Select a round by ID
 */
export const selectRoundById = (id: string) => (state: FleetLearningStore) =>
  state.rounds.find((r) => r.id === id);

/**
 * Select active rounds (in progress)
 */
export const selectActiveRounds = (state: FleetLearningStore) =>
  state.rounds.filter((r) =>
    ['selecting', 'distributing', 'training', 'collecting', 'aggregating'].includes(r.status)
  );

/**
 * Select completed rounds
 */
export const selectCompletedRounds = (state: FleetLearningStore) =>
  state.rounds.filter((r) => r.status === 'completed');

/**
 * Select robots with low privacy budget
 */
export const selectLowPrivacyBudgetRobots = (threshold = 1.0) => (state: FleetLearningStore) =>
  state.privacyBudgets.filter((b) => b.remainingEpsilon < threshold);

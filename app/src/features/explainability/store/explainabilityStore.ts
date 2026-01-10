/**
 * @file explainabilityStore.ts
 * @description Zustand store for AI explainability state management
 * @feature explainability
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { explainabilityApi } from '../api';
import type {
  ExplainabilityStore,
  ExplainabilityState,
  DecisionType,
  MetricsPeriod,
} from '../types';

const initialState: ExplainabilityState = {
  decisions: [],
  selectedDecision: null,
  formattedExplanation: null,
  metrics: null,
  documentation: null,
  pagination: {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  },
  isLoading: false,
  isLoadingExplanation: false,
  isLoadingMetrics: false,
  isLoadingDocumentation: false,
  error: null,
};

export const useExplainabilityStore = create<ExplainabilityStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchDecisions: async (params?: {
        page?: number;
        robotId?: string;
        decisionType?: DecisionType;
      }) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const response = await explainabilityApi.getDecisions({
            page: params?.page ?? 1,
            pageSize: 20,
            robotId: params?.robotId,
            decisionType: params?.decisionType,
          });

          set((state) => {
            state.decisions = response.decisions;
            state.pagination = response.pagination;
            state.isLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch decisions';
          set((state) => {
            state.error = message;
            state.isLoading = false;
          });
        }
      },

      fetchDecision: async (id: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const decision = await explainabilityApi.getDecision(id);

          set((state) => {
            state.selectedDecision = decision;
            state.isLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch decision';
          set((state) => {
            state.error = message;
            state.isLoading = false;
          });
        }
      },

      fetchExplanation: async (id: string) => {
        set((state) => {
          state.isLoadingExplanation = true;
          state.error = null;
        });

        try {
          const explanation = await explainabilityApi.getExplanation(id);

          set((state) => {
            state.formattedExplanation = explanation;
            state.isLoadingExplanation = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch explanation';
          set((state) => {
            state.error = message;
            state.isLoadingExplanation = false;
          });
        }
      },

      fetchMetrics: async (period: MetricsPeriod = 'weekly', robotId?: string) => {
        set((state) => {
          state.isLoadingMetrics = true;
          state.error = null;
        });

        try {
          const metrics = await explainabilityApi.getMetrics(period, robotId);

          set((state) => {
            state.metrics = metrics;
            state.isLoadingMetrics = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch metrics';
          set((state) => {
            state.error = message;
            state.isLoadingMetrics = false;
          });
        }
      },

      fetchDocumentation: async () => {
        set((state) => {
          state.isLoadingDocumentation = true;
          state.error = null;
        });

        try {
          const documentation = await explainabilityApi.getDocumentation();

          set((state) => {
            state.documentation = documentation;
            state.isLoadingDocumentation = false;
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to fetch documentation';
          set((state) => {
            state.error = message;
            state.isLoadingDocumentation = false;
          });
        }
      },

      clearSelectedDecision: () => {
        set((state) => {
          state.selectedDecision = null;
          state.formattedExplanation = null;
        });
      },

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    { name: 'explainability-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectDecisions = (state: ExplainabilityStore) => state.decisions;
export const selectSelectedDecision = (state: ExplainabilityStore) => state.selectedDecision;
export const selectFormattedExplanation = (state: ExplainabilityStore) =>
  state.formattedExplanation;
export const selectMetrics = (state: ExplainabilityStore) => state.metrics;
export const selectDocumentation = (state: ExplainabilityStore) => state.documentation;
export const selectPagination = (state: ExplainabilityStore) => state.pagination;
export const selectIsLoading = (state: ExplainabilityStore) => state.isLoading;
export const selectIsLoadingExplanation = (state: ExplainabilityStore) =>
  state.isLoadingExplanation;
export const selectIsLoadingMetrics = (state: ExplainabilityStore) => state.isLoadingMetrics;
export const selectIsLoadingDocumentation = (state: ExplainabilityStore) =>
  state.isLoadingDocumentation;
export const selectError = (state: ExplainabilityStore) => state.error;

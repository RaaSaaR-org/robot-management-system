/**
 * @file contributionsStore.ts
 * @description Zustand store for contribution state management
 * @feature contributions
 * @dependencies @/store, @/features/contributions/api, @/features/contributions/types
 * @stateAccess Creates: useContributionsStore
 */

import { createStore } from '@/store';
import { contributionsApi } from '../api/contributionsApi';
import { DEFAULT_PAGINATION } from '../types/contributions.types';
import type {
  ContributionsStore,
  DataContribution,
  CreditBalance,
  ContributionCredit,
  ContributorStats,
  LeaderboardEntry,
  Reward,
  Redemption,
  ImpactSummary,
  ContributionFilters,
  ContributionPagination,
  ContributionErrorCode,
  InitiateContributionRequest,
  UploadContributionDataRequest,
  UploadContributionResponse,
  ListLeaderboardParams,
} from '../types/contributions.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  contributions: [] as DataContribution[],
  selectedContribution: null as DataContribution | null,
  creditBalance: null as CreditBalance | null,
  creditHistory: [] as ContributionCredit[],
  stats: null as ContributorStats | null,
  leaderboard: [] as LeaderboardEntry[],
  rewards: [] as Reward[],
  redemptions: [] as Redemption[],
  filters: {} as ContributionFilters,
  pagination: { ...DEFAULT_PAGINATION } as ContributionPagination,
  isLoading: false,
  error: null as string | null,
  wizardStep: 0,
  wizardData: {} as ContributionsStore['wizardData'],
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const ERROR_MESSAGES: Record<ContributionErrorCode, string> = {
  CONTRIBUTION_NOT_FOUND: 'Contribution not found',
  INVALID_STATUS: 'Invalid contribution status for this operation',
  INSUFFICIENT_CREDITS: 'Insufficient credits for this redemption',
  REWARD_NOT_AVAILABLE: 'This reward is not currently available',
  ALREADY_REDEEMED: 'You have already redeemed this reward',
  NETWORK_ERROR: 'Unable to connect to the server',
  UNKNOWN_ERROR: 'An unexpected error occurred',
};

// ============================================================================
// STORE
// ============================================================================

export const useContributionsStore = createStore<ContributionsStore>(
  (set, get) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Fetch Contributions
    // --------------------------------------------------------------------------
    fetchContributions: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const { filters, pagination } = get();
        const response = await contributionsApi.listContributions({
          status: filters.status,
          licenseType: filters.licenseType,
          limit: pagination.limit,
          offset: pagination.offset,
        });

        set((state) => {
          state.contributions = response.contributions;
          state.pagination.total = response.total;
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
    // Fetch Single Contribution
    // --------------------------------------------------------------------------
    fetchContribution: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const contribution = await contributionsApi.getContribution(id);

        set((state) => {
          state.selectedContribution = contribution;
          state.isLoading = false;
          // Update in list if present
          const index = state.contributions.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.contributions[index] = contribution;
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
    // Initiate Contribution
    // --------------------------------------------------------------------------
    initiateContribution: async (data: InitiateContributionRequest) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const contribution = await contributionsApi.initiateContribution(data);

        set((state) => {
          state.contributions.unshift(contribution);
          state.selectedContribution = contribution;
          state.isLoading = false;
        });

        return contribution;
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
    // Upload Contribution Data
    // --------------------------------------------------------------------------
    uploadContributionData: async (
      id: string,
      data: UploadContributionDataRequest
    ): Promise<UploadContributionResponse> => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await contributionsApi.uploadContributionData(id, data);

        set((state) => {
          state.selectedContribution = response.contribution;
          // Update in list
          const index = state.contributions.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.contributions[index] = response.contribution;
          }
          state.isLoading = false;
        });

        return response;
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
    // Submit for Review
    // --------------------------------------------------------------------------
    submitForReview: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await contributionsApi.submitForReview(id);
        const contribution = response.contribution;

        set((state) => {
          state.selectedContribution = contribution;
          // Update in list
          const index = state.contributions.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.contributions[index] = contribution;
          }
          state.isLoading = false;
        });

        return contribution;
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
    // Revoke Contribution
    // --------------------------------------------------------------------------
    revokeContribution: async (id: string, reason?: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await contributionsApi.revokeContribution(id, reason);
        const contribution = response.contribution;

        set((state) => {
          state.selectedContribution = contribution;
          // Update in list
          const index = state.contributions.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.contributions[index] = contribution;
          }
          state.isLoading = false;
        });

        return contribution;
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
    // Select Contribution
    // --------------------------------------------------------------------------
    selectContribution: (contribution: DataContribution | null) => {
      set((state) => {
        state.selectedContribution = contribution;
      });
    },

    // --------------------------------------------------------------------------
    // Fetch Credit Balance
    // --------------------------------------------------------------------------
    fetchCreditBalance: async () => {
      try {
        const balance = await contributionsApi.getCreditBalance();

        set((state) => {
          state.creditBalance = balance;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Credit History
    // --------------------------------------------------------------------------
    fetchCreditHistory: async () => {
      try {
        const response = await contributionsApi.getCreditHistory({ limit: 100 });

        set((state) => {
          state.creditHistory = response.history;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Redeem Credits
    // --------------------------------------------------------------------------
    redeemCredits: async (rewardId: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await contributionsApi.redeemCredits({ rewardId });

        set((state) => {
          state.redemptions.unshift(response.redemption);
          // Refresh balance after redemption
          state.isLoading = false;
        });

        // Trigger balance refresh
        get().fetchCreditBalance();

        return response.redemption;
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
    // Fetch Rewards
    // --------------------------------------------------------------------------
    fetchRewards: async () => {
      try {
        const response = await contributionsApi.getRewards();

        set((state) => {
          state.rewards = response.rewards;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Redemption History
    // --------------------------------------------------------------------------
    fetchRedemptionHistory: async () => {
      try {
        const response = await contributionsApi.getRedemptionHistory();

        set((state) => {
          state.redemptions = response.redemptions;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Leaderboard
    // --------------------------------------------------------------------------
    fetchLeaderboard: async (params?: ListLeaderboardParams) => {
      try {
        const response = await contributionsApi.getLeaderboard(params);

        set((state) => {
          state.leaderboard = response.leaderboard;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Stats
    // --------------------------------------------------------------------------
    fetchStats: async () => {
      try {
        const response = await contributionsApi.getContributorStats();

        set((state) => {
          if ('stats' in response && response.stats === null) {
            state.stats = null;
          } else {
            state.stats = response as ContributorStats;
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Impact
    // --------------------------------------------------------------------------
    fetchImpact: async (contributionId: string): Promise<ImpactSummary> => {
      try {
        const response = await contributionsApi.getImpact(contributionId);
        return response.impact;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Set Filters
    // --------------------------------------------------------------------------
    setFilters: (filters: Partial<ContributionFilters>) => {
      set((state) => {
        state.filters = { ...state.filters, ...filters };
        state.pagination.offset = 0; // Reset to first page on filter change
      });
      get().fetchContributions();
    },

    // --------------------------------------------------------------------------
    // Clear Filters
    // --------------------------------------------------------------------------
    clearFilters: () => {
      set((state) => {
        state.filters = {};
        state.pagination.offset = 0;
      });
      get().fetchContributions();
    },

    // --------------------------------------------------------------------------
    // Set Page
    // --------------------------------------------------------------------------
    setPage: (offset: number) => {
      set((state) => {
        state.pagination.offset = offset;
      });
      get().fetchContributions();
    },

    // --------------------------------------------------------------------------
    // Wizard Management
    // --------------------------------------------------------------------------
    setWizardStep: (step: number) => {
      set((state) => {
        state.wizardStep = step;
      });
    },

    setWizardData: (data: Partial<InitiateContributionRequest & UploadContributionDataRequest>) => {
      set((state) => {
        state.wizardData = { ...state.wizardData, ...data };
      });
    },

    resetWizard: () => {
      set((state) => {
        state.wizardStep = 0;
        state.wizardData = {};
      });
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
    name: 'ContributionsStore',
    persist: false,
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select all contributions */
export const selectContributions = (state: ContributionsStore) => state.contributions;

/** Select selected contribution */
export const selectSelectedContribution = (state: ContributionsStore) =>
  state.selectedContribution;

/** Select credit balance */
export const selectCreditBalance = (state: ContributionsStore) => state.creditBalance;

/** Select credit history */
export const selectCreditHistory = (state: ContributionsStore) => state.creditHistory;

/** Select contributor stats */
export const selectStats = (state: ContributionsStore) => state.stats;

/** Select leaderboard */
export const selectLeaderboard = (state: ContributionsStore) => state.leaderboard;

/** Select rewards */
export const selectRewards = (state: ContributionsStore) => state.rewards;

/** Select redemptions */
export const selectRedemptions = (state: ContributionsStore) => state.redemptions;

/** Select filters */
export const selectFilters = (state: ContributionsStore) => state.filters;

/** Select pagination */
export const selectPagination = (state: ContributionsStore) => state.pagination;

/** Select loading state */
export const selectIsLoading = (state: ContributionsStore) => state.isLoading;

/** Select error */
export const selectError = (state: ContributionsStore) => state.error;

/** Select wizard step */
export const selectWizardStep = (state: ContributionsStore) => state.wizardStep;

/** Select wizard data */
export const selectWizardData = (state: ContributionsStore) => state.wizardData;

/** Select contribution by ID */
export const selectContributionById = (id: string) => (state: ContributionsStore) =>
  state.contributions.find((c) => c.id === id) ?? null;

/** Select contributions by status */
export const selectContributionsByStatus =
  (status: string) => (state: ContributionsStore) =>
    state.contributions.filter((c) => c.status === status);

/** Select available rewards (that user can afford) */
export const selectAffordableRewards = (state: ContributionsStore) =>
  state.creditBalance
    ? state.rewards.filter(
        (r) => r.available && r.creditCost <= state.creditBalance!.available
      )
    : [];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract error message from API error
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    // Check for API error format
    if ('code' in error && typeof error.code === 'string') {
      const code = error.code as ContributionErrorCode;
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }

    // Check for message property
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    // Check for response.data.message (Axios error format)
    if ('response' in error) {
      const response = error.response as { data?: { message?: string } };
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

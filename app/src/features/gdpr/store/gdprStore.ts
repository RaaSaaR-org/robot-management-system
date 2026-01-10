/**
 * @file gdprStore.ts
 * @description Zustand store for GDPR Rights Self-Service Portal
 * @feature gdpr
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { gdprApi } from '../api';
import type {
  GDPRStore,
  GDPRState,
  GDPRRequest,
  AccessRequestInput,
  RectificationRequestInput,
  ErasureRequestInput,
  RestrictionRequestInput,
  PortabilityRequestInput,
  ObjectionRequestInput,
  ADMReviewRequestInput,
  AdminRequestFilters,
  ConsentType,
} from '../types';

const initialState: GDPRState = {
  requests: [],
  selectedRequest: null,
  requestHistory: [],
  consents: [],
  metrics: null,
  slaReport: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
  },
  isLoading: false,
  isLoadingRequest: false,
  isLoadingConsents: false,
  isLoadingMetrics: false,
  isSubmitting: false,
  error: null,
};

export const useGDPRStore = create<GDPRStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      // ============================================================================
      // USER REQUESTS
      // ============================================================================

      fetchMyRequests: async () => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const { requests } = await gdprApi.getMyRequests();
          set((state) => {
            state.requests = requests;
            state.isLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch requests';
          set((state) => {
            state.error = message;
            state.isLoading = false;
          });
        }
      },

      fetchRequest: async (id: string) => {
        set((state) => {
          state.isLoadingRequest = true;
          state.error = null;
        });

        try {
          const { request, history } = await gdprApi.getRequest(id);
          set((state) => {
            state.selectedRequest = request;
            state.requestHistory = history;
            state.isLoadingRequest = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch request';
          set((state) => {
            state.error = message;
            state.isLoadingRequest = false;
          });
        }
      },

      submitAccessRequest: async (input?: AccessRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitAccessRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      submitRectificationRequest: async (input: RectificationRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitRectificationRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      submitErasureRequest: async (input?: ErasureRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitErasureRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      submitRestrictionRequest: async (input: RestrictionRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitRestrictionRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      submitPortabilityRequest: async (input: PortabilityRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitPortabilityRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      submitObjectionRequest: async (input: ObjectionRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitObjectionRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      submitADMReviewRequest: async (input: ADMReviewRequestInput): Promise<GDPRRequest> => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const request = await gdprApi.submitADMReviewRequest(input);
          set((state) => {
            state.requests = [request, ...state.requests];
            state.isSubmitting = false;
          });
          return request;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to submit request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      cancelRequest: async (id: string) => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const updatedRequest = await gdprApi.cancelRequest(id);
          set((state) => {
            const index = state.requests.findIndex((r) => r.id === id);
            if (index !== -1) {
              state.requests[index] = updatedRequest;
            }
            if (state.selectedRequest?.id === id) {
              state.selectedRequest = updatedRequest;
            }
            state.isSubmitting = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to cancel request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      downloadExport: async (id: string): Promise<Record<string, unknown>> => {
        try {
          return await gdprApi.downloadExport(id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to download export';
          set((state) => {
            state.error = message;
          });
          throw error;
        }
      },

      // ============================================================================
      // CONSENTS
      // ============================================================================

      fetchConsents: async () => {
        set((state) => {
          state.isLoadingConsents = true;
          state.error = null;
        });

        try {
          const { consents } = await gdprApi.getConsents();
          set((state) => {
            state.consents = consents;
            state.isLoadingConsents = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch consents';
          set((state) => {
            state.error = message;
            state.isLoadingConsents = false;
          });
        }
      },

      updateConsent: async (type: ConsentType, granted: boolean) => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const updatedConsent = await gdprApi.updateConsent(type, granted);
          set((state) => {
            const index = state.consents.findIndex((c) => c.consentType === type);
            if (index !== -1) {
              state.consents[index] = updatedConsent;
            } else {
              state.consents.push(updatedConsent);
            }
            state.isSubmitting = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to update consent';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      // ============================================================================
      // ADMIN
      // ============================================================================

      fetchAdminRequests: async (filters?: AdminRequestFilters) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const response = await gdprApi.getAdminRequests(filters);
          set((state) => {
            state.requests = response.requests;
            state.pagination = {
              page: response.page,
              limit: response.limit,
              total: response.total,
            };
            state.isLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch requests';
          set((state) => {
            state.error = message;
            state.isLoading = false;
          });
        }
      },

      acknowledgeRequest: async (id: string) => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const updatedRequest = await gdprApi.acknowledgeRequest(id);
          set((state) => {
            const index = state.requests.findIndex((r) => r.id === id);
            if (index !== -1) {
              state.requests[index] = updatedRequest;
            }
            if (state.selectedRequest?.id === id) {
              state.selectedRequest = updatedRequest;
            }
            state.isSubmitting = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to acknowledge request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      completeRequest: async (id: string, responseData?: Record<string, unknown>) => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const updatedRequest = await gdprApi.completeRequest(id, responseData);
          set((state) => {
            const index = state.requests.findIndex((r) => r.id === id);
            if (index !== -1) {
              state.requests[index] = updatedRequest;
            }
            if (state.selectedRequest?.id === id) {
              state.selectedRequest = updatedRequest;
            }
            state.isSubmitting = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to complete request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      rejectRequest: async (id: string, reason: string) => {
        set((state) => {
          state.isSubmitting = true;
          state.error = null;
        });

        try {
          const updatedRequest = await gdprApi.rejectRequest(id, reason);
          set((state) => {
            const index = state.requests.findIndex((r) => r.id === id);
            if (index !== -1) {
              state.requests[index] = updatedRequest;
            }
            if (state.selectedRequest?.id === id) {
              state.selectedRequest = updatedRequest;
            }
            state.isSubmitting = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to reject request';
          set((state) => {
            state.error = message;
            state.isSubmitting = false;
          });
          throw error;
        }
      },

      fetchMetrics: async () => {
        set((state) => {
          state.isLoadingMetrics = true;
          state.error = null;
        });

        try {
          const metrics = await gdprApi.getMetrics();
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

      fetchSLAReport: async () => {
        set((state) => {
          state.isLoadingMetrics = true;
          state.error = null;
        });

        try {
          const slaReport = await gdprApi.getSLAReport();
          set((state) => {
            state.slaReport = slaReport;
            state.isLoadingMetrics = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch SLA report';
          set((state) => {
            state.error = message;
            state.isLoadingMetrics = false;
          });
        }
      },

      // ============================================================================
      // STATE MANAGEMENT
      // ============================================================================

      clearSelectedRequest: () => {
        set((state) => {
          state.selectedRequest = null;
          state.requestHistory = [];
        });
      },

      clearError: () => {
        set((state) => {
          state.error = null;
        });
      },

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    { name: 'gdpr-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectRequests = (state: GDPRStore) => state.requests;
export const selectSelectedRequest = (state: GDPRStore) => state.selectedRequest;
export const selectRequestHistory = (state: GDPRStore) => state.requestHistory;
export const selectConsents = (state: GDPRStore) => state.consents;
export const selectMetrics = (state: GDPRStore) => state.metrics;
export const selectSLAReport = (state: GDPRStore) => state.slaReport;
export const selectPagination = (state: GDPRStore) => state.pagination;
export const selectIsLoading = (state: GDPRStore) => state.isLoading;
export const selectIsLoadingRequest = (state: GDPRStore) => state.isLoadingRequest;
export const selectIsLoadingConsents = (state: GDPRStore) => state.isLoadingConsents;
export const selectIsLoadingMetrics = (state: GDPRStore) => state.isLoadingMetrics;
export const selectIsSubmitting = (state: GDPRStore) => state.isSubmitting;
export const selectError = (state: GDPRStore) => state.error;

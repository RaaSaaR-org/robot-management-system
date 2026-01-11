/**
 * @file approvalsStore.ts
 * @description Zustand store for human approval workflow state management
 * @feature approvals
 *
 * Implements state management for:
 * - GDPR Art. 22: Human review of automated decisions
 * - AI Act Art. 14: Human oversight with meaningful engagement
 * - EDPB WP251: Worker rights in automated processing
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { approvalsApi } from '../api';
import type {
  ApprovalRequest,
  ApprovalMetrics,
  SLAComplianceReport,
  MeaningfulOversightMetrics,
  DecisionContest,
  WorkerViewpoint,
  ApprovalRequestFilters,
  DecisionContestFilters,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  SubmitWorkerViewpointInput,
  ContestDecisionInput,
  ProcessContestInput,
  ApproverRole,
} from '../types';

// ============================================================================
// STATE & ACTIONS TYPES
// ============================================================================

interface ApprovalsState {
  // Approval Queue
  approvalRequests: ApprovalRequest[];
  approvalRequestsLoading: boolean;
  approvalRequestsError: string | null;
  approvalRequestsTotal: number;
  approvalRequestsPage: number;

  // Pending approvals (for current user/role)
  pendingApprovals: ApprovalRequest[];
  pendingApprovalsLoading: boolean;

  // Overdue & urgent
  overdueApprovals: ApprovalRequest[];
  nearingDeadlineApprovals: ApprovalRequest[];

  // Selected request (for detail view)
  selectedRequest: ApprovalRequest | null;
  selectedRequestLoading: boolean;

  // Metrics
  metrics: ApprovalMetrics | null;
  metricsLoading: boolean;

  // SLA Report
  slaReport: SLAComplianceReport | null;
  slaReportLoading: boolean;

  // Oversight Metrics (Art. 14)
  oversightMetrics: MeaningfulOversightMetrics | null;
  oversightMetricsLoading: boolean;

  // Contests
  contests: DecisionContest[];
  contestsLoading: boolean;
  contestsTotal: number;
  contestsPage: number;

  // Current filters
  filters: ApprovalRequestFilters;
}

interface ApprovalsActions {
  // Approval Requests
  fetchApprovalRequests: (filters?: ApprovalRequestFilters) => Promise<void>;
  fetchPendingApprovals: (userId?: string) => Promise<void>;
  fetchPendingApprovalsByRole: (role: ApproverRole) => Promise<void>;
  fetchOverdueApprovals: () => Promise<void>;
  fetchNearingDeadlineApprovals: (withinHours?: number) => Promise<void>;

  // Selected Request
  selectRequest: (id: string | null) => Promise<void>;
  refreshSelectedRequest: () => Promise<void>;

  // Approval Actions
  createApprovalRequest: (input: CreateApprovalRequestInput) => Promise<ApprovalRequest>;
  processApproval: (
    approvalRequestId: string,
    stepId: string,
    input: ProcessApprovalInput
  ) => Promise<ApprovalRequest>;
  cancelApprovalRequest: (
    id: string,
    cancelledBy: string,
    reason: string
  ) => Promise<ApprovalRequest>;
  escalateApprovalRequest: (
    id: string,
    escalatedBy: string,
    reason?: string
  ) => Promise<ApprovalRequest>;

  // Worker Rights
  submitWorkerViewpoint: (
    approvalRequestId: string,
    input: SubmitWorkerViewpointInput
  ) => Promise<WorkerViewpoint>;
  acknowledgeViewpoint: (
    approvalRequestId: string,
    acknowledgedBy: string
  ) => Promise<WorkerViewpoint>;

  // Contests
  fetchContests: (filters?: DecisionContestFilters) => Promise<void>;
  contestDecision: (decisionId: string, input: ContestDecisionInput) => Promise<DecisionContest>;
  processContest: (id: string, input: ProcessContestInput) => Promise<DecisionContest>;

  // Metrics
  fetchMetrics: () => Promise<void>;
  fetchSLAReport: () => Promise<void>;
  fetchOversightMetrics: () => Promise<void>;

  // Filters
  setFilters: (filters: Partial<ApprovalRequestFilters>) => void;
  clearFilters: () => void;

  // Reset
  reset: () => void;
}

type ApprovalsStore = ApprovalsState & ApprovalsActions;

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: ApprovalsState = {
  // Approval Queue
  approvalRequests: [],
  approvalRequestsLoading: false,
  approvalRequestsError: null,
  approvalRequestsTotal: 0,
  approvalRequestsPage: 1,

  // Pending approvals
  pendingApprovals: [],
  pendingApprovalsLoading: false,

  // Overdue & urgent
  overdueApprovals: [],
  nearingDeadlineApprovals: [],

  // Selected request
  selectedRequest: null,
  selectedRequestLoading: false,

  // Metrics
  metrics: null,
  metricsLoading: false,

  // SLA Report
  slaReport: null,
  slaReportLoading: false,

  // Oversight Metrics
  oversightMetrics: null,
  oversightMetricsLoading: false,

  // Contests
  contests: [],
  contestsLoading: false,
  contestsTotal: 0,
  contestsPage: 1,

  // Filters
  filters: {},
};

// ============================================================================
// STORE
// ============================================================================

export const useApprovalsStore = create<ApprovalsStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // ========================================================================
      // APPROVAL REQUESTS
      // ========================================================================

      fetchApprovalRequests: async (filters?: ApprovalRequestFilters) => {
        set((state) => {
          state.approvalRequestsLoading = true;
          state.approvalRequestsError = null;
        });

        try {
          const mergedFilters = { ...get().filters, ...filters };
          const response = await approvalsApi.getApprovalRequests(mergedFilters);

          set((state) => {
            state.approvalRequests = response.requests;
            state.approvalRequestsTotal = response.total;
            state.approvalRequestsPage = response.page;
            state.approvalRequestsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch approvals';
          set((state) => {
            state.approvalRequestsError = message;
            state.approvalRequestsLoading = false;
          });
        }
      },

      fetchPendingApprovals: async (userId?: string) => {
        set((state) => {
          state.pendingApprovalsLoading = true;
        });

        try {
          const requests = await approvalsApi.getPendingApprovalsForMe(userId);

          set((state) => {
            state.pendingApprovals = requests;
            state.pendingApprovalsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch pending approvals:', error);
          set((state) => {
            state.pendingApprovalsLoading = false;
          });
        }
      },

      fetchPendingApprovalsByRole: async (role: ApproverRole) => {
        set((state) => {
          state.pendingApprovalsLoading = true;
        });

        try {
          const requests = await approvalsApi.getPendingApprovalsByRole(role);

          set((state) => {
            state.pendingApprovals = requests;
            state.pendingApprovalsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch pending approvals by role:', error);
          set((state) => {
            state.pendingApprovalsLoading = false;
          });
        }
      },

      fetchOverdueApprovals: async () => {
        try {
          const requests = await approvalsApi.getOverdueApprovals();

          set((state) => {
            state.overdueApprovals = requests;
          });
        } catch (error) {
          console.error('Failed to fetch overdue approvals:', error);
        }
      },

      fetchNearingDeadlineApprovals: async (withinHours = 4) => {
        try {
          const requests = await approvalsApi.getApprovalsNearingDeadline(withinHours);

          set((state) => {
            state.nearingDeadlineApprovals = requests;
          });
        } catch (error) {
          console.error('Failed to fetch nearing deadline approvals:', error);
        }
      },

      // ========================================================================
      // SELECTED REQUEST
      // ========================================================================

      selectRequest: async (id: string | null) => {
        if (!id) {
          set((state) => {
            state.selectedRequest = null;
          });
          return;
        }

        set((state) => {
          state.selectedRequestLoading = true;
        });

        try {
          const request = await approvalsApi.getApprovalRequest(id);

          set((state) => {
            state.selectedRequest = request;
            state.selectedRequestLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch approval request:', error);
          set((state) => {
            state.selectedRequestLoading = false;
          });
        }
      },

      refreshSelectedRequest: async () => {
        const currentId = get().selectedRequest?.id;
        if (currentId) {
          await get().selectRequest(currentId);
        }
      },

      // ========================================================================
      // APPROVAL ACTIONS
      // ========================================================================

      createApprovalRequest: async (input: CreateApprovalRequestInput) => {
        const request = await approvalsApi.createApprovalRequest(input);

        // Add to the list
        set((state) => {
          state.approvalRequests.unshift(request);
          state.approvalRequestsTotal += 1;
        });

        return request;
      },

      processApproval: async (
        approvalRequestId: string,
        stepId: string,
        input: ProcessApprovalInput
      ) => {
        const updatedRequest = await approvalsApi.processApproval(
          approvalRequestId,
          stepId,
          input
        );

        // Update in the list
        set((state) => {
          const index = state.approvalRequests.findIndex((r) => r.id === approvalRequestId);
          if (index !== -1) {
            state.approvalRequests[index] = updatedRequest;
          }

          // Update pending approvals
          state.pendingApprovals = state.pendingApprovals.filter(
            (r) => r.id !== approvalRequestId || updatedRequest.status === 'pending' || updatedRequest.status === 'in_progress'
          );

          // Update selected request if it's the same
          if (state.selectedRequest?.id === approvalRequestId) {
            state.selectedRequest = updatedRequest;
          }
        });

        return updatedRequest;
      },

      cancelApprovalRequest: async (id: string, cancelledBy: string, reason: string) => {
        const updatedRequest = await approvalsApi.cancelApprovalRequest(id, cancelledBy, reason);

        set((state) => {
          const index = state.approvalRequests.findIndex((r) => r.id === id);
          if (index !== -1) {
            state.approvalRequests[index] = updatedRequest;
          }

          // Remove from pending
          state.pendingApprovals = state.pendingApprovals.filter((r) => r.id !== id);

          if (state.selectedRequest?.id === id) {
            state.selectedRequest = updatedRequest;
          }
        });

        return updatedRequest;
      },

      escalateApprovalRequest: async (id: string, escalatedBy: string, reason?: string) => {
        const updatedRequest = await approvalsApi.escalateApprovalRequest(id, escalatedBy, reason);

        set((state) => {
          const index = state.approvalRequests.findIndex((r) => r.id === id);
          if (index !== -1) {
            state.approvalRequests[index] = updatedRequest;
          }

          if (state.selectedRequest?.id === id) {
            state.selectedRequest = updatedRequest;
          }
        });

        return updatedRequest;
      },

      // ========================================================================
      // WORKER RIGHTS
      // ========================================================================

      submitWorkerViewpoint: async (approvalRequestId: string, input: SubmitWorkerViewpointInput) => {
        const viewpoint = await approvalsApi.submitWorkerViewpoint(approvalRequestId, input);

        // Refresh the selected request to include the viewpoint
        if (get().selectedRequest?.id === approvalRequestId) {
          await get().refreshSelectedRequest();
        }

        return viewpoint;
      },

      acknowledgeViewpoint: async (approvalRequestId: string, acknowledgedBy: string) => {
        const viewpoint = await approvalsApi.acknowledgeViewpoint(approvalRequestId, acknowledgedBy);

        if (get().selectedRequest?.id === approvalRequestId) {
          await get().refreshSelectedRequest();
        }

        return viewpoint;
      },

      // ========================================================================
      // CONTESTS
      // ========================================================================

      fetchContests: async (filters?: DecisionContestFilters) => {
        set((state) => {
          state.contestsLoading = true;
        });

        try {
          const response = await approvalsApi.getContests(filters);

          set((state) => {
            state.contests = response.contests;
            state.contestsTotal = response.total;
            state.contestsPage = response.page;
            state.contestsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch contests:', error);
          set((state) => {
            state.contestsLoading = false;
          });
        }
      },

      contestDecision: async (decisionId: string, input: ContestDecisionInput) => {
        const contest = await approvalsApi.contestDecision(decisionId, input);

        set((state) => {
          state.contests.unshift(contest);
          state.contestsTotal += 1;
        });

        return contest;
      },

      processContest: async (id: string, input: ProcessContestInput) => {
        const updatedContest = await approvalsApi.processContest(id, input);

        set((state) => {
          const index = state.contests.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.contests[index] = updatedContest;
          }
        });

        return updatedContest;
      },

      // ========================================================================
      // METRICS
      // ========================================================================

      fetchMetrics: async () => {
        set((state) => {
          state.metricsLoading = true;
        });

        try {
          const metrics = await approvalsApi.getMetrics();

          set((state) => {
            state.metrics = metrics;
            state.metricsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch metrics:', error);
          set((state) => {
            state.metricsLoading = false;
          });
        }
      },

      fetchSLAReport: async () => {
        set((state) => {
          state.slaReportLoading = true;
        });

        try {
          const report = await approvalsApi.getSLAComplianceReport();

          set((state) => {
            state.slaReport = report;
            state.slaReportLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch SLA report:', error);
          set((state) => {
            state.slaReportLoading = false;
          });
        }
      },

      fetchOversightMetrics: async () => {
        set((state) => {
          state.oversightMetricsLoading = true;
        });

        try {
          const metrics = await approvalsApi.getMeaningfulOversightMetrics();

          set((state) => {
            state.oversightMetrics = metrics;
            state.oversightMetricsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch oversight metrics:', error);
          set((state) => {
            state.oversightMetricsLoading = false;
          });
        }
      },

      // ========================================================================
      // FILTERS
      // ========================================================================

      setFilters: (filters: Partial<ApprovalRequestFilters>) => {
        set((state) => {
          state.filters = { ...state.filters, ...filters };
        });
      },

      clearFilters: () => {
        set((state) => {
          state.filters = {};
        });
      },

      // ========================================================================
      // RESET
      // ========================================================================

      reset: () => {
        set(initialState);
      },
    })),
    { name: 'approvals-store' }
  )
);

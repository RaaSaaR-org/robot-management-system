/**
 * @file approvalsApi.ts
 * @description API calls for human approval workflows
 * @feature approvals
 *
 * Implements API calls for:
 * - GDPR Art. 22: Human review of automated decisions
 * - AI Act Art. 14: Human oversight with meaningful engagement
 * - EDPB WP251: Worker rights in automated processing
 */

import { apiClient } from '@/api/client';
import type {
  ApprovalRequest,
  ApprovalRequestListResponse,
  ApprovalRequestFilters,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  WorkerViewpoint,
  SubmitWorkerViewpointInput,
  RespondToViewpointInput,
  DecisionContest,
  DecisionContestListResponse,
  DecisionContestFilters,
  ContestDecisionInput,
  ProcessContestInput,
  ApprovalMetrics,
  SLAComplianceReport,
  MeaningfulOversightMetrics,
  ApproverRole,
} from '../types';

const ENDPOINTS = {
  // Approval Requests
  approvals: '/approvals',
  approval: (id: string) => `/approvals/${id}`,
  pendingMe: '/approvals/pending/me',
  pendingRole: (role: ApproverRole) => `/approvals/pending/role/${role}`,
  overdue: '/approvals/overdue',
  nearingDeadline: '/approvals/nearing-deadline',

  // Approval Actions
  stepDecide: (id: string, stepId: string) => `/approvals/${id}/steps/${stepId}/decide`,
  cancel: (id: string) => `/approvals/${id}/cancel`,
  escalate: (id: string) => `/approvals/${id}/escalate`,

  // Worker Rights (GDPR Art. 22)
  viewpoint: (id: string) => `/approvals/${id}/viewpoint`,
  viewpointAcknowledge: (id: string) => `/approvals/${id}/viewpoint/acknowledge`,
  viewpointRespond: (id: string) => `/approvals/${id}/viewpoint/respond`,

  // Decision Contests
  contestDecision: (decisionId: string) => `/approvals/decisions/${decisionId}/contest`,
  requestIntervention: (decisionId: string) => `/approvals/decisions/${decisionId}/request-intervention`,
  contests: '/approvals/contests',
  contest: (id: string) => `/approvals/contests/${id}`,
  contestReview: (id: string) => `/approvals/contests/${id}/review`,

  // Metrics
  metrics: '/approvals/metrics',
  slaReport: '/approvals/sla-report',
  oversightMetrics: '/approvals/oversight-metrics',
} as const;

export const approvalsApi = {
  // ============================================================================
  // APPROVAL REQUESTS
  // ============================================================================

  /**
   * Get approval requests with filters and pagination
   */
  async getApprovalRequests(filters?: ApprovalRequestFilters): Promise<ApprovalRequestListResponse> {
    const params: Record<string, string | undefined> = {};

    if (filters?.status) {
      params.status = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
    }
    if (filters?.entityType) {
      params.entityType = Array.isArray(filters.entityType)
        ? filters.entityType.join(',')
        : filters.entityType;
    }
    if (filters?.priority) {
      params.priority = Array.isArray(filters.priority)
        ? filters.priority.join(',')
        : filters.priority;
    }
    if (filters?.affectedUserId) params.affectedUserId = filters.affectedUserId;
    if (filters?.requestedBy) params.requestedBy = filters.requestedBy;
    if (filters?.overdue) params.overdue = 'true';
    if (filters?.fromDate) params.fromDate = filters.fromDate;
    if (filters?.toDate) params.toDate = filters.toDate;
    if (filters?.page) params.page = String(filters.page);
    if (filters?.limit) params.limit = String(filters.limit);

    const response = await apiClient.get<ApprovalRequestListResponse>(ENDPOINTS.approvals, {
      params,
    });
    return response.data;
  },

  /**
   * Get a single approval request by ID
   */
  async getApprovalRequest(id: string): Promise<ApprovalRequest> {
    const response = await apiClient.get<ApprovalRequest>(ENDPOINTS.approval(id));
    return response.data;
  },

  /**
   * Create a new approval request
   */
  async createApprovalRequest(input: CreateApprovalRequestInput): Promise<ApprovalRequest> {
    const response = await apiClient.post<ApprovalRequest>(ENDPOINTS.approvals, input);
    return response.data;
  },

  /**
   * Get pending approvals for the current user
   */
  async getPendingApprovalsForMe(userId?: string): Promise<ApprovalRequest[]> {
    const response = await apiClient.get<ApprovalRequest[]>(ENDPOINTS.pendingMe, {
      params: userId ? { userId } : undefined,
    });
    return response.data;
  },

  /**
   * Get pending approvals by role
   */
  async getPendingApprovalsByRole(role: ApproverRole): Promise<ApprovalRequest[]> {
    const response = await apiClient.get<ApprovalRequest[]>(ENDPOINTS.pendingRole(role));
    return response.data;
  },

  /**
   * Get overdue approvals
   */
  async getOverdueApprovals(): Promise<ApprovalRequest[]> {
    const response = await apiClient.get<ApprovalRequest[]>(ENDPOINTS.overdue);
    return response.data;
  },

  /**
   * Get approvals nearing SLA deadline
   */
  async getApprovalsNearingDeadline(withinHours?: number): Promise<ApprovalRequest[]> {
    const response = await apiClient.get<ApprovalRequest[]>(ENDPOINTS.nearingDeadline, {
      params: withinHours ? { withinHours } : undefined,
    });
    return response.data;
  },

  // ============================================================================
  // APPROVAL ACTIONS
  // ============================================================================

  /**
   * Process an approval decision (approve, reject, defer, request_info)
   */
  async processApproval(
    approvalRequestId: string,
    stepId: string,
    input: ProcessApprovalInput
  ): Promise<ApprovalRequest> {
    const response = await apiClient.post<ApprovalRequest>(
      ENDPOINTS.stepDecide(approvalRequestId, stepId),
      input
    );
    return response.data;
  },

  /**
   * Cancel an approval request
   */
  async cancelApprovalRequest(
    id: string,
    cancelledBy: string,
    reason: string
  ): Promise<ApprovalRequest> {
    const response = await apiClient.post<ApprovalRequest>(ENDPOINTS.cancel(id), {
      cancelledBy,
      reason,
    });
    return response.data;
  },

  /**
   * Manually escalate an approval request
   */
  async escalateApprovalRequest(
    id: string,
    escalatedBy: string,
    reason?: string
  ): Promise<ApprovalRequest> {
    const response = await apiClient.post<ApprovalRequest>(ENDPOINTS.escalate(id), {
      escalatedBy,
      reason,
    });
    return response.data;
  },

  // ============================================================================
  // WORKER RIGHTS (GDPR Art. 22)
  // ============================================================================

  /**
   * Submit a worker viewpoint on an approval request
   */
  async submitWorkerViewpoint(
    approvalRequestId: string,
    input: SubmitWorkerViewpointInput
  ): Promise<WorkerViewpoint> {
    const response = await apiClient.post<WorkerViewpoint>(
      ENDPOINTS.viewpoint(approvalRequestId),
      input
    );
    return response.data;
  },

  /**
   * Get viewpoint for an approval request
   */
  async getViewpoint(approvalRequestId: string): Promise<WorkerViewpoint> {
    const response = await apiClient.get<WorkerViewpoint>(ENDPOINTS.viewpoint(approvalRequestId));
    return response.data;
  },

  /**
   * Acknowledge a worker viewpoint
   */
  async acknowledgeViewpoint(
    approvalRequestId: string,
    acknowledgedBy: string
  ): Promise<WorkerViewpoint> {
    const response = await apiClient.post<WorkerViewpoint>(
      ENDPOINTS.viewpointAcknowledge(approvalRequestId),
      { acknowledgedBy }
    );
    return response.data;
  },

  /**
   * Respond to a worker viewpoint
   */
  async respondToViewpoint(
    approvalRequestId: string,
    input: RespondToViewpointInput
  ): Promise<WorkerViewpoint> {
    const response = await apiClient.post<WorkerViewpoint>(
      ENDPOINTS.viewpointRespond(approvalRequestId),
      input
    );
    return response.data;
  },

  // ============================================================================
  // DECISION CONTESTS
  // ============================================================================

  /**
   * Contest an automated decision
   */
  async contestDecision(
    decisionId: string,
    input: ContestDecisionInput
  ): Promise<DecisionContest> {
    const response = await apiClient.post<DecisionContest>(
      ENDPOINTS.contestDecision(decisionId),
      input
    );
    return response.data;
  },

  /**
   * Request human intervention on a decision
   */
  async requestHumanIntervention(
    decisionId: string,
    workerId: string,
    reason: string
  ): Promise<DecisionContest> {
    const response = await apiClient.post<DecisionContest>(
      ENDPOINTS.requestIntervention(decisionId),
      { workerId, reason }
    );
    return response.data;
  },

  /**
   * Get decision contests with filters
   */
  async getContests(filters?: DecisionContestFilters): Promise<DecisionContestListResponse> {
    const params: Record<string, string | undefined> = {};

    if (filters?.status) {
      params.status = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
    }
    if (filters?.workerId) params.workerId = filters.workerId;
    if (filters?.assignedTo) params.assignedTo = filters.assignedTo;
    if (filters?.fromDate) params.fromDate = filters.fromDate;
    if (filters?.toDate) params.toDate = filters.toDate;
    if (filters?.page) params.page = String(filters.page);
    if (filters?.limit) params.limit = String(filters.limit);

    const response = await apiClient.get<DecisionContestListResponse>(ENDPOINTS.contests, {
      params,
    });
    return response.data;
  },

  /**
   * Get a single contest by ID
   */
  async getContest(id: string): Promise<DecisionContest> {
    const response = await apiClient.get<DecisionContest>(ENDPOINTS.contest(id));
    return response.data;
  },

  /**
   * Process a contest review
   */
  async processContest(id: string, input: ProcessContestInput): Promise<DecisionContest> {
    const response = await apiClient.post<DecisionContest>(ENDPOINTS.contestReview(id), input);
    return response.data;
  },

  // ============================================================================
  // METRICS & REPORTING
  // ============================================================================

  /**
   * Get approval workflow metrics
   */
  async getMetrics(): Promise<ApprovalMetrics> {
    const response = await apiClient.get<ApprovalMetrics>(ENDPOINTS.metrics);
    return response.data;
  },

  /**
   * Get SLA compliance report
   */
  async getSLAComplianceReport(): Promise<SLAComplianceReport> {
    const response = await apiClient.get<SLAComplianceReport>(ENDPOINTS.slaReport);
    return response.data;
  },

  /**
   * Get meaningful oversight metrics (Art. 14 compliance)
   */
  async getMeaningfulOversightMetrics(): Promise<MeaningfulOversightMetrics> {
    const response = await apiClient.get<MeaningfulOversightMetrics>(ENDPOINTS.oversightMetrics);
    return response.data;
  },
};

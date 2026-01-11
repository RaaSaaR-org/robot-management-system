/**
 * @file useApprovals.ts
 * @description Hook for approval queue management
 * @feature approvals
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useApprovalsStore } from '../store';
import type {
  ApprovalRequest,
  ApprovalRequestFilters,
  ProcessApprovalInput,
  ApprovalQueueItem,
} from '../types';

export interface UseApprovalsOptions {
  autoFetch?: boolean;
  filters?: ApprovalRequestFilters;
}

export interface UseApprovalsReturn {
  approvals: ApprovalQueueItem[];
  total: number;
  page: number;
  isLoading: boolean;
  error: string | null;
  pendingCount: number;
  overdueCount: number;
  urgentCount: number;
  fetchApprovals: (filters?: ApprovalRequestFilters) => Promise<void>;
  processApproval: (
    approvalRequestId: string,
    stepId: string,
    input: ProcessApprovalInput
  ) => Promise<ApprovalRequest>;
  cancelApproval: (id: string, reason: string) => Promise<ApprovalRequest>;
  escalateApproval: (id: string, reason?: string) => Promise<ApprovalRequest>;
  refresh: () => Promise<void>;
}

/**
 * Transform ApprovalRequest to ApprovalQueueItem with computed fields
 */
function toQueueItem(request: ApprovalRequest): ApprovalQueueItem {
  const deadline = new Date(request.slaDeadline);
  const now = new Date();
  const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isOverdue = hoursRemaining < 0;

  // Find the awaiting step
  const awaitingStep = request.steps?.find((s) => s.status === 'awaiting');

  let urgencyLevel: 'normal' | 'warning' | 'critical' = 'normal';
  if (isOverdue || hoursRemaining < 2) {
    urgencyLevel = 'critical';
  } else if (hoursRemaining < request.slaHours * 0.25) {
    urgencyLevel = 'warning';
  }

  return {
    ...request,
    isOverdue,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    urgencyLevel,
    awaitingStep,
  };
}

/**
 * Hook for managing the approval queue
 */
export function useApprovals(options: UseApprovalsOptions = {}): UseApprovalsReturn {
  const { autoFetch = false, filters: initialFilters } = options;

  const approvalRequests = useApprovalsStore((state) => state.approvalRequests);
  const isLoading = useApprovalsStore((state) => state.approvalRequestsLoading);
  const error = useApprovalsStore((state) => state.approvalRequestsError);
  const total = useApprovalsStore((state) => state.approvalRequestsTotal);
  const page = useApprovalsStore((state) => state.approvalRequestsPage);

  const storeFetchApprovals = useApprovalsStore((state) => state.fetchApprovalRequests);
  const storeProcessApproval = useApprovalsStore((state) => state.processApproval);
  const storeCancelApproval = useApprovalsStore((state) => state.cancelApprovalRequest);
  const storeEscalateApproval = useApprovalsStore((state) => state.escalateApprovalRequest);

  // Transform to queue items with computed fields
  const approvals = useMemo(
    () => approvalRequests.map(toQueueItem),
    [approvalRequests]
  );

  // Computed counts
  const pendingCount = useMemo(
    () => approvals.filter((a) => a.status === 'pending' || a.status === 'in_progress').length,
    [approvals]
  );

  const overdueCount = useMemo(
    () => approvals.filter((a) => a.isOverdue).length,
    [approvals]
  );

  const urgentCount = useMemo(
    () => approvals.filter((a) => a.urgencyLevel === 'critical').length,
    [approvals]
  );

  const fetchApprovals = useCallback(
    async (filters?: ApprovalRequestFilters) => {
      await storeFetchApprovals(filters || initialFilters);
    },
    [storeFetchApprovals, initialFilters]
  );

  const processApproval = useCallback(
    async (approvalRequestId: string, stepId: string, input: ProcessApprovalInput) => {
      return storeProcessApproval(approvalRequestId, stepId, input);
    },
    [storeProcessApproval]
  );

  const cancelApproval = useCallback(
    async (id: string, reason: string) => {
      // TODO: Get userId from auth context
      return storeCancelApproval(id, 'system', reason);
    },
    [storeCancelApproval]
  );

  const escalateApproval = useCallback(
    async (id: string, reason?: string) => {
      // TODO: Get userId from auth context
      return storeEscalateApproval(id, 'system', reason);
    },
    [storeEscalateApproval]
  );

  const refresh = useCallback(async () => {
    await fetchApprovals();
  }, [fetchApprovals]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchApprovals();
    }
  }, [autoFetch, fetchApprovals]);

  return {
    approvals,
    total,
    page,
    isLoading,
    error,
    pendingCount,
    overdueCount,
    urgentCount,
    fetchApprovals,
    processApproval,
    cancelApproval,
    escalateApproval,
    refresh,
  };
}

/**
 * @file usePendingApprovals.ts
 * @description Hook for pending approval queue for approvers
 * @feature approvals
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useApprovalsStore } from '../store';
import type { ApprovalRequest, ApproverRole, ApprovalQueueItem } from '../types';

export interface UsePendingApprovalsOptions {
  userId?: string;
  role?: ApproverRole;
  autoFetch?: boolean;
  refreshInterval?: number;
}

export interface UsePendingApprovalsReturn {
  pendingApprovals: ApprovalQueueItem[];
  overdueApprovals: ApprovalRequest[];
  nearingDeadlineApprovals: ApprovalRequest[];
  isLoading: boolean;
  pendingCount: number;
  overdueCount: number;
  urgentCount: number;
  criticalCount: number;
  fetchPending: () => Promise<void>;
  fetchOverdue: () => Promise<void>;
  fetchNearingDeadline: (withinHours?: number) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Transform to queue item with computed fields
 */
function toQueueItem(request: ApprovalRequest): ApprovalQueueItem {
  const deadline = new Date(request.slaDeadline);
  const now = new Date();
  const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isOverdue = hoursRemaining < 0;

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
 * Hook for managing pending approvals for an approver
 */
export function usePendingApprovals(
  options: UsePendingApprovalsOptions = {}
): UsePendingApprovalsReturn {
  const { userId, role, autoFetch = false, refreshInterval } = options;

  const storePendingApprovals = useApprovalsStore((state) => state.pendingApprovals);
  const overdueApprovals = useApprovalsStore((state) => state.overdueApprovals);
  const nearingDeadlineApprovals = useApprovalsStore((state) => state.nearingDeadlineApprovals);
  const isLoading = useApprovalsStore((state) => state.pendingApprovalsLoading);

  const storeFetchPending = useApprovalsStore((state) => state.fetchPendingApprovals);
  const storeFetchPendingByRole = useApprovalsStore((state) => state.fetchPendingApprovalsByRole);
  const storeFetchOverdue = useApprovalsStore((state) => state.fetchOverdueApprovals);
  const storeFetchNearingDeadline = useApprovalsStore(
    (state) => state.fetchNearingDeadlineApprovals
  );

  // Use store's fetchApprovalRequests for general queue fetching
  const storeApprovalRequests = useApprovalsStore((state) => state.approvalRequests);

  // Transform to queue items - use general approvalRequests when no role/userId specified
  const pendingApprovals = useMemo(() => {
    // When neither role nor userId is specified, use general approval requests
    // (filtered by status via the fetch call)
    const sourceApprovals = (!role && !userId) ? storeApprovalRequests : storePendingApprovals;
    return sourceApprovals.map(toQueueItem);
  }, [storePendingApprovals, storeApprovalRequests, role, userId]);

  // Counts
  const pendingCount = pendingApprovals.length;
  const overdueCount = overdueApprovals.length;
  const urgentCount = useMemo(
    () => pendingApprovals.filter((a) => a.urgencyLevel === 'warning').length,
    [pendingApprovals]
  );
  const criticalCount = useMemo(
    () => pendingApprovals.filter((a) => a.urgencyLevel === 'critical').length,
    [pendingApprovals]
  );

  // Use store's fetchApprovalRequests for general queue fetching
  const storeFetchApprovalRequests = useApprovalsStore((state) => state.fetchApprovalRequests);

  const fetchPending = useCallback(async () => {
    if (role) {
      await storeFetchPendingByRole(role);
    } else if (userId) {
      await storeFetchPending(userId);
    } else {
      // When neither role nor userId is provided, fetch all pending/in_progress approvals
      await storeFetchApprovalRequests({ status: ['pending', 'in_progress'] });
    }
  }, [storeFetchPending, storeFetchPendingByRole, storeFetchApprovalRequests, userId, role]);

  const fetchOverdue = useCallback(async () => {
    await storeFetchOverdue();
  }, [storeFetchOverdue]);

  const fetchNearingDeadline = useCallback(
    async (withinHours?: number) => {
      await storeFetchNearingDeadline(withinHours);
    },
    [storeFetchNearingDeadline]
  );

  const refresh = useCallback(async () => {
    await Promise.all([fetchPending(), fetchOverdue(), fetchNearingDeadline()]);
  }, [fetchPending, fetchOverdue, fetchNearingDeadline]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, refresh]);

  // Refresh interval
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0) {
      const interval = setInterval(refresh, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, refresh]);

  return {
    pendingApprovals,
    overdueApprovals,
    nearingDeadlineApprovals,
    isLoading,
    pendingCount,
    overdueCount,
    urgentCount,
    criticalCount,
    fetchPending,
    fetchOverdue,
    fetchNearingDeadline,
    refresh,
  };
}

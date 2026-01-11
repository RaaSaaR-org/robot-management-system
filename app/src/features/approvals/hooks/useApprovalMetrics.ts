/**
 * @file useApprovalMetrics.ts
 * @description Hook for approval workflow metrics and SLA reporting
 * @feature approvals
 */

import { useCallback, useEffect } from 'react';
import { useApprovalsStore } from '../store';
import type { ApprovalMetrics, SLAComplianceReport, MeaningfulOversightMetrics } from '../types';

export interface UseApprovalMetricsOptions {
  autoFetch?: boolean;
}

export interface UseApprovalMetricsReturn {
  metrics: ApprovalMetrics | null;
  slaReport: SLAComplianceReport | null;
  oversightMetrics: MeaningfulOversightMetrics | null;
  isMetricsLoading: boolean;
  isSLAReportLoading: boolean;
  isOversightMetricsLoading: boolean;
  fetchMetrics: () => Promise<void>;
  fetchSLAReport: () => Promise<void>;
  fetchOversightMetrics: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

/**
 * Hook for accessing approval workflow metrics
 */
export function useApprovalMetrics(
  options: UseApprovalMetricsOptions = {}
): UseApprovalMetricsReturn {
  const { autoFetch = false } = options;

  const metrics = useApprovalsStore((state) => state.metrics);
  const slaReport = useApprovalsStore((state) => state.slaReport);
  const oversightMetrics = useApprovalsStore((state) => state.oversightMetrics);
  const isMetricsLoading = useApprovalsStore((state) => state.metricsLoading);
  const isSLAReportLoading = useApprovalsStore((state) => state.slaReportLoading);
  const isOversightMetricsLoading = useApprovalsStore((state) => state.oversightMetricsLoading);

  const storeFetchMetrics = useApprovalsStore((state) => state.fetchMetrics);
  const storeFetchSLAReport = useApprovalsStore((state) => state.fetchSLAReport);
  const storeFetchOversightMetrics = useApprovalsStore((state) => state.fetchOversightMetrics);

  const fetchMetrics = useCallback(async () => {
    await storeFetchMetrics();
  }, [storeFetchMetrics]);

  const fetchSLAReport = useCallback(async () => {
    await storeFetchSLAReport();
  }, [storeFetchSLAReport]);

  const fetchOversightMetrics = useCallback(async () => {
    await storeFetchOversightMetrics();
  }, [storeFetchOversightMetrics]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchMetrics(), fetchSLAReport(), fetchOversightMetrics()]);
  }, [fetchMetrics, fetchSLAReport, fetchOversightMetrics]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      refreshAll();
    }
  }, [autoFetch, refreshAll]);

  return {
    metrics,
    slaReport,
    oversightMetrics,
    isMetricsLoading,
    isSLAReportLoading,
    isOversightMetricsLoading,
    fetchMetrics,
    fetchSLAReport,
    fetchOversightMetrics,
    refreshAll,
  };
}

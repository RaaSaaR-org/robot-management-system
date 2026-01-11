/**
 * @file useOversight.ts
 * @description Main hook for human oversight dashboard
 * @feature oversight
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useOversightStore,
  selectDashboardStats,
  selectDashboardLoading,
  selectDashboardError,
  selectFleetOverview,
  selectFleetOverviewLoading,
  selectOversightLogs,
  selectLogsLoading,
} from '../store';
import type {
  OversightDashboardStats,
  FleetCapabilitiesOverview,
  OversightLog,
  OversightLogQueryParams,
} from '../types';

export interface UseOversightOptions {
  autoFetch?: boolean;
  refreshInterval?: number;
}

export interface UseOversightReturn {
  dashboardStats: OversightDashboardStats | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  fleetOverview: FleetCapabilitiesOverview | null;
  fleetOverviewLoading: boolean;
  oversightLogs: OversightLog[];
  logsLoading: boolean;
  fetchDashboard: () => Promise<void>;
  fetchFleetOverview: () => Promise<void>;
  fetchLogs: (params?: OversightLogQueryParams) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Main hook for oversight dashboard data
 */
export function useOversight(options: UseOversightOptions = {}): UseOversightReturn {
  const { autoFetch = false, refreshInterval } = options;

  const dashboardStats = useOversightStore(selectDashboardStats);
  const dashboardLoading = useOversightStore(selectDashboardLoading);
  const dashboardError = useOversightStore(selectDashboardError);
  const fleetOverview = useOversightStore(selectFleetOverview);
  const fleetOverviewLoading = useOversightStore(selectFleetOverviewLoading);
  const oversightLogs = useOversightStore(selectOversightLogs);
  const logsLoading = useOversightStore(selectLogsLoading);

  const storeFetchDashboard = useOversightStore((state) => state.fetchDashboardStats);
  const storeFetchFleetOverview = useOversightStore((state) => state.fetchFleetOverview);
  const storeFetchLogs = useOversightStore((state) => state.fetchOversightLogs);

  const fetchDashboard = useCallback(async () => {
    await storeFetchDashboard();
  }, [storeFetchDashboard]);

  const fetchFleetOverview = useCallback(async () => {
    await storeFetchFleetOverview();
  }, [storeFetchFleetOverview]);

  const fetchLogs = useCallback(
    async (params?: OversightLogQueryParams) => {
      await storeFetchLogs(params);
    },
    [storeFetchLogs]
  );

  const refresh = useCallback(async () => {
    await Promise.all([storeFetchDashboard(), storeFetchFleetOverview()]);
  }, [storeFetchDashboard, storeFetchFleetOverview]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, refresh]);

  // Refresh interval
  useEffect(() => {
    if (!refreshInterval) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, refresh]);

  return useMemo(
    () => ({
      dashboardStats,
      dashboardLoading,
      dashboardError,
      fleetOverview,
      fleetOverviewLoading,
      oversightLogs,
      logsLoading,
      fetchDashboard,
      fetchFleetOverview,
      fetchLogs,
      refresh,
    }),
    [
      dashboardStats,
      dashboardLoading,
      dashboardError,
      fleetOverview,
      fleetOverviewLoading,
      oversightLogs,
      logsLoading,
      fetchDashboard,
      fetchFleetOverview,
      fetchLogs,
      refresh,
    ]
  );
}

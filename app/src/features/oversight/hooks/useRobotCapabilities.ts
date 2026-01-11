/**
 * @file useRobotCapabilities.ts
 * @description Hook for robot capabilities display
 * @feature oversight
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useOversightStore,
  selectSelectedRobotId,
  selectRobotCapabilities,
  selectRobotCapabilitiesLoading,
} from '../store';
import type { RobotCapabilitiesSummary } from '../types';

export interface UseRobotCapabilitiesOptions {
  robotId?: string;
  autoFetch?: boolean;
}

export interface UseRobotCapabilitiesReturn {
  robotId: string | null;
  capabilities: RobotCapabilitiesSummary | null;
  isLoading: boolean;
  hasWarnings: boolean;
  hasErrors: boolean;
  hasLimitations: boolean;
  fetchCapabilities: (robotId: string) => Promise<void>;
  setSelectedRobot: (robotId: string | null) => void;
  clearSelection: () => void;
}

/**
 * Hook for fetching and displaying robot capabilities
 */
export function useRobotCapabilities(
  options: UseRobotCapabilitiesOptions = {}
): UseRobotCapabilitiesReturn {
  const { robotId: initialRobotId, autoFetch = false } = options;

  const selectedRobotId = useOversightStore(selectSelectedRobotId);
  const capabilities = useOversightStore(selectRobotCapabilities);
  const isLoading = useOversightStore(selectRobotCapabilitiesLoading);

  const storeFetchCapabilities = useOversightStore((state) => state.fetchRobotCapabilities);
  const storeSetSelectedRobotId = useOversightStore((state) => state.setSelectedRobotId);

  const fetchCapabilities = useCallback(
    async (id: string) => {
      await storeFetchCapabilities(id);
    },
    [storeFetchCapabilities]
  );

  const setSelectedRobot = useCallback(
    (id: string | null) => {
      storeSetSelectedRobotId(id);
      if (id) {
        fetchCapabilities(id);
      }
    },
    [storeSetSelectedRobotId, fetchCapabilities]
  );

  const clearSelection = useCallback(() => {
    storeSetSelectedRobotId(null);
  }, [storeSetSelectedRobotId]);

  // Computed flags
  const hasWarnings = useMemo(() => {
    return (capabilities?.warnings?.length ?? 0) > 0;
  }, [capabilities]);

  const hasErrors = useMemo(() => {
    return (capabilities?.errors?.length ?? 0) > 0;
  }, [capabilities]);

  const hasLimitations = useMemo(() => {
    return (capabilities?.limitations?.length ?? 0) > 0;
  }, [capabilities]);

  // Auto-fetch on mount if robotId provided
  useEffect(() => {
    if (autoFetch && initialRobotId) {
      fetchCapabilities(initialRobotId);
    }
  }, [autoFetch, initialRobotId, fetchCapabilities]);

  return useMemo(
    () => ({
      robotId: selectedRobotId,
      capabilities,
      isLoading,
      hasWarnings,
      hasErrors,
      hasLimitations,
      fetchCapabilities,
      setSelectedRobot,
      clearSelection,
    }),
    [
      selectedRobotId,
      capabilities,
      isLoading,
      hasWarnings,
      hasErrors,
      hasLimitations,
      fetchCapabilities,
      setSelectedRobot,
      clearSelection,
    ]
  );
}

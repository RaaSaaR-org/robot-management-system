/**
 * @file useManualControl.ts
 * @description Hook for manual control mode management
 * @feature oversight
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useOversightStore,
  selectActiveManualSessions,
  selectManualSessionsLoading,
} from '../store';
import type {
  ManualControlSession,
  ActivateManualModeInput,
  ManualModeResponse,
} from '../types';

export interface UseManualControlOptions {
  robotId?: string;
  autoFetch?: boolean;
}

export interface UseManualControlReturn {
  activeSessions: ManualControlSession[];
  isLoading: boolean;
  isActivating: boolean;
  isDeactivating: boolean;
  error: string | null;
  isRobotInManualMode: (robotId: string) => boolean;
  getSessionForRobot: (robotId: string) => ManualControlSession | undefined;
  activateManualMode: (input: ActivateManualModeInput) => Promise<ManualModeResponse>;
  deactivateManualMode: (robotId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing manual control mode
 */
export function useManualControl(options: UseManualControlOptions = {}): UseManualControlReturn {
  const { robotId, autoFetch = false } = options;

  const [isActivating, setIsActivating] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSessions = useOversightStore(selectActiveManualSessions);
  const isLoading = useOversightStore(selectManualSessionsLoading);

  const storeFetchSessions = useOversightStore((state) => state.fetchActiveManualSessions);
  const storeActivate = useOversightStore((state) => state.activateManualMode);
  const storeDeactivate = useOversightStore((state) => state.deactivateManualMode);

  const isRobotInManualMode = useCallback(
    (id: string) => {
      return activeSessions.some((s) => s.robotId === id && s.isActive);
    },
    [activeSessions]
  );

  const getSessionForRobot = useCallback(
    (id: string) => {
      return activeSessions.find((s) => s.robotId === id && s.isActive);
    },
    [activeSessions]
  );

  const activateManualMode = useCallback(
    async (input: ActivateManualModeInput): Promise<ManualModeResponse> => {
      setIsActivating(true);
      setError(null);

      try {
        const response = await storeActivate(input);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to activate manual mode';
        setError(message);
        throw err;
      } finally {
        setIsActivating(false);
      }
    },
    [storeActivate]
  );

  const deactivateManualMode = useCallback(
    async (id: string) => {
      setIsDeactivating(true);
      setError(null);

      try {
        await storeDeactivate(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to deactivate manual mode';
        setError(message);
        throw err;
      } finally {
        setIsDeactivating(false);
      }
    },
    [storeDeactivate]
  );

  const refresh = useCallback(async () => {
    await storeFetchSessions();
  }, [storeFetchSessions]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, refresh]);

  // Filter sessions by robotId if provided
  const filteredSessions = useMemo(() => {
    if (!robotId) return activeSessions;
    return activeSessions.filter((s) => s.robotId === robotId);
  }, [activeSessions, robotId]);

  return useMemo(
    () => ({
      activeSessions: filteredSessions,
      isLoading,
      isActivating,
      isDeactivating,
      error,
      isRobotInManualMode,
      getSessionForRobot,
      activateManualMode,
      deactivateManualMode,
      refresh,
    }),
    [
      filteredSessions,
      isLoading,
      isActivating,
      isDeactivating,
      error,
      isRobotInManualMode,
      getSessionForRobot,
      activateManualMode,
      deactivateManualMode,
      refresh,
    ]
  );
}

/**
 * @file useVerifications.ts
 * @description Hook for verification schedule management
 * @feature oversight
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useOversightStore,
  selectVerificationSchedules,
  selectDueVerifications,
  selectVerificationsLoading,
} from '../store';
import type {
  VerificationSchedule,
  DueVerification,
  CreateVerificationScheduleInput,
  CompleteVerificationInput,
  VerificationScheduleQueryParams,
} from '../types';

export interface UseVerificationsOptions {
  autoFetch?: boolean;
  refreshInterval?: number;
}

export interface UseVerificationsReturn {
  schedules: VerificationSchedule[];
  dueVerifications: DueVerification[];
  isLoading: boolean;
  isCreating: boolean;
  isCompleting: boolean;
  error: string | null;
  overdueCount: number;
  dueNowCount: number;
  fetchSchedules: (params?: VerificationScheduleQueryParams) => Promise<void>;
  fetchDueVerifications: () => Promise<void>;
  createSchedule: (input: CreateVerificationScheduleInput) => Promise<VerificationSchedule>;
  completeVerification: (input: CompleteVerificationInput) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing verification schedules
 */
export function useVerifications(options: UseVerificationsOptions = {}): UseVerificationsReturn {
  const { autoFetch = false, refreshInterval } = options;

  const [isCreating, setIsCreating] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schedules = useOversightStore(selectVerificationSchedules);
  const dueVerifications = useOversightStore(selectDueVerifications);
  const isLoading = useOversightStore(selectVerificationsLoading);

  const storeFetchSchedules = useOversightStore((state) => state.fetchVerificationSchedules);
  const storeFetchDue = useOversightStore((state) => state.fetchDueVerifications);
  const storeCreate = useOversightStore((state) => state.createVerificationSchedule);
  const storeComplete = useOversightStore((state) => state.completeVerification);

  const fetchSchedules = useCallback(
    async (params?: VerificationScheduleQueryParams) => {
      await storeFetchSchedules(params);
    },
    [storeFetchSchedules]
  );

  const fetchDueVerifications = useCallback(async () => {
    await storeFetchDue();
  }, [storeFetchDue]);

  const createSchedule = useCallback(
    async (input: CreateVerificationScheduleInput): Promise<VerificationSchedule> => {
      setIsCreating(true);
      setError(null);

      try {
        const schedule = await storeCreate(input);
        return schedule;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create schedule';
        setError(message);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [storeCreate]
  );

  const completeVerification = useCallback(
    async (input: CompleteVerificationInput) => {
      setIsCompleting(true);
      setError(null);

      try {
        await storeComplete(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to complete verification';
        setError(message);
        throw err;
      } finally {
        setIsCompleting(false);
      }
    },
    [storeComplete]
  );

  const refresh = useCallback(async () => {
    await Promise.all([storeFetchSchedules(), storeFetchDue()]);
  }, [storeFetchSchedules, storeFetchDue]);

  // Computed counts
  const overdueCount = useMemo(() => {
    return dueVerifications.filter((v) => v.overdueSinceMinutes > 0).length;
  }, [dueVerifications]);

  const dueNowCount = useMemo(() => {
    return dueVerifications.length;
  }, [dueVerifications]);

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
      schedules,
      dueVerifications,
      isLoading,
      isCreating,
      isCompleting,
      error,
      overdueCount,
      dueNowCount,
      fetchSchedules,
      fetchDueVerifications,
      createSchedule,
      completeVerification,
      refresh,
    }),
    [
      schedules,
      dueVerifications,
      isLoading,
      isCreating,
      isCompleting,
      error,
      overdueCount,
      dueNowCount,
      fetchSchedules,
      fetchDueVerifications,
      createSchedule,
      completeVerification,
      refresh,
    ]
  );
}

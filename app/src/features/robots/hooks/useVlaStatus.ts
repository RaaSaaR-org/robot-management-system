/**
 * @file useVlaStatus.ts
 * @description Hook for polling VLA status and controlling VLA start/stop via robot agent
 * @feature robots
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/api';

// ============================================================================
// TYPES
// ============================================================================

export interface VlaStatusResponse {
  robotId: string;
  active: boolean;
  status: {
    phase?: string;
    mode?: string;
    instruction?: string;
    bufferDepth?: number;
    bufferCount?: number;
    lastInferenceMs?: number;
    totalSteps?: number;
    errors?: number;
  } | null;
}

export interface UseVlaStatusReturn {
  /** Whether VLA is currently active/running */
  isActive: boolean;
  /** Current VLA status details */
  status: VlaStatusResponse['status'];
  /** Current prompt/instruction */
  prompt: string | null;
  /** Whether the status is being fetched */
  isLoading: boolean;
  /** Whether a start/stop operation is in progress */
  isExecuting: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Start VLA with a prompt and server URL */
  startVla: (prompt: string, serverUrl: string) => Promise<void>;
  /** Stop VLA */
  stopVla: () => Promise<void>;
  /** Manually refresh status */
  refresh: () => Promise<void>;
}

// ============================================================================
// HOOK
// ============================================================================

const VLA_POLL_INTERVAL = 3000;

export function useVlaStatus(robotId: string): UseVlaStatusReturn {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<VlaStatusResponse['status']>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await apiClient.get<VlaStatusResponse>(
        `/robots/${robotId}/proxy/vla`
      );
      if (!mountedRef.current) return;
      setIsActive(data.active);
      setStatus(data.status);
      setError(null);
    } catch {
      // Silently fail on polling — agent might be offline
      if (!mountedRef.current) return;
      setIsActive(false);
      setStatus(null);
    }
  }, [robotId]);

  // Initial fetch + polling
  useEffect(() => {
    mountedRef.current = true;

    setIsLoading(true);
    fetchStatus().finally(() => {
      if (mountedRef.current) setIsLoading(false);
    });

    intervalRef.current = setInterval(fetchStatus, VLA_POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  const startVla = useCallback(async (prompt: string, serverUrl: string) => {
    setIsExecuting(true);
    setError(null);
    try {
      await apiClient.post(`/robots/${robotId}/proxy/vla/start`, {
        instruction: prompt,
        config: { serverUrl },
      });
      if (mountedRef.current) {
        setIsActive(true);
        await fetchStatus();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to start VLA';
      setError(msg);
      throw err;
    } finally {
      if (mountedRef.current) setIsExecuting(false);
    }
  }, [robotId, fetchStatus]);

  const stopVla = useCallback(async () => {
    setIsExecuting(true);
    setError(null);
    try {
      await apiClient.post(`/robots/${robotId}/proxy/vla/stop`);
      if (mountedRef.current) {
        setIsActive(false);
        await fetchStatus();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to stop VLA';
      setError(msg);
      throw err;
    } finally {
      if (mountedRef.current) setIsExecuting(false);
    }
  }, [robotId, fetchStatus]);

  return {
    isActive,
    status,
    prompt: status?.instruction ?? null,
    isLoading,
    isExecuting,
    error,
    startVla,
    stopVla,
    refresh: fetchStatus,
  };
}

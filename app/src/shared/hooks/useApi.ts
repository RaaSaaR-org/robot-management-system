/**
 * @file useApi.ts
 * @description Hook for making API calls with loading, error, and success states
 * @feature shared
 * @dependencies api/client, shared/types/api.types
 * @stateAccess None
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ApiError, UseApiReturn, AsyncStatus } from '@/shared/types/api.types';

export interface UseApiOptions<T> {
  /** Execute immediately on mount */
  immediate?: boolean;
  /** Initial arguments for immediate execution */
  initialArgs?: unknown[];
  /** Callback on successful response */
  onSuccess?: (data: T) => void;
  /** Callback on error */
  onError?: (error: ApiError) => void;
  /** Callback when request completes (success or error) */
  onSettled?: () => void;
}

/**
 * A generic hook for making API calls with loading, error, and success state management.
 * Supports automatic cancellation on unmount and manual abort.
 *
 * @param apiFunction - The async function that performs the API call
 * @param options - Configuration options
 * @returns Object with data, error, status, and control functions
 *
 * @example
 * ```typescript
 * const { data, isLoading, error, execute } = useApi(
 *   (id: string) => robotsApi.get(id),
 *   {
 *     onSuccess: (robot) => console.log('Loaded robot:', robot.name),
 *     onError: (error) => toast.error(error.message),
 *   }
 * );
 *
 * // Execute the API call
 * await execute('robot-123');
 * ```
 */
export function useApi<T, Args extends unknown[] = unknown[]>(
  apiFunction: (...args: Args) => Promise<T>,
  options: UseApiOptions<T> = {}
): UseApiReturn<T> & { abort: () => void } {
  const { immediate = false, initialArgs = [], onSuccess, onError, onSettled } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [status, setStatus] = useState<AsyncStatus>('idle');

  // Use ref to track mounted state and abort controller
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight request
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Execute the API call
  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      // Cancel any existing request
      abort();

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      setStatus('loading');
      setError(null);

      try {
        const result = await apiFunction(...args);

        if (mountedRef.current) {
          setData(result);
          setStatus('success');
          onSuccess?.(result);
          onSettled?.();
        }

        return result;
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return null;
        }

        const apiError: ApiError = {
          code: 'UNKNOWN_ERROR',
          message: err instanceof Error ? err.message : 'An unknown error occurred',
          statusCode: 0,
          ...(typeof err === 'object' && err !== null ? err : {}),
        };

        if (mountedRef.current) {
          setError(apiError);
          setStatus('error');
          onError?.(apiError);
          onSettled?.();
        }

        return null;
      }
    },
    [apiFunction, onSuccess, onError, onSettled, abort]
  );

  // Reset state
  const reset = useCallback(() => {
    abort();
    setData(null);
    setError(null);
    setStatus('idle');
  }, [abort]);

  // Execute immediately if configured
  useEffect(() => {
    if (immediate) {
      execute(...(initialArgs as Args));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abort();
    };
  }, [abort]);

  return {
    data,
    error,
    status,
    isLoading: status === 'loading',
    isError: status === 'error',
    isSuccess: status === 'success',
    execute: execute as (...args: unknown[]) => Promise<T | null>,
    reset,
    abort,
  };
}

/**
 * A simpler version of useApi for one-time API calls that don't need
 * to be re-executed.
 */
export function useApiOnce<T>(
  apiFunction: () => Promise<T>,
  options: Omit<UseApiOptions<T>, 'immediate' | 'initialArgs'> = {}
): Omit<UseApiReturn<T>, 'execute'> {
  const result = useApi(apiFunction, { ...options, immediate: true });
  const { execute: _, ...rest } = result;
  return rest;
}

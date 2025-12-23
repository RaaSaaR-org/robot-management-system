/**
 * @file usePasswordReset.ts
 * @description Hook for password reset flow
 * @feature auth
 */

import { useCallback, useState } from 'react';
import { useAuthStore } from '../store/authStore';

export interface UsePasswordResetReturn {
  /** Request password reset */
  requestReset: (email: string) => Promise<string | undefined>;
  /** Reset password with token */
  resetPassword: (token: string, password: string) => Promise<void>;
  /** Whether operation is in progress */
  isLoading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Whether reset was requested */
  isResetRequested: boolean;
  /** Whether password was reset successfully */
  isResetComplete: boolean;
  /** Clear error message and reset state */
  clearError: () => void;
  /** Reset all state */
  reset: () => void;
}

/**
 * Hook for handling password reset flow
 */
export function usePasswordReset(): UsePasswordResetReturn {
  const storeForgotPassword = useAuthStore((state) => state.forgotPassword);
  const storeResetPassword = useAuthStore((state) => state.resetPassword);
  const storeIsLoading = useAuthStore((state) => state.isLoading);
  const storeError = useAuthStore((state) => state.error);
  const storeClearError = useAuthStore((state) => state.clearError);

  const [isResetRequested, setIsResetRequested] = useState(false);
  const [isResetComplete, setIsResetComplete] = useState(false);

  const requestReset = useCallback(
    async (email: string) => {
      setIsResetRequested(false);
      setIsResetComplete(false);
      try {
        const resetToken = await storeForgotPassword(email);
        setIsResetRequested(true);
        return resetToken;
      } catch {
        // Error is already handled in the store
        return undefined;
      }
    },
    [storeForgotPassword]
  );

  const resetPassword = useCallback(
    async (token: string, password: string) => {
      setIsResetComplete(false);
      try {
        await storeResetPassword(token, password);
        setIsResetComplete(true);
      } catch {
        // Error is already handled in the store
      }
    },
    [storeResetPassword]
  );

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  const reset = useCallback(() => {
    storeClearError();
    setIsResetRequested(false);
    setIsResetComplete(false);
  }, [storeClearError]);

  return {
    requestReset,
    resetPassword,
    isLoading: storeIsLoading,
    error: storeError,
    isResetRequested,
    isResetComplete,
    clearError,
    reset,
  };
}

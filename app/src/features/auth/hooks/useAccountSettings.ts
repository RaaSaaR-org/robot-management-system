/**
 * @file useAccountSettings.ts
 * @description Hook for account settings operations
 * @feature auth
 */

import { useCallback, useState } from 'react';
import { useAuthStore } from '../store/authStore';

export interface UseAccountSettingsReturn {
  /** Change user password */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Whether operation is in progress */
  isLoading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Whether operation was successful */
  isSuccess: boolean;
  /** Clear error message */
  clearError: () => void;
  /** Clear success state */
  clearSuccess: () => void;
}

/**
 * Hook for handling account settings operations
 */
export function useAccountSettings(): UseAccountSettingsReturn {
  const storeChangePassword = useAuthStore((state) => state.changePassword);
  const storeIsLoading = useAuthStore((state) => state.isLoading);
  const storeError = useAuthStore((state) => state.error);
  const storeClearError = useAuthStore((state) => state.clearError);

  const [isSuccess, setIsSuccess] = useState(false);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setIsSuccess(false);
      try {
        await storeChangePassword(currentPassword, newPassword);
        setIsSuccess(true);
      } catch {
        // Error is already handled in the store
        setIsSuccess(false);
      }
    },
    [storeChangePassword]
  );

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  const clearSuccess = useCallback(() => {
    setIsSuccess(false);
  }, []);

  return {
    changePassword,
    isLoading: storeIsLoading,
    error: storeError,
    isSuccess,
    clearError,
    clearSuccess,
  };
}

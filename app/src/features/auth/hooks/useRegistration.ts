/**
 * @file useRegistration.ts
 * @description Hook for user registration flow
 * @feature auth
 */

import { useCallback, useState } from 'react';
import { useAuthStore } from '../store/authStore';

export interface UseRegistrationReturn {
  /** Register a new user */
  register: (email: string, password: string, name: string) => Promise<void>;
  /** Whether registration is in progress */
  isLoading: boolean;
  /** Error message from registration attempt */
  error: string | null;
  /** Clear error message */
  clearError: () => void;
  /** Whether registration was successful */
  isSuccess: boolean;
}

/**
 * Hook for handling user registration
 */
export function useRegistration(): UseRegistrationReturn {
  const storeRegister = useAuthStore((state) => state.register);
  const storeIsLoading = useAuthStore((state) => state.isLoading);
  const storeError = useAuthStore((state) => state.error);
  const storeClearError = useAuthStore((state) => state.clearError);

  const [isSuccess, setIsSuccess] = useState(false);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      setIsSuccess(false);
      try {
        await storeRegister(email, password, name);
        setIsSuccess(true);
      } catch {
        // Error is already handled in the store
        setIsSuccess(false);
      }
    },
    [storeRegister]
  );

  const clearError = useCallback(() => {
    storeClearError();
    setIsSuccess(false);
  }, [storeClearError]);

  return {
    register,
    isLoading: storeIsLoading,
    error: storeError,
    clearError,
    isSuccess,
  };
}

/**
 * @file authStore.ts
 * @description Zustand store for authentication state management
 * @feature auth
 * @dependencies @/store, @/api/client, @/features/auth/api, @/features/auth/types
 * @stateAccess Creates: useAuthStore
 * @sideEffects Manages tokens in localStorage via tokenStorage
 */

import { createStore } from '@/store';
import { tokenStorage } from '@/api/client';
import { authApi } from '../api/authApi';
import { isMFAChallengeResponse } from '../types/auth.types';
import type { AuthStore, User, AuthErrorCode } from '../types/auth.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  user: null as User | null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,
  error: null as string | null,
  mustChangePassword: false,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

// TASK-164: keep the failure messages generic so we don't leak whether
// an email is registered or which tenant it belongs to.
const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_INVALID: 'Incorrect email or password.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  ACCOUNT_LOCKED: 'Incorrect email or password.',
  ACCOUNT_DISABLED: 'Incorrect email or password.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  NETWORK_ERROR: "Can't reach the server. Try again in a moment.",
  UNKNOWN_ERROR: 'Incorrect email or password.',
};

// ============================================================================
// STORE
// ============================================================================

export const useAuthStore = createStore<AuthStore>(
  (set, get) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Login Action (MFA-aware)
    // --------------------------------------------------------------------------
    login: async (email: string, password: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await authApi.loginWithMFA(email, password);

        // Check if MFA challenge is required
        if (isMFAChallengeResponse(response)) {
          set((state) => {
            state.isLoading = false;
          });
          // Throw a special error the LoginForm can catch to show MFA challenge
          const mfaError = new Error('MFA_REQUIRED');
          (mfaError as Error & { mfaToken: string; userId: string }).mfaToken = response.mfaToken;
          (mfaError as Error & { mfaToken: string; userId: string }).userId = response.userId;
          throw mfaError;
        }

        // Standard login — store tokens
        tokenStorage.setTokens(response.accessToken, response.refreshToken);

        set((state) => {
          state.user = response.user;
          state.isAuthenticated = true;
          state.isLoading = false;
          state.isInitialized = true;
          state.error = null;
          // TASK-164: server emits the gate on the login response; mirror
          // it into the store so ProtectedAppRoute can redirect.
          state.mustChangePassword =
            response.mustChangePassword === true ||
            response.user.forcePasswordChange === true;
        });
      } catch (error) {
        // Re-throw MFA_REQUIRED errors without mapping to error message
        if (error instanceof Error && error.message === 'MFA_REQUIRED') {
          throw error;
        }
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Complete MFA Login (after TOTP/recovery code verified)
    // --------------------------------------------------------------------------
    completeMFALogin: (response: { user: User; accessToken: string; refreshToken: string; mustChangePassword?: boolean }) => {
      tokenStorage.setTokens(response.accessToken, response.refreshToken);
      set((state) => {
        state.user = response.user;
        state.isAuthenticated = true;
        state.isLoading = false;
        state.isInitialized = true;
        state.error = null;
        state.mustChangePassword =
          response.mustChangePassword === true ||
          response.user.forcePasswordChange === true;
      });
    },

    // --------------------------------------------------------------------------
    // Logout Action
    // --------------------------------------------------------------------------
    logout: () => {
      // Clear tokens
      tokenStorage.clearTokens();

      // Try to call logout API (fire and forget)
      authApi.logout().catch(() => {
        // Ignore errors - we're logging out anyway
      });

      // Reset state
      set((state) => {
        state.user = null;
        state.isAuthenticated = false;
        state.error = null;
        state.mustChangePassword = false;
      });
    },

    // --------------------------------------------------------------------------
    // Refresh Session Action
    // --------------------------------------------------------------------------
    refreshSession: async () => {
      const refreshToken = tokenStorage.getRefreshToken();

      if (!refreshToken) {
        get().logout();
        return;
      }

      try {
        const response = await authApi.refresh(refreshToken);
        tokenStorage.setTokens(response.accessToken, response.refreshToken);
      } catch {
        // Refresh failed - logout
        get().logout();
      }
    },

    // --------------------------------------------------------------------------
    // Initialize Action
    // --------------------------------------------------------------------------
    initialize: async () => {
      const accessToken = tokenStorage.getAccessToken();

      if (!accessToken) {
        set((state) => {
          state.isInitialized = true;
        });
        return;
      }

      set((state) => {
        state.isLoading = true;
      });

      try {
        // Try to get current user with existing token
        const user = await authApi.getCurrentUser();

        set((state) => {
          state.user = user;
          state.isAuthenticated = true;
          state.isLoading = false;
          state.isInitialized = true;
          // TASK-164: hydrate the force-password-change gate from /me
          // so a page refresh during the "required" state still works.
          state.mustChangePassword = user.forcePasswordChange === true;
        });
      } catch {
        // Token invalid - try to refresh
        try {
          await get().refreshSession();
          const user = await authApi.getCurrentUser();

          set((state) => {
            state.user = user;
            state.isAuthenticated = true;
            state.isLoading = false;
            state.isInitialized = true;
            state.mustChangePassword = user.forcePasswordChange === true;
          });
        } catch {
          // Refresh failed - clear state
          tokenStorage.clearTokens();
          set((state) => {
            state.user = null;
            state.isAuthenticated = false;
            state.isLoading = false;
            state.isInitialized = true;
          });
        }
      }
    },

    // --------------------------------------------------------------------------
    // Utility Actions
    // --------------------------------------------------------------------------
    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    setUser: (user: User | null) => {
      set((state) => {
        state.user = user;
        state.isAuthenticated = user !== null;
      });
    },

    setLoading: (loading: boolean) => {
      set((state) => {
        state.isLoading = loading;
      });
    },

    // --------------------------------------------------------------------------
    // Dev Login Action (development only)
    // --------------------------------------------------------------------------
    devLogin: (user: User) => {
      set((state) => {
        state.user = user;
        state.isAuthenticated = true;
        state.isLoading = false;
        state.isInitialized = true;
        state.error = null;
      });
    },

    // --------------------------------------------------------------------------
    // Register Action
    // --------------------------------------------------------------------------
    register: async (email: string, password: string, name: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await authApi.register(email, password, name);

        // Store tokens
        tokenStorage.setTokens(response.accessToken, response.refreshToken);

        set((state) => {
          state.user = response.user;
          state.isAuthenticated = true;
          state.isLoading = false;
          state.isInitialized = true;
          state.error = null;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Forgot Password Action
    // --------------------------------------------------------------------------
    forgotPassword: async (email: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await authApi.forgotPassword(email);

        set((state) => {
          state.isLoading = false;
        });

        // Return reset token (only available in dev mode)
        return response.resetToken;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Reset Password Action
    // --------------------------------------------------------------------------
    resetPassword: async (token: string, password: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        await authApi.resetPassword(token, password);

        set((state) => {
          state.isLoading = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Change Password Action
    // --------------------------------------------------------------------------
    changePassword: async (currentPassword: string, newPassword: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        await authApi.changePassword(currentPassword, newPassword);

        set((state) => {
          state.isLoading = false;
          // TASK-164: server clears forcePasswordChange inside
          // updatePassword; mirror that here so ProtectedAppRoute stops
          // redirecting to /set-password.
          state.mustChangePassword = false;
          if (state.user) {
            state.user = { ...state.user, forcePasswordChange: false };
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Clear force-password-change gate (TASK-164)
    // --------------------------------------------------------------------------
    clearMustChangePassword: () => {
      set((state) => {
        state.mustChangePassword = false;
        if (state.user) {
          state.user = { ...state.user, forcePasswordChange: false };
        }
      });
    },
  }),
  {
    name: 'AuthStore',
    persist: true,
    partialize: (state) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
    }),
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select the current user */
export const selectUser = (state: AuthStore) => state.user;

/** Select authentication status */
export const selectIsAuthenticated = (state: AuthStore) => state.isAuthenticated;

/** Select loading status */
export const selectIsLoading = (state: AuthStore) => state.isLoading;

/** Select initialization status */
export const selectIsInitialized = (state: AuthStore) => state.isInitialized;

/** Select error message */
export const selectError = (state: AuthStore) => state.error;

/** Select user role */
export const selectUserRole = (state: AuthStore) => state.user?.role ?? null;

/** Select force-password-change gate (TASK-164) */
export const selectMustChangePassword = (state: AuthStore) =>
  state.mustChangePassword;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract error message from API error
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    // Check for API error format
    if ('code' in error && typeof error.code === 'string') {
      const code = error.code as AuthErrorCode;
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }

    // Check for message property
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    // Check for response.data.message (Axios error format)
    if ('response' in error) {
      const response = error.response as { data?: { message?: string } };
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

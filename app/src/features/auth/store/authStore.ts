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
import { getErrorStatus } from '@/shared/utils';
import { useFeaturesStore } from '@/shared/hooks/useFeatures';
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

// TASK-164 note: login error hygiene is enforced server-side —
// /api/auth/login always returns `message: "Incorrect email or password."`
// for any 4xx. These fallbacks below are used ONLY when the server
// didn't provide a message (network down, unknown code, etc.) so they
// need to stay generic enough to not lie about the context.
const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_INVALID: 'Your session is invalid. Please sign in again.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  ACCOUNT_LOCKED:
    'Too many failed attempts. Please try again in a few minutes.',
  ACCOUNT_DISABLED: 'This account is not active.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  NETWORK_ERROR: "Can't reach the server. Try again in a moment.",
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

/** Whether the server refused the credentials (as opposed to a transient failure). */
function isAuthRejection(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 401 || status === 403;
}

/**
 * Whether the server runs without sign-in (TASK-483). Asks the public feature
 * snapshot and waits for the answer; anything but an explicit "not required"
 * — an older server, an outage — counts as required, the state the app was in
 * before it could ask.
 */
async function serverNeedsNoSignIn(): Promise<boolean> {
  await useFeaturesStore.getState().fetch();
  const { loaded, flags } = useFeaturesStore.getState();
  return loaded && flags.signInRequired === false;
}

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
      } catch (error) {
        // Only a rejected refresh token ends the session; a 429, a 5xx or a
        // network error keeps it for the next attempt (TASK-362).
        if (isAuthRejection(error)) {
          get().logout();
          return;
        }
        throw error;
      }
    },

    // --------------------------------------------------------------------------
    // Initialize Action
    // --------------------------------------------------------------------------
    initialize: async () => {
      const accessToken = tokenStorage.getAccessToken();

      if (!accessToken) {
        // A returning visitor's remembered user opens the shell at once here
        // too (TASK-482): on a server without sign-in the two requests below
        // only confirm it, and a throttled or slow answer must not be a
        // spinner on an empty page. Every way out of this branch ends
        // initialized, with this session kept unless /me replaces it.
        const remembered = get().isAuthenticated ? get().user : null;
        if (remembered) {
          set((state) => {
            state.isInitialized = true;
          });
        }

        // TASK-483: a server without sign-in answers /me for anyone, as its one
        // shared user. Ask it instead of demanding a token nobody can obtain.
        if (await serverNeedsNoSignIn()) {
          if (!remembered) {
            set((state) => {
              state.isLoading = true;
            });
          }
          try {
            const user = await authApi.getCurrentUser();
            set((state) => {
              state.user = user;
              state.isAuthenticated = true;
              state.isLoading = false;
              state.isInitialized = true;
              state.mustChangePassword = false;
            });
          } catch {
            // The remembered shared user stays: nothing here can refuse it.
            if (remembered) return;
            // Unreachable or rate limited. Not signed out — there is nothing
            // to sign in to — so the route guard offers a retry instead.
            set((state) => {
              state.user = null;
              state.isAuthenticated = false;
              state.isLoading = false;
              state.isInitialized = true;
            });
          }
          return;
        }

        // Sign-in is required, or the server could not say yet (see the
        // feature-snapshot subscription below the store). A persisted session
        // is left as it is: the dev server and the static demo build sign in
        // their bundled user without a token.
        set((state) => {
          state.isInitialized = true;
        });
        return;
      }

      // A session this browser already knows (the persisted user) opens the
      // shell at once and is confirmed behind it. Waiting for /me first meant
      // a throttled or slow /me was a blank page with a spinner (TASK-482).
      const known = get().isAuthenticated ? get().user : null;
      if (known) {
        set((state) => {
          state.isInitialized = true;
          state.mustChangePassword = known.forcePasswordChange === true;
        });
      } else {
        set((state) => {
          state.isLoading = true;
        });
      }

      const accept = (user: User) => {
        set((state) => {
          state.user = user;
          state.isAuthenticated = true;
          state.isLoading = false;
          state.isInitialized = true;
          // TASK-164: hydrate the force-password-change gate from /me
          // so a page refresh during the "required" state still works.
          state.mustChangePassword = user.forcePasswordChange === true;
        });
      };
      // The known session outlives anything but the server refusing it: a
      // rate limit, an outage or a dropped connection says nothing about it.
      const keepKnownSession = (error: unknown) => known !== null && !isAuthRejection(error);

      try {
        // Try to get current user with existing token
        accept(await authApi.getCurrentUser());
      } catch (firstError) {
        if (keepKnownSession(firstError)) return;
        // Token invalid - try to refresh
        try {
          await get().refreshSession();
          accept(await authApi.getCurrentUser());
        } catch (error) {
          if (keepKnownSession(error)) return;
          // Refresh failed. Drop the tokens only when the server rejected
          // them — a rate limit or an outage is not a logout (TASK-362).
          if (isAuthRejection(error)) tokenStorage.clearTokens();
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

// TASK-483: the feature snapshot can arrive after the session was settled — it
// failed while the app booted, so a token-less browser was taken for signed out,
// and `useFeatures` fetched it again a few seconds later. If it then says that
// no sign-in is needed, load the shared user right away; otherwise the visitor
// sits on a retry screen for a server that is answering.
useFeaturesStore.subscribe((features, previous) => {
  if (!features.loaded || previous.loaded || features.flags.signInRequired !== false) return;
  const auth = useAuthStore.getState();
  if (!auth.isInitialized || auth.isAuthenticated || auth.isLoading) return;
  void auth.initialize();
});

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
 * Extract error message from API error. The server is authoritative —
 * prefer `error.message` (set by the axios interceptor in client.ts)
 * over the local code→message map. The local map is only used as a
 * fallback when we have no server text (offline, 500 with no body).
 *
 * Rationale: TASK-164 mapped UNKNOWN_ERROR → "Incorrect email or
 * password." for login hygiene. Without this ordering, every
 * non-login flow (change password, etc.) started showing the login
 * text when the server returned a different 4xx. The login flow
 * stays hygienic because the server itself returns the generic
 * string for any 4xx on /login.
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    // 1. Server text wins
    if (
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string' &&
      (error as { message: string }).message
    ) {
      return (error as { message: string }).message;
    }

    // 2. Axios-style nested shape as last-resort (shouldn't hit after interceptor)
    if ('response' in error) {
      const response = (error as { response?: { data?: { message?: string } } })
        .response;
      if (response?.data?.message) {
        return response.data.message;
      }
    }

    // 3. Local code→message fallback for known auth codes
    if ('code' in error && typeof (error as { code: unknown }).code === 'string') {
      const code = (error as { code: string }).code as AuthErrorCode;
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

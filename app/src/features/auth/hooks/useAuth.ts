/**
 * @file useAuth.ts
 * @description React hook for authentication operations and state
 * @feature auth
 * @dependencies @/features/auth/store, @/features/auth/types
 * @stateAccess useAuthStore (read/write)
 */

import { useCallback, useMemo } from 'react';
import { useAuthStore, selectUser, selectIsAuthenticated, selectIsLoading, selectIsInitialized, selectError, selectUserRole } from '../store/authStore';
import { hasPermission, hasAnyPermission, hasAllPermissions } from '../types/auth.types';
import type { Permission, User, UserRole } from '../types/auth.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseAuthReturn {
  /** Current authenticated user */
  user: User | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether auth operation is in progress */
  isLoading: boolean;
  /** Whether initial auth check is complete */
  isInitialized: boolean;
  /** Error message from last auth operation */
  error: string | null;
  /** Current user's role */
  role: UserRole | null;
  /** Login with email and password */
  login: (email: string, password: string) => Promise<void>;
  /** Logout current user */
  logout: () => void;
  /** Clear error message */
  clearError: () => void;
  /** Check if user has a specific permission */
  can: (permission: Permission) => boolean;
  /** Check if user has any of the specified permissions */
  canAny: (permissions: Permission[]) => boolean;
  /** Check if user has all specified permissions */
  canAll: (permissions: Permission[]) => boolean;
  /** Check if user has a specific role */
  hasRole: (role: UserRole) => boolean;
  /** Check if user has any of the specified roles */
  hasAnyRole: (roles: UserRole[]) => boolean;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for accessing authentication state and operations.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, login, logout, can } = useAuth();
 *
 *   if (!isAuthenticated) {
 *     return <LoginForm />;
 *   }
 *
 *   return (
 *     <div>
 *       <p>Welcome, {user?.name}</p>
 *       {can('robots:command') && <CommandButton />}
 *       <button onClick={logout}>Logout</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAuth(): UseAuthReturn {
  // Select state from store
  const user = useAuthStore(selectUser);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isLoading = useAuthStore(selectIsLoading);
  const isInitialized = useAuthStore(selectIsInitialized);
  const error = useAuthStore(selectError);
  const role = useAuthStore(selectUserRole);

  // Get actions from store
  const storeLogin = useAuthStore((state) => state.login);
  const storeLogout = useAuthStore((state) => state.logout);
  const storeClearError = useAuthStore((state) => state.clearError);

  // Memoized login function
  const login = useCallback(
    async (email: string, password: string) => {
      await storeLogin(email, password);
    },
    [storeLogin]
  );

  // Memoized logout function
  const logout = useCallback(() => {
    storeLogout();
  }, [storeLogout]);

  // Memoized clear error function
  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  // Permission check functions
  const can = useCallback(
    (permission: Permission) => hasPermission(user, permission),
    [user]
  );

  const canAny = useCallback(
    (permissions: Permission[]) => hasAnyPermission(user, permissions),
    [user]
  );

  const canAll = useCallback(
    (permissions: Permission[]) => hasAllPermissions(user, permissions),
    [user]
  );

  // Role check functions
  const hasRole = useCallback(
    (checkRole: UserRole) => user?.role === checkRole,
    [user]
  );

  const hasAnyRole = useCallback(
    (roles: UserRole[]) => user !== null && roles.includes(user.role),
    [user]
  );

  // Memoize the return object
  return useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      isInitialized,
      error,
      role,
      login,
      logout,
      clearError,
      can,
      canAny,
      canAll,
      hasRole,
      hasAnyRole,
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      isInitialized,
      error,
      role,
      login,
      logout,
      clearError,
      can,
      canAny,
      canAll,
      hasRole,
      hasAnyRole,
    ]
  );
}

// ============================================================================
// ADDITIONAL HOOKS
// ============================================================================

/**
 * Hook for initializing auth state on app load.
 * Should be called once at the app root level.
 */
export function useAuthInitialize(): void {
  const initialize = useAuthStore((state) => state.initialize);
  const isInitialized = useAuthStore(selectIsInitialized);

  // Initialize on mount if not already initialized
  if (!isInitialized) {
    initialize();
  }
}

/**
 * Hook for checking a specific permission.
 * Optimized for components that only need permission checks.
 */
export function usePermission(permission: Permission): boolean {
  const user = useAuthStore(selectUser);
  return useMemo(() => hasPermission(user, permission), [user, permission]);
}

/**
 * Hook for checking if user has a specific role.
 * Optimized for components that only need role checks.
 */
export function useRole(role: UserRole): boolean {
  const userRole = useAuthStore(selectUserRole);
  return userRole === role;
}

/**
 * Hook for getting just the current user.
 * Optimized for components that only need user data.
 */
export function useCurrentUser(): User | null {
  return useAuthStore(selectUser);
}

/**
 * Hook for checking authentication status.
 * Optimized for components that only need auth status.
 */
export function useIsAuthenticated(): boolean {
  return useAuthStore(selectIsAuthenticated);
}

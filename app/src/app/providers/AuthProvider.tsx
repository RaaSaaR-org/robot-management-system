/**
 * @file AuthProvider.tsx
 * @description Context provider for authentication state and initialization
 * @feature auth
 * @dependencies @/features/auth/store, @/features/auth/hooks
 * @stateAccess useAuthStore (read)
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { Spinner } from '@/shared/components/ui';
import type { User, UserRole, Permission } from '@/features/auth/types/auth.types';
import { hasPermission, hasAnyPermission, hasAllPermissions } from '@/features/auth/types/auth.types';
import { MOCK_USER } from '@/mocks/mockData';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthContextType {
  /** Current authenticated user */
  user: User | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether auth is loading */
  isLoading: boolean;
  /** Whether initial auth check is complete */
  isInitialized: boolean;
  /** Check if user has a specific permission */
  can: (permission: Permission) => boolean;
  /** Check if user has any of the specified permissions */
  canAny: (permissions: Permission[]) => boolean;
  /** Check if user has all specified permissions */
  canAll: (permissions: Permission[]) => boolean;
  /** Check if user has a specific role */
  hasRole: (role: UserRole) => boolean;
}

export interface AuthProviderProps {
  children: ReactNode;
  /** Show loading spinner during initialization (default: true) */
  showLoadingSpinner?: boolean;
  /** Custom loading component */
  loadingComponent?: ReactNode;
}

// ============================================================================
// CONTEXT
// ============================================================================

const AuthContext = createContext<AuthContextType | null>(null);

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * Provides authentication context to the application.
 * Handles initialization of auth state from stored tokens.
 *
 * @example
 * ```tsx
 * // In App.tsx or main entry
 * function App() {
 *   return (
 *     <AuthProvider>
 *       <Router />
 *     </AuthProvider>
 *   );
 * }
 *
 * // In a component
 * function MyComponent() {
 *   const { user, isAuthenticated, can } = useAuthContext();
 *   // ...
 * }
 * ```
 */
export function AuthProvider({
  children,
  showLoadingSpinner = true,
  loadingComponent,
}: AuthProviderProps) {
  // Get state and actions from store
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const initialize = useAuthStore((state) => state.initialize);
  const devLogin = useAuthStore((state) => state.devLogin);

  // Initialize auth state on mount
  useEffect(() => {
    if (!isInitialized) {
      // In development mode, auto-login with mock user
      if (import.meta.env.DEV) {
        devLogin(MOCK_USER);
      } else {
        initialize();
      }
    }
  }, [initialize, devLogin, isInitialized]);

  // Permission check functions
  const can = (permission: Permission) => hasPermission(user, permission);
  const canAny = (permissions: Permission[]) => hasAnyPermission(user, permissions);
  const canAll = (permissions: Permission[]) => hasAllPermissions(user, permissions);
  const hasRole = (role: UserRole) => user?.role === role;

  // Context value
  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    isInitialized,
    can,
    canAny,
    canAll,
    hasRole,
  };

  // Show loading state during initialization
  if (!isInitialized && showLoadingSpinner) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }

    return (
      <div
        className="flex min-h-screen items-center justify-center bg-theme-card"
        role="status"
        aria-busy="true"
        aria-label="Loading authentication"
      >
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" color="cobalt" />
          <p className="text-theme-secondary text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access the auth context.
 * Must be used within an AuthProvider.
 *
 * @throws Error if used outside of AuthProvider
 */
export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }

  return context;
}

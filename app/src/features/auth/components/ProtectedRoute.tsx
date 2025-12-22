/**
 * @file ProtectedRoute.tsx
 * @description Route guard component for protected routes with optional role-based access
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 * @stateAccess useAuth (read)
 */

import { type ReactNode } from 'react';
import { Spinner } from '@/shared/components/ui';
import { useAuth } from '../hooks/useAuth';
import type { UserRole, Permission } from '../types/auth.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ProtectedRouteProps {
  /** Content to render when authorized */
  children: ReactNode;
  /** Required role for access (optional) */
  requiredRole?: UserRole;
  /** Required roles - user must have one of these (optional) */
  requiredRoles?: UserRole[];
  /** Required permission for access (optional) */
  requiredPermission?: Permission;
  /** Required permissions - user must have all of these (optional) */
  requiredPermissions?: Permission[];
  /** Content to show while checking auth */
  loadingFallback?: ReactNode;
  /** Content to show when not authenticated */
  unauthenticatedFallback?: ReactNode;
  /** Content to show when not authorized (wrong role/permission) */
  unauthorizedFallback?: ReactNode;
  /** Callback when redirect to login is needed */
  onUnauthenticated?: () => void;
  /** Callback when access is denied */
  onUnauthorized?: () => void;
}

// ============================================================================
// DEFAULT FALLBACKS
// ============================================================================

function DefaultLoadingFallback() {
  return (
    <div
      className="flex min-h-[400px] items-center justify-center"
      role="status"
      aria-busy="true"
      aria-label="Checking authentication"
    >
      <Spinner size="lg" color="cobalt" />
    </div>
  );
}

function DefaultUnauthenticatedFallback() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-amber-100 p-4 dark:bg-amber-900/30">
        <svg
          className="h-8 w-8 text-amber-600 dark:text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6V8a4 4 0 00-8 0v3m12 0a2 2 0 01-2 2H6a2 2 0 01-2-2V8a6 6 0 1112 0v3z"
          />
        </svg>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-theme-primary">
          Authentication Required
        </h2>
        <p className="mt-1 text-sm text-theme-secondary">
          Please sign in to access this page.
        </p>
      </div>
    </div>
  );
}

function DefaultUnauthorizedFallback() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
        <svg
          className="h-8 w-8 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 0A9 9 0 005.636 18.364"
          />
        </svg>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-theme-primary">
          Access Denied
        </h2>
        <p className="mt-1 text-sm text-theme-secondary">
          You don't have permission to access this page.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Protects routes based on authentication and optional role/permission requirements.
 * Shows loading state while checking auth, and appropriate fallbacks for
 * unauthenticated or unauthorized users.
 *
 * @example
 * ```tsx
 * // Basic protection - just requires authentication
 * <ProtectedRoute>
 *   <Dashboard />
 * </ProtectedRoute>
 *
 * // Role-based protection
 * <ProtectedRoute requiredRole="admin">
 *   <AdminPanel />
 * </ProtectedRoute>
 *
 * // Permission-based protection
 * <ProtectedRoute requiredPermission="robots:command">
 *   <RobotControls />
 * </ProtectedRoute>
 *
 * // With redirect callback
 * <ProtectedRoute onUnauthenticated={() => navigate('/login')}>
 *   <ProtectedContent />
 * </ProtectedRoute>
 * ```
 */
export function ProtectedRoute({
  children,
  requiredRole,
  requiredRoles,
  requiredPermission,
  requiredPermissions,
  loadingFallback,
  unauthenticatedFallback,
  unauthorizedFallback,
  onUnauthenticated,
  onUnauthorized,
}: ProtectedRouteProps) {
  const { isAuthenticated, isInitialized, isLoading, hasRole, hasAnyRole, can, canAll } = useAuth();

  // Still initializing auth state
  if (!isInitialized || isLoading) {
    return <>{loadingFallback ?? <DefaultLoadingFallback />}</>;
  }

  // Not authenticated
  if (!isAuthenticated) {
    onUnauthenticated?.();
    return <>{unauthenticatedFallback ?? <DefaultUnauthenticatedFallback />}</>;
  }

  // Check role requirements
  if (requiredRole && !hasRole(requiredRole)) {
    onUnauthorized?.();
    return <>{unauthorizedFallback ?? <DefaultUnauthorizedFallback />}</>;
  }

  if (requiredRoles && requiredRoles.length > 0 && !hasAnyRole(requiredRoles)) {
    onUnauthorized?.();
    return <>{unauthorizedFallback ?? <DefaultUnauthorizedFallback />}</>;
  }

  // Check permission requirements
  if (requiredPermission && !can(requiredPermission)) {
    onUnauthorized?.();
    return <>{unauthorizedFallback ?? <DefaultUnauthorizedFallback />}</>;
  }

  if (requiredPermissions && requiredPermissions.length > 0 && !canAll(requiredPermissions)) {
    onUnauthorized?.();
    return <>{unauthorizedFallback ?? <DefaultUnauthorizedFallback />}</>;
  }

  // Authorized - render children
  return <>{children}</>;
}

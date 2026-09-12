/**
 * @file ProtectedRoute.tsx
 * @description Route guard component for protected routes with optional role-based access
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 * @stateAccess useAuth (read)
 */

import { type ReactNode } from 'react';
import { LockKeyhole, ShieldOff } from 'lucide-react';
import { EmptyState, LinkButton, Spinner } from '@/shared/components/ui';
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
      <Spinner size="lg" color="primary" />
    </div>
  );
}

function DefaultUnauthenticatedFallback() {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <EmptyState
        icon={<LockKeyhole />}
        title="Sign in to see this page"
        description="Your session ended or you haven't signed in yet."
        action={<LinkButton to="/login">Sign in</LinkButton>}
      />
    </div>
  );
}

function DefaultUnauthorizedFallback() {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <EmptyState
        icon={<ShieldOff />}
        title="You don't have access to this page"
        description="Ask an owner of your organization for a role that includes it."
        action={<LinkButton to="/dashboard" variant="secondary">Back to dashboard</LinkButton>}
      />
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

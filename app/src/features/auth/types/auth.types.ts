/**
 * @file auth.types.ts
 * @description Type definitions for authentication and authorization
 * @feature auth
 * @dependencies None
 */

// ============================================================================
// ROLE TYPES
// ============================================================================

/** User roles for RBAC */
export type UserRole = 'admin' | 'operator' | 'viewer';

/** Permission levels for different actions */
export type Permission =
  | 'robots:read'
  | 'robots:write'
  | 'robots:command'
  | 'tasks:read'
  | 'tasks:write'
  | 'tasks:cancel'
  | 'alerts:read'
  | 'alerts:acknowledge'
  | 'fleet:read'
  | 'fleet:manage'
  | 'users:read'
  | 'users:manage';

// ============================================================================
// USER TYPES
// ============================================================================

/** User entity */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar?: string;
  tenantId?: string;
  permissions?: Permission[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

// ============================================================================
// AUTH REQUEST/RESPONSE TYPES
// ============================================================================

/** Login request payload */
export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/** Login response payload */
export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Token refresh request */
export interface RefreshRequest {
  refreshToken: string;
}

/** Token refresh response */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Registration request */
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

/** Registration response (same as login response) */
export type RegisterResponse = LoginResponse;

/** Forgot password request */
export interface ForgotPasswordRequest {
  email: string;
}

/** Forgot password response */
export interface ForgotPasswordResponse {
  message: string;
  resetToken?: string; // Only returned in dev mode
}

/** Reset password request */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/** Change password request */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ============================================================================
// AUTH STATE TYPES
// ============================================================================

/** Authentication state */
export interface AuthState {
  /** Current authenticated user */
  user: User | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Loading state for auth operations */
  isLoading: boolean;
  /** Whether initial auth check is complete */
  isInitialized: boolean;
  /** Error message from last auth operation */
  error: string | null;
}

/** Authentication actions */
export interface AuthActions {
  /** Login with email and password */
  login: (email: string, password: string) => Promise<void>;
  /** Logout and clear tokens */
  logout: () => void;
  /** Refresh the session using refresh token */
  refreshSession: () => Promise<void>;
  /** Initialize auth state from stored tokens */
  initialize: () => Promise<void>;
  /** Clear error state */
  clearError: () => void;
  /** Update user data */
  setUser: (user: User | null) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Development-only login without API call */
  devLogin: (user: User) => void;
  /** Register a new user */
  register: (email: string, password: string, name: string) => Promise<void>;
  /** Request password reset */
  forgotPassword: (email: string) => Promise<string | undefined>;
  /** Reset password with token */
  resetPassword: (token: string, password: string) => Promise<void>;
  /** Change password for authenticated user */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

/** Combined auth store type */
export type AuthStore = AuthState & AuthActions;

// ============================================================================
// AUTH ERROR TYPES
// ============================================================================

/** Authentication error codes */
export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/** Authentication error */
export interface AuthError {
  code: AuthErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// ROLE PERMISSION MAPPING
// ============================================================================

/** Default permissions for each role */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'robots:read',
    'robots:write',
    'robots:command',
    'tasks:read',
    'tasks:write',
    'tasks:cancel',
    'alerts:read',
    'alerts:acknowledge',
    'fleet:read',
    'fleet:manage',
    'users:read',
    'users:manage',
  ],
  operator: [
    'robots:read',
    'robots:command',
    'tasks:read',
    'tasks:write',
    'tasks:cancel',
    'alerts:read',
    'alerts:acknowledge',
    'fleet:read',
  ],
  viewer: [
    'robots:read',
    'tasks:read',
    'alerts:read',
    'fleet:read',
  ],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a user has a specific permission
 */
export function hasPermission(user: User | null, permission: Permission): boolean {
  if (!user) return false;

  // Check explicit permissions first
  if (user.permissions?.includes(permission)) return true;

  // Fall back to role-based permissions
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

/**
 * Check if a user has any of the specified permissions
 */
export function hasAnyPermission(user: User | null, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

/**
 * Check if a user has all of the specified permissions
 */
export function hasAllPermissions(user: User | null, permissions: Permission[]): boolean {
  return permissions.every((permission) => hasPermission(user, permission));
}

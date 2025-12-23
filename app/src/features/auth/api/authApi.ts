/**
 * @file authApi.ts
 * @description API calls for authentication endpoints
 * @feature auth
 * @dependencies @/api/client, @/features/auth/types
 * @apiCalls POST /auth/login, POST /auth/logout, POST /auth/refresh, GET /auth/me, POST /auth/register, POST /auth/forgot-password, POST /auth/reset-password, POST /auth/change-password
 */

import { apiClient } from '@/api/client';
import type {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  ChangePasswordRequest,
  User,
} from '../types/auth.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  login: '/auth/login',
  logout: '/auth/logout',
  refresh: '/auth/refresh',
  me: '/auth/me',
  register: '/auth/register',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  changePassword: '/auth/change-password',
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const authApi = {
  /**
   * Authenticate user with email and password.
   * @param email - User email address
   * @param password - User password
   * @returns Login response with user data and tokens
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const payload: LoginRequest = { email, password };
    const response = await apiClient.post<LoginResponse>(ENDPOINTS.login, payload);
    return response.data;
  },

  /**
   * Logout current user and invalidate tokens.
   * @returns void
   */
  async logout(): Promise<void> {
    await apiClient.post(ENDPOINTS.logout);
  },

  /**
   * Refresh access token using refresh token.
   * @param refreshToken - Current refresh token
   * @returns New tokens
   */
  async refresh(refreshToken: string): Promise<RefreshResponse> {
    const payload: RefreshRequest = { refreshToken };
    const response = await apiClient.post<RefreshResponse>(ENDPOINTS.refresh, payload);
    return response.data;
  },

  /**
   * Get current authenticated user's profile.
   * @returns Current user data
   */
  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get<User>(ENDPOINTS.me);
    return response.data;
  },

  /**
   * Register a new user.
   * @param email - User email address
   * @param password - User password
   * @param name - User display name
   * @returns Registration response with user data and tokens
   */
  async register(
    email: string,
    password: string,
    name: string
  ): Promise<RegisterResponse> {
    const payload: RegisterRequest = { email, password, name };
    const response = await apiClient.post<RegisterResponse>(
      ENDPOINTS.register,
      payload
    );
    return response.data;
  },

  /**
   * Request a password reset.
   * @param email - User email address
   * @returns Response with message (and reset token in dev mode)
   */
  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    const payload: ForgotPasswordRequest = { email };
    const response = await apiClient.post<ForgotPasswordResponse>(
      ENDPOINTS.forgotPassword,
      payload
    );
    return response.data;
  },

  /**
   * Reset password using token.
   * @param token - Password reset token
   * @param password - New password
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const payload: ResetPasswordRequest = { token, password };
    await apiClient.post(ENDPOINTS.resetPassword, payload);
  },

  /**
   * Change password for authenticated user.
   * @param currentPassword - Current password
   * @param newPassword - New password
   */
  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const payload: ChangePasswordRequest = { currentPassword, newPassword };
    await apiClient.post(ENDPOINTS.changePassword, payload);
  },
};

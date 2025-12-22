/**
 * @file authApi.ts
 * @description API calls for authentication endpoints
 * @feature auth
 * @dependencies @/api/client, @/features/auth/types
 * @apiCalls POST /auth/login, POST /auth/logout, POST /auth/refresh, GET /auth/me
 */

import { apiClient } from '@/api/client';
import type {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
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
};

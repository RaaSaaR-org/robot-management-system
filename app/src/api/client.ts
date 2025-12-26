/**
 * @file client.ts
 * @description Configured Axios instance for REST API calls with interceptors
 * @feature api
 * @dependencies axios, shared/types/api.types
 * @sideEffects Sets up request/response interceptors
 */

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig, type AxiosRequestConfig } from 'axios';
import type { ApiError, ApiClientConfig, TokenStorage } from '@/shared/types/api.types';

// Extended request config to track refresh attempts
interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  _retryAfterRefresh?: boolean;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: ApiClientConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
};

// ============================================================================
// TOKEN STORAGE
// ============================================================================

/**
 * Default token storage implementation using localStorage.
 * Can be replaced with a custom implementation for different storage strategies.
 */
export const tokenStorage: TokenStorage = {
  getAccessToken: () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('access_token');
  },
  getRefreshToken: () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refresh_token');
  },
  setTokens: (access: string, refresh: string) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  },
  clearTokens: () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  },
};

// ============================================================================
// CLIENT INSTANCE
// ============================================================================

/**
 * Creates a configured Axios instance with interceptors for auth and error handling.
 */
function createApiClient(config: ApiClientConfig = DEFAULT_CONFIG): AxiosInstance {
  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // --------------------------------------------------------------------------
  // Request Interceptor
  // --------------------------------------------------------------------------

  client.interceptors.request.use(
    (requestConfig: InternalAxiosRequestConfig) => {
      const token = tokenStorage.getAccessToken();
      if (token && requestConfig.headers) {
        requestConfig.headers.Authorization = `Bearer ${token}`;
      }
      return requestConfig;
    },
    (error) => Promise.reject(error)
  );

  // --------------------------------------------------------------------------
  // Response Interceptor
  // --------------------------------------------------------------------------

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiError>) => {
      const originalRequest = error.config as ExtendedAxiosRequestConfig | undefined;

      // Handle 401 Unauthorized - attempt token refresh (only once)
      if (error.response?.status === 401 && originalRequest && !originalRequest._retryAfterRefresh) {
        const refreshToken = tokenStorage.getRefreshToken();

        if (refreshToken) {
          try {
            // Attempt to refresh the token
            const refreshResponse = await axios.post<{ accessToken: string; refreshToken: string }>(
              `${config.baseURL}/auth/refresh`,
              { refreshToken }
            );

            const { accessToken, refreshToken: newRefreshToken } = refreshResponse.data;
            tokenStorage.setTokens(accessToken, newRefreshToken);

            // Mark request to prevent infinite retry loop
            originalRequest._retryAfterRefresh = true;

            // Retry the original request with the new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            }
            return client.request(originalRequest);
          } catch {
            // Refresh failed - clear tokens and reject
            tokenStorage.clearTokens();
            return Promise.reject(createApiError(error));
          }
        }

        // No refresh token - clear tokens
        tokenStorage.clearTokens();
      }

      return Promise.reject(createApiError(error));
    }
  );

  return client;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Creates a standardized ApiError from an Axios error.
 */
function createApiError(error: AxiosError<ApiError>): ApiError {
  if (error.response?.data) {
    return {
      code: error.response.data.code || 'UNKNOWN_ERROR',
      message: error.response.data.message || 'An unknown error occurred',
      details: error.response.data.details,
      statusCode: error.response.status,
    };
  }

  if (error.request) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Unable to connect to the server. Please check your internet connection.',
      statusCode: 0,
    };
  }

  return {
    code: 'REQUEST_ERROR',
    message: error.message || 'An error occurred while preparing the request',
    statusCode: 0,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

/** The main API client instance */
export const apiClient = createApiClient();

/** Factory function for creating custom API clients */
export { createApiClient };

/** Re-export types for convenience */
export type { ApiError, ApiClientConfig, TokenStorage };

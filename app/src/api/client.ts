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
  /** How many times this request was already retried after a 429. */
  _rateLimitRetries?: number;
}

/** Longest a single 429 back-off may wait, whatever Retry-After says. */
const MAX_RATE_LIMIT_DELAY_MS = 10_000;

/**
 * Delay before retrying a 429: the server's `Retry-After` (seconds or an
 * HTTP date) when it sent one, else exponential back-off from `baseDelay`.
 */
export function rateLimitDelayMs(retryAfter: unknown, attempt: number, baseDelay: number): number {
  let ms: number | null = null;
  if (typeof retryAfter === 'string' && retryAfter.trim() !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) ms = seconds * 1000;
    else {
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) ms = date - Date.now();
    }
  }
  if (ms === null || ms < 0) ms = baseDelay * 2 ** attempt;
  return Math.min(ms, MAX_RATE_LIMIT_DELAY_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: ApiClientConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
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
// IMPERSONATION (super-admin only, client-side preference)
// ============================================================================

const IMPERSONATE_KEY = 'impersonate_tenant_id';

/**
 * Read/write the currently impersonated tenant id. When set, apiClient
 * attaches `X-Impersonate-Tenant` on every request. Server honors it
 * only for super-admin callers; any other role silently falls back to
 * its own tenant, so this storage key is safe to persist.
 */
export const impersonationStorage = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(IMPERSONATE_KEY);
  },
  set(tenantId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(IMPERSONATE_KEY, tenantId);
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(IMPERSONATE_KEY);
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
      const impersonate = impersonationStorage.get();
      if (impersonate && requestConfig.headers) {
        requestConfig.headers['X-Impersonate-Tenant'] = impersonate;
      }
      return requestConfig;
    },
    (error) => Promise.reject(error)
  );

  // --------------------------------------------------------------------------
  // Response Interceptor
  // --------------------------------------------------------------------------

  // One refresh at a time: with rotating refresh tokens, a second concurrent
  // refresh would present an already-rotated token and end the session.
  let refreshInFlight: Promise<string> | null = null;
  const refreshAccessToken = (refreshToken: string): Promise<string> => {
    if (!refreshInFlight) {
      refreshInFlight = axios
        .post<{ accessToken: string; refreshToken: string }>(`${config.baseURL}/auth/refresh`, {
          refreshToken,
        })
        .then(({ data }) => {
          tokenStorage.setTokens(data.accessToken, data.refreshToken);
          return data.accessToken;
        })
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  };

  const maxRateLimitRetries = config.maxRetries ?? DEFAULT_CONFIG.maxRetries ?? 3;
  const rateLimitBaseDelay = config.retryDelay ?? DEFAULT_CONFIG.retryDelay ?? 1000;

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiError>) => {
      const originalRequest = error.config as ExtendedAxiosRequestConfig | undefined;

      // 429 Too Many Requests — back off and retry; never a reason to end the
      // session (TASK-362).
      if (error.response?.status === 429 && originalRequest) {
        const attempt = originalRequest._rateLimitRetries ?? 0;
        if (attempt < maxRateLimitRetries) {
          originalRequest._rateLimitRetries = attempt + 1;
          await sleep(rateLimitDelayMs(error.response.headers?.['retry-after'], attempt, rateLimitBaseDelay));
          return client.request(originalRequest);
        }
        return Promise.reject(createApiError(error));
      }

      // Handle 401 Unauthorized - attempt token refresh (only once)
      if (error.response?.status === 401 && originalRequest && !originalRequest._retryAfterRefresh) {
        const refreshToken = tokenStorage.getRefreshToken();

        if (refreshToken) {
          try {
            const accessToken = await refreshAccessToken(refreshToken);

            // Mark request to prevent infinite retry loop
            originalRequest._retryAfterRefresh = true;

            // Retry the original request with the new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            }
            return client.request(originalRequest);
          } catch (refreshError) {
            // Only a rejected refresh token ends the session. A 429, a 5xx or
            // a network error leaves the tokens for the next attempt.
            const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
            if (status === 401 || status === 403) {
              tokenStorage.clearTokens();
            }
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
 * The rejection value of every `apiClient` call.
 *
 * It is a real `Error` — so `error instanceof Error` is true and
 * `getErrorMessage` / `errorMessage` keep the server's sentence — while
 * carrying `code`, `message`, `details` and `statusCode` as own properties,
 * exactly as the `ApiError` interface declares them.
 */
export class ApiRequestError extends Error implements ApiError {
  /** Machine-readable classification, e.g. `NETWORK_ERROR`. */
  readonly code: string;
  /** Structured detail the server attached, when it sent any. */
  readonly details?: Record<string, unknown>;
  /** HTTP status, or 0 when the request never reached the server. */
  readonly statusCode: number;

  constructor(init: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    statusCode: number;
  }) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.code = init.code;
    this.details = init.details;
    this.statusCode = init.statusCode;
    // Keep `instanceof` working when compiled down / across realms.
    Object.setPrototypeOf(this, ApiRequestError.prototype);
  }
}

/**
 * Creates a standardized ApiRequestError from an Axios error.
 */
function createApiError(error: AxiosError<ApiError>): ApiRequestError {
  if (error.response?.data) {
    // Server routes across the codebase use mixed error shapes:
    //   - { message: "..." }                  (most routes)
    //   - { error: "classification", message: "details" }   (auth routes)
    //   - { error: "human-readable message" } (simpler routes — tenants, settings)
    // Accept both so one convention doesn't swallow the other's error text.
    const data = error.response.data as ApiError & { error?: string };
    const message =
      data.message ||
      (typeof data.error === 'string' ? data.error : undefined) ||
      error.message ||
      'An unknown error occurred';
    return new ApiRequestError({
      code: data.code || 'UNKNOWN_ERROR',
      message,
      details: data.details,
      statusCode: error.response.status,
    });
  }

  if (error.request) {
    return new ApiRequestError({
      code: 'NETWORK_ERROR',
      message: 'Unable to connect to the server. Please check your internet connection.',
      statusCode: 0,
    });
  }

  return new ApiRequestError({
    code: 'REQUEST_ERROR',
    message: error.message || 'An error occurred while preparing the request',
    statusCode: 0,
  });
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

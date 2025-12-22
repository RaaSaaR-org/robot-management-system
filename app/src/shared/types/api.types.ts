/**
 * @file api.types.ts
 * @description API request/response type definitions
 * @feature shared
 * @dependencies common.types.ts
 */

import type { AsyncStatus, EntityId, ISOTimestamp } from './common.types';

// Re-export AsyncStatus for convenience
export type { AsyncStatus };

/** Standard API response wrapper */
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  timestamp: ISOTimestamp;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

/** API error response */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  statusCode: number;
}

/** Pagination request parameters */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** API request configuration */
export interface ApiRequestConfig {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
}

/** Hook return type for API calls */
export interface UseApiReturn<T> {
  data: T | null;
  error: ApiError | null;
  status: AsyncStatus;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  execute: (...args: unknown[]) => Promise<T | null>;
  reset: () => void;
}

/** WebSocket connection state */
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';

/** WebSocket message structure */
export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: ISOTimestamp;
  id?: EntityId;
}

/** WebSocket hook return type */
export interface UseWebSocketReturn<T = unknown> {
  status: WebSocketStatus;
  lastMessage: WebSocketMessage<T> | null;
  send: (message: WebSocketMessage<T>) => void;
  connect: () => void;
  disconnect: () => void;
}

/** Token storage interface for auth */
export interface TokenStorage {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (access: string, refresh: string) => void;
  clearTokens: () => void;
}

/** API client configuration */
export interface ApiClientConfig {
  baseURL: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

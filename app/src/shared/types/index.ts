/**
 * @file index.ts
 * @description Barrel export for shared types
 * @feature shared
 */

// Common types
export type {
  DeepPartial,
  Awaited,
  RequiredKeys,
  OptionalKeys,
  Nullable,
  EntityId,
  ISOTimestamp,
  AsyncStatus,
  Callback,
  EventHandler,
  PropsOf,
  PickRequired,
  NonUndefined,
} from './common.types';

// API types
export type {
  ApiResponse,
  PaginatedResponse,
  ApiError,
  PaginationParams,
  ApiRequestConfig,
  UseApiReturn,
  WebSocketStatus,
  WebSocketMessage,
  UseWebSocketReturn,
  TokenStorage,
  ApiClientConfig,
} from './api.types';

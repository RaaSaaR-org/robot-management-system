/**
 * @file index.ts
 * @description Barrel export for API layer
 * @feature api
 */

export { apiClient, ApiRequestError, createApiClient, tokenStorage } from './client';
export type { ApiError, ApiClientConfig, TokenStorage } from './client';

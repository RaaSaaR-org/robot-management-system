/**
 * @file index.ts
 * @description Barrel export for alerts API
 * @feature alerts
 */

export { alertsApi } from './alertsApi';
export type {
  AlertQueryFilters,
  PaginationParams,
  PaginatedResponse,
  ActiveAlertsResponse,
  AlertCountsResponse,
  ClearAlertsResponse,
} from './alertsApi';

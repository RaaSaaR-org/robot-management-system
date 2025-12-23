/**
 * @file alertsApi.ts
 * @description API calls for alert management endpoints
 * @feature alerts
 * @dependencies @/api/client, @/features/alerts/types
 * @apiCalls GET /alerts, GET /alerts/active, GET /alerts/history, GET /alerts/counts, POST /alerts, PATCH /alerts/:id/acknowledge, DELETE /alerts/:id
 */

import { apiClient } from '@/api/client';
import type {
  Alert,
  AlertSeverity,
  AlertSource,
  CreateAlertRequest,
} from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertQueryFilters {
  severity?: AlertSeverity | AlertSeverity[];
  source?: AlertSource | AlertSource[];
  sourceId?: string;
  acknowledged?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ActiveAlertsResponse {
  alerts: Alert[];
}

export interface AlertCountsResponse {
  counts: Record<AlertSeverity, number>;
}

export interface ClearAlertsResponse {
  success: boolean;
  deleted: number;
}

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: '/alerts',
  active: '/alerts/active',
  history: '/alerts/history',
  counts: '/alerts/counts',
  clearAcknowledged: '/alerts/clear/acknowledged',
  clearAll: '/alerts/clear/all',
  byId: (id: string) => `/alerts/${id}`,
  acknowledge: (id: string) => `/alerts/${id}/acknowledge`,
} as const;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build query string from filters and pagination params
 */
function buildQueryParams(
  filters?: AlertQueryFilters,
  pagination?: PaginationParams
): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters?.severity) {
    params.severity = Array.isArray(filters.severity)
      ? filters.severity.join(',')
      : filters.severity;
  }

  if (filters?.source) {
    params.source = Array.isArray(filters.source)
      ? filters.source.join(',')
      : filters.source;
  }

  if (filters?.sourceId) {
    params.sourceId = filters.sourceId;
  }

  if (filters?.acknowledged !== undefined) {
    params.acknowledged = String(filters.acknowledged);
  }

  if (filters?.startDate) {
    params.startDate = filters.startDate;
  }

  if (filters?.endDate) {
    params.endDate = filters.endDate;
  }

  if (pagination?.page) {
    params.page = String(pagination.page);
  }

  if (pagination?.pageSize) {
    params.pageSize = String(pagination.pageSize);
  }

  return params;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const alertsApi = {
  /**
   * Get all alerts with optional filters and pagination.
   * @param filters - Optional filters for severity, source, etc.
   * @param pagination - Optional pagination params
   * @returns Paginated list of alerts
   */
  async getAlerts(
    filters?: AlertQueryFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<Alert>> {
    const params = buildQueryParams(filters, pagination);
    const response = await apiClient.get<PaginatedResponse<Alert>>(
      ENDPOINTS.list,
      { params }
    );
    return response.data;
  },

  /**
   * Get active (unacknowledged) alerts.
   * @param filters - Optional filters for severity, source, etc.
   * @returns List of active alerts
   */
  async getActiveAlerts(
    filters?: Omit<AlertQueryFilters, 'acknowledged'>
  ): Promise<Alert[]> {
    const params = buildQueryParams(filters);
    const response = await apiClient.get<ActiveAlertsResponse>(
      ENDPOINTS.active,
      { params }
    );
    return response.data.alerts;
  },

  /**
   * Get alert history with pagination.
   * @param filters - Optional filters
   * @param pagination - Optional pagination params
   * @returns Paginated list of all alerts (including acknowledged)
   */
  async getAlertHistory(
    filters?: AlertQueryFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<Alert>> {
    const params = buildQueryParams(filters, pagination);
    const response = await apiClient.get<PaginatedResponse<Alert>>(
      ENDPOINTS.history,
      { params }
    );
    return response.data;
  },

  /**
   * Get alert counts by severity.
   * @returns Counts of unacknowledged alerts by severity level
   */
  async getAlertCounts(): Promise<Record<AlertSeverity, number>> {
    const response = await apiClient.get<AlertCountsResponse>(ENDPOINTS.counts);
    return response.data.counts;
  },

  /**
   * Get a single alert by ID.
   * @param id - Alert ID
   * @returns Alert details
   */
  async getAlert(id: string): Promise<Alert> {
    const response = await apiClient.get<Alert>(ENDPOINTS.byId(id));
    return response.data;
  },

  /**
   * Create a new alert.
   * @param request - Alert creation request
   * @returns Created alert
   */
  async createAlert(request: CreateAlertRequest): Promise<Alert> {
    const response = await apiClient.post<Alert>(ENDPOINTS.list, request);
    return response.data;
  },

  /**
   * Acknowledge an alert.
   * @param id - Alert ID to acknowledge
   * @returns Updated alert
   */
  async acknowledgeAlert(id: string): Promise<Alert> {
    const response = await apiClient.patch<Alert>(ENDPOINTS.acknowledge(id));
    return response.data;
  },

  /**
   * Delete an alert.
   * @param id - Alert ID to delete
   */
  async deleteAlert(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.byId(id));
  },

  /**
   * Clear all acknowledged alerts.
   * @returns Number of deleted alerts
   */
  async clearAcknowledgedAlerts(): Promise<number> {
    const response = await apiClient.delete<ClearAlertsResponse>(
      ENDPOINTS.clearAcknowledged
    );
    return response.data.deleted;
  },

  /**
   * Clear all alerts (admin only).
   * @returns Number of deleted alerts
   */
  async clearAllAlerts(): Promise<number> {
    const response = await apiClient.delete<ClearAlertsResponse>(
      ENDPOINTS.clearAll
    );
    return response.data.deleted;
  },
};

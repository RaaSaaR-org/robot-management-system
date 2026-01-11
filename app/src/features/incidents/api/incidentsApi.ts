/**
 * @file incidentsApi.ts
 * @description API calls for incident management endpoints
 * @feature incidents
 */

import { apiClient } from '@/api/client';
import type {
  Incident,
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  IncidentListResponse,
  CreateIncidentRequest,
  UpdateIncidentRequest,
  NotificationTimeline,
  RiskAssessment,
  DashboardStats,
  NotificationTemplate,
  IncidentNotification,
} from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface IncidentQueryFilters {
  type?: IncidentType | IncidentType[];
  severity?: IncidentSeverity | IncidentSeverity[];
  status?: IncidentStatus | IncidentStatus[];
  robotId?: string;
  startDate?: string;
  endDate?: string;
}

export interface IncidentPaginationParams {
  page?: number;
  limit?: number;
  sortBy?: 'detectedAt' | 'severity' | 'status' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: '/incidents',
  dashboard: '/incidents/dashboard',
  open: '/incidents/open',
  overdue: '/incidents/overdue',
  riskMatrix: '/incidents/risk-matrix',
  byId: (id: string) => `/incidents/${id}`,
  notifications: (id: string) => `/incidents/${id}/notifications`,
  notificationById: (incidentId: string, notificationId: string) =>
    `/incidents/${incidentId}/notifications/${notificationId}`,
  sendNotification: (incidentId: string, notificationId: string) =>
    `/incidents/${incidentId}/notifications/${notificationId}/send`,
  generateContent: (incidentId: string, notificationId: string) =>
    `/incidents/${incidentId}/notifications/${notificationId}/generate`,
  assess: (id: string) => `/incidents/${id}/assess`,
  evidence: (id: string) => `/incidents/${id}/evidence`,
  snapshot: (id: string) => `/incidents/${id}/snapshot`,
  templates: '/notification-templates',
  templateById: (id: string) => `/notification-templates/${id}`,
} as const;

// ============================================================================
// HELPERS
// ============================================================================

function buildQueryParams(
  filters?: IncidentQueryFilters,
  pagination?: IncidentPaginationParams
): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters?.type) {
    params.type = Array.isArray(filters.type) ? filters.type.join(',') : filters.type;
  }

  if (filters?.severity) {
    params.severity = Array.isArray(filters.severity)
      ? filters.severity.join(',')
      : filters.severity;
  }

  if (filters?.status) {
    params.status = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
  }

  if (filters?.robotId) {
    params.robotId = filters.robotId;
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

  if (pagination?.limit) {
    params.limit = String(pagination.limit);
  }

  if (pagination?.sortBy) {
    params.sortBy = pagination.sortBy;
  }

  if (pagination?.sortOrder) {
    params.sortOrder = pagination.sortOrder;
  }

  return params;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const incidentsApi = {
  // ============================================================================
  // INCIDENT CRUD
  // ============================================================================

  async getIncidents(
    filters?: IncidentQueryFilters,
    pagination?: IncidentPaginationParams
  ): Promise<IncidentListResponse> {
    const params = buildQueryParams(filters, pagination);
    const response = await apiClient.get<IncidentListResponse>(ENDPOINTS.list, { params });
    return response.data;
  },

  async getIncident(id: string): Promise<Incident> {
    const response = await apiClient.get<Incident>(ENDPOINTS.byId(id));
    return response.data;
  },

  async getOpenIncidents(): Promise<Incident[]> {
    const response = await apiClient.get<{ incidents: Incident[] }>(ENDPOINTS.open);
    return response.data.incidents;
  },

  async createIncident(input: CreateIncidentRequest): Promise<Incident> {
    const response = await apiClient.post<Incident>(ENDPOINTS.list, input);
    return response.data;
  },

  async updateIncident(id: string, input: UpdateIncidentRequest): Promise<Incident> {
    const response = await apiClient.patch<Incident>(ENDPOINTS.byId(id), input);
    return response.data;
  },

  async deleteIncident(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.byId(id));
  },

  // ============================================================================
  // DASHBOARD
  // ============================================================================

  async getDashboardStats(): Promise<DashboardStats> {
    const response = await apiClient.get<DashboardStats>(ENDPOINTS.dashboard);
    return response.data;
  },

  async getOverdueNotifications(): Promise<IncidentNotification[]> {
    const response = await apiClient.get<{ notifications: IncidentNotification[] }>(
      ENDPOINTS.overdue
    );
    return response.data.notifications;
  },

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  async getNotificationTimeline(incidentId: string): Promise<NotificationTimeline> {
    const response = await apiClient.get<NotificationTimeline>(ENDPOINTS.notifications(incidentId));
    return response.data;
  },

  async createNotificationWorkflow(incidentId: string): Promise<IncidentNotification[]> {
    const response = await apiClient.post<{ notifications: IncidentNotification[] }>(
      ENDPOINTS.notifications(incidentId)
    );
    return response.data.notifications;
  },

  async markNotificationSent(
    incidentId: string,
    notificationId: string
  ): Promise<IncidentNotification> {
    const response = await apiClient.post<IncidentNotification>(
      ENDPOINTS.sendNotification(incidentId, notificationId)
    );
    return response.data;
  },

  async generateNotificationContent(
    incidentId: string,
    notificationId: string,
    templateId?: string
  ): Promise<string> {
    const response = await apiClient.post<{ content: string }>(
      ENDPOINTS.generateContent(incidentId, notificationId),
      { templateId }
    );
    return response.data.content;
  },

  async updateNotificationContent(
    incidentId: string,
    notificationId: string,
    content: string
  ): Promise<IncidentNotification> {
    const response = await apiClient.patch<IncidentNotification>(
      ENDPOINTS.notificationById(incidentId, notificationId),
      { content }
    );
    return response.data;
  },

  // ============================================================================
  // RISK ASSESSMENT
  // ============================================================================

  async assessRisk(incidentId: string): Promise<RiskAssessment> {
    const response = await apiClient.post<RiskAssessment>(ENDPOINTS.assess(incidentId));
    return response.data;
  },

  async getRiskMatrix(): Promise<unknown[]> {
    const response = await apiClient.get<{ matrix: unknown[] }>(ENDPOINTS.riskMatrix);
    return response.data.matrix;
  },

  // ============================================================================
  // EVIDENCE
  // ============================================================================

  async getEvidence(incidentId: string): Promise<{
    complianceLogIds: string[];
    alertIds: string[];
    systemSnapshot: unknown | null;
  }> {
    const response = await apiClient.get(ENDPOINTS.evidence(incidentId));
    return response.data;
  },

  async linkEvidence(
    incidentId: string,
    complianceLogIds?: string[],
    alertIds?: string[]
  ): Promise<Incident> {
    const response = await apiClient.post<Incident>(ENDPOINTS.evidence(incidentId), {
      complianceLogIds,
      alertIds,
    });
    return response.data;
  },

  async captureSnapshot(incidentId: string): Promise<Incident> {
    const response = await apiClient.post<Incident>(ENDPOINTS.snapshot(incidentId));
    return response.data;
  },

  // ============================================================================
  // TEMPLATES
  // ============================================================================

  async getTemplates(): Promise<NotificationTemplate[]> {
    const response = await apiClient.get<{ templates: NotificationTemplate[] }>(ENDPOINTS.templates);
    return response.data.templates;
  },

  async getTemplate(id: string): Promise<NotificationTemplate> {
    const response = await apiClient.get<NotificationTemplate>(ENDPOINTS.templateById(id));
    return response.data;
  },

  async createTemplate(input: Omit<NotificationTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationTemplate> {
    const response = await apiClient.post<NotificationTemplate>(ENDPOINTS.templates, input);
    return response.data;
  },

  async updateTemplate(
    id: string,
    input: Partial<Pick<NotificationTemplate, 'name' | 'subject' | 'body' | 'isDefault'>>
  ): Promise<NotificationTemplate> {
    const response = await apiClient.put<NotificationTemplate>(ENDPOINTS.templateById(id), input);
    return response.data;
  },

  async deleteTemplate(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.templateById(id));
  },
};

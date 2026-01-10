/**
 * @file gdprApi.ts
 * @description API calls for GDPR Rights Self-Service Portal
 * @feature gdpr
 */

import { apiClient } from '@/api/client';
import type {
  GDPRRequest,
  GDPRRequestListResponse,
  GDPRRequestStatusHistory,
  UserConsent,
  GDPRMetrics,
  SLAReport,
  AccessRequestInput,
  RectificationRequestInput,
  ErasureRequestInput,
  RestrictionRequestInput,
  PortabilityRequestInput,
  ObjectionRequestInput,
  ADMReviewRequestInput,
  AdminRequestFilters,
  ConsentType,
} from '../types';

const ENDPOINTS = {
  // User self-service
  requests: '/gdpr/requests',
  consents: '/gdpr/consents',
  verify: '/gdpr/verify',

  // Admin
  adminRequests: '/gdpr/admin/requests',
  adminMetrics: '/gdpr/admin/metrics',
  adminSLAReport: '/gdpr/admin/sla-report',
  adminOverdue: '/gdpr/admin/overdue',
} as const;

export const gdprApi = {
  // ============================================================================
  // USER SELF-SERVICE: REQUESTS
  // ============================================================================

  /**
   * Get user's GDPR requests
   */
  async getMyRequests(): Promise<{ requests: GDPRRequest[] }> {
    const response = await apiClient.get<{ requests: GDPRRequest[] }>(ENDPOINTS.requests);
    return response.data;
  },

  /**
   * Get single request with history
   */
  async getRequest(id: string): Promise<{ request: GDPRRequest; history: GDPRRequestStatusHistory[] }> {
    const response = await apiClient.get<{ request: GDPRRequest; history: GDPRRequestStatusHistory[] }>(
      `${ENDPOINTS.requests}/${id}`
    );
    return response.data;
  },

  /**
   * Submit access request (Art. 15)
   */
  async submitAccessRequest(input?: AccessRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/access`, input || {});
    return response.data;
  },

  /**
   * Submit rectification request (Art. 16)
   */
  async submitRectificationRequest(input: RectificationRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/rectification`, input);
    return response.data;
  },

  /**
   * Submit erasure request (Art. 17)
   */
  async submitErasureRequest(input?: ErasureRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/erasure`, input || {});
    return response.data;
  },

  /**
   * Submit restriction request (Art. 18)
   */
  async submitRestrictionRequest(input: RestrictionRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/restriction`, input);
    return response.data;
  },

  /**
   * Submit portability request (Art. 20)
   */
  async submitPortabilityRequest(input: PortabilityRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/portability`, input);
    return response.data;
  },

  /**
   * Submit objection request (Art. 21)
   */
  async submitObjectionRequest(input: ObjectionRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/objection`, input);
    return response.data;
  },

  /**
   * Submit ADM review request (Art. 22)
   */
  async submitADMReviewRequest(input: ADMReviewRequestInput): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.requests}/adm-review`, input);
    return response.data;
  },

  /**
   * Cancel pending request
   */
  async cancelRequest(id: string): Promise<GDPRRequest> {
    const response = await apiClient.delete<GDPRRequest>(`${ENDPOINTS.requests}/${id}`);
    return response.data;
  },

  /**
   * Download export data for completed request
   */
  async downloadExport(id: string): Promise<Record<string, unknown>> {
    const response = await apiClient.get<Record<string, unknown>>(`${ENDPOINTS.requests}/${id}/download`);
    return response.data;
  },

  /**
   * Verify erasure request
   */
  async verifyRequest(token: string): Promise<{ message: string; request: GDPRRequest }> {
    const response = await apiClient.get<{ message: string; request: GDPRRequest }>(
      `${ENDPOINTS.verify}/${token}`
    );
    return response.data;
  },

  // ============================================================================
  // USER SELF-SERVICE: CONSENTS
  // ============================================================================

  /**
   * Get user's consents
   */
  async getConsents(): Promise<{ consents: UserConsent[] }> {
    const response = await apiClient.get<{ consents: UserConsent[] }>(ENDPOINTS.consents);
    return response.data;
  },

  /**
   * Update consent
   */
  async updateConsent(type: ConsentType, granted: boolean): Promise<UserConsent> {
    const response = await apiClient.post<UserConsent>(ENDPOINTS.consents, { type, granted });
    return response.data;
  },

  /**
   * Revoke specific consent
   */
  async revokeConsent(type: ConsentType): Promise<UserConsent> {
    const response = await apiClient.delete<UserConsent>(`${ENDPOINTS.consents}/${type}`);
    return response.data;
  },

  // ============================================================================
  // ADMIN ENDPOINTS
  // ============================================================================

  /**
   * Get all requests with filters (admin)
   */
  async getAdminRequests(filters?: AdminRequestFilters): Promise<GDPRRequestListResponse> {
    const response = await apiClient.get<GDPRRequestListResponse>(ENDPOINTS.adminRequests, {
      params: filters,
    });
    return response.data;
  },

  /**
   * Acknowledge request (admin)
   */
  async acknowledgeRequest(id: string): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.adminRequests}/${id}/acknowledge`);
    return response.data;
  },

  /**
   * Start processing request (admin)
   */
  async startProcessing(id: string): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.adminRequests}/${id}/start-processing`);
    return response.data;
  },

  /**
   * Complete request (admin)
   */
  async completeRequest(id: string, responseData?: Record<string, unknown>): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.adminRequests}/${id}/complete`, {
      responseData,
    });
    return response.data;
  },

  /**
   * Reject request (admin)
   */
  async rejectRequest(id: string, reason: string): Promise<GDPRRequest> {
    const response = await apiClient.post<GDPRRequest>(`${ENDPOINTS.adminRequests}/${id}/reject`, {
      reason,
    });
    return response.data;
  },

  /**
   * Get GDPR metrics (admin)
   */
  async getMetrics(): Promise<GDPRMetrics> {
    const response = await apiClient.get<GDPRMetrics>(ENDPOINTS.adminMetrics);
    return response.data;
  },

  /**
   * Get SLA report (admin)
   */
  async getSLAReport(): Promise<SLAReport> {
    const response = await apiClient.get<SLAReport>(ENDPOINTS.adminSLAReport);
    return response.data;
  },

  /**
   * Get overdue requests (admin)
   */
  async getOverdueRequests(): Promise<{ requests: GDPRRequest[] }> {
    const response = await apiClient.get<{ requests: GDPRRequest[] }>(ENDPOINTS.adminOverdue);
    return response.data;
  },
};

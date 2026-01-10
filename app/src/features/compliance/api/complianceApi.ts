/**
 * @file complianceApi.ts
 * @description API calls for compliance logging
 * @feature compliance
 */

import { apiClient } from '@/api/client';
import type {
  ComplianceLog,
  ComplianceLogListResponse,
  ComplianceLogQueryParams,
  HashChainVerificationResult,
  ComplianceMetricsSummary,
  ComplianceSession,
  RetentionPolicy,
  RetentionPolicyInput,
  RetentionStats,
  LegalHold,
  LegalHoldInput,
  ExportOptions,
  ExportResult,
  RopaEntry,
  RopaEntryInput,
  RopaReport,
  ProviderSummary,
  ProviderDocumentation,
} from '../types';

const ENDPOINTS = {
  logs: '/compliance/logs',
  verify: '/compliance/verify',
  metrics: '/compliance/metrics',
  eventTypes: '/compliance/metrics/event-types',
  sessions: '/compliance/sessions',
  export: '/compliance/export',
  retention: '/compliance/retention',
  legalHolds: '/compliance/legal-holds',
  ropa: '/compliance/ropa',
  providers: '/compliance/providers',
} as const;

export const complianceApi = {
  /**
   * Get list of compliance logs with pagination and filters
   */
  async getLogs(params?: ComplianceLogQueryParams): Promise<ComplianceLogListResponse> {
    const response = await apiClient.get<ComplianceLogListResponse>(ENDPOINTS.logs, {
      params,
    });
    return response.data;
  },

  /**
   * Get a single compliance log by ID
   */
  async getLog(id: string): Promise<ComplianceLog> {
    const response = await apiClient.get<ComplianceLog>(`${ENDPOINTS.logs}/${id}`);
    return response.data;
  },

  /**
   * Get logs for a specific session
   */
  async getLogsBySession(sessionId: string): Promise<{ logs: ComplianceLog[] }> {
    const response = await apiClient.get<{ logs: ComplianceLog[] }>(
      `${ENDPOINTS.logs}/session/${sessionId}`
    );
    return response.data;
  },

  /**
   * Get logs linked to a Decision
   */
  async getLogsByDecision(decisionId: string): Promise<{ logs: ComplianceLog[] }> {
    const response = await apiClient.get<{ logs: ComplianceLog[] }>(
      `${ENDPOINTS.logs}/decision/${decisionId}`
    );
    return response.data;
  },

  /**
   * Verify hash chain integrity
   */
  async verifyIntegrity(
    startDate?: string,
    endDate?: string
  ): Promise<HashChainVerificationResult> {
    if (startDate || endDate) {
      const response = await apiClient.post<HashChainVerificationResult>(ENDPOINTS.verify, {
        startDate,
        endDate,
      });
      return response.data;
    }
    const response = await apiClient.get<HashChainVerificationResult>(ENDPOINTS.verify);
    return response.data;
  },

  /**
   * Get compliance metrics summary
   */
  async getMetrics(startDate?: string, endDate?: string): Promise<ComplianceMetricsSummary> {
    const response = await apiClient.get<ComplianceMetricsSummary>(ENDPOINTS.metrics, {
      params: { startDate, endDate },
    });
    return response.data;
  },

  /**
   * Get event type counts
   */
  async getEventTypeCounts(startDate?: string, endDate?: string) {
    const response = await apiClient.get<{ counts: Array<{ eventType: string; count: number }> }>(
      ENDPOINTS.eventTypes,
      { params: { startDate, endDate } }
    );
    return response.data;
  },

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ComplianceSession> {
    const response = await apiClient.get<ComplianceSession>(
      `${ENDPOINTS.sessions}/${sessionId}`
    );
    return response.data;
  },

  /**
   * Get session by robot ID
   */
  async getSessionByRobot(robotId: string): Promise<ComplianceSession> {
    const response = await apiClient.get<ComplianceSession>(
      `${ENDPOINTS.sessions}/robot/${robotId}`
    );
    return response.data;
  },

  // ============================================================================
  // EXPORT
  // ============================================================================

  /**
   * Export compliance logs to JSON
   */
  async exportLogs(options: ExportOptions): Promise<ExportResult> {
    const response = await apiClient.post<ExportResult>(ENDPOINTS.export, options);
    return response.data;
  },

  // ============================================================================
  // RETENTION POLICIES
  // ============================================================================

  /**
   * Get all retention policies
   */
  async getRetentionPolicies(): Promise<{ policies: RetentionPolicy[] }> {
    const response = await apiClient.get<{ policies: RetentionPolicy[] }>(ENDPOINTS.retention);
    return response.data;
  },

  /**
   * Get retention policy for a specific event type
   */
  async getRetentionPolicy(eventType: string): Promise<RetentionPolicy> {
    const response = await apiClient.get<RetentionPolicy>(`${ENDPOINTS.retention}/${eventType}`);
    return response.data;
  },

  /**
   * Set or update retention policy
   */
  async setRetentionPolicy(
    eventType: string,
    input: Omit<RetentionPolicyInput, 'eventType'>
  ): Promise<RetentionPolicy> {
    const response = await apiClient.put<RetentionPolicy>(`${ENDPOINTS.retention}/${eventType}`, input);
    return response.data;
  },

  /**
   * Get retention statistics
   */
  async getRetentionStats(): Promise<RetentionStats> {
    const response = await apiClient.get<RetentionStats>(`${ENDPOINTS.retention}/cleanup/stats`);
    return response.data;
  },

  /**
   * Trigger manual cleanup
   */
  async triggerCleanup(): Promise<{ logsDeleted: number; logsSkipped: number }> {
    const response = await apiClient.post<{ logsDeleted: number; logsSkipped: number }>(
      `${ENDPOINTS.retention}/cleanup`
    );
    return response.data;
  },

  // ============================================================================
  // LEGAL HOLDS
  // ============================================================================

  /**
   * Get all legal holds
   */
  async getLegalHolds(activeOnly = false): Promise<{ holds: LegalHold[] }> {
    const response = await apiClient.get<{ holds: LegalHold[] }>(ENDPOINTS.legalHolds, {
      params: { activeOnly },
    });
    return response.data;
  },

  /**
   * Get a specific legal hold
   */
  async getLegalHold(holdId: string): Promise<LegalHold> {
    const response = await apiClient.get<LegalHold>(`${ENDPOINTS.legalHolds}/${holdId}`);
    return response.data;
  },

  /**
   * Create a legal hold
   */
  async createLegalHold(input: LegalHoldInput): Promise<LegalHold> {
    const response = await apiClient.post<LegalHold>(ENDPOINTS.legalHolds, input);
    return response.data;
  },

  /**
   * Release (deactivate) a legal hold
   */
  async releaseLegalHold(holdId: string): Promise<{ message: string; hold: LegalHold }> {
    const response = await apiClient.delete<{ message: string; hold: LegalHold }>(
      `${ENDPOINTS.legalHolds}/${holdId}`
    );
    return response.data;
  },

  /**
   * Add logs to a legal hold
   */
  async addLogsToHold(holdId: string, logIds: string[]): Promise<LegalHold> {
    const response = await apiClient.post<LegalHold>(`${ENDPOINTS.legalHolds}/${holdId}/logs`, {
      logIds,
    });
    return response.data;
  },

  // ============================================================================
  // ROPA (Records of Processing Activities)
  // ============================================================================

  /**
   * Get all RoPA entries
   */
  async getRopaEntries(): Promise<{ entries: RopaEntry[] }> {
    const response = await apiClient.get<{ entries: RopaEntry[] }>(ENDPOINTS.ropa);
    return response.data;
  },

  /**
   * Get a specific RoPA entry
   */
  async getRopaEntry(id: string): Promise<RopaEntry> {
    const response = await apiClient.get<RopaEntry>(`${ENDPOINTS.ropa}/${id}`);
    return response.data;
  },

  /**
   * Create a RoPA entry
   */
  async createRopaEntry(input: RopaEntryInput): Promise<RopaEntry> {
    const response = await apiClient.post<RopaEntry>(ENDPOINTS.ropa, input);
    return response.data;
  },

  /**
   * Update a RoPA entry
   */
  async updateRopaEntry(id: string, input: Partial<RopaEntryInput>): Promise<RopaEntry> {
    const response = await apiClient.put<RopaEntry>(`${ENDPOINTS.ropa}/${id}`, input);
    return response.data;
  },

  /**
   * Delete a RoPA entry
   */
  async deleteRopaEntry(id: string): Promise<{ message: string }> {
    const response = await apiClient.delete<{ message: string }>(`${ENDPOINTS.ropa}/${id}`);
    return response.data;
  },

  /**
   * Generate RoPA report
   */
  async generateRopaReport(organizationName?: string): Promise<RopaReport> {
    const response = await apiClient.get<RopaReport>(`${ENDPOINTS.ropa}/report`, {
      params: { organizationName },
    });
    return response.data;
  },

  // ============================================================================
  // PROVIDER DOCUMENTATION
  // ============================================================================

  /**
   * Get all providers with summary
   */
  async getProviders(): Promise<{ providers: ProviderSummary[] }> {
    const response = await apiClient.get<{ providers: ProviderSummary[] }>(ENDPOINTS.providers);
    return response.data;
  },

  /**
   * Get all documentation
   */
  async getAllDocumentation(): Promise<{ documentation: ProviderDocumentation[] }> {
    const response = await apiClient.get<{ documentation: ProviderDocumentation[] }>(
      `${ENDPOINTS.providers}/docs`
    );
    return response.data;
  },

  /**
   * Get documentation by provider
   */
  async getProviderDocs(providerName: string): Promise<{ documentation: ProviderDocumentation[] }> {
    const response = await apiClient.get<{ documentation: ProviderDocumentation[] }>(
      `${ENDPOINTS.providers}/${encodeURIComponent(providerName)}/docs`
    );
    return response.data;
  },
};

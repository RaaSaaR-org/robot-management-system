/**
 * @file oversightApi.ts
 * @description API calls for human oversight feature (EU AI Act Art. 14)
 * @feature oversight
 */

import { apiClient } from '@/api/client';
import type {
  ManualControlSession,
  ManualModeResponse,
  ActivateManualModeInput,
  ManualSessionQueryParams,
  VerificationSchedule,
  VerificationCompletion,
  CreateVerificationScheduleInput,
  CompleteVerificationInput,
  VerificationScheduleQueryParams,
  DueVerification,
  AnomalyRecord,
  AnomalyListResponse,
  AnomalyQueryParams,
  OversightLogListResponse,
  OversightLogQueryParams,
  RobotCapabilitiesSummary,
  FleetCapabilitiesOverview,
  OversightDashboardStats,
} from '../types';

const ENDPOINTS = {
  // Manual control
  manualMode: (robotId: string) => `/oversight/robots/${robotId}/manual-mode`,
  manualSessions: '/oversight/manual-sessions',

  // Verifications
  verifications: '/oversight/verifications',
  verificationsDue: '/oversight/verifications/due',
  verificationComplete: (id: string) => `/oversight/verifications/${id}/complete`,
  verificationUpdate: (id: string) => `/oversight/verifications/${id}`,

  // Anomalies
  anomalies: '/oversight/anomalies',
  anomaliesActive: '/oversight/anomalies/active',
  anomaliesUnacknowledged: '/oversight/anomalies/unacknowledged',
  anomalyAcknowledge: (id: string) => `/oversight/anomalies/${id}/acknowledge`,
  anomalyResolve: (id: string) => `/oversight/anomalies/${id}/resolve`,

  // Capabilities
  robotCapabilities: (robotId: string) => `/oversight/robots/${robotId}/capabilities`,
  fleetOverview: '/oversight/fleet/overview',

  // Logs & Dashboard
  logs: '/oversight/logs',
  dashboard: '/oversight/dashboard',
} as const;

export const oversightApi = {
  // ============================================================================
  // MANUAL CONTROL
  // ============================================================================

  /**
   * Activate manual control mode for a robot
   */
  async activateManualMode(input: ActivateManualModeInput): Promise<ManualModeResponse> {
    const response = await apiClient.post<ManualModeResponse>(
      ENDPOINTS.manualMode(input.robotId),
      {
        reason: input.reason,
        mode: input.mode,
        operatorId: input.operatorId,
      }
    );
    return response.data;
  },

  /**
   * Deactivate manual control mode for a robot
   */
  async deactivateManualMode(robotId: string): Promise<ManualControlSession> {
    const response = await apiClient.delete<ManualControlSession>(ENDPOINTS.manualMode(robotId));
    return response.data;
  },

  /**
   * Get manual control sessions with optional filters
   */
  async getManualSessions(params?: ManualSessionQueryParams): Promise<ManualControlSession[]> {
    const response = await apiClient.get<ManualControlSession[]>(ENDPOINTS.manualSessions, {
      params,
    });
    return response.data;
  },

  // ============================================================================
  // VERIFICATION SCHEDULES
  // ============================================================================

  /**
   * Get verification schedules
   */
  async getVerificationSchedules(
    params?: VerificationScheduleQueryParams
  ): Promise<VerificationSchedule[]> {
    const response = await apiClient.get<VerificationSchedule[]>(ENDPOINTS.verifications, {
      params,
    });
    return response.data;
  },

  /**
   * Create a new verification schedule
   */
  async createVerificationSchedule(
    input: CreateVerificationScheduleInput
  ): Promise<VerificationSchedule> {
    const response = await apiClient.post<VerificationSchedule>(ENDPOINTS.verifications, input);
    return response.data;
  },

  /**
   * Update a verification schedule
   */
  async updateVerificationSchedule(
    id: string,
    input: Partial<CreateVerificationScheduleInput>
  ): Promise<VerificationSchedule> {
    const response = await apiClient.patch<VerificationSchedule>(
      ENDPOINTS.verificationUpdate(id),
      input
    );
    return response.data;
  },

  /**
   * Deactivate a verification schedule
   */
  async deactivateVerificationSchedule(id: string): Promise<VerificationSchedule> {
    const response = await apiClient.delete<VerificationSchedule>(ENDPOINTS.verificationUpdate(id));
    return response.data;
  },

  /**
   * Get due verifications
   */
  async getDueVerifications(): Promise<DueVerification[]> {
    const response = await apiClient.get<DueVerification[]>(ENDPOINTS.verificationsDue);
    return response.data;
  },

  /**
   * Complete a verification
   */
  async completeVerification(input: CompleteVerificationInput): Promise<VerificationCompletion> {
    const response = await apiClient.post<VerificationCompletion>(
      ENDPOINTS.verificationComplete(input.scheduleId),
      {
        status: input.status,
        notes: input.notes,
        robotId: input.robotId,
        operatorId: input.operatorId,
      }
    );
    return response.data;
  },

  // ============================================================================
  // ANOMALIES
  // ============================================================================

  /**
   * Get anomalies with filters and pagination
   */
  async getAnomalies(params?: AnomalyQueryParams): Promise<AnomalyListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.robotId) queryParams.robotId = params.robotId;
    if (params?.isActive !== undefined) queryParams.isActive = String(params.isActive);
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.limit) queryParams.limit = String(params.limit);

    if (params?.anomalyType) {
      queryParams.anomalyType = Array.isArray(params.anomalyType)
        ? params.anomalyType.join(',')
        : params.anomalyType;
    }

    if (params?.severity) {
      queryParams.severity = Array.isArray(params.severity)
        ? params.severity.join(',')
        : params.severity;
    }

    const response = await apiClient.get<AnomalyListResponse>(ENDPOINTS.anomalies, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get active anomalies
   */
  async getActiveAnomalies(robotId?: string): Promise<AnomalyRecord[]> {
    const response = await apiClient.get<AnomalyRecord[]>(ENDPOINTS.anomaliesActive, {
      params: robotId ? { robotId } : undefined,
    });
    return response.data;
  },

  /**
   * Get unacknowledged anomalies
   */
  async getUnacknowledgedAnomalies(): Promise<AnomalyRecord[]> {
    const response = await apiClient.get<AnomalyRecord[]>(ENDPOINTS.anomaliesUnacknowledged);
    return response.data;
  },

  /**
   * Acknowledge an anomaly
   */
  async acknowledgeAnomaly(anomalyId: string): Promise<AnomalyRecord> {
    const response = await apiClient.post<AnomalyRecord>(ENDPOINTS.anomalyAcknowledge(anomalyId));
    return response.data;
  },

  /**
   * Resolve an anomaly
   */
  async resolveAnomaly(anomalyId: string, resolution: string): Promise<AnomalyRecord> {
    const response = await apiClient.post<AnomalyRecord>(ENDPOINTS.anomalyResolve(anomalyId), {
      resolution,
    });
    return response.data;
  },

  // ============================================================================
  // CAPABILITIES
  // ============================================================================

  /**
   * Get robot capabilities summary
   */
  async getRobotCapabilities(robotId: string): Promise<RobotCapabilitiesSummary> {
    const response = await apiClient.get<RobotCapabilitiesSummary>(
      ENDPOINTS.robotCapabilities(robotId)
    );
    return response.data;
  },

  /**
   * Get fleet capabilities overview
   */
  async getFleetOverview(): Promise<FleetCapabilitiesOverview> {
    const response = await apiClient.get<FleetCapabilitiesOverview>(ENDPOINTS.fleetOverview);
    return response.data;
  },

  // ============================================================================
  // LOGS & DASHBOARD
  // ============================================================================

  /**
   * Get oversight logs with filters and pagination
   */
  async getOversightLogs(params?: OversightLogQueryParams): Promise<OversightLogListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.operatorId) queryParams.operatorId = params.operatorId;
    if (params?.robotId) queryParams.robotId = params.robotId;
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.limit) queryParams.limit = String(params.limit);

    if (params?.actionType) {
      queryParams.actionType = Array.isArray(params.actionType)
        ? params.actionType.join(',')
        : params.actionType;
    }

    const response = await apiClient.get<OversightLogListResponse>(ENDPOINTS.logs, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get oversight dashboard statistics
   */
  async getDashboardStats(): Promise<OversightDashboardStats> {
    const response = await apiClient.get<OversightDashboardStats>(ENDPOINTS.dashboard);
    return response.data;
  },
};

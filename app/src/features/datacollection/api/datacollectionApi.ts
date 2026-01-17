/**
 * @file datacollectionApi.ts
 * @description API calls for data collection endpoints (teleoperation & active learning)
 * @feature datacollection
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  TeleoperationSession,
  UncertaintyAnalysis,
  CreateSessionRequest,
  SessionListParams,
  SessionListResponse,
  AnnotateSessionRequest,
  ExportSessionRequest,
  ExportResultResponse,
  LogPredictionRequest,
  GetUncertaintyParams,
  GetPrioritiesParams,
  CollectionPrioritiesResponse,
} from '../types/datacollection.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  // Teleoperation
  sessions: '/teleoperation/sessions',
  session: (id: string) => `/teleoperation/sessions/${id}`,
  sessionStart: (id: string) => `/teleoperation/sessions/${id}/start`,
  sessionPause: (id: string) => `/teleoperation/sessions/${id}/pause`,
  sessionResume: (id: string) => `/teleoperation/sessions/${id}/resume`,
  sessionEnd: (id: string) => `/teleoperation/sessions/${id}/end`,
  sessionAnnotate: (id: string) => `/teleoperation/sessions/${id}/annotate`,
  sessionExport: (id: string) => `/teleoperation/sessions/${id}/export`,
  // Active Learning
  predictions: '/active-learning/predictions',
  uncertainty: '/active-learning/uncertainty',
  priorities: '/active-learning/priorities',
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const datacollectionApi = {
  // --------------------------------------------------------------------------
  // Teleoperation Sessions
  // --------------------------------------------------------------------------

  /**
   * List teleoperation sessions with filters
   * @param params - Filter and pagination parameters
   * @returns Paginated list of sessions
   */
  async listSessions(params?: SessionListParams): Promise<SessionListResponse> {
    const response = await apiClient.get<SessionListResponse>(ENDPOINTS.sessions, {
      params: {
        operatorId: params?.operatorId,
        robotId: params?.robotId,
        type: Array.isArray(params?.type) ? params.type.join(',') : params?.type,
        status: Array.isArray(params?.status) ? params.status.join(',') : params?.status,
        startDate: params?.startDate,
        endDate: params?.endDate,
        page: params?.page,
        limit: params?.limit,
      },
    });
    return response.data;
  },

  /**
   * Get a single session by ID
   * @param id - Session ID
   * @returns Session details
   */
  async getSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.get<TeleoperationSession>(ENDPOINTS.session(id));
    return response.data;
  },

  /**
   * Create a new teleoperation session
   * @param data - Session creation data
   * @returns Created session
   */
  async createSession(data: CreateSessionRequest): Promise<TeleoperationSession> {
    const response = await apiClient.post<TeleoperationSession>(ENDPOINTS.sessions, data);
    return response.data;
  },

  /**
   * Start recording a session
   * @param id - Session ID
   * @returns Updated session
   */
  async startSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<TeleoperationSession>(ENDPOINTS.sessionStart(id));
    return response.data;
  },

  /**
   * Pause a recording session
   * @param id - Session ID
   * @returns Updated session
   */
  async pauseSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<TeleoperationSession>(ENDPOINTS.sessionPause(id));
    return response.data;
  },

  /**
   * Resume a paused session
   * @param id - Session ID
   * @returns Updated session
   */
  async resumeSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<TeleoperationSession>(ENDPOINTS.sessionResume(id));
    return response.data;
  },

  /**
   * End a recording session
   * @param id - Session ID
   * @returns Updated session
   */
  async endSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<TeleoperationSession>(ENDPOINTS.sessionEnd(id));
    return response.data;
  },

  /**
   * Annotate a session with language instruction
   * @param id - Session ID
   * @param data - Annotation data
   * @returns Updated session
   */
  async annotateSession(
    id: string,
    data: AnnotateSessionRequest
  ): Promise<TeleoperationSession> {
    const response = await apiClient.post<TeleoperationSession>(
      ENDPOINTS.sessionAnnotate(id),
      data
    );
    return response.data;
  },

  /**
   * Export a session to dataset format
   * @param id - Session ID
   * @param data - Export options
   * @returns Export result
   */
  async exportSession(
    id: string,
    data: ExportSessionRequest
  ): Promise<ExportResultResponse> {
    const response = await apiClient.post<ExportResultResponse>(
      ENDPOINTS.sessionExport(id),
      data
    );
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Active Learning
  // --------------------------------------------------------------------------

  /**
   * Log a prediction for uncertainty analysis
   * @param data - Prediction data
   * @returns Logged prediction ID
   */
  async logPrediction(data: LogPredictionRequest): Promise<{ id: string; logged: boolean }> {
    const response = await apiClient.post<{ id: string; logged: boolean }>(
      ENDPOINTS.predictions,
      data
    );
    return response.data;
  },

  /**
   * Get uncertainty analysis for a model
   * @param params - Analysis parameters
   * @returns Uncertainty analysis
   */
  async getUncertainty(params: GetUncertaintyParams): Promise<UncertaintyAnalysis> {
    const response = await apiClient.get<UncertaintyAnalysis>(ENDPOINTS.uncertainty, {
      params: {
        modelId: params.modelId,
        groupBy: params.groupBy,
        windowDays: params.windowDays,
      },
    });
    return response.data;
  },

  /**
   * Get collection priorities
   * @param params - Priority filter parameters
   * @returns Collection priorities
   */
  async getPriorities(params?: GetPrioritiesParams): Promise<CollectionPrioritiesResponse> {
    const response = await apiClient.get<CollectionPrioritiesResponse>(ENDPOINTS.priorities, {
      params: {
        modelId: params?.modelId,
        limit: params?.limit,
        minPriorityScore: params?.minPriorityScore,
        targetType: params?.targetType,
      },
    });
    return response.data;
  },
};

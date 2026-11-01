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
  EpisodeSummary,
  EpisodeActionBody,
  EpisodeActionResult,
  LiveState,
  QuickCheck,
  LogPredictionRequest,
  GetUncertaintyParams,
  GetPrioritiesParams,
  CollectionPrioritiesResponse,
} from '../types/datacollection.types';

/** End session: just over the server's 300 s wait for the robot's encode. */
export const END_SESSION_TIMEOUT_MS = 330_000;

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
  sessionEpisodes: (id: string) => `/teleoperation/sessions/${id}/episodes`,
  sessionEpisodesNext: (id: string) => `/teleoperation/sessions/${id}/episodes/next`,
  sessionEpisode: (id: string, episodeIndex: number) =>
    `/teleoperation/sessions/${id}/episodes/${episodeIndex}`,
  sessionLive: (id: string) => `/teleoperation/sessions/${id}/live`,
  sessionEpisodesStart: (id: string) => `/teleoperation/sessions/${id}/episodes/start`,
  sessionEpisodesStop: (id: string) => `/teleoperation/sessions/${id}/episodes/stop`,
  sessionEpisodesDiscardLast: (id: string) => `/teleoperation/sessions/${id}/episodes/discard-last`,
  sessionEpisodeThumbnail: (id: string, take: number) =>
    `/teleoperation/sessions/${id}/episodes/${take}/thumbnail`,
  // Active Learning
  predictions: '/active-learning/predictions',
  uncertainty: '/active-learning/uncertainty',
  priorities: '/active-learning/priorities',
} as const;

// ============================================================================
// EPISODE ACTION HELPERS
// ============================================================================

/** Episode actions read a 409 body instead of throwing on it. */
const ACCEPT_CONFLICT = {
  validateStatus: (status: number) => (status >= 200 && status < 300) || status === 409,
};

interface EpisodeActionResponse {
  live?: LiveState | null;
  quickCheck?: QuickCheck | null;
  take?: number;
  episodeIndex?: number;
  restarted?: boolean;
  code?: string;
  error?: string;
}

async function episodeAction(
  call: () => Promise<{ status: number; data: EpisodeActionResponse }>
): Promise<EpisodeActionResult> {
  const { status, data } = await call();
  if (status === 409) {
    return { ok: false, code: data.code ?? 'episode_conflict', error: data.error ?? 'Conflict', live: data.live ?? null };
  }
  if (!data.live) {
    // A 2xx without a live state is a server older than TASK-408.
    return { ok: false, code: 'no_live_state', error: 'The server did not return the live session state', live: null };
  }
  const take = data.take ?? data.episodeIndex;
  return {
    ok: true,
    live: data.live,
    ...(data.quickCheck !== undefined ? { quickCheck: data.quickCheck } : {}),
    ...(take !== undefined ? { take } : {}),
    ...(data.restarted !== undefined ? { restarted: data.restarted } : {}),
  };
}

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
    const response = await apiClient.get<{ session: TeleoperationSession }>(ENDPOINTS.session(id));
    return response.data.session;
  },

  /**
   * Create a new teleoperation session
   * @param data - Session creation data
   * @returns Created session
   */
  async createSession(data: CreateSessionRequest): Promise<TeleoperationSession> {
    const response = await apiClient.post<{ session: TeleoperationSession; message: string }>(
      ENDPOINTS.sessions,
      data
    );
    return response.data.session;
  },

  /**
   * Start recording a session
   * @param id - Session ID
   * @returns Updated session
   */
  async startSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<{ session: TeleoperationSession }>(ENDPOINTS.sessionStart(id));
    return response.data.session;
  },

  /**
   * Pause a recording session
   * @param id - Session ID
   * @returns Updated session
   */
  async pauseSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<{ session: TeleoperationSession }>(ENDPOINTS.sessionPause(id));
    return response.data.session;
  },

  /**
   * Resume a paused session
   * @param id - Session ID
   * @returns Updated session
   */
  async resumeSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<{ session: TeleoperationSession }>(ENDPOINTS.sessionResume(id));
    return response.data.session;
  },

  /**
   * End a recording session
   * @param id - Session ID
   * @returns Updated session
   */
  async endSession(id: string): Promise<TeleoperationSession> {
    const response = await apiClient.post<{ session: TeleoperationSession }>(ENDPOINTS.sessionEnd(id), undefined, {
      // The robot encodes every kept take's video inside this call, and the
      // server waits up to 300 s for it. The shared client aborts at 30 s,
      // which left the operator with a timeout while the robot was still
      // saving (TASK-450).
      timeout: END_SESSION_TIMEOUT_MS,
    });
    return response.data.session;
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
  // Episodes
  // --------------------------------------------------------------------------

  /**
   * List episode summaries for a session
   * @param id - Session ID
   * @returns Episode summaries derived from recorded frames
   */
  async listEpisodes(id: string): Promise<EpisodeSummary[]> {
    const response = await apiClient.get<{ sessionId: string; episodes: EpisodeSummary[] }>(
      ENDPOINTS.sessionEpisodes(id)
    );
    return response.data.episodes;
  },

  /**
   * Advance the recording to the next episode
   * @param id - Session ID
   * @returns The new episode index
   */
  async nextEpisode(id: string): Promise<number> {
    const response = await apiClient.post<{ episodeIndex: number }>(
      ENDPOINTS.sessionEpisodesNext(id)
    );
    return response.data.episodeIndex;
  },

  /**
   * Discard an episode (delete its frames)
   * @param id - Session ID
   * @param episodeIndex - Episode to discard
   */
  async discardEpisode(
    id: string,
    episodeIndex: number
  ): Promise<{ episodeIndex: number; deletedFrames: number; frameCount: number }> {
    const response = await apiClient.delete<{
      episodeIndex: number;
      deletedFrames: number;
      frameCount: number;
    }>(ENDPOINTS.sessionEpisode(id, episodeIndex));
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Takes (TASK-408 server routes; TASK-410 client)
  //
  // Every action sends the take this client believes is live. A 409 is not
  // an error to the caller: it answers `{ ok: false, code, live }` so the
  // store can adopt the server's state instead of showing an error page.
  // --------------------------------------------------------------------------

  /** The session's one live state. */
  async getLive(id: string): Promise<LiveState> {
    const response = await apiClient.get<LiveState>(ENDPOINTS.sessionLive(id));
    return response.data;
  },

  /** Begin a take. */
  async startEpisode(id: string, body: EpisodeActionBody): Promise<EpisodeActionResult> {
    return episodeAction(() => apiClient.post(ENDPOINTS.sessionEpisodesStart(id), body, ACCEPT_CONFLICT));
  },

  /** End the take being recorded; the result carries its quick check. */
  async stopEpisode(id: string, body: EpisodeActionBody): Promise<EpisodeActionResult> {
    return episodeAction(() => apiClient.post(ENDPOINTS.sessionEpisodesStop(id), body, ACCEPT_CONFLICT));
  },

  /** End the take being recorded and begin the next one, guarded by `expectedTake`. */
  async nextEpisodeGuarded(id: string, body: EpisodeActionBody): Promise<EpisodeActionResult> {
    return episodeAction(() => apiClient.post(ENDPOINTS.sessionEpisodesNext(id), body, ACCEPT_CONFLICT));
  },

  /** Discard the last take (ending it first when it is being recorded). */
  async discardLast(id: string, body: EpisodeActionBody): Promise<EpisodeActionResult> {
    return episodeAction(() => apiClient.post(ENDPOINTS.sessionEpisodesDiscardLast(id), body, ACCEPT_CONFLICT));
  },

  /** Discard one take by its 0-based number; the live take is restarted instead. */
  async discardTake(id: string, take: number, body: EpisodeActionBody): Promise<EpisodeActionResult> {
    return episodeAction(() =>
      apiClient.delete(ENDPOINTS.sessionEpisode(id, take), { ...ACCEPT_CONFLICT, data: body })
    );
  },

  /** The API path of a take's thumbnail (relative to the API base). */
  thumbnailUrl(id: string, take: number): string {
    return ENDPOINTS.sessionEpisodeThumbnail(id, take);
  },

  /**
   * The take's thumbnail as a Blob, fetched with the bearer token (the route
   * is behind auth, so a bare `<img src>` only works with auth disabled).
   * Null when the take has none (404).
   */
  async fetchThumbnail(id: string, take: number): Promise<Blob | null> {
    const response = await apiClient.get<Blob>(ENDPOINTS.sessionEpisodeThumbnail(id, take), {
      responseType: 'blob',
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    return response.status === 404 ? null : response.data;
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

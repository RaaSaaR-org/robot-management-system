/**
 * @file datacollection.types.ts
 * @description Type definitions for data collection feature (teleoperation & active learning)
 * @feature datacollection
 * @dependencies @/shared/utils/sessionWatch (the operator state's wire type, TASK-414)
 */

import type { OperatorState } from '@/shared/utils/sessionWatch';

// ============================================================================
// TELEOPERATION TYPES
// ============================================================================

/**
 * Types of teleoperation methods
 */
export type TeleoperationType =
  | 'vr_quest'
  | 'vr_vision_pro'
  | 'bilateral_aloha'
  | 'kinesthetic'
  | 'keyboard_mouse'
  | 'gamepad';

/**
 * Session status
 */
export type TeleoperationStatus =
  | 'created'
  | 'recording'
  | 'paused'
  | 'completed'
  | 'failed';

/**
 * Teleoperation session
 */
export interface TeleoperationSession {
  id: string;
  operatorId: string;
  robotId: string;
  type: TeleoperationType;
  status: TeleoperationStatus;
  startedAt: string | null;
  endedAt: string | null;
  frameCount: number;
  duration: number | null;
  fps: number;
  languageInstr: string | null;
  qualityScore: number | null;
  exportedDatasetId: string | null;
  errorMessage: string | null;
  /** Target episode count for the session (from creation) */
  numEpisodes?: number | null;
  createdAt: string;
  updatedAt: string;
  operator?: {
    id: string;
    name: string;
  };
  robot?: {
    id: string;
    name: string;
    model: string;
  };
}

/**
 * Quality feedback
 */
export interface QualityFeedback {
  sessionId: string;
  currentSmoothnessScore: number;
  isJerky: boolean;
  warningMessage?: string;
  suggestions?: string[];
}

/**
 * Per-episode summary derived from a session's frames
 */
export interface EpisodeSummary {
  episodeIndex: number;
  frameCount: number;
  startTime: number;
  endTime: number;
  durationS: number;
  /** Ticks the recorder wanted and did not get. Absent for sessions recorded before TASK-215. */
  droppedFrames?: number;
  /** Frames per second the episode actually achieved. */
  fpsActual?: number;
  /**
   * How this episode's joint targets were produced (TASK-216): `orientation`
   * (the browser's controller mapping), `ik` (the agent's arm solver),
   * `hand-tracking` (DexPilot fingers), `manual` (a joint moved by hand).
   *
   * Observed by the agent from the teleop socket rather than declared by the
   * client, so a session that changed mode says so on the take that changed.
   * Absent — NOT empty — for an episode recorded before the agent could tell.
   */
  retargetModes?: string[];
  /** TASK-408: the take was discarded. Only present in `?includeDiscarded=1` lists. */
  discarded?: boolean;
  /** TASK-408: the episode this take became in the written dataset, once the session ended. */
  datasetEpisodeIndex?: number | null;
  /** TASK-408: why the take ended. */
  stopReason?: EpisodeStopReason | null;
  /** TASK-408: ISO server time the take began. */
  takeStartedAt?: string | null;
  /** TASK-408: who began and who ended the take. */
  startedBy?: EpisodeActor | null;
  stoppedBy?: EpisodeActor | null;
  /** TASK-408: the robot's quick check of the take. */
  quickCheck?: { jointsMoved: JointMoved[]; groupsMoved: string[]; warnings: string[] } | null;
}

// ============================================================================
// EPISODE CONTROL + LIVE STATE (TASK-408 server, TASK-410 browser)
// ============================================================================

/** Where an episode action came from. */
export type EpisodeSource = 'vr' | 'desktop' | 'hotkey';

/** Why a take ended. `time_limit` is the robot's own auto-stop. */
export type EpisodeStopReason = 'operator' | 'time_limit' | 'next' | 'session_end';

/** Who caused an episode event. `source: 'auto'` is the recorder itself. */
export interface EpisodeActor {
  userId: string | null;
  displayName: string | null;
  source: EpisodeSource | 'auto';
  clientId: string | null;
}

export interface JointMoved {
  name: string;
  rangeRad: number;
}

/** The robot's verdict on one finished take. `take` is 0-based on the wire. */
export interface QuickCheck {
  take: number;
  frames: number;
  durationS: number;
  droppedFrames: number;
  fpsActual: number;
  jointsMoved: JointMoved[];
  groupsMoved: string[];
  /** `short`, `no_motion`, `dropped_frames` */
  warnings: string[];
  /** Server path of the take's middle frame, or null when there is none. */
  thumbnailUrl: string | null;
  stopReason: EpisodeStopReason | null;
  discarded: boolean;
}

/** One live state per session, shared by every client (TASK-408). */
export interface LiveState {
  sessionId: string;
  status: TeleoperationStatus;
  phase: 'between' | 'capturing' | null;
  /** The take while capturing, else the last take; null before the first. 0-based. */
  take: number | null;
  /** ISO server time the live take began; null between takes. */
  takeStartedAt: string | null;
  takeElapsedS: number | null;
  takeFrames: number;
  totalFrames: number;
  kept: number;
  discarded: number;
  fpsTarget: number;
  fpsActual: number | null;
  degraded: boolean;
  lastDropReason: string | null;
  /** Seconds since the session's recorder started. */
  elapsedS: number | null;
  /** Per-take auto-stop, or null. */
  autoStopS: number | null;
  lastTake: QuickCheck | null;
  /** Server time this state was built — the client derives its clock offset from it. */
  at: string;
}

/** Codes a refused episode action answers with (409, or 404/502 for a few). */
export type EpisodeConflictCode =
  | 'episode_conflict'
  | 'already_capturing'
  | 'not_capturing'
  | 'not_recording'
  | 'unsupported_recorder'
  | 'no_take'
  | 'already_discarded'
  | 'unknown_take'
  | 'recorder_unavailable';

/** What every episode action sends. `expectedTake: null` means "no take yet". */
export interface EpisodeActionBody {
  expectedTake?: number | null;
  clientId?: string;
  source?: EpisodeSource;
}

/** An episode action either went through, or was refused with the live state to re-sync from. */
export type EpisodeActionResult =
  | { ok: true; live: LiveState; quickCheck?: QuickCheck | null; take?: number; restarted?: boolean }
  | { ok: false; code: EpisodeConflictCode | string; error: string; live: LiveState | null };

/** The take actions the store offers; `discard` is "discard the last take". */
export type TakeAction = 'start' | 'stop' | 'next' | 'discard';

/**
 * One of the optional per-episode statistics, or an em-dash.
 *
 * `droppedFrames` and `fpsActual` arrived with TASK-215; every episode recorded
 * before it has neither, and those sessions still have to render. An em-dash
 * says "not recorded" — a 0 would claim the recorder kept up, which is a much
 * worse thing to be wrong about than a blank cell.
 */
export function formatEpisodeStat(value: number | undefined, digits = 0): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/**
 * Live recording progress (streamed over the app WebSocket as
 * teleop:session:progress events)
 */
export interface TeleopRecordingProgress {
  frameCount?: number;
  currentEpisode?: number;
  episodesDone?: number;
  elapsedS?: number;
  fpsActual?: number;
  running?: boolean;
  degraded?: boolean;
}

/**
 * Teleoperation event as broadcast on the app WebSocket (/api/a2a/ws).
 * Types are namespaced 'teleop:*' (see server/src/websocket/index.ts).
 */
export interface TeleopWsEvent {
  type:
    | 'teleop:session:live'
    | 'teleop:episode:started'
    | 'teleop:episode:stopped'
    | 'teleop:episode:discarded'
    | 'teleop:session:progress'
    | 'teleop:quality'
    | 'teleop:session:completed'
    | 'teleop:session:exported'
    | 'teleop:session:started'
    | 'teleop:session:paused'
    | 'teleop:session:resumed'
    | 'teleop:session:failed'
    | 'teleop:session:presence'
    | 'teleop:operator';
  data: {
    sessionId: string;
    /** TASK-414: the session's robot (`presence`, `operator`). */
    robotId?: string | null;
    /** TASK-414: who watches the session (`teleop:session:presence`). */
    viewers?: PresenceViewer[];
    /** TASK-414: the operator's relayed state (`teleop:operator`). */
    state?: OperatorState;
    /** TASK-414: server time the relay sent `state`. */
    at?: string;
    session?: TeleoperationSession;
    recordingProgress?: TeleopRecordingProgress;
    qualityFeedback?: QualityFeedback;
    error?: string;
    /** TASK-408: the full live state (`session:live`, and every episode event). */
    live?: LiveState;
    /** TASK-408: the take an `episode:*` event is about (0-based). */
    take?: number;
    startedAt?: string;
    quickCheck?: QuickCheck | null;
    reason?: EpisodeStopReason;
    by?: EpisodeActor;
  };
  timestamp: number;
}

// ============================================================================
// TWO-PERSON SESSION (TASK-414)
// ============================================================================

/** One watcher of a session, as the server broadcasts it. */
export interface PresenceViewer {
  userId: string;
  displayName: string;
  /** The headset (`operator`) or a desktop page (`assistant`). */
  role: 'operator' | 'assistant';
  /** ISO time this watcher joined. */
  since: string;
}

/** The operator's relayed state and its pose type live with the socket that sends them. */
export type { OperatorPose, OperatorState } from '@/shared/utils/sessionWatch';

/** The operator's latest state on this page, and when it arrived (this tab's clock). */
export interface OperatorSnapshot {
  sessionId: string;
  robotId: string | null;
  state: OperatorState;
  receivedAt: number;
}

// ============================================================================
// ACTIVE LEARNING TYPES
// ============================================================================

/**
 * Target type for data collection
 */
export type CollectionTargetType = 'task' | 'environment' | 'task_environment';

/**
 * Category uncertainty
 */
export interface CategoryUncertainty {
  category: string;
  meanUncertainty: number;
  stdUncertainty: number;
  sampleCount: number;
  minConfidence: number;
  maxConfidence: number;
  recentTrend: 'improving' | 'stable' | 'degrading';
}

/**
 * Uncertainty analysis
 */
export interface UncertaintyAnalysis {
  modelId: string;
  analysisDate: string;
  byTask: Record<string, CategoryUncertainty>;
  byEnvironment: Record<string, CategoryUncertainty>;
  overallUncertainty: number;
  totalPredictions: number;
  highUncertaintyCount: number;
  highUncertaintyThreshold: number;
}

/**
 * Collection priority
 */
export interface CollectionPriority {
  target: string;
  targetType: CollectionTargetType;
  priorityScore: number;
  uncertaintyComponent: number;
  diversityComponent: number;
  progressComponent: number;
  estimatedDemosNeeded: number;
  currentDemoCount: number;
  recommendation: string;
  reasoning: string[];
}

/**
 * Collection target status
 */
export type CollectionTargetStatus = 'active' | 'completed' | 'paused' | 'cancelled';

/**
 * Collection target
 */
export interface CollectionTarget {
  id: string;
  targetType: CollectionTargetType;
  targetName: string;
  priorityScore: number;
  estimatedDemos: number;
  collectedDemos: number;
  status: CollectionTargetStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// LABELS AND COLORS
// ============================================================================

export const SESSION_STATUS_LABELS: Record<TeleoperationStatus, string> = {
  created: 'Ready',
  recording: 'Recording',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

export const SESSION_STATUS_COLORS: Record<TeleoperationStatus, 'default' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  created: 'default',
  recording: 'primary',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
};

export const TELEOPERATION_TYPE_LABELS: Record<TeleoperationType, string> = {
  vr_quest: 'Meta Quest VR',
  vr_vision_pro: 'Vision Pro',
  bilateral_aloha: 'Bilateral ALOHA',
  kinesthetic: 'Kinesthetic teaching',
  keyboard_mouse: 'Keyboard & mouse',
  gamepad: 'Gamepad',
};

export const TELEOPERATION_TYPE_DESCRIPTIONS: Record<TeleoperationType, string> = {
  vr_quest: 'Meta Quest VR headset for immersive teleoperation',
  vr_vision_pro: 'Apple Vision Pro for spatial computing teleoperation',
  bilateral_aloha: 'ALOHA-style bilateral arm teleoperation system',
  kinesthetic: 'Physical guidance and demonstration teaching',
  keyboard_mouse: 'Desktop teleoperation with keyboard and mouse',
  gamepad: 'Gamepad or joystick control interface',
};

export const TARGET_TYPE_LABELS: Record<CollectionTargetType, string> = {
  task: 'Task',
  environment: 'Environment',
  task_environment: 'Task + Environment',
};

export const TREND_COLORS: Record<'improving' | 'stable' | 'degrading', string> = {
  improving: 'text-signal-measured',
  stable: 'text-ink-tertiary',
  degrading: 'text-signal-stopped',
};

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Create session request
 */
export interface CreateSessionRequest {
  operatorId: string;
  robotId: string;
  type: TeleoperationType;
  fps?: number;
  languageInstr?: string;
  numEpisodes?: number;
  episodeTimeS?: number;
  datasetRepoId?: string;
}

/**
 * Session list params
 */
export interface SessionListParams {
  operatorId?: string;
  robotId?: string;
  type?: TeleoperationType | TeleoperationType[];
  status?: TeleoperationStatus | TeleoperationStatus[];
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

/**
 * Session list response
 */
export interface SessionListResponse {
  sessions: TeleoperationSession[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Annotate session request
 */
export interface AnnotateSessionRequest {
  languageInstr: string;
}

/**
 * Export session request
 */
export interface ExportSessionRequest {
  datasetName?: string;
  description?: string;
  skillId?: string;
}

/**
 * Export result response
 */
export interface ExportResultResponse {
  sessionId: string;
  datasetId: string;
  datasetName: string;
  trajectoryCount: number;
  totalFrames: number;
  storagePath: string;
}

/**
 * Log prediction request
 */
export interface LogPredictionRequest {
  modelId: string;
  robotId: string;
  inputHash: string;
  taskCategory: string;
  environment: string;
  confidence: number;
  wasCorrect?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Get uncertainty params
 */
export interface GetUncertaintyParams {
  modelId: string;
  groupBy?: 'task' | 'environment' | 'both';
  windowDays?: number;
}

/**
 * Get priorities params
 */
export interface GetPrioritiesParams {
  modelId?: string;
  limit?: number;
  minPriorityScore?: number;
  targetType?: CollectionTargetType;
}

/**
 * Collection priorities response
 */
export interface CollectionPrioritiesResponse {
  modelId: string;
  generatedAt: string;
  priorities: CollectionPriority[];
  summary: {
    totalTargets: number;
    highPriorityCount: number;
    totalDemosNeeded: number;
    topRecommendation: string;
  };
}

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Session filters
 */
export interface SessionFilters {
  status?: TeleoperationStatus;
  type?: TeleoperationType;
  robotId?: string;
  operatorId?: string;
}

/**
 * Session pagination
 */
export interface SessionPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_SESSION_PAGINATION: SessionPagination = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

// ============================================================================
// STORE TYPES
// ============================================================================

/**
 * Error codes
 */
export type DataCollectionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_STARTED'
  | 'SESSION_NOT_RECORDING'
  | 'ROBOT_NOT_AVAILABLE'
  | 'EXPORT_FAILED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Data collection state
 */
export interface DataCollectionState {
  // Teleoperation
  sessions: TeleoperationSession[];
  selectedSession: TeleoperationSession | null;
  activeSession: TeleoperationSession | null;
  qualityFeedback: QualityFeedback | null;
  episodes: EpisodeSummary[];
  recordingProgress: TeleopRecordingProgress | null;
  /** TASK-410: the session's one live state, as the server last sent it. */
  live: LiveState | null;
  /** Server clock minus this tab's clock, from `live.at` (ms). */
  liveClockOffsetMs: number;
  /** The quick check of the take that stopped last, until dismissed. */
  lastQuickCheck: QuickCheck | null;
  /** The take action this tab has in flight, if any. */
  takePending: TakeAction | null;
  /** TASK-414: who watches the session on screen. */
  presence: { sessionId: string; viewers: PresenceViewer[] } | null;
  /** TASK-414: the operator's latest relayed state; stale after `OPERATOR_STALE_MS`. */
  operator: OperatorSnapshot | null;
  /** TASK-414: takes kept in a row, and the session's best run. */
  streak: { sessionId: string; current: number; previousBest: number; best: number; kept: number; discarded: number } | null;
  /** This tab's id, sent with every take action so it can tell its own events apart. Fixed per tab. */
  clientId: string;
  sessionFilters: SessionFilters;
  sessionPagination: SessionPagination;
  // Active Learning
  uncertaintyAnalysis: UncertaintyAnalysis | null;
  collectionPriorities: CollectionPriority[];
  collectionTargets: CollectionTarget[];
  // UI State
  isLoading: boolean;
  error: string | null;
}

/**
 * Data collection actions
 */
export interface DataCollectionActions {
  // Sessions
  fetchSessions: () => Promise<void>;
  fetchSession: (id: string) => Promise<void>;
  createSession: (data: CreateSessionRequest) => Promise<TeleoperationSession>;
  startSession: (id: string) => Promise<void>;
  pauseSession: (id: string) => Promise<void>;
  resumeSession: (id: string) => Promise<void>;
  endSession: (id: string) => Promise<void>;
  annotateSession: (id: string, languageInstr: string) => Promise<void>;
  exportSession: (id: string, data: ExportSessionRequest) => Promise<ExportResultResponse>;
  selectSession: (session: TeleoperationSession | null) => void;
  setActiveSession: (session: TeleoperationSession | null) => void;
  setQualityFeedback: (feedback: QualityFeedback | null) => void;
  // Episodes
  fetchEpisodes: (id: string) => Promise<void>;
  nextEpisode: (id: string) => Promise<number>;
  discardEpisode: (id: string, episodeIndex: number) => Promise<void>;
  // Takes (TASK-410): guarded by the take this tab believes is live
  fetchLive: (id: string) => Promise<void>;
  startTake: (id: string, source?: EpisodeSource) => Promise<boolean>;
  stopTake: (id: string, source?: EpisodeSource) => Promise<boolean>;
  nextTake: (id: string, source?: EpisodeSource) => Promise<boolean>;
  /** Discard the last take; `expectedTake` pins the take seen when the discard was asked for. */
  discardLastTake: (id: string, source?: EpisodeSource, expectedTake?: number | null) => Promise<boolean>;
  discardTake: (id: string, take: number, source?: EpisodeSource) => Promise<boolean>;
  dismissQuickCheck: () => void;
  // WebSocket-driven updates
  handleTeleopEvent: (event: TeleopWsEvent) => void;
  // Filters
  setSessionFilters: (filters: Partial<SessionFilters>) => void;
  clearSessionFilters: () => void;
  setSessionPage: (page: number) => void;
  // Active Learning
  fetchUncertainty: (params: GetUncertaintyParams) => Promise<void>;
  fetchPriorities: (params?: GetPrioritiesParams) => Promise<void>;
  logPrediction: (data: LogPredictionRequest) => Promise<void>;
  // Error handling
  clearError: () => void;
  reset: () => void;
}

/**
 * Data collection store type
 */
export type DataCollectionStore = DataCollectionState & DataCollectionActions;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format duration in seconds to human readable
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get priority color based on score
 */
export function getPriorityColor(score: number): string {
  if (score >= 0.8) return 'text-signal-stopped';
  if (score >= 0.4) return 'text-signal-estimated';
  return 'text-ink-secondary';
}

/**
 * Get priority label based on score
 */
export function getPriorityLabel(score: number): string {
  if (score >= 0.8) return 'Critical';
  if (score >= 0.6) return 'High';
  if (score >= 0.4) return 'Medium';
  return 'Low';
}

/**
 * Check if session can be started
 */
export function canStartSession(session: TeleoperationSession): boolean {
  return session.status === 'created' || session.status === 'paused';
}

/**
 * Check if session can be paused
 */
export function canPauseSession(session: TeleoperationSession): boolean {
  return session.status === 'recording';
}

/**
 * Check if session can be ended
 */
export function canEndSession(session: TeleoperationSession): boolean {
  return session.status === 'recording' || session.status === 'paused';
}

/**
 * The retargeting an episode was driven with, for a table cell.
 *
 * Three states, all real and all different (TASK-216):
 *
 * - `undefined` — the robot agent did not say. Every episode recorded before
 *   TASK-216, and any recorded by an agent that has not been updated. An
 *   em-dash, exactly like the other unrecorded statistics.
 * - `[]` — the agent said nothing drove this take. "none", not a blank.
 * - anything else — the modes, joined. A take that used two says so, because
 *   an operator can change how they are driving between one take and the next
 *   and a dataset that mixes them silently is a trap for whoever trains on it.
 */
export function formatRetargetModes(modes: string[] | undefined): string {
  if (modes === undefined) return '—';
  if (modes.length === 0) return 'none';
  return modes.join(' + ');
}

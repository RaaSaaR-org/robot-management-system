/**
 * @file datacollection.types.ts
 * @description Type definitions for data collection feature (teleoperation & active learning)
 * @feature datacollection
 * @dependencies None
 */

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
  kinesthetic: 'Kinesthetic Teaching',
  keyboard_mouse: 'Keyboard & Mouse',
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
  improving: 'text-green-600 dark:text-green-400',
  stable: 'text-gray-600 dark:text-gray-400',
  degrading: 'text-red-600 dark:text-red-400',
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
  if (score >= 0.8) return 'text-red-600 dark:text-red-400';
  if (score >= 0.6) return 'text-orange-600 dark:text-orange-400';
  if (score >= 0.4) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-green-600 dark:text-green-400';
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

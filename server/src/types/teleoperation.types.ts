/**
 * @file teleoperation.types.ts
 * @description Type definitions for Teleoperation Data Collection
 * @feature datacollection
 */

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Types of teleoperation methods
 */
export type TeleoperationType =
  | 'vr_quest'         // Meta Quest VR headset
  | 'vr_vision_pro'    // Apple Vision Pro
  | 'bilateral_aloha'  // ALOHA-style bilateral teleoperation
  | 'kinesthetic'      // Physical guidance
  | 'keyboard_mouse'   // Desktop teleoperation
  | 'gamepad';         // Gamepad/joystick control

/**
 * Session status
 */
export type TeleoperationStatus =
  | 'created'    // Session created but not started
  | 'recording'  // Actively recording
  | 'paused'     // Recording paused
  | 'completed'  // Session completed successfully
  | 'failed';    // Session failed with error

/**
 * Teleoperation session model
 */
export interface TeleoperationSession {
  id: string;
  operatorId: string;
  robotId: string;
  type: TeleoperationType;
  status: TeleoperationStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  frameCount: number;
  duration: number | null;
  fps: number;
  languageInstr: string | null;
  qualityScore: number | null;
  exportedDatasetId: string | null;
  errorMessage: string | null;
  /** Target episode count (hardware sidecar or UI progress display) */
  numEpisodes?: number | null;
  /** HF-style repo id, when the session was created with one. */
  datasetRepoId?: string | null;
  /** Path on the hardware sidecar where lerobot-record wrote its dataset. */
  sidecarDatasetPath?: string | null;
  /**
   * Which recorder produced this session's data (TASK-215): `agent` wrote a
   * LeRobot v3.0 tree on the robot, `sim` wrote TeleoperationFrame rows here,
   * `sidecar` ran lerobot-record on the hardware. Null for sessions recorded
   * before the distinction existed.
   */
  recorderKind?: 'agent' | 'sim' | 'sidecar' | null;
  /** Path ON THE ROBOT where the agent's recorder wrote the dataset. */
  agentDatasetPath?: string | null;
  /** Per-take auto-stop in seconds (TASK-406); null = the operator ends each take. */
  episodeTimeS?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Teleoperation frame model
 */
export interface TeleoperationFrame {
  id: string;
  sessionId: string;
  frameIndex: number;
  episodeIndex: number;
  timestamp: number;
  jointPositions: number[];
  jointVelocities: number[] | null;
  action: number[];
  imagePath: string | null;
  depthImagePath: string | null;
  isIntervention: boolean;
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
  /**
   * Ticks the recorder wanted and did not get (TASK-215). Absent for sessions
   * recorded before there was a recorder that could count them — a missing
   * frame leaves no row, so this can never be derived from the frames.
   */
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
// DTO TYPES
// ============================================================================

/**
 * Create session request
 */
export interface CreateSessionDto {
  operatorId: string;
  robotId: string;
  type: TeleoperationType;
  fps?: number;
  languageInstr?: string;
  /** Hardware recording: number of episodes to record */
  numEpisodes?: number;
  /** Hardware recording: max seconds per episode */
  episodeTimeS?: number;
  /** Hardware recording: HF-style repo_id for the dataset */
  datasetRepoId?: string;
}

/**
 * Record frame request
 */
export interface RecordFrameDto {
  timestamp: number;
  jointPositions: number[];
  jointVelocities?: number[];
  action: number[];
  isIntervention?: boolean;
  /** Episode within the session this frame belongs to (default 0) */
  episodeIndex?: number;
}

/**
 * Batch record frames request
 */
export interface BatchRecordFramesDto {
  frames: RecordFrameDto[];
}

/**
 * Update session request
 */
export interface UpdateSessionDto {
  languageInstr?: string;
  fps?: number;
}

/**
 * Annotate session request
 */
export interface AnnotateSessionDto {
  languageInstr: string;
}

/**
 * Export session request
 */
export interface ExportSessionDto {
  datasetName?: string;
  description?: string;
  skillId?: string;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Session response with computed fields
 */
export interface SessionResponse extends TeleoperationSession {
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
 * Session list response
 */
export interface SessionListResponse {
  sessions: SessionResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Frame upload response
 */
export interface FrameUploadResponse {
  sessionId: string;
  frameIndex: number;
  uploadUrl: string;
  expiresIn: number;
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

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing sessions
 */
export interface SessionListQuery {
  operatorId?: string;
  robotId?: string;
  type?: TeleoperationType | TeleoperationType[];
  status?: TeleoperationStatus | TeleoperationStatus[];
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

// ============================================================================
// QUALITY FEEDBACK TYPES
// ============================================================================

/**
 * Real-time quality feedback
 */
export interface QualityFeedback {
  sessionId: string;
  currentSmoothnessScore: number;
  isJerky: boolean;
  warningMessage?: string;
  suggestions?: string[];
}

/**
 * Quality thresholds for real-time feedback
 */
export interface QualityThresholds {
  maxJerk: number;           // rad/s³
  maxVelocity: number;       // rad/s
  minPathSmoothness: number; // 0-1 score
}

/**
 * Default quality thresholds
 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  maxJerk: 100,
  maxVelocity: 5.0,
  minPathSmoothness: 0.7,
};

// ============================================================================
// LEROBOT EXPORT TYPES
// ============================================================================

/**
 * LeRobot v3 info structure for export
 */
export interface LeRobotExportInfo {
  codebase_version: string;
  robot_type: string;
  fps: number;
  features: Record<string, {
    dtype: string;
    shape: number[];
    video?: boolean;
  }>;
  total_episodes: number;
  total_frames: number;
  data_path: string;
}

/**
 * LeRobot v3 episode metadata
 */
export interface LeRobotEpisode {
  episode_index: number;
  length: number;
  task?: string;
}

/**
 * Export job status
 */
export interface ExportJobStatus {
  sessionId: string;
  status: 'pending' | 'exporting' | 'completed' | 'failed';
  progress: number;
  datasetId?: string;
  errorMessage?: string;
}

// ============================================================================
// WEBSOCKET TYPES (for robot agent communication)
// ============================================================================

/**
 * WebSocket message types for teleoperation
 */
export type TeleopMessageType =
  | 'start_recording'
  | 'stop_recording'
  | 'pause_recording'
  | 'resume_recording'
  | 'frame_data'
  | 'command'
  | 'state_update'
  | 'quality_feedback'
  | 'error';

/**
 * Base WebSocket message
 */
export interface TeleopMessage {
  type: TeleopMessageType;
  sessionId: string;
  timestamp: number;
}

/**
 * Frame data message
 */
export interface FrameDataMessage extends TeleopMessage {
  type: 'frame_data';
  frame: RecordFrameDto;
}

/**
 * Command message (for VR/bilateral control)
 */
export interface CommandMessage extends TeleopMessage {
  type: 'command';
  commandType: 'joint_target' | 'cartesian_target' | 'gripper';
  data: number[] | { position: number[]; orientation: number[] };
}

/**
 * State update message
 */
export interface StateUpdateMessage extends TeleopMessage {
  type: 'state_update';
  jointPositions: number[];
  jointVelocities?: number[];
  endEffectorPose?: { position: number[]; orientation: number[] };
}

/**
 * Quality feedback message
 */
export interface QualityFeedbackMessage extends TeleopMessage {
  type: 'quality_feedback';
  feedback: QualityFeedback;
}

/**
 * Error message
 */
export interface ErrorMessage extends TeleopMessage {
  type: 'error';
  code: string;
  message: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Teleoperation event types
 */
export type TeleoperationEventType =
  | 'session:created'
  | 'session:started'
  | 'session:paused'
  | 'session:resumed'
  | 'session:completed'
  | 'session:failed'
  | 'session:exported'
  | 'session:progress'
  | 'frame:recorded'
  | 'quality:warning'
  // TASK-408: explicit episode control, shared by every client of a session.
  | 'episode:started'
  | 'episode:stopped'
  | 'episode:discarded'
  | 'session:live';

/**
 * Live recording progress payload (sim frame recorder + sidecar poller)
 */
export interface RecordingProgress {
  /** Frames captured so far (buffered + persisted) */
  frameCount?: number;
  /** Current episode index being recorded */
  currentEpisode?: number;
  /** Episodes finished (sidecar path) */
  episodesDone?: number;
  /** Elapsed recording time in seconds (pauses excluded) */
  elapsedS?: number;
  /** Actual measured sampling rate (frames/second) */
  fpsActual?: number;
  /** True while the recorder is actively sampling */
  running?: boolean;
  /** True when the robot agent is unreachable and frames are being missed */
  degraded?: boolean;
}

/**
 * Teleoperation event
 */
export interface TeleoperationEvent {
  type: TeleoperationEventType;
  sessionId: string;
  session?: SessionResponse;
  frameIndex?: number;
  qualityFeedback?: QualityFeedback;
  recordingProgress?: RecordingProgress;
  error?: string;
  /** Human-readable detail for `quality:warning` — what is going wrong, in words. */
  message?: string;
  /** TASK-408: the full live state (`session:live`, and every episode event). */
  live?: LiveState;
  /** TASK-408: the take an `episode:*` event is about. */
  take?: number;
  /** TASK-408: `episode:started` — ISO server time the take began. */
  startedAt?: string;
  /** TASK-408: `episode:stopped` — the take's quick check. */
  quickCheck?: QuickCheck | null;
  /** TASK-408: `episode:stopped` — why it stopped. */
  reason?: EpisodeStopReason;
  /** TASK-408: who caused an `episode:*` event. */
  by?: EpisodeActor;
  timestamp: Date;
}

// ============================================================================
// EPISODE CONTROL + LIVE STATE (TASK-408)
// ============================================================================

/** Where an episode action came from. */
export type EpisodeSource = 'vr' | 'desktop' | 'hotkey';

/**
 * Why a take ended. `time_limit` is the agent's own auto-stop; `estop` is the
 * agent ending (and discarding) the take because an emergency stop latched
 * mid-take (TASK-416 D4).
 */
export type EpisodeStopReason = 'operator' | 'time_limit' | 'next' | 'session_end' | 'estop';

/** Who caused an episode event. `source: 'auto'` is the recorder itself. */
export interface EpisodeActor {
  userId: string | null;
  displayName: string | null;
  source: EpisodeSource | 'auto';
  clientId: string | null;
}

/** What a client sends with start / stop / next / discard. */
export interface EpisodeActionContext {
  /**
   * The take the client believes is live (or last). Given and different from
   * the server's → 409 `episode_conflict`. `null` means "no take yet";
   * absent means "do not check".
   */
  expectedTake?: number | null;
  clientId?: string;
  source: EpisodeSource;
  user: { userId: string | null; displayName: string | null };
}

export type EpisodeConflictCode =
  | 'episode_conflict'
  | 'already_capturing'
  | 'not_capturing'
  | 'not_recording'
  | 'unsupported_recorder'
  | 'no_take'
  | 'already_discarded'
  /** DELETE of a take number this session never had → 404. */
  | 'unknown_take';

export interface JointMoved {
  name: string;
  rangeRad: number;
}

/** The robot's verdict on one finished take. */
export interface QuickCheck {
  take: number;
  frames: number;
  durationS: number;
  droppedFrames: number;
  fpsActual: number;
  jointsMoved: JointMoved[];
  groupsMoved: string[];
  warnings: string[];
  /** Server path of the take's middle frame, or null when there is none. */
  thumbnailUrl: string | null;
  stopReason: EpisodeStopReason | null;
  /** The take was discarded after it stopped. */
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
  /** Server time this state was built — clients derive their clock offset from it. */
  at: string;
}

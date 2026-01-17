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
  timestamp: number;
  jointPositions: number[];
  jointVelocities: number[] | null;
  action: number[];
  imagePath: string | null;
  depthImagePath: string | null;
  isIntervention: boolean;
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
  | 'frame:recorded'
  | 'quality:warning';

/**
 * Teleoperation event
 */
export interface TeleoperationEvent {
  type: TeleoperationEventType;
  sessionId: string;
  session?: SessionResponse;
  frameIndex?: number;
  qualityFeedback?: QualityFeedback;
  error?: string;
  timestamp: Date;
}

/**
 * @file dataset.types.ts
 * @description Type definitions for Dataset Management API
 * @feature datasets
 */

import type { DatasetStructureReport, ValidationFinding } from '../services/lerobot/validateDataset.js';

import type {
  Dataset,
  DatasetImportError,
  DatasetImportMode,
  DatasetStatus,
  LeRobotInfo,
  LeRobotStats,
} from './vla.types.js';

// Provenance types live in the domain module (`vla.types.ts`) and are
// re-exported here so an API consumer has one import for the whole response
// shape rather than two.
export type { DatasetImportError, DatasetImportMode };

// ============================================================================
// LEROBOT V3 FORMAT TYPES
// ============================================================================

/**
 * LeRobot v3 feature definition
 */
export interface LeRobotFeature {
  dtype: string;
  shape: number[];
  /** v1/v2 legacy flag; v3 uses dtype='video' instead */
  video?: boolean;
  names?: string[] | null;
  info?: Record<string, unknown>;
}

/**
 * LeRobot v3 info.json structure
 */
export interface LeRobotInfoV3 {
  codebase_version: string;
  robot_type: string;
  fps: number;
  features: Record<string, LeRobotFeature>;
  splits?: Record<string, string>;
  total_episodes?: number;
  total_frames?: number;
  total_tasks?: number;
  total_chunks?: number;
  chunks_size?: number;
  data_path?: string;
  video_path?: string;
  video?: boolean;
}

/**
 * LeRobot v3 stats.json structure
 */
export interface LeRobotStatsV3 {
  mean: Record<string, number[]>;
  std: Record<string, number[]>;
  min: Record<string, number[]>;
  max: Record<string, number[]>;
}

/**
 * LeRobot v3 episode metadata
 */
export interface LeRobotEpisode {
  episode_index: number;
  length: number;
  timestamp_start?: string;
  timestamp_end?: string;
  task?: string;
}

// ============================================================================
// HUGGINGFACE IMPORT TYPES
// ============================================================================

/**
 * Request body for HuggingFace dataset import
 */
export interface HuggingFaceImportRequest {
  /** HuggingFace repo ID, e.g. "lerobot/svla_so101_pickplace" */
  repoId: string;
  /** Git revision/branch, default: "main" */
  revision?: string;
  /** Optional robot type ID to associate with the dataset */
  robotTypeId?: string;
  /** Whether to include video files (can be very large), default: false */
  includeVideos?: boolean;
}

/**
 * What a Hub repo IS, read without importing it (TASK-220).
 *
 * `fileCount`, `dataBytes` and `videoBytes` all describe the SAME set: the
 * files a full import would fetch (`meta/`, `data/`, `videos/`). Repo furniture
 * — README, .gitattributes — is deliberately excluded, so the three numbers
 * agree with each other and with what the download will actually cost.
 */
export interface HuggingFacePreview {
  repoId: string;
  /** What the caller asked for, e.g. `main`. */
  revision: string;
  /** The commit that branch points at right now. What an import would pin. */
  resolvedRevision: string;
  lerobotVersion: string;
  robotType: string;
  fps: number;
  totalEpisodes: number;
  totalFrames: number;
  /** `null` when info.json declares no shape for the feature. */
  stateWidth: number | null;
  actionWidth: number | null;
  cameraKeys: string[];
  fileCount: number;
  /** meta/ + data/ bytes. */
  dataBytes: number;
  /** videos/ bytes — the half worth warning about. */
  videoBytes: number;
  license: string | null;
}

/**
 * Progress tracking for HuggingFace import
 */
export interface HuggingFaceImportProgress {
  datasetId: string;
  status: 'importing' | 'validating' | 'ready' | 'failed';
  phase: 'metadata' | 'downloading' | 'storing' | 'validating';
  progress: number;
  currentFile?: string;
  totalFiles?: number;
  completedFiles?: number;
  error?: string;
}

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating a new dataset
 */
export interface CreateDatasetDto {
  name: string;
  description?: string;
  robotTypeId?: string;
  skillId?: string;
  /**
   * Register a dataset that ALREADY EXISTS at this path instead of minting an
   * empty one to upload into (TASK-215).
   *
   * An absolute local directory, or a RustFS prefix. When it is given the row is
   * created `ready` rather than `uploading`, and the metadata below is taken
   * from the caller rather than zeroed — because there is nothing to wait for.
   * `server/src/scripts/register-local-dataset.ts` documents this gap in a
   * comment; this is it being closed.
   */
  storagePath?: string;
  /** Only meaningful with `storagePath`. */
  lerobotVersion?: string;
  fps?: number;
  totalFrames?: number;
  totalDuration?: number;
  demonstrationCount?: number;
  infoJson?: Record<string, unknown>;
}

/**
 * DTO for updating dataset metadata
 */
export interface UpdateDatasetDto {
  name?: string;
  description?: string;
  skillId?: string;
  huggingFaceRepoId?: string;
}

/**
 * Query parameters for listing datasets
 */
export interface DatasetListQuery {
  robotTypeId?: string;
  skillId?: string;
  status?: DatasetStatus | DatasetStatus[];
  minQuality?: number;
  page?: number;
  limit?: number;
}

/**
 * Dataset response with relations
 */
export interface DatasetResponse extends Omit<Dataset, 'robotType' | 'skill'> {
  robotType?: {
    id: string;
    name: string;
    manufacturer: string;
    model: string;
  };
  skill?: {
    id: string;
    name: string;
    version: string;
  };
  qualityBreakdown?: QualityScoreBreakdown;
  /** The commit an import pinned, or null for a dataset that came from elsewhere. */
  sourceRevision: string | null;
  importMode: DatasetImportMode | null;
  /**
   * Why the last import failed, or null. Read off the row rather than off a
   * WebSocket broadcast, which for a fast failure has already been missed.
   */
  importError: DatasetImportError | null;
  /**
   * What structural validation found (TASK-217). Absent means nothing has ever
   * opened this dataset's files — not the same as "validated and clean".
   */
  validation?: {
    validatedAt?: string;
    valid: boolean;
    lerobotVersion: string;
    errors: ValidationFinding[];
    warnings: ValidationFinding[];
    imageKeys: string[];
    fileCount: number;
  };
}

/**
 * Paginated dataset list response
 */
export interface DatasetListResponse {
  data: DatasetResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// QUALITY SCORING
// ============================================================================

/**
 * Quality score breakdown (0-100 total)
 */
export interface QualityScoreBreakdown {
  /** Points for demonstration count (0-40) */
  demonstrationCount: number;
  /** Points for total duration (0-30) */
  duration: number;
  /** Points for episode diversity (0-20) */
  diversity: number;
  /** Points for format compliance (0-10) */
  formatCompliance: number;
  /** Total score (0-100) */
  total: number;
}

/**
 * Quality scoring thresholds
 */
export const QUALITY_THRESHOLDS = {
  /** Max demos for full points */
  DEMO_COUNT_MAX: 50,
  /** Max duration in seconds for full points */
  DURATION_MAX: 3600,
  /** Cameras that earn the whole sensor-coverage share. */
  CAMERAS_FOR_FULL: 2,
  /** Points allocation */
  POINTS: {
    DEMO_COUNT: 40,
    DURATION: 30,
    /**
     * Sensor coverage and structural integrity, measured from the files.
     *
     * Still surfaced as `diversity` on {@link QualityScoreBreakdown} because
     * the field is on the wire and in the UI; the NUMBER is no longer a
     * two-valued placeholder derived from the episode count.
     */
    COVERAGE: 20,
    FORMAT_COMPLIANCE: 10,
  },
} as const;

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Result of dataset validation
 */
export interface DatasetValidationResult {
  /** Whether the dataset is valid */
  valid: boolean;
  /** Error messages (if any) */
  errors: string[];
  /** Warning messages */
  warnings: string[];
  /** Parsed info.json (if valid) */
  info?: LeRobotInfoV3;
  /** Parsed stats.json (if exists) */
  stats?: LeRobotStatsV3;
  /** Number of episodes */
  episodeCount: number;
  /** Total frame count */
  totalFrames: number;
  /** Total duration in seconds */
  totalDuration: number;
  /** LeRobot format version */
  lerobotVersion: string;
  /** FPS from info.json */
  fps: number;
  /**
   * The full structural report, with per-finding codes and the list of files
   * that were actually opened (TASK-217).
   *
   * `errors` and `warnings` above are its messages flattened, kept because
   * every existing caller reads them. This carries what a UI needs to decide
   * what to SHOW — a missing camera is a different thing to surface from a
   * missing parquet, and prose cannot be branched on.
   */
  report?: DatasetStructureReport;
  /**
   * The store could not be reached, so nothing was checked (TASK-217 review).
   *
   * Distinct from `valid: false`, which means the files were opened and are
   * wrong. A caller must not write `status: 'failed'` on this one: the dataset
   * may be perfectly good and the object store merely down.
   */
  storeUnavailable?: boolean;
}

/**
 * Validation job payload for NATS
 */
export interface DatasetValidationJobPayload {
  datasetId: string;
  storagePath: string;
}

/**
 * Validation progress update
 */
export interface DatasetValidationProgress {
  datasetId: string;
  status: 'validating' | 'computing_stats' | 'ready' | 'failed';
  progress: number;
  message?: string;
  errors?: string[];
}

// ============================================================================
// UPLOAD TYPES
// ============================================================================

/**
 * Request to initiate dataset upload
 */
export interface InitiateUploadRequest {
  contentType?: string;
  size?: number;
}

/**
 * Response from initiating upload
 */
export interface InitiateUploadResponse {
  uploadUrl: string;
  expiresIn: number;
  storagePath: string;
}

/**
 * Request to complete dataset upload
 */
export interface CompleteUploadRequest {
  /** Optional override for storage path if different from initiated */
  storagePath?: string;
}

/**
 * Response from completing upload
 */
export interface CompleteUploadResponse {
  datasetId: string;
  status: DatasetStatus;
  message: string;
}

// ============================================================================
// STATS COMPUTATION TYPES
// ============================================================================

/**
 * Request to compute stats
 */
export interface ComputeStatsRequest {
  force?: boolean;
}

/**
 * Stats computation job payload for NATS
 */
export interface ComputeStatsJobPayload {
  datasetId: string;
  storagePath: string;
  force: boolean;
}

/**
 * Stats response
 */
export interface DatasetStatsResponse {
  datasetId: string;
  hasStats: boolean;
  stats?: LeRobotStatsV3;
  computedAt?: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Dataset event types for WebSocket
 */
export type DatasetEventType =
  | 'dataset:created'
  | 'dataset:updated'
  | 'dataset:deleted'
  | 'dataset:upload:initiated'
  | 'dataset:upload:completed'
  | 'dataset:validation:started'
  | 'dataset:validation:progress'
  | 'dataset:validation:completed'
  | 'dataset:validation:failed'
  | 'dataset:import:started'
  | 'dataset:import:progress'
  | 'dataset:import:completed'
  | 'dataset:import:failed'
  | 'dataset:push-hf:started'
  | 'dataset:push-hf:progress'
  | 'dataset:push-hf:completed'
  | 'dataset:push-hf:failed';

/**
 * Dataset event payload
 */
export interface DatasetEvent {
  type: DatasetEventType;
  datasetId: string;
  dataset?: DatasetResponse;
  progress?: DatasetValidationProgress;
  importProgress?: HuggingFaceImportProgress;
  error?: string;
  timestamp: string;
}

/**
 * Dataset event callback type
 */
export type DatasetEventCallback = (event: DatasetEvent) => void;

// ============================================================================
// EPISODE VIEWER TYPES
// ============================================================================

/**
 * Per-camera playback window of an episode inside a LeRobot v3.0 chunk video.
 * v3.0 concatenates all episodes of a chunk into one mp4 per camera; the
 * episodes parquet records where each episode lives
 * (videos/observation.images.<cam>/{chunk_index,file_index,from,to}).
 */
export interface EpisodeVideoWindow {
  /** Start of the episode inside the chunk video (seconds) */
  from: number;
  /** End of the episode inside the chunk video (seconds) */
  to: number;
  /** videos/<key>/chunk-{chunk:03d} the episode's video lives in */
  chunk: number;
  /** file-{file:03d} within the chunk (multi-file chunks, see #179) */
  file: number;
}

/**
 * Episode metadata for the episode list
 */
export interface EpisodeMeta {
  index: number;
  frameCount: number;
  durationSeconds: number;
  flagged: boolean;
  /**
   * v3.0 chunked datasets only: playback window per camera (short key,
   * e.g. "cam_left_high"). Absent for v2.x per-episode video files.
   */
  videoWindows?: Record<string, EpisodeVideoWindow>;
}

/**
 * Single frame of an episode with action and observation data
 */
export interface FrameData {
  frameIndex: number;
  timestamp: number;
  /** 6 DOF: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper */
  action: number[];
  /** 6 DOF: same joint ordering as action */
  observationState: number[];
}

// ============================================================================
// HUGGINGFACE PUSH TYPES
// ============================================================================

/**
 * Request body for pushing a dataset to HuggingFace Hub
 */
export interface PushToHubRequest {
  /** HuggingFace access token */
  token: string;
  /** HuggingFace repo ID, e.g. "username/my-dataset" */
  repoId: string;
  /** Whether the repo should be private */
  private?: boolean;
}

/**
 * Status of a push-to-hub job
 */
export type PushToHubStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * Push-to-hub job state (in-memory)
 */
export interface PushToHubJobState {
  status: PushToHubStatus;
  progress?: string;
  url?: string;
  error?: string;
  startedAt: string;
}

/**
 * @file dataset.types.ts
 * @description Type definitions for Dataset Management API
 * @feature datasets
 */

import type { Dataset, DatasetStatus, LeRobotInfo, LeRobotStats } from './vla.types.js';

// ============================================================================
// LEROBOT V3 FORMAT TYPES
// ============================================================================

/**
 * LeRobot v3 feature definition
 */
export interface LeRobotFeature {
  dtype: string;
  shape: number[];
  video?: boolean;
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
}

/**
 * DTO for updating dataset metadata
 */
export interface UpdateDatasetDto {
  name?: string;
  description?: string;
  skillId?: string;
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
  /** Points allocation */
  POINTS: {
    DEMO_COUNT: 40,
    DURATION: 30,
    DIVERSITY: 20,
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
  | 'dataset:validation:failed';

/**
 * Dataset event payload
 */
export interface DatasetEvent {
  type: DatasetEventType;
  datasetId: string;
  dataset?: DatasetResponse;
  progress?: DatasetValidationProgress;
  error?: string;
  timestamp: string;
}

/**
 * Dataset event callback type
 */
export type DatasetEventCallback = (event: DatasetEvent) => void;

/**
 * @file data-quality.types.ts
 * @description Type definitions for Advanced Data Quality Validation Pipeline
 * @feature datasets
 */

// ============================================================================
// TRAJECTORY METRICS
// ============================================================================

/**
 * Smoothness metrics for a trajectory
 */
export interface SmoothnessMetrics {
  /** RMS jerk (d³p/dt³) - lower is smoother */
  rmsJerk: number;
  /** Logarithmic Dimensionless Jerk - normalized, noise-resistant */
  ldlj: number;
  /** Position instability - sum of ||p_t - p_{t-1}|| variations */
  positionInstability: number;
  /** Maximum acceleration */
  maxAcceleration: number;
}

/**
 * Consistency metrics across demonstrations
 */
export interface ConsistencyMetrics {
  /** Path length of trajectory */
  pathLength: number;
  /** Effort metric - integrated torque/force over trajectory */
  effort: number;
  /** Execution duration in seconds */
  duration: number;
}

/**
 * Anomaly detection results
 */
export interface AnomalyDetectionResult {
  /** Whether anomalies were detected */
  hasAnomalies: boolean;
  /** Types of anomalies detected */
  anomalyTypes: AnomalyType[];
  /** Indices of anomalous points in trajectory */
  anomalyIndices: number[];
  /** Z-scores for outlier points */
  zScores: number[];
  /** Whether trajectory violates envelope bounds */
  envelopeViolation: boolean;
  /** Velocity spike detection */
  velocitySpikes: VelocitySpike[];
}

/**
 * Types of anomalies that can be detected
 */
export type AnomalyType =
  | 'statistical_outlier'
  | 'envelope_violation'
  | 'velocity_spike'
  | 'acceleration_spike'
  | 'discontinuity'
  | 'stuck_joint'
  | 'oscillation';

/**
 * Velocity spike information
 */
export interface VelocitySpike {
  /** Index in trajectory */
  index: number;
  /** Joint affected */
  joint: number;
  /** Magnitude of spike */
  magnitude: number;
  /** Whether it's above threshold */
  isAnomaly: boolean;
}

/**
 * Complete metrics for a single trajectory
 */
export interface TrajectoryMetrics {
  /** Trajectory index in dataset */
  trajectoryIndex: number;
  /** Episode ID if available */
  episodeId?: string;
  /** Smoothness metrics */
  smoothness: SmoothnessMetrics;
  /** Consistency metrics */
  consistency: ConsistencyMetrics;
  /** Anomaly detection results */
  anomalies: AnomalyDetectionResult;
  /** Overall quality score for this trajectory (0-100) */
  qualityScore: number;
  /** Whether this trajectory is flagged for review */
  flagged: boolean;
  /** Reason for flagging */
  flagReason?: string;
  /** Computed at timestamp */
  computedAt: Date;
}

// ============================================================================
// DATASET QUALITY REPORT
// ============================================================================

/**
 * Quality score breakdown by category
 */
export interface QualityScoreBreakdown {
  /** Smoothness score (0-30) */
  smoothnessScore: number;
  /** Consistency score (0-30) */
  consistencyScore: number;
  /** Anomaly-free score (0-20) */
  anomalyScore: number;
  /** Completeness score (0-20) */
  completenessScore: number;
  /** Total score (0-100) */
  total: number;
}

/**
 * Statistical summary of metrics across dataset
 */
export interface MetricsStatistics {
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
  p25: number;
  p75: number;
}

/**
 * Dataset-level statistics for a metric
 */
export interface DatasetMetricsStats {
  rmsJerk: MetricsStatistics;
  ldlj: MetricsStatistics;
  pathLength: MetricsStatistics;
  effort: MetricsStatistics;
  duration: MetricsStatistics;
}

/**
 * Complete quality report for a dataset
 */
export interface DatasetQualityReport {
  /** Dataset ID */
  datasetId: string;
  /** Dataset name */
  datasetName: string;
  /** Report generation timestamp */
  generatedAt: Date;
  /** Overall quality score (0-100) */
  overallScore: number;
  /** Score breakdown by category */
  scoreBreakdown: QualityScoreBreakdown;
  /** Total trajectory count */
  trajectoryCount: number;
  /** Number of flagged trajectories */
  flaggedTrajectoryCount: number;
  /** Number of anomalous trajectories */
  anomalousTrajectoryCount: number;
  /** Percentage of clean trajectories */
  cleanTrajectoryPercentage: number;
  /** Dataset-level statistics */
  statistics: DatasetMetricsStats;
  /** Per-trajectory metrics (optional, can be large) */
  trajectoryMetrics?: TrajectoryMetrics[];
  /** Summary of flagged trajectories */
  flaggedSummary: FlaggedTrajectorySummary[];
  /** Validation status */
  validationStatus: ValidationStatus;
}

/**
 * Summary of a flagged trajectory
 */
export interface FlaggedTrajectorySummary {
  trajectoryIndex: number;
  episodeId?: string;
  flagReason: string;
  anomalyTypes: AnomalyType[];
  qualityScore: number;
  reviewed: boolean;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewDecision?: 'keep' | 'remove' | 'pending';
}

/**
 * Validation status for the report
 */
export type ValidationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ============================================================================
// OOD DETECTION (Out-of-Distribution)
// ============================================================================

/**
 * OOD detection result for an observation
 */
export interface OODDetectionResult {
  /** Whether observation is out-of-distribution */
  isOOD: boolean;
  /** Reconstruction error from cVAE (placeholder) */
  reconstructionError: number;
  /** Threshold used for OOD classification */
  threshold: number;
  /** Confidence in OOD classification */
  confidence: number;
  /** Distance to nearest in-distribution sample */
  distanceToID?: number;
}

/**
 * OOD summary for a dataset
 */
export interface OODSummary {
  /** Number of OOD samples */
  oodCount: number;
  /** Percentage of OOD samples */
  oodPercentage: number;
  /** Average reconstruction error */
  avgReconstructionError: number;
  /** OOD samples by trajectory */
  oodByTrajectory: Record<number, number>;
}

// ============================================================================
// DTW (Dynamic Time Warping)
// ============================================================================

/**
 * DTW distance result between two trajectories
 */
export interface DTWResult {
  /** DTW distance value */
  distance: number;
  /** Alignment path */
  path?: [number, number][];
  /** Normalized distance (by path length) */
  normalizedDistance: number;
}

/**
 * Pairwise DTW distances for a dataset
 */
export interface DTWMatrix {
  /** Matrix dimensions */
  size: number;
  /** Distance matrix (upper triangular) */
  distances: number[][];
  /** Average pairwise distance */
  averageDistance: number;
  /** Standard deviation of distances */
  stdDistance: number;
}

// ============================================================================
// VALIDATION JOB
// ============================================================================

/**
 * Advanced validation job configuration
 */
export interface AdvancedValidationConfig {
  /** Whether to compute per-trajectory metrics */
  computePerTrajectory: boolean;
  /** Whether to compute DTW matrix (expensive) */
  computeDTW: boolean;
  /** Whether to run OOD detection */
  runOODDetection: boolean;
  /** OOD threshold (if running OOD detection) */
  oodThreshold?: number;
  /** Anomaly detection Z-score threshold */
  anomalyZScoreThreshold: number;
  /** Velocity spike threshold (rad/s) */
  velocitySpikeThreshold: number;
  /** Acceleration spike threshold (rad/s²) */
  accelerationSpikeThreshold: number;
  /** Force recomputation even if metrics exist */
  force: boolean;
}

/**
 * Default validation configuration
 */
export const DEFAULT_VALIDATION_CONFIG: AdvancedValidationConfig = {
  computePerTrajectory: true,
  computeDTW: false,
  runOODDetection: false,
  oodThreshold: 0.5,
  anomalyZScoreThreshold: 3.0,
  velocitySpikeThreshold: 5.0,
  accelerationSpikeThreshold: 20.0,
  force: false,
};

/**
 * Validation job status
 */
export interface ValidationJobStatus {
  datasetId: string;
  status: ValidationStatus;
  progress: number;
  currentStep: string;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  config: AdvancedValidationConfig;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to trigger advanced validation
 */
export interface TriggerValidationRequest {
  config?: Partial<AdvancedValidationConfig>;
}

/**
 * Response from quality endpoint
 */
export interface DatasetQualityResponse {
  datasetId: string;
  hasQualityReport: boolean;
  report?: DatasetQualityReport;
  validationStatus?: ValidationJobStatus;
}

/**
 * Trajectory metrics request
 */
export interface TrajectoryMetricsRequest {
  trajectoryIndex: number;
}

/**
 * Trajectory metrics response
 */
export interface TrajectoryMetricsResponse {
  datasetId: string;
  metrics: TrajectoryMetrics;
}

/**
 * Flagged trajectories list response
 */
export interface FlaggedTrajectoriesResponse {
  datasetId: string;
  total: number;
  flagged: FlaggedTrajectorySummary[];
}

/**
 * Unflag trajectory request
 */
export interface UnflagTrajectoryRequest {
  reviewDecision: 'keep' | 'remove';
  reviewNotes?: string;
}

/**
 * Unflag trajectory response
 */
export interface UnflagTrajectoryResponse {
  success: boolean;
  trajectoryIndex: number;
  reviewDecision: 'keep' | 'remove';
  reviewedAt: Date;
}

// ============================================================================
// QUALITY SCORING WEIGHTS
// ============================================================================

/**
 * Weight configuration for quality scoring
 */
export interface QualityWeights {
  /** Weight for smoothness (default 30) */
  smoothness: number;
  /** Weight for consistency (default 30) */
  consistency: number;
  /** Weight for anomaly-free (default 20) */
  anomalyFree: number;
  /** Weight for completeness (default 20) */
  completeness: number;
}

/**
 * Default quality scoring weights
 */
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  smoothness: 30,
  consistency: 30,
  anomalyFree: 20,
  completeness: 20,
};

// ============================================================================
// DATABASE MODELS (for reference, actual models in schema.prisma)
// ============================================================================

/**
 * Database model for storing trajectory metrics
 */
export interface StoredTrajectoryMetrics {
  id: string;
  datasetId: string;
  trajectoryIndex: number;
  episodeId?: string;
  metricsJson: string; // JSON string of TrajectoryMetrics
  qualityScore: number;
  flagged: boolean;
  flagReason?: string;
  reviewed: boolean;
  reviewDecision?: 'keep' | 'remove' | 'pending';
  reviewedBy?: string;
  reviewedAt?: Date;
  computedAt: Date;
}

/**
 * Database model for storing quality reports
 */
export interface StoredQualityReport {
  id: string;
  datasetId: string;
  reportJson: string; // JSON string of DatasetQualityReport
  overallScore: number;
  smoothnessScore: number;
  consistencyScore: number;
  anomalyScore: number;
  completenessScore: number;
  trajectoryCount: number;
  flaggedCount: number;
  generatedAt: Date;
  validationConfig: string; // JSON string of AdvancedValidationConfig
}

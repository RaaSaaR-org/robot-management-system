/**
 * @file vla.types.ts
 * @description Type definitions for VLA (Vision-Language-Action) training management
 * @feature vla
 *
 * Implements types for:
 * - Robot type configurations
 * - Skill definitions
 * - Training datasets (LeRobot v3 format)
 * - Training jobs
 * - Model versions
 * - Fleet deployments
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

// Base VLA models for training
export const BaseModels = ['pi0', 'pi0_6', 'openvla', 'groot'] as const;
export type BaseModel = (typeof BaseModels)[number];

// Fine-tuning methods
export const FineTuneMethods = ['lora', 'full', 'oft'] as const;
export type FineTuneMethod = (typeof FineTuneMethods)[number];

// Training job status
export const TrainingJobStatuses = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TrainingJobStatus = (typeof TrainingJobStatuses)[number];

// Dataset status
export const DatasetStatuses = ['uploading', 'validating', 'ready', 'failed'] as const;
export type DatasetStatus = (typeof DatasetStatuses)[number];

// Skill definition status
export const SkillStatuses = ['draft', 'published', 'deprecated', 'archived'] as const;
export type SkillStatus = (typeof SkillStatuses)[number];

// Deployment status
export const DeploymentStatuses = [
  'pending',
  'deploying',
  'canary',
  'production',
  'rolling_back',
  'failed',
] as const;
export type DeploymentStatus = (typeof DeploymentStatuses)[number];

// Deployment strategies
export const DeploymentStrategies = ['canary', 'blue_green', 'rolling'] as const;
export type DeploymentStrategy = (typeof DeploymentStrategies)[number];

// Model deployment status (within ModelVersion)
export const ModelDeploymentStatuses = ['staging', 'canary', 'production', 'archived'] as const;
export type ModelDeploymentStatus = (typeof ModelDeploymentStatuses)[number];

// ============================================================================
// JSON FIELD TYPES
// ============================================================================

/**
 * Camera configuration for robot types
 */
export interface CameraConfig {
  name: string;
  resolution: { width: number; height: number };
  fov: number;
  position?: { x: number; y: number; z: number };
  rotation?: { roll: number; pitch: number; yaw: number };
}

/**
 * Joint limits for robot types
 */
export interface JointLimits {
  position: { min: number[]; max: number[] };
  velocity: number[];
  torque: number[];
}

/**
 * Training hyperparameters
 */
export interface Hyperparameters {
  learning_rate: number;
  batch_size: number;
  epochs: number;
  lora_rank?: number;
  warmup_steps?: number;
  weight_decay?: number;
  gradient_accumulation_steps?: number;
  max_grad_norm?: number;
}

/**
 * GPU requirements for training jobs
 */
export interface GpuRequirements {
  count: number;
  memory: number; // GB
  type?: string; // e.g., 'A100', 'H100'
}

/**
 * Training metrics (loss curves, etc.)
 */
export interface TrainingMetrics {
  training_loss?: number[];
  validation_loss?: number[];
  learning_rate?: number[];
  epoch_times?: number[];
  best_epoch?: number;
  final_loss?: number;
}

/**
 * Canary deployment configuration
 */
export interface CanaryConfig {
  stages: Array<{ percentage: number; durationMinutes: number }>;
  successThreshold: number;
  metricsWindow?: number; // Minutes to evaluate metrics
}

/**
 * Rollback thresholds for deployments
 */
export interface RollbackThresholds {
  errorRate: number; // Max error rate (0-1)
  latencyP99: number; // Max P99 latency in ms
  failureRate: number; // Max failure rate (0-1)
}

/**
 * LeRobot dataset info metadata
 */
export interface LeRobotInfo {
  codebase_version?: string;
  robot_type?: string;
  fps?: number;
  features?: Record<string, unknown>;
}

/**
 * LeRobot dataset statistics
 */
export interface LeRobotStats {
  observation?: {
    mean?: number[];
    std?: number[];
    min?: number[];
    max?: number[];
  };
  action?: {
    mean?: number[];
    std?: number[];
    min?: number[];
    max?: number[];
  };
}

// ============================================================================
// DOMAIN TYPES - RobotType
// ============================================================================

/**
 * Robot type/embodiment configuration for VLA training
 */
export interface RobotType {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  actionDim: number;
  proprioceptionDim: number;
  cameras: CameraConfig[];
  capabilities: string[];
  limits: JointLimits;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRobotTypeInput {
  name: string;
  manufacturer: string;
  model: string;
  actionDim: number;
  proprioceptionDim: number;
  cameras?: CameraConfig[];
  capabilities?: string[];
  limits?: JointLimits;
}

export interface UpdateRobotTypeInput {
  name?: string;
  manufacturer?: string;
  model?: string;
  actionDim?: number;
  proprioceptionDim?: number;
  cameras?: CameraConfig[];
  capabilities?: string[];
  limits?: JointLimits;
}

// ============================================================================
// DOMAIN TYPES - SkillDefinition
// ============================================================================

/**
 * Condition type for preconditions/postconditions
 */
export type ConditionType = 'sensor' | 'state' | 'custom';

/**
 * Condition definition for skill pre/postconditions
 */
export interface Condition {
  type: ConditionType;
  name: string; // e.g., "gripper_empty", "object_visible"
  check: string; // Expression or function name
  params?: Record<string, unknown>;
}

/**
 * Learnable robot skill definition
 */
export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  parametersSchema: Record<string, unknown>; // Zod-compatible schema (JSON Schema format)
  defaultParameters: Record<string, unknown>;
  preconditions: Condition[];
  postconditions: Condition[];
  requiredCapabilities: string[];
  timeout?: number; // seconds
  maxRetries: number;
  status: SkillStatus;
  linkedModelVersionId?: string;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  compatibleRobotTypes?: RobotType[];
  linkedModelVersion?: ModelVersion;
}

export interface CreateSkillDefinitionInput {
  name: string;
  version: string;
  description?: string;
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  preconditions?: Condition[];
  postconditions?: Condition[];
  requiredCapabilities?: string[];
  timeout?: number;
  maxRetries?: number;
  status?: SkillStatus;
  linkedModelVersionId?: string;
  compatibleRobotTypeIds?: string[];
}

export interface UpdateSkillDefinitionInput {
  name?: string;
  version?: string;
  description?: string;
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  preconditions?: Condition[];
  postconditions?: Condition[];
  requiredCapabilities?: string[];
  timeout?: number;
  maxRetries?: number;
  status?: SkillStatus;
  linkedModelVersionId?: string;
  compatibleRobotTypeIds?: string[];
}

/**
 * Query parameters for skill definitions
 */
export interface SkillDefinitionQueryParams {
  name?: string;
  status?: SkillStatus | SkillStatus[];
  robotTypeId?: string;
  capability?: string;
  linkedModelVersionId?: string;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// DOMAIN TYPES - Dataset
// ============================================================================

/**
 * Training dataset in LeRobot v3 format
 */
export interface Dataset {
  id: string;
  name: string;
  description?: string;
  robotTypeId: string;
  skillId?: string;
  storagePath: string;
  lerobotVersion: string;
  fps: number;
  totalFrames: number;
  totalDuration: number;
  demonstrationCount: number;
  qualityScore?: number;
  infoJson: LeRobotInfo;
  statsJson: LeRobotStats;
  status: DatasetStatus;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  robotType?: RobotType;
  skill?: SkillDefinition;
}

export interface CreateDatasetInput {
  name: string;
  description?: string;
  robotTypeId: string;
  skillId?: string;
  storagePath: string;
  lerobotVersion: string;
  fps: number;
  totalFrames: number;
  totalDuration: number;
  demonstrationCount: number;
  qualityScore?: number;
  infoJson?: LeRobotInfo;
  statsJson?: LeRobotStats;
  status?: DatasetStatus;
}

export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  skillId?: string;
  qualityScore?: number;
  infoJson?: LeRobotInfo;
  statsJson?: LeRobotStats;
  status?: DatasetStatus;
}

export interface DatasetQueryParams {
  robotTypeId?: string;
  skillId?: string;
  status?: DatasetStatus | DatasetStatus[];
  minQualityScore?: number;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// DOMAIN TYPES - TrainingJob
// ============================================================================

/**
 * Training job queue entry
 */
export interface TrainingJob {
  id: string;
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters: Hyperparameters;
  gpuRequirements: GpuRequirements;
  status: TrainingJobStatus;
  progress: number;
  currentEpoch?: number;
  totalEpochs?: number;
  metrics: TrainingMetrics;
  mlflowRunId?: string;
  mlflowExperimentId?: string;
  bullmqJobId?: string;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  dataset?: Dataset;
}

export interface CreateTrainingJobInput {
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters?: Hyperparameters;
  gpuRequirements?: GpuRequirements;
  totalEpochs?: number;
}

export interface UpdateTrainingJobInput {
  status?: TrainingJobStatus;
  progress?: number;
  currentEpoch?: number;
  metrics?: TrainingMetrics;
  mlflowRunId?: string;
  mlflowExperimentId?: string;
  bullmqJobId?: string;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export interface TrainingJobQueryParams {
  datasetId?: string;
  baseModel?: BaseModel | BaseModel[];
  fineTuneMethod?: FineTuneMethod | FineTuneMethod[];
  status?: TrainingJobStatus | TrainingJobStatus[];
  page?: number;
  pageSize?: number;
}

// ============================================================================
// DOMAIN TYPES - ModelVersion
// ============================================================================

/**
 * Trained model artifact version
 */
export interface ModelVersion {
  id: string;
  skillId: string;
  trainingJobId: string;
  version: string;
  artifactUri: string;
  checkpointUri?: string;
  trainingMetrics: TrainingMetrics;
  validationMetrics: TrainingMetrics;
  deploymentStatus: ModelDeploymentStatus;
  mlflowModelName?: string;
  mlflowModelVersion?: string;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  skill?: SkillDefinition;
  trainingJob?: TrainingJob;
}

export interface CreateModelVersionInput {
  skillId: string;
  trainingJobId: string;
  version: string;
  artifactUri: string;
  checkpointUri?: string;
  trainingMetrics?: TrainingMetrics;
  validationMetrics?: TrainingMetrics;
  deploymentStatus?: ModelDeploymentStatus;
  mlflowModelName?: string;
  mlflowModelVersion?: string;
}

export interface UpdateModelVersionInput {
  artifactUri?: string;
  checkpointUri?: string;
  trainingMetrics?: TrainingMetrics;
  validationMetrics?: TrainingMetrics;
  deploymentStatus?: ModelDeploymentStatus;
  mlflowModelName?: string;
  mlflowModelVersion?: string;
}

export interface ModelVersionQueryParams {
  skillId?: string;
  trainingJobId?: string;
  deploymentStatus?: ModelDeploymentStatus | ModelDeploymentStatus[];
  page?: number;
  pageSize?: number;
}

// ============================================================================
// DOMAIN TYPES - Deployment
// ============================================================================

/**
 * Fleet deployment tracking
 */
export interface Deployment {
  id: string;
  modelVersionId: string;
  strategy: DeploymentStrategy;
  targetRobotTypes: string[];
  targetZones: string[];
  trafficPercentage: number;
  canaryConfig: CanaryConfig;
  rollbackThresholds: RollbackThresholds;
  status: DeploymentStatus;
  deployedRobotIds: string[];
  failedRobotIds: string[];
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  modelVersion?: ModelVersion;
}

export interface CreateDeploymentInput {
  modelVersionId: string;
  strategy: DeploymentStrategy;
  targetRobotTypes?: string[];
  targetZones?: string[];
  canaryConfig?: CanaryConfig;
  rollbackThresholds?: RollbackThresholds;
}

export interface UpdateDeploymentInput {
  trafficPercentage?: number;
  canaryConfig?: CanaryConfig;
  rollbackThresholds?: RollbackThresholds;
  status?: DeploymentStatus;
  deployedRobotIds?: string[];
  failedRobotIds?: string[];
  startedAt?: Date;
  completedAt?: Date;
}

export interface DeploymentQueryParams {
  modelVersionId?: string;
  strategy?: DeploymentStrategy | DeploymentStrategy[];
  status?: DeploymentStatus | DeploymentStatus[];
  page?: number;
  pageSize?: number;
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

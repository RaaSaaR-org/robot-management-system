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

import type { TrainingJobDatasetRef } from './mixture.types.js';

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

// Base VLA models for training. `groot_n1_7` is the LeRobot-native GR00T N1.7
// trainer path (lerobot[groot], TASK-179).
export const BaseModels = ['pi0', 'pi0_6', 'openvla', 'groot', 'groot_n1_7', 'smolvla'] as const;
export type BaseModel = (typeof BaseModels)[number];

// Reward models available via the unified lerobot.rewards API (TASK-179)
export const RewardTypes = ['robometer', 'topreward'] as const;
export type RewardType = (typeof RewardTypes)[number];

/**
 * `baseModel` values used by the auxiliary worker job kinds (TASK-179):
 * reward_model jobs mirror their rewardType, annotate jobs use
 * 'lerobot-annotate'. These never appear in the training wizard.
 */
export type AuxiliaryBaseModel = RewardType | 'lerobot-annotate';

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
export const DatasetStatuses = ['uploading', 'importing', 'validating', 'ready', 'failed'] as const;
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
  max_steps?: number;
  lora_alpha?: number;
  lora_dropout?: number;
  /** DataLoader workers used by the training-worker on CUDA (TASK-179 §9). */
  dataloader_num_workers?: number;
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
  // sim-RL quality summary (TASK-172.C) — populated only for `sim_rl` jobs so
  // the model registry shows a labelled reward/success signal, not just the
  // inverted-reward loss curve.
  mean_reward?: number;
  success_rate?: number;
  total_timesteps?: number;
  trainer?: string;
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
  /** Set true for datasets produced by a generator (e.g. Cosmos 3). TASK-178 */
  _synthetic?: boolean;
  /** Human-readable provenance string for synthetic datasets. TASK-178 */
  _generator?: string;
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

/** Timestamped subtask segment inside an episode (lerobot-annotate, TASK-179). */
export interface AnnotationSubtask {
  startS: number;
  endS: number;
  text: string;
}

/** VQA pair generated for an episode (lerobot-annotate, TASK-179). */
export interface AnnotationVqaPair {
  question: string;
  answer: string;
}

/**
 * Per-episode VLM annotation produced by an `annotate` job and stored on
 * `Dataset.annotationsJson` (TASK-179 contract §4).
 */
export interface EpisodeAnnotation {
  episodeIndex: number;
  subtasks: AnnotationSubtask[];
  vqa?: AnnotationVqaPair[];
}

/**
 * What an import was ASKED to fetch, and therefore what it is allowed to be
 * missing (TASK-220).
 *
 * `metadata` fetches `meta/` and `data/` and no mp4 at all. Nothing else in the
 * system can tell that apart from a full import whose videos never arrived, so
 * validation raised MISSING_VIDEO_FILE once per declared mp4 — 402 errors on
 * the GR00T repo — and marked `failed` a dataset that imported exactly as the
 * operator asked.
 */
export type DatasetImportMode = 'full' | 'metadata';

/** Why an import failed, kept on the row instead of only in a broadcast. */
export interface DatasetImportError {
  /** Which phase of the import it died in, same vocabulary as the progress events. */
  phase: string;
  error: string;
  repoId?: string;
  /** ISO-8601. */
  failedAt: string;
}

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
  huggingFaceRepoId?: string;
  /** The commit the source repo was AT, resolved from the branch at import time. */
  sourceRevision?: string | null;
  sourceLicense?: string | null;
  importMode?: DatasetImportMode | null;
  /** Parsed from `importErrorJson`; undefined when the import did not fail. */
  importError?: DatasetImportError | null;
  // VLM annotations from lerobot-annotate jobs (TASK-179); parsed from
  // annotationsJson. Optional so pre-existing fixtures/partials stay valid;
  // the repository mapper always sets it ([] when none).
  annotations?: EpisodeAnnotation[];
  /**
   * What structural validation found when it last opened this dataset's files
   * (TASK-217), or undefined when nothing has ever validated it — which is the
   * state every locally registered dataset is in, because registration wrote
   * `status: 'ready'` without a check.
   */
  validation?: unknown;
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
  huggingFaceRepoId?: string;
  sourceRevision?: string | null;
  sourceLicense?: string | null;
  importMode?: DatasetImportMode | null;
}

export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  skillId?: string;
  sourceRevision?: string | null;
  sourceLicense?: string | null;
  importMode?: DatasetImportMode | null;
  /** `null` clears the stored failure — what a retry that succeeds must do. */
  importError?: DatasetImportError | null;
  qualityScore?: number;
  infoJson?: LeRobotInfo;
  statsJson?: LeRobotStats;
  status?: DatasetStatus;
  huggingFaceRepoId?: string;
  annotations?: EpisodeAnnotation[];
  /**
   * The four numbers validation MEASURES. They were absent here, so
   * `validateAndUpdateDataset` computed them, could not write them, and left a
   * comment in `DatasetService` saying so — the row kept whatever the creating
   * caller had guessed at. `register-local-dataset.ts` guesses from
   * `info.json`, and a dataset whose manifest disagrees with its files kept the
   * manifest's numbers precisely in the case where they are wrong.
   */
  fps?: number;
  totalFrames?: number;
  totalDuration?: number;
  demonstrationCount?: number;
  /** Version read off the tree, which need not be what registration assumed. */
  lerobotVersion?: string;
  /** The structural report, stored so the UI shows findings rather than a guess. */
  validation?: unknown;
  /**
   * Where the dataset now lives.
   *
   * Writable because unpacking an upload MOVES it: the row is created pointing
   * at a bucket key and, once the archive is extracted, points at the tree.
   */
  storagePath?: string;
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
 * Training job kind. `supervised` is the classic VLA fine-tune (datasetId +
 * baseModel + fineTuneMethod). `sim_rl` trains an RL navigation policy in a
 * twin-derived MuJoCo scene (sceneId; no dataset/baseModel). (TASK-172.C)
 * `reward_model` scores dataset episodes via Robometer/TOPReward and
 * `annotate` auto-fills subtask/VQA annotations (LeRobot 0.6.0, TASK-179) —
 * both run on the training-worker but never produce a ModelVersion.
 */
export type TrainingJobKind = 'supervised' | 'sim_rl' | 'reward_model' | 'annotate';

/**
 * Hyperparameters carried by a reward_model job (TASK-179 contract §1).
 * `episodes` absent/empty = all episodes; `imageKey` default = first camera.
 */
export interface RewardModelHyperparameters {
  rewardType: RewardType;
  episodes?: number[];
  task?: string;
  imageKey?: string;
  maxFrames?: number;
}

/** Hyperparameters carried by an annotate job (TASK-179 contract §1). */
export interface AnnotateHyperparameters {
  episodes?: number[];
}

/**
 * Training job queue entry
 */
export interface TrainingJob {
  id: string;
  kind: TrainingJobKind;
  // null for sim_rl jobs (they carry sceneId/twinId instead)
  datasetId: string | null;
  // AuxiliaryBaseModel for reward_model/annotate jobs (TASK-179)
  baseModel: BaseModel | AuxiliaryBaseModel | null;
  fineTuneMethod: FineTuneMethod | null;
  // SimScene the RL policy trains in + its source twin (sim_rl only)
  sceneId: string | null;
  twinId: string | null;
  hyperparameters: Hyperparameters;
  gpuRequirements: GpuRequirements;
  status: TrainingJobStatus;
  progress: number;
  currentEpoch?: number;
  totalEpochs?: number;
  metrics: TrainingMetrics;
  bullmqJobId?: string;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  dataset?: Dataset;
  /**
   * Every dataset this job trains on, in mixture order (TASK-220).
   *
   * Optional here and not filled by the repository, because a job row does not
   * know its mixture — `TrainingJobService.getJobDatasets` reads it, and the
   * routes attach it. A single-dataset job gets one synthesised member so no
   * reader has to handle two shapes.
   */
  datasets?: TrainingJobDatasetRef[];
  // ID of the most-recent ModelVersion produced by this job (populated
  // on job completion — worker POSTs /workers/complete, server creates
  // a ModelVersion and links its ID back here for the UI)
  modelVersionId?: string;
}

export interface CreateTrainingJobInput {
  // Defaults to 'supervised' in the repository when omitted.
  kind?: TrainingJobKind;
  datasetId?: string | null;
  baseModel?: BaseModel | AuxiliaryBaseModel | null;
  fineTuneMethod?: FineTuneMethod | null;
  sceneId?: string | null;
  twinId?: string | null;
  // reward_model/annotate jobs carry their own hyperparameter shapes; the
  // column is a JSON string so all variants serialize the same way.
  hyperparameters?: Hyperparameters | RewardModelHyperparameters | AnnotateHyperparameters;
  gpuRequirements?: GpuRequirements;
  totalEpochs?: number;
}

export interface UpdateTrainingJobInput {
  status?: TrainingJobStatus;
  progress?: number;
  /** Pass null to clear (e.g. on retry); undefined leaves the field untouched. */
  currentEpoch?: number | null;
  metrics?: TrainingMetrics;
  bullmqJobId?: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
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
 * Model artifact kind. `vla` is a supervised vision-language-action model
 * (default). `rl_policy` is a sim_rl navigation policy — gated sim-only and
 * served/evaluated through a different runner. (TASK-172.C)
 */
export type ModelType = 'vla' | 'rl_policy';

/**
 * Trained model artifact version
 */
export interface ModelVersion {
  id: string;
  skillId: string | null;
  trainingJobId: string;
  modelType: ModelType;
  version: string;
  artifactUri: string;
  checkpointUri?: string;
  trainingMetrics: TrainingMetrics;
  validationMetrics: TrainingMetrics;
  deploymentStatus: ModelDeploymentStatus;
  createdAt: Date;
  updatedAt: Date;

  // Optional relations
  skill?: SkillDefinition;
  trainingJob?: TrainingJob;
}

export interface CreateModelVersionInput {
  skillId: string | null;
  trainingJobId: string;
  modelType?: ModelType;
  version: string;
  artifactUri: string;
  checkpointUri?: string;
  trainingMetrics?: TrainingMetrics;
  validationMetrics?: TrainingMetrics;
  deploymentStatus?: ModelDeploymentStatus;
}

export interface UpdateModelVersionInput {
  artifactUri?: string;
  checkpointUri?: string;
  trainingMetrics?: TrainingMetrics;
  validationMetrics?: TrainingMetrics;
  deploymentStatus?: ModelDeploymentStatus;
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

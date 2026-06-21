/**
 * @file training.types.ts
 * @description Type definitions for VLA training feature
 * @feature training
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const BaseModels = ['pi0', 'pi0_6', 'openvla', 'groot', 'smolvla'] as const;
export type BaseModel = (typeof BaseModels)[number];

export const FineTuneMethods = ['lora', 'full', 'frozen_backbone'] as const;
export type FineTuneMethod = (typeof FineTuneMethods)[number];

export const TrainingJobStatuses = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TrainingJobStatus = (typeof TrainingJobStatuses)[number];

export const DatasetStatuses = ['uploading', 'importing', 'validating', 'ready', 'failed'] as const;
export type DatasetStatus = (typeof DatasetStatuses)[number];

export const ModelDeploymentStatuses = ['staging', 'canary', 'production', 'archived'] as const;
export type ModelDeploymentStatus = (typeof ModelDeploymentStatuses)[number];

// ============================================================================
// JSON FIELD TYPES
// ============================================================================

export interface CameraConfig {
  name: string;
  resolution: { width: number; height: number };
  fov: number;
  position?: { x: number; y: number; z: number };
  rotation?: { roll: number; pitch: number; yaw: number };
}

export interface JointLimits {
  position: { min: number[]; max: number[] };
  velocity: number[];
  torque: number[];
}

export interface Hyperparameters {
  learning_rate: number;
  batch_size: number;
  epochs: number;
  lora_rank?: number;
  lora_alpha?: number;
  lora_dropout?: number;
  warmup_steps?: number;
  weight_decay?: number;
  gradient_accumulation_steps?: number;
  max_grad_norm?: number;
}

/** Input type for hyperparameter form */
export interface HyperparametersInput {
  learning_rate: number;
  batch_size: number;
  epochs: number;
  lora_rank?: number;
  lora_alpha?: number;
  lora_dropout?: number;
  warmup_steps?: number;
  weight_decay?: number;
  gradient_accumulation_steps?: number;
  max_grad_norm?: number;
}

export interface GpuRequirements {
  count: number;
  memory: number;
  type?: string;
}

export interface TrainingMetrics {
  training_loss?: number[];
  validation_loss?: number[];
  learning_rate?: number[];
  accuracy?: number[];
  epoch_times?: number[];
  best_epoch?: number;
  final_loss?: number;
}

export interface LeRobotInfo {
  codebase_version?: string;
  robot_type?: string;
  fps?: number;
  features?: Record<string, unknown>;
}

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
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// DOMAIN TYPES - Dataset
// ============================================================================

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
  createdAt: string;
  updatedAt: string;
  robotType?: RobotType;
}

export interface CreateDatasetInput {
  name: string;
  description?: string;
  robotTypeId: string;
  skillId?: string;
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
  currentStep?: string;
  metrics: TrainingMetrics;
  modelVersionId?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  dataset?: Dataset;
}

export interface SubmitTrainingJobInput {
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters?: Partial<Hyperparameters>;
  gpuRequirements?: Partial<GpuRequirements>;
  totalEpochs?: number;
  priority?: 'low' | 'normal' | 'high';
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
// DOMAIN TYPES - StoredModelVersion (internal DB model)
// ============================================================================

export interface StoredModelVersion {
  id: string;
  skillId: string;
  trainingJobId: string;
  version: string;
  artifactUri: string;
  checkpointUri?: string;
  trainingMetrics: TrainingMetrics;
  validationMetrics: TrainingMetrics;
  deploymentStatus: ModelDeploymentStatus;
  createdAt: string;
  updatedAt: string;
  trainingJob?: TrainingJob;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DatasetsListResponse {
  datasets: Dataset[];
  pagination: PaginationInfo;
}

export interface TrainingJobsListResponse {
  jobs: TrainingJob[];
  pagination: PaginationInfo;
}

export interface TrainingJobResponse {
  job: TrainingJob;
  progress?: JobProgress;
}

export interface JobProgress {
  status: TrainingJobStatus;
  progress: number;
  currentEpoch?: number;
  totalEpochs?: number;
  metrics?: TrainingMetrics;
  eta?: string;
  message?: string;
  updatedAt: string;
}

export interface QueueStats {
  pending: number;
  queued: number;
  running: number;
  completed: number;
  completed_24h: number;
  failed: number;
  by_model?: Record<string, { running: number; queued: number }>;
  by_priority?: { high: number; normal: number; low: number };
  avg_wait_time_minutes?: number;
  avg_training_time_minutes?: number;
  streamInfo?: {
    messages: number;
    bytes: number;
    firstSeq: number;
    lastSeq: number;
    consumerCount: number;
  };
}

/**
 * Worker as exposed by GET /api/training/workers.
 * Mirrors the server's WorkerStatusView shape.
 */
export interface WorkerStatusView {
  workerId: string;
  device: string;
  status: 'idle' | 'busy' | 'stale';
  currentJob: {
    id: string;
    status: string;
    baseModel: string | null;
    datasetId: string | null;
    ageSeconds: number;
  } | null;
  gpuUtil: number;
  memoryUtil: number;
  lastHeartbeatAt: string;
  lastHeartbeatAgeSeconds: number;
  firstSeenAt: string;
}

export interface WorkerStatusListResponse {
  workers: WorkerStatusView[];
  queuedJobs: number;
  runningJobs: number;
}

export interface TrainingDurationEstimate {
  estimatedMinutes: number;
  estimatedSteps: number;
  stepsPerSecond: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface UploadInitiateResponse {
  uploadUrl: string;
  expiresIn: number;
  storagePath: string;
  message: string;
}

// ============================================================================
// MODEL REGISTRY STUBS
// ============================================================================
//
// TASK-142: MLflow was deleted. These minimal types are kept so the
// active-learning UI (PriorityDashboard, UncertaintyHeatmap, ModelSelector)
// continues to compile. They render with an empty list — model selection is
// effectively a no-op until a Prisma `ModelVersion`-backed registry replaces
// them.

export interface RegisteredModel {
  name: string;
  description?: string;
  latest_versions?: ModelVersion[];
  creation_timestamp?: number;
  last_updated_timestamp?: number;
}

export interface ModelVersion {
  name: string;
  version: string;
  current_stage: string;
  description?: string;
  metrics?: Record<string, number>;
  creation_timestamp: number;
  last_updated_timestamp?: number;
}

// ============================================================================
// HUGGINGFACE TYPES
// ============================================================================

export interface HFDataset {
  id: string;
  downloads?: number;
  lastModified?: string;
  tags?: string[];
  description?: string;
}

export interface HFImportProgress {
  datasetId: string;
  status: 'importing' | 'validating' | 'ready' | 'failed';
  progress: number;
  currentFile?: string;
  error?: string;
}

// ============================================================================
// EPISODE VIEWER TYPES
// ============================================================================

export interface EpisodeMeta {
  index: number;
  frameCount: number;
  durationSeconds: number;
  flagged: boolean;
}

export interface FrameData {
  frameIndex: number;
  timestamp: number;
  /** 6 DOF: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper */
  action: number[];
  /** 6 DOF: same joint ordering as action */
  observationState: number[];
}

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

export type TrainingJobEventType =
  | 'training:job:created'
  | 'training:job:started'
  | 'training:job:progress'
  | 'training:job:completed'
  | 'training:job:failed'
  | 'training:job:cancelled';

export interface TrainingJobEvent {
  type: TrainingJobEventType;
  jobId: string;
  job?: TrainingJob;
  progress?: JobProgress;
  error?: string;
  timestamp: string;
}

// ============================================================================
// STORE STATE TYPES
// ============================================================================

export interface TrainingState {
  // Datasets
  datasets: Dataset[];
  datasetsLoading: boolean;
  datasetsError: string | null;
  datasetsPagination: PaginationInfo;

  // Training Jobs
  trainingJobs: TrainingJob[];
  trainingJobsLoading: boolean;
  trainingJobsError: string | null;
  trainingJobsPagination: PaginationInfo;

  // Active Job (detail view)
  activeJob: TrainingJob | null;
  activeJobProgress: JobProgress | null;
  activeJobLoading: boolean;

  // Queue
  queueStats: QueueStats | null;
  queueLoading: boolean;

  // Workers
  workers: WorkerStatusListResponse | null;
  workersLoading: boolean;

  // Upload progress
  uploadProgress: number;
  uploadError: string | null;

  // Filters
  datasetFilters: DatasetQueryParams;
  jobFilters: TrainingJobQueryParams;
}

export interface TrainingActions {
  // Datasets
  fetchDatasets: (params?: DatasetQueryParams) => Promise<void>;
  createDataset: (input: CreateDatasetInput) => Promise<Dataset>;
  deleteDataset: (id: string) => Promise<void>;
  initiateUpload: (datasetId: string, contentType: string, size: number) => Promise<UploadInitiateResponse>;
  completeUpload: (datasetId: string) => Promise<void>;
  setDatasetFilters: (filters: Partial<DatasetQueryParams>) => void;

  // Training Jobs
  fetchTrainingJobs: (params?: TrainingJobQueryParams) => Promise<void>;
  submitTrainingJob: (input: SubmitTrainingJobInput) => Promise<TrainingJob>;
  getTrainingJob: (id: string) => Promise<void>;
  cancelTrainingJob: (id: string) => Promise<void>;
  retryTrainingJob: (id: string) => Promise<void>;
  setJobFilters: (filters: Partial<TrainingJobQueryParams>) => void;

  // Real-time updates
  updateJobProgress: (jobId: string, progress: JobProgress) => void;
  handleTrainingEvent: (event: TrainingJobEvent) => void;

  // Queue
  fetchQueueStats: () => Promise<void>;

  // Workers
  fetchWorkers: () => Promise<void>;

  // Reset
  reset: () => void;
}

// ============================================================================
// CURATION (interactive episode trim / delete)
// ============================================================================

/**
 * Result summary returned by the curation backend after a trim/delete edit.
 * Edits are non-destructive: a new dataset revision is written at `output`.
 */
export interface CurationResult {
  datasetId: string;
  ok: boolean;
  operation: string;
  output: string;
  total_episodes: number;
  total_frames: number;
  stats_recompute_required: boolean;
  error?: string;
}

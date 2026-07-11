/**
 * @file training.types.ts
 * @description Type definitions for VLA training feature
 * @feature training
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const BaseModels = ['pi0', 'pi0_6', 'openvla', 'groot', 'groot_n1_7', 'smolvla'] as const;
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
  /**
   * Hard cap on optimizer steps. Step-based trainers (GR00T-N1.7 via
   * Isaac-GR00T) train for exactly this many steps and ignore `epochs`;
   * when unset the trainer falls back to its own default (2000).
   */
  max_steps?: number;
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
  /** Hard cap on optimizer steps (GR00T step-based trainers). */
  max_steps?: number;
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
  // Sim-RL (kind === 'sim_rl') metrics — RL jobs report reward/success, not loss.
  // Emitted by the server's TrainingOrchestrator for sim_rl jobs. (TASK-172.C)
  mean_reward?: number;
  success_rate?: number; // 0..1
  total_timesteps?: number;
  trainer?: string; // worker-reported: "isaac" | "ppo" | "stub"
}

/**
 * Human-readable label for a completed sim_rl job's trainer/env, keyed on the
 * read-only `metrics.trainer` value the worker reports back (never derived on the
 * client). Keeps TrainingJobCard + TrainingProgressMonitor DRY. Unknown/absent ids
 * degrade gracefully so a future trainer is a one-line addition here.
 */
export function simRlTrainerLabel(trainer?: string): string {
  switch (trainer) {
    case 'isaac':
      return 'Isaac Lab · locomotion gait';
    case 'ppo':
      return 'PPO · navigation';
    case 'stub':
      return 'Stub';
    default:
      if (!trainer) return 'Sim-RL policy';
      return trainer.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export interface LeRobotInfo {
  codebase_version?: string;
  robot_type?: string;
  fps?: number;
  features?: Record<string, unknown>;
  /** True for generator-produced datasets (e.g. Cosmos 3). TASK-178 */
  _synthetic?: boolean;
  /** Human-readable provenance for synthetic datasets. TASK-178 */
  _generator?: string;
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

/**
 * Training job kind. `supervised` is the classic VLA fine-tune (dataset +
 * baseModel + fineTuneMethod). `sim_rl` trains an RL navigation policy in a
 * twin-derived MuJoCo scene (sceneId; no dataset/model). (TASK-172.C)
 * `reward_model` / `annotate` are auxiliary LeRobot 0.6.0 worker jobs
 * (TASK-179) — created via the evaluation panel / dataset annotate action,
 * never by the wizard, but they DO appear in GET /training/jobs responses.
 */
export type TrainingJobKind = 'supervised' | 'sim_rl' | 'reward_model' | 'annotate';

export interface TrainingJob {
  id: string;
  kind: TrainingJobKind;
  // null for sim_rl jobs (they carry sceneId/twinId instead)
  datasetId: string | null;
  baseModel: BaseModel | null;
  fineTuneMethod: FineTuneMethod | null;
  sceneId?: string | null;
  twinId?: string | null;
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

/**
 * Submit body for a sim_rl (twin-derived RL navigation) training job.
 * Carries a SimScene id instead of a dataset/model. (TASK-172.C)
 */
export interface SubmitSimRlJobInput {
  kind: 'sim_rl';
  sceneId: string;
  hyperparameters?: Partial<Hyperparameters>;
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
// DATASET ANNOTATIONS (lerobot-annotate, LeRobot 0.6.0 — TASK-179)
// ============================================================================

export interface AnnotationSubtask {
  /** Subtask start, in seconds from episode start */
  startS: number;
  /** Subtask end, in seconds from episode start */
  endS: number;
  text: string;
}

export interface AnnotationVqaPair {
  question: string;
  answer: string;
}

/**
 * VLM-generated annotations for one episode. Mirrors the server's
 * AnnotationDto (GET /datasets/:id/annotations).
 */
export interface EpisodeAnnotation {
  episodeIndex: number;
  subtasks: AnnotationSubtask[];
  vqa?: AnnotationVqaPair[];
}

// ============================================================================
// EPISODE VIEWER TYPES
// ============================================================================

/**
 * Playback window of an episode inside a LeRobot v3.0 chunk video (v3.0
 * concatenates all episodes of a chunk into one mp4 per camera).
 */
export interface EpisodeVideoWindow {
  /** Episode start inside the chunk video (seconds) */
  from: number;
  /** Episode end inside the chunk video (seconds) */
  to: number;
  /** chunk-{chunk:03d} the episode's video lives in */
  chunk: number;
  /** file-{file:03d} within the chunk (multi-file chunks) */
  file: number;
}

export interface EpisodeMeta {
  index: number;
  frameCount: number;
  durationSeconds: number;
  flagged: boolean;
  /** v3.0 chunked datasets only: per-camera playback windows (short camera key) */
  videoWindows?: Record<string, EpisodeVideoWindow>;
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
  submitTrainingJob: (
    input: SubmitTrainingJobInput | SubmitSimRlJobInput
  ) => Promise<TrainingJob>;
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
 * Edits are non-destructive: a new dataset revision is written at `output`
 * and (when the dataset lives in the DB) registered as a NEW Dataset row
 * (`newDatasetId` / `newDatasetName`).
 */
export interface CurationResult {
  datasetId: string;
  ok: boolean;
  operation: string;
  output: string;
  total_episodes: number;
  total_frames: number;
  stats_recompute_required: boolean;
  newDatasetId?: string;
  newDatasetName?: string;
  error?: string;
  code?: string;
}

/** One AI curation suggestion (motion heuristics, optionally VLM-refined). */
export interface CurationSuggestion {
  episode: number;
  kind: 'trim' | 'delete';
  start?: number;
  end?: number;
  reason: string;
  confidence: number;
  /** True when a VLM pass (Gemini) refined this suggestion. */
  vlm?: boolean;
}

/** Response of POST /api/curation/:id/suggest. */
export interface CurationSuggestResponse {
  datasetId: string;
  ok: boolean;
  operation: string;
  suggestions: CurationSuggestion[];
  vlmEnriched?: boolean;
  error?: string;
  code?: string;
}

// ============================================================================
// COSMOS 3 SYNTHETIC GENERATION (TASK-178)
// ============================================================================

export const CosmosJobStatuses = [
  'queued',
  'generating',
  'converting',
  'registering',
  'completed',
  'failed',
  'cancelled',
] as const;
export type CosmosJobStatus = (typeof CosmosJobStatuses)[number];

/** A Cosmos 3 synthetic-episode generation job (in-memory on the server). */
export interface CosmosSyntheticJob {
  id: string;
  status: CosmosJobStatus;
  /** Short human-readable phase label. */
  phase: string;
  /** 0-100. */
  progress: number;
  episodes: number;
  prompt?: string;
  embodiment: string;
  generatedCount: number;
  /** Set once the dataset row is created. */
  datasetId?: string;
  datasetName?: string;
  error?: string;
  /** Tail of the generator's stdout/stderr for the live console. */
  log: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Whether the Cosmos generator is runnable + configured. */
export interface CosmosSyntheticConfig {
  available: boolean;
  hasToken: boolean;
  embodiment: string;
  maxEpisodes: number;
  python: string;
  scriptPath: string;
  outRoot: string;
}

export interface GenerateSyntheticInput {
  episodes: number;
  prompt?: string;
}

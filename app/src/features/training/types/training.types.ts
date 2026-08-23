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

/**
 * Why an import stopped, as the server recorded it (TASK-220).
 *
 * A failed import used to leave a card that said "Failed" and nothing else, so
 * the only way to learn that (say) the object store was down was to read the
 * server's log — on a machine the person looking at the card may not have.
 */
export interface DatasetImportError {
  phase: string;
  error: string;
  repoId?: string;
  failedAt: string;
}

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
  /** Resolved HF commit SHA the import pinned. Null for non-Hub datasets. */
  sourceRevision?: string | null;
  /**
   * `metadata` means only info.json/stats came down — there are no frames on
   * disk, so the row's episode and frame counts describe the Hub repo rather
   * than anything local.
   */
  importMode?: 'full' | 'metadata' | null;
  importError?: DatasetImportError | null;
  /**
   * What structural validation found when it last opened this dataset's files
   * (TASK-217).
   *
   * ABSENT means nothing has ever opened them — not "clean". Every dataset
   * registered from a local directory is in that state, because registration
   * wrote `status: 'ready'` without a check. The card says which.
   */
  validation?: DatasetValidation;
  createdAt: string;
  updatedAt: string;
  robotType?: RobotType;
}

/** One thing validation found, with a code a UI can branch on. */
export interface ValidationFinding {
  code: string;
  message: string;
}

export interface DatasetValidation {
  validatedAt?: string;
  valid: boolean;
  lerobotVersion: string;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  /** `observation.images.*` features. Empty is the warning that matters most. */
  imageKeys: string[];
  /** How many files were opened to decide all this. */
  fileCount: number;
}

/**
 * The four numbers that decide whether two datasets can be trained together.
 *
 * Derived on the client from `meta/info.json` as it was stored on the row, so a
 * card can say "43-wide, 1 camera" without another round trip. Every field is
 * nullable on purpose: an import that failed before it read info.json has none
 * of them, and a card that guesses "0" there would be inventing a fact.
 */
export interface DatasetShape {
  robotType: string | null;
  stateWidth: number | null;
  actionWidth: number | null;
  cameraKeys: string[];
}

interface LeRobotFeature {
  dtype?: string;
  shape?: number[];
}

function featureWidth(features: Record<string, unknown>, key: string): number | null {
  const feature = features[key] as LeRobotFeature | undefined;
  const width = feature?.shape?.[0];
  return typeof width === 'number' ? width : null;
}

export function datasetShape(dataset: Dataset): DatasetShape {
  const features = (dataset.infoJson?.features ?? {}) as Record<string, unknown>;

  // Validation's `imageKeys` is what was actually found on disk; info.json is
  // only what the dataset claims. Prefer the former when it exists.
  const declaredCameras = Object.keys(features).filter((key) => {
    const dtype = (features[key] as LeRobotFeature | undefined)?.dtype;
    return dtype === 'video' || dtype === 'image' || key.startsWith('observation.images.');
  });

  return {
    robotType: dataset.robotType?.name ?? dataset.infoJson?.robot_type ?? null,
    stateWidth: featureWidth(features, 'observation.state'),
    actionWidth: featureWidth(features, 'action'),
    cameraKeys: dataset.validation?.imageKeys ?? declaredCameras,
  };
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
// DATASET MIXTURES & COMPATIBILITY (TASK-220)
// ============================================================================
//
// Mirrors `server/src/types/mixture.types.ts`. The four verdicts are not a
// severity scale: `multi_embodiment` is a YES — two datasets with different
// action spaces are exactly what GR00T's per-embodiment projectors exist for —
// while `incompatible` is the only one that stops a run.

export type CompatibilityVerdict =
  | 'identical'
  | 'compatible'
  | 'multi_embodiment'
  | 'incompatible';

export type AxisVerdict = 'match' | 'differs' | 'blocking';

export type CompatibilityAxisId =
  | 'lerobotVersion'
  | 'robotType'
  | 'fps'
  | 'stateWidth'
  | 'actionWidth'
  | 'cameraKeys'
  | 'status';

export interface CompatibilityAxis {
  axis: CompatibilityAxisId;
  label: string;
  verdict: AxisVerdict;
  values: Array<{ datasetId: string; datasetName: string; value: string }>;
  /** One sentence: what this difference MEANS for training. */
  note: string;
}

export interface CompatibilityReport {
  datasetIds: string[];
  verdict: CompatibilityVerdict;
  headline: string;
  recommendation: string;
  axes: CompatibilityAxis[];
}

export interface MixtureMemberInput {
  datasetId: string;
  weight?: number;
}

/** One member of a training job's dataset mixture, as the server reports it. */
export interface TrainingJobDatasetMember {
  datasetId: string;
  name: string;
  weight: number;
  position: number;
}

// ============================================================================
// HUGGINGFACE IMPORT PREVIEW (TASK-220)
// ============================================================================

/**
 * What GET /datasets/hf/preview reads out of a Hub repo without importing it.
 *
 * `dataBytes` and `videoBytes` are separate because the difference is the whole
 * decision: GR00T-N1.7-AppleToPlate is 73 MB of parquet next to 929 MB of
 * video, and "Include videos" is the checkbox that spends the second number.
 */
export interface HFDatasetPreview {
  repoId: string;
  revision: string;
  resolvedRevision: string;
  lerobotVersion: string;
  robotType: string;
  fps: number;
  totalEpisodes: number;
  totalFrames: number;
  // Nullable, exactly as the server sends them: `previewRepo` emits
  // `declaredFeatureWidth(...) || null`, so a repo whose info.json declares no
  // shape for observation.state has no width to report. Typed `number` here,
  // the preview rendered the literal string "null" as the width.
  stateWidth: number | null;
  actionWidth: number | null;
  cameraKeys: string[];
  fileCount: number;
  dataBytes: number;
  videoBytes: number;
  license: string | null;
}

/** Body of POST /datasets/import/huggingface. */
export interface HFImportOptions {
  revision?: string;
  robotTypeId?: string;
  includeVideos?: boolean;
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
  /**
   * The mixture this job trains on, member 0 first. The server always sends it
   * — synthesising a single entry from `datasetId` for a classic one-dataset
   * job — but it is optional here because fixtures and rows cached from an
   * older server have no such field.
   */
  datasets?: TrainingJobDatasetMember[];
}

export interface SubmitTrainingJobInput {
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters?: Partial<Hyperparameters>;
  gpuRequirements?: Partial<GpuRequirements>;
  totalEpochs?: number;
  priority?: 'low' | 'normal' | 'high';
  /** Mixture members with weights. `datasetId` above stays member 0. */
  mixture?: MixtureMemberInput[];
  /** Equal-weight shorthand for `mixture`. */
  datasetIds?: string[];
}

/**
 * Submit body for a sim_rl (twin-derived RL navigation) training job.
 * Carries a SimScene id instead of a dataset/model. (TASK-172.C)
 */
export interface SubmitSimRlJobInput {
  kind: 'sim_rl';
  sceneId: string;
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
// TRAINING RUN MANIFEST (GET /training/jobs/:id/export — TASK-220)
// ============================================================================

export interface TrainingRunManifestDataset {
  datasetId: string;
  name: string;
  /** Scheme-tagged: `hf://repo@rev`, `s3://bucket/prefix` or `file:///abs/path`. */
  uri: string;
  revision: string | null;
  license: string | null;
  weight: number;
  normalizedWeight: number;
  lerobotVersion: string;
  robotType: string;
  fps: number;
  stateWidth: number | null;
  actionWidth: number | null;
  cameraKeys: string[];
  totalEpisodes: number;
  totalFrames: number;
  /** False for `file://` members — a cluster elsewhere cannot reach them. */
  portable: boolean;
}

export interface TrainingRunManifest {
  schemaVersion: string;
  runId: string;
  createdAt: string;
  sourceServer: string;
  job: {
    kind: string;
    baseModel: string | null;
    fineTuneMethod: string | null;
    status: string;
  };
  datasets: TrainingRunManifestDataset[];
  compatibility: CompatibilityReport;
  hyperparameters: Partial<Hyperparameters>;
  gpu: { count: number; memory: number; type?: string };
  runtime: { image: string; command: string[]; entrypoint?: string };
  compliance: {
    datasetLicenses: string[];
    residency: string | null;
    notes: string[];
  };
  /**
   * Why the run may not reproduce elsewhere — a `file://` member above being
   * the usual reason. Shown next to the export action, because a warning only
   * a downloaded file carries is a warning nobody reads.
   */
  warnings: string[];
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
  retryImport: (datasetId: string) => Promise<void>;
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

/** Generator recipe: Cosmos 3 forward dynamics or GR00T-Dreams neural trajectories (TASK-182). */
export type SyntheticGeneratorMode = 'forward-dynamics' | 'neural-trajectory';

/** Per-mode generator capabilities reported by GET /synthetic-cosmos/config. */
export interface SyntheticModeInfo {
  id: SyntheticGeneratorMode;
  label: string;
  embodiment: string;
  maxEpisodes: number;
  /** Whether this mode's generator is installed on the server. */
  available: boolean;
  requiresToken: boolean;
  hasToken: boolean;
}

/** A Cosmos 3 synthetic-episode generation job (in-memory on the server). */
export interface CosmosSyntheticJob {
  id: string;
  status: CosmosJobStatus;
  /** Generator mode (absent on jobs from pre-TASK-182 servers). */
  mode?: SyntheticGeneratorMode;
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
  /** Per-mode capabilities (TASK-182); absent on pre-TASK-182 servers. */
  modes?: SyntheticModeInfo[];
}

export interface GenerateSyntheticInput {
  episodes: number;
  prompt?: string;
  /** Defaults to 'forward-dynamics' on the server (backward compatible). */
  mode?: SyntheticGeneratorMode;
}

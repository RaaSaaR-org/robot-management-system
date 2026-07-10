/**
 * @file training.types.ts
 * @description Type definitions for training job management
 * @feature vla
 */

import type {
  TrainingJob,
  TrainingJobStatus,
  BaseModel,
  FineTuneMethod,
  Hyperparameters,
  GpuRequirements,
  TrainingMetrics,
  RewardType,
  EpisodeAnnotation,
} from './vla.types.js';

// ============================================================================
// JOB TYPES
// ============================================================================

export type TrainingJobType = 'finetune' | 'evaluate' | 'export';

// ============================================================================
// JOB PAYLOAD (NATS Message)
// ============================================================================

/**
 * Payload structure for training job messages in NATS
 */
export interface TrainingJobPayload {
  jobId: string;
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters: Hyperparameters;
  gpuRequirements: GpuRequirements;
  priority: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// JOB PROGRESS (KV Store)
// ============================================================================

/**
 * Job progress stored in NATS KV store
 */
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

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

export const TrainingJobEventTypes = [
  'training:job:created',
  'training:job:started',
  'training:job:progress',
  'training:job:completed',
  'training:job:failed',
  'training:job:cancelled',
] as const;

export type TrainingJobEventType = (typeof TrainingJobEventTypes)[number];

/**
 * Training job event for WebSocket broadcasting
 */
export interface TrainingJobEvent {
  type: TrainingJobEventType;
  jobId: string;
  job?: TrainingJob;
  progress?: JobProgress;
  error?: string;
  timestamp: string;
}

export type TrainingJobEventCallback = (event: TrainingJobEvent) => void;

// ============================================================================
// QUEUE STATISTICS
// ============================================================================

/**
 * Queue statistics for monitoring
 */
export interface QueueStats {
  pending: number;
  /** Jobs in the `queued` state (populated by the DB-derived fallback). */
  queued?: number;
  running: number;
  completed: number;
  /** Completed within the last 24h (populated by the DB-derived fallback). */
  completed_24h?: number;
  failed: number;
  streamInfo: {
    messages: number;
    bytes: number;
    firstSeq: number;
    lastSeq: number;
    consumerCount: number;
  };
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request body for submitting a supervised VLA fine-tune training job.
 * `kind` is optional and defaults to 'supervised'.
 */
export interface SubmitTrainingJobRequest {
  kind?: 'supervised';
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters?: Partial<Hyperparameters>;
  gpuRequirements?: Partial<GpuRequirements>;
  totalEpochs?: number;
  priority?: number;
}

/**
 * Request body for submitting a sim_rl (twin-derived RL navigation) training
 * job. Carries a SimScene id instead of a dataset/baseModel. (TASK-172.C)
 */
export interface SubmitSimRlJobRequest {
  kind: 'sim_rl';
  /** SimScene registry id the policy will train in (the RL env). */
  sceneId: string;
  hyperparameters?: Partial<Hyperparameters>;
  gpuRequirements?: Partial<GpuRequirements>;
  totalEpochs?: number;
  priority?: number;
}

/**
 * Request for submitting a reward_model job (TASK-179 contract §3). Created
 * via POST /api/evaluation/reward-model; claimed over HTTP by the
 * training-worker (kinds includes 'reward_model') — no NATS enqueue.
 */
export interface SubmitRewardModelJobRequest {
  datasetId: string;
  rewardType: RewardType;
  episodes?: number[];
  task?: string;
  imageKey?: string;
  maxFrames?: number;
}

/**
 * Request for submitting an annotate job (TASK-179 contract §4). Created via
 * POST /api/datasets/:id/annotate; claimed over HTTP like reward_model jobs.
 */
export interface SubmitAnnotateJobRequest {
  datasetId: string;
  episodes?: number[];
}

/**
 * Response for training job submission
 */
export interface SubmitTrainingJobResponse {
  job: TrainingJob;
  queuePosition?: number;
}

/**
 * Query parameters for listing training jobs
 */
export interface ListTrainingJobsQuery {
  datasetId?: string;
  baseModel?: BaseModel | BaseModel[];
  fineTuneMethod?: FineTuneMethod | FineTuneMethod[];
  status?: TrainingJobStatus | TrainingJobStatus[];
  page?: number;
  pageSize?: number;
}

/**
 * Response for listing training jobs
 */
export interface ListTrainingJobsResponse {
  jobs: TrainingJob[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Response for job details including progress
 */
export interface TrainingJobDetailsResponse {
  job: TrainingJob;
  progress?: JobProgress;
}

// ============================================================================
// WORKER CALLBACK TYPES
// ============================================================================

/**
 * Worker heartbeat request - alive check with GPU utilization.
 *
 * `workerId` and `device` were added so the server can track *which*
 * workers are connected and what hardware they're using. They are
 * optional for backward compatibility with workers that haven't been
 * redeployed yet — those workers will still get the cancel-check
 * semantics, but won't appear in the worker list.
 */
export interface WorkerHeartbeatRequest {
  jobId: string;
  gpuUtil: number; // 0-100
  memoryUtil: number; // 0-100
  workerId?: string;
  device?: string; // 'cuda' | 'mps' | 'cpu'
}

/**
 * Worker heartbeat response - signals if worker should stop
 */
export interface WorkerHeartbeatResponse {
  status: 'ok' | 'stop';
  message?: string;
}

/**
 * Worker progress update request
 */
export interface WorkerProgressRequest {
  jobId: string;
  epoch: number;
  step: number;
  totalSteps: number;
  trainLoss: number;
  valLoss?: number;
  learningRate: number;
}

/**
 * Worker progress response
 */
export interface WorkerProgressResponse {
  status: 'ok' | 'cancel';
  eta?: string;
}

/**
 * Per-episode reward result reported by a reward_model worker
 * (TASK-179 contract §1).
 */
export interface WorkerEpisodeReward {
  episodeIndex: number;
  score: number;
  success: boolean | null;
  curve: number[];
  fps: number | null;
}

/**
 * Worker completion request
 */
export interface WorkerCompleteRequest {
  jobId: string;
  artifactUri: string;
  finalMetrics: {
    // Loss/epoch summary — present for supervised jobs; reward_model and
    // annotate completions (TASK-179) carry only their result payloads.
    finalLoss?: number;
    validationLoss?: number;
    trainingTimeSeconds?: number;
    bestEpoch?: number;
    // sim-RL quality summary (TASK-172.C); present only for `sim_rl` jobs.
    meanReward?: number;
    successRate?: number;
    totalTimesteps?: number;
    trainer?: string;
    // reward_model results (TASK-179); present only for `reward_model` jobs.
    kind?: string;
    rewardType?: RewardType;
    rewards?: WorkerEpisodeReward[];
    // annotate results (TASK-179); present only for `annotate` jobs.
    annotations?: EpisodeAnnotation[];
  };
}

/**
 * Worker completion response
 */
export interface WorkerCompleteResponse {
  status: 'ok';
  modelVersionId?: string;
}

/**
 * Worker failure request
 */
export interface WorkerFailedRequest {
  jobId: string;
  error: string;
  lastCheckpoint?: string;
}

/**
 * Worker failure response
 */
export interface WorkerFailedResponse {
  status: 'ok';
}

/**
 * Worker checkpoint request
 */
export interface WorkerCheckpointRequest {
  jobId: string;
  epoch: number;
  checkpointUri: string;
}

/**
 * Worker checkpoint response
 */
export interface WorkerCheckpointResponse {
  status: 'ok';
}

// ============================================================================
// ETA TRACKING
// ============================================================================

/**
 * ETA calculation state stored in KV
 */
export interface EtaState {
  startedAt: number; // Unix timestamp ms
  stepTimes: number[]; // Rolling window of step durations (ms)
  currentStep: number;
  totalSteps: number;
  estimatedRemainingMs: number;
  estimatedCompletionTime: string; // ISO timestamp
}

// ============================================================================
// WORKER STATUS REGISTRY
// ============================================================================

/**
 * In-memory worker registry entry. Updated on every heartbeat.
 * Not persisted — workers re-announce on their next heartbeat after
 * a server restart.
 */
export interface WorkerStatus {
  workerId: string;
  device: string; // 'cuda' | 'mps' | 'cpu' (free-form string)
  currentJobId: string | null;
  gpuUtil: number; // 0-100, last heartbeat value
  memoryUtil: number; // 0-100, last heartbeat value
  lastHeartbeatAt: Date;
  firstSeenAt: Date;
}

/**
 * Worker status as exposed by GET /api/training/workers, with derived
 * fields and the current job's basic info embedded.
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
    ageSeconds: number; // seconds since the job started running
  } | null;
  gpuUtil: number;
  memoryUtil: number;
  lastHeartbeatAt: string; // ISO timestamp
  lastHeartbeatAgeSeconds: number;
  firstSeenAt: string; // ISO timestamp
}

/**
 * Response shape for GET /api/training/workers.
 * Includes queue/run summary so the panel doesn't need a second call.
 */
export interface WorkerStatusListResponse {
  workers: WorkerStatusView[];
  queuedJobs: number;
  runningJobs: number;
}

/**
 * Training duration estimate
 */
export interface TrainingDurationEstimate {
  estimatedMinutes: number;
  estimatedSteps: number;
  stepsPerSecond: number;
  confidence: 'high' | 'medium' | 'low';
}

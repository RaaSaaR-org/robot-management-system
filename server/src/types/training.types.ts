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
  running: number;
  completed: number;
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
 * Request body for submitting a training job
 */
export interface SubmitTrainingJobRequest {
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters?: Partial<Hyperparameters>;
  gpuRequirements?: Partial<GpuRequirements>;
  totalEpochs?: number;
  priority?: number;
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
 * Worker heartbeat request - alive check with GPU utilization
 */
export interface WorkerHeartbeatRequest {
  jobId: string;
  gpuUtil: number; // 0-100
  memoryUtil: number; // 0-100
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
 * Worker completion request
 */
export interface WorkerCompleteRequest {
  jobId: string;
  artifactUri: string;
  finalMetrics: {
    finalLoss: number;
    validationLoss?: number;
    trainingTimeSeconds: number;
    bestEpoch: number;
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
// GPU AVAILABILITY
// ============================================================================

/**
 * GPU availability information
 */
export interface GpuAvailability {
  totalCount: number;
  availableCount: number;
  byType: Record<string, { total: number; available: number; memoryGb: number }>;
  totalMemoryGb: number;
  availableMemoryGb: number;
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

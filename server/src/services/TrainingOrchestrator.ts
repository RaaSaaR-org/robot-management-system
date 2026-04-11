/**
 * @file TrainingOrchestrator.ts
 * @description Orchestration service for VLA training job lifecycle management
 * @feature vla
 *
 * Provides:
 * - Hyperparameter validation (Zod)
 * - GPU availability checking (stubbed)
 * - Training duration estimation
 * - Job lifecycle management (start, progress, complete, fail)
 * - ETA calculation from step history
 */

import { z } from 'zod';
import { EventEmitter } from 'events';
import {
  trainingJobRepository,
  modelVersionRepository,
  datasetRepository,
} from '../repositories/index.js';
import { getJobQueue, natsClient } from '../messaging/index.js';
import { trainingJobService } from './TrainingJobService.js';
import type {
  TrainingJob,
  TrainingMetrics,
  Hyperparameters,
  Dataset,
} from '../types/vla.types.js';
import type {
  WorkerProgressRequest,
  WorkerCompleteRequest,
  WorkerFailedRequest,
  WorkerCheckpointRequest,
  GpuAvailability,
  TrainingDurationEstimate,
  EtaState,
  JobProgress,
} from '../types/training.types.js';

// ============================================================================
// HYPERPARAMETER VALIDATION SCHEMA (Zod)
// ============================================================================

/**
 * Check if a number is a power of 2
 */
function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Hyperparameter validation schema
 * - learning_rate: 1e-6 to 1e-3
 * - batch_size: 1 to 64, must be power of 2
 * - epochs: 1 to 100
 * - lora_rank: 4, 8, 16, 32, 64 (only for LoRA method)
 * - warmup_steps: >= 0
 */
export const hyperparametersSchema = z.object({
  learning_rate: z
    .number()
    .min(1e-6, 'learning_rate must be at least 1e-6')
    .max(1e-3, 'learning_rate must be at most 1e-3'),
  batch_size: z
    .number()
    .int('batch_size must be an integer')
    .min(1, 'batch_size must be at least 1')
    .max(64, 'batch_size must be at most 64')
    .refine(isPowerOfTwo, 'batch_size must be a power of 2'),
  epochs: z
    .number()
    .int('epochs must be an integer')
    .min(1, 'epochs must be at least 1')
    .max(100, 'epochs must be at most 100'),
  lora_rank: z
    .number()
    .int('lora_rank must be an integer')
    .refine((v) => [4, 8, 16, 32, 64].includes(v), 'lora_rank must be 4, 8, 16, 32, or 64')
    .optional(),
  warmup_steps: z
    .number()
    .int('warmup_steps must be an integer')
    .min(0, 'warmup_steps must be at least 0')
    .optional(),
  weight_decay: z
    .number()
    .min(0, 'weight_decay must be at least 0')
    .max(1, 'weight_decay must be at most 1')
    .optional(),
  gradient_accumulation_steps: z
    .number()
    .int('gradient_accumulation_steps must be an integer')
    .min(1, 'gradient_accumulation_steps must be at least 1')
    .optional(),
  max_grad_norm: z.number().positive('max_grad_norm must be positive').optional(),
  max_steps: z
    .number()
    .int('max_steps must be an integer')
    .min(0, 'max_steps must be at least 0')
    .optional(),
  lora_alpha: z.number().int().positive().optional(),
  lora_dropout: z.number().min(0).max(1).optional(),
});

// ============================================================================
// CONSTANTS
// ============================================================================

const ETA_WINDOW_SIZE = 20; // Number of step times to track for ETA calculation
const DEFAULT_STEP_TIME_MS = 5000; // Default step time estimate (5 seconds)

// ============================================================================
// TRAINING ORCHESTRATOR SERVICE
// ============================================================================

/**
 * Training job orchestration service
 * Handles job lifecycle, validation, progress tracking, and ETA calculation
 */
export class TrainingOrchestrator extends EventEmitter {
  private static instance: TrainingOrchestrator;
  private etaStates: Map<string, EtaState> = new Map();
  private checkpoints: Map<string, { epoch: number; uri: string }[]> = new Map();
  private initialized = false;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TrainingOrchestrator {
    if (!TrainingOrchestrator.instance) {
      TrainingOrchestrator.instance = new TrainingOrchestrator();
    }
    return TrainingOrchestrator.instance;
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // One-shot cleanup: mark any jobs that were left in 'running' state
    // from a previous server run as failed. External workers that are
    // genuinely still running will reclaim or callback normally.
    try {
      const orphans = await this.reapStaleRunningJobs();
      if (orphans > 0) {
        console.log(
          `[TrainingOrchestrator] Reaped ${orphans} orphaned running job(s) on boot`
        );
      }
    } catch (err) {
      console.error('[TrainingOrchestrator] Failed to reap orphaned jobs:', err);
    }

    this.initialized = true;
    console.log('[TrainingOrchestrator] Initialized');
  }

  /**
   * Mark stale running jobs (updatedAt older than the threshold) as failed.
   * Called on service startup to clean up jobs whose workers died mid-run.
   * Uses a generous 5-minute threshold so heartbeating workers are safe.
   */
  async reapStaleRunningJobs(thresholdMs = 5 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const running = await trainingJobRepository.findByStatus('running');
    let reaped = 0;
    for (const job of running) {
      if (job.updatedAt.getTime() < cutoff.getTime()) {
        await trainingJobService.updateJobStatus(job.id, 'failed', {
          errorMessage: 'worker timeout: no heartbeat/progress for >5m (reaped on boot)',
          completedAt: new Date(),
        });
        this.etaStates.delete(job.id);
        reaped++;
      }
    }
    return reaped;
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // HYPERPARAMETER VALIDATION
  // ============================================================================

  /**
   * Validate hyperparameters against schema
   * @returns Validated hyperparameters or throws ZodError
   */
  validateHyperparameters(
    hyperparameters: Partial<Hyperparameters>,
    fineTuneMethod: string
  ): Hyperparameters {
    // Add required defaults (spread input first so optional keys flow through)
    const toValidate = {
      ...hyperparameters,
      learning_rate: hyperparameters.learning_rate ?? 1e-4,
      batch_size: hyperparameters.batch_size ?? 32,
      epochs: hyperparameters.epochs ?? 100,
    };

    // Validate with Zod
    const result = hyperparametersSchema.parse(toValidate);

    // Additional validation: lora_rank required for LoRA method
    if (fineTuneMethod === 'lora' && !result.lora_rank) {
      throw new Error('lora_rank is required for LoRA fine-tuning method');
    }

    // lora_rank should not be set for non-LoRA methods
    if (fineTuneMethod !== 'lora' && result.lora_rank) {
      delete result.lora_rank;
    }

    return result as Hyperparameters;
  }

  // ============================================================================
  // GPU AVAILABILITY
  // ============================================================================

  /**
   * Get GPU availability from env config + running job count from DB.
   * Set GPU_TOTAL_COUNT, GPU_TYPE, GPU_MEMORY_GB in env.
   */
  async getGpuAvailability(): Promise<GpuAvailability> {
    const totalCount = parseInt(process.env.GPU_TOTAL_COUNT ?? '1', 10);
    const gpuType = process.env.GPU_TYPE ?? 'unknown';
    const gpuMemoryGb = parseFloat(process.env.GPU_MEMORY_GB ?? '0');

    // availableCount = total - running jobs (from DB)
    const runningJobs = await trainingJobRepository.findRunning();
    const runningCount = runningJobs.length;
    const availableCount = Math.max(0, totalCount - runningCount);

    const totalMemoryGb = totalCount * gpuMemoryGb;
    const availableMemoryGb = availableCount * gpuMemoryGb;

    return {
      totalCount,
      availableCount,
      byType: gpuType !== 'unknown' ? {
        [gpuType]: { total: totalCount, available: availableCount, memoryGb: gpuMemoryGb },
      } : {},
      totalMemoryGb,
      availableMemoryGb,
    };
  }

  // ============================================================================
  // TRAINING DURATION ESTIMATION
  // ============================================================================

  /**
   * Estimate training duration based on dataset size and hyperparameters
   */
  async estimateTrainingDuration(
    datasetId: string,
    hyperparameters: Hyperparameters
  ): Promise<TrainingDurationEstimate> {
    const dataset = await datasetRepository.findById(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    // Calculate total steps
    const totalFrames = dataset.totalFrames || 1000;
    const batchSize = hyperparameters.batch_size || 32;
    const epochs = hyperparameters.epochs || 100;

    const stepsPerEpoch = Math.ceil(totalFrames / batchSize);
    const totalSteps = stepsPerEpoch * epochs;

    // Estimate ~5 seconds per step (conservative estimate)
    const estimatedSecondsPerStep = 5;
    const estimatedTotalSeconds = totalSteps * estimatedSecondsPerStep;
    const estimatedMinutes = Math.ceil(estimatedTotalSeconds / 60);

    // Determine confidence based on dataset size
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (totalFrames > 10000) {
      confidence = 'high';
    } else if (totalFrames < 1000) {
      confidence = 'low';
    }

    return {
      estimatedMinutes,
      estimatedSteps: totalSteps,
      stepsPerSecond: 1 / estimatedSecondsPerStep,
      confidence,
    };
  }

  // ============================================================================
  // JOB LIFECYCLE - START
  // ============================================================================

  /**
   * Claim the next pending/queued training job for a worker.
   * Atomically picks the oldest job with status in ('pending','queued'),
   * transitions it to 'running' via startJob(), and returns it.
   * Returns null if no jobs are waiting.
   */
  async claimNextPendingJob(workerId: string): Promise<TrainingJob | null> {
    // Pull pending/queued jobs; findAll returns newest-first so we pick
    // the oldest entry (closest to head of FIFO queue).
    const candidates = await trainingJobRepository.findAll({
      status: ['pending', 'queued'],
      page: 1,
      pageSize: 50,
    });
    if (candidates.data.length === 0) return null;
    const job = candidates.data[candidates.data.length - 1];
    const started = await this.startJob(job.id);
    if (!started) return null;
    console.log(
      `[TrainingOrchestrator] Job ${job.id} claimed by worker ${workerId}`
    );
    return started;
  }

  /**
   * Start a training job
   * - Marks job as 'running'
   * - Sets startedAt timestamp
   */
  async startJob(jobId: string): Promise<TrainingJob | null> {
    const job = await trainingJobRepository.findById(jobId);
    if (!job) {
      console.error(`[TrainingOrchestrator] Job not found: ${jobId}`);
      return null;
    }

    // Initialize ETA state
    this.etaStates.set(jobId, {
      startedAt: Date.now(),
      stepTimes: [],
      currentStep: 0,
      totalSteps: 0,
      estimatedRemainingMs: 0,
      estimatedCompletionTime: '',
    });

    // Update job status
    const updatedJob = await trainingJobService.updateJobStatus(jobId, 'running', {
      startedAt: new Date(),
    });

    console.log(`[TrainingOrchestrator] Job started: ${jobId}`);
    return updatedJob;
  }

  // ============================================================================
  // JOB LIFECYCLE - PROGRESS
  // ============================================================================

  /**
   * Update job progress from worker callback
   * - Updates progress percentage
   * - Updates metrics (loss curves)
   * - Calculates ETA
   */
  async updateProgress(
    request: WorkerProgressRequest
  ): Promise<{ job: TrainingJob | null; eta: string | null; cancel: boolean }> {
    const { jobId, epoch, step, totalSteps, trainLoss, valLoss, learningRate } = request;

    // Check if job is cancelled
    const currentJob = await trainingJobRepository.findById(jobId);
    if (!currentJob) {
      return { job: null, eta: null, cancel: true };
    }

    if (currentJob.status === 'cancelled') {
      return { job: currentJob, eta: null, cancel: true };
    }

    // Update ETA state
    const etaState = this.etaStates.get(jobId);
    const now = Date.now();

    if (etaState) {
      // Calculate step duration if we have a previous step
      if (etaState.currentStep > 0 && step > etaState.currentStep) {
        const stepDuration = now - etaState.startedAt;
        const avgStepDuration = stepDuration / step;

        // Add to rolling window
        etaState.stepTimes.push(avgStepDuration);
        if (etaState.stepTimes.length > ETA_WINDOW_SIZE) {
          etaState.stepTimes.shift();
        }
      }

      etaState.currentStep = step;
      etaState.totalSteps = totalSteps;

      // Calculate ETA
      const remainingSteps = totalSteps - step;
      const avgStepMs =
        etaState.stepTimes.length > 0
          ? etaState.stepTimes.reduce((a, b) => a + b, 0) / etaState.stepTimes.length
          : DEFAULT_STEP_TIME_MS;

      etaState.estimatedRemainingMs = remainingSteps * avgStepMs;
      etaState.estimatedCompletionTime = new Date(now + etaState.estimatedRemainingMs).toISOString();
    }

    // Calculate progress percentage
    const progress = totalSteps > 0 ? Math.round((step / totalSteps) * 100) : 0;

    // Build metrics update
    const existingMetrics = currentJob.metrics || {};
    const updatedMetrics: TrainingMetrics = {
      ...existingMetrics,
      training_loss: [...(existingMetrics.training_loss || []), trainLoss],
      learning_rate: [...(existingMetrics.learning_rate || []), learningRate],
    };

    if (valLoss !== undefined) {
      updatedMetrics.validation_loss = [...(existingMetrics.validation_loss || []), valLoss];
    }

    // Update job in database
    const updatedJob = await trainingJobRepository.update(jobId, {
      progress,
      currentEpoch: epoch,
      metrics: updatedMetrics,
    });

    // Update KV store progress if NATS is up. The DB update above is
    // the source of truth; the KV is a cache for push notifications.
    if (natsClient.isConnected()) {
      try {
        const jobQueue = getJobQueue();
        const kvProgress: JobProgress = {
          status: 'running',
          progress,
          currentEpoch: epoch,
          totalEpochs: currentJob.totalEpochs,
          metrics: updatedMetrics,
          eta: etaState?.estimatedCompletionTime,
          message: `Training epoch ${epoch}, step ${step}/${totalSteps}`,
          updatedAt: new Date().toISOString(),
        };
        await jobQueue.updateJobProgress(jobId, kvProgress);
      } catch (err) {
        console.warn('[TrainingOrchestrator] KV progress update failed:', err);
      }
    }

    // Emit progress event
    if (updatedJob) {
      trainingJobService.emitProgressEvent(jobId, {
        status: 'running',
        progress,
        currentEpoch: epoch,
        totalEpochs: currentJob.totalEpochs,
        metrics: updatedMetrics,
        eta: etaState?.estimatedCompletionTime,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      job: updatedJob,
      eta: etaState?.estimatedCompletionTime || null,
      cancel: false,
    };
  }

  // ============================================================================
  // JOB LIFECYCLE - COMPLETE
  // ============================================================================

  /**
   * Complete a training job
   * - Marks job as 'completed'
   * - Sets completedAt timestamp
   * - Creates ModelVersion
   */
  async completeJob(request: WorkerCompleteRequest): Promise<{
    job: TrainingJob | null;
    modelVersionId: string | null;
  }> {
    const { jobId, artifactUri, finalMetrics } = request;

    const job = await trainingJobRepository.findById(jobId);
    if (!job) {
      console.error(`[TrainingOrchestrator] Job not found: ${jobId}`);
      return { job: null, modelVersionId: null };
    }

    // Update job metrics
    const updatedMetrics: TrainingMetrics = {
      ...job.metrics,
      final_loss: finalMetrics.finalLoss,
      best_epoch: finalMetrics.bestEpoch,
    };

    // Update job status
    const updatedJob = await trainingJobService.updateJobStatus(jobId, 'completed', {
      progress: 100,
      completedAt: new Date(),
      metrics: updatedMetrics,
    });

    // Clean up ETA state
    this.etaStates.delete(jobId);

    let modelVersionId: string | null = null;

    // Create ModelVersion — always, even when the dataset has no skill yet.
    // Skill linkage can be set later via the model registry.
    try {
      const dataset = await datasetRepository.findById(job.datasetId);
      const timestamp = Date.now();
      const version = `v${timestamp}`;

      const modelVersion = await modelVersionRepository.create({
        skillId: dataset?.skillId ?? null,
        trainingJobId: jobId,
        version,
        artifactUri,
        trainingMetrics: updatedMetrics,
        validationMetrics: finalMetrics.validationLoss
          ? { final_loss: finalMetrics.validationLoss }
          : {},
        deploymentStatus: 'staging',
      });

      modelVersionId = modelVersion.id;
      console.log(
        `[TrainingOrchestrator] Created ModelVersion: ${modelVersionId} (skill=${
          dataset?.skillId ?? 'none'
        })`
      );
    } catch (error) {
      console.error('[TrainingOrchestrator] Failed to create ModelVersion:', error);
    }

    console.log(`[TrainingOrchestrator] Job completed: ${jobId}`);
    return { job: updatedJob, modelVersionId };
  }

  // ============================================================================
  // JOB LIFECYCLE - FAIL
  // ============================================================================

  /**
   * Mark a training job as failed
   */
  async failJob(request: WorkerFailedRequest): Promise<TrainingJob | null> {
    const { jobId, error, lastCheckpoint } = request;

    // Clean up ETA state
    this.etaStates.delete(jobId);

    // Store last checkpoint if provided
    if (lastCheckpoint) {
      const job = await trainingJobRepository.findById(jobId);
      if (job) {
        const checkpointList = this.checkpoints.get(jobId) || [];
        checkpointList.push({
          epoch: job.currentEpoch || 0,
          uri: lastCheckpoint,
        });
        this.checkpoints.set(jobId, checkpointList);
      }
    }

    // Update job status
    const updatedJob = await trainingJobService.updateJobStatus(jobId, 'failed', {
      errorMessage: error,
    });

    console.log(`[TrainingOrchestrator] Job failed: ${jobId} - ${error}`);
    return updatedJob;
  }

  // ============================================================================
  // CHECKPOINT MANAGEMENT
  // ============================================================================

  /**
   * Record a checkpoint
   */
  async recordCheckpoint(request: WorkerCheckpointRequest): Promise<void> {
    const { jobId, epoch, checkpointUri } = request;

    const checkpointList = this.checkpoints.get(jobId) || [];
    checkpointList.push({ epoch, uri: checkpointUri });
    this.checkpoints.set(jobId, checkpointList);

    console.log(`[TrainingOrchestrator] Checkpoint recorded: ${jobId} epoch ${epoch}`);
  }

  /**
   * Get checkpoints for a job
   */
  getCheckpoints(jobId: string): { epoch: number; uri: string }[] {
    return this.checkpoints.get(jobId) || [];
  }

  // ============================================================================
  // HEARTBEAT CHECK
  // ============================================================================

  /**
   * Check if a job should continue running
   * Returns 'stop' if job is cancelled, 'ok' otherwise
   */
  async checkHeartbeat(jobId: string): Promise<'ok' | 'stop'> {
    const job = await trainingJobRepository.findById(jobId);
    if (!job) {
      return 'stop';
    }

    if (job.status === 'cancelled') {
      return 'stop';
    }

    return 'ok';
  }

  // ============================================================================
  // ETA METHODS
  // ============================================================================

  /**
   * Get current ETA for a job
   */
  getEta(jobId: string): EtaState | null {
    return this.etaStates.get(jobId) || null;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const trainingOrchestrator = TrainingOrchestrator.getInstance();

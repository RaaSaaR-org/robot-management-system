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
import { mlflowService } from './MLflowService.js';
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

    this.initialized = true;
    console.log('[TrainingOrchestrator] Initialized');
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
    // Add required defaults
    const toValidate = {
      learning_rate: hyperparameters.learning_rate ?? 1e-4,
      batch_size: hyperparameters.batch_size ?? 32,
      epochs: hyperparameters.epochs ?? 100,
      lora_rank: hyperparameters.lora_rank,
      warmup_steps: hyperparameters.warmup_steps,
      weight_decay: hyperparameters.weight_decay,
      gradient_accumulation_steps: hyperparameters.gradient_accumulation_steps,
      max_grad_norm: hyperparameters.max_grad_norm,
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
  // GPU AVAILABILITY (STUBBED)
  // ============================================================================

  /**
   * Get GPU availability (stubbed - returns mock data)
   * In production, this would query cloud provider APIs
   */
  async getGpuAvailability(): Promise<GpuAvailability> {
    // Stubbed: Return mock 8x A100 40GB availability
    return {
      totalCount: 8,
      availableCount: 6,
      byType: {
        A100_40GB: { total: 4, available: 3, memoryGb: 40 },
        A100_80GB: { total: 2, available: 2, memoryGb: 80 },
        H100: { total: 2, available: 1, memoryGb: 80 },
      },
      totalMemoryGb: 440,
      availableMemoryGb: 340,
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
   * Start a training job
   * - Marks job as 'running'
   * - Sets startedAt timestamp
   * - Creates MLflow run if available
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

    // Create MLflow run if available
    if (mlflowService.isInitialized()) {
      try {
        const experimentName = `vla-training-${job.baseModel}`;
        let experiment = await mlflowService.getExperimentByName(experimentName);
        if (!experiment) {
          experiment = await mlflowService.createExperiment(experimentName);
        }

        const run = await mlflowService.createRun(experiment.experimentId, `job-${jobId}`, {
          job_id: jobId,
          dataset_id: job.datasetId,
          base_model: job.baseModel,
          fine_tune_method: job.fineTuneMethod,
        });

        // Update job with MLflow info
        await trainingJobRepository.update(jobId, {
          mlflowRunId: run.info.runId,
          mlflowExperimentId: experiment.experimentId,
        });

        // Log hyperparameters
        const hyperparamRecord: Record<string, string | number> = {};
        const hp = job.hyperparameters;
        if (hp.learning_rate !== undefined) hyperparamRecord['learning_rate'] = hp.learning_rate;
        if (hp.batch_size !== undefined) hyperparamRecord['batch_size'] = hp.batch_size;
        if (hp.epochs !== undefined) hyperparamRecord['epochs'] = hp.epochs;
        if (hp.lora_rank !== undefined) hyperparamRecord['lora_rank'] = hp.lora_rank;
        if (hp.warmup_steps !== undefined) hyperparamRecord['warmup_steps'] = hp.warmup_steps;
        if (hp.weight_decay !== undefined) hyperparamRecord['weight_decay'] = hp.weight_decay;
        if (hp.gradient_accumulation_steps !== undefined) hyperparamRecord['gradient_accumulation_steps'] = hp.gradient_accumulation_steps;
        if (hp.max_grad_norm !== undefined) hyperparamRecord['max_grad_norm'] = hp.max_grad_norm;
        await mlflowService.logParams(run.info.runId, hyperparamRecord);

        console.log(`[TrainingOrchestrator] Created MLflow run: ${run.info.runId}`);
      } catch (error) {
        console.error('[TrainingOrchestrator] Failed to create MLflow run:', error);
      }
    }

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

    // Update KV store progress
    const jobQueue = getJobQueue();
    if (jobQueue) {
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
    }

    // Log metrics to MLflow
    if (mlflowService.isInitialized() && currentJob.mlflowRunId) {
      try {
        await mlflowService.logMetrics(currentJob.mlflowRunId, [
          { key: 'train_loss', value: trainLoss, step },
          { key: 'learning_rate', value: learningRate, step },
          ...(valLoss !== undefined ? [{ key: 'val_loss', value: valLoss, step }] : []),
        ]);
      } catch (error) {
        console.error('[TrainingOrchestrator] Failed to log MLflow metrics:', error);
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
   * - Registers model in MLflow
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

    // Create ModelVersion
    try {
      // Get dataset to determine skill
      const dataset = await datasetRepository.findById(job.datasetId);
      if (dataset?.skillId) {
        // Generate version string
        const timestamp = Date.now();
        const version = `v${timestamp}`;

        const modelVersion = await modelVersionRepository.create({
          skillId: dataset.skillId,
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
        console.log(`[TrainingOrchestrator] Created ModelVersion: ${modelVersionId}`);
      }
    } catch (error) {
      console.error('[TrainingOrchestrator] Failed to create ModelVersion:', error);
    }

    // Register model in MLflow
    if (mlflowService.isInitialized() && job.mlflowRunId) {
      try {
        // End the run
        await mlflowService.endRun(job.mlflowRunId, 'FINISHED');

        // Register model
        const modelName = `vla-${job.baseModel}-${job.fineTuneMethod}`;
        try {
          await mlflowService.createRegisteredModel(modelName, `VLA model trained with ${job.fineTuneMethod}`);
        } catch {
          // Model might already exist
        }

        const mlflowModelVersion = await mlflowService.createModelVersion(
          modelName,
          artifactUri,
          job.mlflowRunId,
          `Trained from job ${jobId}`
        );

        // Update model version with MLflow info
        if (modelVersionId) {
          await modelVersionRepository.update(modelVersionId, {
            mlflowModelName: modelName,
            mlflowModelVersion: mlflowModelVersion.version,
          });
        }

        console.log(`[TrainingOrchestrator] Registered MLflow model: ${modelName} v${mlflowModelVersion.version}`);
      } catch (error) {
        console.error('[TrainingOrchestrator] Failed to register MLflow model:', error);
      }
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

    // End MLflow run if available
    const job = await trainingJobRepository.findById(jobId);
    if (job?.mlflowRunId && mlflowService.isInitialized()) {
      try {
        await mlflowService.endRun(job.mlflowRunId, 'FAILED');
      } catch (err) {
        console.error('[TrainingOrchestrator] Failed to end MLflow run:', err);
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

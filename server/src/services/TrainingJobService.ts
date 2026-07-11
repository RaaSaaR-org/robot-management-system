/**
 * @file TrainingJobService.ts
 * @description Service for managing VLA training jobs with NATS JetStream
 * @feature vla
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  trainingJobRepository,
  datasetRepository,
  simSceneRepository,
} from '../repositories/index.js';
import {
  getJobQueue,
  JetStreamJobQueue,
  natsClient,
} from '../messaging/index.js';
import type {
  TrainingJob,
  TrainingJobStatus,
  TrainingJobQueryParams,
  CreateTrainingJobInput,
  PaginatedResult,
  Hyperparameters,
  GpuRequirements,
} from '../types/vla.types.js';
import type {
  TrainingJobEvent,
  TrainingJobEventType,
  TrainingJobEventCallback,
  JobProgress,
  QueueStats,
  SubmitTrainingJobRequest,
  SubmitSimRlJobRequest,
  SubmitRewardModelJobRequest,
  SubmitAnnotateJobRequest,
} from '../types/training.types.js';
import type {
  BaseModel,
  RewardModelHyperparameters,
  AnnotateHyperparameters,
} from '../types/vla.types.js';

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULT_HYPERPARAMETERS: Hyperparameters = {
  learning_rate: 1e-4,
  batch_size: 32,
  epochs: 100,
};

const DEFAULT_GPU_REQUIREMENTS: GpuRequirements = {
  count: 1,
  memory: 40,
};

// ============================================================================
// TRAINING JOB SERVICE
// ============================================================================

/**
 * Service for managing VLA training jobs
 */
export class TrainingJobService extends EventEmitter {
  private static instance: TrainingJobService;
  private jobQueue: JetStreamJobQueue | null = null;
  private progressWatchers: Map<string, () => void> = new Map();
  private initialized = false;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TrainingJobService {
    if (!TrainingJobService.instance) {
      TrainingJobService.instance = new TrainingJobService();
    }
    return TrainingJobService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!natsClient.isConnected()) {
      console.log('[TrainingJobService] NATS not connected, skipping initialization');
      return;
    }

    try {
      this.jobQueue = getJobQueue();
      await this.jobQueue.initialize();
      this.initialized = true;
      console.log('[TrainingJobService] Initialized');
    } catch (error) {
      console.error('[TrainingJobService] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // JOB SUBMISSION
  // ============================================================================

  /**
   * Submit a new training job
   */
  async submitJob(request: SubmitTrainingJobRequest): Promise<TrainingJob> {
    // Validate dataset exists and is ready
    const dataset = await datasetRepository.findById(request.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${request.datasetId}`);
    }
    if (dataset.status !== 'ready') {
      throw new Error(`Dataset not ready: ${request.datasetId} (status: ${dataset.status})`);
    }

    // Merge with defaults
    const hyperparameters: Hyperparameters = {
      ...DEFAULT_HYPERPARAMETERS,
      ...request.hyperparameters,
    };

    const gpuRequirements: GpuRequirements = {
      ...DEFAULT_GPU_REQUIREMENTS,
      ...request.gpuRequirements,
    };

    // Create job in database
    const jobInput: CreateTrainingJobInput = {
      datasetId: request.datasetId,
      baseModel: request.baseModel,
      fineTuneMethod: request.fineTuneMethod,
      hyperparameters,
      gpuRequirements,
      totalEpochs: request.totalEpochs ?? hyperparameters.epochs,
    };

    const job = await trainingJobRepository.create(jobInput);

    // Add to NATS queue if available. The HTTP claim worker reads jobs
    // directly from the DB (status='pending'), so NATS is optional here.
    // Source the supervised-only fields from `request` (always non-null here)
    // rather than the now-nullable domain `job` fields.
    if (this.jobQueue) {
      await this.jobQueue.addJob('finetune', {
        jobId: job.id,
        datasetId: request.datasetId,
        baseModel: request.baseModel,
        fineTuneMethod: request.fineTuneMethod,
        hyperparameters: job.hyperparameters,
        gpuRequirements: job.gpuRequirements,
        priority: request.priority ?? 5,
      }, {
        msgID: job.id,
      });
    }

    // Emit event
    this.emitJobEvent({
      type: 'training:job:created',
      jobId: job.id,
      job,
      timestamp: new Date().toISOString(),
    });

    console.log(`[TrainingJobService] Job submitted: ${job.id}`);
    return job;
  }

  /**
   * Submit a sim_rl training job (TASK-172.C). Trains an RL navigation policy
   * in a twin-derived MuJoCo scene rather than fine-tuning on a dataset.
   * Carries a SimScene id; the goal is baked into the scene's MJCF. Claimed
   * over HTTP by the `sim-trainer` worker (kinds:['sim_rl']) — no NATS enqueue.
   */
  async submitSimRlJob(request: SubmitSimRlJobRequest): Promise<TrainingJob> {
    if (!request.sceneId) {
      throw new Error('sceneId is required for a sim_rl job');
    }
    // Validate the scene exists — it IS the RL environment.
    const scene = await simSceneRepository.findById(request.sceneId);
    if (!scene) {
      throw new Error(`Sim scene not found: ${request.sceneId}`);
    }

    const hyperparameters: Hyperparameters = {
      ...DEFAULT_HYPERPARAMETERS,
      ...request.hyperparameters,
    };
    const gpuRequirements: GpuRequirements = {
      ...DEFAULT_GPU_REQUIREMENTS,
      ...request.gpuRequirements,
    };

    const job = await trainingJobRepository.create({
      kind: 'sim_rl',
      sceneId: scene.id,
      twinId: scene.twinId,
      hyperparameters,
      gpuRequirements,
      totalEpochs: request.totalEpochs ?? hyperparameters.epochs,
    });

    this.emitJobEvent({
      type: 'training:job:created',
      jobId: job.id,
      job,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[TrainingJobService] sim_rl job submitted: ${job.id} (scene=${scene.id})`,
    );
    return job;
  }

  /**
   * Submit a reward_model job (TASK-179 §3). Scores dataset episodes with a
   * LeRobot 0.6.0 reward model (Robometer/TOPReward). `baseModel` mirrors the
   * rewardType; claimed over HTTP by workers whose `kinds` include
   * 'reward_model' — no NATS enqueue, no ModelVersion on completion.
   */
  async submitRewardModelJob(request: SubmitRewardModelJobRequest): Promise<TrainingJob> {
    const dataset = await datasetRepository.findById(request.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${request.datasetId}`);
    }
    if (dataset.status !== 'ready') {
      throw new Error(`Dataset not ready: ${request.datasetId} (status: ${dataset.status})`);
    }

    const hyperparameters: RewardModelHyperparameters = {
      rewardType: request.rewardType,
      ...(request.episodes !== undefined ? { episodes: request.episodes } : {}),
      ...(request.task !== undefined ? { task: request.task } : {}),
      ...(request.imageKey !== undefined ? { imageKey: request.imageKey } : {}),
      ...(request.maxFrames !== undefined ? { maxFrames: request.maxFrames } : {}),
    };

    const job = await trainingJobRepository.create({
      kind: 'reward_model',
      datasetId: request.datasetId,
      baseModel: request.rewardType,
      hyperparameters,
    });

    this.emitJobEvent({
      type: 'training:job:created',
      jobId: job.id,
      job,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[TrainingJobService] reward_model job submitted: ${job.id} (dataset=${request.datasetId}, rewardType=${request.rewardType})`,
    );
    return job;
  }

  /**
   * Submit an annotate job (TASK-179 §4). Auto-fills timestamped subtasks /
   * VQA pairs for a dataset via lerobot-annotate. Claimed over HTTP like
   * reward_model jobs; results land on Dataset.annotationsJson.
   */
  async submitAnnotateJob(request: SubmitAnnotateJobRequest): Promise<TrainingJob> {
    const dataset = await datasetRepository.findById(request.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${request.datasetId}`);
    }
    if (dataset.status !== 'ready') {
      throw new Error(`Dataset not ready: ${request.datasetId} (status: ${dataset.status})`);
    }

    const hyperparameters: AnnotateHyperparameters = {
      ...(request.episodes !== undefined ? { episodes: request.episodes } : {}),
    };

    const job = await trainingJobRepository.create({
      kind: 'annotate',
      datasetId: request.datasetId,
      baseModel: 'lerobot-annotate',
      hyperparameters,
    });

    this.emitJobEvent({
      type: 'training:job:created',
      jobId: job.id,
      job,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[TrainingJobService] annotate job submitted: ${job.id} (dataset=${request.datasetId})`,
    );
    return job;
  }

  // ============================================================================
  // JOB LIFECYCLE
  // ============================================================================

  /**
   * Get a job by ID
   */
  async getJob(id: string): Promise<TrainingJob | null> {
    return await trainingJobRepository.findById(id);
  }

  /**
   * Get a job with current progress
   */
  async getJobWithProgress(id: string): Promise<{ job: TrainingJob; progress: JobProgress | null } | null> {
    const job = await trainingJobRepository.findById(id);
    if (!job) {
      return null;
    }

    let progress: JobProgress | null = null;
    if (this.jobQueue) {
      progress = await this.jobQueue.getJobProgress(id);
    }

    return { job, progress };
  }

  /**
   * Cancel a job
   */
  async cancelJob(id: string): Promise<TrainingJob | null> {
    const job = await trainingJobRepository.findById(id);
    if (!job) {
      return null;
    }

    // Can only cancel pending or running jobs
    if (!['pending', 'queued', 'running'].includes(job.status)) {
      throw new Error(`Cannot cancel job with status: ${job.status}`);
    }

    // Signal cancellation to queue
    if (this.jobQueue) {
      await this.jobQueue.cancelJob(id);
    }

    // Update job status in database
    const updatedJob = await trainingJobRepository.update(id, {
      status: 'cancelled',
    });

    if (updatedJob) {
      this.emitJobEvent({
        type: 'training:job:cancelled',
        jobId: id,
        job: updatedJob,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[TrainingJobService] Job cancelled: ${id}`);
    return updatedJob;
  }

  /**
   * Retry a failed job
   */
  async retryJob(id: string): Promise<TrainingJob | null> {
    const job = await trainingJobRepository.findById(id);
    if (!job) {
      return null;
    }

    // Can only retry failed or cancelled jobs
    if (!['failed', 'cancelled'].includes(job.status)) {
      throw new Error(`Cannot retry job with status: ${job.status}`);
    }

    // Reset job status. Explicit nulls: the repository skips undefined
    // fields, which used to leave the failed run's errorMessage and
    // timestamps visible on the retried (pending/running) job.
    const updatedJob = await trainingJobRepository.update(id, {
      status: 'pending',
      progress: 0,
      currentEpoch: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      // Fresh metrics too — otherwise the retried run's loss curve is
      // appended to the failed run's points and the chart shows both.
      metrics: {},
    });

    // Non-supervised jobs (sim_rl, reward_model, annotate — and any job
    // missing the supervised fields) are re-claimed by their HTTP worker via
    // status='pending'; they have no NATS finetune payload.
    if (
      !updatedJob ||
      !this.jobQueue ||
      (updatedJob.kind ?? 'supervised') !== 'supervised' ||
      !updatedJob.datasetId ||
      !updatedJob.baseModel ||
      !updatedJob.fineTuneMethod
    ) {
      return updatedJob;
    }

    // Re-add to queue (supervised jobs only carry real base models)
    await this.jobQueue.addJob('finetune', {
      jobId: updatedJob.id,
      datasetId: updatedJob.datasetId,
      baseModel: updatedJob.baseModel as BaseModel,
      fineTuneMethod: updatedJob.fineTuneMethod,
      hyperparameters: updatedJob.hyperparameters,
      gpuRequirements: updatedJob.gpuRequirements,
      priority: 5,
    }, {
      msgID: `${updatedJob.id}-retry-${Date.now()}`,
    });

    this.emitJobEvent({
      type: 'training:job:created',
      jobId: id,
      job: updatedJob,
      timestamp: new Date().toISOString(),
    });

    console.log(`[TrainingJobService] Job retried: ${id}`);
    return updatedJob;
  }

  // ============================================================================
  // JOB LISTING
  // ============================================================================

  /**
   * Get jobs with filtering and pagination
   */
  async getJobs(params?: TrainingJobQueryParams): Promise<PaginatedResult<TrainingJob>> {
    return await trainingJobRepository.findAll(params);
  }

  /**
   * Get active jobs (pending, queued, or running)
   */
  async getActiveJobs(): Promise<TrainingJob[]> {
    const result = await trainingJobRepository.findAll({
      status: ['pending', 'queued', 'running'],
      pageSize: 100,
    });
    return result.data;
  }

  // ============================================================================
  // QUEUE STATUS
  // ============================================================================

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats | null> {
    // Job-status counts always come from the DB: the HTTP claim worker drives
    // the job lifecycle through the DB whether or not JetStream is connected
    // (the NATS stream is only a delivery channel — its cursor counts are not
    // job states, and its shape lacks queued/completed_24h, which left those
    // stats blank in the UI whenever NATS was up). JetStream, when present,
    // contributes only the stream diagnostics.
    // COUNT queries only — never load/JSON-parse every completed & failed job
    // (which grows unbounded and is polled frequently by the UI).
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pending, queued, running, completed, failed, completed24h] = await Promise.all([
      trainingJobRepository.countByStatus('pending'),
      trainingJobRepository.countByStatus('queued'),
      trainingJobRepository.countByStatus('running'),
      trainingJobRepository.countByStatus('completed'),
      trainingJobRepository.countByStatus('failed'),
      trainingJobRepository.countCompletedSince(dayAgo),
    ]);

    let streamInfo: QueueStats['streamInfo'] = {
      messages: 0, bytes: 0, firstSeq: 0, lastSeq: 0, consumerCount: 0,
    };
    if (this.jobQueue) {
      try {
        streamInfo = (await this.jobQueue.getQueueStats()).streamInfo;
      } catch {
        // JetStream hiccup — keep the zeroed diagnostics, counts stay valid
      }
    }

    return {
      pending,
      queued,
      running,
      completed,
      completed_24h: completed24h,
      failed,
      streamInfo,
    };
  }

  // ============================================================================
  // PROGRESS WATCHING
  // ============================================================================

  /**
   * Watch job progress for real-time updates
   */
  async watchJobProgress(jobId: string, callback: (progress: JobProgress | null) => void): Promise<() => void> {
    if (!this.jobQueue) {
      throw new Error('TrainingJobService not initialized');
    }

    // Stop existing watcher if any
    const existingWatcher = this.progressWatchers.get(jobId);
    if (existingWatcher) {
      existingWatcher();
    }

    const stopWatch = await this.jobQueue.watchJobProgress(jobId, callback);
    this.progressWatchers.set(jobId, stopWatch);

    return () => {
      stopWatch();
      this.progressWatchers.delete(jobId);
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Subscribe to job events
   */
  onJobEvent(handler: TrainingJobEventCallback): () => void {
    this.on('job:event', handler);
    return () => this.off('job:event', handler);
  }

  /**
   * Emit a job event
   */
  private emitJobEvent(event: TrainingJobEvent): void {
    this.emit('job:event', event);
    this.emit(event.type, event);
  }

  /**
   * Update job status and emit event
   */
  async updateJobStatus(
    jobId: string,
    status: TrainingJobStatus,
    updates?: Partial<TrainingJob>
  ): Promise<TrainingJob | null> {
    const job = await trainingJobRepository.update(jobId, {
      status,
      ...updates,
    });

    if (job) {
      let eventType: TrainingJobEventType;
      switch (status) {
        case 'running':
          eventType = 'training:job:started';
          break;
        case 'completed':
          eventType = 'training:job:completed';
          break;
        case 'failed':
          eventType = 'training:job:failed';
          break;
        case 'cancelled':
          eventType = 'training:job:cancelled';
          break;
        default:
          eventType = 'training:job:progress';
      }

      this.emitJobEvent({
        type: eventType,
        jobId,
        job,
        error: updates?.errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    return job;
  }

  /**
   * Emit progress event
   */
  emitProgressEvent(jobId: string, progress: JobProgress): void {
    this.emitJobEvent({
      type: 'training:job:progress',
      jobId,
      progress,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Stop all progress watchers
   */
  stopAllWatchers(): void {
    for (const [jobId, stopWatch] of this.progressWatchers) {
      stopWatch();
    }
    this.progressWatchers.clear();
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const trainingJobService = TrainingJobService.getInstance();

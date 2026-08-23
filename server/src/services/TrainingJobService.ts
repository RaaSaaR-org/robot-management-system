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
import type {
  CompatibilityReport,
  MixtureMemberInput,
  TrainingJobDatasetRef,
} from '../types/mixture.types.js';
import { analyzeDatasetIds, MixtureIncompatibleError } from './lerobot/datasetCompatibility.js';
import { prisma } from '../database/index.js';

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
// DATASET MIXTURES (TASK-220)
// ============================================================================

/**
 * The mixture half of a submission, kept beside `SubmitTrainingJobRequest`
 * rather than inside it: a job that names one dataset is still the common case
 * and its request shape is unchanged, `datasetId` and all.
 */
export interface MixtureSubmitFields {
  /** Shorthand for an evenly weighted mixture. */
  datasetIds?: string[];
  /** The same thing with sampling weights. Wins when both are given. */
  mixture?: MixtureMemberInput[];
}

/**
 * A submission, with or without a mixture.
 *
 * `datasetId` becomes OPTIONAL here, which is the whole point of the type: a
 * mixture names its datasets in `mixture`/`datasetIds` and the route already
 * accepts that (`if (!hasMixture && !request.datasetId)`). Left required, every
 * mixture caller had to be written `submitJob({ mixture: [...] } as never)` —
 * and `as never` does not narrow the check, it removes it, so a typo in
 * `fineTuneMethod` or a misspelled `mixtrue` key passed the compiler in exactly
 * the calls that most needed checking. `submitJob` still refuses at runtime
 * when neither is present.
 */
export type SubmitTrainingJobWithMixture =
  Omit<SubmitTrainingJobRequest, 'datasetId'>
  & { datasetId?: string }
  & MixtureSubmitFields;

/**
 * A sampling weight, or a refusal naming the member that carried it.
 *
 * A weight is a ratio, so the only meaningful values are finite and positive.
 * JSON reaches further than that: `1e400` parses to `Infinity` — no exotic
 * client needed, just a number literal — and `Infinity` is a `Float` Postgres
 * stores without complaint. It then survives all the way into the export
 * manifest, where `buildManifest` excludes it from the total (it is not finite)
 * but still divides by it, and `JSON.stringify` renders the result as
 * `"normalizedWeight": null`. A cluster reads a mixture in which one member has
 * no share and the rest sum to 1, and nothing anywhere said no.
 *
 * A negative weight is quieter and worse: it sums, so the totals still look
 * plausible while one member is sampled a negative fraction of the time.
 *
 * Refused here, at the door, rather than defended against in the exporter —
 * there is no reading of a negative or infinite sampling ratio to recover.
 */
function checkedWeight(weight: unknown, datasetId: string): number {
  if (weight === undefined || weight === null) return 1;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
    // `JSON.stringify(Infinity)` is the string "null", which would report the
    // one value most likely to be here as the one thing it is not.
    const shown = typeof weight === 'number' ? String(weight) : JSON.stringify(weight);
    throw new Error(
      `Mixture weight for ${datasetId} must be a positive number; received ${shown}`,
    );
  }
  return weight;
}

/**
 * The members a request asks for, or null when it names a single dataset the
 * old way — which is the signal to leave every existing code path alone.
 */
function resolveMixtureMembers(
  request: SubmitTrainingJobWithMixture,
): MixtureMemberInput[] | null {
  if (request.mixture?.length) {
    return request.mixture.map((m) => ({
      datasetId: m.datasetId,
      weight: checkedWeight(m.weight, m.datasetId),
    }));
  }
  if (request.datasetIds?.length) {
    return request.datasetIds.map((datasetId) => ({ datasetId, weight: 1 }));
  }
  return null;
}

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
  async submitJob(request: SubmitTrainingJobWithMixture): Promise<TrainingJob> {
    const members = resolveMixtureMembers(request);
    // Judged before anything is written. The entire value of the report is that
    // the operator hears "these two do not share an action space" at submission
    // rather than from a data loader six GPU-hours later.
    if (members) {
      const report = await this.checkMixture(members);
      if (report.verdict === 'incompatible') {
        throw new MixtureIncompatibleError(report);
      }
    }
    const primaryDatasetId = members ? members[0].datasetId : request.datasetId;
    // The route checks this too. Repeated here because the route is not the
    // only caller and because `findById(undefined)` does not fail politely —
    // Prisma raises its own argument error, which reaches the operator as an
    // internal message about a `where` clause.
    if (!primaryDatasetId) {
      throw new Error('A training job must name a dataset, either as datasetId or as a mixture');
    }

    // Validate dataset exists and is ready
    const dataset = await datasetRepository.findById(primaryDatasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${primaryDatasetId}`);
    }
    if (dataset.status !== 'ready') {
      throw new Error(`Dataset not ready: ${primaryDatasetId} (status: ${dataset.status})`);
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
      datasetId: primaryDatasetId,
      baseModel: request.baseModel,
      fineTuneMethod: request.fineTuneMethod,
      hyperparameters,
      gpuRequirements,
      totalEpochs: request.totalEpochs ?? hyperparameters.epochs,
    };

    const job = await trainingJobRepository.create(jobInput);

    // Only a real mixture gets rows. A single-dataset job keeps living entirely
    // in `TrainingJob.datasetId`, which is what every existing query, worker and
    // wizard already reads — `getJobDatasets` synthesises the member list for it.
    if (members) {
      await prisma.trainingJobDataset.createMany({
        data: members.map((member, position) => ({
          trainingJobId: job.id,
          datasetId: member.datasetId,
          weight: member.weight ?? 1,
          position,
        })),
      });
    }

    // Add to NATS queue if available. The HTTP claim worker reads jobs
    // directly from the DB (status='pending'), so NATS is optional here.
    // Source the supervised-only fields from `request` (always non-null here)
    // rather than the now-nullable domain `job` fields.
    if (this.jobQueue) {
      await this.jobQueue.addJob('finetune', {
        jobId: job.id,
        datasetId: primaryDatasetId,
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
   * Judge a mixture before a job exists for it.
   *
   * Public because the same report is what the compatibility endpoint returns
   * and what the wizard shows; submission must not be able to apply a rule the
   * preview did not.
   */
  async checkMixture(members: MixtureMemberInput[]): Promise<CompatibilityReport> {
    return await analyzeDatasetIds(members.map((m) => m.datasetId));
  }

  /**
   * The mixture behind a job, always as a list.
   *
   * A job created before mixtures existed — and every single-dataset job since —
   * has no `TrainingJobDataset` rows, so one member is synthesised from
   * `datasetId`. Callers therefore never have to branch on which kind of job
   * they are holding, which is the only reason this returns a list for a job
   * that names one dataset.
   */
  async getJobDatasets(
    jobId: string,
    datasetId: string | null,
  ): Promise<TrainingJobDatasetRef[]> {
    const rows = await prisma.trainingJobDataset.findMany({
      where: { trainingJobId: jobId },
      orderBy: { position: 'asc' },
      include: { dataset: { select: { name: true } } },
    });
    if (rows.length > 0) {
      return rows.map((row) => ({
        datasetId: row.datasetId,
        name: row.dataset?.name ?? row.datasetId,
        weight: row.weight,
        position: row.position,
      }));
    }
    if (!datasetId) return [];
    const dataset = await datasetRepository.findById(datasetId);
    return [{
      datasetId,
      name: dataset?.name ?? datasetId,
      weight: 1,
      position: 0,
    }];
  }

  /** `getJobDatasets` for a page of jobs, in one query instead of one per job. */
  async getJobDatasetsForJobs(
    jobs: Array<{ id: string; datasetId: string | null }>,
  ): Promise<Map<string, TrainingJobDatasetRef[]>> {
    const byJob = new Map<string, TrainingJobDatasetRef[]>();
    if (jobs.length === 0) return byJob;

    const rows = await prisma.trainingJobDataset.findMany({
      where: { trainingJobId: { in: jobs.map((j) => j.id) } },
      orderBy: { position: 'asc' },
      include: { dataset: { select: { name: true } } },
    });
    for (const row of rows) {
      const list = byJob.get(row.trainingJobId) ?? [];
      list.push({
        datasetId: row.datasetId,
        name: row.dataset?.name ?? row.datasetId,
        weight: row.weight,
        position: row.position,
      });
      byJob.set(row.trainingJobId, list);
    }

    // The single-dataset jobs still need their one synthetic member, and their
    // names come from one more query rather than one per job.
    const soloIds = jobs
      .filter((job) => !byJob.has(job.id) && job.datasetId)
      .map((job) => job.datasetId as string);
    const names = soloIds.length
      ? new Map(
          (await prisma.dataset.findMany({
            where: { id: { in: [...new Set(soloIds)] } },
            select: { id: true, name: true },
          })).map((d) => [d.id, d.name]),
        )
      : new Map<string, string>();
    for (const job of jobs) {
      if (byJob.has(job.id)) continue;
      byJob.set(
        job.id,
        job.datasetId
          ? [{
              datasetId: job.datasetId,
              name: names.get(job.datasetId) ?? job.datasetId,
              weight: 1,
              position: 0,
            }]
          : [],
      );
    }
    return byJob;
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

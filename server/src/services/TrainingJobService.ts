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
  modelVersionRepository,
  modelCheckpointRepository,
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
  TrainingInitFrom,
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
import { datasetViewService, isDatasetView } from './DatasetViewService.js';
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
  & MixtureSubmitFields
  & InitFromSubmitFields;

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
// STARTING FROM AN EXISTING MODEL (TASK-239)
// ============================================================================

/**
 * The "continue from" half of a submission, beside the mixture half for the
 * same reason: a run that starts from one of the six foundation models is
 * still the common case and its request shape is unchanged.
 *
 * At most one of the two may be set. They are not interchangeable — a
 * ModelVersion is a finished artifact, a ModelCheckpoint is one epoch of a run
 * that may still be going — and a run that named both would be a run nobody
 * can say what it started from.
 */
export interface InitFromSubmitFields {
  initFromModelVersionId?: string | null;
  initFromCheckpointId?: string | null;
}

/** The pair as it is persisted: normalised to nulls, never undefined. */
interface InitFromColumns {
  initFromModelVersionId: string | null;
  initFromCheckpointId: string | null;
}

/**
 * One submitted id, or null when the field was not used.
 *
 * The body is JSON off the wire: `null`, `''` and an absent key all mean "not
 * starting from anything", while a number or an object means the caller is
 * confused about the field. Refused by name rather than reaching Prisma as a
 * `where` clause it cannot build.
 */
function readInitFromId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${field} must be an id string, or null to start from the base model.`);
  }
  return value.trim() || null;
}

/**
 * A submission's starting weights, refused where the operator cannot rescue it.
 *
 * The base-model rule is the one worth spelling out: `baseModel` decides which
 * trainer the worker starts and what the architecture of the resulting weights
 * is, so initialising a `pi0` run from GR00T weights is not a run that trains
 * badly — it is a run that cannot load its own starting point. There is no
 * decision at submission time that saves it, which is exactly the line
 * `CompatibilityAxis.verdict === 'blocking'` draws for datasets, so it is
 * refused here in one sentence a 400 can quote.
 *
 * A model the registry cannot attribute to a base model — an imported
 * checkpoint has no TrainingJob on this server — is ALLOWED through. The check
 * compares what is recorded; inventing a verdict from a missing record would
 * block the registered-GR00T-checkpoint case this feature exists to serve.
 */
async function checkInitFrom(
  request: InitFromSubmitFields,
  baseModel: string | null | undefined,
): Promise<InitFromColumns> {
  const modelVersionId = readInitFromId(request.initFromModelVersionId, 'initFromModelVersionId');
  const checkpointId = readInitFromId(request.initFromCheckpointId, 'initFromCheckpointId');

  if (modelVersionId && checkpointId) {
    throw new Error(
      'A run starts from one set of weights: pass either initFromModelVersionId or '
      + 'initFromCheckpointId, not both.',
    );
  }

  if (modelVersionId) {
    const model = await modelVersionRepository.findByIdWithRelations(modelVersionId);
    if (!model) {
      throw new Error(`Model version not found: ${modelVersionId}`);
    }
    const modelBaseModel = model.trainingJob?.baseModel ?? null;
    if (modelBaseModel && baseModel && modelBaseModel !== baseModel) {
      throw new Error(
        `This run trains ${baseModel} but "${model.name ?? model.version}" holds `
        + `${modelBaseModel} weights, so it cannot start from that model.`,
      );
    }
    return { initFromModelVersionId: modelVersionId, initFromCheckpointId: null };
  }

  if (checkpointId) {
    const checkpoint = await modelCheckpointRepository.findById(checkpointId);
    if (!checkpoint) {
      throw new Error(`Model checkpoint not found: ${checkpointId}`);
    }
    // A checkpoint carries no architecture of its own — the run that wrote it
    // does. Same rule as above, and the same reason: these weights load into
    // one architecture only.
    const sourceJob = await trainingJobRepository.findById(checkpoint.trainingJobId);
    const sourceBaseModel = sourceJob?.baseModel ?? null;
    if (sourceBaseModel && baseModel && sourceBaseModel !== baseModel) {
      throw new Error(
        `This run trains ${baseModel} but checkpoint epoch ${checkpoint.epoch} was written by a `
        + `${sourceBaseModel} run, so it cannot start from that checkpoint.`,
      );
    }
    return { initFromModelVersionId: null, initFromCheckpointId: checkpointId };
  }

  return { initFromModelVersionId: null, initFromCheckpointId: null };
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

    // Where the weights start from (TASK-239). Judged before the row is
    // written, for the same reason the mixture is: an unloadable starting
    // point is a refusal, not a run that fails on the GPU an hour later. Both
    // fields absent is the ordinary case and produces two nulls.
    const initFrom = await checkInitFrom(request, request.baseModel);

    // Pin every view this job cites, BEFORE the job row exists (TASK-240).
    //
    // A view is an episode selection over another dataset, and a selection
    // that can still be edited after a run has trained on it makes the run's
    // report a claim about data nobody can reconstruct. Freezing is not
    // destructive — it only forbids edits — so doing it before the row is
    // written is the safe order: a submission that then fails leaves a view
    // pinned to a selection nobody can quietly change, which is the state it
    // should have been in anyway.
    await this.freezeCitedViews(
      members ? members.map((m) => m.datasetId) : [primaryDatasetId],
    );

    // Create job in database
    const jobInput: CreateTrainingJobInput = {
      datasetId: primaryDatasetId,
      baseModel: request.baseModel,
      fineTuneMethod: request.fineTuneMethod,
      hyperparameters,
      gpuRequirements,
      totalEpochs: request.totalEpochs ?? hyperparameters.epochs,
      ...initFrom,
    };

    const job = await trainingJobRepository.create(jobInput);

    // Only a real mixture gets rows. A single-dataset job keeps living entirely
    // in `TrainingJob.datasetId`, which is what every existing query, worker and
    // wizard already reads — `getJobDatasets` synthesises the member list for it.
    if (members) {
      try {
        await prisma.trainingJobDataset.createMany({
          data: members.map((member, position) => ({
            trainingJobId: job.id,
            datasetId: member.datasetId,
            weight: member.weight ?? 1,
            position,
          })),
        });
      } catch (error) {
        // The job row already exists at this point, and a job with no member
        // rows is INDISTINGUISHABLE from an ordinary single-dataset job —
        // `getJobDatasets` synthesises one member from `datasetId` precisely so
        // callers never have to branch. So a half-written mixture would not
        // look broken: it would look like a job on one dataset, be claimed as
        // one, train as one, and report success. Undone rather than left, and
        // the failure is raised so the caller sees a refusal instead of a job.
        //
        // Deleting the job cascades any rows that did land
        // (TrainingJobDataset.trainingJobId is ON DELETE CASCADE).
        await trainingJobRepository.delete(job.id).catch((cleanupError) => {
          console.error(
            `[TrainingJobService] Job ${job.id} has no mixture rows and could not be removed:`,
            cleanupError,
          );
        });
        throw error;
      }
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
   * Freeze every cited dataset that is a view. (TASK-240)
   *
   * One query decides which of the cited ids are views, so an ordinary job on
   * ordinary datasets pays for exactly one indexed read and no walk at all —
   * and the answer comes off the `kind` column, which is the only thing that
   * says what a row is. `freeze` then pins the whole ancestor chain of each,
   * because editing the PARENT of a cited view changes what the cited view
   * resolves to just as surely as editing the view itself.
   *
   * Not caught: a freeze that fails has left a run able to cite data that can
   * still be changed underneath it, and the submission is refused instead.
   */
  private async freezeCitedViews(datasetIds: string[]): Promise<void> {
    const ids = [...new Set(datasetIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return;
    const rows = (await prisma.dataset.findMany({
      where: { id: { in: ids }, kind: 'view' },
      select: { id: true, kind: true },
    })) as Array<{ id: string; kind: string }>;
    for (const row of rows ?? []) {
      // The `where` already asked for views; asked again off the row because
      // `kind` is what decides, and one place deciding it is the point.
      if (!isDatasetView(row)) continue;
      await datasetViewService.freeze(row.id);
    }
  }

  /**
   * What a job starts from, resolved to an artifact a worker can fetch, or
   * null when it starts from its foundation `baseModel`. (TASK-239)
   *
   * The URI is read at claim/export time rather than copied onto the job row
   * when it was submitted, so a re-registered artifact is not served from a
   * stale copy — the referenced row is the single place the location lives.
   *
   * Returns null, never throws, when the referenced row has gone: a job whose
   * starting model was deleted must still be claimable and still exportable,
   * and `initFromModelVersionId` on the job says what it named.
   */
  async resolveInitFrom(job: {
    initFromModelVersionId?: string | null;
    initFromCheckpointId?: string | null;
  }): Promise<TrainingInitFrom | null> {
    if (job.initFromModelVersionId) {
      const model = await modelVersionRepository.findById(job.initFromModelVersionId);
      if (!model) return null;
      return { artifactUri: model.artifactUri, kind: 'model', id: model.id };
    }
    if (job.initFromCheckpointId) {
      const checkpoint = await modelCheckpointRepository.findById(job.initFromCheckpointId);
      if (!checkpoint) return null;
      return {
        artifactUri: checkpoint.uri,
        kind: 'checkpoint',
        id: checkpoint.id,
        epoch: checkpoint.epoch,
      };
    }
    return null;
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

    // A reward job reads this dataset's episodes, so a view it cites is pinned
    // for the same reason a training run's is (TASK-240).
    await this.freezeCitedViews([request.datasetId]);

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

    // Same as reward_model: an annotate job reads the cited episodes.
    await this.freezeCitedViews([request.datasetId]);

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

/**
 * @file DatasetService.ts
 * @description Service for managing VLA training datasets with LeRobot v3 format support
 * @feature datasets
 */

import { createWriteStream, existsSync } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  datasetRepository,
  robotTypeRepository,
  skillDefinitionRepository,
} from '../repositories/index.js';
import { modelStorage, BUCKETS } from '../storage/model-storage.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';
import { DatasetStoreError, openDatasetTree } from './lerobot/DatasetTree.js';

/**
 * What a validation run concluded (TASK-217 review).
 *
 * `unavailable` is the one the caller must not turn into `status: 'failed'` —
 * the store could not be reached, so the dataset was never looked at.
 */
export type ValidationOutcome = 'ready' | 'failed' | 'unavailable';
import { ExtractError, extractDatasetArchive } from './lerobot/extractArchive.js';
import { validateDatasetStructure } from './lerobot/validateDataset.js';
import type { DatasetStructureReport, ExpectedDimensions } from './lerobot/validateDataset.js';
import { natsClient } from '../messaging/index.js';
import { kvPut, kvGet, KV_STORE_NAMES } from '../messaging/kv-stores.js';
import type { KV } from 'nats';
import type {
  Dataset,
  DatasetStatus,
  CreateDatasetInput,
  UpdateDatasetInput,
  DatasetQueryParams,
  PaginatedResult,
  LeRobotInfo,
  LeRobotStats,
  EpisodeAnnotation,
} from '../types/vla.types.js';
import type {
  CreateDatasetDto,
  UpdateDatasetDto,
  DatasetListQuery,
  DatasetResponse,
  DatasetListResponse,
  QualityScoreBreakdown,
  DatasetValidationResult,
  DatasetValidationProgress,
  InitiateUploadResponse,
  DatasetStatsResponse,
  DatasetEvent,
  DatasetEventCallback,
  LeRobotInfoV3,
  LeRobotStatsV3,
} from '../types/dataset.types.js';
import { QUALITY_THRESHOLDS } from '../types/dataset.types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DATASET_VALIDATION_SUBJECT = 'jobs.dataset.validate';
const DATASET_STATS_SUBJECT = 'jobs.dataset.compute-stats';
const DATASET_PROGRESS_KV_PREFIX = 'dataset.progress.';

/**
 * The object version an upload is presigned against, and the key it lands on.
 *
 * `modelStorage.getDatasetKey` builds `<name>/<version>/data.bin`, so this is
 * the ONE place that string is decided. It used to be decided in three.
 */
const UPLOAD_VERSION = 'upload';
function uploadObjectKey(id: string): string {
  return `${id}/${UPLOAD_VERSION}/data.bin`;
}

/**
 * The extension handed to `tar`, which dispatches on it.
 *
 * `.tar.gz` covers the modal's `.tar.gz` and `.tgz`; a plain `.tar` and a
 * `.zip` are both read by bsdtar regardless of the name, and gzip detection is
 * by magic number, so this is a hint rather than a contract.
 */
function uploadExtension(_id: string): string {
  return '.tar.gz';
}

/** Where uploaded datasets are unpacked. A volume, in a real deployment. */
function uploadRoot(): string {
  const configured = process.env.DATASET_UPLOAD_DIR;
  if (configured) return resolvePath(configured);
  return resolvePath(dirname(fileURLToPath(import.meta.url)), '../../data/uploaded-datasets');
}

// Quality scoring thresholds. Re-exported from the types module rather than
// declared twice: the same four numbers used to live here AND in
// `dataset.types.ts`, and nothing kept them equal.
const QUALITY = QUALITY_THRESHOLDS;

// ============================================================================
// DATASET SERVICE
// ============================================================================

/**
 * Service for managing VLA training datasets
 */
export class DatasetService extends EventEmitter {
  private static instance: DatasetService;
  private initialized = false;
  private progressKV: KV | null = null;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DatasetService {
    if (!DatasetService.instance) {
      DatasetService.instance = new DatasetService();
    }
    return DatasetService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Get progress KV store if NATS is connected
    if (natsClient.isConnected()) {
      try {
        this.progressKV = await natsClient.getKV(KV_STORE_NAMES.JOB_PROGRESS);
      } catch (error) {
        console.warn('[DatasetService] Could not get progress KV store:', error);
      }
    }

    this.initialized = true;
    console.log('[DatasetService] Initialized');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new dataset record
   */
  async create(dto: CreateDatasetDto): Promise<DatasetResponse> {
    // robotTypeId is required
    if (!dto.robotTypeId) {
      throw new Error('robotTypeId is required');
    }

    // Validate robotTypeId exists
    const robotType = await robotTypeRepository.findById(dto.robotTypeId);
    if (!robotType) {
      throw new Error(`Robot type not found: ${dto.robotTypeId}`);
    }

    // Validate skillId if provided
    if (dto.skillId) {
      const skill = await skillDefinitionRepository.findById(dto.skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${dto.skillId}`);
      }
    }

    // Two very different things share this door.
    //
    // Without `storagePath`: mint an empty dataset and a prefix to upload into.
    // Everything is zero because nothing has been uploaded yet, and `uploading`
    // is the honest status.
    //
    // With `storagePath`: something already produced a dataset — the robot's
    // own episode recorder (TASK-215), a curation run, a converter — and this
    // is a registration, not a reservation. Zeroing fps and frame counts here
    // would throw away numbers the caller measured, and calling it `uploading`
    // would leave a finished dataset waiting forever for an upload that is not
    // coming.
    const registering = typeof dto.storagePath === 'string' && dto.storagePath.trim().length > 0;
    const storagePath = registering ? dto.storagePath!.trim() : `${uuidv4()}/`;

    // A registration says "there is already a dataset here". Take the claim
    // seriously for a LOCAL path, which this server can check: a row marked
    // `ready` pointing at an empty or missing directory is a dataset that
    // appears in the list, offers itself for training, and fails hours later
    // inside a job. A RustFS prefix is not checkable from here and is taken on
    // trust, exactly as `exportToLeRobot` already does.
    if (registering && isAbsolute(storagePath)) {
      if (!existsSync(storagePath)) {
        throw new Error(`storagePath does not exist: ${storagePath}`);
      }
      if (!existsSync(join(storagePath, 'meta', 'info.json'))) {
        throw new Error(
          `storagePath is not a LeRobot dataset — no meta/info.json under ${storagePath}`
        );
      }
    }

    const input: CreateDatasetInput = {
      name: dto.name,
      description: dto.description,
      robotTypeId: dto.robotTypeId,
      skillId: dto.skillId,
      storagePath,
      lerobotVersion: dto.lerobotVersion ?? 'v3.0',
      fps: registering ? (dto.fps ?? 0) : 0,
      totalFrames: registering ? (dto.totalFrames ?? 0) : 0,
      totalDuration: registering ? (dto.totalDuration ?? 0) : 0,
      demonstrationCount: registering ? (dto.demonstrationCount ?? 0) : 0,
      status: registering ? 'ready' : 'uploading',
      ...(registering && dto.infoJson
        ? { infoJson: dto.infoJson as unknown as CreateDatasetInput['infoJson'] }
        : {}),
    };

    const dataset = await datasetRepository.create(input);
    const response = await this.toResponse(dataset);

    // Emit event
    this.emitEvent({
      type: 'dataset:created',
      datasetId: dataset.id,
      dataset: response,
      timestamp: new Date().toISOString(),
    });

    console.log(`[DatasetService] Dataset created: ${dataset.id}`);
    return response;
  }

  /**
   * Get a dataset by ID
   */
  async get(id: string): Promise<DatasetResponse | null> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      return null;
    }
    return this.toResponse(dataset);
  }

  /**
   * Get the VLM annotations of a dataset (lerobot-annotate, TASK-179 §4).
   * Returns null when the dataset does not exist.
   */
  async getAnnotations(id: string): Promise<EpisodeAnnotation[] | null> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      return null;
    }
    return dataset.annotations ?? [];
  }

  /**
   * List datasets with filtering and pagination
   */
  async list(query: DatasetListQuery): Promise<DatasetListResponse> {
    const params: DatasetQueryParams = {
      robotTypeId: query.robotTypeId,
      skillId: query.skillId,
      status: query.status,
      minQualityScore: query.minQuality,
      page: query.page ?? 1,
      pageSize: query.limit ?? 20,
    };

    const result = await datasetRepository.findAll(params);

    const data = await Promise.all(result.data.map((d) => this.toResponse(d)));

    return {
      data,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.pageSize,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
      },
    };
  }

  /**
   * Update dataset metadata
   */
  async update(id: string, dto: UpdateDatasetDto): Promise<DatasetResponse | null> {
    const existing = await datasetRepository.findById(id);
    if (!existing) {
      return null;
    }

    // Validate skillId if provided
    if (dto.skillId) {
      const skill = await skillDefinitionRepository.findById(dto.skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${dto.skillId}`);
      }
    }

    const updateInput: UpdateDatasetInput = {
      name: dto.name,
      description: dto.description,
      skillId: dto.skillId,
      huggingFaceRepoId: dto.huggingFaceRepoId,
    };

    const updated = await datasetRepository.update(id, updateInput);
    if (!updated) {
      return null;
    }

    const response = await this.toResponse(updated);

    // Emit event
    this.emitEvent({
      type: 'dataset:updated',
      datasetId: id,
      dataset: response,
      timestamp: new Date().toISOString(),
    });

    return response;
  }

  /**
   * Delete a dataset (DB record + storage)
   */
  async delete(id: string): Promise<boolean> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      return false;
    }

    // Delete from storage if RustFS is available.
    //
    // Both versions, because an uploaded dataset's archive lives under
    // `<id>/upload/data.bin` since TASK-217 and the delete still asked for
    // `<id>/latest/data.bin` — so every uploaded dataset ever deleted left its
    // full archive in the bucket, paid for forever.
    if (isRustFSInitialized() && dataset.storagePath) {
      for (const version of ['latest', UPLOAD_VERSION]) {
        try {
          await modelStorage.deleteDataset(id, version);
        } catch (error) {
          console.warn(`[DatasetService] Failed to delete ${version} storage for ${id}:`, error);
        }
      }
    }

    // And the unpacked tree, which `unpackUploadedArchive` wrote to local disk
    // and nothing else ever removes.
    try {
      await rm(join(uploadRoot(), id), { recursive: true, force: true });
    } catch (error) {
      console.warn(`[DatasetService] Failed to remove the unpacked upload for ${id}:`, error);
    }

    // Delete from database
    const deleted = await datasetRepository.delete(id);

    if (deleted) {
      // Emit event
      this.emitEvent({
        type: 'dataset:deleted',
        datasetId: id,
        timestamp: new Date().toISOString(),
      });

      console.log(`[DatasetService] Dataset deleted: ${id}`);
    }

    return deleted;
  }

  // ============================================================================
  // UPLOAD WORKFLOW
  // ============================================================================

  /**
   * Initiate dataset upload - get presigned URL
   */
  async initiateUpload(
    id: string,
    contentType = 'application/octet-stream',
    size?: number
  ): Promise<InitiateUploadResponse> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    if (dataset.status !== 'uploading') {
      throw new Error(`Dataset upload already completed or in progress: ${id}`);
    }

    if (!isRustFSInitialized()) {
      throw new Error('Storage service not available');
    }

    // ONE key, named once. These were three different strings: the presigned
    // URL wrote `<id>/latest/data.bin` (`modelStorage.getDatasetKey`), the
    // response told the caller the object was `<id>/data.tar.gz`, and
    // `validateStructure` then looked for `<id>/meta/info.json` — an unpacked
    // tree nothing ever unpacked. The modal's only possible outcome was
    // `failed`. `completeUpload` now extracts what was actually uploaded.
    const uploadUrl = await modelStorage.getDatasetUploadUrl(id, UPLOAD_VERSION, contentType);

    // Emit event
    this.emitEvent({
      type: 'dataset:upload:initiated',
      datasetId: id,
      timestamp: new Date().toISOString(),
    });

    return {
      uploadUrl,
      expiresIn: 3600, // 1 hour
      storagePath: uploadObjectKey(id),
    };
  }

  /**
   * Complete dataset upload - trigger validation
   */
  async completeUpload(id: string): Promise<void> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    if (dataset.status !== 'uploading') {
      throw new Error(`Dataset not in uploading state: ${id} (status: ${dataset.status})`);
    }

    // Update status to validating
    await datasetRepository.update(id, { status: 'validating' });

    // Emit upload completed event
    this.emitEvent({
      type: 'dataset:upload:completed',
      datasetId: id,
      timestamp: new Date().toISOString(),
    });

    // Unpack what was uploaded, before anything tries to read it as a tree.
    let storagePath = dataset.storagePath;
    try {
      storagePath = await this.unpackUploadedArchive(id);
    } catch (error) {
      const code = error instanceof ExtractError ? error.code : 'UNPACK_FAILED';
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[DatasetService] Unpacking upload for ${id} failed: ${code}: ${detail}`);
      await datasetRepository.update(id, { status: 'failed' });
      await this.updateValidationProgress(id, {
        datasetId: id,
        status: 'failed',
        progress: 100,
        message: 'Could not unpack the uploaded archive',
        errors: [`${code}: ${detail}`],
      });
      this.emitEvent({
        type: 'dataset:validation:failed',
        datasetId: id,
        error: `${code}: ${detail}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Queue validation job if NATS is available
    if (natsClient.isConnected()) {
      await this.queueValidationJob(id, storagePath);
    } else {
      // If NATS not available, run validation synchronously (for development)
      console.log(`[DatasetService] NATS not available, running validation synchronously for ${id}`);
      await this.validateAndUpdateDataset(id, storagePath);
    }
  }

  /**
   * Download the uploaded archive, unpack it, and put the tree where the
   * readers look.
   *
   * Returns the `storagePath` the dataset should now carry. Unpacking to a
   * LOCAL directory rather than back into the bucket, because the local tree is
   * what every reader in this repo can already serve — including a v3.0 tree,
   * through `resolveLocalView`. `DATASET_UPLOAD_DIR` points it at a volume in a
   * deployment where the pod's own disk is ephemeral.
   */
  private async unpackUploadedArchive(id: string): Promise<string> {
    if (!isRustFSInitialized()) {
      throw new ExtractError('STORAGE_UNAVAILABLE', 'Storage service not available');
    }
    const key = uploadObjectKey(id);

    const scratch = await mkdtemp(join(tmpdir(), `dataset-upload-${id}-`));
    // The name carries the extension `tar` dispatches on, so a `.zip` upload
    // reaches bsdtar as a zip rather than as an unknown blob.
    const archive = join(scratch, `upload${uploadExtension(id)}`);
    try {
      // Streamed, not buffered. `download()` accumulates the whole object in
      // chunks and then `Buffer.concat`s it, so a 10 GB dataset tarball — an
      // ordinary size for the multi-camera recordings this feature exists to
      // accept — was materialised twice in the API process before a byte
      // reached disk, taking every other request down with it.
      const source = await modelStorage.getDatasetStream(id, UPLOAD_VERSION);
      await pipeline(source, createWriteStream(archive));
      const written = await stat(archive);
      if (written.size === 0) {
        throw new ExtractError('EMPTY_UPLOAD', `${key} is zero bytes — nothing was uploaded`);
      }
      const target = join(uploadRoot(), id);
      await rm(target, { recursive: true, force: true });
      const { datasetRoot, symlinksRemoved } = await extractDatasetArchive(archive, target);
      if (symlinksRemoved > 0) {
        console.warn(`[DatasetService] ${id}: removed ${symlinksRemoved} symlink(s) from the upload`);
      }
      const storagePath = `${datasetRoot}/`;
      await datasetRepository.update(id, { storagePath });
      return storagePath;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /**
   * Get upload progress from KV store
   */
  async getUploadProgress(id: string): Promise<DatasetValidationProgress | null> {
    if (!this.progressKV) {
      return null;
    }
    const key = `${DATASET_PROGRESS_KV_PREFIX}${id}`;
    return await kvGet<DatasetValidationProgress>(this.progressKV, key);
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Queue validation job via NATS
   */
  private async queueValidationJob(datasetId: string, storagePath: string): Promise<void> {
    const js = natsClient.getJetStream();
    if (!js) {
      throw new Error('JetStream not available');
    }

    const payload = JSON.stringify({
      datasetId,
      storagePath,
    });

    await js.publish(DATASET_VALIDATION_SUBJECT, new TextEncoder().encode(payload), {
      msgID: `validate-${datasetId}`,
    });

    console.log(`[DatasetService] Queued validation job for dataset: ${datasetId}`);

    // Emit validation started event
    this.emitEvent({
      type: 'dataset:validation:started',
      datasetId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Open a dataset and say whether it is structurally sound.
   *
   * Delegates to {@link validateDatasetStructure}, which reads the files
   * `info.json` names rather than checking that `info.json` itself is there.
   * The version of this that shipped until TASK-217 confirmed four fields were
   * present in one JSON file and called it validated — it never opened a
   * parquet, never confirmed a video existed, and did not run at all for a
   * dataset on local disk, which is every dataset this platform produces.
   *
   * `robotTypeId` is optional because a caller that has it gets the width check
   * against the robot's declared `proprioceptionDim`/`actionDim`, and one that
   * does not still gets everything else.
   */
  async validateStructure(storagePath: string, robotTypeId?: string): Promise<DatasetValidationResult> {
    const result: DatasetValidationResult = {
      valid: false,
      errors: [],
      warnings: [],
      episodeCount: 0,
      totalFrames: 0,
      totalDuration: 0,
      lerobotVersion: 'unknown',
      fps: 0,
    };

    const tree = openDatasetTree(storagePath);
    if (!tree) {
      // Not "this dataset is broken" — nowhere to look. Recording it as a
      // validation failure would mark a perfectly good dataset failed because
      // an object store was down.
      result.errors.push('Storage service not available');
      result.storeUnavailable = true;
      return result;
    }

    let expected: ExpectedDimensions = {};
    if (robotTypeId) {
      try {
        const robotType = await robotTypeRepository.findById(robotTypeId);
        if (robotType) {
          expected = {
            proprioceptionDim: robotType.proprioceptionDim,
            actionDim: robotType.actionDim,
          };
        }
      } catch {
        // A robot type we cannot read costs the width check, not the run.
      }
    }

    let report: DatasetStructureReport;
    try {
      report = await validateDatasetStructure(tree, expected);
    } catch (error) {
      // A store that could not answer is not a dataset that is wrong. Marking
      // it `failed` here is what the guard above exists to prevent, and it was
      // reachable through this catch until the TASK-217 review found it.
      if (error instanceof DatasetStoreError) {
        result.errors.push(error.message);
        result.storeUnavailable = true;
        return result;
      }
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }

    result.valid = report.valid;
    result.errors = report.errors.map((f) => f.message);
    result.warnings = report.warnings.map((f) => f.message);
    result.episodeCount = report.episodeCount;
    result.totalFrames = report.totalFrames;
    result.totalDuration = report.totalDuration;
    result.lerobotVersion = report.lerobotVersion;
    result.fps = report.fps;
    result.info = report.info as LeRobotInfoV3 | undefined;
    result.stats = report.stats as LeRobotStatsV3 | undefined;
    result.report = report;
    return result;
  }

  /**
   * Validate and update dataset (called by worker or synchronously)
   */
  async validateAndUpdateDataset(datasetId: string, storagePath: string): Promise<ValidationOutcome> {
    try {
      // Update progress
      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'validating',
        progress: 10,
        message: 'Validating dataset structure...',
      });

      // Validate structure. The robot type comes from the row so the vector
      // widths are checked against what this robot actually has — a 28-wide
      // state vector on a 43-DOF G1 EDU is a dataset that cannot train it, and
      // the error it produces at training time names neither number.
      const existing = await datasetRepository.findById(datasetId);
      const validation = await this.validateStructure(storagePath, existing?.robotTypeId);

      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'validating',
        progress: 50,
        message: 'Computing quality score...',
      });

      if (validation.storeUnavailable) {
        // Nothing was opened, so nothing is known. Leaving `status` alone is
        // the whole point: a dataset that was `ready` stays `ready` while the
        // store is down, and the caller is told to try again rather than shown
        // a red badge it cannot act on.
        await this.updateValidationProgress(datasetId, {
          datasetId,
          status: 'failed',
          progress: 100,
          message: 'Storage unavailable — nothing was validated',
          errors: validation.errors,
        });
        return 'unavailable';
      }

      if (!validation.valid) {
        // The report goes with the failure. A dataset marked `failed` with no
        // record of what was wrong sends whoever finds it back to the logs, and
        // the logs are on a machine they may not have.
        await datasetRepository.update(datasetId, {
          status: 'failed',
          validation: validation.report
            ? { validatedAt: new Date().toISOString(), report: validation.report }
            : undefined,
        });

        await this.updateValidationProgress(datasetId, {
          datasetId,
          status: 'failed',
          progress: 100,
          message: 'Validation failed',
          errors: validation.errors,
        });

        this.emitEvent({
          type: 'dataset:validation:failed',
          datasetId,
          error: validation.errors.join('; '),
          timestamp: new Date().toISOString(),
        });

        return 'failed';
      }

      // Compute quality score
      const qualityScore = this.computeQualityScore(validation);

      // Update dataset with validation results.
      //
      // The four measured numbers are written back now. They used to be
      // computed here and dropped, with a comment saying the repository could
      // not take them, so the row kept whatever the creating caller had read
      // out of `info.json` — which is exactly the number that is wrong when
      // the manifest and the files disagree, the case validation exists to
      // find. `UpdateDatasetInput` takes them as of TASK-217.
      const updateInput: UpdateDatasetInput = {
        status: 'ready',
        qualityScore: qualityScore.total,
        infoJson: validation.info as LeRobotInfo,
        statsJson: validation.stats as LeRobotStats,
        // Not rounded. `totalDuration` is derived from this number, so an Int
        // here made the row contradict itself for every recording whose rate
        // is not a whole number — which is most of them.
        fps: validation.fps || undefined,
        totalFrames: validation.totalFrames,
        totalDuration: parseFloat(validation.totalDuration.toFixed(3)),
        demonstrationCount: validation.episodeCount,
        lerobotVersion: validation.lerobotVersion !== 'unknown' ? validation.lerobotVersion : undefined,
        validation: validation.report
          ? { validatedAt: new Date().toISOString(), breakdown: qualityScore, report: validation.report }
          : undefined,
      };

      await datasetRepository.update(datasetId, updateInput);

      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'ready',
        progress: 100,
        message: 'Validation completed successfully',
      });

      const response = await this.get(datasetId);

      this.emitEvent({
        type: 'dataset:validation:completed',
        datasetId,
        dataset: response ?? undefined,
        timestamp: new Date().toISOString(),
      });

      console.log(`[DatasetService] Dataset validated: ${datasetId} (score: ${qualityScore.total})`);
      return 'ready';

    } catch (error) {
      console.error(`[DatasetService] Validation error for ${datasetId}:`, error);

      await datasetRepository.update(datasetId, { status: 'failed' });

      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'failed',
        progress: 100,
        message: 'Validation error',
        errors: [error instanceof Error ? error.message : String(error)],
      });

      this.emitEvent({
        type: 'dataset:validation:failed',
        datasetId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      return 'failed';
    }
  }

  /**
   * Update validation progress in KV store
   */
  private async updateValidationProgress(
    datasetId: string,
    progress: DatasetValidationProgress
  ): Promise<void> {
    if (this.progressKV) {
      const key = `${DATASET_PROGRESS_KV_PREFIX}${datasetId}`;
      await kvPut(this.progressKV, key, progress);
    }

    // Emit progress event
    this.emitEvent({
      type: 'dataset:validation:progress',
      datasetId,
      progress,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================================
  // QUALITY SCORING
  // ============================================================================

  /**
   * Compute quality score for a dataset
   */
  computeQualityScore(validation: DatasetValidationResult): QualityScoreBreakdown {
    // Demonstration count score (0-40 points)
    const demoScore = Math.min(validation.episodeCount / QUALITY.DEMO_COUNT_MAX, 1) * QUALITY.POINTS.DEMO_COUNT;

    // Duration score (0-30 points)
    const durationScore = Math.min(validation.totalDuration / QUALITY.DURATION_MAX, 1) * QUALITY.POINTS.DURATION;

    // Coverage score (0-20 points).
    //
    // This slot used to hold `episodeCount > 10 ? 16 : 8` under the name
    // "diversity", with a comment admitting it analysed nothing. A component
    // that takes one of two values and measures nothing is worse than a
    // missing one: it moves the total, so it looks like information.
    //
    // What replaced it is the thing that actually determines whether a dataset
    // can train a policy — does it carry pixels, and did the recorder keep the
    // frames it meant to. Both come from the report, which has now opened the
    // files. Sensor coverage is the larger half because a state-only dataset
    // cannot train a VLA at all.
    const report = validation.report;
    const imageKeys = report?.imageKeys.length ?? 0;
    const sensorScore = imageKeys === 0 ? 0 : Math.min(imageKeys / QUALITY.CAMERAS_FOR_FULL, 1)
      * QUALITY.POINTS.COVERAGE * 0.7;
    // The remaining 30% is integrity: every file the manifest promised is
    // present and non-empty. `valid` already implies it, so this only ever
    // differs while a dataset is being scored for information rather than
    // gated on.
    const integrityScore = report && report.errors.length === 0
      ? QUALITY.POINTS.COVERAGE * 0.3
      : 0;
    const coverageScore = sensorScore + integrityScore;

    // Format compliance score (0-10 points)
    let complianceScore = 0;
    if (validation.info) complianceScore += 4; // info.json present and valid
    if (validation.stats) complianceScore += 3; // stats.json present
    if (validation.valid) complianceScore += 3; // Overall valid

    const total = Math.round(demoScore + durationScore + coverageScore + complianceScore);

    return {
      demonstrationCount: Math.round(demoScore),
      duration: Math.round(durationScore),
      diversity: Math.round(coverageScore),
      formatCompliance: Math.round(complianceScore),
      total: Math.min(total, 100),
    };
  }

  // ============================================================================
  // STATS COMPUTATION
  // ============================================================================

  /**
   * Get normalization stats for a dataset
   */
  async getStats(id: string): Promise<DatasetStatsResponse> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    const hasStats = dataset.statsJson && Object.keys(dataset.statsJson).length > 0;

    return {
      datasetId: id,
      hasStats,
      stats: hasStats ? dataset.statsJson as LeRobotStatsV3 : undefined,
      computedAt: hasStats ? dataset.updatedAt.toISOString() : undefined,
    };
  }

  /**
   * Queue stats computation job via NATS JetStream.
   * Consumed by the Python stats worker (stats_worker.py in the training-worker repo).
   */
  async computeStats(id: string, force = false): Promise<void> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    if (dataset.status !== 'ready') {
      throw new Error(`Dataset not ready for stats computation: ${id}`);
    }

    // Check if stats already exist
    const hasStats = dataset.statsJson && Object.keys(dataset.statsJson).length > 0;
    if (hasStats && !force) {
      throw new Error(`Dataset already has stats. Use force=true to recompute.`);
    }

    // Queue stats computation job if NATS is available
    if (natsClient.isConnected()) {
      const js = natsClient.getJetStream();
      if (js) {
        const payload = JSON.stringify({
          datasetId: id,
          storagePath: dataset.storagePath,
          force,
        });

        await js.publish(DATASET_STATS_SUBJECT, new TextEncoder().encode(payload), {
          msgID: `stats-${id}-${Date.now()}`,
        });

        console.log(`[DatasetService] Queued stats computation for dataset: ${id}`);
      }
    } else {
      // Stats computation requires Python worker, just log for now
      console.log(`[DatasetService] Stats computation requested for ${id} but worker not available`);
      throw new Error('Stats computation worker not available. This feature requires the Python worker.');
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Convert Dataset to DatasetResponse with relations
   */
  private async toResponse(dataset: Dataset): Promise<DatasetResponse> {
    const response: DatasetResponse = {
      id: dataset.id,
      name: dataset.name,
      description: dataset.description,
      robotTypeId: dataset.robotTypeId,
      skillId: dataset.skillId,
      storagePath: dataset.storagePath,
      lerobotVersion: dataset.lerobotVersion,
      fps: dataset.fps,
      totalFrames: dataset.totalFrames,
      totalDuration: dataset.totalDuration,
      demonstrationCount: dataset.demonstrationCount,
      qualityScore: dataset.qualityScore,
      infoJson: dataset.infoJson,
      statsJson: dataset.statsJson,
      status: dataset.status,
      huggingFaceRepoId: dataset.huggingFaceRepoId,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
    };

    // Fetch robot type if available
    if (dataset.robotTypeId) {
      const robotType = await robotTypeRepository.findById(dataset.robotTypeId);
      if (robotType) {
        response.robotType = {
          id: robotType.id,
          name: robotType.name,
          manufacturer: robotType.manufacturer,
          model: robotType.model,
        };
      }
    }

    // Fetch skill if available
    if (dataset.skillId) {
      const skill = await skillDefinitionRepository.findById(dataset.skillId);
      if (skill) {
        response.skill = {
          id: skill.id,
          name: skill.name,
          version: skill.version,
        };
      }
    }

    // What validation actually found, when something has validated this.
    //
    // This used to reconstruct the score breakdown from the row's own numbers —
    // 70% of the diversity points as a literal, and "assume compliant if
    // ready" — so it agreed with itself whatever the files said. The stored
    // report is the real one, and its ABSENCE is information too: it means
    // nothing has ever opened this dataset, which is the state every locally
    // registered dataset is in.
    const stored = dataset.validation as
      | { breakdown?: QualityScoreBreakdown; report?: DatasetStructureReport; validatedAt?: string }
      | undefined;
    if (stored?.breakdown) {
      response.qualityBreakdown = stored.breakdown;
    }
    if (stored?.report) {
      response.validation = {
        validatedAt: stored.validatedAt,
        valid: stored.report.valid,
        lerobotVersion: stored.report.lerobotVersion,
        errors: stored.report.errors,
        warnings: stored.report.warnings,
        imageKeys: stored.report.imageKeys,
        fileCount: stored.report.files.length,
      };
    }

    return response;
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Subscribe to dataset events
   */
  onDatasetEvent(handler: DatasetEventCallback): () => void {
    this.on('dataset:event', handler);
    return () => this.off('dataset:event', handler);
  }

  /**
   * Emit a dataset event
   */
  private emitEvent(event: DatasetEvent): void {
    this.emit('dataset:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const datasetService = DatasetService.getInstance();

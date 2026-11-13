/**
 * @file ModelUploadService.ts
 * @description Direct model checkpoint upload (TASK-498): a client sends a
 *              checkpoint directory file by file, in bounded parts, through
 *              this server into the instance's model store, and the finished
 *              upload is registered as a ModelVersion.
 * @feature deployment
 *
 * WHY. The registry could only record an `artifactUri` that points somewhere
 * else — a Hugging Face repository, a bucket somebody else filled. A
 * checkpoint that sits on a disk had no way in. This is the dataset upload's
 * machinery (`datasetUpload/uploadSession.ts`, the same sinks) with a
 * different beginning and a different end:
 *
 *   start   — name, version, base model, the dataset it was trained on and
 *             its metrics are checked together with the file manifest, before
 *             a byte is sent.
 *   parts / status / finish / cancel — exactly the dataset upload's: resumable
 *             from what the store holds, refused when the store is full,
 *             bounded in memory.
 *   the end — once every file is assembled and verified the ModelVersion is
 *             registered, `sourceKind: 'uploaded'`, its `artifactUri` the
 *             stored prefix.
 *
 * NO MODELVERSION EXISTS UNTIL THEN. The upload is its own row, so an
 * unfinished, failed or cancelled upload is never in the registry and can
 * never be picked for a deployment. The ModelVersion takes the upload's id,
 * so a client holds one id from start to registry.
 *
 * The row stays after completion: it is the manifest a download reads and the
 * record of which stored files belong to the model, which is what lets
 * deleting the model remove them.
 */

import type { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../database/index.js';
import { datasetRepository, modelVersionRepository } from '../../repositories/index.js';
import {
  modelUploadRepository,
  type ModelUploadMetadata,
  type ModelUploadSession,
  type ModelUploadStore,
} from '../../repositories/ModelUploadRepository.js';
import { tenantStore } from '../../middleware/tenantContext.js';
import { BaseModels, type BaseModel, type CreateModelVersionInput, type ModelType, type ModelVersion, type TrainingMetrics } from '../../types/vla.types.js';
import { runInBackground } from '../../utils/backgroundTask.js';
import { auditBuildAct } from '../buildAudit.js';
import { modelRegistryService } from '../ModelRegistryService.js';
import {
  DatasetUploadError,
  modelUploadLimits,
  parseDeclaredFiles,
  resolveChunkSize,
  toUploadEntries,
  type ManifestNouns,
  type UploadFileEntry,
  type UploadLimits,
} from '../datasetUpload/uploadManifest.js';
import {
  assembleAndVerify,
  assertNothingMissing,
  fileView,
  notAcceptingError,
  PartReceiver,
  progressOf,
  type UploadFileStatus,
  type UploadFileView,
  type UploadState,
} from '../datasetUpload/uploadSession.js';
import type { OpenFileOptions, ReceivedFile, UploadSink } from '../datasetUpload/UploadSink.js';
import { artifactUriOf, createModelUploadSink, openModelUploadSink } from './modelUploadSink.js';

/** How often an active upload's `lastActivityAt` is written; far under any idle limit. */
export const MODEL_UPLOAD_TOUCH_INTERVAL_MS = 15_000;
export const MODEL_UPLOAD_REAP_INTERVAL_MS = 5 * 60_000;

export const MODEL_TYPES: readonly ModelType[] = ['vla', 'rl_policy'];
const MAX_NOTES_LENGTH = 4000;
const MAX_METRICS_JSON_BYTES = 64 * 1024;

const NOUNS: ManifestNouns = { thing: 'model', maxBytesVariable: 'MODEL_UPLOAD_MAX_BYTES' };

// ============================================================================
// CONTRACT TYPES
// ============================================================================

/** Body of `POST /api/models/uploads`. */
export interface StartModelUploadRequest {
  name?: unknown;
  version?: unknown;
  modelType?: unknown;
  baseModel?: unknown;
  datasetId?: unknown;
  trainingMetrics?: unknown;
  validationMetrics?: unknown;
  notes?: unknown;
  files?: unknown;
  chunkSize?: unknown;
}

export interface StartModelUploadResponse {
  uploadId: string;
  state: 'uploading';
  name: string;
  version: string;
  storage: 'local' | 'rustfs';
  chunkSize: number;
  totalBytes: number;
  files: UploadFileView[];
  idleTimeoutSeconds: number;
  expiresAt: string;
}

/** An upload without its per-file detail — a row of `GET /api/models/uploads`. */
export interface ModelUploadSummary {
  uploadId: string;
  state: UploadState;
  name: string;
  version: string;
  modelType: string;
  baseModel: string | null;
  datasetId: string | null;
  storage: 'local' | 'rustfs';
  totalBytes: number;
  totalFiles: number;
  /** The registered model once `state` is `completed`; null before. */
  modelVersionId: string | null;
  /** Why assembling or verifying failed. */
  error: string | null;
  createdAt: string;
  lastActivityAt: string;
  /** When an idle upload is removed; null once nothing more is expected of the client. */
  expiresAt: string | null;
}

export interface ModelUploadStatusResponse extends ModelUploadSummary {
  chunkSize: number;
  receivedBytes: number;
  completedFiles: number;
  /** Every part of every file is held; `finish` will be accepted. */
  readyToFinish: boolean;
  files: UploadFileStatus[];
}

export interface ModelPartReceipt {
  uploadId: string;
  fileId: number;
  partNumber: number;
  size: number;
  sha256: string;
}

export interface FinishModelUploadResponse {
  uploadId: string;
  state: UploadState;
  modelVersionId: string | null;
  message: string;
}

export interface CancelModelUploadResponse {
  uploadId: string;
  status: 'cancelled';
  message: string;
}

export interface ModelFileEntry {
  path: string;
  size: number;
  sha256: string | null;
}

/**
 * `GET /api/models/versions/:id/files` — what this server stores for a model,
 * one page. The shape of a dataset's file list (docs/dataset-download.md) plus
 * the totals, so one client downloads both.
 */
export interface ModelFileManifest {
  modelVersionId: string;
  artifactUri: string;
  storage: 'local' | 'rustfs';
  /** Of the whole model, not of this page. */
  totalBytes: number;
  fileCount: number;
  limit: number;
  /** In ascending byte order of `path`. */
  files: ModelFileEntry[];
  /** Pass as `after` for the next page; null on the last. */
  nextCursor: string | null;
}

export const DEFAULT_MODEL_FILES_PAGE = 1000;
export const MAX_MODEL_FILES_PAGE = 1000;

export interface RemovedFiles {
  /** False when the model has no files stored here (or they were removed before). */
  removed: boolean;
  freedBytes: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export interface ModelUploadDeps {
  sessions: ModelUploadStore;
  createSink: (uploadId: string) => UploadSink;
  openSink: (kind: 'local' | 'rustfs', storagePath: string) => UploadSink;
  limits: () => UploadLimits;
  now: () => number;
  datasetExists: (datasetId: string) => Promise<boolean>;
  /** A registered, not archived model already carries this name and version. */
  versionTaken: (name: string, version: string) => Promise<boolean>;
  findModelVersion: (id: string) => Promise<ModelVersion | null>;
  register: (input: CreateModelVersionInput) => Promise<ModelVersion>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function metricsOf(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new DatasetUploadError('INVALID_METRICS', `${field} must be a JSON object, for example { "final_loss": 0.026 }`);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_METRICS_JSON_BYTES) {
    throw new DatasetUploadError('INVALID_METRICS', `${field} is larger than ${MAX_METRICS_JSON_BYTES} bytes of JSON; keep curves out of it`);
  }
  return value;
}

export class ModelUploadService {
  private readonly deps: ModelUploadDeps;
  private readonly receiver = new PartReceiver();
  private readonly lastTouch = new Map<string, number>();
  private reaper: NodeJS.Timeout | null = null;

  constructor(deps: Partial<ModelUploadDeps> = {}) {
    this.deps = {
      sessions: deps.sessions ?? modelUploadRepository,
      createSink: deps.createSink ?? createModelUploadSink,
      openSink: deps.openSink ?? openModelUploadSink,
      limits: deps.limits ?? (() => modelUploadLimits()),
      now: deps.now ?? Date.now,
      datasetExists: deps.datasetExists ?? (async (id) => (await datasetRepository.findById(id)) !== null),
      versionTaken: deps.versionTaken ?? (async (name, version) => (await prisma.modelVersion.findFirst({
        where: { name, version, deploymentStatus: { not: 'archived' } },
        select: { id: true },
      })) !== null),
      findModelVersion: deps.findModelVersion ?? ((id) => modelVersionRepository.findById(id)),
      register: deps.register ?? ((input) => modelRegistryService.register(input)),
    };
  }

  // --------------------------------------------------------------------------
  // START
  // --------------------------------------------------------------------------

  /** What the registry will say about the model, checked before anything is stored. */
  private async checkMetadata(request: StartModelUploadRequest): Promise<ModelUploadMetadata> {
    const name = typeof request.name === 'string' ? request.name.trim() : '';
    if (!name || name.length > 200) {
      throw new DatasetUploadError('INVALID_NAME', 'name is required (1 to 200 characters)');
    }
    const version = typeof request.version === 'string' ? request.version.trim() : '';
    if (!version || version.length > 100) {
      throw new DatasetUploadError('INVALID_VERSION', 'version is required (1 to 100 characters), for example "1.0.0" or "step-5000"');
    }
    const modelType = request.modelType === undefined || request.modelType === null ? 'vla' : request.modelType;
    if (typeof modelType !== 'string' || !MODEL_TYPES.includes(modelType as ModelType)) {
      throw new DatasetUploadError('INVALID_MODEL_TYPE', `modelType must be one of ${MODEL_TYPES.join(', ')}`, 400, { accepted: MODEL_TYPES });
    }
    let baseModel: BaseModel | null = null;
    if (request.baseModel !== undefined && request.baseModel !== null && request.baseModel !== '') {
      if (typeof request.baseModel !== 'string' || !BaseModels.includes(request.baseModel as BaseModel)) {
        throw new DatasetUploadError(
          'INVALID_BASE_MODEL',
          `baseModel must be one of ${BaseModels.join(', ')} — or left out when the model has none of them as its base`,
          400,
          { accepted: BaseModels },
        );
      }
      baseModel = request.baseModel as BaseModel;
    }
    let datasetId: string | null = null;
    if (request.datasetId !== undefined && request.datasetId !== null && request.datasetId !== '') {
      if (typeof request.datasetId !== 'string') {
        throw new DatasetUploadError('INVALID_REQUEST', 'datasetId must be a string');
      }
      if (!await this.deps.datasetExists(request.datasetId)) {
        throw new DatasetUploadError('DATASET_NOT_FOUND', `Dataset ${request.datasetId} does not exist on this instance; leave datasetId out or name one that does`, 404);
      }
      datasetId = request.datasetId;
    }
    let notes: string | null = null;
    if (request.notes !== undefined && request.notes !== null) {
      if (typeof request.notes !== 'string' || request.notes.length > MAX_NOTES_LENGTH) {
        throw new DatasetUploadError('INVALID_REQUEST', `notes must be a string of at most ${MAX_NOTES_LENGTH} characters`);
      }
      notes = request.notes.trim() || null;
    }
    return {
      name,
      version,
      modelType,
      baseModel,
      datasetId,
      trainingMetrics: metricsOf(request.trainingMetrics, 'trainingMetrics'),
      validationMetrics: metricsOf(request.validationMetrics, 'validationMetrics'),
      notes,
    };
  }

  /**
   * Check what the client declares and open the upload. Nothing is created
   * until every check has passed, and a failure after that removes what it made.
   */
  async start(request: StartModelUploadRequest): Promise<StartModelUploadResponse> {
    const limits = this.deps.limits();
    const metadata = await this.checkMetadata(request);
    const chunkSize = resolveChunkSize(request.chunkSize, limits);
    const declared = parseDeclaredFiles(request.files, limits, NOUNS);
    const manifest = toUploadEntries(declared, new Set(declared.map((f) => f.path)), chunkSize, limits, NOUNS);

    if (await this.deps.versionTaken(metadata.name, metadata.version)) {
      throw new DatasetUploadError(
        'MODEL_VERSION_EXISTS',
        `A model named "${metadata.name}" with version "${metadata.version}" is already registered. `
          + 'Upload under another version, or archive the existing one first.',
        409,
      );
    }
    // The same model already on its way: a second start — a retry whose first
    // answer was lost, or a second terminal — would store it twice and register
    // two rows. The open one is named so the client can carry on with it.
    const open = (await this.deps.sessions.list(['uploading', 'processing'])).find(
      (session) => session.metadata.name === metadata.name && session.metadata.version === metadata.version,
    );
    if (open) {
      throw new DatasetUploadError(
        'UPLOAD_IN_PROGRESS',
        `An upload of "${metadata.name}" version "${metadata.version}" is already open (${open.id}). `
          + 'Resume it, or cancel it before starting again.',
        409,
        { uploadId: open.id, state: open.state },
      );
    }

    const uploadId = uuidv4();
    const sink = this.deps.createSink(uploadId);
    const free = await sink.freeBytes(limits.storeCapacityBytes);
    if (free !== null && manifest.totalBytes > free) {
      throw new DatasetUploadError(
        'INSUFFICIENT_STORAGE',
        `The model is ${formatBytes(manifest.totalBytes)} and the store has ${formatBytes(free)} free. `
          + 'Delete models or datasets that are no longer needed, or leave files out of the upload.',
        507,
        { totalBytes: manifest.totalBytes, freeBytes: free },
      );
    }

    const files = await sink.prepare(manifest.files);
    try {
      await this.deps.sessions.create({
        id: uploadId,
        state: 'uploading',
        sink: sink.kind,
        storagePath: sink.storagePath,
        chunkSize,
        files,
        totalBytes: manifest.totalBytes,
        metadata,
      });
    } catch (error) {
      await sink.discard(files).catch(() => undefined);
      throw error;
    }

    const now = this.deps.now();
    this.lastTouch.set(uploadId, now);
    console.log(`[ModelUpload] ${uploadId} started: "${metadata.name}" ${metadata.version}, ${files.length} files, ${manifest.totalBytes} bytes → ${sink.kind} ${sink.storagePath}`);
    return {
      uploadId,
      state: 'uploading',
      name: metadata.name,
      version: metadata.version,
      storage: sink.kind,
      chunkSize,
      totalBytes: manifest.totalBytes,
      files: files.map(fileView),
      idleTimeoutSeconds: Math.round(limits.idleMs / 1000),
      expiresAt: new Date(now + limits.idleMs).toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // LOOKUP, STATUS, LIST
  // --------------------------------------------------------------------------

  private async load(uploadId: string): Promise<ModelUploadSession> {
    const session = await this.deps.sessions.find(uploadId);
    if (!session) throw new DatasetUploadError('NOT_FOUND', 'Model upload not found', 404);
    return session;
  }

  private summary(session: ModelUploadSession): ModelUploadSummary {
    return {
      uploadId: session.id,
      state: session.state,
      name: session.metadata.name,
      version: session.metadata.version,
      modelType: session.metadata.modelType,
      baseModel: session.metadata.baseModel,
      datasetId: session.metadata.datasetId,
      storage: session.sink,
      totalBytes: session.totalBytes,
      totalFiles: session.files.length,
      modelVersionId: session.modelVersionId,
      error: session.error,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      expiresAt: session.state === 'uploading' || session.state === 'failed'
        ? new Date(session.lastActivityAt.getTime() + this.deps.limits().idleMs).toISOString()
        : null,
    };
  }

  async status(uploadId: string): Promise<ModelUploadStatusResponse> {
    const session = await this.load(uploadId);
    let received: Map<number, ReceivedFile> | null = null;
    // A failed upload still holds parts; say which, so a look at it is honest.
    if (session.state === 'uploading' || session.state === 'failed') {
      received = await this.deps.openSink(session.sink, session.storagePath)
        .received(session.files, session.chunkSize);
    }
    const progress = progressOf(session.files, session.chunkSize, received, session.state);
    return {
      ...this.summary(session),
      chunkSize: session.chunkSize,
      receivedBytes: progress.receivedBytes,
      completedFiles: progress.completedFiles,
      readyToFinish: session.state === 'uploading' && progress.readyToFinish,
      files: progress.files,
    };
  }

  /** Uploads that are not registered models yet: running, being finished, failed. */
  async listOpen(): Promise<ModelUploadSummary[]> {
    const sessions = await this.deps.sessions.list(['uploading', 'processing', 'failed', 'cancelling']);
    return sessions
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((session) => this.summary(session));
  }

  // --------------------------------------------------------------------------
  // PARTS
  // --------------------------------------------------------------------------

  /** Stream one part from `source` into the store. See `PartReceiver.receive`. */
  async receivePart(
    uploadId: string,
    fileId: number,
    partNumber: number,
    source: Readable,
    options: { contentLength: number | null; sha256?: string | null },
  ): Promise<ModelPartReceipt> {
    const session = await this.load(uploadId);
    if (session.state !== 'uploading') throw notAcceptingError(session.state);
    const part = await this.receiver.receive({
      uploadId,
      files: session.files,
      chunkSize: session.chunkSize,
      sink: this.deps.openSink(session.sink, session.storagePath),
      fileId,
      partNumber,
      source,
      contentLength: options.contentLength,
      sha256: options.sha256,
      maxConcurrentParts: this.deps.limits().maxConcurrentParts,
      storeName: 'model store',
      logTag: '[ModelUpload]',
      currentState: async () => (await this.deps.sessions.find(uploadId))?.state ?? null,
    });
    const now = this.deps.now();
    if (now - (this.lastTouch.get(uploadId) ?? 0) >= MODEL_UPLOAD_TOUCH_INTERVAL_MS) {
      this.lastTouch.set(uploadId, now);
      runInBackground(`[ModelUpload] could not record activity for ${uploadId}:`, () =>
        this.deps.sessions.touch(uploadId, new Date(now)));
    }
    return { uploadId, fileId: part.file.id, partNumber, size: part.size, sha256: part.sha256 };
  }

  // --------------------------------------------------------------------------
  // FINISH
  // --------------------------------------------------------------------------

  /**
   * Accept the upload as complete, or say exactly what is missing.
   *
   * Answers as soon as the store has confirmed every part is held. Assembling,
   * checksumming and registering follow in the background; the upload's state
   * is what a client polls. Calling it again while that runs, or after, is
   * answered with where the upload is rather than an error.
   */
  async finish(uploadId: string, actorId?: string): Promise<FinishModelUploadResponse> {
    const session = await this.load(uploadId);
    if (session.state === 'processing' || session.state === 'completed') {
      return {
        uploadId,
        state: session.state,
        modelVersionId: session.modelVersionId,
        message: session.state === 'processing' ? 'The upload is already being finished' : 'The upload is already finished',
      };
    }
    if (session.state !== 'uploading') throw notAcceptingError(session.state);

    const sink = this.deps.openSink(session.sink, session.storagePath);
    const received = await sink.received(session.files, session.chunkSize);
    assertNothingMissing(session.files, session.chunkSize, received, formatBytes);

    if (!await this.deps.sessions.transition(uploadId, ['uploading'], 'processing')) {
      // Another finish (or a cancel) won; report where it stands now.
      const current = await this.deps.sessions.find(uploadId);
      if (!current || current.state === 'cancelling') throw notAcceptingError('cancelling');
      return { uploadId, state: current.state, modelVersionId: current.modelVersionId, message: 'The upload is already being finished' };
    }
    runInBackground(`[ModelUpload] finishing ${uploadId} failed:`, () => this.process(uploadId, actorId));
    return {
      uploadId,
      state: 'processing',
      modelVersionId: null,
      message: 'Upload received; the files are being assembled and verified, then the model is registered. Poll GET /api/models/uploads/:id.',
    };
  }

  /** Assemble, verify, register. Runs detached; records its own failure. */
  private async process(uploadId: string, actorId?: string): Promise<void> {
    const session = await this.deps.sessions.find(uploadId);
    if (!session || session.state !== 'processing') return;
    try {
      // A re-sent part still in flight would change an ETag under the assembly.
      await this.receiver.settle(uploadId, false);
      await assembleAndVerify(
        this.deps.openSink(session.sink, session.storagePath),
        session.files,
        session.chunkSize,
        { storeName: 'model store', log: (message) => console.log(`[ModelUpload] ${uploadId}: ${message}`) },
      );
      const modelVersion = await this.registerModel(session);
      await this.deps.sessions.transition(uploadId, ['processing'], 'completed', { modelVersionId: modelVersion.id, error: null });
      this.lastTouch.delete(uploadId);
      console.log(`[ModelUpload] ${uploadId} finished: registered as model version ${modelVersion.id}`);
      await auditBuildAct({
        resourceType: 'model_version',
        resourceId: modelVersion.id,
        action: 'create',
        actorId,
        metadata: {
          version: modelVersion.version,
          name: modelVersion.name,
          artifactUri: modelVersion.artifactUri,
          source: 'direct-upload',
          sizeBytes: session.totalBytes,
        },
      });
    } catch (error) {
      // The store is away, not the upload wrong: stay `processing`, and the
      // recovery hook runs this again when the store is back.
      if (error instanceof DatasetUploadError && error.code === 'STORAGE_UNAVAILABLE') {
        console.warn(`[ModelUpload] ${uploadId}: storage unavailable while finishing; will resume when it is back`);
        return;
      }
      console.error(`[ModelUpload] ${uploadId} failed while finishing:`, error);
      await this.deps.sessions.transition(uploadId, ['processing'], 'failed', { error: messageOf(error) });
    }
  }

  /**
   * Register the ModelVersion of a verified upload, under the upload's id and
   * in the tenant that started it — `process` also runs at startup, outside
   * any request. Safe to repeat: a restart between this and the state change
   * finds the row and does not create a second one.
   */
  private async registerModel(session: ModelUploadSession): Promise<ModelVersion> {
    const run = async (): Promise<ModelVersion> => {
      const existing = await this.deps.findModelVersion(session.id);
      if (existing) return existing;
      const { metadata } = session;
      return this.deps.register({
        id: session.id,
        skillId: null,
        trainingJobId: null,
        name: metadata.name,
        sourceKind: 'uploaded',
        modelType: metadata.modelType as ModelType,
        version: metadata.version,
        artifactUri: artifactUriOf(session.sink, session.storagePath),
        trainingMetrics: metadata.trainingMetrics as TrainingMetrics,
        validationMetrics: metadata.validationMetrics as TrainingMetrics,
        baseModel: metadata.baseModel as BaseModel | null,
        datasetId: metadata.datasetId,
        notes: metadata.notes,
        artifactSizeBytes: session.totalBytes,
        artifactFileCount: session.files.length,
      });
    };
    return session.tenantId ? tenantStore.run({ tenantId: session.tenantId }, run) : run();
  }

  /** Take up every upload a restart cut off between `finish` and the registry. */
  async resumeInterrupted(): Promise<string[]> {
    const sessions = await this.deps.sessions.list(['processing']);
    for (const session of sessions) {
      runInBackground(`[ModelUpload] finishing ${session.id} failed:`, () => this.process(session.id));
    }
    return sessions.map((s) => s.id);
  }

  // --------------------------------------------------------------------------
  // CANCEL, EXPIRY
  // --------------------------------------------------------------------------

  /** Stop the upload and remove it: open multipart uploads, parts, files and the row. */
  async cancel(uploadId: string): Promise<CancelModelUploadResponse> {
    const session = await this.load(uploadId);
    if (session.state === 'processing') {
      throw new DatasetUploadError('UPLOAD_PROCESSING', 'The upload is being finished and can no longer be cancelled; delete the model once it is registered.', 409, { state: session.state });
    }
    if (session.state === 'completed') {
      throw new DatasetUploadError(
        'UPLOAD_COMPLETED',
        'The upload is finished and registered; delete the model with DELETE /api/models/versions/:id instead.',
        409,
        { state: session.state, modelVersionId: session.modelVersionId },
      );
    }
    await this.remove(session, 'Cancelled by the client');
    return { uploadId, status: 'cancelled', message: 'Upload cancelled; everything it stored was removed' };
  }

  private async remove(session: ModelUploadSession, reason: string): Promise<void> {
    // First, and before anything is removed: from here no new part is accepted,
    // and if the rest dies halfway the reaper finds the row and finishes it.
    if (!await this.deps.sessions.transition(session.id, ['uploading', 'failed', 'cancelling'], 'cancelling')) {
      // A finish won the race since the caller looked: its files are being
      // assembled right now and are not this call's to delete.
      const current = await this.deps.sessions.find(session.id);
      if (current) {
        throw new DatasetUploadError(
          current.state === 'completed' ? 'UPLOAD_COMPLETED' : 'UPLOAD_PROCESSING',
          'The upload was finished in the meantime and can no longer be cancelled.',
          409,
          { state: current.state },
        );
      }
    }
    await this.receiver.settle(session.id, true);
    await this.deps.openSink(session.sink, session.storagePath).discard(session.files);
    await this.deps.sessions.delete(session.id);
    this.lastTouch.delete(session.id);
    console.log(`[ModelUpload] ${session.id} removed: ${reason}`);
  }

  /**
   * Remove every upload nothing was sent to for the idle time, every failed
   * one left alone that long, and finish any cancel that did not get to its
   * end. Returns the ids it removed.
   */
  async reapIdle(): Promise<string[]> {
    const cutoff = new Date(this.deps.now() - this.deps.limits().idleMs);
    const stale = [
      ...await this.deps.sessions.list(['cancelling']),
      ...await this.deps.sessions.list(['uploading', 'failed'], cutoff),
    ];
    const removed: string[] = [];
    for (const session of stale) {
      // A part is being streamed this moment: the upload is not idle, only its
      // activity mark is behind.
      if (session.state === 'uploading' && this.receiver.activeCount(session.id) > 0) continue;
      try {
        const reason = session.state === 'cancelling'
          ? 'an interrupted cancel was completed'
          : `${session.state === 'failed' ? 'failed and ' : ''}idle since ${session.lastActivityAt.toISOString()}`;
        await this.remove(session, reason);
        removed.push(session.id);
      } catch (error) {
        console.warn(`[ModelUpload] Could not remove the abandoned upload ${session.id}:`, messageOf(error));
      }
    }
    return removed;
  }

  /** Reap on a timer. Safe to call twice; the timer never keeps the process alive. */
  startReaper(intervalMs = MODEL_UPLOAD_REAP_INTERVAL_MS): void {
    if (this.reaper) return;
    const tick = () => runInBackground('[ModelUpload] reaping idle uploads failed:', () => this.reapIdle());
    tick();
    this.reaper = setInterval(tick, intervalMs);
    this.reaper.unref();
  }

  stopReaper(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }

  /** RustFS prefixes of uploads still running; the stale-multipart sweep leaves them alone. */
  async openPrefixes(): Promise<string[]> {
    const sessions = await this.deps.sessions.list(['uploading', 'processing']);
    return sessions.filter((s) => s.sink === 'rustfs').map((s) => s.storagePath);
  }

  // --------------------------------------------------------------------------
  // THE STORED MODEL: MANIFEST, FILES, REMOVAL
  // --------------------------------------------------------------------------

  /** The completed upload behind a model version, or the refusal that says why there is none. */
  private async storedModel(modelVersionId: string): Promise<ModelUploadSession> {
    const session = await this.deps.sessions.findByModelVersion(modelVersionId);
    if (!session || session.state !== 'completed') {
      throw new DatasetUploadError(
        'NO_STORED_FILES',
        'This model was not uploaded to this instance: its artifactUri points somewhere else, and there are no files to list here.',
        404,
      );
    }
    if (session.filesRemovedAt) {
      throw new DatasetUploadError(
        'ARTIFACT_REMOVED',
        `The stored files of this model were removed on ${session.filesRemovedAt.toISOString()} when it was deleted.`,
        410,
        { filesRemovedAt: session.filesRemovedAt.toISOString() },
      );
    }
    return session;
  }

  /** Whether a model version was uploaded here, and whether its files are still stored. */
  async storageOf(modelVersionId: string): Promise<{ uploadId: string; storage: 'local' | 'rustfs'; filesRemovedAt: string | null } | null> {
    const session = await this.deps.sessions.findByModelVersion(modelVersionId);
    if (!session) return null;
    return {
      uploadId: session.id,
      storage: session.sink,
      filesRemovedAt: session.filesRemovedAt ? session.filesRemovedAt.toISOString() : null,
    };
  }

  async manifest(
    modelVersionId: string,
    page: { after?: string; limit?: number } = {},
  ): Promise<ModelFileManifest> {
    const session = await this.storedModel(modelVersionId);
    const limit = page.limit ?? DEFAULT_MODEL_FILES_PAGE;
    // Byte order, the order an object store lists in — and a dataset's list.
    const sorted = [...session.files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const rest = page.after === undefined
      ? sorted
      : sorted.filter((file) => Buffer.compare(Buffer.from(file.path), Buffer.from(page.after as string)) > 0);
    const files = rest.slice(0, limit);
    return {
      modelVersionId,
      artifactUri: artifactUriOf(session.sink, session.storagePath),
      storage: session.sink,
      totalBytes: session.totalBytes,
      fileCount: session.files.length,
      limit,
      files: files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 ?? null })),
      nextCursor: rest.length > limit ? files[files.length - 1].path : null,
    };
  }

  /**
   * One stored file of a model, by the path its manifest lists it under. The
   * path is only ever compared with the manifest — it never reaches the store
   * as given — so no path can name anything outside the model.
   */
  async file(modelVersionId: string, path: string): Promise<{
    entry: UploadFileEntry;
    open: (options?: OpenFileOptions) => Promise<Readable>;
  }> {
    const session = await this.storedModel(modelVersionId);
    const entry = session.files.find((file) => file.path === path);
    if (!entry) {
      throw new DatasetUploadError(
        'FILE_NOT_FOUND',
        `The model has no file ${path.slice(0, 200)}; GET /api/models/versions/:id/files lists them`,
        404,
        { path: path.slice(0, 200) },
      );
    }
    const sink = this.deps.openSink(session.sink, session.storagePath);
    return { entry, open: (options) => sink.open(entry, options) };
  }

  /**
   * Remove what this server stores for a model that is being deleted. A no-op
   * for a model that was not uploaded here, or whose files are already gone.
   */
  async removeStoredFiles(modelVersionId: string): Promise<RemovedFiles> {
    const session = await this.deps.sessions.findByModelVersion(modelVersionId);
    if (!session || session.state !== 'completed' || session.filesRemovedAt) {
      return { removed: false, freedBytes: 0 };
    }
    await this.deps.openSink(session.sink, session.storagePath).discard(session.files);
    await this.deps.sessions.markFilesRemoved(session.id, new Date(this.deps.now()));
    console.log(`[ModelUpload] ${session.id}: stored files removed (${session.totalBytes} bytes) with the deletion of its model`);
    return { removed: true, freedBytes: session.totalBytes };
  }
}

export const modelUploadService = new ModelUploadService();

/**
 * @file DatasetUploadService.ts
 * @description Direct dataset upload (TASK-480): a client sends a LeRobot
 *              directory file by file, in bounded parts, through this server,
 *              which streams them into the dataset store. The dataset ends in
 *              the state a full Hub import ends in.
 * @feature datasets
 *
 * WHY THROUGH THE SERVER. The older upload hands out a presigned URL signed
 * against `RUSTFS_ENDPOINT`. On a cluster that is an in-cluster address no
 * browser or CLI outside it can reach, and it takes one archive that is then
 * unpacked onto the server's own disk — where a v3.0 tree cannot be served.
 * Here every byte comes in through the API a client can already reach and
 * lands under a storage prefix as the tree itself, which is exactly what the
 * Hub importer writes and what the remote readers serve.
 *
 * THE SHAPE OF ONE UPLOAD.
 *   start   — the client declares the files; the manifest, the size and the
 *             robot type are checked before a byte is sent, and the dataset
 *             row is created `uploading`.
 *   parts   — each request carries one part of one file as a raw body, piped
 *             to the store as it is read. Part N of a file always covers the
 *             same bytes, so sending it again replaces it and nothing else.
 *   status  — asks the STORE what it holds, so a client that restarts (or a
 *             server that did) continues from the truth.
 *   finish  — refuses while anything is missing; otherwise the files are
 *             assembled and verified in the background and handed to the same
 *             validation an import ends with.
 *   cancel  — and an upload left idle: every open multipart upload is aborted,
 *             everything written is deleted, and the row goes with it.
 *
 * No request waits on long work: a part is bounded by the chunk size, and
 * assembling, checksumming and validating run detached from `finish`.
 */

import type { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { datasetRepository } from '../../repositories/index.js';
import {
  datasetUploadRepository,
  type DatasetUploadSession,
  type DatasetUploadState,
  type DatasetUploadStore,
} from '../../repositories/DatasetUploadRepository.js';
import { isNatsConnectionClosed } from '../../messaging/connection-errors.js';
import { runInBackground } from '../../utils/backgroundTask.js';
import type { CreateDatasetInput, DatasetImportError } from '../../types/vla.types.js';
import type { HuggingFaceImportProgress, ImportLogLevel } from '../../types/dataset.types.js';
import { datasetService } from '../DatasetService.js';
import {
  formatBytes,
  HuggingFaceImportError,
  huggingFaceImportService,
  validateStoredDataset,
} from '../HuggingFaceImportService.js';
import { importActivityLog } from '../ImportActivityLog.js';
import {
  checkInfo,
  checkManifest,
  DatasetUploadError,
  partSizeOf,
  resolveChunkSize,
  uploadLimits,
  type IgnoredFile,
  type UploadFileEntry,
  type UploadLimits,
} from './uploadManifest.js';
import {
  createUploadSink,
  openUploadSink,
  type ReceivedFile,
  type UploadSink,
} from './UploadSink.js';
import {
  assembleAndVerify,
  assertNothingMissing,
  fileView,
  notAcceptingError,
  PartReceiver,
  progressOf,
  totalBytesOf,
  type UploadFileStatus,
  type UploadFileView,
} from './uploadSession.js';

export { MAX_MISSING_LISTED } from './uploadSession.js';
export type { UploadFileStatus, UploadFileView } from './uploadSession.js';

/** How often a running upload says where it is on the wire. */
export const UPLOAD_PROGRESS_INTERVAL_MS = 500;
/** How often an active upload's `lastActivityAt` is written; far under any idle limit. */
export const UPLOAD_TOUCH_INTERVAL_MS = 15_000;
export const UPLOAD_REAP_INTERVAL_MS = 5 * 60_000;

// ============================================================================
// CONTRACT TYPES
// ============================================================================

/** Body of `POST /api/datasets/uploads`. */
export interface StartUploadRequest {
  name?: unknown;
  description?: unknown;
  robotTypeId?: unknown;
  /** The parsed contents of the dataset's `meta/info.json`. */
  info?: unknown;
  files?: unknown;
  chunkSize?: unknown;
}

export interface StartUploadResponse {
  datasetId: string;
  status: 'uploading';
  state: 'uploading';
  robotTypeId: string;
  storage: 'local' | 'rustfs';
  chunkSize: number;
  totalBytes: number;
  files: UploadFileView[];
  ignored: IgnoredFile[];
  idleTimeoutSeconds: number;
  expiresAt: string;
}

export interface UploadStatusResponse {
  datasetId: string;
  state: DatasetUploadState;
  /** The Dataset row's status — the verdict once `state` is `completed`. */
  status: string;
  storage: 'local' | 'rustfs';
  chunkSize: number;
  totalBytes: number;
  receivedBytes: number;
  totalFiles: number;
  completedFiles: number;
  /** Every part of every file is held; `finish` will be accepted. */
  readyToFinish: boolean;
  files: UploadFileStatus[];
  lastActivityAt: string;
  /** When an idle upload is reaped; null once it is no longer `uploading`. */
  expiresAt: string | null;
  importError: DatasetImportError | null;
}

export interface PartReceipt {
  datasetId: string;
  fileId: number;
  partNumber: number;
  size: number;
  sha256: string;
  /** Every part of this file has now been received in this server's count. */
  fileComplete: boolean;
}

export interface FinishUploadResponse {
  datasetId: string;
  state: DatasetUploadState;
  status: string;
  message: string;
}

export interface CancelUploadResponse {
  datasetId: string;
  status: 'cancelled';
  message: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export interface DatasetUploadDeps {
  sessions: DatasetUploadStore;
  createSink: (storageId: string) => UploadSink;
  openSink: (kind: 'local' | 'rustfs', storagePath: string) => UploadSink;
  limits: () => UploadLimits;
  now: () => number;
}

/** What this process knows about a running upload, for progress — never for truth. */
interface LiveUpload {
  seeded: boolean;
  parts: Set<string>;
  bytes: number;
  completedFiles: Set<number>;
  lastEmitAt: number;
  lastTouchAt: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DatasetUploadService {
  private readonly deps: DatasetUploadDeps;
  private readonly receiver = new PartReceiver();
  private readonly live = new Map<string, LiveUpload>();
  private reaper: NodeJS.Timeout | null = null;

  constructor(deps: Partial<DatasetUploadDeps> = {}) {
    this.deps = {
      sessions: deps.sessions ?? datasetUploadRepository,
      createSink: deps.createSink ?? createUploadSink,
      openSink: deps.openSink ?? openUploadSink,
      limits: deps.limits ?? (() => uploadLimits()),
      now: deps.now ?? Date.now,
    };
  }

  // --------------------------------------------------------------------------
  // START
  // --------------------------------------------------------------------------

  /**
   * Check what the client declares and open the upload. Nothing is created
   * until every check has passed, and a failure after that removes what it made.
   */
  async start(request: StartUploadRequest): Promise<StartUploadResponse> {
    const limits = this.deps.limits();
    const name = typeof request.name === 'string' ? request.name.trim() : '';
    if (!name || name.length > 200) {
      throw new DatasetUploadError('INVALID_NAME', 'name is required (1 to 200 characters)');
    }
    if (request.description !== undefined && request.description !== null && typeof request.description !== 'string') {
      throw new DatasetUploadError('INVALID_REQUEST', 'description must be a string');
    }
    if (request.robotTypeId !== undefined && request.robotTypeId !== null && typeof request.robotTypeId !== 'string') {
      throw new DatasetUploadError('INVALID_REQUEST', 'robotTypeId must be a string');
    }
    const info = checkInfo(request.info);
    const chunkSize = resolveChunkSize(request.chunkSize, limits);
    const manifest = checkManifest(request.files, info, chunkSize, limits);

    // Storage before the robot type: resolving the type can create one, and a
    // refusal here must leave nothing behind (the importer's order, #368).
    const sink = this.deps.createSink(uuidv4());
    const free = await sink.freeBytes(limits.storeCapacityBytes);
    if (free !== null && manifest.totalBytes > free) {
      throw new DatasetUploadError(
        'INSUFFICIENT_STORAGE',
        `The dataset is ${formatBytes(manifest.totalBytes)} and the dataset store has ${formatBytes(free)} free. `
          + 'Delete datasets that are no longer needed, or upload without the camera files.',
        507,
        { totalBytes: manifest.totalBytes, freeBytes: free },
      );
    }

    let robotTypeId: string;
    try {
      robotTypeId = await huggingFaceImportService.resolveRobotTypeId(
        typeof request.robotTypeId === 'string' && request.robotTypeId ? request.robotTypeId : undefined,
        info,
      );
    } catch (error) {
      if (error instanceof HuggingFaceImportError) {
        throw new DatasetUploadError(error.code, error.message.replace(/\bimport this dataset\b/, 'upload this dataset'), error.status);
      }
      if (error instanceof Error && error.message.startsWith('Robot type not found')) {
        throw new DatasetUploadError('ROBOT_TYPE_NOT_FOUND', error.message, 404);
      }
      throw error;
    }

    const files = await sink.prepare(manifest.files);
    let datasetId: string | null = null;
    try {
      const fps = Number(info.fps) || 0;
      const totalFrames = Number(info.total_frames ?? 0) || 0;
      const input: CreateDatasetInput = {
        name,
        description: typeof request.description === 'string' && request.description.trim()
          ? request.description
          : 'Uploaded directly',
        robotTypeId,
        storagePath: sink.storagePath,
        lerobotVersion: info.codebase_version,
        fps,
        totalFrames,
        totalDuration: fps > 0 ? totalFrames / fps : 0,
        demonstrationCount: Number(info.total_episodes ?? 0) || 0,
        status: 'uploading',
        importMode: manifest.importMode,
      };
      const created = await datasetRepository.create(input);
      datasetId = created.id;
      await this.deps.sessions.create({
        datasetId,
        state: 'uploading',
        sink: sink.kind,
        storagePath: sink.storagePath,
        chunkSize,
        files,
      });
    } catch (error) {
      await sink.discard(files).catch(() => undefined);
      if (datasetId) await datasetRepository.delete(datasetId).catch(() => undefined);
      throw error;
    }

    const now = this.deps.now();
    this.live.set(datasetId, {
      seeded: true, parts: new Set(), bytes: 0, completedFiles: new Set(), lastEmitAt: 0, lastTouchAt: now,
    });
    importActivityLog.start(datasetId);
    this.log(datasetId, 'info', `Upload of "${name}" started: ${files.length} files, ${formatBytes(manifest.totalBytes)}`);
    this.log(
      datasetId,
      'info',
      `info.json: LeRobot ${info.codebase_version}, robot ${info.robot_type}, `
        + `${info.total_episodes ?? 0} episodes, ${info.total_frames ?? 0} frames at ${info.fps} fps`,
    );
    this.log(datasetId, 'info', `Storage: ${sink.kind === 'rustfs' ? 'RustFS' : 'local disk'} at ${sink.storagePath}`);
    if (manifest.ignored.length > 0) {
      this.log(datasetId, 'info', `${manifest.ignored.length} declared file(s) are not part of a LeRobot tree and are left out`);
    }
    this.emitProgress(datasetId, {
      datasetId,
      status: 'uploading',
      phase: 'uploading',
      progress: 5,
      totalFiles: files.length,
      completedFiles: 0,
      downloadedBytes: 0,
      totalBytes: manifest.totalBytes,
      importMode: manifest.importMode,
    });
    const response = await datasetService.get(datasetId).catch(() => null);
    datasetService.emit('dataset:event', {
      type: 'dataset:created',
      datasetId,
      ...(response ? { dataset: response } : {}),
      timestamp: new Date(now).toISOString(),
    });
    console.log(`[DatasetUpload] ${datasetId} started: ${files.length} files, ${manifest.totalBytes} bytes → ${sink.kind} ${sink.storagePath}`);

    return {
      datasetId,
      status: 'uploading',
      state: 'uploading',
      robotTypeId,
      storage: sink.kind,
      chunkSize,
      totalBytes: manifest.totalBytes,
      files: files.map(fileView),
      ignored: manifest.ignored,
      idleTimeoutSeconds: Math.round(limits.idleMs / 1000),
      expiresAt: new Date(now + limits.idleMs).toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // LOOKUP
  // --------------------------------------------------------------------------

  /**
   * The dataset FIRST, through the tenant-scoped repository: the session table
   * carries no tenant, so this is what stops one organization from driving
   * another's upload by guessing its id.
   */
  private async load(datasetId: string): Promise<{ session: DatasetUploadSession; status: string; importError: DatasetImportError | null }> {
    const dataset = await datasetRepository.findById(datasetId);
    if (!dataset) throw new DatasetUploadError('NOT_FOUND', 'Dataset not found', 404);
    const session = await this.deps.sessions.find(datasetId);
    if (!session) {
      throw new DatasetUploadError('NO_UPLOAD', 'This dataset has no direct upload; start one with POST /api/datasets/uploads', 404);
    }
    return { session, status: dataset.status, importError: dataset.importError ?? null };
  }

  /** Whether `datasetId` is (or was) filled by a direct upload that is not completed. */
  async hasOpenUpload(datasetId: string): Promise<boolean> {
    const session = await this.deps.sessions.find(datasetId);
    return session !== null && session.state !== 'completed';
  }

  // --------------------------------------------------------------------------
  // STATUS
  // --------------------------------------------------------------------------

  async status(datasetId: string): Promise<UploadStatusResponse> {
    const { session, status, importError } = await this.load(datasetId);
    const limits = this.deps.limits();
    let received: Map<number, ReceivedFile> | null = null;
    if (session.state === 'uploading') {
      received = await this.deps.openSink(session.sink, session.storagePath)
        .received(session.files, session.chunkSize);
      this.seedLive(session, received);
    }
    const progress = progressOf(session.files, session.chunkSize, received, session.state);
    return {
      datasetId,
      state: session.state,
      status,
      storage: session.sink,
      chunkSize: session.chunkSize,
      totalBytes: totalBytesOf(session.files),
      receivedBytes: progress.receivedBytes,
      totalFiles: progress.files.length,
      completedFiles: progress.completedFiles,
      readyToFinish: progress.readyToFinish,
      files: progress.files,
      lastActivityAt: session.lastActivityAt.toISOString(),
      expiresAt: session.state === 'uploading'
        ? new Date(session.lastActivityAt.getTime() + limits.idleMs).toISOString()
        : null,
      importError,
    };
  }

  // --------------------------------------------------------------------------
  // PARTS
  // --------------------------------------------------------------------------

  /**
   * Stream one part from `source` into the store.
   *
   * `contentLength` must be the exact length of this part: it is what lets the
   * body go to the store as it arrives instead of being held to be measured.
   * Everything that can be refused is refused before the first byte is read.
   */
  async receivePart(
    datasetId: string,
    fileId: number,
    partNumber: number,
    source: Readable,
    options: { contentLength: number | null; sha256?: string | null },
  ): Promise<PartReceipt> {
    const { session } = await this.load(datasetId);
    if (session.state !== 'uploading') throw notAcceptingError(session.state);
    const sink = this.deps.openSink(session.sink, session.storagePath);
    const part = await this.receiver.receive({
      uploadId: datasetId,
      files: session.files,
      chunkSize: session.chunkSize,
      sink,
      fileId,
      partNumber,
      source,
      contentLength: options.contentLength,
      sha256: options.sha256,
      maxConcurrentParts: this.deps.limits().maxConcurrentParts,
      storeName: 'dataset store',
      logTag: '[DatasetUpload]',
      currentState: async () => (await this.deps.sessions.find(datasetId))?.state ?? null,
    });
    const fileComplete = part.state === 'uploading'
      ? this.recordPart(session, part.file, partNumber, part.size)
      : true;
    return { datasetId, fileId: part.file.id, partNumber, size: part.size, sha256: part.sha256, fileComplete };
  }

  // --------------------------------------------------------------------------
  // PROGRESS
  // --------------------------------------------------------------------------

  private liveOf(datasetId: string): LiveUpload {
    let live = this.live.get(datasetId);
    if (!live) {
      live = { seeded: false, parts: new Set(), bytes: 0, completedFiles: new Set(), lastEmitAt: 0, lastTouchAt: 0 };
      this.live.set(datasetId, live);
    }
    return live;
  }

  /** Replace this process's count with what the store holds. */
  private seedLive(session: DatasetUploadSession, received: Map<number, ReceivedFile>): void {
    const live = this.liveOf(session.datasetId);
    live.parts = new Set();
    live.completedFiles = new Set();
    live.bytes = 0;
    for (const file of session.files) {
      const got = received.get(file.id);
      for (const partNumber of got?.parts ?? []) {
        live.parts.add(`${file.id}:${partNumber}`);
        live.bytes += partSizeOf(file, partNumber, session.chunkSize);
      }
      if ((got?.parts.length ?? 0) === file.partCount) live.completedFiles.add(file.id);
    }
    live.seeded = true;
  }

  /** Count a stored part, say so when it completes a file, and keep the session alive. */
  private recordPart(session: DatasetUploadSession, file: UploadFileEntry, partNumber: number, size: number): boolean {
    const datasetId = session.datasetId;
    const live = this.liveOf(datasetId);
    const key = `${file.id}:${partNumber}`;
    if (!live.parts.has(key)) {
      live.parts.add(key);
      live.bytes += size;
    }
    let held = 0;
    for (let n = 1; n <= file.partCount; n++) if (live.parts.has(`${file.id}:${n}`)) held++;
    const fileComplete = held === file.partCount;
    if (fileComplete && !live.completedFiles.has(file.id)) {
      live.completedFiles.add(file.id);
      this.log(datasetId, 'info', `Received ${file.path} (${formatBytes(file.size)})`);
    }
    const now = this.deps.now();
    if (now - live.lastTouchAt >= UPLOAD_TOUCH_INTERVAL_MS) {
      live.lastTouchAt = now;
      runInBackground(`[DatasetUpload] could not record activity for ${datasetId}:`, () =>
        this.deps.sessions.touch(datasetId, new Date(now)));
    }
    if (now - live.lastEmitAt >= UPLOAD_PROGRESS_INTERVAL_MS) {
      live.lastEmitAt = now;
      const totalBytes = totalBytesOf(session.files);
      // After a restart this process has only seen the parts sent since; the
      // bar then under-reads until a status call reseeds it from the store.
      const fraction = totalBytes > 0 ? Math.min(1, live.bytes / totalBytes) : 1;
      this.emitProgress(datasetId, {
        datasetId,
        status: 'uploading',
        phase: 'uploading',
        progress: Math.round(5 + fraction * 80),
        currentFile: file.path,
        totalFiles: session.files.length,
        completedFiles: live.completedFiles.size,
        downloadedBytes: live.bytes,
        totalBytes,
      });
    }
    return fileComplete;
  }

  private emitProgress(datasetId: string, progress: HuggingFaceImportProgress): void {
    importActivityLog.setProgress(datasetId, progress);
    datasetService.emit('dataset:event', {
      type: 'dataset:import:progress',
      datasetId,
      importProgress: progress,
      timestamp: new Date().toISOString(),
    });
  }

  private log(datasetId: string, level: ImportLogLevel, message: string): void {
    const line = importActivityLog.append(datasetId, level, message);
    datasetService.emit('dataset:event', {
      type: 'dataset:import:log',
      datasetId,
      log: line,
      timestamp: line.at,
    });
  }

  // --------------------------------------------------------------------------
  // FINISH
  // --------------------------------------------------------------------------

  /**
   * Accept the upload as complete, or say exactly what is missing.
   *
   * Answers as soon as the store has confirmed every part is held. Assembling,
   * checksumming and validating follow in the background; the dataset's status
   * is what a client polls. Calling it again while that runs, or after, is
   * answered with where the upload is rather than an error.
   */
  async finish(datasetId: string): Promise<FinishUploadResponse> {
    const { session, status } = await this.load(datasetId);
    if (session.state === 'processing' || session.state === 'completed') {
      return {
        datasetId,
        state: session.state,
        status,
        message: session.state === 'processing' ? 'The upload is already being finished' : 'The upload is already finished',
      };
    }
    if (session.state !== 'uploading') throw notAcceptingError(session.state);

    const sink = this.deps.openSink(session.sink, session.storagePath);
    const received = await sink.received(session.files, session.chunkSize);
    assertNothingMissing(session.files, session.chunkSize, received, formatBytes);

    if (!await this.deps.sessions.transition(datasetId, ['uploading'], 'processing')) {
      // Another finish (or a cancel) won; report where it stands now.
      const current = await this.deps.sessions.find(datasetId);
      if (!current || current.state === 'cancelling') throw notAcceptingError('cancelling');
      return { datasetId, state: current.state, status, message: 'The upload is already being finished' };
    }
    this.log(datasetId, 'info', `All ${session.files.length} files received; assembling and verifying`);
    runInBackground(`[DatasetUpload] finishing ${datasetId} failed:`, () => this.process(datasetId));
    return {
      datasetId,
      state: 'processing',
      status,
      message: 'Upload received; the dataset is being assembled and validated. Poll GET /api/datasets/:id/upload or GET /api/datasets/:id.',
    };
  }

  /** Assemble, verify, hand to validation. Runs detached; records its own failure. */
  private async process(datasetId: string): Promise<void> {
    const session = await this.deps.sessions.find(datasetId);
    if (!session || session.state !== 'processing') return;
    const totalBytes = totalBytesOf(session.files);
    const totals = {
      totalFiles: session.files.length,
      completedFiles: session.files.length,
      downloadedBytes: totalBytes,
      totalBytes,
    };
    let phase: 'storing' | 'validating' = 'storing';
    try {
      // A re-sent part still in flight would change an ETag under the assembly.
      await this.receiver.settle(datasetId, false);
      this.emitProgress(datasetId, { datasetId, status: 'uploading', phase, progress: 86, ...totals });

      await assembleAndVerify(
        this.deps.openSink(session.sink, session.storagePath),
        session.files,
        session.chunkSize,
        { storeName: 'dataset store', log: (message) => this.log(datasetId, 'info', message) },
      );
      await this.deps.sessions.transition(datasetId, ['processing'], 'completed');
      this.live.delete(datasetId);

      phase = 'validating';
      this.emitProgress(datasetId, { datasetId, status: 'validating', phase, progress: 90, ...totals });
      await validateStoredDataset(datasetId, session.storagePath, session.files.length, {
        what: 'Upload',
        log: (level, message) => this.log(datasetId, level, message),
        progress: (frame) => this.emitProgress(datasetId, { datasetId, phase: 'validating', ...totals, ...frame }),
      });
      console.log(`[DatasetUpload] ${datasetId} finished and handed to validation`);
    } catch (error) {
      // Every file is stored and the row says `validating`; only the queueing
      // died because shutdown closed NATS. The startup requeue picks it up.
      if (phase === 'validating' && isNatsConnectionClosed(error)) {
        console.warn(`[DatasetUpload] NATS closed before the validation of ${datasetId} was queued; left for the startup requeue`);
        return;
      }
      // The store is away, not the dataset wrong: stay `processing`, and the
      // recovery hook runs this again when the store is back.
      if (phase === 'storing' && error instanceof DatasetUploadError && error.code === 'STORAGE_UNAVAILABLE') {
        console.warn(`[DatasetUpload] ${datasetId}: storage unavailable while finishing; will resume when it is back`);
        this.log(datasetId, 'warn', 'Storage unavailable — finishing resumes when it is back');
        return;
      }
      console.error(`[DatasetUpload] ${datasetId} failed while ${phase}:`, error);
      await this.recordFailure(session, phase, error, totals);
    }
  }

  private async recordFailure(
    session: DatasetUploadSession,
    phase: 'storing' | 'validating',
    error: unknown,
    totals: Pick<HuggingFaceImportProgress, 'totalFiles' | 'completedFiles' | 'downloadedBytes' | 'totalBytes'>,
  ): Promise<void> {
    const datasetId = session.datasetId;
    const message = messageOf(error);
    this.log(datasetId, 'error', `Failed during ${phase}: ${message}`);
    await this.deps.sessions.transition(datasetId, ['processing'], 'failed');
    await datasetRepository.update(datasetId, {
      status: 'failed',
      importError: { phase, error: message, failedAt: new Date().toISOString(), sink: session.sink },
    });
    this.emitProgress(datasetId, { datasetId, status: 'failed', phase, progress: 86, ...totals, error: message });
    datasetService.emit('dataset:event', {
      type: 'dataset:import:failed',
      datasetId,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Take up every upload a restart cut off between `finish` and validation.
   * Each step of `process` is safe to repeat: a file already assembled is
   * skipped, and the checks only read.
   */
  async resumeInterrupted(): Promise<string[]> {
    const sessions = await this.deps.sessions.list(['processing']);
    for (const session of sessions) {
      runInBackground(`[DatasetUpload] finishing ${session.datasetId} failed:`, () => this.process(session.datasetId));
    }
    return sessions.map((s) => s.datasetId);
  }

  // --------------------------------------------------------------------------
  // CANCEL, DELETE, EXPIRY
  // --------------------------------------------------------------------------

  /** Stop the upload and remove it: open multipart uploads, parts, files and the dataset row. */
  async cancel(datasetId: string): Promise<CancelUploadResponse> {
    const { session } = await this.load(datasetId);
    if (session.state === 'processing') {
      throw new DatasetUploadError('UPLOAD_PROCESSING', 'The upload is being finished and can no longer be cancelled; delete the dataset once it has settled.', 409, { state: session.state });
    }
    if (session.state === 'completed') {
      throw new DatasetUploadError('UPLOAD_COMPLETED', 'The upload is finished; delete the dataset with DELETE /api/datasets/:id instead.', 409, { state: session.state });
    }
    await this.remove(session, 'Cancelled by the client');
    return { datasetId, status: 'cancelled', message: 'Upload cancelled; everything it stored was removed' };
  }

  /**
   * Called before a dataset is deleted: release what only the session knows
   * about — parts being streamed right now, and multipart uploads a prefix
   * delete does not touch. A no-op for a dataset with no upload, or a finished one.
   */
  async releaseForDelete(datasetId: string): Promise<void> {
    const session = await this.deps.sessions.find(datasetId);
    if (!session || session.state === 'completed') return;
    if (session.state === 'processing') {
      throw new DatasetUploadError('UPLOAD_PROCESSING', 'The upload of this dataset is being finished; delete it once it has settled.', 409, { state: session.state });
    }
    await this.discard(session);
  }

  /** Stop taking parts for `session` and remove everything it stored. */
  private async discard(session: DatasetUploadSession): Promise<void> {
    const datasetId = session.datasetId;
    // First, and before anything is removed: from here no new part is accepted,
    // and if the rest dies halfway the reaper finds the row and finishes it.
    if (!await this.deps.sessions.transition(datasetId, ['uploading', 'failed', 'cancelling'], 'cancelling')) {
      // A finish won the race since the caller looked: its files are being
      // assembled right now and are not this call's to delete.
      const current = await this.deps.sessions.find(datasetId);
      if (current) {
        throw new DatasetUploadError(
          current.state === 'completed' ? 'UPLOAD_COMPLETED' : 'UPLOAD_PROCESSING',
          'The upload was finished in the meantime and can no longer be cancelled.',
          409,
          { state: current.state },
        );
      }
    }
    await this.receiver.settle(datasetId, true);
    await this.deps.openSink(session.sink, session.storagePath).discard(session.files);
    this.live.delete(datasetId);
  }

  private async remove(session: DatasetUploadSession, reason: string): Promise<void> {
    await this.discard(session);
    // The row goes too: a dataset nothing was ever stored for is not a failed
    // dataset, and the session row leaves with it (ON DELETE CASCADE).
    await datasetService.delete(session.datasetId);
    await this.deps.sessions.delete(session.datasetId);
    console.log(`[DatasetUpload] ${session.datasetId} removed: ${reason}`);
  }

  /**
   * Remove every upload nothing was sent to for the idle time, and finish any
   * cancel that did not get to its end. Returns the dataset ids it removed.
   */
  async reapIdle(): Promise<string[]> {
    const cutoff = new Date(this.deps.now() - this.deps.limits().idleMs);
    const stale = [
      ...await this.deps.sessions.list(['cancelling']),
      ...await this.deps.sessions.list(['uploading'], cutoff),
    ];
    const removed: string[] = [];
    for (const session of stale) {
      // A part is being streamed this moment: the upload is not idle, only its
      // activity mark is behind.
      if (session.state === 'uploading' && this.receiver.activeCount(session.datasetId) > 0) continue;
      try {
        const reason = session.state === 'cancelling'
          ? 'an interrupted cancel was completed'
          : `idle since ${session.lastActivityAt.toISOString()}`;
        await this.remove(session, reason);
        removed.push(session.datasetId);
      } catch (error) {
        console.warn(`[DatasetUpload] Could not remove the abandoned upload ${session.datasetId}:`, messageOf(error));
      }
    }
    return removed;
  }

  /** Reap on a timer. Safe to call twice; the timer never keeps the process alive. */
  startReaper(intervalMs = UPLOAD_REAP_INTERVAL_MS): void {
    if (this.reaper) return;
    const tick = () => runInBackground('[DatasetUpload] reaping idle uploads failed:', () => this.reapIdle());
    tick();
    this.reaper = setInterval(tick, intervalMs);
    this.reaper.unref();
  }

  stopReaper(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }

  /**
   * RustFS prefixes of uploads that are still running. Their multipart uploads
   * are open on purpose however old they are, so the stale-multipart sweep
   * (TASK-379) leaves them alone.
   */
  async openPrefixes(): Promise<string[]> {
    const sessions = await this.deps.sessions.list(['uploading', 'processing']);
    return sessions.filter((s) => s.sink === 'rustfs').map((s) => s.storagePath);
  }
}

export const datasetUploadService = new DatasetUploadService();

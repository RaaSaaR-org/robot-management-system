/**
 * @file UploadSink.ts
 * @description Where the parts of a direct dataset upload are put, and how the
 *              server later asks which of them it holds (TASK-480).
 * @feature datasets
 *
 * Two sinks, the same two the Hub importer has: a prefix in the RustFS
 * training-datasets bucket, and a directory under the local dataset root for a
 * server with no object store. Both end with the tree at `storagePath` exactly
 * as an import leaves it, which is what lets every reader serve an uploaded
 * dataset without knowing how it arrived.
 *
 * NOTHING HERE REMEMBERS WHAT ARRIVED. `received` asks the store: ListParts for
 * an open multipart upload, the object listing for everything else (the staging
 * directory, locally). A part is therefore never reported as received that the
 * store does not hold, re-sending one simply replaces it, and an upload can be
 * continued by a different process than the one that started it.
 */

import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'fs/promises';
import { basename, dirname, join, resolve as resolvePath, sep } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { BUCKETS } from '../../storage/model-storage.js';
import {
  getRustFSClient,
  getRustFSStatus,
  isRustFSConfigured,
  isRustFSInitialized,
  type MultipartPartInfo,
  type MultipartUploadInfo,
  type ObjectInfo,
} from '../../storage/rustfs-client.js';
import { storageUnavailableMessage } from '../../storage/availability.js';
import { datasetStorageRoot } from '../DatasetService.js';
import { isLocalStoragePath } from '../lerobot/DatasetTree.js';
import { DatasetUploadError, partSizeOf, type UploadFileEntry } from './uploadManifest.js';

/** The part of `RustFSClient` an upload drives; a Map-backed fake in the tests. */
export interface UploadObjectStore {
  createMultipartUpload(bucket: string, key: string, contentType?: string): Promise<string>;
  uploadPartStream(
    bucket: string, key: string, uploadId: string, partNumber: number,
    body: Readable | Buffer, length: number, signal?: AbortSignal,
  ): Promise<string>;
  listParts(bucket: string, key: string, uploadId: string): Promise<MultipartPartInfo[]>;
  completeMultipartUpload(
    bucket: string, key: string, uploadId: string,
    parts: Array<Pick<MultipartPartInfo, 'partNumber' | 'etag'>>,
  ): Promise<void>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
  listMultipartUploads(bucket: string, prefix?: string): Promise<MultipartUploadInfo[]>;
  putObjectStream(
    bucket: string, key: string, body: Readable | Buffer, length: number,
    options?: { contentType?: string; signal?: AbortSignal },
  ): Promise<void>;
  listAll(bucket: string, prefix?: string): AsyncGenerator<ObjectInfo>;
  delete(bucket: string, key: string): Promise<void>;
  deletePrefix(bucket: string, prefix: string): Promise<number>;
  getStream(
    bucket: string, key: string,
    range?: { start: number; end: number },
    options?: { signal?: AbortSignal },
  ): Promise<Readable>;
}

export interface OpenFileOptions {
  range?: { start: number; end: number };
  signal?: AbortSignal;
}

/** A part the store has taken but the upload has not yet accepted. */
export interface PendingPart {
  /** Make the part count as received. */
  commit(): Promise<void>;
  /** Make sure the part does NOT count as received — its bytes failed the check. */
  rollback(): Promise<void>;
}

/** What the store holds of one file. */
export interface ReceivedFile {
  /** The whole file is in place at its final path with its declared size. */
  complete: boolean;
  /** Part numbers held with the right length (every part, when `complete`). */
  parts: number[];
}

export interface UploadSink {
  readonly kind: 'local' | 'rustfs';
  readonly storagePath: string;
  /** Free bytes where the upload will land, or null when the store cannot say. */
  freeBytes(capacityBytes: number | null): Promise<number | null>;
  /** Make the destination ready; returns the files with any store handle they need. */
  prepare(files: UploadFileEntry[]): Promise<UploadFileEntry[]>;
  /**
   * Store one part from `body`, which never emits `error` — a source that
   * fails is stopped through `signal`, and the call then rejects.
   */
  writePart(
    file: UploadFileEntry, partNumber: number, body: Readable, length: number,
    chunkSize: number, signal: AbortSignal,
  ): Promise<PendingPart>;
  received(files: UploadFileEntry[], chunkSize: number): Promise<Map<number, ReceivedFile>>;
  /** Join the parts of a multi-part file into the file at its final path. */
  assemble(file: UploadFileEntry, chunkSize: number): Promise<void>;
  /**
   * The bytes of a file at its final path — all of them for the whole-file
   * checksum, or the inclusive `range` a download asks for. The caller owns
   * the stream; `signal` gives it back when a reader walks away.
   */
  open(file: UploadFileEntry, options?: OpenFileOptions): Promise<Readable>;
  /** Drop what only the upload itself needed, once every file is in place. */
  finalize(): Promise<void>;
  /** Remove everything this upload wrote: open multipart uploads, parts, files. */
  discard(files: UploadFileEntry[]): Promise<void>;
}

/** The request body stopped before the part was stored. */
export class UploadAbortedError extends Error {
  constructor() {
    super('The upload of this part was interrupted');
    this.name = 'UploadAbortedError';
  }
}

function errorName(error: unknown): string | undefined {
  const e = error as { name?: string; Code?: string } | null;
  return e?.name ?? e?.Code;
}

function isNoSuchUpload(error: unknown): boolean {
  return errorName(error) === 'NoSuchUpload' || (error as { Code?: string } | null)?.Code === 'NoSuchUpload';
}

function contentTypeOf(path: string): string {
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.json') || path.endsWith('.jsonl')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function allParts(file: UploadFileEntry): number[] {
  return Array.from({ length: file.partCount }, (_, i) => i + 1);
}

/** Run `task` over `items`, at most `limit` at a time. */
async function mapLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

// ============================================================================
// RUSTFS
// ============================================================================

/** A prefix in the RustFS training-datasets bucket. */
export class RustFsUploadSink implements UploadSink {
  readonly kind = 'rustfs' as const;
  readonly storagePath: string;

  constructor(
    prefix: string,
    private readonly store: () => UploadObjectStore = getRustFSClient,
    private readonly bucket: string = BUCKETS.TRAINING_DATASETS,
  ) {
    this.storagePath = prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  private key(file: UploadFileEntry): string {
    // `file.path` passed `unsafePathReason` at start, so this cannot leave the prefix.
    return `${this.storagePath}${file.path}`;
  }

  async freeBytes(capacityBytes: number | null): Promise<number | null> {
    // S3 has no "how much room is left". With a declared capacity the answer is
    // that minus what every bucket holds; without one there is no answer.
    if (capacityBytes === null) return null;
    let used = 0;
    for (const bucket of Object.values(BUCKETS)) {
      try {
        for await (const object of this.store().listAll(bucket)) used += object.size;
      } catch (error) {
        if (errorName(error) !== 'NoSuchBucket') throw error;
      }
    }
    return Math.max(0, capacityBytes - used);
  }

  async prepare(files: UploadFileEntry[]): Promise<UploadFileEntry[]> {
    // Opened up front, one per multi-part file, so two parts of a file arriving
    // together can never each open an upload of their own.
    const prepared = files.map((file) => ({ ...file }));
    try {
      await mapLimited(prepared.filter((f) => f.partCount > 1), 8, async (file) => {
        file.uploadId = await this.store().createMultipartUpload(this.bucket, this.key(file), contentTypeOf(file.path));
      });
    } catch (error) {
      await this.discard(prepared).catch(() => undefined);
      throw error;
    }
    return prepared;
  }

  async writePart(
    file: UploadFileEntry, partNumber: number, body: Readable, length: number,
    _chunkSize: number, signal: AbortSignal,
  ): Promise<PendingPart> {
    const key = this.key(file);
    try {
      if (file.partCount === 1) {
        // An empty Readable has no length the SDK can sign for; an empty Buffer has.
        await this.store().putObjectStream(this.bucket, key, length === 0 ? Buffer.alloc(0) : body, length, {
          contentType: contentTypeOf(file.path),
          signal,
        });
        return {
          commit: async () => undefined,
          rollback: () => this.store().delete(this.bucket, key),
        };
      }
      const uploadId = this.requireUploadId(file);
      await this.store().uploadPartStream(this.bucket, key, uploadId, partNumber, body, length, signal);
      return {
        commit: async () => undefined,
        // A stored part cannot be deleted, only replaced. An empty part has the
        // wrong length, so `received` does not count it and the client is told
        // to send it again.
        rollback: async () => {
          await this.store().uploadPartStream(this.bucket, key, uploadId, partNumber, Buffer.alloc(0), 0);
        },
      };
    } catch (error) {
      if (signal.aborted) throw new UploadAbortedError();
      throw error;
    }
  }

  private requireUploadId(file: UploadFileEntry): string {
    if (!file.uploadId) throw new Error(`No multipart upload was opened for ${file.path}`);
    return file.uploadId;
  }

  async received(files: UploadFileEntry[], chunkSize: number): Promise<Map<number, ReceivedFile>> {
    const sizes = new Map<string, number>();
    for await (const object of this.store().listAll(this.bucket, this.storagePath)) {
      sizes.set(object.key, object.size);
    }
    const out = new Map<number, ReceivedFile>();
    const open: UploadFileEntry[] = [];
    for (const file of files) {
      if (sizes.get(this.key(file)) === file.size) {
        out.set(file.id, { complete: true, parts: allParts(file) });
      } else if (file.partCount === 1 || !file.uploadId) {
        out.set(file.id, { complete: false, parts: [] });
      } else {
        open.push(file);
      }
    }
    await mapLimited(open, 8, async (file) => {
      let parts: MultipartPartInfo[] = [];
      try {
        parts = await this.store().listParts(this.bucket, this.key(file), this.requireUploadId(file));
      } catch (error) {
        if (!isNoSuchUpload(error)) throw error;
      }
      out.set(file.id, {
        complete: false,
        parts: parts
          .filter((p) => p.partNumber >= 1 && p.partNumber <= file.partCount
            && p.size === partSizeOf(file, p.partNumber, chunkSize))
          .map((p) => p.partNumber),
      });
    });
    return out;
  }

  async assemble(file: UploadFileEntry, chunkSize: number): Promise<void> {
    const key = this.key(file);
    const uploadId = this.requireUploadId(file);
    const parts = await this.store().listParts(this.bucket, key, uploadId);
    const wanted = parts.filter((p) => p.partNumber <= file.partCount);
    const whole = wanted.length === file.partCount
      && wanted.every((p, i) => p.partNumber === i + 1 && p.size === partSizeOf(file, p.partNumber, chunkSize));
    if (!whole) {
      throw new Error(`${file.path}: the store holds ${wanted.length} of ${file.partCount} parts with the expected sizes`);
    }
    await this.store().completeMultipartUpload(this.bucket, key, uploadId, wanted);
  }

  async open(file: UploadFileEntry, options: OpenFileOptions = {}): Promise<Readable> {
    return this.store().getStream(
      this.bucket, this.key(file), options.range,
      options.signal ? { signal: options.signal } : undefined,
    );
  }

  async finalize(): Promise<void> {
    // A completed multipart upload leaves nothing behind.
  }

  async discard(files: UploadFileEntry[]): Promise<void> {
    const store = this.store();
    for (const file of files) {
      if (!file.uploadId) continue;
      try {
        await store.abortMultipartUpload(this.bucket, this.key(file), file.uploadId);
      } catch (error) {
        // Completed, or aborted before: either way it is not open any more.
        if (!isNoSuchUpload(error)) throw error;
      }
    }
    await store.deletePrefix(this.bucket, this.storagePath);
    await abortMultipartUploadsUnder(this.storagePath, store, this.bucket);
  }
}

/**
 * Abort every multipart upload still open under `prefix` and return how many.
 *
 * The session row names the uploads it opened, but a prefix delete does not
 * touch an open multipart upload at all — its parts are not objects — so this
 * is also what a dataset delete runs, whether or not a session row survives.
 */
export async function abortMultipartUploadsUnder(
  prefix: string,
  store: Pick<UploadObjectStore, 'listMultipartUploads' | 'abortMultipartUpload'> = getRustFSClient(),
  bucket: string = BUCKETS.TRAINING_DATASETS,
): Promise<number> {
  if (!prefix) throw new Error('abortMultipartUploadsUnder refuses an empty prefix');
  let aborted = 0;
  for (const upload of await store.listMultipartUploads(bucket, prefix)) {
    // The store filtered already; a store that ignores Prefix must not cost another dataset its upload.
    if (!upload.key.startsWith(prefix)) continue;
    try {
      await store.abortMultipartUpload(bucket, upload.key, upload.uploadId);
      aborted++;
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
    }
  }
  return aborted;
}

// ============================================================================
// LOCAL DISK
// ============================================================================

/** Where the parts of an upload into `root` wait until their file is whole. */
export function localStagingDir(root: string): string {
  const clean = resolvePath(root);
  return join(dirname(clean), '.upload-staging', basename(clean));
}

/** A LeRobot directory tree on this machine. */
export class LocalUploadSink implements UploadSink {
  readonly kind = 'local' as const;
  readonly storagePath: string;
  private readonly root: string;
  private readonly staging: string;

  constructor(
    root: string,
    /** What is stored here and which variable moves it — for the sentence of a refusal. */
    private readonly label: { what: string; variable: string } = { what: 'dataset', variable: 'DATASET_UPLOAD_DIR' },
  ) {
    this.root = resolvePath(root);
    this.storagePath = `${this.root}/`;
    this.staging = localStagingDir(this.root);
  }

  private finalPath(file: UploadFileEntry): string {
    const full = resolvePath(this.root, file.path);
    // The manifest check already refused such a path; this is the second lock.
    if (!full.startsWith(this.root + sep)) {
      throw new DatasetUploadError('INVALID_PATH', `${file.path} would land outside the ${this.label.what} root`);
    }
    return full;
  }

  private partPath(file: UploadFileEntry, partNumber: number): string {
    return join(this.staging, String(file.id), String(partNumber));
  }

  async freeBytes(): Promise<number | null> {
    try {
      const stats = await statfs(dirname(this.root));
      return stats.bavail * stats.bsize;
    } catch {
      return null;
    }
  }

  async prepare(files: UploadFileEntry[]): Promise<UploadFileEntry[]> {
    try {
      // The root exists from the first moment the row does, so
      // `isLocalStoragePath` — an `existsSync` — never calls it a RustFS prefix.
      await mkdir(this.root, { recursive: true });
      await mkdir(this.staging, { recursive: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') {
        throw new DatasetUploadError(
          'STORAGE_UNAVAILABLE',
          `Local ${this.label.what} storage ${this.root} is not writable (${code}); `
            + `set ${this.label.variable} to a writable path or configure RustFS.`,
          503,
        );
      }
      throw error;
    }
    return files.map((file) => ({ ...file }));
  }

  async writePart(
    file: UploadFileEntry, partNumber: number, body: Readable, _length: number,
    _chunkSize: number, signal: AbortSignal,
  ): Promise<PendingPart> {
    const destination = file.partCount === 1 ? this.finalPath(file) : this.partPath(file, partNumber);
    await mkdir(this.staging, { recursive: true });
    const temporary = join(this.staging, `${file.id}.${partNumber}.${uuidv4()}.partial`);
    const out = createWriteStream(temporary);
    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          out.destroy();
          reject(new UploadAbortedError());
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        out.once('error', reject);
        out.once('finish', () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
        body.pipe(out);
      });
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return {
      // A rename, so a part is either wholly there or not there at all.
      commit: async () => {
        await mkdir(dirname(destination), { recursive: true });
        await rename(temporary, destination);
      },
      rollback: () => rm(temporary, { force: true }),
    };
  }

  private async sizeOf(path: string): Promise<number | null> {
    try {
      const stats = await stat(path);
      return stats.isFile() ? stats.size : null;
    } catch {
      return null;
    }
  }

  async received(files: UploadFileEntry[], chunkSize: number): Promise<Map<number, ReceivedFile>> {
    const out = new Map<number, ReceivedFile>();
    await mapLimited(files, 16, async (file) => {
      if (await this.sizeOf(this.finalPath(file)) === file.size) {
        out.set(file.id, { complete: true, parts: allParts(file) });
        return;
      }
      const parts: number[] = [];
      if (file.partCount > 1) {
        const names = await readdir(join(this.staging, String(file.id))).catch(() => [] as string[]);
        for (const name of names) {
          const partNumber = Number(name);
          if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > file.partCount) continue;
          if (await this.sizeOf(this.partPath(file, partNumber)) === partSizeOf(file, partNumber, chunkSize)) {
            parts.push(partNumber);
          }
        }
      }
      out.set(file.id, { complete: false, parts: parts.sort((a, b) => a - b) });
    });
    return out;
  }

  async assemble(file: UploadFileEntry): Promise<void> {
    const destination = this.finalPath(file);
    const temporary = join(this.staging, `${file.id}.assembled.${uuidv4()}.partial`);
    try {
      for (let partNumber = 1; partNumber <= file.partCount; partNumber++) {
        await pipeline(
          createReadStream(this.partPath(file, partNumber)),
          createWriteStream(temporary, { flags: partNumber === 1 ? 'w' : 'a' }),
        );
      }
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    await rm(join(this.staging, String(file.id)), { recursive: true, force: true });
  }

  async open(file: UploadFileEntry, options: OpenFileOptions = {}): Promise<Readable> {
    const stream = createReadStream(this.finalPath(file), options.range ?? {});
    const signal = options.signal;
    if (signal) {
      const release = (): void => { stream.destroy(); };
      if (signal.aborted) release();
      else {
        signal.addEventListener('abort', release, { once: true });
        stream.once('close', () => signal.removeEventListener('abort', release));
      }
    }
    return stream;
  }

  async finalize(): Promise<void> {
    await rm(this.staging, { recursive: true, force: true });
  }

  async discard(): Promise<void> {
    await rm(this.staging, { recursive: true, force: true });
    await rm(this.root, { recursive: true, force: true });
  }
}

// ============================================================================
// WHICH ONE
// ============================================================================

/**
 * The sink a NEW upload writes to, decided once — the importer's rule
 * (`createSink`): RustFS when it is up, a 503 while it is configured but down,
 * and the local dataset root only for a server with no object store at all.
 */
export function createUploadSink(storageId: string): UploadSink {
  if (isRustFSInitialized()) return new RustFsUploadSink(`${storageId}/`);
  if (isRustFSConfigured()) {
    throw new DatasetUploadError(
      'STORAGE_UNAVAILABLE',
      storageUnavailableMessage(getRustFSStatus().errorKind),
      503,
      { state: getRustFSStatus().state, errorKind: getRustFSStatus().errorKind },
    );
  }
  return new LocalUploadSink(join(datasetStorageRoot(), storageId));
}

/**
 * The sink an EXISTING upload was started with — never the one the current
 * configuration would pick. A local upload whose directory is inside the
 * dataset root is opened even when that directory is gone, so a cancel can
 * still clear its staging files.
 */
export function openUploadSink(kind: 'local' | 'rustfs', storagePath: string): UploadSink {
  if (kind === 'local') {
    const root = resolvePath(storagePath);
    const base = datasetStorageRoot();
    if (!root.startsWith(base + sep) && !isLocalStoragePath(storagePath)) {
      throw new DatasetUploadError('STORAGE_UNAVAILABLE', `Local dataset storage ${storagePath} is not available`, 503);
    }
    return new LocalUploadSink(root);
  }
  if (!isRustFSInitialized()) {
    throw new DatasetUploadError(
      'STORAGE_UNAVAILABLE',
      storageUnavailableMessage(getRustFSStatus().errorKind),
      503,
      { state: getRustFSStatus().state, errorKind: getRustFSStatus().errorKind },
    );
  }
  return new RustFsUploadSink(storagePath);
}

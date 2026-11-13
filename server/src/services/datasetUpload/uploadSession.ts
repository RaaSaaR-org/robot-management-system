/**
 * @file uploadSession.ts
 * @description The part of a direct upload that does not care what is being
 *              uploaded: streaming one part into a sink, reading what the store
 *              holds, saying what is missing, and assembling and verifying the
 *              files once every part is there.
 * @feature storage
 *
 * Two uploads run on this: a LeRobot dataset (TASK-480, `DatasetUploadService`)
 * and a model checkpoint (TASK-498, `ModelUploadService`). They differ in what
 * they check before the first byte and in what they do with the stored tree —
 * a dataset is validated, a model is registered — and in nothing between. The
 * between is here, once, so both keep the same resume, the same refusals and
 * the same guarantee that a part is stored whole or not at all.
 */

import { createHash } from 'crypto';
import { Transform, type Readable } from 'stream';
import {
  DatasetUploadError,
  HARD_MAX_CHUNK_BYTES,
  partSizeOf,
  type UploadFileEntry,
} from './uploadManifest.js';
import { UploadAbortedError, type ReceivedFile, type UploadSink } from './UploadSink.js';

/**
 * `cancelling` exists so a cancel that died halfway is finished by the reaper:
 * the row is the only record of which multipart uploads are still open.
 */
export type UploadState = 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelling';

/** Missing files listed in a refused `finish`; the count says how many there are in all. */
export const MAX_MISSING_LISTED = 50;

const SHA256_RE = /^[0-9a-f]{64}$/;

export interface UploadFileView {
  id: number;
  path: string;
  size: number;
  partCount: number;
}

export interface UploadFileStatus extends UploadFileView {
  complete: boolean;
  receivedParts: number[];
}

export function fileView(file: UploadFileEntry): UploadFileView {
  return { id: file.id, path: file.path, size: file.size, partCount: file.partCount };
}

export function totalBytesOf(files: UploadFileEntry[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

export async function sha256OfStream(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The refusal for a part, a finish or a cancel that arrives in the wrong state. */
export function notAcceptingError(state: UploadState): DatasetUploadError {
  const why = state === 'processing' ? 'it is being finished'
    : state === 'completed' ? 'it is finished'
      : state === 'failed' ? 'it failed' : 'it was cancelled';
  return new DatasetUploadError('UPLOAD_NOT_ACCEPTING', `This upload takes no more parts: ${why}.`, 409, { state });
}

// ============================================================================
// WHAT THE STORE HOLDS
// ============================================================================

export interface UploadProgressView {
  files: UploadFileStatus[];
  receivedBytes: number;
  completedFiles: number;
  /** Every part of every file is held; `finish` will be accepted. */
  readyToFinish: boolean;
}

/**
 * Per-file status from what the store reported. `received` is null once the
 * upload is past `uploading` — every file was then verified present by
 * `finish`, so they read complete (unless the upload is being torn down).
 */
export function progressOf(
  files: UploadFileEntry[],
  chunkSize: number,
  received: Map<number, ReceivedFile> | null,
  state: UploadState,
): UploadProgressView {
  const statuses: UploadFileStatus[] = files.map((file) => {
    const got = received ? received.get(file.id) : { complete: state !== 'cancelling', parts: [] };
    const complete = got?.complete ?? false;
    return {
      ...fileView(file),
      complete,
      receivedParts: complete
        ? Array.from({ length: file.partCount }, (_, i) => i + 1)
        : [...(got?.parts ?? [])].sort((a, b) => a - b),
    };
  });
  const receivedBytes = statuses.reduce((sum, file, index) => sum + file.receivedParts.reduce(
    (bytes, partNumber) => bytes + partSizeOf(files[index], partNumber, chunkSize), 0,
  ), 0);
  return {
    files: statuses,
    receivedBytes,
    completedFiles: statuses.filter((f) => f.receivedParts.length === f.partCount).length,
    readyToFinish: statuses.every((f) => f.receivedParts.length === f.partCount),
  };
}

export interface MissingFile {
  fileId: number;
  path: string;
  missingParts: number[];
}

/**
 * Refuse a `finish` while anything is missing, naming it. Returns when the
 * store holds every part of every file.
 */
export function assertNothingMissing(
  files: UploadFileEntry[],
  chunkSize: number,
  received: Map<number, ReceivedFile>,
  formatBytes: (bytes: number) => string,
): void {
  const missing: MissingFile[] = files
    .map((file) => {
      const got = received.get(file.id);
      const held = new Set(got?.complete ? [] : got?.parts ?? []);
      const missingParts = got?.complete
        ? []
        : Array.from({ length: file.partCount }, (_, i) => i + 1).filter((n) => !held.has(n));
      return { fileId: file.id, path: file.path, missingParts };
    })
    .filter((entry) => entry.missingParts.length > 0);
  if (missing.length === 0) return;
  const missingBytes = missing.reduce((sum, entry) => sum + entry.missingParts.reduce(
    (bytes, n) => bytes + partSizeOf(files[entry.fileId], n, chunkSize), 0,
  ), 0);
  throw new DatasetUploadError(
    'UPLOAD_INCOMPLETE',
    `${missing.length} of ${files.length} files are not fully uploaded (${formatBytes(missingBytes)} missing). `
      + 'Send the missing parts, then finish again.',
    409,
    { missingFiles: missing.length, missingBytes, missing: missing.slice(0, MAX_MISSING_LISTED) },
  );
}

/**
 * Join every multi-part file, check that each file is in the store with its
 * declared size, and read back the ones that declared a sha256.
 *
 * Every step is safe to repeat: a file already assembled is skipped and the
 * checks only read — which is what lets a restart take a `processing` upload
 * up again.
 */
export async function assembleAndVerify(
  sink: UploadSink,
  files: UploadFileEntry[],
  chunkSize: number,
  options: { storeName: string; log: (message: string) => void },
): Promise<void> {
  const before = await sink.received(files, chunkSize);
  for (const file of files) {
    if (before.get(file.id)?.complete) continue;
    if (file.partCount === 1) throw new Error(`${file.path} is no longer in the ${options.storeName}`);
    try {
      await sink.assemble(file, chunkSize);
    } catch (error) {
      // Joining a multi-gigabyte file can outlast the call that asked for it:
      // the store finishes, the answer is lost, and a retry of the request is
      // told the upload no longer exists. What counts is whether the file is
      // there now with its declared size.
      const now = await sink.received([file], chunkSize).catch(() => null);
      if (!now?.get(file.id)?.complete) throw error;
      options.log(`${file.path} was assembled although the store's answer was lost`);
      continue;
    }
    options.log(`Assembled ${file.path} from ${file.partCount} parts`);
  }

  const after = await sink.received(files, chunkSize);
  const short = files.find((file) => !after.get(file.id)?.complete);
  if (short) throw new Error(`${short.path} is not in the ${options.storeName} with its declared size of ${short.size} bytes`);

  const checksummed = files.filter((file) => file.sha256);
  for (const file of checksummed) {
    const actual = await sha256OfStream(await sink.open(file));
    if (actual !== file.sha256) {
      throw new Error(`Checksum mismatch for ${file.path}: the manifest declares sha256 ${file.sha256}, the stored file is ${actual}`);
    }
  }
  if (checksummed.length > 0) options.log(`Verified the sha256 of ${checksummed.length} file(s)`);

  await sink.finalize();
}

// ============================================================================
// RECEIVING PARTS
// ============================================================================

export interface ReceivePartRequest {
  /** The upload this part belongs to: what `settle` and `activeCount` are asked by. */
  uploadId: string;
  files: UploadFileEntry[];
  chunkSize: number;
  sink: UploadSink;
  fileId: number;
  partNumber: number;
  source: Readable;
  /** The request's `Content-Length`, or null when it carried none. */
  contentLength: number | null;
  /** `X-Chunk-Sha256`, when the client sent one. */
  sha256?: string | null;
  /** Parts streamed at once across every upload of this kind; one more is 503 `UPLOAD_BUSY`. */
  maxConcurrentParts: number;
  /** "dataset store" / "model store" — for the sentence a refusal carries. */
  storeName: string;
  /** Prefix of this upload's log lines. */
  logTag: string;
  /**
   * The upload's state now, asked after the bytes are stored and before the
   * part is committed; null when the upload is gone.
   */
  currentState: () => Promise<UploadState | null>;
}

export interface ReceivedPart {
  file: UploadFileEntry;
  partNumber: number;
  size: number;
  sha256: string;
  /** The state the upload was in when the part was committed. */
  state: UploadState;
}

/** One part request that is being streamed right now. */
interface ActivePart {
  abort(): void;
  done: Promise<void>;
}

/**
 * Streams parts into a sink and knows which are in flight.
 *
 * `contentLength` must be the exact length of the part: it is what lets the
 * body go to the store as it arrives instead of being held to be measured.
 * Everything that can be refused is refused before the first byte is read.
 */
export class PartReceiver {
  private readonly active = new Map<string, Set<ActivePart>>();
  private activeParts = 0;

  /** Parts of `uploadId` being streamed right now. */
  activeCount(uploadId: string): number {
    return this.active.get(uploadId)?.size ?? 0;
  }

  /** Wait for every part of `uploadId` that is being streamed right now, stopping them first when `abort`. */
  async settle(uploadId: string, abort: boolean): Promise<void> {
    const set = this.active.get(uploadId);
    if (!set || set.size === 0) return;
    const entries = [...set];
    if (abort) for (const entry of entries) entry.abort();
    await Promise.all(entries.map((entry) => entry.done));
  }

  async receive(request: ReceivePartRequest): Promise<ReceivedPart> {
    const { uploadId, files, chunkSize, sink, fileId, partNumber, source } = request;
    const file = Number.isInteger(fileId) ? files[fileId] : undefined;
    if (!file) {
      throw new DatasetUploadError('UNKNOWN_FILE', `This upload has no file ${fileId}; ids run from 0 to ${files.length - 1}`, 404);
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > file.partCount) {
      throw new DatasetUploadError(
        'UNKNOWN_PART',
        `${file.path} has parts 1 to ${file.partCount}; got ${partNumber}`,
        404,
        { fileId, partCount: file.partCount },
      );
    }
    const expected = partSizeOf(file, partNumber, chunkSize);
    if (request.contentLength === null) {
      throw new DatasetUploadError('LENGTH_REQUIRED', 'Content-Length is required: send each part with its exact length', 411, { expectedSize: expected });
    }
    if (request.contentLength !== expected) {
      throw new DatasetUploadError(
        'PART_SIZE_MISMATCH',
        `Part ${partNumber} of ${file.path} must be exactly ${expected} bytes; the request declares ${request.contentLength}.`,
        request.contentLength > HARD_MAX_CHUNK_BYTES ? 413 : 400,
        { fileId, partNumber, expectedSize: expected },
      );
    }
    const declared = request.sha256 ? request.sha256.trim().toLowerCase() : null;
    if (declared !== null && !SHA256_RE.test(declared)) {
      throw new DatasetUploadError('INVALID_CHECKSUM', 'X-Chunk-Sha256 must be 64 hex characters');
    }
    if (this.activeParts >= request.maxConcurrentParts) {
      throw new DatasetUploadError(
        'UPLOAD_BUSY',
        `The server is already receiving ${this.activeParts} parts; send this one again shortly.`,
        503,
        { retryAfterSeconds: 2 },
      );
    }

    const controller = new AbortController();
    const hash = createHash('sha256');
    let bytes = 0;
    // The store's client does not listen for `error` on its body, so this
    // stream never emits one: a source that dies aborts the request instead.
    const body = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    const stop = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      source.unpipe(body);
      body.destroy();
    };
    const onClose = () => {
      if (!source.readableEnded) stop();
    };
    source.once('error', stop);
    source.once('close', onClose);

    let settle!: () => void;
    const entry: ActivePart = { abort: stop, done: new Promise<void>((resolve) => { settle = resolve; }) };
    const set = this.active.get(uploadId) ?? new Set<ActivePart>();
    set.add(entry);
    this.active.set(uploadId, set);
    this.activeParts++;

    try {
      source.pipe(body);
      const pending = await sink.writePart(file, partNumber, body, expected, chunkSize, controller.signal)
        .catch((error: unknown) => {
          if (error instanceof UploadAbortedError || controller.signal.aborted) {
            throw new DatasetUploadError('PART_INTERRUPTED', 'The request ended before the part was complete; it was not kept.', 400);
          }
          console.error(`${request.logTag} ${uploadId}: storing part ${partNumber} of ${file.path} failed:`, error);
          throw new DatasetUploadError('STORE_ERROR', `The ${request.storeName} did not accept this part; send it again.`, 502);
        });
      const digest = hash.digest('hex');
      if (bytes !== expected) {
        await pending.rollback().catch(() => undefined);
        throw new DatasetUploadError('PART_SIZE_MISMATCH', `Part ${partNumber} of ${file.path} arrived as ${bytes} bytes; expected ${expected}.`, 400);
      }
      if (declared !== null && declared !== digest) {
        await pending.rollback().catch((error: unknown) => {
          console.error(`${request.logTag} ${uploadId}: could not discard a corrupt part ${partNumber} of ${file.path}:`, error);
        });
        throw new DatasetUploadError(
          'CHECKSUM_MISMATCH',
          `Part ${partNumber} of ${file.path} does not match X-Chunk-Sha256; it was not kept. Send it again.`,
          422,
          { fileId, partNumber, expected: declared, actual: digest },
        );
      }
      // A cancel that began after the checks above has already cleared the
      // prefix; a part that lands now would be an object nothing owns.
      const state = await request.currentState();
      // `processing` is not a reason to discard: finish is only accepted once
      // the store holds every part, so a part still in flight then is a second
      // copy of one it has counted — the first request of a part the client
      // re-sent after a timeout. Rolling that back would blank the part (or
      // delete the object) finish is about to assemble, and fail a complete
      // upload. The finishing side waits for this request (`settle`) before
      // it reads the parts.
      if (state !== 'uploading' && state !== 'processing') {
        await pending.rollback().catch(() => undefined);
        throw notAcceptingError(state ?? 'cancelling');
      }
      await pending.commit();
      return { file, partNumber, size: expected, sha256: digest, state };
    } finally {
      source.off('error', stop);
      source.off('close', onClose);
      // Nothing reads `body` any more; left piped, a refused part would stall
      // the request instead of letting the route drain it.
      source.unpipe(body);
      body.destroy();
      this.activeParts--;
      set.delete(entry);
      if (set.size === 0) this.active.delete(uploadId);
      settle();
    }
  }
}

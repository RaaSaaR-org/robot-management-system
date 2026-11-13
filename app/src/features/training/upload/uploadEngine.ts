/**
 * @file uploadEngine.ts
 * @description Sends a dataset's files to the direct upload API in parts: which
 *              refusals are worth another attempt and after how long, which
 *              bytes a part covers, a bounded number of parts in flight, and
 *              the "send what is missing, then finish" rounds (TASK-481).
 * @feature training
 *
 * No React and no store in here: the transport, the clock and the hash are
 * passed in, so the rules can be tested without a network or a timer.
 */

import {
  UploadRefusal,
  type PartAck,
  type PartRequest,
  type UploadFileEntry,
  type UploadFinishResponse,
  type UploadStatusFile,
  type UploadStatusResponse,
} from '../api/datasetUploadApi';

// ============================================================================
// TUNING
// ============================================================================

/** Part size the dialog asks for. The server allows 5 MiB up to its own (32 MiB). */
export const BROWSER_CHUNK_BYTES = 8 * 1024 * 1024;
/** Part requests in flight. The server streams four at once across all uploads. */
export const PARALLEL_PARTS = 3;

export interface Tuning {
  backoffBaseMs: number;
  maxPauseMs: number;
  /** Attempts per part (and per control call) before the upload stops */
  maxAttempts: number;
  /** `UPLOAD_BUSY` answers one part waits out; busy is not a failure */
  maxBusyWaits: number;
  /** Rounds of "send what is missing, then finish" */
  maxFinishRounds: number;
}

export const DEFAULT_TUNING: Tuning = {
  backoffBaseMs: 1000,
  maxPauseMs: 30_000,
  maxAttempts: 6,
  maxBusyWaits: 300,
  maxFinishRounds: 3,
};

// ============================================================================
// RETRIES
// ============================================================================

export type RetryClass =
  /** Other uploads hold the server's part slots: wait, not counted as a failure */
  | 'busy'
  /** Worth sending again after a pause */
  | 'transient'
  /** Sending it again cannot help */
  | 'fatal';

/**
 * Which refusals are worth another attempt — the contract's list ("Worth
 * retrying with a pause"), read the way the reference client reads it. Branches
 * on the status and the stable `code`, never on the sentence.
 */
export function classifyRefusal(status: number, code?: string | null): RetryClass {
  if (code === 'ABORTED') return 'fatal';
  // No answer: the network or a timeout is worth another attempt; anything
  // else without a status went wrong in the browser (a file that can no longer
  // be read) and will go wrong the same way again.
  if (status === 0) return code === 'NETWORK_ERROR' ? 'transient' : 'fatal';
  if (status === 503 && code === 'UPLOAD_BUSY') return 'busy';
  if (status === 400 && code === 'PART_INTERRUPTED') return 'transient';
  if (status === 422 && code === 'CHECKSUM_MISMATCH') return 'transient';
  if (status === 408 || status === 425 || status === 429) return 'transient';
  // 507 is "the store is full": no pause fixes that.
  if (status === 501 || status === 505 || status === 507) return 'fatal';
  if (status >= 500 && status <= 599) return 'transient';
  return 'fatal';
}

/**
 * Exponential pause with a little jitter, never shorter than the server's
 * `Retry-After`, never longer than `maxPauseMs`. `attempt` counts from 1.
 */
export function backoffMs(
  attempt: number,
  retryAfterSeconds: number | null,
  tuning: Tuning = DEFAULT_TUNING,
  random: () => number = Math.random,
): number {
  const exp = tuning.backoffBaseMs * 2 ** Math.min(Math.max(attempt - 1, 0), 8);
  const jitter = exp * random() * 0.25;
  const asked = (retryAfterSeconds ?? 0) * 1000;
  return Math.min(Math.max(exp + jitter, asked), tuning.maxPauseMs);
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

const aborted = () => new UploadRefusal({ status: 0, code: 'ABORTED', message: 'The upload was stopped.' });

/** A pause that ends early — by rejecting — when the upload is stopped. */
export const abortableSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    const onAbort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const asRefusal = (error: unknown): UploadRefusal =>
  error instanceof UploadRefusal
    ? error
    : new UploadRefusal({ status: 0, code: 'CLIENT_ERROR', message: error instanceof Error ? error.message : String(error) });

export interface ControlRetryOptions {
  /**
   * False for start: a request that died on the wire may have created the
   * dataset, and sending it again would create a second one. It is then only
   * re-sent after a refusal the server itself wrote.
   */
  retryNetwork: boolean;
  tuning?: Tuning;
  sleep?: Sleep;
  signal?: AbortSignal;
}

/** A control call (start, status, finish, cancel) that waits out rate limits and gateway hiccups. */
export async function withControlRetry<T>(call: () => Promise<T>, options: ControlRetryOptions): Promise<T> {
  const tuning = options.tuning ?? DEFAULT_TUNING;
  const sleep = options.sleep ?? abortableSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const refusal = asRefusal(error);
      // A 5xx the server wrote carries its code; one without came from a proxy
      // and says nothing about whether the server acted.
      const fromServer = !refusal.code.startsWith('HTTP_') && refusal.status !== 0;
      const again =
        refusal.status === 429
        || (refusal.status >= 502 && refusal.status <= 504 && (options.retryNetwork || fromServer))
        || (refusal.status === 0 && refusal.code === 'NETWORK_ERROR' && options.retryNetwork);
      if (!again || attempt >= tuning.maxAttempts) throw refusal;
      await sleep(backoffMs(attempt, refusal.retryAfter, tuning), options.signal);
    }
  }
}

// ============================================================================
// PARTS
// ============================================================================

/** `max(1, ceil(size / chunk))` — an empty file still has one part. */
export function partCount(size: number, chunk: number): number {
  return Math.max(1, Math.ceil(size / chunk));
}

/** The bytes part `n` (from 1) covers: `[start, end)`. */
export function partRange(size: number, chunk: number, n: number): [number, number] {
  const start = (n - 1) * chunk;
  return [Math.min(start, size), Math.min(n * chunk, size)];
}

export interface PlannedFile {
  id: number;
  path: string;
  size: number;
  blob: Blob;
  partCount: number;
  /** Part numbers still to send */
  missing: number[];
}

/**
 * Match the server's file list to the local files and work out what is left to
 * send. `receivedParts` is only present on a status answer; a start answer
 * means every part is missing.
 */
export function planFiles(
  serverFiles: (UploadFileEntry | UploadStatusFile)[],
  local: Map<string, Blob>,
): PlannedFile[] {
  return serverFiles.map((entry) => {
    const blob = local.get(entry.path);
    if (!blob) {
      throw new UploadRefusal({
        status: 0, code: 'LOCAL_FILE_MISSING',
        message: `${entry.path} is part of this upload but is no longer in the folder that was picked.`,
        context: { path: entry.path },
      });
    }
    if (blob.size !== entry.size) {
      throw new UploadRefusal({
        status: 0, code: 'LOCAL_FILE_CHANGED',
        message: `${entry.path} changed since the upload started. Cancel the upload and start it again.`,
        context: { path: entry.path, declaredSize: entry.size, sizeNow: blob.size },
      });
    }
    const status = entry as UploadStatusFile;
    const received = new Set(status.complete ? range(entry.partCount) : status.receivedParts ?? []);
    return {
      id: entry.id,
      path: entry.path,
      size: entry.size,
      blob,
      partCount: entry.partCount,
      missing: range(entry.partCount).filter((n) => !received.has(n)),
    };
  });
}

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

// ============================================================================
// PROGRESS
// ============================================================================

/**
 * Bytes per file: what the server confirmed, plus what is on its way. A part's
 * bytes move from "in flight" to "confirmed" only on a 200, and are taken back
 * when the attempt fails, so the bar never claims a part the server did not keep.
 */
export class UploadProgress {
  private readonly confirmed = new Map<number, number>();
  private readonly inFlight = new Map<string, { fileId: number; loaded: number }>();
  private readonly sizes = new Map<number, number>();
  private readonly partsLeft = new Map<number, number>();
  readonly totalBytes: number;

  constructor(files: PlannedFile[], chunkSize: number) {
    let total = 0;
    for (const file of files) {
      total += file.size;
      this.sizes.set(file.id, file.size);
      this.partsLeft.set(file.id, file.missing.length);
      // What the server already holds — a resumed upload does not start at 0.
      const missingBytes = file.missing.reduce((sum, n) => {
        const [start, end] = partRange(file.size, chunkSize, n);
        return sum + (end - start);
      }, 0);
      this.confirmed.set(file.id, file.size - missingBytes);
    }
    this.totalBytes = total;
  }

  partProgress(fileId: number, part: number, loaded: number): void {
    this.inFlight.set(`${fileId}:${part}`, { fileId, loaded });
  }

  partFailed(fileId: number, part: number): void {
    this.inFlight.delete(`${fileId}:${part}`);
  }

  partStored(fileId: number, part: number, size: number): void {
    this.inFlight.delete(`${fileId}:${part}`);
    this.confirmed.set(fileId, (this.confirmed.get(fileId) ?? 0) + size);
    this.partsLeft.set(fileId, Math.max(0, (this.partsLeft.get(fileId) ?? 1) - 1));
  }

  /** Bytes of one file sent so far, never more than its size. */
  fileSent(fileId: number): number {
    let sent = this.confirmed.get(fileId) ?? 0;
    for (const part of this.inFlight.values()) if (part.fileId === fileId) sent += part.loaded;
    return Math.min(sent, this.sizes.get(fileId) ?? sent);
  }

  fileDone(fileId: number): boolean {
    return (this.partsLeft.get(fileId) ?? 0) === 0;
  }

  sentBytes(): number {
    let sent = 0;
    for (const id of this.sizes.keys()) sent += this.fileSent(id);
    return sent;
  }

  filesDone(): number {
    let done = 0;
    for (const id of this.sizes.keys()) if (this.fileDone(id)) done += 1;
    return done;
  }
}

// ============================================================================
// SENDING
// ============================================================================

export type PartTransport = (request: PartRequest) => Promise<PartAck>;
export type PartHash = (bytes: ArrayBuffer) => Promise<string | undefined>;

/**
 * SHA-256 as 64 hex characters. Undefined where it cannot be computed — a page
 * that is not a secure context has no `crypto.subtle` — and the part then goes
 * out without `X-Chunk-Sha256`, which the contract allows: a checksum that
 * cannot be made must not be what stops an upload.
 */
export const sha256Hex: PartHash = async (bytes) => {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    return hex;
  } catch {
    return undefined;
  }
};

export interface SendPartsOptions {
  datasetId: string;
  files: PlannedFile[];
  chunkSize: number;
  transport: PartTransport;
  progress: UploadProgress;
  signal?: AbortSignal;
  parallel?: number;
  tuning?: Tuning;
  sleep?: Sleep;
  hash?: PartHash;
}

/**
 * Send every missing part, `parallel` at a time. The first part that cannot be
 * sent ends the run and stops the parts in flight; everything stored so far
 * stays on the server, to be picked up by a resume.
 */
export async function sendParts(options: SendPartsOptions): Promise<void> {
  const tuning = options.tuning ?? DEFAULT_TUNING;
  const sleep = options.sleep ?? abortableSleep;
  const hash = options.hash ?? sha256Hex;
  const parallel = Math.max(1, options.parallel ?? PARALLEL_PARTS);

  const jobs = options.files.flatMap((file) => file.missing.map((part) => ({ file, part })));
  // One controller for the run: the caller's stop and the first failure both end it.
  const run = new AbortController();
  const onOuterAbort = () => run.abort();
  if (options.signal?.aborted) run.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });

  let next = 0;
  let failure: UploadRefusal | null = null;

  const sendOne = async (file: PlannedFile, part: number): Promise<void> => {
    const [start, end] = partRange(file.size, options.chunkSize, part);
    let failures = 0;
    let busy = 0;
    for (;;) {
      if (run.signal.aborted) throw aborted();
      let refusal: UploadRefusal;
      try {
        // Read once, hash, and send that same buffer: the hash is of the bytes
        // that go out, and memory stays at one part per request in flight.
        let bytes: ArrayBuffer;
        try {
          bytes = await file.blob.slice(start, end).arrayBuffer();
        } catch {
          // The browser reads lazily: a file moved, changed or deleted after
          // the folder was picked only fails here.
          throw new UploadRefusal({
            status: 0, code: 'LOCAL_FILE_UNREADABLE',
            message: `${file.path} can no longer be read — it was moved, changed or deleted since the folder was picked. Cancel the upload and start it again.`,
            context: { path: file.path, partNumber: part },
          });
        }
        const sha256 = await hash(bytes);
        // Reading and hashing take a moment; the run may have ended meanwhile.
        if (run.signal.aborted) throw aborted();
        const ack = await options.transport({
          datasetId: options.datasetId,
          fileId: file.id,
          partNumber: part,
          body: bytes,
          sha256,
          signal: run.signal,
          onProgress: (loaded) => options.progress.partProgress(file.id, part, Math.min(loaded, end - start)),
        });
        // The server checked the header already; comparing its answer costs
        // nothing and catches something in between that answered for it.
        if (sha256 && typeof ack?.sha256 === 'string' && ack.sha256.toLowerCase() !== sha256) {
          throw new UploadRefusal({
            status: 422, code: 'CHECKSUM_MISMATCH',
            message: `Part ${part} of ${file.path} was stored with different bytes than were sent.`,
            context: { path: file.path, partNumber: part, expected: sha256, actual: ack.sha256 },
          });
        }
        options.progress.partStored(file.id, part, end - start);
        return;
      } catch (error) {
        refusal = asRefusal(error);
      }
      options.progress.partFailed(file.id, part);

      const kind = classifyRefusal(refusal.status, refusal.code);
      if (kind === 'fatal') throw refusal;
      if (kind === 'busy') {
        busy += 1;
        if (busy > tuning.maxBusyWaits) throw refusal;
        await sleep(Math.min((refusal.retryAfter ?? 2) * 1000, tuning.maxPauseMs), run.signal);
        continue;
      }
      failures += 1;
      if (failures >= tuning.maxAttempts) {
        throw new UploadRefusal({
          status: refusal.status,
          code: refusal.code,
          message: `Part ${part} of ${file.path} failed ${failures} times: ${refusal.message}`,
          context: { ...refusal.context, path: file.path, partNumber: part, attempts: failures },
          retryAfter: refusal.retryAfter,
        });
      }
      await sleep(backoffMs(failures, refusal.retryAfter, tuning), run.signal);
    }
  };

  const worker = async (): Promise<void> => {
    while (!run.signal.aborted && next < jobs.length) {
      const job = jobs[next];
      next += 1;
      try {
        await sendOne(job.file, job.part);
      } catch (error) {
        // The first real failure is the one reported; the aborts it causes in
        // the other workers are not.
        const refusal = asRefusal(error);
        if (!failure && (refusal.code !== 'ABORTED' || options.signal?.aborted)) failure = refusal;
        run.abort();
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(parallel, Math.max(jobs.length, 1)) }, worker));
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
  if (failure) throw failure;
  if (options.signal?.aborted) throw aborted();
}

// ============================================================================
// SEND, THEN FINISH
// ============================================================================

export interface FinishApi {
  status: (datasetId: string) => Promise<UploadStatusResponse>;
  finish: (datasetId: string) => Promise<UploadFinishResponse>;
}

export interface SendAndFinishOptions extends Omit<SendPartsOptions, 'progress'> {
  api: FinishApi;
  /** Local files by manifest path, to re-plan when finish reports parts missing */
  local: Map<string, Blob>;
  /** Called with the tracker of every round, so the caller can show it */
  onProgress: (progress: UploadProgress) => void;
  /** Called when every part is sent and finish is being asked */
  onFinishing?: () => void;
}

/**
 * Send the missing parts and ask the server to finish. A second round only
 * happens when finish answers `UPLOAD_INCOMPLETE` — the store lost a part the
 * server had acknowledged — and then sends exactly what the status lists.
 */
export async function sendAndFinish(options: SendAndFinishOptions): Promise<UploadFinishResponse> {
  const tuning = options.tuning ?? DEFAULT_TUNING;
  const retry = { retryNetwork: true, tuning, sleep: options.sleep, signal: options.signal };
  let files = options.files;
  for (let round = 1; ; round += 1) {
    const progress = new UploadProgress(files, options.chunkSize);
    options.onProgress(progress);
    await sendParts({ ...options, files, progress });
    options.onFinishing?.();
    try {
      return await withControlRetry(() => options.api.finish(options.datasetId), retry);
    } catch (error) {
      const refusal = asRefusal(error);
      if (refusal.code !== 'UPLOAD_INCOMPLETE' || round >= tuning.maxFinishRounds) throw refusal;
      const status = await withControlRetry(() => options.api.status(options.datasetId), retry);
      files = planFiles(status.files, options.local);
    }
  }
}

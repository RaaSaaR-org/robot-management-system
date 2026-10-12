/**
 * @file multipart-upload-sweep.ts
 * @description Aborts the multipart uploads an interrupted upload left in the
 *              RustFS buckets (TASK-379).
 * @feature storage
 *
 * An upload that is cancelled or fails aborts its own multipart upload
 * (`RustFSClient.upload`). One cut short by a crash or a restart cannot: its
 * parts stay in the bucket — invisible to object listings, never removed by a
 * prefix delete, and taking space. RustFS is not relied on for the
 * `AbortIncompleteMultipartUpload` lifecycle rule, so the server sweeps them.
 *
 * Every bucket the server writes is listed and each upload initiated more than
 * `RUSTFS_MULTIPART_MAX_AGE_HOURS` ago (default 24) is aborted — long enough
 * that a live upload is never cut. The sweep runs once when RustFS becomes
 * ready and then every `RUSTFS_MULTIPART_SWEEP_INTERVAL_HOURS` (default 6).
 *
 * Running it on every replica is safe: an upload another replica aborted first
 * answers `NoSuchUpload`, which counts as gone. A sweep never throws.
 */

import {
  BUCKETS,
  getRustFSClient,
  isRustFSInitialized,
  type MultipartUploadInfo,
} from '../storage/index.js';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_INTERVAL_HOURS = 6;

/** The part of `RustFSClient` the sweep drives. */
export interface MultipartSweepStore {
  listMultipartUploads(bucket: string): Promise<MultipartUploadInfo[]>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
}

export interface MultipartSweepResult {
  /** Uploads aborted by this sweep. */
  aborted: number;
  /** Uploads younger than the cut-off, or with no start time, left alone. */
  kept: number;
  /** One line per bucket or upload that could not be handled. */
  errors: string[];
}

export interface MultipartSweepOptions {
  store?: () => MultipartSweepStore;
  enabled?: () => boolean;
  buckets?: () => string[];
  maxAgeMs?: () => number;
  intervalMs?: () => number;
  now?: () => number;
}

/** A positive number of hours from `name`, or `fallback` when unset or invalid. */
function hoursFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const hours = Number(raw);
  if (Number.isFinite(hours) && hours > 0) return hours;
  console.warn(`[MultipartUploadSweep] ${name}=${raw} is not a positive number of hours; using ${fallback}`);
  return fallback;
}

export function multipartMaxAgeMs(): number {
  return hoursFromEnv('RUSTFS_MULTIPART_MAX_AGE_HOURS', DEFAULT_MAX_AGE_HOURS) * HOUR_MS;
}

export function multipartSweepIntervalMs(): number {
  return hoursFromEnv('RUSTFS_MULTIPART_SWEEP_INTERVAL_HOURS', DEFAULT_INTERVAL_HOURS) * HOUR_MS;
}

function errorName(error: unknown): string | undefined {
  return (error as { name?: string; Code?: string } | null)?.name
    ?? (error as { Code?: string } | null)?.Code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MultipartUploadSweep {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly store: () => MultipartSweepStore;
  private readonly enabled: () => boolean;
  private readonly buckets: () => string[];
  private readonly maxAgeMs: () => number;
  private readonly intervalMs: () => number;
  private readonly now: () => number;

  constructor(options: MultipartSweepOptions = {}) {
    this.store = options.store ?? getRustFSClient;
    this.enabled = options.enabled ?? isRustFSInitialized;
    this.buckets = options.buckets ?? (() => Object.values(BUCKETS));
    this.maxAgeMs = options.maxAgeMs ?? multipartMaxAgeMs;
    this.intervalMs = options.intervalMs ?? multipartSweepIntervalMs;
    this.now = options.now ?? Date.now;
  }

  /** One sweep over every bucket. Never throws; overlapping calls do nothing. */
  async sweep(): Promise<MultipartSweepResult> {
    const result: MultipartSweepResult = { aborted: 0, kept: 0, errors: [] };
    if (this.running || !this.enabled()) return result;
    this.running = true;
    try {
      const store = this.store();
      const cutoff = this.now() - this.maxAgeMs();
      for (const bucket of this.buckets()) {
        await this.sweepBucket(store, bucket, cutoff, result);
      }
      if (result.aborted > 0 || result.errors.length > 0) {
        console.log(
          `[MultipartUploadSweep] aborted ${result.aborted} stale multipart upload(s), `
          + `kept ${result.kept}, ${result.errors.length} error(s)`,
        );
      }
      for (const error of result.errors) console.warn(`[MultipartUploadSweep] ${error}`);
    } catch (error) {
      result.errors.push(errorMessage(error));
      console.error('[MultipartUploadSweep] sweep failed:', errorMessage(error));
    } finally {
      this.running = false;
    }
    return result;
  }

  private async sweepBucket(
    store: MultipartSweepStore,
    bucket: string,
    cutoff: number,
    result: MultipartSweepResult,
  ): Promise<void> {
    let uploads: MultipartUploadInfo[];
    try {
      uploads = await store.listMultipartUploads(bucket);
    } catch (error) {
      // A bucket nothing has written to yet holds no uploads.
      if (errorName(error) === 'NoSuchBucket') return;
      result.errors.push(`${bucket}: listing multipart uploads failed: ${errorMessage(error)}`);
      return;
    }
    for (const upload of uploads) {
      // No start time means no age: never abort what might still be running.
      if (!upload.initiated || upload.initiated.getTime() > cutoff) {
        result.kept++;
        continue;
      }
      try {
        await store.abortMultipartUpload(bucket, upload.key, upload.uploadId);
        result.aborted++;
      } catch (error) {
        // Another replica's sweep got there first.
        if (errorName(error) === 'NoSuchUpload') continue;
        result.errors.push(`${bucket}/${upload.key} (${upload.uploadId}): abort failed: ${errorMessage(error)}`);
      }
    }
  }

  /** Sweep now, then on every interval. Calling it again only sweeps again. */
  start(): void {
    void this.sweep();
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs());
    // Never keeps the process alive on its own.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const multipartUploadSweep = new MultipartUploadSweep();

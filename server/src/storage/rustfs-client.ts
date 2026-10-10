/**
 * @file rustfs-client.ts
 * @description S3-compatible client for RustFS object storage
 * @feature storage
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  ListBucketsCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
  type ListObjectsV2CommandInput,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'stream';

// ============================================================================
// TYPES
// ============================================================================

export interface RustFSConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadProgress {
  loaded: number;
  total?: number;
  percentage?: number;
}

export interface ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
  delimiter?: string;
}

export interface ListResult {
  objects: ObjectInfo[];
  isTruncated: boolean;
  continuationToken?: string;
  commonPrefixes?: string[];
}

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

// ============================================================================
// RUSTFS CLIENT CLASS
// ============================================================================

/**
 * S3-compatible client for RustFS object storage
 */
export class RustFSClient {
  private client: S3Client;
  private config: RustFSConfig;

  constructor(config: RustFSConfig) {
    this.config = config;
    this.client = new S3Client({
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      region: config.region ?? 'us-east-1',
      forcePathStyle: true, // Required for S3-compatible storage
    });
  }

  /**
   * Get the underlying S3 client
   */
  getClient(): S3Client {
    return this.client;
  }

  /**
   * Upload a file with optional progress callback
   */
  async upload(
    bucket: string,
    key: string,
    body: Buffer | Readable | string,
    options?: UploadOptions
  ): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: options?.contentType ?? 'application/octet-stream',
        Metadata: options?.metadata,
      },
    });

    if (options?.onProgress) {
      upload.on('httpUploadProgress', (progress) => {
        options.onProgress!({
          loaded: progress.loaded ?? 0,
          total: progress.total,
          percentage: progress.total
            ? Math.round((progress.loaded ?? 0) / progress.total * 100)
            : undefined,
        });
      });
    }

    await upload.done();
  }

  /**
   * Upload a small file directly (no multipart)
   */
  async putObject(
    bucket: string,
    key: string,
    body: Buffer | string,
    options?: UploadOptions
  ): Promise<void> {
    const input: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options?.contentType ?? 'application/octet-stream',
      Metadata: options?.metadata,
    };

    await this.client.send(new PutObjectCommand(input));
  }

  /**
   * Download a file as Buffer
   */
  async download(bucket: string, key: string): Promise<Buffer> {
    const input: GetObjectCommandInput = {
      Bucket: bucket,
      Key: key,
    };

    const response = await this.client.send(new GetObjectCommand(input));

    if (!response.Body) {
      throw new Error(`Empty response body for ${bucket}/${key}`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Download `length` bytes starting at `start`.
   *
   * For the readers that need a slice rather than a file — the parquet footer
   * validation reads to learn a file's row count and column names is a few
   * kilobytes at the END of an object that is routinely 100 MB. Before this
   * existed the only way to reach it was `download()`, which pulls the whole
   * object into the API process.
   *
   * A store that does not implement `Range` answers with the whole object and
   * no `Content-Range`; the window is cut out here rather than trusted, so a
   * backend without range support stays correct (and merely slow).
   */
  async downloadRange(bucket: string, key: string, start: number, length: number): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=${start}-${start + length - 1}`,
      })
    );

    if (!response.Body) {
      throw new Error(`Empty response body for ${bucket}/${key}`);
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    // A store that served the range says so: `206` with a `Content-Range`. A
    // store that ignored the header answers `200` with the whole object, and
    // the window has to be cut out here.
    //
    // The test is the ANSWER, not the size of it. `buffer.length > length` used
    // to stand in for "this looks like the whole object", and it is wrong for
    // the one case where being wrong is silent: an object that is exactly
    // `length` bytes, requested from `start > 0`, comes back whole, passes that
    // check untouched, and is handed to the parquet reader as though it were
    // the window — decoded at the wrong offset, with no error anywhere.
    const served = Boolean(response.ContentRange) || response.$metadata?.httpStatusCode === 206;
    if (!served) {
      return buffer.subarray(start, start + length);
    }
    return buffer;
  }

  /**
   * Download a file as stream
   */
  async getStream(bucket: string, key: string): Promise<Readable> {
    const input: GetObjectCommandInput = {
      Bucket: bucket,
      Key: key,
    };

    const response = await this.client.send(new GetObjectCommand(input));

    if (!response.Body) {
      throw new Error(`Empty response body for ${bucket}/${key}`);
    }

    return response.Body as Readable;
  }

  /**
   * Delete an object
   */
  async delete(bucket: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  }

  /**
   * Check if an object exists
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      return true;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object metadata
   */
  async getMetadata(bucket: string, key: string): Promise<ObjectMetadata> {
    const response = await this.client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      etag: response.ETag,
      metadata: response.Metadata,
    };
  }

  /**
   * List objects with pagination
   */
  async list(bucket: string, options?: ListOptions): Promise<ListResult> {
    const input: ListObjectsV2CommandInput = {
      Bucket: bucket,
      Prefix: options?.prefix,
      MaxKeys: options?.maxKeys ?? 1000,
      ContinuationToken: options?.continuationToken,
      Delimiter: options?.delimiter,
    };

    const response = await this.client.send(new ListObjectsV2Command(input));

    const objects: ObjectInfo[] = (response.Contents ?? []).map((obj: _Object) => ({
      key: obj.Key ?? '',
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
      etag: obj.ETag,
    }));

    return {
      objects,
      isTruncated: response.IsTruncated ?? false,
      continuationToken: response.NextContinuationToken,
      commonPrefixes: response.CommonPrefixes?.map((p) => p.Prefix ?? ''),
    };
  }

  /**
   * Async generator for listing all objects
   */
  async *listAll(bucket: string, prefix?: string): AsyncGenerator<ObjectInfo> {
    let continuationToken: string | undefined;

    do {
      const result = await this.list(bucket, { prefix, continuationToken });

      for (const obj of result.objects) {
        yield obj;
      }

      continuationToken = result.continuationToken;
    } while (continuationToken);
  }

  /**
   * Get presigned download URL
   */
  async getPresignedDownloadUrl(
    bucket: string,
    key: string,
    expiresIn = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Get presigned upload URL
   */
  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    expiresIn = 3600,
    contentType?: string
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType ?? 'application/octet-stream',
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Copy an object
   */
  async copy(
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        Key: destKey,
        CopySource: `${srcBucket}/${srcKey}`,
      })
    );
  }

  /**
   * Move an object (copy + delete)
   */
  async move(
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    await this.copy(srcBucket, srcKey, destBucket, destKey);
    await this.delete(srcBucket, srcKey);
  }

  /**
   * Validate connection by listing buckets
   */
  async validateConnection(): Promise<boolean> {
    try {
      await this.checkConnection();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List buckets, and throw a {@link RustFSConnectionError} saying why when it
   * fails. `validateConnection` answers yes or no; this is the one that keeps
   * the reason, which is what tells a wrong key from an unreachable host.
   */
  async checkConnection(): Promise<void> {
    try {
      await this.client.send(new ListBucketsCommand({}));
    } catch (err) {
      const { kind, detail } = classifyS3Error(err);
      throw new RustFSConnectionError(
        kind,
        detail,
        `Failed to connect to RustFS at ${this.config.endpoint}: ${detail}`,
      );
    }
  }
}

// ============================================================================
// CONNECTION ERRORS
// ============================================================================

/**
 * Why RustFS could not be reached. `config` is the environment, not the
 * server: retrying does not fix it, because the environment does not change
 * under a running process.
 */
export type RustFSErrorKind = 'config' | 'auth' | 'connectivity' | 'unknown';

export class RustFSConnectionError extends Error {
  constructor(
    readonly kind: RustFSErrorKind,
    /** S3 error name, network code and HTTP status — never a key. */
    readonly detail: string,
    message: string,
  ) {
    super(message);
    this.name = 'RustFSConnectionError';
  }
}

const AUTH_ERROR_NAMES = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AccessDenied',
  'Forbidden',
  'InvalidToken',
]);

const CONNECTIVITY_ERROR_NAMES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'TimeoutError',
  'NetworkingError',
]);

/**
 * Sort an S3 failure into a {@link RustFSErrorKind}.
 *
 * The detail is built from the error's name, code and HTTP status only. Its
 * message is left out on purpose: an S3-compatible server is free to echo the
 * access key id back in it, and this string goes to logs and to `/health`.
 */
export function classifyS3Error(err: unknown): { kind: RustFSErrorKind; detail: string } {
  const e = (err ?? {}) as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const code = typeof e.code === 'string' ? e.code : undefined;
  const status = typeof e.$metadata?.httpStatusCode === 'number' ? e.$metadata.httpStatusCode : undefined;

  let kind: RustFSErrorKind = 'unknown';
  if (AUTH_ERROR_NAMES.has(name) || status === 401 || status === 403) {
    kind = 'auth';
  } else if (CONNECTIVITY_ERROR_NAMES.has(name) || (code !== undefined && CONNECTIVITY_ERROR_NAMES.has(code))) {
    kind = 'connectivity';
  }

  const parts = [name];
  if (code && code !== name) parts.push(code);
  const detail = status !== undefined ? `${parts.join('/')} (${status})` : parts.join('/');
  return { kind, detail };
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let rustfsClient: RustFSClient | null = null;

export interface RustFSStatus {
  /** `RUSTFS_ENDPOINT` is set: this deployment means to use object storage. */
  configured: boolean;
  state: 'disabled' | 'connecting' | 'ready' | 'unavailable';
  /** Set while the last attempt failed. */
  errorKind?: RustFSErrorKind;
  /** e.g. `InvalidAccessKeyId (403)` — never a key. */
  errorDetail?: string;
  lastAttemptAt?: string;
  attempts: number;
}

let inFlight: Promise<RustFSClient> | null = null;
let recoveryRunning = false;
let attempts = 0;
let lastAttemptAt: string | undefined;
let lastError: { kind: RustFSErrorKind; detail: string } | undefined;

/**
 * Whether this deployment is configured for object storage at all — which is
 * a different question from whether it is reachable right now.
 */
export function isRustFSConfigured(): boolean {
  return Boolean(process.env.RUSTFS_ENDPOINT);
}

/**
 * Where object storage stands, for `/health` and for anyone deciding whether
 * to wait for it or to use something else.
 */
export function getRustFSStatus(): RustFSStatus {
  const configured = isRustFSConfigured();
  let state: RustFSStatus['state'];
  if (rustfsClient) state = 'ready';
  else if (inFlight) state = 'connecting';
  else if (lastError) state = lastError.kind === 'config' && !configured ? 'disabled' : 'unavailable';
  else state = configured ? 'connecting' : 'disabled';

  const status: RustFSStatus = { configured, state, attempts };
  if (lastAttemptAt) status.lastAttemptAt = lastAttemptAt;
  if (state === 'unavailable' && lastError) {
    status.errorKind = lastError.kind;
    status.errorDetail = lastError.detail;
  }
  return status;
}

/**
 * Get the RustFS client singleton
 */
export function getRustFSClient(): RustFSClient {
  if (!rustfsClient) {
    throw new Error('RustFS client not initialized. Call initializeRustFSClient first.');
  }
  return rustfsClient;
}

/**
 * Check if RustFS client is initialized
 */
export function isRustFSInitialized(): boolean {
  return rustfsClient !== null;
}

/**
 * Initialize the RustFS client singleton
 *
 * The singleton is published only once the connection validates. Published
 * first, every `isRustFSInitialized()` caller would see a client during each
 * retry's probe — long enough for an import to pick the bucket and then fail
 * on it.
 */
export async function initializeRustFSClient(config?: RustFSConfig): Promise<RustFSClient> {
  if (rustfsClient) {
    return rustfsClient;
  }
  // A second caller while a probe is out waits for that probe rather than
  // starting its own: two probes would race to publish the singleton and to
  // write the status.
  if (inFlight) {
    return inFlight;
  }
  inFlight = connect(config);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function connect(config?: RustFSConfig): Promise<RustFSClient> {
  attempts += 1;
  lastAttemptAt = new Date().toISOString();

  let finalConfig: RustFSConfig;
  try {
    finalConfig = config ?? getConfigFromEnv();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    lastError = { kind: 'config', detail };
    throw new RustFSConnectionError('config', detail, detail);
  }

  const client = new RustFSClient(finalConfig);
  try {
    await client.checkConnection();
  } catch (err) {
    lastError = err instanceof RustFSConnectionError
      ? { kind: err.kind, detail: err.detail }
      : classifyS3Error(err);
    throw err;
  }

  rustfsClient = client;
  lastError = undefined;
  console.log(`[RustFS] Connected to ${finalConfig.endpoint}`);
  return rustfsClient;
}

export interface RustFSRecoveryOptions {
  /** Called exactly once, when a retry connects. */
  onReady: () => void;
  /** First wait, doubled after every failure. Default 5 s. */
  initialDelayMs?: number;
  /** Ceiling for the wait. Default 5 min. */
  maxDelayMs?: number;
}

/**
 * Keep trying to connect after a failed start, until it works.
 *
 * Without this one failed probe at boot — RustFS still starting, a DNS blip
 * during a rollout — disabled object storage for the life of the process, and
 * every reader quietly fell back to local disk (#368).
 *
 * A `config` failure stops the loop: the environment will not change under a
 * running process. The timer is `unref()`'d so it never holds the process
 * open. One loop at a time: a second call while one runs is a no-op, so
 * `onReady` fires once. Returns `stop()`.
 */
export function startRustFSRecovery(options: RustFSRecoveryOptions): () => void {
  const { onReady, initialDelayMs = 5_000, maxDelayMs = 300_000 } = options;
  if (!isRustFSConfigured() || rustfsClient || recoveryRunning) return () => undefined;
  recoveryRunning = true;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = initialDelayMs;
  let reportedKind = lastError?.kind;

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    try {
      await initializeRustFSClient();
    } catch (err) {
      if (stopped) return;
      const kind = err instanceof RustFSConnectionError ? err.kind : 'unknown';
      if (kind !== reportedKind) {
        console.warn(`[RustFS] Still unavailable (${kind}): ${lastError?.detail ?? 'unknown error'}`);
        reportedKind = kind;
      }
      if (kind === 'config') {
        console.warn('[RustFS] Configuration is incomplete; not retrying');
        recoveryRunning = false;
        return;
      }
      delay = Math.min(delay * 2, maxDelayMs);
      schedule();
      return;
    }
    if (stopped) return;
    stopped = true;
    recoveryRunning = false;
    console.log(`[RustFS] Recovered after ${attempts} attempt(s)`);
    onReady();
  };

  const schedule = (): void => {
    timer = setTimeout(() => void attempt(), delay);
    timer.unref?.();
  };

  schedule();
  return () => {
    if (!stopped) recoveryRunning = false;
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Get config from environment variables
 */
function getConfigFromEnv(): RustFSConfig {
  const endpoint = process.env.RUSTFS_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = process.env.RUSTFS_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing RustFS configuration. Set RUSTFS_ENDPOINT, RUSTFS_ACCESS_KEY, and RUSTFS_SECRET_KEY environment variables.'
    );
  }

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    region: process.env.RUSTFS_REGION ?? 'us-east-1',
  };
}

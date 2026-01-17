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
      await this.client.send(new ListBucketsCommand({}));
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let rustfsClient: RustFSClient | null = null;

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
 */
export async function initializeRustFSClient(config?: RustFSConfig): Promise<RustFSClient> {
  if (rustfsClient) {
    return rustfsClient;
  }

  const finalConfig = config ?? getConfigFromEnv();

  rustfsClient = new RustFSClient(finalConfig);

  // Validate connection
  const isConnected = await rustfsClient.validateConnection();
  if (!isConnected) {
    rustfsClient = null;
    throw new Error(`Failed to connect to RustFS at ${finalConfig.endpoint}`);
  }

  console.log(`[RustFS] Connected to ${finalConfig.endpoint}`);
  return rustfsClient;
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

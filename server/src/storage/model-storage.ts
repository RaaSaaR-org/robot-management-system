/**
 * @file model-storage.ts
 * @description High-level storage operations for models and datasets
 * @feature storage
 */

import { getRustFSClient, isRustFSInitialized, type ObjectInfo } from './rustfs-client.js';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import type { Readable } from 'stream';

// ============================================================================
// CONSTANTS
// ============================================================================

export const BUCKETS = {
  TRAINING_DATASETS: 'training-datasets',
  MODEL_CHECKPOINTS: 'model-checkpoints',
  PRODUCTION_MODELS: 'production-models',
  ROBOT_LOGS: 'robot-logs',
  SENSOR_SCANS: 'sensor-scans',
  DIGITAL_TWINS: 'digital-twins',
  INCIDENT_CLIPS: 'incident-clips',
  /** Patrol control/baseline/finding photos (TASK-212) — see PatrolPhotoStore. */
  PATROL_PHOTOS: 'patrol-photos',
} as const;

export type BucketName = typeof BUCKETS[keyof typeof BUCKETS];

export const SIZE_LIMITS = {
  DATASET: 50 * 1024 * 1024 * 1024,    // 50GB
  MODEL: 10 * 1024 * 1024 * 1024,       // 10GB
  CHECKPOINT: 5 * 1024 * 1024 * 1024,   // 5GB
  LOG: 1 * 1024 * 1024 * 1024,          // 1GB
  SCAN: 2 * 1024 * 1024 * 1024,         // 2GB
  TWIN: 2 * 1024 * 1024 * 1024,         // 2GB (merged cloud + mesh + grids)
  INCIDENT_CLIP: 32 * 1024 * 1024,      // 32MB (jpeg-frames JSON, TASK-179)
} as const;

// Local fallback root for digital-twin artifacts (used when RustFS is down).
// Layout: <root>/<twinId>/<name>; the stored "key" is the absolute file path.
const LOCAL_TWINS_DIR = path.resolve(process.cwd(), 'data', 'twins');

// Local fallback root for incident highlight clips (mirrors the twin split).
// Layout: <root>/<incidentId>/clip.json; local "key" is the absolute path.
const LOCAL_INCIDENT_CLIPS_DIR = path.resolve(process.cwd(), 'data', 'incident-clips');

// Default presigned URL expiration times (in seconds)
export const URL_EXPIRY = {
  UPLOAD: 3600,     // 1 hour
  DOWNLOAD: 3600,   // 1 hour
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface DatasetMetadata {
  name: string;
  version: string;
  format?: string;
  robotType?: string;
  taskType?: string;
  episodeCount?: number;
  createdAt?: string;
  uploadedBy?: string;
}

export interface DatasetInfo {
  name: string;
  version: string;
  key: string;
  size: number;
  lastModified: Date;
  metadata?: DatasetMetadata;
}

export interface CheckpointInfo {
  jobId: string;
  epoch: number;
  key: string;
  size: number;
  lastModified: Date;
  metrics?: Record<string, number>;
}

export interface ModelMetadata {
  name: string;
  version: string;
  baseModel?: string;
  fineTuneMethod?: string;
  trainingJobId?: string;
  accuracy?: number;
  createdAt?: string;
  deployedAt?: string;
}

export interface ModelVersionInfo {
  name: string;
  version: string;
  key: string;
  size: number;
  lastModified: Date;
  metadata?: ModelMetadata;
}

export interface LogInfo {
  robotId: string;
  date: string;
  logType: string;
  key: string;
  size: number;
  lastModified: Date;
}

export interface LogListOptions {
  startDate?: string;
  endDate?: string;
  logType?: string;
  maxResults?: number;
}

export interface CleanupResult {
  deletedCount: number;
  deletedSize: number;
  errors: string[];
}

export interface StorageStats {
  bucket: string;
  objectCount: number;
  totalSize: number;
}

// ============================================================================
// MODEL STORAGE CLIENT CLASS
// ============================================================================

/**
 * High-level storage operations for models and datasets
 */
export class ModelStorageClient {
  /**
   * Check if storage is available
   */
  isAvailable(): boolean {
    return isRustFSInitialized();
  }

  // ==========================================================================
  // DATASET OPERATIONS
  // ==========================================================================

  /**
   * Upload a dataset
   */
  async uploadDataset(
    name: string,
    version: string,
    data: Buffer,
    metadata?: Partial<DatasetMetadata>
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getDatasetKey(name, version);

    await client.upload(BUCKETS.TRAINING_DATASETS, key, data, {
      contentType: 'application/octet-stream',
      metadata: {
        name,
        version,
        ...this.stringifyMetadata(metadata),
      },
    });

    return key;
  }

  /**
   * Get dataset as stream
   */
  async getDatasetStream(name: string, version: string): Promise<Readable> {
    const client = getRustFSClient();
    const key = this.getDatasetKey(name, version);
    return client.getStream(BUCKETS.TRAINING_DATASETS, key);
  }

  /**
   * Get presigned download URL for dataset
   */
  async getDatasetDownloadUrl(
    name: string,
    version: string,
    expiresIn = URL_EXPIRY.DOWNLOAD
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getDatasetKey(name, version);
    return client.getPresignedDownloadUrl(BUCKETS.TRAINING_DATASETS, key, expiresIn);
  }

  /**
   * Get presigned upload URL for dataset
   */
  async getDatasetUploadUrl(
    name: string,
    version: string,
    contentType = 'application/octet-stream',
    expiresIn = URL_EXPIRY.UPLOAD
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getDatasetKey(name, version);
    return client.getPresignedUploadUrl(BUCKETS.TRAINING_DATASETS, key, expiresIn, contentType);
  }

  /**
   * List datasets
   */
  async listDatasets(prefix?: string): Promise<DatasetInfo[]> {
    const client = getRustFSClient();
    const datasets: DatasetInfo[] = [];

    for await (const obj of client.listAll(BUCKETS.TRAINING_DATASETS, prefix)) {
      const parts = obj.key.split('/');
      if (parts.length >= 2) {
        datasets.push({
          name: parts[0],
          version: parts[1],
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      }
    }

    return datasets;
  }

  /**
   * Delete a dataset
   */
  async deleteDataset(name: string, version: string): Promise<void> {
    const client = getRustFSClient();
    const key = this.getDatasetKey(name, version);
    await client.delete(BUCKETS.TRAINING_DATASETS, key);
  }

  /**
   * Check if dataset exists
   */
  async datasetExists(name: string, version: string): Promise<boolean> {
    const client = getRustFSClient();
    const key = this.getDatasetKey(name, version);
    return client.exists(BUCKETS.TRAINING_DATASETS, key);
  }

  // ==========================================================================
  // CHECKPOINT OPERATIONS
  // ==========================================================================

  /**
   * Upload a training checkpoint
   */
  async uploadCheckpoint(
    jobId: string,
    epoch: number,
    data: Buffer,
    metrics?: Record<string, number>
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getCheckpointKey(jobId, epoch);

    await client.upload(BUCKETS.MODEL_CHECKPOINTS, key, data, {
      contentType: 'application/octet-stream',
      metadata: {
        jobId,
        epoch: String(epoch),
        ...(metrics ? { metrics: JSON.stringify(metrics) } : {}),
      },
    });

    return key;
  }

  /**
   * List checkpoints for a job
   */
  async listCheckpoints(jobId: string): Promise<CheckpointInfo[]> {
    const client = getRustFSClient();
    const prefix = `${jobId}/epoch-`;
    const checkpoints: CheckpointInfo[] = [];

    for await (const obj of client.listAll(BUCKETS.MODEL_CHECKPOINTS, prefix)) {
      const epochMatch = obj.key.match(/epoch-(\d+)/);
      if (epochMatch) {
        checkpoints.push({
          jobId,
          epoch: parseInt(epochMatch[1], 10),
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      }
    }

    return checkpoints.sort((a, b) => a.epoch - b.epoch);
  }

  /**
   * Get presigned download URL for checkpoint
   */
  async getCheckpointDownloadUrl(
    jobId: string,
    epoch: number,
    expiresIn = URL_EXPIRY.DOWNLOAD
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getCheckpointKey(jobId, epoch);
    return client.getPresignedDownloadUrl(BUCKETS.MODEL_CHECKPOINTS, key, expiresIn);
  }

  /**
   * Open a trained-model artifact for streaming by its raw key in the
   * MODEL_CHECKPOINTS bucket — e.g. `<jobId>/policy.onnx` / `<jobId>/manifest.json`
   * for a sim-RL navigation policy (TASK-172.C Phase 3). A key that looks like an
   * absolute path is read from the local filesystem (parity with twin artifacts).
   */
  async getModelCheckpointStream(key: string): Promise<Readable> {
    if (this.isLocalKey(key)) {
      return createReadStream(key);
    }
    const client = getRustFSClient();
    return client.getStream(BUCKETS.MODEL_CHECKPOINTS, key);
  }

  /**
   * Delete all checkpoints for a job
   */
  async deleteJobCheckpoints(jobId: string): Promise<number> {
    const client = getRustFSClient();
    let deletedCount = 0;

    for await (const obj of client.listAll(BUCKETS.MODEL_CHECKPOINTS, `${jobId}/`)) {
      await client.delete(BUCKETS.MODEL_CHECKPOINTS, obj.key);
      deletedCount++;
    }

    return deletedCount;
  }

  // ==========================================================================
  // PRODUCTION MODEL OPERATIONS
  // ==========================================================================

  /**
   * Upload a production model
   */
  async uploadProductionModel(
    modelName: string,
    version: string,
    onnxBuffer: Buffer,
    metadata?: Partial<ModelMetadata>
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getModelKey(modelName, version);

    await client.upload(BUCKETS.PRODUCTION_MODELS, key, onnxBuffer, {
      contentType: 'application/octet-stream',
      metadata: {
        name: modelName,
        version,
        ...this.stringifyMetadata(metadata),
      },
    });

    return key;
  }

  /**
   * Get presigned download URL for model
   */
  async getModelDownloadUrl(
    modelName: string,
    version: string,
    expiresIn = URL_EXPIRY.DOWNLOAD
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getModelKey(modelName, version);
    return client.getPresignedDownloadUrl(BUCKETS.PRODUCTION_MODELS, key, expiresIn);
  }

  /**
   * List model versions
   */
  async listModelVersions(modelName: string): Promise<ModelVersionInfo[]> {
    const client = getRustFSClient();
    const prefix = `${modelName}/`;
    const versions: ModelVersionInfo[] = [];

    for await (const obj of client.listAll(BUCKETS.PRODUCTION_MODELS, prefix)) {
      const parts = obj.key.split('/');
      if (parts.length >= 2 && parts[1].endsWith('.onnx')) {
        const version = parts[1].replace('.onnx', '');
        versions.push({
          name: modelName,
          version,
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      }
    }

    return versions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  /**
   * Check if model version exists
   */
  async modelExists(modelName: string, version: string): Promise<boolean> {
    const client = getRustFSClient();
    const key = this.getModelKey(modelName, version);
    return client.exists(BUCKETS.PRODUCTION_MODELS, key);
  }

  // ==========================================================================
  // ROBOT LOG OPERATIONS
  // ==========================================================================

  /**
   * Upload a robot log
   */
  async uploadRobotLog(
    robotId: string,
    date: string,
    logType: string,
    data: Buffer
  ): Promise<string> {
    const client = getRustFSClient();
    const key = this.getRobotLogKey(robotId, date, logType);

    await client.upload(BUCKETS.ROBOT_LOGS, key, data, {
      contentType: 'application/octet-stream',
      metadata: {
        robotId,
        date,
        logType,
      },
    });

    return key;
  }

  /**
   * List robot logs
   */
  async listRobotLogs(robotId: string, options?: LogListOptions): Promise<LogInfo[]> {
    const client = getRustFSClient();
    const prefix = options?.logType
      ? `${robotId}/${options.logType}/`
      : `${robotId}/`;
    const logs: LogInfo[] = [];

    for await (const obj of client.listAll(BUCKETS.ROBOT_LOGS, prefix)) {
      const parts = obj.key.split('/');
      if (parts.length >= 3) {
        const logDate = parts[2].split('.')[0];

        // Filter by date range if provided
        if (options?.startDate && logDate < options.startDate) continue;
        if (options?.endDate && logDate > options.endDate) continue;

        logs.push({
          robotId: parts[0],
          logType: parts[1],
          date: logDate,
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified,
        });

        // Stop if max results reached
        if (options?.maxResults && logs.length >= options.maxResults) break;
      }
    }

    return logs.sort((a, b) => b.date.localeCompare(a.date));
  }

  // ==========================================================================
  // SENSOR SCAN OPERATIONS (point clouds)
  // ==========================================================================

  /**
   * Upload a recorded point-cloud scan (e.g. binary PCD).
   */
  async uploadSensorScan(robotId: string, scanId: string, data: Buffer): Promise<string> {
    const client = getRustFSClient();
    const key = this.getSensorScanKey(robotId, scanId);
    await client.upload(BUCKETS.SENSOR_SCANS, key, data, {
      contentType: 'application/octet-stream',
      metadata: { robotId, scanId },
    });
    return key;
  }

  /**
   * Get a recorded scan as a stream.
   */
  async getSensorScanStream(key: string): Promise<Readable> {
    const client = getRustFSClient();
    return client.getStream(BUCKETS.SENSOR_SCANS, key);
  }

  /**
   * Get a presigned download URL for a recorded scan.
   */
  async getSensorScanDownloadUrl(key: string, expiresIn = URL_EXPIRY.DOWNLOAD): Promise<string> {
    const client = getRustFSClient();
    return client.getPresignedDownloadUrl(BUCKETS.SENSOR_SCANS, key, expiresIn);
  }

  /**
   * Delete a recorded scan.
   */
  async deleteSensorScan(key: string): Promise<void> {
    const client = getRustFSClient();
    await client.delete(BUCKETS.SENSOR_SCANS, key);
  }

  private getSensorScanKey(robotId: string, scanId: string): string {
    return `${robotId}/${scanId}.pcd`;
  }

  // ==========================================================================
  // DIGITAL TWIN ARTIFACT OPERATIONS (TASK-170)
  // ==========================================================================
  //
  // One backend per twin. When RustFS is up, artifacts live in the
  // DIGITAL_TWINS bucket keyed `<twinId>/<name>`. When it is down, they fall
  // back to the local filesystem (`server/data/twins/<twinId>/<name>`) and the
  // returned "key" is the absolute file path — mirroring the SensorScan
  // local-vs-rustfs split. Callers persist the returned key onto the
  // DigitalTwin row and stream it back via getTwinArtifactStream().

  /**
   * Upload one built twin artifact (e.g. cloud.pcd, mesh.glb, occupancy.pgm).
   * Returns the storage key (object key on rustfs, absolute path on local).
   */
  async uploadTwinArtifact(twinId: string, name: string, data: Buffer): Promise<string> {
    if (this.isAvailable()) {
      const client = getRustFSClient();
      const key = this.getTwinArtifactKey(twinId, name);
      await client.upload(BUCKETS.DIGITAL_TWINS, key, data, {
        contentType: 'application/octet-stream',
        metadata: { twinId, name },
      });
      return key;
    }
    const dir = path.join(LOCAL_TWINS_DIR, twinId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, data);
    return filePath;
  }

  /**
   * Open a twin artifact for streaming. A key that looks like an absolute
   * path is read from the local filesystem; otherwise it is fetched from the
   * DIGITAL_TWINS bucket.
   */
  async getTwinArtifactStream(key: string): Promise<Readable> {
    if (this.isLocalKey(key)) {
      return createReadStream(key);
    }
    const client = getRustFSClient();
    return client.getStream(BUCKETS.DIGITAL_TWINS, key);
  }

  /**
   * Presigned download URL for a twin artifact stored on rustfs. Throws for
   * local-filesystem keys (those are streamed through the server instead).
   */
  async getTwinArtifactDownloadUrl(key: string, expiresIn = URL_EXPIRY.DOWNLOAD): Promise<string> {
    if (this.isLocalKey(key)) {
      throw new Error('Cannot presign a local-filesystem twin artifact key');
    }
    const client = getRustFSClient();
    return client.getPresignedDownloadUrl(BUCKETS.DIGITAL_TWINS, key, expiresIn);
  }

  /**
   * Delete a twin artifact (local file or rustfs object).
   */
  async deleteTwinArtifact(key: string): Promise<void> {
    if (this.isLocalKey(key)) {
      await fs.unlink(key).catch(() => {});
      return;
    }
    const client = getRustFSClient();
    await client.delete(BUCKETS.DIGITAL_TWINS, key);
  }

  private getTwinArtifactKey(twinId: string, name: string): string {
    return `${twinId}/${name}`;
  }

  /** A stored key is "local" when it is an absolute filesystem path. */
  private isLocalKey(key: string): boolean {
    return path.isAbsolute(key);
  }

  // ==========================================================================
  // INCIDENT CLIP OPERATIONS (TASK-179 §6)
  // ==========================================================================
  //
  // Highlight clips are small JSON documents ({ format: 'jpeg-frames', ... })
  // uploaded by the robot agent when a rollout fails. Mirrors the digital-twin
  // artifact split: RustFS bucket when available, local filesystem fallback
  // otherwise (the returned "key" is then the absolute file path).

  /**
   * Store an incident highlight clip (raw JSON bytes). Returns the storage
   * key persisted on `Incident.clipKey`.
   */
  async uploadIncidentClip(incidentId: string, data: Buffer): Promise<string> {
    if (this.isAvailable()) {
      const client = getRustFSClient();
      const key = this.getIncidentClipKey(incidentId);
      await client.upload(BUCKETS.INCIDENT_CLIPS, key, data, {
        contentType: 'application/json',
        metadata: { incidentId },
      });
      return key;
    }
    const dir = path.join(LOCAL_INCIDENT_CLIPS_DIR, incidentId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'clip.json');
    await fs.writeFile(filePath, data);
    return filePath;
  }

  /**
   * Open an incident clip for streaming. Absolute-path keys are read from
   * the local filesystem; other keys from the INCIDENT_CLIPS bucket.
   */
  async getIncidentClipStream(key: string): Promise<Readable> {
    if (this.isLocalKey(key)) {
      return createReadStream(key);
    }
    const client = getRustFSClient();
    return client.getStream(BUCKETS.INCIDENT_CLIPS, key);
  }

  /**
   * Delete an incident clip (local file or rustfs object).
   */
  async deleteIncidentClip(key: string): Promise<void> {
    if (this.isLocalKey(key)) {
      await fs.unlink(key).catch(() => {});
      return;
    }
    const client = getRustFSClient();
    await client.delete(BUCKETS.INCIDENT_CLIPS, key);
  }

  private getIncidentClipKey(incidentId: string): string {
    return `incidents/${incidentId}/clip.json`;
  }

  // ==========================================================================
  // TEMP UPLOAD MANAGEMENT
  // ==========================================================================

  /**
   * Clean up temporary uploads older than specified hours
   */
  async cleanupTempUploads(maxAgeHours = 24): Promise<CleanupResult> {
    const client = getRustFSClient();
    const result: CleanupResult = {
      deletedCount: 0,
      deletedSize: 0,
      errors: [],
    };

    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;

    // Clean up temp/ prefix in model-checkpoints bucket
    for await (const obj of client.listAll(BUCKETS.MODEL_CHECKPOINTS, 'temp/')) {
      if (obj.lastModified.getTime() < cutoffTime) {
        try {
          await client.delete(BUCKETS.MODEL_CHECKPOINTS, obj.key);
          result.deletedCount++;
          result.deletedSize += obj.size;
        } catch (error) {
          result.errors.push(`Failed to delete ${obj.key}: ${error}`);
        }
      }
    }

    return result;
  }

  // ==========================================================================
  // STORAGE STATISTICS
  // ==========================================================================

  /**
   * Get storage statistics for a bucket
   */
  async getBucketStats(bucket: BucketName): Promise<StorageStats> {
    const client = getRustFSClient();
    let objectCount = 0;
    let totalSize = 0;

    for await (const obj of client.listAll(bucket)) {
      objectCount++;
      totalSize += obj.size;
    }

    return {
      bucket,
      objectCount,
      totalSize,
    };
  }

  /**
   * Get storage statistics for all buckets
   */
  async getAllStats(): Promise<StorageStats[]> {
    const stats: StorageStats[] = [];

    for (const bucket of Object.values(BUCKETS)) {
      try {
        stats.push(await this.getBucketStats(bucket));
      } catch (error) {
        console.warn(`[ModelStorage] Failed to get stats for ${bucket}:`, error);
        stats.push({
          bucket,
          objectCount: 0,
          totalSize: 0,
        });
      }
    }

    return stats;
  }

  // ==========================================================================
  // PRESIGNED URL HELPERS
  // ==========================================================================

  /**
   * Get presigned upload URL with size validation
   */
  async getPresignedUploadUrl(
    bucket: BucketName,
    key: string,
    contentType: string,
    size: number
  ): Promise<{ url: string; expiresIn: number }> {
    // Validate size limits
    const limit = this.getSizeLimit(bucket);
    if (size > limit) {
      throw new Error(
        `File size ${size} exceeds limit ${limit} for bucket ${bucket}`
      );
    }

    const client = getRustFSClient();
    const url = await client.getPresignedUploadUrl(
      bucket,
      key,
      URL_EXPIRY.UPLOAD,
      contentType
    );

    return {
      url,
      expiresIn: URL_EXPIRY.UPLOAD,
    };
  }

  /**
   * Get presigned download URL
   */
  async getPresignedDownloadUrl(
    bucket: BucketName,
    key: string
  ): Promise<{ url: string; expiresIn: number }> {
    const client = getRustFSClient();
    const url = await client.getPresignedDownloadUrl(bucket, key, URL_EXPIRY.DOWNLOAD);

    return {
      url,
      expiresIn: URL_EXPIRY.DOWNLOAD,
    };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private getDatasetKey(name: string, version: string): string {
    return `${name}/${version}/data.bin`;
  }

  private getCheckpointKey(jobId: string, epoch: number): string {
    return `${jobId}/epoch-${epoch}/model.safetensors`;
  }

  private getModelKey(modelName: string, version: string): string {
    return `${modelName}/${version}.onnx`;
  }

  private getRobotLogKey(robotId: string, date: string, logType: string): string {
    return `${robotId}/${logType}/${date}.log`;
  }

  private getSizeLimit(bucket: BucketName): number {
    switch (bucket) {
      case BUCKETS.TRAINING_DATASETS:
        return SIZE_LIMITS.DATASET;
      case BUCKETS.MODEL_CHECKPOINTS:
        return SIZE_LIMITS.CHECKPOINT;
      case BUCKETS.PRODUCTION_MODELS:
        return SIZE_LIMITS.MODEL;
      case BUCKETS.ROBOT_LOGS:
        return SIZE_LIMITS.LOG;
      case BUCKETS.SENSOR_SCANS:
        return SIZE_LIMITS.SCAN;
      case BUCKETS.DIGITAL_TWINS:
        return SIZE_LIMITS.TWIN;
      default:
        return SIZE_LIMITS.DATASET;
    }
  }

  private stringifyMetadata(
    metadata?: Record<string, unknown>
  ): Record<string, string> {
    if (!metadata) return {};

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== null) {
        result[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }
    return result;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const modelStorage = new ModelStorageClient();

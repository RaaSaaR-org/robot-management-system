/**
 * @file HuggingFaceImportService.ts
 * @description Service for importing LeRobot datasets from HuggingFace Hub into RMS
 * @feature datasets
 */

import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import {
  datasetRepository,
  robotTypeRepository,
} from '../repositories/index.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';
import { BUCKETS } from '../storage/model-storage.js';
import { natsClient } from '../messaging/index.js';
import { datasetService } from './DatasetService.js';
import type { CreateDatasetInput } from '../types/vla.types.js';
import type {
  HuggingFaceImportRequest,
  HuggingFaceImportProgress,
  LeRobotInfoV3,
} from '../types/dataset.types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const HF_BASE_URL = 'https://huggingface.co/datasets';
const DATASET_VALIDATION_SUBJECT = 'jobs.dataset.validate';
const MAX_CONCURRENT_DOWNLOADS = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const INITIAL_RETRY_DELAY_MS = 1_000;

// ============================================================================
// HUGGINGFACE IMPORT SERVICE
// ============================================================================

/**
 * Service for importing datasets from HuggingFace Hub
 */
export class HuggingFaceImportService {
  private static instance: HuggingFaceImportService;

  private constructor() {}

  static getInstance(): HuggingFaceImportService {
    if (!HuggingFaceImportService.instance) {
      HuggingFaceImportService.instance = new HuggingFaceImportService();
    }
    return HuggingFaceImportService.instance;
  }

  /**
   * Import a dataset from HuggingFace Hub
   * Returns the dataset ID immediately; import runs in background.
   */
  async importDataset(request: HuggingFaceImportRequest): Promise<string> {
    const { repoId, revision = 'main', robotTypeId, includeVideos = false } = request;

    // Validate robotTypeId if provided
    if (robotTypeId) {
      const robotType = await robotTypeRepository.findById(robotTypeId);
      if (!robotType) {
        throw new Error(`Robot type not found: ${robotTypeId}`);
      }
    }

    // Phase 1: Fetch info.json metadata
    const info = await this.fetchInfoJson(repoId, revision);

    // Create dataset record
    const datasetId = uuidv4();
    const storagePath = `${datasetId}/`;
    const datasetName = repoId.includes('/') ? repoId.split('/').pop()! : repoId;

    const input: CreateDatasetInput = {
      name: datasetName,
      description: `Imported from HuggingFace: ${repoId} (${revision})`,
      robotTypeId: robotTypeId ?? '',
      storagePath,
      lerobotVersion: info.codebase_version ?? 'unknown',
      fps: info.fps ?? 0,
      totalFrames: info.total_frames ?? 0,
      totalDuration: info.fps > 0 ? (info.total_frames ?? 0) / info.fps : 0,
      demonstrationCount: info.total_episodes ?? 0,
      status: 'importing',
      huggingFaceRepoId: repoId,
    };

    await datasetRepository.create(input);

    // Emit import started event
    this.emitProgress(datasetId, {
      datasetId,
      status: 'importing',
      phase: 'metadata',
      progress: 5,
      totalFiles: 0,
      completedFiles: 0,
    });

    // Run download in background (don't await)
    this.runImport(datasetId, repoId, revision, storagePath, info, includeVideos).catch(
      (error) => {
        console.error(`[HFImport] Background import failed for ${datasetId}:`, error);
      }
    );

    return datasetId;
  }

  // ============================================================================
  // INTERNAL: IMPORT PIPELINE
  // ============================================================================

  /**
   * Run the full import pipeline (called in background)
   */
  private async runImport(
    datasetId: string,
    repoId: string,
    revision: string,
    storagePath: string,
    info: LeRobotInfoV3,
    includeVideos: boolean
  ): Promise<void> {
    try {
      // Phase 2: Build file list
      const files = this.buildFileList(info, includeVideos);

      this.emitProgress(datasetId, {
        datasetId,
        status: 'importing',
        phase: 'downloading',
        progress: 10,
        totalFiles: files.length,
        completedFiles: 0,
      });

      // Phase 3: Download files to RustFS
      await this.downloadFiles(datasetId, repoId, revision, storagePath, files);

      // Phase 4: Trigger validation via NATS
      this.emitProgress(datasetId, {
        datasetId,
        status: 'validating',
        phase: 'validating',
        progress: 90,
        totalFiles: files.length,
        completedFiles: files.length,
      });

      await datasetRepository.update(datasetId, { status: 'validating' });

      if (natsClient.isConnected()) {
        const js = natsClient.getJetStream();
        if (js) {
          const payload = JSON.stringify({ datasetId, storagePath });
          await js.publish(DATASET_VALIDATION_SUBJECT, new TextEncoder().encode(payload), {
            msgID: `validate-${datasetId}`,
          });
          console.log(`[HFImport] Queued validation job for ${datasetId}`);
        }
      } else {
        // Run validation synchronously if NATS not available
        await datasetService.validateAndUpdateDataset(datasetId, storagePath);
      }

      // Emit completion
      this.emitProgress(datasetId, {
        datasetId,
        status: 'validating',
        phase: 'validating',
        progress: 95,
        totalFiles: files.length,
        completedFiles: files.length,
      });

      datasetService.emit('dataset:event', {
        type: 'dataset:import:completed',
        datasetId,
        timestamp: new Date().toISOString(),
      });

      console.log(`[HFImport] Import completed for ${datasetId} (${repoId})`);
    } catch (error) {
      console.error(`[HFImport] Import failed for ${datasetId}:`, error);

      await datasetRepository.update(datasetId, { status: 'failed' });

      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emitProgress(datasetId, {
        datasetId,
        status: 'failed',
        phase: 'downloading',
        progress: 0,
        error: errorMessage,
      });

      datasetService.emit('dataset:event', {
        type: 'dataset:import:failed',
        datasetId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ============================================================================
  // PHASE 1: FETCH METADATA
  // ============================================================================

  /**
   * Fetch and parse info.json from HuggingFace
   */
  async fetchInfoJson(repoId: string, revision: string): Promise<LeRobotInfoV3> {
    const url = `${HF_BASE_URL}/${repoId}/resolve/${revision}/meta/info.json`;
    const response = await this.fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch info.json from ${repoId}: ${response.status} ${response.statusText}`
      );
    }

    const info = (await response.json()) as LeRobotInfoV3;

    // Validate required fields
    if (!info.codebase_version) {
      throw new Error('info.json missing required field: codebase_version');
    }
    if (!info.robot_type) {
      throw new Error('info.json missing required field: robot_type');
    }
    if (typeof info.fps !== 'number' || info.fps <= 0) {
      throw new Error('info.json missing or invalid field: fps');
    }

    return info;
  }

  // ============================================================================
  // PHASE 2: BUILD FILE LIST
  // ============================================================================

  /**
   * Build the list of files to download based on info.json metadata
   */
  buildFileList(info: LeRobotInfoV3, includeVideos: boolean): string[] {
    const files: string[] = [];

    // Always include metadata files
    files.push('meta/info.json');
    files.push('meta/stats.json');

    // Build parquet file paths
    // LeRobot v3.0+: chunks_size = max episodes per chunk folder
    //   → file naming: data/chunk-000/file-000.parquet (one file per chunk)
    // LeRobot v1/v2: one parquet per episode
    //   → file naming: data/chunk-000/episode_000000.parquet
    const totalEpisodes = info.total_episodes ?? 0;
    const chunksSize = info.chunks_size ?? 1000;
    const totalChunks = info.total_chunks ?? Math.ceil(totalEpisodes / chunksSize);
    const isV3Format = (info.codebase_version ?? '').startsWith('v3');

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      const chunkDir = `data/chunk-${String(chunk).padStart(3, '0')}`;
      if (isV3Format) {
        // v3.0: one parquet file per chunk folder named file-000.parquet
        files.push(`${chunkDir}/file-000.parquet`);
      } else {
        // Legacy: one parquet per episode
        const episodesInChunk = Math.min(chunksSize, totalEpisodes - chunk * chunksSize);
        for (let ep = 0; ep < episodesInChunk; ep++) {
          const globalEp = chunk * chunksSize + ep;
          files.push(`${chunkDir}/episode_${String(globalEp).padStart(6, '0')}.parquet`);
        }
      }
    }

    // Include video files if requested
    if (includeVideos && info.features) {
      for (const [featureName, feature] of Object.entries(info.features)) {
        if (feature.video) {
          for (let chunk = 0; chunk < totalChunks; chunk++) {
            const chunkDir = `videos/chunk-${String(chunk).padStart(3, '0')}`;
            const episodesInChunk = Math.min(chunksSize, totalEpisodes - chunk * chunksSize);
            for (let ep = 0; ep < episodesInChunk; ep++) {
              const globalEp = chunk * chunksSize + ep;
              files.push(
                `${chunkDir}/${featureName}/episode_${String(globalEp).padStart(6, '0')}.mp4`
              );
            }
          }
        }
      }
    }

    return files;
  }

  // ============================================================================
  // PHASE 3: PARALLEL DOWNLOAD
  // ============================================================================

  /**
   * Download files from HuggingFace to RustFS with concurrency limit
   */
  private async downloadFiles(
    datasetId: string,
    repoId: string,
    revision: string,
    storagePath: string,
    files: string[]
  ): Promise<void> {
    if (!isRustFSInitialized()) {
      throw new Error('RustFS storage not available');
    }

    const client = getRustFSClient();
    let completedFiles = 0;
    const totalFiles = files.length;

    // Concurrency-limited parallel download
    const queue = [...files];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < MAX_CONCURRENT_DOWNLOADS; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const file = queue.shift();
            if (!file) break;

            const hfUrl = `${HF_BASE_URL}/${repoId}/resolve/${revision}/${file}`;
            const rustfsKey = `${storagePath}${file}`;

            try {
              await this.downloadFileToRustFS(hfUrl, BUCKETS.TRAINING_DATASETS, rustfsKey, client);
            } catch (error) {
              // stats.json is optional — 404 is expected
              if (file === 'meta/stats.json' && error instanceof Error && error.message.includes('404')) {
                console.log(`[HFImport] stats.json not found (optional), skipping`);
              } else {
                throw error;
              }
            }

            completedFiles++;
            const downloadProgress = 10 + Math.round((completedFiles / totalFiles) * 80);

            this.emitProgress(datasetId, {
              datasetId,
              status: 'importing',
              phase: 'downloading',
              progress: downloadProgress,
              currentFile: file,
              totalFiles,
              completedFiles,
            });
          }
        })()
      );
    }

    await Promise.all(workers);
  }

  /**
   * Download a single file from HuggingFace and stream it to RustFS
   */
  private async downloadFileToRustFS(
    url: string,
    bucket: string,
    key: string,
    client: ReturnType<typeof getRustFSClient>
  ): Promise<void> {
    const response = await this.fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error(`Empty response body for ${url}`);
    }

    // Convert web ReadableStream to Node.js Readable for S3 upload
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    await client.upload(bucket, key, nodeStream, { contentType });
  }

  // ============================================================================
  // HTTP WITH RETRY
  // ============================================================================

  /**
   * Fetch with exponential backoff retry on 429 (rate limit)
   */
  async fetchWithRetry(url: string, maxRetries = 5): Promise<Response> {
    let delay = INITIAL_RETRY_DELAY_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url);

      if (response.status !== 429) {
        return response;
      }

      if (attempt === maxRetries) {
        return response;
      }

      // Respect Retry-After header if present
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : delay;

      console.log(
        `[HFImport] Rate limited (429) on ${url}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`
      );

      await this.sleep(Math.min(waitMs, MAX_RETRY_DELAY_MS));
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }

    // Unreachable, but TypeScript needs it
    throw new Error(`Max retries exceeded for ${url}`);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Emit import progress via DatasetService events
   */
  private emitProgress(datasetId: string, progress: HuggingFaceImportProgress): void {
    datasetService.emit('dataset:event', {
      type: 'dataset:import:progress',
      datasetId,
      importProgress: progress,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const huggingFaceImportService = HuggingFaceImportService.getInstance();

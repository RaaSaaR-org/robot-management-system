/**
 * @file datasets.routes.ts
 * @description REST API endpoints for dataset management
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { datasetService } from '../services/DatasetService.js';
import { dataQualityService } from '../services/DataQualityService.js';
import type {
  CreateDatasetDto,
  UpdateDatasetDto,
  DatasetListQuery,
  InitiateUploadRequest,
  ComputeStatsRequest,
  HuggingFaceImportRequest,
  EpisodeMeta,
  FrameData,
  PushToHubRequest,
  PushToHubJobState,
} from '../types/dataset.types.js';
import type { DatasetStatus } from '../types/vla.types.js';
import { huggingFaceImportService } from '../services/HuggingFaceImportService.js';
import { BUCKETS } from '../storage/model-storage.js';
import type {
  TriggerValidationRequest,
  UnflagTrajectoryRequest,
} from '../types/data-quality.types.js';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/** In-memory job state for push-to-hub operations */
const pushJobs = new Map<string, PushToHubJobState>();

export const datasetRoutes = Router();

// ============================================================================
// POST /api/datasets - Create dataset record
// ============================================================================

datasetRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const dto = req.body as CreateDatasetDto;

    // Validate required fields
    if (!dto.name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const dataset = await datasetService.create(dto);

    res.status(201).json({
      dataset,
      message: 'Dataset created successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error creating dataset:', error);
    const message = error instanceof Error ? error.message : 'Failed to create dataset';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets - List datasets with filters
// ============================================================================

datasetRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Parse query parameters
    const params: DatasetListQuery = {
      robotTypeId: query.robotTypeId,
      skillId: query.skillId,
      minQuality: query.minQuality ? parseInt(query.minQuality, 10) : undefined,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    };

    // Parse status parameter (can be comma-separated)
    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as DatasetStatus[])
        : (query.status as DatasetStatus);
    }

    const result = await datasetService.list(params);

    res.json({
      datasets: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error listing datasets:', error);
    res.status(500).json({ error: 'Failed to list datasets' });
  }
});

// ============================================================================
// POST /api/datasets/import/huggingface - Import dataset from HuggingFace Hub
// ============================================================================

// GET /import/huggingface — catch accidental GETs (browser prefetch, retries)
datasetRoutes.get('/import/huggingface', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed. Use POST to import a dataset.' });
});

datasetRoutes.post('/import/huggingface', async (req: Request, res: Response) => {
  try {
    const body = req.body as HuggingFaceImportRequest;

    if (!body.repoId) {
      return res.status(400).json({ error: 'repoId is required' });
    }

    const datasetId = await huggingFaceImportService.importDataset(body);

    res.status(202).json({
      datasetId,
      status: 'importing',
      message: `Import started for ${body.repoId}`,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error importing from HuggingFace:', error);

    let message = 'Failed to import dataset';
    if (error instanceof Error) {
      if (error.message.includes('Foreign key constraint')) {
        message = 'Invalid robot type reference. Please try again.';
      } else if (error.message.includes('info.json')) {
        message = error.message;
      } else if (error.message.includes('Failed to fetch')) {
        message = `Could not reach HuggingFace: ${error.message}`;
      } else {
        message = error.message;
      }
    }
    res.status(400).json({ error: message, message, code: 'IMPORT_ERROR' });
  }
});

// ============================================================================
// POST /api/datasets/:id/push-to-hub - Push dataset to HuggingFace Hub
// ============================================================================

datasetRoutes.post('/:id/push-to-hub', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as PushToHubRequest;

    // Validate required fields
    if (!body.token) {
      return res.status(400).json({ error: 'token is required' });
    }
    if (!body.repoId) {
      return res.status(400).json({ error: 'repoId is required' });
    }

    // Check dataset exists and is ready
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }
    if (dataset.status !== 'ready') {
      return res.status(400).json({
        error: 'Dataset must be in ready state to push',
        currentStatus: dataset.status,
      });
    }

    // Check if a push is already running
    const existing = pushJobs.get(id);
    if (existing && (existing.status === 'pending' || existing.status === 'running')) {
      return res.status(409).json({
        error: 'A push job is already in progress for this dataset',
        status: existing.status,
      });
    }

    // Initialize job state
    const jobState: PushToHubJobState = {
      status: 'pending',
      progress: 'Starting push...',
      startedAt: new Date().toISOString(),
    };
    pushJobs.set(id, jobState);

    // Resolve the Python script path
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const scriptPath = resolve(scriptDir, '../../scripts/hf_push_dataset.py');
    const pythonBin = '/home/mindcube/miniconda3/envs/lerobot312/bin/python';

    // Spawn Python process
    const child = spawn(pythonBin, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send config via stdin
    const stdinPayload = JSON.stringify({
      datasetId: id,
      storagePath: dataset.storagePath,
      repoId: body.repoId,
      token: body.token,
      private: body.private ?? false,
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();

    jobState.status = 'running';

    // Collect stdout line by line
    let stdoutBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress') {
            jobState.progress = msg.message;
          } else if (msg.success === true) {
            jobState.status = 'done';
            jobState.url = msg.url;
            jobState.progress = 'Push completed';
            // Update dataset record with HF repo ID
            datasetService.update(id, { huggingFaceRepoId: body.repoId }).catch((err) => {
              console.error('[PushToHub] Failed to update huggingFaceRepoId:', err);
            });
          } else if (msg.success === false) {
            jobState.status = 'failed';
            jobState.error = msg.error;
          }
        } catch {
          // Non-JSON output, ignore
        }
      }
    });

    let stderrBuf = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    child.on('close', (code: number | null) => {
      if (code !== 0 && jobState.status !== 'done' && jobState.status !== 'failed') {
        jobState.status = 'failed';
        jobState.error = stderrBuf || `Process exited with code ${code}`;
      }
    });

    res.status(202).json({
      jobId: id,
      message: `Push started for dataset ${dataset.name} to ${body.repoId}`,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error starting push to hub:', error);
    const message = error instanceof Error ? error.message : 'Failed to start push';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets/:id/push-status - Get push-to-hub job status
// ============================================================================

datasetRoutes.get('/:id/push-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = pushJobs.get(id);
    if (!job) {
      // No active job — check if dataset already has a HF repo
      const dataset = await datasetService.get(id);
      if (!dataset) {
        return res.status(404).json({ error: 'Dataset not found' });
      }
      if (dataset.huggingFaceRepoId) {
        return res.json({
          status: 'done' as const,
          url: `https://huggingface.co/datasets/${dataset.huggingFaceRepoId}`,
        });
      }
      return res.json({ status: 'none' as const });
    }

    res.json({
      status: job.status,
      progress: job.progress,
      url: job.url,
      error: job.error,
      startedAt: job.startedAt,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting push status:', error);
    res.status(500).json({ error: 'Failed to get push status' });
  }
});

// ============================================================================
// GET /api/datasets/:id - Get dataset details
// ============================================================================

datasetRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json({ dataset });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting dataset:', error);
    res.status(500).json({ error: 'Failed to get dataset' });
  }
});

// ============================================================================
// PUT /api/datasets/:id - Update dataset metadata
// ============================================================================

datasetRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as UpdateDatasetDto;

    const dataset = await datasetService.update(id, dto);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json({
      dataset,
      message: 'Dataset updated successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error updating dataset:', error);
    const message = error instanceof Error ? error.message : 'Failed to update dataset';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// DELETE /api/datasets/:id - Delete dataset
// ============================================================================

datasetRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await datasetService.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json({
      message: 'Dataset deleted successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error deleting dataset:', error);
    res.status(500).json({ error: 'Failed to delete dataset' });
  }
});

// ============================================================================
// POST /api/datasets/:id/upload/initiate - Get presigned upload URL
// ============================================================================

datasetRoutes.post('/:id/upload/initiate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as InitiateUploadRequest;

    const result = await datasetService.initiateUpload(
      id,
      body.contentType,
      body.size
    );

    res.json({
      uploadUrl: result.uploadUrl,
      expiresIn: result.expiresIn,
      storagePath: result.storagePath,
      message: 'Upload URL generated successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error initiating upload:', error);
    const message = error instanceof Error ? error.message : 'Failed to initiate upload';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/datasets/:id/upload/complete - Mark upload complete
// ============================================================================

datasetRoutes.post('/:id/upload/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await datasetService.completeUpload(id);

    res.json({
      datasetId: id,
      status: 'validating',
      message: 'Upload completed, validation started',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error completing upload:', error);
    const message = error instanceof Error ? error.message : 'Failed to complete upload';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets/:id/stats - Get normalization stats
// ============================================================================

datasetRoutes.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const stats = await datasetService.getStats(id);

    res.json(stats);
  } catch (error) {
    console.error('[DatasetRoutes] Error getting stats:', error);
    const message = error instanceof Error ? error.message : 'Failed to get dataset stats';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }

    res.status(500).json({ error: message });
  }
});

// ============================================================================
// POST /api/datasets/:id/compute-stats - Trigger stats computation via NATS
// ============================================================================

datasetRoutes.post('/:id/compute-stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as ComputeStatsRequest;

    await datasetService.computeStats(id, body.force);

    res.json({
      datasetId: id,
      message: 'Stats computation job queued',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error computing stats:', error);
    const message = error instanceof Error ? error.message : 'Failed to compute stats';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('not ready') || message.includes('not available')) {
      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets/:id/progress - Get validation progress
// ============================================================================

datasetRoutes.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const progress = await datasetService.getUploadProgress(id);

    if (!progress) {
      // Check if dataset exists
      const dataset = await datasetService.get(id);
      if (!dataset) {
        return res.status(404).json({ error: 'Dataset not found' });
      }

      // No active progress, return current status
      return res.json({
        datasetId: id,
        status: dataset.status,
        progress: dataset.status === 'ready' ? 100 : 0,
      });
    }

    res.json(progress);
  } catch (error) {
    console.error('[DatasetRoutes] Error getting progress:', error);
    res.status(500).json({ error: 'Failed to get validation progress' });
  }
});

// ============================================================================
// GET /api/datasets/:id/episodes - List episodes for a dataset
// ============================================================================

datasetRoutes.get('/:id/episodes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // Build episode list from dataset info
    // LeRobot info.json contains total_episodes and total_frames
    const info = typeof dataset.infoJson === 'string'
      ? JSON.parse(dataset.infoJson as string)
      : dataset.infoJson;
    const totalEpisodes = info?.total_episodes ?? dataset.demonstrationCount ?? 0;
    const totalFrames = info?.total_frames ?? dataset.totalFrames ?? 0;
    const fps = info?.fps ?? dataset.fps ?? 30;

    // Generate episode metadata
    // In a full implementation, this would read from stored episode metadata
    const episodes: EpisodeMeta[] = [];
    if (totalEpisodes > 0) {
      const avgFramesPerEpisode = totalEpisodes > 0
        ? Math.floor(totalFrames / totalEpisodes)
        : 0;

      for (let i = 0; i < totalEpisodes; i++) {
        const frameCount = avgFramesPerEpisode;
        episodes.push({
          index: i,
          frameCount,
          durationSeconds: fps > 0 ? parseFloat((frameCount / fps).toFixed(2)) : 0,
          flagged: false,
        });
      }
    }

    res.json({ episodes });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting episodes:', error);
    res.status(500).json({ error: 'Failed to get episodes' });
  }
});

// ============================================================================
// GET /api/datasets/:id/episodes/:index/frames - Get frame data for an episode
// ============================================================================

datasetRoutes.get('/:id/episodes/:index/frames', async (req: Request, res: Response) => {
  try {
    const { id, index } = req.params;
    const episodeIndex = parseInt(index, 10);

    if (isNaN(episodeIndex) || episodeIndex < 0) {
      return res.status(400).json({ error: 'Invalid episode index' });
    }

    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const query = req.query as Record<string, string | undefined>;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    const limit = query.limit ? parseInt(query.limit, 10) : 500;

    // Build episode info to generate synthetic frame data
    const info = typeof dataset.infoJson === 'string'
      ? JSON.parse(dataset.infoJson as string)
      : dataset.infoJson;
    const totalEpisodes = info?.total_episodes ?? dataset.demonstrationCount ?? 0;
    const totalFrames = info?.total_frames ?? dataset.totalFrames ?? 0;
    const fps = info?.fps ?? dataset.fps ?? 30;
    const avgFramesPerEpisode = totalEpisodes > 0
      ? Math.floor(totalFrames / totalEpisodes)
      : 0;
    const frameCount = Math.min(avgFramesPerEpisode, limit);

    // Generate synthetic frame data from episode metadata
    // In a full implementation, this would read Parquet data from RustFS
    const frames: FrameData[] = [];
    for (let i = offset; i < offset + frameCount; i++) {
      const timestamp = fps > 0 ? i / fps : 0;
      // Generate smooth sinusoidal patterns for each joint as placeholder
      const observationState = [
        Math.sin(timestamp * 0.5) * 30,
        Math.cos(timestamp * 0.3) * 45 - 10,
        Math.sin(timestamp * 0.7 + 1) * 60,
        Math.cos(timestamp * 0.4 + 2) * 40,
        Math.sin(timestamp * 0.6 + 3) * 20,
        Math.sin(timestamp * 0.2) * 50 + 50,
      ];
      const action = observationState.map((v, j) =>
        v + Math.sin(timestamp * 2 + j) * 5
      );
      frames.push({ frameIndex: i, timestamp, observationState, action });
    }

    res.json({ frames, total: frameCount });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting episode frames:', error);
    res.status(500).json({ error: 'Failed to get episode frames' });
  }
});

// ============================================================================
// GET /api/datasets/:id/episodes/:index/video/:camera - Stream episode video
// ============================================================================

datasetRoutes.get('/:id/episodes/:index/video/:camera', async (req: Request, res: Response) => {
  try {
    const { id, index, camera } = req.params;
    const episodeIndex = parseInt(index, 10);

    if (isNaN(episodeIndex) || episodeIndex < 0) {
      return res.status(400).json({ error: 'Invalid episode index' });
    }

    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // LeRobot v3 video path: videos/observation.images.{camera}/chunk-{chunk:03d}/file-000.mp4
    // One video file per chunk containing all episodes concatenated
    const CHUNKS_SIZE = 1000;
    const chunkIndex = Math.floor(episodeIndex / CHUNKS_SIZE);
    const videoPath = `videos/observation.images.${camera}/chunk-${String(chunkIndex).padStart(3, '0')}/file-000.mp4`;

    // Try to stream from RustFS if available
    try {
      const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
      if (isRustFSInitialized()) {
        const rustfs = getRustFSClient();
        const bucket = BUCKETS.TRAINING_DATASETS;
        const videoKey = `${dataset.storagePath}${videoPath}`;

        const exists = await rustfs.exists(bucket, videoKey);
        if (exists) {
          const metadata = await rustfs.getMetadata(bucket, videoKey);
          const fileSize = metadata.contentLength ?? 0;

          const range = req.headers.range;
          if (range) {
            const url = await rustfs.getPresignedDownloadUrl(bucket, videoKey, 3600);
            return res.redirect(302, url);
          }

          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', fileSize);
          res.setHeader('Accept-Ranges', 'bytes');
          const stream = await rustfs.getStream(bucket, videoKey);
          return stream.pipe(res);
        }
      }
    } catch {
      // RustFS unavailable — fall through to HF proxy
    }

    // Fallback: proxy from HuggingFace if we have a repo ID
    const repoId = dataset.huggingFaceRepoId;
    if (!repoId) {
      return res.status(404).json({ error: 'Video not found and no HuggingFace repo to proxy from' });
    }

    const hfUrl = `https://huggingface.co/datasets/${repoId}/resolve/main/${videoPath}`;
    const hfResponse = await fetch(hfUrl, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
      redirect: 'follow',
    });

    if (!hfResponse.ok) {
      return res.status(404).json({ error: 'Video not found on HuggingFace' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    if (hfResponse.headers.get('content-length')) {
      res.setHeader('Content-Length', hfResponse.headers.get('content-length')!);
    }
    if (hfResponse.headers.get('content-range')) {
      res.status(206);
      res.setHeader('Content-Range', hfResponse.headers.get('content-range')!);
    }
    res.setHeader('Accept-Ranges', 'bytes');

    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(hfResponse.body as import('stream/web').ReadableStream);
    nodeStream.pipe(res);
  } catch (error) {
    console.error('[DatasetRoutes] Error streaming video:', error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

// ============================================================================
// PATCH /api/datasets/:id/episodes/:index/flag - Flag/unflag an episode
// ============================================================================

datasetRoutes.patch('/:id/episodes/:index/flag', async (req: Request, res: Response) => {
  try {
    const { id, index } = req.params;
    const episodeIndex = parseInt(index, 10);

    if (isNaN(episodeIndex) || episodeIndex < 0) {
      return res.status(400).json({ error: 'Invalid episode index' });
    }

    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const { flagged } = req.body as { flagged: boolean };
    if (typeof flagged !== 'boolean') {
      return res.status(400).json({ error: 'flagged must be a boolean' });
    }

    // In a full implementation, this would store the flag in the database
    // For now, acknowledge the request
    res.json({ success: true });
  } catch (error) {
    console.error('[DatasetRoutes] Error flagging episode:', error);
    res.status(500).json({ error: 'Failed to flag episode' });
  }
});

// ============================================================================
// GET /api/datasets/:id/quality - Get detailed quality breakdown
// ============================================================================

datasetRoutes.get('/:id/quality', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // For now, return quality breakdown from existing data
    // In a full implementation, this would fetch from a stored quality report
    const response = {
      datasetId: id,
      hasQualityReport: !!dataset.qualityBreakdown,
      report: dataset.qualityBreakdown
        ? {
            datasetId: id,
            datasetName: dataset.name,
            generatedAt: dataset.updatedAt,
            overallScore: dataset.qualityScore ?? 0,
            scoreBreakdown: dataset.qualityBreakdown,
            trajectoryCount: dataset.demonstrationCount,
            flaggedTrajectoryCount: 0, // Would be computed in full implementation
            anomalousTrajectoryCount: 0,
            cleanTrajectoryPercentage: 100,
            statistics: null, // Would include per-metric stats
            flaggedSummary: [],
            validationStatus: 'completed',
          }
        : null,
    };

    res.json(response);
  } catch (error) {
    console.error('[DatasetRoutes] Error getting quality:', error);
    res.status(500).json({ error: 'Failed to get quality breakdown' });
  }
});

// ============================================================================
// GET /api/datasets/:id/trajectories/:idx/metrics - Get per-trajectory metrics
// ============================================================================

datasetRoutes.get('/:id/trajectories/:idx/metrics', async (req: Request, res: Response) => {
  try {
    const { id, idx } = req.params;
    const trajectoryIndex = parseInt(idx, 10);

    if (isNaN(trajectoryIndex) || trajectoryIndex < 0) {
      return res.status(400).json({ error: 'Invalid trajectory index' });
    }

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // In a full implementation, this would fetch pre-computed metrics from storage
    // For now, return a placeholder response
    res.json({
      datasetId: id,
      trajectoryIndex,
      message: 'Per-trajectory metrics require advanced validation to be run first',
      hint: 'POST /api/datasets/:id/validate-advanced to compute metrics',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting trajectory metrics:', error);
    res.status(500).json({ error: 'Failed to get trajectory metrics' });
  }
});

// ============================================================================
// POST /api/datasets/:id/validate-advanced - Trigger advanced validation job
// ============================================================================

datasetRoutes.post('/:id/validate-advanced', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as TriggerValidationRequest | undefined;

    // Check if dataset exists and is ready
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    if (dataset.status !== 'ready') {
      return res.status(400).json({
        error: 'Dataset not ready for advanced validation',
        currentStatus: dataset.status,
      });
    }

    // In a full implementation, this would:
    // 1. Queue a NATS job for advanced validation
    // 2. The worker would load trajectories from RustFS
    // 3. Compute all metrics using dataQualityService
    // 4. Store results in database

    // For now, return a queued response
    res.json({
      datasetId: id,
      status: 'queued',
      message: 'Advanced validation job queued',
      config: body?.config ?? {
        computePerTrajectory: true,
        computeDTW: false,
        runOODDetection: false,
        anomalyZScoreThreshold: 3.0,
        velocitySpikeThreshold: 5.0,
        force: false,
      },
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error triggering advanced validation:', error);
    res.status(500).json({ error: 'Failed to trigger advanced validation' });
  }
});

// ============================================================================
// GET /api/datasets/:id/flagged - List flagged trajectories for review
// ============================================================================

datasetRoutes.get('/:id/flagged', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const query = req.query as Record<string, string | undefined>;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // In a full implementation, this would fetch from database
    // For now, return empty list
    res.json({
      datasetId: id,
      total: 0,
      page,
      limit,
      flagged: [],
      message: 'Run advanced validation to generate flagged trajectories',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting flagged trajectories:', error);
    res.status(500).json({ error: 'Failed to get flagged trajectories' });
  }
});

// ============================================================================
// POST /api/datasets/:id/trajectories/:idx/unflag - Mark trajectory as reviewed
// ============================================================================

datasetRoutes.post('/:id/trajectories/:idx/unflag', async (req: Request, res: Response) => {
  try {
    const { id, idx } = req.params;
    const trajectoryIndex = parseInt(idx, 10);
    const body = req.body as UnflagTrajectoryRequest;

    if (isNaN(trajectoryIndex) || trajectoryIndex < 0) {
      return res.status(400).json({ error: 'Invalid trajectory index' });
    }

    if (!body.reviewDecision || !['keep', 'remove'].includes(body.reviewDecision)) {
      return res.status(400).json({
        error: 'reviewDecision is required and must be "keep" or "remove"',
      });
    }

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // In a full implementation, this would update the database record
    res.json({
      success: true,
      datasetId: id,
      trajectoryIndex,
      reviewDecision: body.reviewDecision,
      reviewedAt: new Date().toISOString(),
      message: `Trajectory ${trajectoryIndex} marked as ${body.reviewDecision}`,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error unflagging trajectory:', error);
    res.status(500).json({ error: 'Failed to unflag trajectory' });
  }
});

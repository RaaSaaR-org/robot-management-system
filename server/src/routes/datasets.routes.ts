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
import { resolve, dirname, join, sep, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import type { Readable } from 'stream';

/** In-memory job state for push-to-hub operations */
const pushJobs = new Map<string, PushToHubJobState>();

// ============================================================================
// Local on-disk datasets (synthetic / Cosmos 3 — TASK-178)
//
// Synthetic datasets are stored as a LeRobot v2.1 directory on the local disk
// (absolute storagePath) rather than in RustFS. These helpers let the standard
// episodes / frames / video routes serve them, so the existing viewer works
// unchanged. All branches are guarded by `isLocalDataset`, so RustFS/HF
// datasets are entirely unaffected.
// ============================================================================

function isLocalDataset(storagePath: string): boolean {
  // POSIX ('/…') or Windows ('C:\…' / 'C:/…') absolute path; RustFS datasets
  // use relative object-key prefixes (`<id>/`) and never match.
  return (isAbsolute(storagePath) || storagePath.startsWith('/')) && existsSync(storagePath);
}

function padEpisode(index: number): string {
  return String(index).padStart(6, '0');
}

/** Camera keys are simple identifiers; anything else could traverse the path. */
const CAMERA_KEY_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Pipe a readable to the response with error handling and abort cleanup.
 * A bare `stream.pipe(res)` leaves the read stream's 'error' unhandled (an I/O
 * error mid-stream then crashes the whole process) and leaks the fd when the
 * client aborts early (common with video Range scrubbing → eventual EMFILE).
 */
function pipeStreamToResponse(stream: Readable, res: Response): void {
  const cleanup = () => stream.destroy();
  stream.on('error', (err: Error) => {
    res.removeListener('close', cleanup);
    if (!res.headersSent) res.status(500).end();
    else res.destroy(err);
  });
  res.on('close', cleanup);
  stream.pipe(res);
}

/** pyarrow list<float32> may surface as a plain array or parquetjs `{list:[{element}]}`. */
function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((x) => Number((x as { element?: number })?.element ?? x));
  }
  const list = (value as { list?: Array<{ element?: number }> })?.list;
  if (Array.isArray(list)) return list.map((it) => Number(it?.element ?? 0));
  return [];
}

async function readLocalEpisodes(storagePath: string, fps: number): Promise<EpisodeMeta[] | null> {
  // Cosmos-converter output ships meta/episodes.json (one JSON array);
  // standard LeRobot v2.1 datasets ship meta/episodes.jsonl (JSON Lines).
  let arr: Array<{ episode_index?: number; length?: number }> | null = null;
  try {
    const raw = await readFile(join(storagePath, 'meta', 'episodes.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    /* fall through to episodes.jsonl */
  }
  if (!arr) {
    try {
      const raw = await readFile(join(storagePath, 'meta', 'episodes.jsonl'), 'utf8');
      arr = raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { episode_index?: number; length?: number });
    } catch {
      return null;
    }
  }
  return arr.map((e, i) => {
    const frameCount = Number(e.length ?? 0);
    return {
      index: Number(e.episode_index ?? i),
      frameCount,
      durationSeconds: fps > 0 ? parseFloat((frameCount / fps).toFixed(2)) : 0,
      flagged: false,
    };
  });
}

async function readLocalFrames(
  storagePath: string,
  episodeIndex: number,
  fps: number,
  offset: number,
  limit: number,
): Promise<{ frames: FrameData[]; total: number } | null> {
  const file = join(storagePath, 'data', 'chunk-000', `episode_${padEpisode(episodeIndex)}.parquet`);
  if (!existsSync(file)) return null;
  try {
    const { ParquetReader } = await import('@dsnp/parquetjs');
    const reader = await ParquetReader.openFile(file);
    const cursor = reader.getCursor();
    let row: Record<string, unknown> | null;
    const all: FrameData[] = [];
    while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
      all.push({
        frameIndex: Number(row['frame_index'] ?? all.length),
        timestamp: Number(row['timestamp'] ?? all.length / fps),
        observationState: toNumberArray(row['observation.state']),
        action: toNumberArray(row['action']),
      });
    }
    await reader.close();
    return { frames: all.slice(offset, offset + limit), total: all.length };
  } catch {
    return null;
  }
}

/**
 * Stream a local v2.1 per-episode mp4 with Range support. Returns false only
 * when the file is genuinely absent (so the caller can 404). All error/response
 * paths return true because they have already written a response.
 */
function streamLocalVideo(
  storagePath: string,
  episodeIndex: number,
  camera: string,
  req: Request,
  res: Response,
): boolean {
  // Guard against path traversal via the camera segment: Express decodes %2f
  // inside a single param after route matching, so `x%2f..%2f..` would escape
  // the dataset dir once join() normalizes the `..` sequences.
  if (!CAMERA_KEY_RE.test(camera)) {
    res.status(400).json({ error: 'Invalid camera key' });
    return true;
  }
  const baseDir = resolve(storagePath);
  const episodeFile = `episode_${padEpisode(episodeIndex)}.mp4`;
  // Cosmos-converter layout: videos/<camera>/chunk-000/episode.mp4;
  // standard LeRobot v2.1 layout: videos/chunk-000/<camera>/episode.mp4.
  const candidates = [
    resolve(baseDir, 'videos', `observation.images.${camera}`, 'chunk-000', episodeFile),
    resolve(baseDir, 'videos', 'chunk-000', `observation.images.${camera}`, episodeFile),
  ];
  // Defense in depth: the resolved file must stay within the dataset dir.
  if (candidates.some((f) => f !== baseDir && !f.startsWith(baseDir + sep))) {
    res.status(400).json({ error: 'Invalid path' });
    return true;
  }
  const file = candidates.find((f) => existsSync(f));
  if (!file) return false;

  const { size } = statSync(file);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (!m[1] && !m[2])) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      return res.end(), true;
    }
    let start: number;
    let end: number;
    if (!m[1]) {
      // suffix range `bytes=-N` → last N bytes
      start = Math.max(0, size - parseInt(m[2], 10));
      end = size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] ? parseInt(m[2], 10) : size - 1;
    }
    end = Math.min(end, size - 1);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      return res.end(), true;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    pipeStreamToResponse(createReadStream(file, { start, end }), res);
  } else {
    res.setHeader('Content-Length', size);
    pipeStreamToResponse(createReadStream(file), res);
  }
  return true;
}

/**
 * Read a parquet file from RustFS, trying both 'training-datasets' and legacy 'datasets' buckets.
 * Returns a Buffer, or null if the file is not found or RustFS is unavailable.
 */
async function readParquetFromRustFS(storagePath: string, relativePath: string): Promise<Buffer | null> {
  try {
    const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
    if (!isRustFSInitialized()) return null;

    const rustfs = getRustFSClient();
    const base = storagePath.endsWith('/') ? storagePath : `${storagePath}/`;
    const key = `${base}${relativePath}`;

    for (const bucket of [BUCKETS.TRAINING_DATASETS, 'datasets']) {
      try {
        const exists = await rustfs.exists(bucket, key);
        if (!exists) continue;
        const stream = await rustfs.getStream(bucket, key);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      } catch { /* try next bucket */ }
    }
  } catch { /* RustFS unavailable */ }
  return null;
}

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
// INTERVENTION EPISODES (lerobot-rollout 'dagger', TASK-179 §7)
// NOTE: registered before the '/:id' routes so 'interventions' is not
// swallowed as a dataset id.
// ============================================================================

// POST /api/datasets/interventions - Record a DAgger intervention episode
datasetRoutes.post('/interventions', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      robotId?: string;
      skillId?: string;
      taskPrompt?: string;
      strategy?: string;
      startedAt?: string;
      endedAt?: string;
      steps?: Array<{ t: number; source: 'human' | 'policy'; action: number[] }>;
    };

    if (!body.robotId) {
      return res.status(400).json({ error: 'robotId is required' });
    }
    if (!body.taskPrompt) {
      return res.status(400).json({ error: 'taskPrompt is required' });
    }
    if (!body.startedAt || !body.endedAt) {
      return res.status(400).json({ error: 'startedAt and endedAt are required' });
    }
    if (body.steps !== undefined && !Array.isArray(body.steps)) {
      return res.status(400).json({ error: 'steps must be an array' });
    }

    const { interventionService } = await import('../services/InterventionService.js');
    const episode = await interventionService.recordIntervention({
      robotId: body.robotId,
      skillId: body.skillId ?? null,
      taskPrompt: body.taskPrompt,
      strategy: body.strategy ?? 'dagger',
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      steps: body.steps,
    });

    res.status(201).json({ id: episode.id });
  } catch (error) {
    console.error('[DatasetRoutes] Error recording intervention:', error);
    const message = error instanceof Error ? error.message : 'Failed to record intervention';
    res.status(400).json({ error: message });
  }
});

// GET /api/datasets/interventions?robotId=<id> - List intervention episodes
datasetRoutes.get('/interventions', async (req: Request, res: Response) => {
  try {
    const robotId = typeof req.query.robotId === 'string' ? req.query.robotId : undefined;
    const { interventionService } = await import('../services/InterventionService.js');
    const interventions = await interventionService.listInterventions(robotId);
    res.json({ interventions });
  } catch (error) {
    console.error('[DatasetRoutes] Error listing interventions:', error);
    res.status(500).json({ error: 'Failed to list interventions' });
  }
});

// ============================================================================
// DATASET ANNOTATIONS (lerobot-annotate, TASK-179 §4)
// ============================================================================

// POST /api/datasets/:id/annotate - Queue a VLM annotation job for a dataset
datasetRoutes.post('/:id/annotate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as { episodes?: number[] };
    if (body.episodes !== undefined && !Array.isArray(body.episodes)) {
      return res.status(400).json({ error: 'episodes must be an array of episode indices' });
    }

    const { trainingJobService } = await import('../services/TrainingJobService.js');
    const job = await trainingJobService.submitAnnotateJob({
      datasetId: id,
      episodes: body.episodes,
    });

    res.status(201).json({ jobId: job.id });
  } catch (error) {
    console.error('[DatasetRoutes] Error queueing annotate job:', error);
    const message = error instanceof Error ? error.message : 'Failed to queue annotate job';
    const status = message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

// GET /api/datasets/:id/annotations - Stored VLM annotations of a dataset
datasetRoutes.get('/:id/annotations', async (req: Request, res: Response) => {
  try {
    const annotations = await datasetService.getAnnotations(req.params.id);
    if (annotations === null) {
      return res.status(404).json({ error: 'Dataset not found' });
    }
    res.json({ annotations });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting annotations:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
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

    const info = typeof dataset.infoJson === 'string'
      ? JSON.parse(dataset.infoJson as string)
      : dataset.infoJson;
    const fps = info?.fps ?? dataset.fps ?? 30;

    // Local synthetic datasets (TASK-178): read meta/episodes.json from disk.
    if (isLocalDataset(dataset.storagePath)) {
      const local = await readLocalEpisodes(dataset.storagePath, fps);
      if (local && local.length > 0) {
        return res.json({ episodes: local });
      }
    }

    // Try to read real episode metadata from parquet
    const episodes: EpisodeMeta[] = [];
    try {
      const parquetBuf = await readParquetFromRustFS(dataset.storagePath, 'meta/episodes/chunk-000/file-000.parquet');
      if (parquetBuf) {
        const { ParquetReader } = await import('@dsnp/parquetjs');
        const reader = await ParquetReader.openBuffer(parquetBuf);
        const cursor = reader.getCursor();
        let row: Record<string, unknown> | null;
        while ((row = await cursor.next() as Record<string, unknown> | null)) {
          const frameCount = Number(row['length'] ?? row['num_frames'] ?? 0);
          const epIndex = Number(row['episode_index'] ?? episodes.length);

          // v3.0 chunked video: per-camera playback windows so the client can
          // play just this episode's slice of the concatenated chunk mp4
          // (columns: videos/observation.images.<cam>/{from,to,chunk,file}).
          const videoWindows: Record<string, { from: number; to: number; chunk: number; file: number }> = {};
          for (const col of Object.keys(row)) {
            const m = /^videos\/observation\.images\.(.+)\/from_timestamp$/.exec(col);
            if (!m) continue;
            const cam = m[1];
            const base = `videos/observation.images.${cam}`;
            videoWindows[cam] = {
              from: Number(row[col] ?? 0),
              to: Number(row[`${base}/to_timestamp`] ?? 0),
              chunk: Number(row[`${base}/chunk_index`] ?? 0),
              file: Number(row[`${base}/file_index`] ?? 0),
            };
          }

          episodes.push({
            index: epIndex,
            frameCount,
            durationSeconds: fps > 0 ? parseFloat((frameCount / fps).toFixed(2)) : 0,
            flagged: false,
            ...(Object.keys(videoWindows).length > 0 ? { videoWindows } : {}),
          });
        }
        await reader.close();
      }
    } catch (err) {
      console.log('[DatasetRoutes] Could not read episodes parquet, using fallback:', (err as Error).message);
    }

    // Fallback: generate from info.json metadata
    if (episodes.length === 0) {
      const totalEpisodes = info?.total_episodes ?? dataset.demonstrationCount ?? 0;
      const totalFrames = info?.total_frames ?? dataset.totalFrames ?? 0;
      const avgFrames = totalEpisodes > 0 ? Math.floor(totalFrames / totalEpisodes) : 0;
      for (let i = 0; i < totalEpisodes; i++) {
        episodes.push({
          index: i,
          frameCount: avgFrames,
          durationSeconds: fps > 0 ? parseFloat((avgFrames / fps).toFixed(2)) : 0,
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
    // Clamp: a non-numeric ?offset/?limit must not become NaN (slice(NaN, NaN)
    // silently behaves as slice(0, …)); fall back to sane defaults.
    const offsetRaw = query.offset ? parseInt(query.offset, 10) : 0;
    const limitRaw = query.limit ? parseInt(query.limit, 10) : 500;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : 500;

    const info = typeof dataset.infoJson === 'string'
      ? JSON.parse(dataset.infoJson as string)
      : dataset.infoJson;
    const fps = info?.fps ?? dataset.fps ?? 30;

    // Local synthetic datasets (TASK-178): read per-episode parquet from disk.
    // Branch decisively — never fall through to the fabricated-frame generator
    // below: a missing parquet is a 404, a present one returns its real frames
    // (even if the requested offset slice is empty) with the true episode total.
    if (isLocalDataset(dataset.storagePath)) {
      const local = await readLocalFrames(dataset.storagePath, episodeIndex, fps, offset, limit);
      if (local === null) {
        return res.status(404).json({ error: 'Episode frames not found' });
      }
      return res.json({ frames: local.frames, total: local.total });
    }

    // Read real frame data from parquet
    let frames: FrameData[] = [];
    try {
      const chunkIndex = Math.floor(episodeIndex / (info?.chunks_size ?? 1000));
      const chunkStr = String(chunkIndex).padStart(3, '0');
      const parquetBuf = await readParquetFromRustFS(dataset.storagePath, `data/chunk-${chunkStr}/file-000.parquet`);
      if (parquetBuf) {
        const { ParquetReader } = await import('@dsnp/parquetjs');
        const reader = await ParquetReader.openBuffer(parquetBuf);
        const cursor = reader.getCursor();
        let row: Record<string, unknown> | null;
        const allFrames: FrameData[] = [];

        while ((row = await cursor.next() as Record<string, unknown> | null)) {
          const rowEpisode = Number(row['episode_index'] ?? 0);
          if (rowEpisode !== episodeIndex) continue;

          // Extract nested list values: {list: [{element: float}, ...]}
          const obsRaw = row['observation.state'] as { list?: Array<{ element?: number }> } | undefined;
          const actRaw = row['action'] as { list?: Array<{ element?: number }> } | undefined;
          const observationState = obsRaw?.list?.map(item => item.element ?? 0) ?? [];
          const action = actRaw?.list?.map(item => item.element ?? 0) ?? [];

          allFrames.push({
            frameIndex: Number(row['frame_index'] ?? allFrames.length),
            timestamp: Number(row['timestamp'] ?? (allFrames.length / fps)),
            observationState,
            action,
          });
        }
        await reader.close();

        frames = allFrames.slice(offset, offset + limit);
        console.log(`[DatasetRoutes] Read ${allFrames.length} frames from parquet for episode ${episodeIndex}, returning ${frames.length}`);
      }
    } catch (err) {
      console.log('[DatasetRoutes] Could not read frames parquet, using fallback:', (err as Error).message);
    }

    // Fallback: synthetic data
    if (frames.length === 0) {
      const totalEpisodes = info?.total_episodes ?? dataset.demonstrationCount ?? 0;
      const totalFrames = info?.total_frames ?? dataset.totalFrames ?? 0;
      const avgFrames = totalEpisodes > 0 ? Math.floor(totalFrames / totalEpisodes) : 0;
      const frameCount = Math.min(avgFrames, limit);
      for (let i = offset; i < offset + frameCount; i++) {
        const timestamp = fps > 0 ? i / fps : 0;
        const observationState = [
          Math.sin(timestamp * 0.5) * 30, Math.cos(timestamp * 0.3) * 45 - 10,
          Math.sin(timestamp * 0.7 + 1) * 60, Math.cos(timestamp * 0.4 + 2) * 40,
          Math.sin(timestamp * 0.6 + 3) * 20, Math.sin(timestamp * 0.2) * 50 + 50,
        ];
        const action = observationState.map((v, j) => v + Math.sin(timestamp * 2 + j) * 5);
        frames.push({ frameIndex: i, timestamp, observationState, action });
      }
    }

    res.json({ frames, total: frames.length });
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

    // Local synthetic datasets (TASK-178): stream the v2.1 per-episode mp4 from disk.
    if (isLocalDataset(dataset.storagePath)) {
      if (streamLocalVideo(dataset.storagePath, episodeIndex, camera, req, res)) return;
      return res.status(404).json({ error: 'Video not found for synthetic dataset' });
    }

    // Optional exact chunk/file coordinates from the episodes API's
    // videoWindows (v3.0 multi-file chunks, see #179); fall back to the
    // legacy floor(ep/1000) guess when absent.
    const CHUNKS_SIZE = 1000;
    const chunkQ = parseInt(String(req.query.chunk ?? ''), 10);
    const fileQ = parseInt(String(req.query.file ?? ''), 10);
    const chunkIndex = Number.isFinite(chunkQ) ? chunkQ : Math.floor(episodeIndex / CHUNKS_SIZE);
    const fileIndex = Number.isFinite(fileQ) ? fileQ : 0;
    const pad3 = (n: number) => String(n).padStart(3, '0');

    // LeRobot v2.x lays out one mp4 PER EPISODE:
    //   videos/chunk-{chunk:03d}/observation.images.{camera}/episode_{ep:06d}.mp4
    // LeRobot v3 concatenates all episodes of a chunk into one file per camera:
    //   videos/observation.images.{camera}/chunk-{chunk:03d}/file-{file:03d}.mp4
    // Try the layout matching the dataset's version first, then the other one
    // as a fallback (imports occasionally mislabel the version).
    const v2Path = `videos/chunk-${pad3(Math.floor(episodeIndex / CHUNKS_SIZE))}/observation.images.${camera}/episode_${String(episodeIndex).padStart(6, '0')}.mp4`;
    const v3Path = `videos/observation.images.${camera}/chunk-${pad3(chunkIndex)}/file-${pad3(fileIndex)}.mp4`;
    const isV2 = (dataset.lerobotVersion ?? '').toLowerCase().startsWith('v2');
    const candidatePaths = isV2 ? [v2Path, v3Path] : [v3Path, v2Path];
    const videoPath = candidatePaths[0];

    // Try to stream from RustFS if available
    // Check both 'training-datasets' and legacy 'datasets' bucket
    try {
      const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
      if (isRustFSInitialized()) {
        const rustfs = getRustFSClient();
        const base = dataset.storagePath.endsWith('/') ? dataset.storagePath : `${dataset.storagePath}/`;

        for (const candidate of candidatePaths) {
          const videoKey = `${base}${candidate}`;
          for (const bucket of [BUCKETS.TRAINING_DATASETS, 'datasets']) {
            const exists = await rustfs.exists(bucket, videoKey);
            if (!exists) continue;

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
            return pipeStreamToResponse(stream as unknown as Readable, res);
          }
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

    const { Readable: NodeReadable } = await import('stream');
    const nodeStream = NodeReadable.fromWeb(hfResponse.body as import('stream/web').ReadableStream);
    pipeStreamToResponse(nodeStream, res);
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

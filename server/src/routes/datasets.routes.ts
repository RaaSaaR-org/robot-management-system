/**
 * @file datasets.routes.ts
 * @description REST API endpoints for dataset management
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { datasetService, DatasetExpectationError } from '../services/DatasetService.js';
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
  ImportLogResponse,
} from '../types/dataset.types.js';
import type { DatasetStatus } from '../types/vla.types.js';
import {
  HuggingFaceImportError,
  huggingFaceImportService,
} from '../services/HuggingFaceImportService.js';
import { importActivityLog } from '../services/ImportActivityLog.js';
import { datasetEpisodeFlagRepository } from '../repositories/DatasetEpisodeFlagRepository.js';
import type { EpisodeFlag } from '../repositories/DatasetEpisodeFlagRepository.js';
import { robotTypeRepository } from '../repositories/index.js';
import { BUCKETS } from '../storage/model-storage.js';
import type {
  FlaggedTrajectoriesResponse,
  FlaggedTrajectorySummary,
  TriggerValidationRequest,
  UnflagTrajectoryRequest,
} from '../types/data-quality.types.js';
import { spawn } from 'child_process';
import { resolve, dirname, join, sep, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import type { Readable } from 'stream';
import { DatasetViewError, resolveLocalView } from '../services/lerobot/LocalDatasetView.js';
import {
  DatasetReadError,
  episodeFramesCache,
  episodeWeight,
  pageOf,
  parseEpisodeRecords,
  readRemoteEpisodeFrames,
  readRemoteEpisodes,
  toEpisodeMeta,
  toNumberArray,
  type DatasetObjectStore,
} from '../services/lerobot/RemoteDatasetReader.js';
// TASK-220 — POST /compatibility, at the bottom of this file.
import { analyzeDatasetIds, UnknownDatasetError } from '../services/lerobot/datasetCompatibility.js';
import { ConflictError, ServiceUnavailableError } from '../utils/errors.js';
import { ownerOnly } from '../middleware/auth.middleware.js';
import { sendFailure } from '../utils/routeErrors.js';

/** In-memory job state for push-to-hub operations */
const pushJobs = new Map<string, PushToHubJobState>();

// ============================================================================
// Local on-disk datasets (synthetic / Cosmos 3 — TASK-178; v3.0 — TASK-217)
//
// Local datasets are a LeRobot directory on this disk (absolute storagePath)
// rather than an object-key prefix in RustFS. These helpers let the standard
// episodes / frames / video routes serve them, so the existing viewer works
// unchanged. All branches are guarded by `isLocalDataset`, so RustFS/HF
// datasets are entirely unaffected.
//
// The readers below are v2.1: one parquet and one mp4 per episode. A v3.0
// dataset — which is everything this platform now writes — is served through a
// converted v2.1 VIEW instead of a second set of readers; `resolveLocalView`
// builds it once and caches it. See `services/lerobot/LocalDatasetView.ts` for
// why that way round.
// ============================================================================

function isLocalDataset(storagePath: string): boolean {
  // POSIX ('/…') or Windows ('C:\…' / 'C:/…') absolute path; RustFS datasets
  // use relative object-key prefixes (`<id>/`) and never match.
  return (isAbsolute(storagePath) || storagePath.startsWith('/')) && existsSync(storagePath);
}

function padEpisode(index: number): string {
  return String(index).padStart(6, '0');
}

/**
 * The directory to read a local dataset from, converting a v3.0 tree if needed.
 *
 * Returns null and answers the request itself when the conversion fails, so the
 * caller neither falls through to the RustFS path (which cannot serve a local
 * dataset either) nor swallows the reason. A missing ffmpeg is the likely one
 * and it is worth saying out loud rather than showing an empty viewer.
 */
async function localReadRoot(storagePath: string, res: Response): Promise<string | null> {
  try {
    const view = await resolveLocalView(storagePath);
    return view.root;
  } catch (error) {
    // A DatasetViewError is this repo's own sentence ("ffmpeg is not
    // installed"), so its detail still reaches the viewer. Anything else is a
    // library or driver failure and is logged instead of echoed.
    console.error(`[datasets] local view failed for ${storagePath}:`, error);
    if (error instanceof DatasetViewError) {
      res
        .status(503)
        .json({ error: 'Dataset view unavailable', code: error.code, detail: error.message });
      return null;
    }
    sendFailure(res, error, 'Dataset view unavailable', 503, { code: 'VIEW_FAILED' });
    return null;
  }
}

/** Camera keys are simple identifiers; anything else could traverse the path. */
const CAMERA_KEY_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * The camera feature key a video route segment names, or null when it is not a
 * safe single path segment. The episode browser sends the full feature key
 * (`observation.images.top`, pusht's singular `observation.image`); a bare
 * camera name (`top`, older callers) means `observation.images.<name>`.
 */
export function cameraFeatureKey(camera: string): string | null {
  if (!CAMERA_KEY_RE.test(camera) || camera === '.' || camera === '..') return null;
  return camera.startsWith('observation.') ? camera : `observation.images.${camera}`;
}

/**
 * Parse a single-range `Range` header against an object of `size` bytes.
 * Returns the inclusive window, or 'unsatisfiable' for a malformed or
 * out-of-bounds range (answered with 416).
 */
export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'unsatisfiable';
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
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/**
 * Answer a video request for an object of `size` bytes: 206 with the window
 * `open` reads when the request carries a `Range`, 416 for one that cannot be
 * served, 200 with the whole object otherwise. `open` is called once.
 */
async function sendVideo(
  req: Request,
  res: Response,
  size: number,
  open: (range?: { start: number; end: number }) => Readable | Promise<Readable>,
): Promise<void> {
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  const header = req.headers.range;
  if (!header) {
    res.setHeader('Content-Length', size);
    pipeStreamToResponse(await open(), res);
    return;
  }
  const range = parseByteRange(header, size);
  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }
  const stream = await open(range);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader('Content-Length', range.end - range.start + 1);
  pipeStreamToResponse(stream, res);
}

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

async function readLocalEpisodes(storagePath: string, fps: number): Promise<EpisodeMeta[] | null> {
  // Cosmos-converter output ships meta/episodes.json (one JSON array);
  // standard LeRobot v2.1 datasets ship meta/episodes.jsonl (JSON Lines).
  for (const name of ['episodes.json', 'episodes.jsonl']) {
    try {
      const raw = await readFile(join(storagePath, 'meta', name), 'utf8');
      return toEpisodeMeta(parseEpisodeRecords(raw), fps);
    } catch {
      /* try the next file */
    }
  }
  return null;
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
async function streamLocalVideo(
  storagePath: string,
  episodeIndex: number,
  camera: string,
  req: Request,
  res: Response,
): Promise<boolean> {
  // Guard against path traversal via the camera segment: Express decodes %2f
  // inside a single param after route matching, so `x%2f..%2f..` would escape
  // the dataset dir once join() normalizes the `..` sequences.
  const featureKey = cameraFeatureKey(camera);
  if (!featureKey) {
    res.status(400).json({ error: 'Invalid camera key' });
    return true;
  }
  const baseDir = resolve(storagePath);
  const episodeFile = `episode_${padEpisode(episodeIndex)}.mp4`;
  // Cosmos-converter layout: videos/<camera>/chunk-000/episode.mp4;
  // standard LeRobot v2.1 layout: videos/chunk-000/<camera>/episode.mp4.
  const candidates = [
    resolve(baseDir, 'videos', featureKey, 'chunk-000', episodeFile),
    resolve(baseDir, 'videos', 'chunk-000', featureKey, episodeFile),
  ];
  // Defense in depth: the resolved file must stay within the dataset dir.
  if (candidates.some((f) => f !== baseDir && !f.startsWith(baseDir + sep))) {
    res.status(400).json({ error: 'Invalid path' });
    return true;
  }
  const file = candidates.find((f) => existsSync(f));
  if (!file) return false;

  const { size } = statSync(file);
  await sendVideo(req, res, size, (range) => createReadStream(file, range ?? {}));
  return true;
}

/**
 * Object access to one RustFS dataset, for the episodes and frames readers.
 *
 * Returns null when RustFS is not running. The bucket is the first of
 * 'training-datasets' and the legacy 'datasets' that holds anything under the
 * dataset's prefix; a dataset in neither is a 422, not an empty listing.
 * Storage errors propagate — the reader turns them into a 502 naming the file.
 */
async function rustfsDatasetStore(storagePath: string): Promise<DatasetObjectStore | null> {
  const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
  if (!isRustFSInitialized()) return null;
  const rustfs = getRustFSClient();
  const base = storagePath.endsWith('/') ? storagePath : `${storagePath}/`;

  let bucket: string | null = null;
  let firstError: unknown = null;
  let listedAny = false;
  for (const candidate of [BUCKETS.TRAINING_DATASETS, 'datasets']) {
    try {
      const probe = await rustfs.list(candidate, { prefix: base, maxKeys: 1 });
      listedAny = true;
      if (probe.objects.length > 0) {
        bucket = candidate;
        break;
      }
    } catch (error) {
      // The legacy bucket may not exist at all; only an error on every
      // bucket says storage itself is failing.
      firstError ??= error;
    }
  }
  if (!bucket) {
    if (!listedAny) {
      throw new DatasetReadError(502, `Could not list ${base} in object storage: ${(firstError as Error).message}`);
    }
    throw new DatasetReadError(422, `No files for this dataset in object storage (prefix ${base})`, base);
  }
  const from = bucket;
  return {
    async read(path) {
      const key = `${base}${path}`;
      if (!(await rustfs.exists(from, key))) return null;
      return rustfs.download(from, key);
    },
    async list(prefix) {
      const paths: string[] = [];
      for await (const obj of rustfs.listAll(from, `${base}${prefix}`)) {
        paths.push(obj.key.slice(base.length));
      }
      return paths;
    },
    // Ranged access, so a 60 MB data file is never pulled into the heap whole (TASK-355).
    async stat(path) {
      const key = `${base}${path}`;
      if (!(await rustfs.exists(from, key))) return null;
      const meta = await rustfs.getMetadata(from, key);
      return { size: Number(meta.contentLength ?? 0) };
    },
    readRange(path, offset, length) {
      return rustfs.downloadRange(from, `${base}${path}`, offset, length);
    },
  };
}

/**
 * Answer a failed episodes/frames read. A {@link DatasetReadError} carries
 * its own status and a sentence naming the file; anything else is a 500.
 */
function sendDatasetReadError(res: Response, datasetId: string, error: unknown, fallback: string): void {
  if (error instanceof DatasetReadError) {
    console.error(`[DatasetRoutes] dataset ${datasetId}: ${error.message}${error.detail ? ` (${error.detail})` : ''}`);
    res.status(error.status).json({
      error: error.message,
      // The app's API client shows `message` and drops `detail`, so the
      // reason travels in the sentence it does show.
      message: error.detail ? `${error.message} (${error.detail})` : error.message,
      ...(error.file ? { file: error.file } : {}),
      ...(error.detail ? { detail: error.detail } : {}),
    });
    return;
  }
  console.error(`[DatasetRoutes] dataset ${datasetId}: ${fallback}:`, error);
  sendFailure(res, error, fallback);
}

/**
 * Answer a failed HuggingFace call with the status the service already decided.
 *
 * Every import failure used to come back 400 after a chain of
 * `message.includes` tests on English prose, so "no such repo" and "an import
 * is already running" were indistinguishable to a client.
 * {@link HuggingFaceImportError} carries the status and a stable code; anything
 * else is still a 400 with its message.
 */
function sendImportError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof HuggingFaceImportError) {
    res.status(error.status).json({ error: error.message, message: error.message, code: error.code });
    return;
  }
  if (error instanceof Error && error.message.includes('Foreign key constraint')) {
    const message = 'Invalid robot type reference. Please try again.';
    res.status(400).json({ error: message, message, code: 'IMPORT_ERROR' });
    return;
  }
  sendFailure(res, error, fallback, 400, { message: fallback, code: 'IMPORT_ERROR' });
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
    sendFailure(res, error, 'Failed to create dataset', 400);
  }
});

// ============================================================================
// GET /api/datasets/robot-types - Robot types a dataset can be created against
// ============================================================================
//
// Declared BEFORE `/:id`, or Express would match `robot-types` as a dataset id.
//
// This exists because the upload modal's Robot Type select had no source: the
// prop defaults to `[]`, `DatasetsPage` never passed it, and `robotTypeId` is
// required — so the modal could not be completed from the page it opens on,
// whatever the server did. There was no robot-type listing endpoint anywhere.
datasetRoutes.get('/robot-types', async (_req: Request, res: Response) => {
  try {
    const robotTypes = await robotTypeRepository.findAll();
    res.json({ robotTypes });
  } catch (error) {
    console.error('[DatasetRoutes] Error listing robot types:', error);
    res.status(500).json({ error: 'Failed to list robot types' });
  }
});

// ============================================================================
// POST /api/datasets/robot-types - Define a NEW robot configuration (TASK-353)
// ============================================================================
//
// The supported way to get a 43-wide G1 configuration when only the 28-wide
// one exists. Create-only by design: there is no route that rewrites a robot
// type's widths, because other datasets are validated against them.

/** Who made the request, for the audit trail. Null under the dev auth bypass. */
function actorOf(req: Request): string | null {
  return (req as Request & { user?: { id?: string } }).user?.id ?? null;
}

function sendExpectationError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof DatasetExpectationError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  sendFailure(res, error, fallback);
}

// Owner-only (admin): a robot type is shared, platform-wide configuration that
// every dataset on it is validated against. Reassociating a dataset stays open
// to members (operators).
datasetRoutes.post('/robot-types', ownerOnly, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const robotType = await datasetService.createRobotConfiguration({
      name: typeof body.name === 'string' ? body.name : '',
      manufacturer: typeof body.manufacturer === 'string' ? body.manufacturer : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      actionDim: body.actionDim as number,
      proprioceptionDim: body.proprioceptionDim as number,
    }, actorOf(req));
    res.status(201).json({ robotType });
  } catch (error) {
    sendExpectationError(res, error, 'Failed to create robot type');
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
    sendImportError(res, error, 'Failed to import dataset');
  }
});

// ============================================================================
// GET /api/datasets/hf/preview - What a Hub repo is, WITHOUT importing it
// ============================================================================
//
// Declared before `/:id`, or Express matches `hf` as a dataset id.
//
// The import modal used to ask someone to commit to a gigabyte on the strength
// of a repo name: nothing told them the GR00T repo is 929 MB of video, 402
// episodes and 43 wide until the import had already run. Three cheap requests
// answer all of it.
datasetRoutes.get('/hf/preview', async (req: Request, res: Response) => {
  const repoId = typeof req.query.repoId === 'string' ? req.query.repoId.trim() : '';
  const revision = typeof req.query.revision === 'string' && req.query.revision.trim()
    ? req.query.revision.trim()
    : 'main';

  if (!repoId) {
    return res.status(400).json({ error: 'repoId is required' });
  }

  try {
    const preview = await huggingFaceImportService.previewRepo(repoId, revision);
    res.json(preview);
  } catch (error) {
    console.error(`[DatasetRoutes] Preview failed for ${repoId}@${revision}:`, error);
    sendImportError(res, error, 'Failed to preview repository');
  }
});

// ============================================================================
// POST /api/datasets/:id/import/retry - Re-run the import for an HF dataset
// ============================================================================

datasetRoutes.post('/:id/import/retry', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { includeVideos?: unknown };
    const result = await huggingFaceImportService.retryImport(req.params.id, {
      // Optional and off the contract: a retry with no body re-runs the import
      // the row already describes, which is what the contract pins.
      includeVideos: typeof body.includeVideos === 'boolean' ? body.includeVideos : undefined,
    });
    res.status(202).json(result);
  } catch (error) {
    console.error(`[DatasetRoutes] Retry failed for ${req.params.id}:`, error);
    sendImportError(res, error, 'Failed to retry import');
  }
});

// ============================================================================
// GET /api/datasets/:id/import/log - What a running (or ended) import did
// ============================================================================
//
// The browser follows an import over the WebSocket, but a page that attaches
// late — a reload, a second tab, the top-bar panel opened after the fact —
// has missed every frame. This is the backfill: status and failure reason
// from the row (they survive a restart), lines and the last progress frame
// from memory (they do not; `retained` says which). (TASK-352)

datasetRoutes.get('/:id/import/log', async (req: Request, res: Response) => {
  try {
    const dataset = await datasetService.get(req.params.id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }
    const activity = importActivityLog.get(dataset.id);
    const body: ImportLogResponse = {
      datasetId: dataset.id,
      status: dataset.status,
      importError: dataset.importError ?? null,
      progress: activity?.progress ?? null,
      lines: activity?.lines ?? [],
      dropped: activity?.dropped ?? 0,
      retained: activity !== null,
      sourceRevision: dataset.sourceRevision ?? null,
      lerobotVersion: dataset.lerobotVersion ?? null,
    };
    res.json(body);
  } catch (error) {
    console.error(`[DatasetRoutes] Error reading import log for ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to read import log' });
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
    sendFailure(res, error, 'Failed to record intervention', 400);
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
    // "not found" is this repo's own sentence, so that one is echoed;
    // every other failure answers with the fallback, unread.
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to queue annotate job', 400);
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
    sendFailure(res, error, 'Failed to start push', 500);
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
    sendFailure(res, error, 'Failed to update dataset', 400);
  }
});

// ============================================================================
// PUT /api/datasets/:id/robot-type - Change which robot a dataset is checked
// against, and revalidate its stored files (TASK-353)
// ============================================================================
//
// 409 while an import, upload or validation is writing the row. The old
// verdict is voided, the change is audit-logged, and a revalidation of the
// files already in storage starts — nothing is downloaded, moved or deleted.

datasetRoutes.put('/:id/robot-type', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as { robotTypeId?: unknown; reason?: unknown };
    if (typeof body.robotTypeId !== 'string' || !body.robotTypeId) {
      return res.status(400).json({ error: 'robotTypeId is required', code: 'INVALID_ROBOT_TYPE' });
    }
    const result = await datasetService.reassociateRobotType(id, body.robotTypeId, {
      actorId: actorOf(req),
      reason: typeof body.reason === 'string' ? body.reason : null,
    });
    res.json({
      ...result,
      progressUrl: `/api/datasets/${id}/progress`,
    });
  } catch (error) {
    sendExpectationError(res, error, 'Failed to change the dataset robot type');
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
    // A dataset a training mixture still names is a refusal the caller can act
    // on — it names the jobs holding it — not a server fault to log and hide
    // behind "Failed to delete dataset".
    if (error instanceof ConflictError) {
      return res.status(409).json({ error: error.message });
    }
    // Object storage could not remove its files, so the row was kept: retry later.
    if (error instanceof ServiceUnavailableError) {
      return res.status(503).json({ error: error.message });
    }
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
    sendFailure(res, error, 'Failed to initiate upload', 400);
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
    sendFailure(res, error, 'Failed to complete upload', 400);
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
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    sendFailure(res, error, 'Failed to get dataset stats', 500);
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
    // DatasetService's own sentences stay readable; anything else is logged
    // above and answered with the fallback.
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (
      error instanceof Error &&
      (error.message.includes('not ready') || error.message.includes('not available'))
    ) {
      return res.status(400).json({ error: error.message });
    }

    sendFailure(res, error, 'Failed to compute stats', 500);
  }
});

// ============================================================================
// GET /api/datasets/:id/progress - Get validation progress
// ============================================================================

datasetRoutes.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // A Hub import in flight answers with its own frame: phase, files and
    // bytes. This route used to know only validation progress, so for the
    // whole of a download it fell through to the row and said `progress: 0`
    // (#370). Read first and from memory: the frame is this process's.
    const importFrame = importActivityLog.get(id)?.progress ?? null;
    if (importFrame?.status === 'importing') {
      return res.json(importFrame);
    }

    const progress = await datasetService.getUploadProgress(id);

    if (!progress) {
      // Check if dataset exists
      const dataset = await datasetService.get(id);
      if (!dataset) {
        return res.status(404).json({ error: 'Dataset not found' });
      }

      // An import that has stopped downloading (validating, or ended) still
      // reports where it got to, with the row's status as the verdict.
      if (importFrame && dataset.huggingFaceRepoId) {
        return res.json({
          ...importFrame,
          status: dataset.status,
          ...(dataset.importError ? { error: dataset.importError.error } : {}),
        });
      }

      // No active progress, return current status. Something in flight that
      // this process cannot measure (a restart lost its frame) is `null`, not
      // a 0 % that reads like "nothing has happened".
      const unmeasured = dataset.status === 'importing' || dataset.status === 'validating';
      return res.json({
        datasetId: id,
        status: dataset.status,
        progress: dataset.status === 'ready' ? 100 : unmeasured ? null : 0,
        ...(dataset.importError ? { error: dataset.importError.error } : {}),
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

    // `flagged` was hardcoded false in front of a flag control that wrote
    // nowhere. Read once, up here: the review found the fix had only been
    // applied to the local branch, so a flagged episode on a RustFS or
    // HuggingFace dataset still came back `flagged: false`.
    const flags = await datasetEpisodeFlagRepository.flaggedIndices(dataset.id);

    // Local datasets (TASK-178, v3.0 via a converted view since TASK-217).
    if (isLocalDataset(dataset.storagePath)) {
      const root = await localReadRoot(dataset.storagePath, res);
      if (root === null) return;
      const local = await readLocalEpisodes(root, fps);
      if (local === null) {
        return res
          .status(422)
          .json({ error: 'No episode metadata on disk: meta/episodes.jsonl is missing', file: 'meta/episodes.jsonl' });
      }
      return res.json({
        episodes: local.map((e) => ({ ...e, flagged: flags.has(e.index) })),
      });
    }

    // RustFS: read whatever layout the dataset has — never fabricate
    // episodes when that fails (TASK-354).
    const store = await rustfsDatasetStore(dataset.storagePath);
    if (!store) {
      return res.status(503).json({ error: 'Object storage is unavailable, so episodes cannot be read' });
    }
    const episodes = await readRemoteEpisodes(store, info, fps, dataset.lerobotVersion);
    res.json({ episodes: episodes.map((e) => ({ ...e, flagged: flags.has(e.index) })) });
  } catch (error) {
    sendDatasetReadError(res, req.params.id, error, 'Failed to get episodes');
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
    // Branch decisively — never fall through to the RustFS reader below,
    // which cannot serve a local dataset: a missing parquet is a 404, a present one returns its real frames
    // (even if the requested offset slice is empty) with the true episode total.
    if (isLocalDataset(dataset.storagePath)) {
      const root = await localReadRoot(dataset.storagePath, res);
      if (root === null) return;
      const local = await readLocalFrames(root, episodeIndex, fps, offset, limit);
      if (local === null) {
        return res.status(404).json({ error: 'Episode frames not found' });
      }
      return res.json({ frames: local.frames, total: local.total });
    }

    // RustFS: the parquet holding this episode, or an error naming the file
    // that could not be read — never generated frames (TASK-354).
    // The decoded episode is cached, keyed by the record's updatedAt, so
    // paging through it reads storage once (TASK-355).
    const cacheKey = `${dataset.id}@${new Date(dataset.updatedAt).getTime()}#${episodeIndex}`;
    const episode = await episodeFramesCache.getOrLoad(cacheKey, episodeWeight, async () => {
      const store = await rustfsDatasetStore(dataset.storagePath);
      if (!store) throw new DatasetReadError(503, 'Object storage is unavailable, so frames cannot be read');
      return readRemoteEpisodeFrames(store, info, episodeIndex, fps, dataset.lerobotVersion);
    });
    const page = pageOf(episode, { offset, limit });
    // scripts/e2e-k3d/test.sh greps this line; keep its wording.
    console.log(
      `[DatasetRoutes] Read ${page.total} frames from parquet for episode ${episodeIndex}, returning ${page.frames.length} (${page.source})`,
    );
    res.json({ frames: page.frames, total: page.total });
  } catch (error) {
    sendDatasetReadError(res, req.params.id, error, 'Failed to get episode frames');
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
      const root = await localReadRoot(dataset.storagePath, res);
      if (root === null) return;
      if (await streamLocalVideo(root, episodeIndex, camera, req, res)) return;
      return res.status(404).json({ error: 'Video not found for this dataset' });
    }

    const featureKey = cameraFeatureKey(camera);
    if (!featureKey) {
      return res.status(400).json({ error: 'Invalid camera key' });
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
    //   videos/chunk-{chunk:03d}/{camera key}/episode_{ep:06d}.mp4
    // LeRobot v3 concatenates all episodes of a chunk into one file per camera:
    //   videos/{camera key}/chunk-{chunk:03d}/file-{file:03d}.mp4
    // Try the layout matching the dataset's version first, then the other one
    // as a fallback (imports occasionally mislabel the version).
    const v2Path = `videos/chunk-${pad3(Math.floor(episodeIndex / CHUNKS_SIZE))}/${featureKey}/episode_${String(episodeIndex).padStart(6, '0')}.mp4`;
    const v3Path = `videos/${featureKey}/chunk-${pad3(chunkIndex)}/file-${pad3(fileIndex)}.mp4`;
    const isV2 = (dataset.lerobotVersion ?? '').toLowerCase().startsWith('v2');
    const candidatePaths = isV2 ? [v2Path, v3Path] : [v3Path, v2Path];
    const videoPath = candidatePaths[0];

    // Stream from RustFS through this server ('training-datasets', then the
    // legacy 'datasets' bucket). Never redirect to a presigned URL: it names the
    // in-cluster endpoint (http://neodem-rustfs:9000), which a browser cannot
    // resolve and an https page may not load. Each Range request reads only its
    // window, so a v3.0 chunk video is never pulled whole for one episode.
    const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
    if (isRustFSInitialized()) {
      const rustfs = getRustFSClient();
      const base = dataset.storagePath.endsWith('/') ? dataset.storagePath : `${dataset.storagePath}/`;
      let found: { bucket: string; key: string; size: number } | null = null;
      try {
        for (const candidate of candidatePaths) {
          for (const bucket of [BUCKETS.TRAINING_DATASETS, 'datasets']) {
            const key = `${base}${candidate}`;
            if (!(await rustfs.exists(bucket, key))) continue;
            const metadata = await rustfs.getMetadata(bucket, key);
            found = { bucket, key, size: metadata.contentLength ?? 0 };
            break;
          }
          if (found) break;
        }
      } catch (err) {
        // RustFS unreachable — fall through to the HF proxy.
        console.warn('[DatasetRoutes] RustFS video lookup failed:', err instanceof Error ? err.message : err);
      }
      if (found) {
        const { bucket, key, size } = found;
        await sendVideo(req, res, size, (range) => rustfs.getStream(bucket, key, range));
        return;
      }
    }

    // Fallback: proxy from HuggingFace if we have a repo ID, at the revision
    // the dataset was imported from (a v2.1 tag is not what `main` holds).
    const repoId = dataset.huggingFaceRepoId;
    if (!repoId) {
      return res.status(404).json({ error: 'Video not found and no HuggingFace repo to proxy from' });
    }

    const revision = encodeURIComponent(dataset.sourceRevision || 'main');
    const hfUrl = `https://huggingface.co/datasets/${repoId}/resolve/${revision}/${videoPath}`;
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
    if (res.headersSent) res.destroy(error instanceof Error ? error : undefined);
    else res.status(500).json({ error: 'Failed to stream video' });
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

    const { flagged, reason } = req.body as { flagged: boolean; reason?: string };
    if (typeof flagged !== 'boolean') {
      return res.status(400).json({ error: 'flagged must be a boolean' });
    }

    // An index past the end of the dataset is a typo, not a flag. Storing it
    // made `/quality` count more flagged episodes than the dataset has and
    // report a negative clean percentage.
    const episodeCount = dataset.demonstrationCount ?? 0;
    if (episodeCount > 0 && episodeIndex >= episodeCount) {
      return res.status(400).json({
        error: `Episode ${episodeIndex} is out of range — this dataset has ${episodeCount}`,
        code: 'EPISODE_OUT_OF_RANGE',
      });
    }

    // Stored, as of TASK-217. This used to answer `{success:true}` and write
    // nothing, while `GET /:id/flagged` always answered `[]` and the viewer
    // showed a flag control in front of both.
    const record = await datasetEpisodeFlagRepository.set(id, episodeIndex, flagged, reason);
    res.json({ success: true, flag: record });
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

    const [flaggedCount, flaggedList] = await Promise.all([
      datasetEpisodeFlagRepository.countFlagged(id),
      datasetEpisodeFlagRepository.listFlagged(id, 1, 50),
    ]);
    const flaggedRows = flaggedList.rows;

    // The breakdown is the STORED one now — see `DatasetService.toResponse`.
    // It used to be reconstructed on every read from the row's own numbers,
    // so it agreed with itself whatever the files said.
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
            // Real counts. These were `0`, `0` and `100` with a comment saying
            // they would be computed in a full implementation — three numbers
            // that said "nothing is wrong with this dataset" about a dataset
            // nobody had looked at.
            flaggedTrajectoryCount: flaggedCount,
            // Still zero, and now honestly so: anomaly detection is the
            // `validate-advanced` pipeline, which returns 501 because it does
            // not exist. `DataQualityService` has the metrics; nothing runs
            // them over a dataset.
            anomalousTrajectoryCount: 0,
            // Clamped: a flag left behind by an episode count that later
            // shrank must not read as "-25% clean".
            cleanTrajectoryPercentage: dataset.demonstrationCount > 0
              ? Math.max(0, Math.round(((dataset.demonstrationCount - flaggedCount) / dataset.demonstrationCount) * 100))
              : 100,
            statistics: null,
            flaggedSummary: flaggedRows.map(toFlaggedSummary),
            validationStatus: 'completed',
          }
        : null,
      // What structural validation found, when something has validated this.
      // Absent means nothing has ever opened this dataset's files.
      validation: dataset.validation ?? null,
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

    // 501 for the same reason as `validate-advanced`: nothing computes these
    // and nothing stores them, so a 200 with a `message` field looked to a
    // client like a metrics response that happened to be empty.
    res.status(501).json({
      error: 'Per-trajectory metrics are not implemented',
      code: 'NOT_IMPLEMENTED',
      datasetId: id,
      trajectoryIndex,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting trajectory metrics:', error);
    res.status(500).json({ error: 'Failed to get trajectory metrics' });
  }
});

// ============================================================================
// POST /api/datasets/:id/validate - Re-run structural validation
// ============================================================================
//
// There was no way to validate a dataset that had not just been uploaded.
// Validation ran once, inside `completeUpload`, so every dataset registered any
// other way — from a local directory, from HuggingFace, as a curated revision —
// could never be checked at all. That is most of the datasets in this database.
//
// 202, not 200 (TASK-219). This used to await the whole pass — every parquet
// footer and every file the manifest names — inside the request. On a real
// dataset that is seconds to minutes during which this process answers nothing
// else, health checks included; the review measured 6 s of blocked event loop
// for a single 100 MB parquet. The work is now handed to the same
// `jobs.dataset.validate` queue the upload flow uses, or (no NATS, which is
// every dev box) run detached in this process, and the caller reads the answer
// from the row or from `GET /:id/progress` — the channel the upload modal
// already polls.
//
// 409 while one is in flight: two clicks used to start two full passes over the
// same files, both writing the same row.
datasetRoutes.post('/:id/validate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // An import is still writing the files; validating them now would judge a
    // half-downloaded tree (TASK-353).
    if (dataset.status === 'importing' || dataset.status === 'uploading') {
      return res.status(409).json({
        error: `Dataset is ${dataset.status}; revalidate once it has finished`,
        code: 'DATASET_BUSY',
        datasetId: id,
      });
    }

    // Revalidation reads the stored objects only — no download, no move. The
    // service audit-logs the pass it accepts on behalf of this actor.
    const state = await datasetService.requestValidation(id, dataset.storagePath, { actorId: actorOf(req) });
    if (state === 'in-flight') {
      return res.status(409).json({
        error: 'A validation for this dataset is already running',
        code: 'VALIDATION_IN_FLIGHT',
        datasetId: id,
        progressUrl: `/api/datasets/${id}/progress`,
      });
    }
    if (state === 'store-unavailable') {
      // 503, not 202. Nothing was opened, the row is deliberately left alone,
      // and the caller's next move is to retry — not to go looking at a dataset
      // that is probably fine.
      return res.status(503).json({
        error: 'Dataset storage is not reachable — nothing was validated',
        code: 'STORE_UNAVAILABLE',
        datasetId: id,
      });
    }

    res.status(202).json({
      datasetId: id,
      accepted: true,
      // `queued` = a NATS worker has it; `started` = this process is running it
      // off the request. Named rather than hidden, because the two differ in
      // where a failure would show up.
      state,
      progressUrl: `/api/datasets/${id}/progress`,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error validating dataset:', error);
    res.status(500).json({ error: 'Failed to validate dataset' });
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

    // 501, not `{status:'queued'}`. There is no worker, no job subject and no
    // table for the results, so a queued response was a promise the platform
    // could not keep — a caller polling for the outcome waits forever, and the
    // UI reported "validation in progress" for a job that did not exist.
    // `DataQualityService` has the metrics; what is missing is the pipeline
    // that loads trajectories and stores what it computes.
    //
    // Structural validation is a different thing and DOES run: see
    // `POST /:id/validate`, which opens every file `info.json` names.
    void body;
    res.status(501).json({
      error: 'Advanced trajectory validation is not implemented',
      code: 'NOT_IMPLEMENTED',
      datasetId: id,
      hint: 'Structural validation runs at POST /api/datasets/:id/validate. '
        + 'Per-trajectory smoothness, DTW and OOD detection have metric implementations '
        + 'in DataQualityService but no job that runs them over a dataset.',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error triggering advanced validation:', error);
    res.status(500).json({ error: 'Failed to trigger advanced validation' });
  }
});

/**
 * One operator flag, in the shape the repo's own types declare for it.
 *
 * Both endpoints built untyped object literals, so tsc never compared them to
 * `FlaggedTrajectorySummary` — and they disagreed with each other as well as
 * with the type: `episodeIndex` in one response, `trajectoryIndex` in its
 * sibling, `reason` where the type says `flagReason`. A client written against
 * the declared types read `undefined` from both.
 *
 * `anomalyTypes` and `qualityScore` are empty and 0 because nothing computes
 * them: `validate-advanced` is the pipeline that would, and it answers 501.
 */
function toFlaggedSummary(row: EpisodeFlag): FlaggedTrajectorySummary {
  return {
    trajectoryIndex: row.episodeIndex,
    flagReason: row.reason ?? 'flagged by an operator',
    anomalyTypes: [],
    qualityScore: 0,
    reviewed: row.reviewedAt !== null,
    ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
    ...(row.reviewedBy ? { reviewedBy: row.reviewedBy } : {}),
    ...(row.reviewDecision
      ? { reviewDecision: row.reviewDecision as 'keep' | 'remove' | 'pending' }
      : {}),
  };
}

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

    const { rows, total } = await datasetEpisodeFlagRepository.listFlagged(id, page, limit);
    const payload: FlaggedTrajectoriesResponse & { page: number; limit: number } = {
      datasetId: id,
      total,
      page,
      limit,
      flagged: rows.map(toFlaggedSummary),
    };
    res.json(payload);
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

    // A review is only a review if it lands on something. This used to return
    // a `reviewedAt` timestamp for a review it did not record, so the same
    // episode came back flagged on the next read with no trace of the decision.
    const record = await datasetEpisodeFlagRepository.review(
      id, trajectoryIndex, body.reviewDecision, body.reviewedBy,
    );
    if (!record) {
      return res.status(404).json({
        error: `Episode ${trajectoryIndex} of this dataset is not flagged`,
      });
    }
    res.json({
      success: true,
      datasetId: id,
      trajectoryIndex,
      reviewDecision: record.reviewDecision,
      reviewedAt: record.reviewedAt?.toISOString(),
      message: `Trajectory ${trajectoryIndex} marked as ${body.reviewDecision}`,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error unflagging trajectory:', error);
    res.status(500).json({ error: 'Failed to unflag trajectory' });
  }
});

// ============================================================================
// POST /api/datasets/compatibility - Can these datasets be trained together?
// ============================================================================
// Body `{ datasetIds: string[] }` (1..8) -> CompatibilityReport. Asked by the
// training wizard before a job exists, and by `POST /api/training/jobs` on the
// way in, so the preview and the guard can never disagree about a mixture.
// ============================================================================

datasetRoutes.post('/compatibility', async (req: Request, res: Response) => {
  try {
    const { datasetIds } = req.body as { datasetIds?: unknown };
    if (!Array.isArray(datasetIds) || datasetIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ error: 'datasetIds must be an array of dataset ids' });
    }
    if (datasetIds.length === 0) {
      return res.status(400).json({ error: 'datasetIds must name at least one dataset' });
    }

    const report = await analyzeDatasetIds(datasetIds as string[]);
    res.json(report);
  } catch (error) {
    if (error instanceof UnknownDatasetError) {
      return res.status(404).json({ error: error.message, datasetIds: error.datasetIds });
    }
    console.error('[DatasetRoutes] Error analyzing compatibility:', error);
    sendFailure(res, error, 'Failed to analyze compatibility', 400);
  }
});

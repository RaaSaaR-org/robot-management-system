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
  ImportLogResponse,
} from '../types/dataset.types.js';
import type { DatasetStatus } from '../types/vla.types.js';
import {
  HuggingFaceImportError,
  huggingFaceImportService,
} from '../services/HuggingFaceImportService.js';
import { importActivityLog, settledImportProgress } from '../services/ImportActivityLog.js';
import { datasetUploadService } from '../services/datasetUpload/DatasetUploadService.js';
import { DatasetUploadError } from '../services/datasetUpload/uploadManifest.js';
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
import { resolve, join, sep, isAbsolute } from 'path';
import { createReadStream, existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import type { Readable } from 'stream';
import { DatasetViewError, resolveLocalView } from '../services/lerobot/LocalDatasetView.js';
import { DatasetStoreError } from '../services/lerobot/DatasetTree.js';
import {
  DatasetReadError,
  episodeFramesCache,
  episodeWeight,
  pageOf,
  parseEpisodeRecords,
  readRemoteEpisodeFrames,
  readEpisodeTable,
  episodesOf,
  layoutOf,
  type EpisodeTable,
  toEpisodeMeta,
  toNumberArray,
  type DatasetObjectStore,
} from '../services/lerobot/RemoteDatasetReader.js';
import {
  episodeChunkOf,
  episodeDataCandidates,
  episodeVideoCandidates,
  type EpisodePathInfo,
} from '../services/lerobot/episodePaths.js';
import {
  cachedEpisodeTable,
  cachedLocation,
  coldReadGate,
  datasetVersionKey,
  footerCachingStore,
} from '../services/lerobot/DatasetReadCache.js';
// TASK-220 — POST /compatibility, at the bottom of this file.
import { analyzeDatasetIds, UnknownDatasetError } from '../services/lerobot/datasetCompatibility.js';
import { ConflictError, ServiceUnavailableError } from '../utils/errors.js';
import { ownerOnly, type AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { getTenantId } from '../middleware/tenantContext.js';
import { signDatasetVideoTicket, DATASET_VIDEO_TICKET_TTL_MS } from '../security/datasetVideoTicket.js';
import { sendFailure } from '../utils/routeErrors.js';
import { clientGoneSignal, sendStream } from '../utils/streamResponse.js';
import { parsePagination, parseIntegerParam } from '../utils/pagination.js';
import { z } from 'zod';
import {
  huggingFacePublishService,
  PublishError,
} from '../services/HuggingFacePublishService.js';

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

/** A store call that ran out of time (the client's deadline or the SDK's own timeouts) rather than failed. */
function isStoreTimeout(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TimeoutError';
}

/** The headers a video answer sets, taken back off when the stream fails before its first byte. */
const VIDEO_HEADERS = ['Content-Type', 'Accept-Ranges', 'Content-Range', 'Content-Length'];

/**
 * Answer a video request for an object of `size` bytes: 206 with the window
 * `open` reads when the request carries a `Range`, 416 for one that cannot be
 * served, 200 with the whole object otherwise. `open` is called at most once,
 * with the signal that fires when the client goes away — a player drops its
 * request on every episode switch — and never for a HEAD, which is answered
 * from `size` alone.
 *
 * Status and headers are set once the stream is in hand, so a failed open is
 * answered by the route's own error body, not under a `Content-Range`.
 */
async function sendVideo(
  req: Request,
  res: Response,
  size: number,
  open: (range: { start: number; end: number } | undefined, signal: AbortSignal) => Readable | Promise<Readable>,
): Promise<void> {
  const header = req.headers.range;
  const range = header ? parseByteRange(header, size) : undefined;
  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }
  const head = (): void => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.setHeader('Content-Length', size);
    }
  };
  if (req.method === 'HEAD') {
    head();
    res.end();
    return;
  }
  await pipeStreamToResponse(res, (signal) => open(range, signal), head);
}

/**
 * Pipe a video stream to the response and give it back however the request
 * ends — see `utils/streamResponse.ts`. A stream that fails before its first
 * byte is answered with a status and a body, never under the video's headers.
 */
async function pipeStreamToResponse(
  res: Response,
  source: Readable | ((signal: AbortSignal) => Readable | Promise<Readable>),
  head?: () => void,
): Promise<void> {
  await sendStream(res, source, {
    head,
    headerNames: VIDEO_HEADERS,
    failure: { status: 500, body: { error: 'Failed to stream video' } },
    onError: (error) => console.error('[DatasetRoutes] Video stream failed:', error.message),
  });
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

/**
 * `meta/info.json` of the directory a local dataset is served from. Read from
 * disk rather than taken from the dataset record: a v3.0 dataset is served
 * from its converted v2.1 view, whose templates and `chunks_size` are the
 * view's own. Null when the file is missing or unreadable — the path helpers
 * then fall back to the LeRobot defaults.
 */
async function readLocalInfo(storagePath: string): Promise<EpisodePathInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(join(storagePath, 'meta', 'info.json'), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as EpisodePathInfo) : null;
  } catch {
    return null;
  }
}

/**
 * The first of `candidates` (paths relative to the dataset directory) that
 * exists on disk, as an absolute path. A candidate that would resolve outside
 * the dataset directory is skipped, never opened.
 */
function firstExistingFile(storagePath: string, candidates: string[]): string | null {
  const baseDir = resolve(storagePath);
  for (const candidate of candidates) {
    const file = resolve(baseDir, candidate);
    if (!file.startsWith(baseDir + sep)) continue;
    if (existsSync(file)) return file;
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
  // Episode N lives in chunk floor(N / chunks_size), not always chunk-000 (TASK-479).
  const info = await readLocalInfo(storagePath);
  const file = firstExistingFile(storagePath, episodeDataCandidates(info, episodeIndex));
  if (!file) return null;
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
  // The mp4 sits in the episode's chunk directory, in the order `info.json`
  // names or either of the two in use: videos/chunk-NNN/<camera>/ (standard
  // LeRobot v2.1) and videos/<camera>/chunk-NNN/ (Cosmos converter).
  const info = await readLocalInfo(storagePath);
  const file = firstExistingFile(storagePath, episodeVideoCandidates(info, featureKey, episodeIndex));
  if (!file) return false;

  const { size } = statSync(file);
  await sendVideo(req, res, size, (range) => createReadStream(file, range ?? {}));
  return true;
}

/** S3's answer for an object that is not there: `NoSuchKey` on GET, `NotFound` on HEAD. */
function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

/**
 * Object access to one RustFS dataset, for the episodes and frames readers.
 *
 * Returns null when RustFS is not running. The bucket is the first of
 * 'training-datasets' and the legacy 'datasets' that holds anything under the
 * dataset's prefix; a dataset in neither is a 422, not an empty listing.
 * Storage errors propagate — the reader turns them into a 502 naming the file.
 *
 * Every call here is a round trip, so none is made twice: the bucket is
 * probed once per stored state of the dataset (`versionKey`), a read is one
 * GET and a stat one HEAD — each used to be preceded by an `exists` HEAD of
 * its own — and parquet footers are remembered (see `DatasetReadCache.ts`).
 */
async function rustfsDatasetStore(storagePath: string, versionKey: string): Promise<DatasetObjectStore | null> {
  const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
  if (!isRustFSInitialized()) return null;
  const rustfs = getRustFSClient();
  const base = storagePath.endsWith('/') ? storagePath : `${storagePath}/`;

  const located = await cachedLocation(`${versionKey}#bucket`, async () => {
    let firstError: unknown = null;
    let listedAny = false;
    for (const candidate of [BUCKETS.TRAINING_DATASETS, 'datasets']) {
      try {
        const probe = await rustfs.list(candidate, { prefix: base, maxKeys: 1 });
        listedAny = true;
        if (probe.objects.length > 0) return { bucket: candidate };
      } catch (error) {
        // The legacy bucket may not exist at all; only an error on every
        // bucket says storage itself is failing.
        firstError ??= error;
      }
    }
    if (!listedAny) {
      throw new DatasetReadError(502, `Could not list ${base} in object storage: ${(firstError as Error).message}`);
    }
    return null;
  });
  if (!located) {
    throw new DatasetReadError(422, `No files for this dataset in object storage (prefix ${base})`, base);
  }
  const from = located.bucket;
  return footerCachingStore(
    {
      async read(path) {
        try {
          return await rustfs.download(from, `${base}${path}`);
        } catch (error) {
          if (isMissingObject(error)) return null;
          throw error;
        }
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
        try {
          const meta = await rustfs.getMetadata(from, `${base}${path}`);
          return { size: Number(meta.contentLength ?? 0) };
        } catch (error) {
          if (isMissingObject(error)) return null;
          throw error;
        }
      },
      readRange(path, offset, length) {
        return rustfs.downloadRange(from, `${base}${path}`, offset, length);
      },
    },
    versionKey,
  );
}

/** What the episodes and frames routes need to know about the dataset record. */
interface BrowsedDataset {
  id: string;
  storagePath: string;
  lerobotVersion?: string | null;
  updatedAt?: Date | string | null;
}

/**
 * The dataset's episode table from RustFS, read once per stored state of the
 * dataset and then answered from memory (see `DatasetReadCache.ts`). The
 * episode list is this table; a v3.0 frames read looks its data file up in it.
 */
function remoteEpisodeTable(
  dataset: BrowsedDataset,
  info: Parameters<typeof readEpisodeTable>[1],
  fps: number,
): Promise<EpisodeTable> {
  const versionKey = datasetVersionKey(dataset);
  return cachedEpisodeTable(versionKey, async () => {
    const store = await rustfsDatasetStore(dataset.storagePath, versionKey);
    if (!store) throw new DatasetReadError(503, 'Object storage is unavailable, so episodes cannot be read');
    return readEpisodeTable(store, info, fps, dataset.lerobotVersion);
  });
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
// DELETE /api/datasets/robot-types/:id - Remove an unused robot type (TASK-485)
// ============================================================================
//
// Owner-only, like defining one. 409 `ROBOT_TYPE_IN_USE` names the datasets,
// embodiments and skills that still point at the type and lists them in
// `references`; 409 `ROBOT_TYPE_STANDARD` for a type the server seeds at start.
datasetRoutes.delete('/robot-types/:id', ownerOnly, async (req: Request, res: Response) => {
  try {
    const robotType = await datasetService.deleteRobotConfiguration(req.params.id, actorOf(req));
    res.json({ robotType, message: `Robot type "${robotType.name}" deleted` });
  } catch (error) {
    if (error instanceof DatasetExpectationError && error.code === 'ROBOT_TYPE_IN_USE') {
      const references = (error as { references?: unknown }).references;
      res.status(409).json({ error: error.message, code: error.code, ...(references ? { references } : {}) });
      return;
    }
    sendExpectationError(res, error, 'Failed to delete robot type');
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
      page: parseIntegerParam(query.page, 'page', { min: 1 }),
      limit: parseIntegerParam(query.limit, 'limit', { min: 1 }),
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
    sendFailure(res, error, 'Failed to list datasets');
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
// POST /api/datasets/:id/import/cancel - Stop a running Hub import (TASK-371)
// ============================================================================
//
// The lookup comes first and goes through the tenant-scoped service: the
// importer's record of what it is running is process-wide, so without it a
// caller could stop another organization's import by guessing its id.

datasetRoutes.post('/:id/import/cancel', async (req: Request, res: Response) => {
  try {
    const dataset = await datasetService.get(req.params.id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found', code: 'NOT_FOUND' });
    }
    const result = await huggingFaceImportService.cancelImport(dataset.id);
    // 200 once the run has unwound; 202 while it is still stopping.
    res.status(result.status === 'cancelled' ? 200 : 202).json(result);
  } catch (error) {
    console.error(`[DatasetRoutes] Cancel failed for ${req.params.id}:`, error);
    sendImportError(res, error, 'Failed to cancel import');
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
      // The row decides: a ready dataset never reports "validating, 95 %" (TASK-486).
      progress: settledImportProgress(dataset.status, activity?.progress ?? null),
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
    // An unknown or unready dataset is a typed AppError (404 / 409) that
    // sendFailure passes through; every other failure answers the fallback.
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
// Publishing to the Hugging Face Hub (TASK-394)
//
// Replaces `push-to-hub`, which spawned a script at a path on another machine,
// read from RustFS only and took the token from the browser. The service reads
// the local LeRobot directory and uses the server's own token; see
// services/HuggingFacePublishService.ts.
// ============================================================================

/** Hub tags and SPDX-ish license ids: short, no spaces, nothing a YAML card has to escape. */
const HUB_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9:._+-]{0,49}$/;

const publishDatasetSchema = z.object({
  repoId: z.string().trim().min(1).max(200),
  private: z.boolean().optional(),
  license: z.string().trim().toLowerCase().regex(HUB_TOKEN_RE).optional(),
  tags: z.array(z.string().trim().regex(HUB_TOKEN_RE)).max(20).optional(),
  description: z.string().max(2000).optional(),
  force: z.boolean().optional(),
}).strict();

function sendPublishError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof PublishError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  sendFailure(res, error, fallback);
}

// GET /api/datasets/publish/status — is a token configured, and whose is it.
// Two segments, so it never collides with `/:id`; registered here anyway so
// the order reads the way it resolves.
datasetRoutes.get('/publish/status', async (_req: Request, res: Response) => {
  try {
    res.json(await huggingFacePublishService.getStatus());
  } catch (error) {
    sendFailure(res, error, 'Failed to read the Hugging Face publish status');
  }
});

// POST /api/datasets/:id/publish — start publishing; 202 with the job.
datasetRoutes.post('/:id/publish', async (req: Request, res: Response) => {
  const input = publishDatasetSchema.safeParse(req.body ?? {});
  if (!input.success) {
    const fields = input.error.issues.map((issue) => issue.path.join('.') || '(body)');
    return res.status(400).json({
      error: `Invalid publish request: ${[...new Set(fields)].join(', ')}`,
      code: 'INVALID_PUBLISH_REQUEST',
      fields,
    });
  }
  try {
    const job = await huggingFacePublishService.publish(req.params.id, input.data, actorOf(req));
    res.status(202).json(job);
  } catch (error) {
    sendPublishError(res, error, 'Failed to start publishing');
  }
});

// GET /api/datasets/:id/publish — the current or last publish of this dataset.
datasetRoutes.get('/:id/publish', async (req: Request, res: Response) => {
  try {
    const job = await huggingFacePublishService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Dataset not found' });
    res.json(job);
  } catch (error) {
    sendPublishError(res, error, 'Failed to read the publish status');
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

    // A direct upload that is still open (TASK-480) holds parts that are not
    // objects yet — a prefix delete would leave them in the bucket — and may be
    // streaming one right now. The tenant-scoped lookup comes first: the
    // upload's own table carries no tenant.
    if (await datasetService.get(id)) {
      await datasetUploadService.releaseForDelete(id);
    }

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
    if (error instanceof DatasetUploadError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
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
//
// The presigned-archive upload, kept as it was: the upload modal still uses it.
// The direct upload (TASK-480) lives in dataset-uploads.routes.ts; the service
// refuses an archive for a dataset a direct upload is filling.

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
// GET /api/datasets/:id/modality - Joint groups of the state/action vectors
// ============================================================================

datasetRoutes.get('/:id/modality', async (req: Request, res: Response) => {
  try {
    res.json(await datasetService.getModality(req.params.id));
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof DatasetStoreError) {
      return res.status(503).json({ error: 'Object storage is unavailable, so the joint groups cannot be read' });
    }
    console.error('[DatasetRoutes] Error getting modality:', error);
    sendFailure(res, error, 'Failed to get dataset modality', 500);
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
    // The table is cached per stored state of the dataset; the flags are
    // read fresh above and laid over a copy of each row.
    const episodes = episodesOf(await remoteEpisodeTable(dataset, info, fps));
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
    const versionKey = datasetVersionKey(dataset);
    const episode = await episodeFramesCache.getOrLoad(`${versionKey}#${episodeIndex}`, episodeWeight, async () => {
      const store = await rustfsDatasetStore(dataset.storagePath, versionKey);
      if (!store) throw new DatasetReadError(503, 'Object storage is unavailable, so frames cannot be read');
      // A v3.0 episode's data file is named by the episode table, which is
      // cached. It is fetched BEFORE taking a cold-read slot: the table load
      // takes a slot of its own, and waiting for it while holding one would
      // let six first-time frame requests starve the read they all wait on.
      const table =
        layoutOf(info, dataset.lerobotVersion) === 'v3' ? await remoteEpisodeTable(dataset, info, fps) : null;
      return coldReadGate(() =>
        readRemoteEpisodeFrames(
          store,
          info,
          episodeIndex,
          fps,
          dataset.lerobotVersion,
          table ? async () => table : undefined,
        ),
      );
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
// POST /api/datasets/:id/video-ticket - Mint a ticket for this dataset's videos
// ============================================================================

/**
 * The episode video is played by a `<video>`, which cannot send an
 * `Authorization` header, so with sign-in on something has to travel in the
 * URL. This is that something (TASK-478): a signed assertion good for this
 * dataset's video GETs for fifteen minutes and for nothing else — not the
 * caller's access token. The caller is authenticated normally here, and the
 * ticket carries their identity and the tenant scope of this request forward.
 */
datasetRoutes.post('/:id/video-ticket', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      // Only reachable if this route is ever mounted without authMiddleware.
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // A ticket for a dataset the caller cannot see would be a valid signature
    // over nothing; the lookup runs in the caller's tenant scope.
    const dataset = await datasetService.get(req.params.id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const ticket = signDatasetVideoTicket({
      datasetId: req.params.id,
      userId: user.id,
      // The scope this request ran in, which for an impersonating super-admin
      // is not their own tenant — the video request has no header to repeat it.
      tenantId: getTenantId() ?? user.tenantId ?? null,
      role: user.role,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ticket, expiresIn: Math.floor(DATASET_VIDEO_TICKET_TTL_MS / 1000) });
  } catch (error) {
    console.error('[DatasetRoutes] Error minting video ticket:', error);
    res.status(500).json({ error: 'Failed to mint video ticket' });
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
    // floor(ep / chunks_size) guess when absent.
    // An unreadable infoJson must not cost the video: the helper then goes by
    // the LeRobot default of 1000, which is what this route always assumed.
    let info: EpisodePathInfo | null = null;
    try {
      info = (typeof dataset.infoJson === 'string'
        ? JSON.parse(dataset.infoJson as string)
        : dataset.infoJson) as EpisodePathInfo | null;
    } catch {
      info = null;
    }
    const episodeChunk = episodeChunkOf(info, episodeIndex);
    const chunkQ = parseInt(String(req.query.chunk ?? ''), 10);
    const fileQ = parseInt(String(req.query.file ?? ''), 10);
    const chunkIndex = Number.isFinite(chunkQ) ? chunkQ : episodeChunk;
    const fileIndex = Number.isFinite(fileQ) ? fileQ : 0;
    const pad3 = (n: number) => String(n).padStart(3, '0');

    // LeRobot v2.x lays out one mp4 PER EPISODE:
    //   videos/chunk-{chunk:03d}/{camera key}/episode_{ep:06d}.mp4
    // LeRobot v3 concatenates all episodes of a chunk into one file per camera:
    //   videos/{camera key}/chunk-{chunk:03d}/file-{file:03d}.mp4
    // Try the layout matching the dataset's version first, then the other one
    // as a fallback (imports occasionally mislabel the version).
    const v2Path = `videos/chunk-${pad3(episodeChunk)}/${featureKey}/episode_${String(episodeIndex).padStart(6, '0')}.mp4`;
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
        // A player asks for the same file again on every seek and every
        // buffer refill; where it is and how long it is does not change
        // between those requests, so it is looked up once.
        found = await cachedLocation(`${datasetVersionKey(dataset)}#video:${candidatePaths[0]}`, async () => {
          for (const candidate of candidatePaths) {
            for (const bucket of [BUCKETS.TRAINING_DATASETS, 'datasets']) {
              const key = `${base}${candidate}`;
              if (!(await rustfs.exists(bucket, key))) continue;
              const metadata = await rustfs.getMetadata(bucket, key);
              return { bucket, key, size: metadata.contentLength ?? 0 };
            }
          }
          return null;
        });
      } catch (err) {
        // The store did not answer and there is nowhere else to get the video:
        // that is "not now" (503 below), not the 404 the fall-through ends in.
        if (isStoreTimeout(err) && !dataset.huggingFaceRepoId) throw err;
        // RustFS unreachable — fall through to the HF proxy.
        console.warn('[DatasetRoutes] RustFS video lookup failed:', err instanceof Error ? err.message : err);
      }
      if (found) {
        const { bucket, key, size } = found;
        await sendVideo(req, res, size, (range, signal) => rustfs.getStream(bucket, key, range, { signal }));
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
    // The player that asked may be gone before HuggingFace answers.
    const hfResponse = await fetch(hfUrl, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
      redirect: 'follow',
      signal: clientGoneSignal(res),
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

    if (req.method === 'HEAD' || !hfResponse.body) {
      void hfResponse.body?.cancel().catch(() => undefined);
      res.end();
      return;
    }
    const { Readable: NodeReadable } = await import('stream');
    const nodeStream = NodeReadable.fromWeb(hfResponse.body as import('stream/web').ReadableStream);
    await pipeStreamToResponse(res, nodeStream);
  } catch (error) {
    // The client left: there is nobody to answer, and nothing went wrong.
    if (res.destroyed || res.socket?.destroyed) return;
    console.error('[DatasetRoutes] Error streaming video:', error);
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    for (const name of VIDEO_HEADERS) res.removeHeader(name);
    if (isStoreTimeout(error)) {
      // The store did not answer in time. Say "not now", so a player retries
      // instead of concluding the video does not exist.
      res.setHeader('Retry-After', '2');
      res.status(503).json({ error: 'Object storage did not answer in time', code: 'STORAGE_TIMEOUT' });
      return;
    }
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
    const { page, limit } = parsePagination(query, { defaultLimit: 20 });

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
    sendFailure(res, error, 'Failed to get flagged trajectories');
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

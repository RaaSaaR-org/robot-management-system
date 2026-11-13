/**
 * @file dataset-files.routes.ts
 * @description REST endpoints that hand a dataset's stored files back out (TASK-496):
 *              a paginated manifest and each file as raw bytes with Range.
 *              The contract is docs/dataset-download.md.
 * @feature datasets
 *
 * Mounted on `/api/datasets` ahead of the main dataset router, behind the same
 * `protect` chain: reading a dataset's files needs what reading the dataset
 * needs, and the dataset is looked up through the caller's tenant. Both routes
 * count against the dataset-browsing rate-limit budget (`middleware/rateLimit.ts`).
 *
 * A file is never redirected to a presigned URL — that names the in-cluster
 * store, which a client outside cannot reach — and never buffered: the store's
 * body is piped through `sendStream`, which gives the stream back however the
 * client leaves (TASK-491).
 */

import { Router, type Request, type Response } from 'express';
import { datasetService } from '../services/DatasetService.js';
import {
  checkFilePath,
  DatasetFilesError,
  DEFAULT_FILES_PAGE,
  listDatasetFiles,
  locateDatasetFiles,
  MAX_FILES_PAGE,
  statDatasetFile,
} from '../services/DatasetFilesService.js';
import { isOperationalError } from '../utils/errors.js';
import { sendFailure } from '../utils/routeErrors.js';
import { sendStream } from '../utils/streamResponse.js';

export const datasetFileRoutes = Router();

/** The headers a file answer sets, taken back off when the stream fails before its first byte. */
const FILE_HEADERS = ['Content-Type', 'Accept-Ranges', 'Content-Range', 'Content-Length', 'ETag'];

/**
 * A single-range `Range` header against a file of `size` bytes: the inclusive
 * window, or 'unsatisfiable' (answered 416) for anything malformed or out of bounds.
 */
export function parseFileRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = parseInt(m[2], 10);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] ? parseInt(m[2], 10) : size - 1;
  }
  end = Math.min(end, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/** A store call that ran out of time rather than failed. */
function isStoreTimeout(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TimeoutError';
}

/** Answer a refusal with its status, sentence and stable `code`; anything unexpected is logged, never echoed. */
function sendFilesError(res: Response, error: unknown, fallback: string): void {
  // The client left: there is nobody to answer, and nothing went wrong.
  if (res.destroyed || res.socket?.destroyed) return;
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  for (const name of FILE_HEADERS) res.removeHeader(name);
  if (isStoreTimeout(error)) {
    // "Not now", so a downloader retries instead of concluding the file is gone.
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'Object storage did not answer in time', code: 'STORAGE_TIMEOUT' });
    return;
  }
  if (error instanceof DatasetFilesError || (isOperationalError(error) && error.code === 'STORAGE_UNAVAILABLE')) {
    const retryAfter = error.context?.retryAfterSeconds;
    if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
    res.status(error.statusCode).json({ ...error.context, error: error.message, code: error.code });
    return;
  }
  sendFailure(res, error, fallback, 500, { code: 'FILES_ERROR' });
}

async function datasetOr404(id: string) {
  const dataset = await datasetService.get(id);
  if (!dataset) throw new DatasetFilesError('NOT_FOUND', 'Dataset not found', 404);
  return dataset;
}

// ============================================================================
// GET /api/datasets/:id/files - The dataset's stored files, one page
// ============================================================================

datasetFileRoutes.get('/:id/files', async (req: Request, res: Response) => {
  try {
    const rawLimit = req.query.limit;
    let limit = DEFAULT_FILES_PAGE;
    if (rawLimit !== undefined) {
      limit = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FILES_PAGE) {
        throw new DatasetFilesError('INVALID_LIMIT', `limit must be a whole number from 1 to ${MAX_FILES_PAGE}`, 400);
      }
    }
    const rawAfter = req.query.after;
    if (rawAfter !== undefined && typeof rawAfter !== 'string') {
      throw new DatasetFilesError('INVALID_CURSOR', 'after must be the nextCursor of the previous page', 400);
    }
    const after = rawAfter ? checkCursor(rawAfter) : undefined;

    const dataset = await datasetOr404(req.params.id);
    const location = await locateDatasetFiles(dataset);
    const page = await listDatasetFiles(dataset.id, location, { after, limit });
    res.json({
      datasetId: dataset.id,
      storage: location.storage,
      limit,
      files: page.files,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    sendFilesError(res, error, 'Failed to list the dataset\'s files');
  }
});

function checkCursor(after: string): string {
  try {
    return checkFilePath(after);
  } catch {
    throw new DatasetFilesError('INVALID_CURSOR', 'after must be the nextCursor of the previous page', 400);
  }
}

// ============================================================================
// GET|HEAD /api/datasets/:id/files/content?path= - One stored file, raw bytes
// ============================================================================

datasetFileRoutes.get('/:id/files/content', async (req: Request, res: Response) => {
  try {
    const path = checkFilePath(req.query.path);
    const dataset = await datasetOr404(req.params.id);
    const location = await locateDatasetFiles(dataset);
    const file = await statDatasetFile(location, path);

    const header = req.headers.range;
    const range = header ? parseFileRange(header, file.size) : undefined;
    if (range === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${file.size}`);
      res.json({ error: `The range is outside the file (${file.size} bytes)`, code: 'RANGE_NOT_SATISFIABLE', size: file.size });
      return;
    }
    const head = (): void => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      if (file.etag) res.setHeader('ETag', `"${file.etag}"`);
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
        res.setHeader('Content-Length', range.end - range.start + 1);
      } else {
        res.setHeader('Content-Length', file.size);
      }
    };
    if (req.method === 'HEAD' || file.size === 0) {
      head();
      res.end();
      return;
    }
    await sendStream(res, (signal) => file.open(range, signal), {
      head,
      headerNames: FILE_HEADERS,
      failure: { status: 502, body: { error: 'The file could not be read from storage', code: 'STORE_ERROR' } },
      onError: (error) => console.error(`[DatasetFiles] ${dataset.id} ${path}: stream failed:`, error.message),
    });
  } catch (error) {
    sendFilesError(res, error, 'Failed to read the dataset file');
  }
});

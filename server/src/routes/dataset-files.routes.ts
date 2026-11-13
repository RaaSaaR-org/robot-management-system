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
import { answeredFileFailure, parseFileRange, sendStoredFile } from '../utils/fileResponse.js';

export const datasetFileRoutes = Router();

// Shared with the model file route (TASK-498); re-exported for this route's tests.
export { parseFileRange };

/** Answer a refusal with its status, sentence and stable `code`; anything unexpected is logged, never echoed. */
function sendFilesError(res: Response, error: unknown, fallback: string): void {
  if (answeredFileFailure(res, error)) return;
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

    await sendStoredFile(req, res, file, {
      onStreamError: (error) => console.error(`[DatasetFiles] ${dataset.id} ${path}: stream failed:`, error.message),
    });
  } catch (error) {
    sendFilesError(res, error, 'Failed to read the dataset file');
  }
});

/**
 * @file model-uploads.routes.ts
 * @description REST endpoints of the direct model checkpoint upload (TASK-498)
 *              — start, list, status, one part, finish, cancel — and of the
 *              way back out: the file list of a stored model and each file as
 *              raw bytes with `Range`, in the shape a dataset's files are
 *              served in (TASK-496). The contract is docs/model-upload.md.
 * @feature deployment
 *
 * Mounted on `/api/models` ahead of the registry router, behind the same
 * `protect` chain: starting an upload needs what registering a model needs,
 * and every later call finds only the caller's organization's uploads.
 */

import { Router, type Request, type Response } from 'express';
import { modelVersionRepository } from '../repositories/index.js';
import {
  DEFAULT_MODEL_FILES_PAGE,
  MAX_MODEL_FILES_PAGE,
  modelUploadService,
  type StartModelUploadRequest,
} from '../services/modelUpload/ModelUploadService.js';
import { DatasetUploadError, unsafePathReason } from '../services/datasetUpload/uploadManifest.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { answeredFileFailure, sendStoredFile } from '../utils/fileResponse.js';
import { handlePartRequest, sendUploadError } from './uploadRouteSupport.js';

export const modelUploadRoutes = Router();

/**
 * Whether a request is one part of a direct model upload. A checkpoint is
 * hundreds of parts; like a dataset's they are counted by no rate-limit budget
 * and bounded by the upload service's own concurrency limit instead.
 * `path` may be given with or without the `/api` mount prefix.
 */
export function isModelUploadPart(method: string, path: string): boolean {
  return method === 'PUT' && /^(\/api)?\/models\/uploads\/[^/]+\/files\/\d+\/parts\/\d+\/?$/.test(path);
}

// POST /api/models/uploads — declare a checkpoint and open its upload
modelUploadRoutes.post('/uploads', async (req: Request, res: Response) => {
  try {
    const result = await modelUploadService.start((req.body ?? {}) as StartModelUploadRequest);
    res.status(201).json(result);
  } catch (error) {
    sendUploadError(res, error, 'Failed to start the upload');
  }
});

// GET /api/models/uploads — uploads that are not registered models yet
modelUploadRoutes.get('/uploads', async (_req: Request, res: Response) => {
  try {
    res.json({ uploads: await modelUploadService.listOpen() });
  } catch (error) {
    sendUploadError(res, error, 'Failed to list the uploads');
  }
});

// GET /api/models/uploads/:id — what the server holds of this upload
modelUploadRoutes.get('/uploads/:id', async (req: Request, res: Response) => {
  try {
    res.json(await modelUploadService.status(req.params.id));
  } catch (error) {
    sendUploadError(res, error, 'Failed to read the upload status');
  }
});

// PUT /api/models/uploads/:id/files/:fileId/parts/:partNumber — one part, raw body
modelUploadRoutes.put('/uploads/:id/files/:fileId/parts/:partNumber', async (req: Request, res: Response) => {
  await handlePartRequest(req, res, (part) =>
    modelUploadService.receivePart(req.params.id, part.fileId, part.partNumber, part.source, {
      contentLength: part.contentLength,
      sha256: part.sha256,
    }));
});

// POST /api/models/uploads/:id/finish — every part is sent; assemble, verify, register
modelUploadRoutes.post('/uploads/:id/finish', async (req: Request, res: Response) => {
  try {
    const result = await modelUploadService.finish(req.params.id, (req as AuthenticatedRequest).user?.id);
    res.status(result.state === 'completed' ? 200 : 202).json(result);
  } catch (error) {
    sendUploadError(res, error, 'Failed to finish the upload');
  }
});

// POST /api/models/uploads/:id/cancel — stop, and remove everything stored
modelUploadRoutes.post('/uploads/:id/cancel', async (req: Request, res: Response) => {
  try {
    res.json(await modelUploadService.cancel(req.params.id));
  } catch (error) {
    sendUploadError(res, error, 'Failed to cancel the upload');
  }
});

/**
 * The model first, through the tenant-scoped registry: a model of another
 * organization answers 404 before anything is asked about its files.
 */
async function requireModel(id: string, res: Response): Promise<boolean> {
  if (await modelVersionRepository.findById(id)) return true;
  res.status(404).json({ error: 'Model version not found', code: 'NOT_FOUND' });
  return false;
}

/** `path` / `after` checked as a string: a relative POSIX path of plain segments. */
function checkedPath(value: unknown, code: 'INVALID_PATH' | 'INVALID_CURSOR'): string {
  const reason = unsafePathReason(value);
  if (reason) {
    throw new DatasetUploadError(
      code,
      code === 'INVALID_PATH' ? `Invalid file path: ${reason}` : 'after must be the nextCursor of the previous page',
      400,
    );
  }
  return value as string;
}

/** Answer a refusal of a file route; a store that is slow or a client that left is handled first. */
function sendFilesError(res: Response, error: unknown, fallback: string): void {
  if (answeredFileFailure(res, error)) return;
  sendUploadError(res, error, fallback);
}

// GET /api/models/versions/:id/files?limit=&after= — the files this server stores for a model
modelUploadRoutes.get('/versions/:id/files', async (req: Request, res: Response) => {
  try {
    const rawLimit = req.query.limit;
    let limit = DEFAULT_MODEL_FILES_PAGE;
    if (rawLimit !== undefined) {
      limit = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MODEL_FILES_PAGE) {
        throw new DatasetUploadError('INVALID_LIMIT', `limit must be a whole number from 1 to ${MAX_MODEL_FILES_PAGE}`, 400);
      }
    }
    const rawAfter = req.query.after;
    const after = rawAfter === undefined || rawAfter === '' ? undefined : checkedPath(rawAfter, 'INVALID_CURSOR');
    if (!await requireModel(req.params.id, res)) return;
    res.json(await modelUploadService.manifest(req.params.id, { after, limit }));
  } catch (error) {
    sendFilesError(res, error, 'Failed to list the model files');
  }
});

// GET|HEAD /api/models/versions/:id/files/content?path= — one stored file, raw bytes, with Range
modelUploadRoutes.get('/versions/:id/files/content', async (req: Request, res: Response) => {
  try {
    const path = checkedPath(req.query.path, 'INVALID_PATH');
    if (!await requireModel(req.params.id, res)) return;
    // The path is only ever compared with the model's own manifest.
    const { entry, open } = await modelUploadService.file(req.params.id, path);
    await sendStoredFile(req, res, {
      size: entry.size,
      sha256: entry.sha256,
      open: (range, signal) => open({ range, signal }),
    }, {
      onStreamError: (error) => console.error(`[ModelUpload] reading ${entry.path} of model ${req.params.id} failed:`, error.message),
    });
  } catch (error) {
    sendFilesError(res, error, 'Failed to read the model file');
  }
});

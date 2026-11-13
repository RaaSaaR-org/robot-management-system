/**
 * @file dataset-uploads.routes.ts
 * @description REST endpoints of the direct dataset upload (TASK-480): start,
 *              status, one part, finish, cancel. The contract is
 *              docs/dataset-upload.md.
 * @feature datasets
 *
 * Mounted on `/api/datasets` ahead of the main dataset router, behind the same
 * `protect` chain — so starting an upload needs exactly what creating a
 * dataset needs, and every later call is scoped by the tenant of the dataset
 * it names.
 *
 * The part route reads its body as a raw stream. `express.json()` only ever
 * consumes `application/json`, so an `application/octet-stream` body reaches
 * the handler untouched; any other content type is refused, because a body a
 * parser already ate cannot be stored.
 */

import { Router, type Request, type Response } from 'express';
import { datasetUploadService, type StartUploadRequest } from '../services/datasetUpload/DatasetUploadService.js';
import { HARD_MAX_CHUNK_BYTES } from '../services/datasetUpload/uploadManifest.js';
import { isOperationalError } from '../utils/errors.js';
import { sendFailure } from '../utils/routeErrors.js';

export const datasetUploadRoutes = Router();

/**
 * Whether a request is one part of a direct upload.
 *
 * The API rate limits (300 writes a minute in production) would stall every
 * upload after its first few hundred parts, so `app.ts` exempts exactly these
 * requests from them. They are bounded on their own terms: the upload service
 * streams only a few at a time and answers the rest 503 with Retry-After.
 * `path` may be given with or without the `/api` mount prefix.
 */
export function isDatasetUploadPart(method: string, path: string): boolean {
  return method === 'PUT' && /^(\/api)?\/datasets\/[^/]+\/upload\/files\/\d+\/parts\/\d+\/?$/.test(path);
}

/**
 * Answer a refusal with its status, sentence, stable `code` and context
 * (`missing`, `expectedSize`, …). Anything unexpected goes through
 * `sendFailure`, which logs it and never echoes it.
 */
function sendUploadError(res: Response, error: unknown, fallback: string): void {
  if (isOperationalError(error)) {
    const retryAfter = error.context?.retryAfterSeconds;
    if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
    res.status(error.statusCode).json({ ...error.context, error: error.message, code: error.code });
    return;
  }
  sendFailure(res, error, fallback, 500, { code: 'UPLOAD_ERROR' });
}

/** A decimal `Content-Length`, or null when the request does not carry one. */
function contentLengthOf(req: Request): number | null {
  const raw = req.headers['content-length'];
  return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
}

// POST /api/datasets/uploads — declare a dataset and open its upload
datasetUploadRoutes.post('/uploads', async (req: Request, res: Response) => {
  try {
    const result = await datasetUploadService.start((req.body ?? {}) as StartUploadRequest);
    res.status(201).json(result);
  } catch (error) {
    sendUploadError(res, error, 'Failed to start the upload');
  }
});

// GET /api/datasets/:id/upload — what the server holds of this upload
datasetUploadRoutes.get('/:id/upload', async (req: Request, res: Response) => {
  try {
    res.json(await datasetUploadService.status(req.params.id));
  } catch (error) {
    sendUploadError(res, error, 'Failed to read the upload status');
  }
});

// PUT /api/datasets/:id/upload/files/:fileId/parts/:partNumber — one part, raw body
datasetUploadRoutes.put('/:id/upload/files/:fileId/parts/:partNumber', async (req: Request, res: Response) => {
  const declaredLength = contentLengthOf(req);
  /**
   * A refusal is answered before the body has been read. The body is then
   * drained so the client reads the answer instead of a reset connection —
   * unless it is larger than any part may be, in which case the connection is
   * closed rather than made to carry it.
   */
  const refuse = (send: () => void): void => {
    if (!req.readableEnded && !req.destroyed) {
      if (declaredLength !== null && declaredLength <= HARD_MAX_CHUNK_BYTES) {
        req.resume();
      } else {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
    }
    send();
  };

  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/octet-stream') {
    refuse(() => res.status(415).json({
      error: 'A part is sent as a raw body with Content-Type: application/octet-stream',
      code: 'UNSUPPORTED_MEDIA_TYPE',
    }));
    return;
  }
  const fileId = /^\d+$/.test(req.params.fileId) ? Number(req.params.fileId) : NaN;
  const partNumber = /^\d+$/.test(req.params.partNumber) ? Number(req.params.partNumber) : NaN;
  const checksum = req.headers['x-chunk-sha256'];
  try {
    const receipt = await datasetUploadService.receivePart(req.params.id, fileId, partNumber, req, {
      contentLength: declaredLength,
      sha256: typeof checksum === 'string' ? checksum : null,
    });
    res.json(receipt);
  } catch (error) {
    // Not `req.destroyed`: a body that was read to its end is destroyed too.
    // Writing to a client that went away is harmless.
    if (res.headersSent) return;
    refuse(() => sendUploadError(res, error, 'Failed to store the part'));
  }
});

// POST /api/datasets/:id/upload/finish — every part is sent; assemble and validate
datasetUploadRoutes.post('/:id/upload/finish', async (req: Request, res: Response) => {
  try {
    const result = await datasetUploadService.finish(req.params.id);
    res.status(result.state === 'completed' ? 200 : 202).json(result);
  } catch (error) {
    sendUploadError(res, error, 'Failed to finish the upload');
  }
});

// POST /api/datasets/:id/upload/cancel — stop, and remove everything stored
datasetUploadRoutes.post('/:id/upload/cancel', async (req: Request, res: Response) => {
  try {
    res.json(await datasetUploadService.cancel(req.params.id));
  } catch (error) {
    sendUploadError(res, error, 'Failed to cancel the upload');
  }
});

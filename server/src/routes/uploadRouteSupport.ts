/**
 * @file uploadRouteSupport.ts
 * @description What the routes of every direct upload share: the refusal
 *              envelope, and the handling of one raw part request.
 * @feature storage
 *
 * A part route reads its body as a raw stream. `express.json()` only ever
 * consumes `application/json`, so an `application/octet-stream` body reaches
 * the handler untouched; any other content type is refused, because a body a
 * parser already ate cannot be stored.
 */

import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import { HARD_MAX_CHUNK_BYTES } from '../services/datasetUpload/uploadManifest.js';
import { isOperationalError } from '../utils/errors.js';
import { sendFailure } from '../utils/routeErrors.js';

/**
 * Answer a refusal with its status, sentence, stable `code` and context
 * (`missing`, `expectedSize`, …). Anything unexpected goes through
 * `sendFailure`, which logs it and never echoes it.
 */
export function sendUploadError(res: Response, error: unknown, fallback: string): void {
  if (isOperationalError(error)) {
    const retryAfter = error.context?.retryAfterSeconds;
    if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
    res.status(error.statusCode).json({ ...error.context, error: error.message, code: error.code });
    return;
  }
  sendFailure(res, error, fallback, 500, { code: 'UPLOAD_ERROR' });
}

/** A decimal `Content-Length`, or null when the request does not carry one. */
export function contentLengthOf(req: Request): number | null {
  const raw = req.headers['content-length'];
  return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
}

export interface PartRequest {
  fileId: number;
  partNumber: number;
  source: Readable;
  contentLength: number | null;
  sha256: string | null;
}

/**
 * Handle `PUT …/files/:fileId/parts/:partNumber`: check the content type, hand
 * the body to `receive` as a stream, and answer its receipt or its refusal.
 */
export async function handlePartRequest(
  req: Request,
  res: Response,
  receive: (part: PartRequest) => Promise<object>,
): Promise<void> {
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
    const receipt = await receive({
      fileId,
      partNumber,
      source: req,
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
}

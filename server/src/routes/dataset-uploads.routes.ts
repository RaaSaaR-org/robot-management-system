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
 * The part route reads its body as a raw stream; how, and how a refusal is
 * answered, is `uploadRouteSupport.ts`, shared with the model upload.
 */

import { Router, type Request, type Response } from 'express';
import { datasetUploadService, type StartUploadRequest } from '../services/datasetUpload/DatasetUploadService.js';
import { handlePartRequest, sendUploadError } from './uploadRouteSupport.js';

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
  await handlePartRequest(req, res, (part) =>
    datasetUploadService.receivePart(req.params.id, part.fileId, part.partNumber, part.source, {
      contentLength: part.contentLength,
      sha256: part.sha256,
    }));
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

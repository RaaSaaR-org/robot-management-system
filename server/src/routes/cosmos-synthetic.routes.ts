/**
 * @file cosmos-synthetic.routes.ts
 * @description REST API for Cosmos 3 synthetic-episode generation (TASK-178).
 *   Drives `CosmosSyntheticService`, which runs the TASK-175 pipeline and
 *   registers the result as a training-ready, synthetic-tagged Dataset.
 * @feature training
 */

import { Router, type Request, type Response } from 'express';
import {
  cosmosSyntheticService,
  ServiceError,
  type SyntheticGeneratorMode,
} from '../services/CosmosSyntheticService.js';

export const cosmosSyntheticRoutes = Router();

/**
 * HTTP status per service error code. Typed by the code union so adding a new
 * ServiceError code without a status mapping is a compile error (no silent 400).
 */
const STATUS_BY_CODE: Record<ServiceError['code'], number> = {
  invalid: 400,
  no_token: 503,
  busy: 409,
  unavailable: 503,
};

/**
 * GET /api/synthetic-cosmos/config
 * Whether the generator can run + whether a token is configured.
 */
cosmosSyntheticRoutes.get('/config', (_req: Request, res: Response) => {
  res.json(cosmosSyntheticService.getConfig());
});

/**
 * POST /api/synthetic-cosmos/generate
 * Body: { episodes: number, prompt?: string, mode?: 'forward-dynamics' | 'neural-trajectory' }
 * Starts a job; returns the initial job record (poll GET /jobs/:id).
 * An unknown mode is rejected by the service with a 400 `invalid` error.
 */
cosmosSyntheticRoutes.post('/generate', (req: Request, res: Response) => {
  try {
    const { episodes, prompt, mode } = req.body as {
      episodes?: number;
      prompt?: string;
      mode?: string;
    };
    const job = cosmosSyntheticService.generate({
      episodes: Number(episodes),
      prompt: typeof prompt === 'string' ? prompt : undefined,
      // Validated inside the service (unknown value -> ServiceError 'invalid').
      mode: typeof mode === 'string' ? (mode as SyntheticGeneratorMode) : undefined,
    });
    res.status(202).json({ job });
  } catch (error) {
    if (error instanceof ServiceError) {
      const status = STATUS_BY_CODE[error.code] ?? 400;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    console.error('[CosmosSyntheticRoutes] generate failed:', error);
    res.status(500).json({ error: 'Failed to start synthetic generation' });
  }
});

/**
 * GET /api/synthetic-cosmos/jobs
 * List all jobs (newest first).
 */
cosmosSyntheticRoutes.get('/jobs', (_req: Request, res: Response) => {
  res.json({ jobs: cosmosSyntheticService.listJobs() });
});

/**
 * GET /api/synthetic-cosmos/jobs/:id
 * Poll a single job's progress.
 */
cosmosSyntheticRoutes.get('/jobs/:id', (req: Request, res: Response) => {
  const job = cosmosSyntheticService.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

/**
 * POST /api/synthetic-cosmos/jobs/:id/cancel
 * Cancel a running job (kills the underlying process).
 */
cosmosSyntheticRoutes.post('/jobs/:id/cancel', (req: Request, res: Response) => {
  const job = cosmosSyntheticService.cancel(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

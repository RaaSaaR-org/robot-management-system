/**
 * @file models.routes.ts
 * @description REST API endpoints for listing VLA model versions. The deployment UI
 *   (deploymentApi `GET /api/models/versions`) needs this to populate the
 *   "Select Model Version" step; it filters client-side to deploymentStatus === 'staging'.
 * @feature deployment
 */
import { Router, type Request, type Response } from 'express';
import { modelVersionRepository } from '../repositories/index.js';

export const modelsRoutes = Router();

/**
 * GET /api/models
 * Base-path index: serves the model-version collection (same data as
 * /versions) so the base path answers like its sibling collections instead
 * of 404ing.
 */
modelsRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await modelVersionRepository.findAll();
    res.json({ modelVersions: result.data, pagination: result.pagination });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list model versions' });
  }
});

/**
 * GET /api/models/versions
 * List model versions, newest first (created by TrainingOrchestrator.completeJob).
 * Response shape matches the deployment client: `{ modelVersions, pagination }`.
 */
modelsRoutes.get('/versions', async (_req: Request, res: Response) => {
  try {
    const result = await modelVersionRepository.findAll();
    res.json({ modelVersions: result.data, pagination: result.pagination });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list model versions' });
  }
});

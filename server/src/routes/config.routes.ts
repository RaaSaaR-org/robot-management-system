/**
 * @file config.routes.ts
 * @description Public feature-flag endpoint. Mounted without auth so the
 * frontend can feature-gate UI before the user has logged in. Returns
 * only booleans — no secrets, no tenant metadata.
 * @feature config
 */

import { Router, type Request, type Response } from 'express';
import { getFeatureFlags } from '../config/features.js';

export const configRoutes = Router();

configRoutes.get('/features', (_req: Request, res: Response) => {
  res.json(getFeatureFlags());
});

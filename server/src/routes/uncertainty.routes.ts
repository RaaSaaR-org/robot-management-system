/**
 * @file uncertainty.routes.ts
 * @description REST endpoints for ensemble uncertainty computation and active learning prioritization.
 * @feature Active Learning
 */

import { Router, type Request, type Response } from 'express';
import { ensembleUncertainty } from '../services/EnsembleUncertainty.js';
import type { UncertaintyEpisode } from '../types/uncertainty.types.js';

export const uncertaintyRoutes = Router();

/**
 * POST /api/uncertainty/rank
 * Rank episodes by ensemble uncertainty for active learning prioritization.
 */
uncertaintyRoutes.post('/rank', async (req: Request, res: Response) => {
  try {
    const { episodes } = req.body as { episodes: UncertaintyEpisode[] };

    if (!Array.isArray(episodes)) {
      res.status(400).json({ error: 'episodes must be an array' });
      return;
    }

    const ranked = ensembleUncertainty.rankEpisodes(episodes);
    res.json({
      ranked,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to rank episodes: ${message}` });
  }
});

/**
 * POST /api/uncertainty/jsd
 * Compute Jensen-Shannon Divergence between model predictions.
 */
uncertaintyRoutes.post('/jsd', async (req: Request, res: Response) => {
  try {
    const { predictions } = req.body as { predictions: number[][] };

    if (!Array.isArray(predictions)) {
      res.status(400).json({ error: 'predictions must be an array' });
      return;
    }

    const jsd = ensembleUncertainty.computeJSD(predictions);
    res.json({ jsd });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to compute JSD: ${message}` });
  }
});

/**
 * POST /api/uncertainty/mcdropout
 * Compute MC Dropout statistics from multiple forward passes.
 */
uncertaintyRoutes.post('/mcdropout', async (req: Request, res: Response) => {
  try {
    const { predictions } = req.body as { predictions: number[][] };

    if (!Array.isArray(predictions)) {
      res.status(400).json({ error: 'predictions must be an array' });
      return;
    }

    const result = ensembleUncertainty.computeMCDropout(predictions);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to compute MC Dropout: ${message}` });
  }
});

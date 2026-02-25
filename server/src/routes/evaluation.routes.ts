/**
 * @file evaluation.routes.ts
 * @description REST API endpoints for VLA model evaluation episodes
 * @feature evaluation
 */

import { Router, type Request, type Response } from 'express';
import { evaluationService, type EvaluationPeriod } from '../services/EvaluationService.js';

export const evaluationRoutes = Router();

// ============================================================================
// POST /api/evaluation/episodes - Record a new evaluation episode
// ============================================================================

evaluationRoutes.post('/episodes', async (req: Request, res: Response) => {
  try {
    const { robotId, modelVersion, taskPrompt, startedAt, endedAt, durationMs, success, errorType, videoUrl, metadata } = req.body;

    if (!robotId || !modelVersion || !taskPrompt) {
      return res.status(400).json({ error: 'robotId, modelVersion, and taskPrompt are required' });
    }

    const episode = await evaluationService.recordEpisode({
      robotId,
      modelVersion,
      taskPrompt,
      startedAt,
      endedAt,
      durationMs,
      success,
      errorType,
      videoUrl,
      metadata,
    });

    res.status(201).json({ episode, message: 'Evaluation episode recorded successfully' });
  } catch (error) {
    console.error('[EvaluationRoutes] Error recording episode:', error);
    const message = error instanceof Error ? error.message : 'Failed to record evaluation episode';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/evaluation/episodes - List episodes with filters
// ============================================================================

evaluationRoutes.get('/episodes', async (req: Request, res: Response) => {
  try {
    const { robotId, modelVersion, period, success, page, limit } = req.query;

    const result = await evaluationService.getEpisodes({
      robotId: robotId as string | undefined,
      modelVersion: modelVersion as string | undefined,
      period: period as EvaluationPeriod | undefined,
      success: success !== undefined ? success === 'true' : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.json(result);
  } catch (error) {
    console.error('[EvaluationRoutes] Error listing episodes:', error);
    res.status(500).json({ error: 'Failed to list evaluation episodes' });
  }
});

// ============================================================================
// GET /api/evaluation/success-rate - Get success rate
// ============================================================================

evaluationRoutes.get('/success-rate', async (req: Request, res: Response) => {
  try {
    const { robotId, modelVersion, period } = req.query;

    const result = await evaluationService.getSuccessRate(
      robotId as string | undefined,
      modelVersion as string | undefined,
      (period as EvaluationPeriod) || '24h'
    );

    res.json(result);
  } catch (error) {
    console.error('[EvaluationRoutes] Error getting success rate:', error);
    res.status(500).json({ error: 'Failed to get success rate' });
  }
});

// ============================================================================
// GET /api/evaluation/error-breakdown - Get error type breakdown
// ============================================================================

evaluationRoutes.get('/error-breakdown', async (req: Request, res: Response) => {
  try {
    const { robotId, modelVersion, period } = req.query;

    const result = await evaluationService.getErrorBreakdown(
      robotId as string | undefined,
      modelVersion as string | undefined,
      (period as EvaluationPeriod) || '24h'
    );

    res.json({ errors: result });
  } catch (error) {
    console.error('[EvaluationRoutes] Error getting error breakdown:', error);
    res.status(500).json({ error: 'Failed to get error breakdown' });
  }
});

// ============================================================================
// GET /api/evaluation/compare - Compare two model versions
// ============================================================================

evaluationRoutes.get('/compare', async (req: Request, res: Response) => {
  try {
    const { versionA, versionB, period } = req.query;

    if (!versionA || !versionB) {
      return res.status(400).json({ error: 'versionA and versionB are required' });
    }

    const result = await evaluationService.compareModels(
      versionA as string,
      versionB as string,
      (period as EvaluationPeriod) || '7d'
    );

    res.json(result);
  } catch (error) {
    console.error('[EvaluationRoutes] Error comparing models:', error);
    res.status(500).json({ error: 'Failed to compare models' });
  }
});

// ============================================================================
// GET /api/evaluation/episodes/:id - Get episode detail
// ============================================================================

evaluationRoutes.get('/episodes/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const episode = await evaluationService.getEpisodeById(id);

    if (!episode) {
      return res.status(404).json({ error: 'Evaluation episode not found' });
    }

    res.json({ episode });
  } catch (error) {
    console.error('[EvaluationRoutes] Error getting episode:', error);
    res.status(500).json({ error: 'Failed to get evaluation episode' });
  }
});

/**
 * @file aggregation.routes.ts
 * @description REST endpoints for secure aggregation of masked federated learning updates.
 * @feature Secure Aggregation
 */

import { Router, type Request, type Response } from 'express';
import { secureAggregator } from '../services/SecureAggregator.js';
import type { MaskedUpdate } from '../services/SecureAggregator.js';

export const aggregationRoutes = Router();

/**
 * POST /api/federated/rounds/:roundId/submit
 * Robot submits a masked gradient update for a given round.
 */
aggregationRoutes.post('/rounds/:roundId/submit', async (req: Request, res: Response) => {
  try {
    const { roundId } = req.params;
    const body = req.body as {
      robotId?: string;
      maskedGradients?: number[][];
      participantCount?: number;
    };

    if (!body.robotId || typeof body.robotId !== 'string') {
      res.status(400).json({ error: 'robotId is required and must be a string' });
      return;
    }

    if (!Array.isArray(body.maskedGradients)) {
      res.status(400).json({ error: 'maskedGradients is required and must be an array' });
      return;
    }

    if (typeof body.participantCount !== 'number' || body.participantCount < 1) {
      res.status(400).json({ error: 'participantCount is required and must be a positive number' });
      return;
    }

    const maskedUpdate: MaskedUpdate = {
      robotId: body.robotId,
      roundId,
      maskedGradients: body.maskedGradients,
      participantCount: body.participantCount,
    };

    secureAggregator.collectUpdate(roundId, body.robotId, maskedUpdate);

    res.status(201).json({
      message: 'Masked update submitted successfully',
      roundId,
      robotId: body.robotId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('already') ? 409 : 500;
    res.status(status).json({ error: `Failed to submit update: ${message}` });
  }
});

/**
 * GET /api/federated/rounds/:roundId/aggregation
 * Get the current aggregation status for a round.
 */
aggregationRoutes.get('/rounds/:roundId/aggregation', async (req: Request, res: Response) => {
  try {
    const { roundId } = req.params;
    const status = secureAggregator.getAggregationStatus(roundId);
    const result = secureAggregator.getResult(roundId);

    res.json({
      ...status,
      result: result ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to get aggregation status: ${message}` });
  }
});

/**
 * POST /api/federated/rounds/:roundId/aggregate
 * Trigger aggregation for a round. Protected — admin only in production.
 */
aggregationRoutes.post('/rounds/:roundId/aggregate', async (req: Request, res: Response) => {
  try {
    const { roundId } = req.params;
    const { expectedParticipants } = req.body as { expectedParticipants?: number };

    if (typeof expectedParticipants !== 'number' || expectedParticipants < 1) {
      res.status(400).json({ error: 'expectedParticipants is required and must be a positive number' });
      return;
    }

    const result = secureAggregator.aggregate(roundId, expectedParticipants);

    res.json({
      message: 'Aggregation completed successfully',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('No updates') ? 400 : 500;
    res.status(status).json({ error: `Failed to aggregate: ${message}` });
  }
});

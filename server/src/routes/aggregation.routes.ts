/**
 * @file aggregation.routes.ts
 * @description REST endpoints for secure aggregation of masked federated learning updates.
 * @feature Secure Aggregation
 */

import { Router, type Request, type Response } from 'express';
import { secureAggregator } from '../services/SecureAggregator.js';
import type { MaskedUpdate } from '../services/SecureAggregator.js';
import { sendFailure } from '../utils/routeErrors.js';

export const aggregationRoutes = Router();

/**
 * POST /api/federated/secure/rounds/:roundId/submit
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
    // "already submitted" is SecureAggregator's own sentence, so that one is
    // echoed; every other failure answers with the fallback, unread.
    if (error instanceof Error && error.message.includes('already')) {
      return res.status(409).json({ error: `Failed to submit update: ${error.message}` });
    }
    sendFailure(res, error, 'Failed to submit update', 500);
  }
});

/**
 * GET /api/federated/secure/rounds/:roundId/aggregation
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
    sendFailure(res, error, 'Failed to get aggregation status', 500);
  }
});

/**
 * POST /api/federated/secure/rounds/:roundId/aggregate
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
    // "No updates ..." is SecureAggregator's own sentence and stays readable.
    if (error instanceof Error && error.message.includes('No updates')) {
      return res.status(400).json({ error: `Failed to aggregate: ${error.message}` });
    }
    sendFailure(res, error, 'Failed to aggregate updates', 500);
  }
});

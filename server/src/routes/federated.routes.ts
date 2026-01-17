/**
 * @file federated.routes.ts
 * @description REST API endpoints for federated learning / fleet learning
 * @feature fleet
 */

import { Router, Request, Response } from 'express';
import { federatedLearningService } from '../services/FederatedLearningService.js';
import type {
  CreateFederatedRoundRequest,
  SelectParticipantsRequest,
  SubmitModelUpdateRequest,
  FederatedRoundStatus,
  SelectionStrategy,
} from '../types/federated.types.js';

export const federatedRoutes = Router();

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

/**
 * POST /api/federated/rounds
 * Create a new federated round
 */
federatedRoutes.post('/rounds', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateFederatedRoundRequest;

    if (!body.globalModelVersion) {
      return res.status(400).json({ error: 'globalModelVersion is required' });
    }

    const round = await federatedLearningService.createRound(body);

    res.status(201).json(round);
  } catch (error) {
    console.error('[FederatedRoutes] Error creating round:', error);
    res.status(500).json({ error: 'Failed to create federated round' });
  }
});

/**
 * GET /api/federated/rounds
 * List federated rounds
 */
federatedRoutes.get('/rounds', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const { rounds, total } = await federatedLearningService.listRounds({
      status: query.status as FederatedRoundStatus | undefined,
      globalModelVersion: query.globalModelVersion,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    res.json({
      rounds,
      total,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    console.error('[FederatedRoutes] Error listing rounds:', error);
    res.status(500).json({ error: 'Failed to list rounds' });
  }
});

/**
 * GET /api/federated/rounds/:id
 * Get a specific round with participants
 */
federatedRoutes.get('/rounds/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const round = await federatedLearningService.getRound(id);
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }

    const participants = await federatedLearningService.getParticipantsForRound(id);

    res.json({
      round,
      participants,
    });
  } catch (error) {
    console.error('[FederatedRoutes] Error getting round:', error);
    res.status(500).json({ error: 'Failed to get round' });
  }
});

// ============================================================================
// PARTICIPANT SELECTION
// ============================================================================

/**
 * POST /api/federated/rounds/:id/select-participants
 * Select participants for a round
 */
federatedRoutes.post(
  '/rounds/:id/select-participants',
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = req.body as SelectParticipantsRequest;

      // Validate strategy if provided
      if (body.strategy) {
        const validStrategies: SelectionStrategy[] = [
          'random',
          'round_robin',
          'performance_based',
          'uncertainty_based',
        ];
        if (!validStrategies.includes(body.strategy)) {
          return res.status(400).json({
            error: `Invalid strategy. Must be one of: ${validStrategies.join(', ')}`,
          });
        }
      }

      const participants = await federatedLearningService.selectParticipants(id, body);

      res.json({
        roundId: id,
        participantCount: participants.length,
        participants,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error selecting participants:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to select participants';
      res.status(400).json({ error: message });
    }
  }
);

// ============================================================================
// MODEL DISTRIBUTION
// ============================================================================

/**
 * POST /api/federated/rounds/:id/distribute
 * Distribute global model to participants
 */
federatedRoutes.post(
  '/rounds/:id/distribute',
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const round = await federatedLearningService.distributeModel(id);

      res.json({
        message: 'Model distributed to participants',
        round,
        status: round.status,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error distributing model:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to distribute model';
      res.status(400).json({ error: message });
    }
  }
);

// ============================================================================
// MODEL UPDATES
// ============================================================================

/**
 * POST /api/federated/rounds/:id/updates
 * Submit a model update from a robot
 */
federatedRoutes.post(
  '/rounds/:id/updates',
  async (req: Request, res: Response) => {
    try {
      const { id: roundId } = req.params;
      const body = req.body as SubmitModelUpdateRequest;

      // Validate required fields
      if (!body.participantId) {
        return res.status(400).json({ error: 'participantId is required' });
      }
      if (!body.robotId) {
        return res.status(400).json({ error: 'robotId is required' });
      }
      if (typeof body.localSamples !== 'number' || body.localSamples < 1) {
        return res.status(400).json({
          error: 'localSamples must be a positive integer',
        });
      }
      if (typeof body.localLoss !== 'number') {
        return res.status(400).json({ error: 'localLoss is required' });
      }
      if (!body.modelDelta) {
        return res.status(400).json({ error: 'modelDelta is required' });
      }
      if (!body.updateHash) {
        return res.status(400).json({ error: 'updateHash is required' });
      }

      const update = await federatedLearningService.submitModelUpdate(body);

      const round = await federatedLearningService.getRound(roundId);

      res.status(201).json({
        update: {
          participantId: update.participantId,
          localSamples: update.localSamples,
          localLoss: update.localLoss,
          uploadedAt: update.uploadedAt,
        },
        roundStatus: round?.status,
        completedParticipants: round?.completedParticipants,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error submitting update:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to submit model update';
      res.status(400).json({ error: message });
    }
  }
);

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * POST /api/federated/rounds/:id/aggregate
 * Trigger aggregation for a round
 */
federatedRoutes.post(
  '/rounds/:id/aggregate',
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const result = await federatedLearningService.aggregateUpdates(id);

      // Finalize the round
      const round = await federatedLearningService.finalizeRound(id);

      res.json({
        message: 'Aggregation completed',
        newModelVersion: round.newModelVersion,
        participantCount: result.participantCount,
        totalSamples: result.totalSamples,
        round,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error aggregating:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to aggregate updates';
      res.status(400).json({ error: message });
    }
  }
);

// ============================================================================
// PARTICIPANT MANAGEMENT
// ============================================================================

/**
 * POST /api/federated/participants/:id/fail
 * Mark a participant as failed
 */
federatedRoutes.post(
  '/participants/:id/fail',
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };

      const participant = await federatedLearningService.markParticipantFailed(
        id,
        reason || 'Unknown reason'
      );

      if (!participant) {
        return res.status(404).json({ error: 'Participant not found' });
      }

      res.json({
        message: 'Participant marked as failed',
        participant,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error marking participant failed:', error);
      res.status(500).json({ error: 'Failed to mark participant as failed' });
    }
  }
);

// ============================================================================
// PRIVACY BUDGET
// ============================================================================

/**
 * GET /api/federated/robots/:id/privacy-budget
 * Get privacy budget for a robot
 */
federatedRoutes.get(
  '/robots/:id/privacy-budget',
  async (req: Request, res: Response) => {
    try {
      const { id: robotId } = req.params;

      const budget = await federatedLearningService.getOrCreatePrivacyBudget(robotId);

      res.json({
        robotId,
        budget,
        canParticipate: budget.remainingEpsilon > 0,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error getting privacy budget:', error);
      res.status(500).json({ error: 'Failed to get privacy budget' });
    }
  }
);

/**
 * GET /api/federated/privacy-budgets
 * List all privacy budgets
 */
federatedRoutes.get('/privacy-budgets', async (_req: Request, res: Response) => {
  try {
    const budgets = await federatedLearningService.listPrivacyBudgets();

    res.json({
      budgets,
      count: budgets.length,
    });
  } catch (error) {
    console.error('[FederatedRoutes] Error listing privacy budgets:', error);
    res.status(500).json({ error: 'Failed to list privacy budgets' });
  }
});

/**
 * POST /api/federated/robots/:id/privacy-budget/reset
 * Reset privacy budget for a robot
 */
federatedRoutes.post(
  '/robots/:id/privacy-budget/reset',
  async (req: Request, res: Response) => {
    try {
      const { id: robotId } = req.params;

      const budget = await federatedLearningService.resetPrivacyBudget(robotId);

      res.json({
        message: 'Privacy budget reset',
        budget,
      });
    } catch (error) {
      console.error('[FederatedRoutes] Error resetting privacy budget:', error);
      res.status(500).json({ error: 'Failed to reset privacy budget' });
    }
  }
);

// ============================================================================
// ROHE METRICS
// ============================================================================

/**
 * GET /api/federated/metrics/rohe
 * Get Return on Human Effort metrics
 */
federatedRoutes.get('/metrics/rohe', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const metrics = await federatedLearningService.computeROHEMetrics({
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      robotId: query.robotId,
      task: query.task,
    });

    res.json(metrics);
  } catch (error) {
    console.error('[FederatedRoutes] Error computing ROHE:', error);
    res.status(500).json({ error: 'Failed to compute ROHE metrics' });
  }
});

/**
 * POST /api/federated/interventions
 * Record a human intervention
 */
federatedRoutes.post('/interventions', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      robotId: string;
      task: string;
      type: 'correction' | 'demonstration' | 'abort';
      confidenceBefore?: number;
      confidenceAfter?: number;
      description?: string;
    };

    if (!body.robotId) {
      return res.status(400).json({ error: 'robotId is required' });
    }
    if (!body.task) {
      return res.status(400).json({ error: 'task is required' });
    }
    if (!body.type) {
      return res.status(400).json({ error: 'type is required' });
    }

    const validTypes = ['correction', 'demonstration', 'abort'];
    if (!validTypes.includes(body.type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const intervention = await federatedLearningService.recordIntervention(
      body.robotId,
      body.task,
      body.type,
      body.confidenceBefore,
      body.confidenceAfter,
      body.description
    );

    res.status(201).json(intervention);
  } catch (error) {
    console.error('[FederatedRoutes] Error recording intervention:', error);
    res.status(500).json({ error: 'Failed to record intervention' });
  }
});

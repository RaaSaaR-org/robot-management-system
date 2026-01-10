/**
 * @file explainability.routes.ts
 * @description REST API routes for AI explainability (EU AI Act Art. 13, Art. 50)
 */

import { Router, type Request, type Response } from 'express';
import { explainabilityService } from '../services/ExplainabilityService.js';
import type { DecisionType } from '../repositories/DecisionRepository.js';

export const explainabilityRoutes = Router();

// ============================================================================
// DECISION ENDPOINTS
// ============================================================================

/**
 * GET /decisions - List AI decisions with pagination and filters
 * Query params:
 *   - page: number (default: 1)
 *   - pageSize: number (default: 50)
 *   - robotId: string (optional) - Filter by robot ID
 *   - decisionType: string (optional) - Filter by decision type
 *   - startDate: string (optional) - ISO date string
 *   - endDate: string (optional) - ISO date string
 */
explainabilityRoutes.get('/decisions', async (req: Request, res: Response) => {
  try {
    const { page, pageSize, robotId, decisionType, startDate, endDate } = req.query;

    const params = {
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : 50,
      robotId: robotId as string | undefined,
      decisionType: decisionType as DecisionType | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    };

    const result = await explainabilityService.listDecisions(params);
    res.json(result);
  } catch (error) {
    console.error('Error fetching decisions:', error);
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

/**
 * GET /decisions/:id - Get a single AI decision by ID
 */
explainabilityRoutes.get('/decisions/:id', async (req: Request, res: Response) => {
  try {
    const decision = await explainabilityService.getDecision(req.params.id);

    if (!decision) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    res.json(decision);
  } catch (error) {
    console.error('Error fetching decision:', error);
    res.status(500).json({ error: 'Failed to fetch decision' });
  }
});

/**
 * GET /decisions/:id/explanation - Get formatted human-readable explanation
 */
explainabilityRoutes.get('/decisions/:id/explanation', async (req: Request, res: Response) => {
  try {
    const explanation = await explainabilityService.getFormattedExplanation(req.params.id);

    if (!explanation) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    res.json(explanation);
  } catch (error) {
    console.error('Error fetching explanation:', error);
    res.status(500).json({ error: 'Failed to fetch explanation' });
  }
});

/**
 * GET /decisions/entity/:entityId - Get decision by entity ID (CommandInterpretation, RobotTask, etc.)
 */
explainabilityRoutes.get('/decisions/entity/:entityId', async (req: Request, res: Response) => {
  try {
    const decision = await explainabilityService.getDecisionByEntityId(req.params.entityId);

    if (!decision) {
      return res.status(404).json({ error: 'Decision not found for entity' });
    }

    res.json(decision);
  } catch (error) {
    console.error('Error fetching decision by entity:', error);
    res.status(500).json({ error: 'Failed to fetch decision' });
  }
});

/**
 * POST /decisions - Store a new AI decision (used by robot-agent)
 * Body:
 *   - decisionType: string (required)
 *   - entityId: string (required)
 *   - robotId: string (required)
 *   - inputFactors: object (required)
 *   - reasoning: string[] (required)
 *   - modelUsed: string (required)
 *   - confidence: number (required)
 *   - alternatives: array (required)
 *   - safetyFactors: object (required)
 */
explainabilityRoutes.post('/decisions', async (req: Request, res: Response) => {
  try {
    const {
      decisionType,
      entityId,
      robotId,
      inputFactors,
      reasoning,
      modelUsed,
      confidence,
      alternatives,
      safetyFactors,
    } = req.body;

    // Validation
    if (!decisionType || !entityId || !robotId || !modelUsed) {
      return res.status(400).json({
        error: 'Missing required fields: decisionType, entityId, robotId, modelUsed',
      });
    }

    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      return res.status(400).json({
        error: 'Invalid confidence: must be a number between 0 and 1',
      });
    }

    const decision = await explainabilityService.storeDecision({
      decisionType,
      entityId,
      robotId,
      inputFactors: inputFactors || {},
      reasoning: reasoning || [],
      modelUsed,
      confidence,
      alternatives: alternatives || [],
      safetyFactors: safetyFactors || { classification: 'safe', warnings: [], constraints: [] },
    });

    res.status(201).json(decision);
  } catch (error) {
    console.error('Error storing decision:', error);
    res.status(500).json({ error: 'Failed to store decision' });
  }
});

/**
 * DELETE /decisions/:id - Delete a decision
 */
explainabilityRoutes.delete('/decisions/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await explainabilityService.deleteDecision(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting decision:', error);
    res.status(500).json({ error: 'Failed to delete decision' });
  }
});

// ============================================================================
// METRICS ENDPOINTS (Art. 13(3)(b))
// ============================================================================

/**
 * GET /metrics - Get AI performance metrics
 * Query params:
 *   - period: 'daily' | 'weekly' | 'monthly' (default: 'weekly')
 *   - robotId: string (optional) - Filter by robot ID
 */
explainabilityRoutes.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { period, robotId } = req.query;

    const validPeriods = ['daily', 'weekly', 'monthly'];
    const periodValue = validPeriods.includes(period as string)
      ? (period as 'daily' | 'weekly' | 'monthly')
      : 'weekly';

    const metrics = await explainabilityService.getPerformanceMetrics(
      periodValue,
      robotId as string | undefined
    );

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// ============================================================================
// DOCUMENTATION ENDPOINTS (Art. 13(3)(a))
// ============================================================================

/**
 * GET /documentation - Get AI system documentation
 */
explainabilityRoutes.get('/documentation', async (_req: Request, res: Response) => {
  try {
    const documentation = explainabilityService.getDocumentation();
    res.json(documentation);
  } catch (error) {
    console.error('Error fetching documentation:', error);
    res.status(500).json({ error: 'Failed to fetch documentation' });
  }
});

// ============================================================================
// LIMITATIONS ENDPOINTS (Art. 13(3)(c))
// ============================================================================

/**
 * GET /limitations - Get AI system limitations
 */
explainabilityRoutes.get('/limitations', async (_req: Request, res: Response) => {
  try {
    const limitations = explainabilityService.getLimitations();
    res.json({ limitations });
  } catch (error) {
    console.error('Error fetching limitations:', error);
    res.status(500).json({ error: 'Failed to fetch limitations' });
  }
});

/**
 * GET /operating-conditions - Get AI operating conditions
 */
explainabilityRoutes.get('/operating-conditions', async (_req: Request, res: Response) => {
  try {
    const conditions = explainabilityService.getOperatingConditions();
    res.json({ conditions });
  } catch (error) {
    console.error('Error fetching operating conditions:', error);
    res.status(500).json({ error: 'Failed to fetch operating conditions' });
  }
});

/**
 * GET /human-oversight - Get human oversight requirements
 */
explainabilityRoutes.get('/human-oversight', async (_req: Request, res: Response) => {
  try {
    const requirements = explainabilityService.getHumanOversightRequirements();
    res.json({ requirements });
  } catch (error) {
    console.error('Error fetching human oversight requirements:', error);
    res.status(500).json({ error: 'Failed to fetch human oversight requirements' });
  }
});

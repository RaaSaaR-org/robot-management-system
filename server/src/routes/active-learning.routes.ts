/**
 * @file active-learning.routes.ts
 * @description REST API endpoints for active learning system
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { activeLearningService } from '../services/ActiveLearningService.js';
import type {
  LogPredictionRequest,
  GetUncertaintyParams,
  GetPrioritiesParams,
  UpdateProgressRequest,
  CreateCollectionTargetRequest,
  CollectionTargetType,
  CollectionTargetStatus,
} from '../types/active-learning.types.js';

export const activeLearningRoutes = Router();

// ============================================================================
// PREDICTION LOGGING
// ============================================================================

/**
 * POST /api/active-learning/predictions
 * Log a prediction with confidence
 */
activeLearningRoutes.post('/predictions', async (req: Request, res: Response) => {
  try {
    const body = req.body as LogPredictionRequest;

    // Validate required fields
    if (!body.modelId || !body.robotId || !body.inputHash) {
      return res.status(400).json({
        error: 'modelId, robotId, and inputHash are required',
      });
    }

    if (!body.taskCategory || !body.environment) {
      return res.status(400).json({
        error: 'taskCategory and environment are required',
      });
    }

    if (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1) {
      return res.status(400).json({
        error: 'confidence must be a number between 0 and 1',
      });
    }

    const log = await activeLearningService.logPrediction(body);

    res.status(201).json({
      id: log.id,
      logged: true,
      timestamp: log.timestamp,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error logging prediction:', error);
    res.status(500).json({ error: 'Failed to log prediction' });
  }
});

/**
 * POST /api/active-learning/predictions/batch
 * Log multiple predictions in batch
 */
activeLearningRoutes.post('/predictions/batch', async (req: Request, res: Response) => {
  try {
    const { predictions } = req.body as { predictions: LogPredictionRequest[] };

    if (!Array.isArray(predictions) || predictions.length === 0) {
      return res.status(400).json({ error: 'predictions array is required' });
    }

    const logs = await activeLearningService.logPredictionsBatch(predictions);

    res.status(201).json({
      logged: logs.length,
      ids: logs.map((l) => l.id),
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error logging predictions batch:', error);
    res.status(500).json({ error: 'Failed to log predictions' });
  }
});

/**
 * GET /api/active-learning/predictions
 * Get prediction logs for a model
 */
activeLearningRoutes.get('/predictions', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    if (!query.modelId) {
      return res.status(400).json({ error: 'modelId query parameter is required' });
    }

    const logs = await activeLearningService.getPredictionLogs(query.modelId, {
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      taskCategory: query.taskCategory,
      environment: query.environment,
      minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : undefined,
      maxConfidence: query.maxConfidence ? parseFloat(query.maxConfidence) : undefined,
    });

    res.json({
      modelId: query.modelId,
      count: logs.length,
      predictions: logs,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting predictions:', error);
    res.status(500).json({ error: 'Failed to get predictions' });
  }
});

// ============================================================================
// UNCERTAINTY ANALYSIS
// ============================================================================

/**
 * GET /api/active-learning/uncertainty/:modelId
 * Get uncertainty analysis for a model
 */
activeLearningRoutes.get('/uncertainty/:modelId', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const query = req.query as Record<string, string | undefined>;
    const windowDays = query.windowDays ? parseInt(query.windowDays, 10) : 7;

    const analysis = await activeLearningService.computeUncertaintyAnalysis(
      modelId,
      windowDays
    );

    res.json(analysis);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting uncertainty:', error);
    res.status(500).json({ error: 'Failed to compute uncertainty analysis' });
  }
});

/**
 * GET /api/active-learning/progress/:modelId
 * Get learning progress for a model
 */
activeLearningRoutes.get('/progress/:modelId', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const query = req.query as Record<string, string | undefined>;
    const task = query.task;

    if (task) {
      const progress = await activeLearningService.computeLearningProgress(modelId, task);
      return res.json(progress);
    }

    // Return plateaued tasks
    const plateaus = await activeLearningService.identifyPlateaus(modelId);

    res.json({
      modelId,
      plateauedTasks: plateaus,
      totalPlateaued: plateaus.length,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting learning progress:', error);
    res.status(500).json({ error: 'Failed to get learning progress' });
  }
});

// ============================================================================
// COLLECTION PRIORITIES
// ============================================================================

/**
 * GET /api/active-learning/priorities
 * Get collection priorities
 */
activeLearningRoutes.get('/priorities', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const modelId = query.modelId;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId query parameter is required' });
    }

    const priorities = await activeLearningService.computeCollectionPriorities(modelId);

    // Apply filters
    let filteredPriorities = priorities.priorities;

    if (query.limit) {
      filteredPriorities = filteredPriorities.slice(0, parseInt(query.limit, 10));
    }

    if (query.minPriorityScore) {
      const minScore = parseFloat(query.minPriorityScore);
      filteredPriorities = filteredPriorities.filter((p) => p.priorityScore >= minScore);
    }

    if (query.targetType) {
      filteredPriorities = filteredPriorities.filter(
        (p) => p.targetType === query.targetType
      );
    }

    res.json({
      ...priorities,
      priorities: filteredPriorities,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting priorities:', error);
    res.status(500).json({ error: 'Failed to get collection priorities' });
  }
});

/**
 * GET /api/active-learning/priorities/:target
 * Get priority details for a specific target
 */
activeLearningRoutes.get('/priorities/:target', async (req: Request, res: Response) => {
  try {
    const { target } = req.params;
    const query = req.query as Record<string, string | undefined>;
    const modelId = query.modelId;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId query parameter is required' });
    }

    const priorities = await activeLearningService.computeCollectionPriorities(modelId);
    const priority = priorities.priorities.find((p) => p.target === target);

    if (!priority) {
      return res.status(404).json({ error: 'Target not found in priorities' });
    }

    res.json(priority);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting priority details:', error);
    res.status(500).json({ error: 'Failed to get priority details' });
  }
});

// ============================================================================
// COLLECTION TARGETS
// ============================================================================

/**
 * POST /api/active-learning/targets
 * Create a collection target
 */
activeLearningRoutes.post('/targets', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateCollectionTargetRequest;

    if (!body.targetType || !body.targetName || !body.estimatedDemos) {
      return res.status(400).json({
        error: 'targetType, targetName, and estimatedDemos are required',
      });
    }

    const validTypes: CollectionTargetType[] = ['task', 'environment', 'task_environment'];
    if (!validTypes.includes(body.targetType)) {
      return res.status(400).json({
        error: `Invalid targetType. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const target = await activeLearningService.createCollectionTarget(
      body.targetType,
      body.targetName,
      body.estimatedDemos,
      body.priorityScore
    );

    res.status(201).json(target);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error creating target:', error);
    res.status(500).json({ error: 'Failed to create collection target' });
  }
});

/**
 * GET /api/active-learning/targets
 * List collection targets
 */
activeLearningRoutes.get('/targets', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const targets = await activeLearningService.listCollectionTargets({
      status: query.status as CollectionTargetStatus | undefined,
      targetType: query.targetType as CollectionTargetType | undefined,
      minPriorityScore: query.minPriorityScore
        ? parseFloat(query.minPriorityScore)
        : undefined,
    });

    res.json({
      count: targets.length,
      targets,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error listing targets:', error);
    res.status(500).json({ error: 'Failed to list collection targets' });
  }
});

/**
 * GET /api/active-learning/targets/:id
 * Get a collection target
 */
activeLearningRoutes.get('/targets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const target = await activeLearningService.getCollectionTarget(id);
    if (!target) {
      return res.status(404).json({ error: 'Collection target not found' });
    }

    res.json(target);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting target:', error);
    res.status(500).json({ error: 'Failed to get collection target' });
  }
});

/**
 * POST /api/active-learning/targets/:id/progress
 * Update collection progress
 */
activeLearningRoutes.post('/targets/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateProgressRequest;

    if (typeof body.demosCollected !== 'number' || body.demosCollected < 0) {
      return res.status(400).json({
        error: 'demosCollected must be a non-negative number',
      });
    }

    const target = await activeLearningService.updateCollectionProgress(
      id,
      body.demosCollected,
      body.uncertaintyAfter
    );

    if (!target) {
      return res.status(404).json({ error: 'Collection target not found' });
    }

    res.json({
      target,
      isCompleted: target.status === 'completed',
      progress: target.collectedDemos / target.estimatedDemos,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error updating progress:', error);
    res.status(500).json({ error: 'Failed to update collection progress' });
  }
});

// ============================================================================
// PROGRESS SUMMARY
// ============================================================================

/**
 * GET /api/active-learning/summary
 * Get progress summary
 */
activeLearningRoutes.get('/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await activeLearningService.getProgressSummary();
    res.json(summary);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting summary:', error);
    res.status(500).json({ error: 'Failed to get progress summary' });
  }
});

// ============================================================================
// DIVERSITY ANALYSIS
// ============================================================================

/**
 * GET /api/active-learning/diversity/:modelId
 * Get diversity analysis for a model
 */
activeLearningRoutes.get('/diversity/:modelId', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;

    const analysis = await activeLearningService.computeDiversityAnalysis(modelId);

    res.json(analysis);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting diversity:', error);
    res.status(500).json({ error: 'Failed to compute diversity analysis' });
  }
});

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * GET /api/active-learning/config
 * Get scoring configuration
 */
activeLearningRoutes.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = activeLearningService.getConfig();
    res.json(config);
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error getting config:', error);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

/**
 * PUT /api/active-learning/config
 * Update scoring configuration
 */
activeLearningRoutes.put('/config', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    const config = activeLearningService.updateConfig(body);

    res.json({
      message: 'Configuration updated',
      config,
    });
  } catch (error) {
    console.error('[ActiveLearningRoutes] Error updating config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

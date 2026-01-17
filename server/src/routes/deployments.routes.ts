/**
 * @file deployments.routes.ts
 * @description REST API endpoints for VLA model deployment management
 * @feature vla
 */

import { Router, Request, Response } from 'express';
import { deploymentService } from '../services/DeploymentService.js';
import { deploymentMetricsService } from '../services/DeploymentMetricsService.js';
import { modelVersionRepository } from '../repositories/index.js';
import type {
  StartDeploymentRequest,
  DeploymentResponse,
  RollbackRequest,
} from '../types/deployment.types.js';
import type { DeploymentStatus, DeploymentStrategy } from '../types/vla.types.js';

export const deploymentsRoutes = Router();

// ============================================================================
// POST /api/deployments - Create new deployment
// ============================================================================

deploymentsRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const request = req.body as StartDeploymentRequest;

    // Validate required fields
    if (!request.modelVersionId) {
      return res.status(400).json({ error: 'modelVersionId is required' });
    }

    const deployment = await deploymentService.createDeployment(request);

    res.status(201).json({
      deployment,
      message: 'Deployment created successfully',
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error creating deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to create deployment';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/deployments - List deployments with filtering
// ============================================================================

deploymentsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Parse query parameters
    const params = {
      modelVersionId: query.modelVersionId,
      page: query.page ? parseInt(query.page, 10) : undefined,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : undefined,
      status: undefined as DeploymentStatus | DeploymentStatus[] | undefined,
      strategy: undefined as DeploymentStrategy | DeploymentStrategy[] | undefined,
    };

    // Parse array parameters
    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as DeploymentStatus[])
        : (query.status as DeploymentStatus);
    }

    if (query.strategy) {
      params.strategy = query.strategy.includes(',')
        ? (query.strategy.split(',') as DeploymentStrategy[])
        : (query.strategy as DeploymentStrategy);
    }

    const result = await deploymentService.listDeployments(params);

    res.json({
      deployments: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error listing deployments:', error);
    const message = error instanceof Error ? error.message : 'Failed to list deployments';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/deployments/active - Get all active deployments
// ============================================================================

deploymentsRoutes.get('/active', async (_req: Request, res: Response) => {
  try {
    const deployments = await deploymentService.getActiveDeployments();

    res.json({
      deployments,
      count: deployments.length,
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error getting active deployments:', error);
    const message = error instanceof Error ? error.message : 'Failed to get active deployments';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/deployments/:id - Get deployment details
// ============================================================================

deploymentsRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment = await deploymentService.getDeployment(id);

    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Get model version
    const modelVersion = await modelVersionRepository.findById(deployment.modelVersionId);

    // Get current stage info
    const stages = deployment.canaryConfig.stages;
    let currentStage = 0;
    for (let i = 0; i < stages.length; i++) {
      if (deployment.trafficPercentage >= stages[i].percentage) {
        currentStage = i + 1;
      }
    }

    // Get metrics if actively monitoring
    const metrics = deploymentMetricsService.getAggregatedMetrics(id);

    // Calculate next stage time (if applicable)
    let nextStageTime: string | undefined;
    const context = deploymentService.getDeploymentContext(id);
    if (context && currentStage < stages.length) {
      const stageDuration = stages[currentStage - 1]?.durationMinutes ?? 0;
      if (stageDuration > 0) {
        const nextTime = new Date(
          context.stageStartTime.getTime() + stageDuration * 60 * 1000
        );
        nextStageTime = nextTime.toISOString();
      }
    }

    const response: DeploymentResponse = {
      deployment,
      modelVersion: modelVersion ?? undefined,
      currentStage,
      totalStages: stages.length,
      metrics: metrics ?? undefined,
      nextStageTime,
      eligibleRobotCount: deployment.deployedRobotIds.length + deployment.failedRobotIds.length,
      deployedCount: deployment.deployedRobotIds.length,
      failedCount: deployment.failedRobotIds.length,
    };

    res.json(response);
  } catch (error) {
    console.error('[DeploymentsRoutes] Error getting deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to get deployment';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/deployments/:id/metrics - Get deployment metrics
// ============================================================================

deploymentsRoutes.get('/:id/metrics', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment = await deploymentService.getDeployment(id);

    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const metrics = deploymentMetricsService.getAggregatedMetrics(id);

    res.json({
      deploymentId: id,
      metrics,
      isMonitoring: deploymentMetricsService.isMonitoring(id),
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error getting metrics:', error);
    const message = error instanceof Error ? error.message : 'Failed to get metrics';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// POST /api/deployments/:id/start - Start canary rollout
// ============================================================================

deploymentsRoutes.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.startCanary(id);

    // Start metrics monitoring
    deploymentMetricsService.startMonitoring(id);

    res.json({
      deployment,
      message: 'Canary deployment started',
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error starting deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to start deployment';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/deployments/:id/progress - Advance to next stage
// ============================================================================

deploymentsRoutes.post('/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.progressToNextStage(id);

    res.json({
      deployment,
      message: 'Progressed to next stage',
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error progressing deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to progress deployment';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/deployments/:id/promote - Promote to production
// ============================================================================

deploymentsRoutes.post('/:id/promote', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.promoteToProduction(id);

    // Stop monitoring (deployment complete)
    deploymentMetricsService.stopMonitoring(id);

    res.json({
      deployment,
      message: 'Deployment promoted to production',
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error promoting deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to promote deployment';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/deployments/:id/rollback - Trigger rollback
// ============================================================================

deploymentsRoutes.post('/:id/rollback', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as RollbackRequest;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required for rollback' });
    }

    const deployment = await deploymentService.rollback(id, reason);

    // Stop monitoring (deployment failed)
    deploymentMetricsService.stopMonitoring(id);

    res.json({
      deployment,
      message: 'Deployment rolled back',
      reason,
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error rolling back deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to rollback deployment';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/deployments/:id/cancel - Cancel deployment
// ============================================================================

deploymentsRoutes.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.cancelDeployment(id);

    // Stop monitoring
    deploymentMetricsService.stopMonitoring(id);

    res.json({
      deployment,
      message: 'Deployment cancelled',
    });
  } catch (error) {
    console.error('[DeploymentsRoutes] Error cancelling deployment:', error);
    const message = error instanceof Error ? error.message : 'Failed to cancel deployment';
    res.status(400).json({ error: message });
  }
});

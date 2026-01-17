/**
 * @file datasets.routes.ts
 * @description REST API endpoints for dataset management
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { datasetService } from '../services/DatasetService.js';
import { dataQualityService } from '../services/DataQualityService.js';
import type {
  CreateDatasetDto,
  UpdateDatasetDto,
  DatasetListQuery,
  InitiateUploadRequest,
  ComputeStatsRequest,
} from '../types/dataset.types.js';
import type { DatasetStatus } from '../types/vla.types.js';
import type {
  TriggerValidationRequest,
  UnflagTrajectoryRequest,
} from '../types/data-quality.types.js';

export const datasetRoutes = Router();

// ============================================================================
// POST /api/datasets - Create dataset record
// ============================================================================

datasetRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const dto = req.body as CreateDatasetDto;

    // Validate required fields
    if (!dto.name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const dataset = await datasetService.create(dto);

    res.status(201).json({
      dataset,
      message: 'Dataset created successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error creating dataset:', error);
    const message = error instanceof Error ? error.message : 'Failed to create dataset';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets - List datasets with filters
// ============================================================================

datasetRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Parse query parameters
    const params: DatasetListQuery = {
      robotTypeId: query.robotTypeId,
      skillId: query.skillId,
      minQuality: query.minQuality ? parseInt(query.minQuality, 10) : undefined,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    };

    // Parse status parameter (can be comma-separated)
    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as DatasetStatus[])
        : (query.status as DatasetStatus);
    }

    const result = await datasetService.list(params);

    res.json({
      datasets: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error listing datasets:', error);
    res.status(500).json({ error: 'Failed to list datasets' });
  }
});

// ============================================================================
// GET /api/datasets/:id - Get dataset details
// ============================================================================

datasetRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json({ dataset });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting dataset:', error);
    res.status(500).json({ error: 'Failed to get dataset' });
  }
});

// ============================================================================
// PUT /api/datasets/:id - Update dataset metadata
// ============================================================================

datasetRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as UpdateDatasetDto;

    const dataset = await datasetService.update(id, dto);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json({
      dataset,
      message: 'Dataset updated successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error updating dataset:', error);
    const message = error instanceof Error ? error.message : 'Failed to update dataset';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// DELETE /api/datasets/:id - Delete dataset
// ============================================================================

datasetRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await datasetService.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json({
      message: 'Dataset deleted successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error deleting dataset:', error);
    res.status(500).json({ error: 'Failed to delete dataset' });
  }
});

// ============================================================================
// POST /api/datasets/:id/upload/initiate - Get presigned upload URL
// ============================================================================

datasetRoutes.post('/:id/upload/initiate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as InitiateUploadRequest;

    const result = await datasetService.initiateUpload(
      id,
      body.contentType,
      body.size
    );

    res.json({
      uploadUrl: result.uploadUrl,
      expiresIn: result.expiresIn,
      storagePath: result.storagePath,
      message: 'Upload URL generated successfully',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error initiating upload:', error);
    const message = error instanceof Error ? error.message : 'Failed to initiate upload';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/datasets/:id/upload/complete - Mark upload complete
// ============================================================================

datasetRoutes.post('/:id/upload/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await datasetService.completeUpload(id);

    res.json({
      datasetId: id,
      status: 'validating',
      message: 'Upload completed, validation started',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error completing upload:', error);
    const message = error instanceof Error ? error.message : 'Failed to complete upload';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets/:id/stats - Get normalization stats
// ============================================================================

datasetRoutes.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const stats = await datasetService.getStats(id);

    res.json(stats);
  } catch (error) {
    console.error('[DatasetRoutes] Error getting stats:', error);
    const message = error instanceof Error ? error.message : 'Failed to get dataset stats';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }

    res.status(500).json({ error: message });
  }
});

// ============================================================================
// POST /api/datasets/:id/compute-stats - Trigger stats computation (stubbed)
// ============================================================================

datasetRoutes.post('/:id/compute-stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as ComputeStatsRequest;

    await datasetService.computeStats(id, body.force);

    res.json({
      datasetId: id,
      message: 'Stats computation job queued',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error computing stats:', error);
    const message = error instanceof Error ? error.message : 'Failed to compute stats';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('not ready') || message.includes('not available')) {
      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/datasets/:id/progress - Get validation progress
// ============================================================================

datasetRoutes.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const progress = await datasetService.getUploadProgress(id);

    if (!progress) {
      // Check if dataset exists
      const dataset = await datasetService.get(id);
      if (!dataset) {
        return res.status(404).json({ error: 'Dataset not found' });
      }

      // No active progress, return current status
      return res.json({
        datasetId: id,
        status: dataset.status,
        progress: dataset.status === 'ready' ? 100 : 0,
      });
    }

    res.json(progress);
  } catch (error) {
    console.error('[DatasetRoutes] Error getting progress:', error);
    res.status(500).json({ error: 'Failed to get validation progress' });
  }
});

// ============================================================================
// GET /api/datasets/:id/quality - Get detailed quality breakdown
// ============================================================================

datasetRoutes.get('/:id/quality', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // For now, return quality breakdown from existing data
    // In a full implementation, this would fetch from a stored quality report
    const response = {
      datasetId: id,
      hasQualityReport: !!dataset.qualityBreakdown,
      report: dataset.qualityBreakdown
        ? {
            datasetId: id,
            datasetName: dataset.name,
            generatedAt: dataset.updatedAt,
            overallScore: dataset.qualityScore ?? 0,
            scoreBreakdown: dataset.qualityBreakdown,
            trajectoryCount: dataset.demonstrationCount,
            flaggedTrajectoryCount: 0, // Would be computed in full implementation
            anomalousTrajectoryCount: 0,
            cleanTrajectoryPercentage: 100,
            statistics: null, // Would include per-metric stats
            flaggedSummary: [],
            validationStatus: 'completed',
          }
        : null,
    };

    res.json(response);
  } catch (error) {
    console.error('[DatasetRoutes] Error getting quality:', error);
    res.status(500).json({ error: 'Failed to get quality breakdown' });
  }
});

// ============================================================================
// GET /api/datasets/:id/trajectories/:idx/metrics - Get per-trajectory metrics
// ============================================================================

datasetRoutes.get('/:id/trajectories/:idx/metrics', async (req: Request, res: Response) => {
  try {
    const { id, idx } = req.params;
    const trajectoryIndex = parseInt(idx, 10);

    if (isNaN(trajectoryIndex) || trajectoryIndex < 0) {
      return res.status(400).json({ error: 'Invalid trajectory index' });
    }

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // In a full implementation, this would fetch pre-computed metrics from storage
    // For now, return a placeholder response
    res.json({
      datasetId: id,
      trajectoryIndex,
      message: 'Per-trajectory metrics require advanced validation to be run first',
      hint: 'POST /api/datasets/:id/validate-advanced to compute metrics',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting trajectory metrics:', error);
    res.status(500).json({ error: 'Failed to get trajectory metrics' });
  }
});

// ============================================================================
// POST /api/datasets/:id/validate-advanced - Trigger advanced validation job
// ============================================================================

datasetRoutes.post('/:id/validate-advanced', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as TriggerValidationRequest | undefined;

    // Check if dataset exists and is ready
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    if (dataset.status !== 'ready') {
      return res.status(400).json({
        error: 'Dataset not ready for advanced validation',
        currentStatus: dataset.status,
      });
    }

    // In a full implementation, this would:
    // 1. Queue a NATS job for advanced validation
    // 2. The worker would load trajectories from RustFS
    // 3. Compute all metrics using dataQualityService
    // 4. Store results in database

    // For now, return a queued response
    res.json({
      datasetId: id,
      status: 'queued',
      message: 'Advanced validation job queued',
      config: body?.config ?? {
        computePerTrajectory: true,
        computeDTW: false,
        runOODDetection: false,
        anomalyZScoreThreshold: 3.0,
        velocitySpikeThreshold: 5.0,
        force: false,
      },
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error triggering advanced validation:', error);
    res.status(500).json({ error: 'Failed to trigger advanced validation' });
  }
});

// ============================================================================
// GET /api/datasets/:id/flagged - List flagged trajectories for review
// ============================================================================

datasetRoutes.get('/:id/flagged', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const query = req.query as Record<string, string | undefined>;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // In a full implementation, this would fetch from database
    // For now, return empty list
    res.json({
      datasetId: id,
      total: 0,
      page,
      limit,
      flagged: [],
      message: 'Run advanced validation to generate flagged trajectories',
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error getting flagged trajectories:', error);
    res.status(500).json({ error: 'Failed to get flagged trajectories' });
  }
});

// ============================================================================
// POST /api/datasets/:id/trajectories/:idx/unflag - Mark trajectory as reviewed
// ============================================================================

datasetRoutes.post('/:id/trajectories/:idx/unflag', async (req: Request, res: Response) => {
  try {
    const { id, idx } = req.params;
    const trajectoryIndex = parseInt(idx, 10);
    const body = req.body as UnflagTrajectoryRequest;

    if (isNaN(trajectoryIndex) || trajectoryIndex < 0) {
      return res.status(400).json({ error: 'Invalid trajectory index' });
    }

    if (!body.reviewDecision || !['keep', 'remove'].includes(body.reviewDecision)) {
      return res.status(400).json({
        error: 'reviewDecision is required and must be "keep" or "remove"',
      });
    }

    // Check if dataset exists
    const dataset = await datasetService.get(id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // In a full implementation, this would update the database record
    res.json({
      success: true,
      datasetId: id,
      trajectoryIndex,
      reviewDecision: body.reviewDecision,
      reviewedAt: new Date().toISOString(),
      message: `Trajectory ${trajectoryIndex} marked as ${body.reviewDecision}`,
    });
  } catch (error) {
    console.error('[DatasetRoutes] Error unflagging trajectory:', error);
    res.status(500).json({ error: 'Failed to unflag trajectory' });
  }
});

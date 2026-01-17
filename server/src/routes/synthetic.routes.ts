/**
 * @file synthetic.routes.ts
 * @description REST API endpoints for synthetic data generation (Isaac Lab)
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { syntheticDataService } from '../services/SyntheticDataService.js';
import type {
  CreateSyntheticJobRequest,
  ValidateSimToRealRequest,
  SyntheticJobStatus,
  IsaacLabTask,
} from '../types/synthetic.types.js';

export const syntheticRoutes = Router();

// ============================================================================
// JOB MANAGEMENT
// ============================================================================

/**
 * POST /api/synthetic/jobs
 * Submit a synthetic data generation job
 */
syntheticRoutes.post('/jobs', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateSyntheticJobRequest;

    // Validate required fields
    if (!body.task) {
      return res.status(400).json({ error: 'task is required' });
    }

    if (!body.embodiment) {
      return res.status(400).json({ error: 'embodiment is required' });
    }

    if (!body.trajectoryCount || body.trajectoryCount < 1) {
      return res.status(400).json({
        error: 'trajectoryCount must be a positive integer',
      });
    }

    // Validate task type
    const validTasks: IsaacLabTask[] = [
      'pick_place',
      'push',
      'stack',
      'pour',
      'open_drawer',
      'close_drawer',
      'turn_knob',
      'press_button',
      'insert_peg',
      'wipe_surface',
      'custom',
    ];

    if (!validTasks.includes(body.task)) {
      return res.status(400).json({
        error: `Invalid task. Must be one of: ${validTasks.join(', ')}`,
      });
    }

    const job = await syntheticDataService.submitJob(body);

    // Estimate duration based on trajectory count and parallel envs
    const numEnvs = body.simulation?.numEnvs || 16;
    const estimatedDuration = Math.ceil(
      (body.trajectoryCount / numEnvs) * 30
    ); // ~30 seconds per batch

    res.status(201).json({
      job,
      estimatedDuration,
      queuePosition: 0, // Would be computed from actual queue
    });
  } catch (error) {
    console.error('[SyntheticRoutes] Error submitting job:', error);
    res.status(500).json({ error: 'Failed to submit synthetic generation job' });
  }
});

/**
 * GET /api/synthetic/jobs
 * List synthetic generation jobs
 */
syntheticRoutes.get('/jobs', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const { jobs, total } = await syntheticDataService.listJobs({
      status: query.status as SyntheticJobStatus | undefined,
      task: query.task as IsaacLabTask | undefined,
      embodiment: query.embodiment,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    res.json({
      jobs,
      total,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    console.error('[SyntheticRoutes] Error listing jobs:', error);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

/**
 * GET /api/synthetic/jobs/:id
 * Get a specific job
 */
syntheticRoutes.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await syntheticDataService.getJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('[SyntheticRoutes] Error getting job:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

/**
 * POST /api/synthetic/jobs/:id/cancel
 * Cancel a running job
 */
syntheticRoutes.post('/jobs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await syntheticDataService.cancelJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      message: 'Job cancelled',
      job,
    });
  } catch (error) {
    console.error('[SyntheticRoutes] Error cancelling job:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// ============================================================================
// DOMAIN RANDOMIZATION PRESETS
// ============================================================================

/**
 * GET /api/synthetic/templates
 * Get domain randomization presets
 */
syntheticRoutes.get('/templates', async (_req: Request, res: Response) => {
  try {
    const presets = syntheticDataService.getDRPresets();

    res.json({
      presets,
      count: presets.length,
    });
  } catch (error) {
    console.error('[SyntheticRoutes] Error getting templates:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

/**
 * GET /api/synthetic/templates/:id
 * Get a specific DR preset
 */
syntheticRoutes.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const preset = syntheticDataService.getDRPreset(id);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    res.json(preset);
  } catch (error) {
    console.error('[SyntheticRoutes] Error getting preset:', error);
    res.status(500).json({ error: 'Failed to get preset' });
  }
});

/**
 * GET /api/synthetic/templates/recommended/:task
 * Get recommended DR preset for a task
 */
syntheticRoutes.get(
  '/templates/recommended/:task',
  async (req: Request, res: Response) => {
    try {
      const { task } = req.params;

      const preset = syntheticDataService.getRecommendedPreset(
        task as IsaacLabTask
      );

      res.json(preset);
    } catch (error) {
      console.error('[SyntheticRoutes] Error getting recommended preset:', error);
      res.status(500).json({ error: 'Failed to get recommended preset' });
    }
  }
);

// ============================================================================
// SIM-TO-REAL VALIDATION
// ============================================================================

/**
 * POST /api/synthetic/validate-sim-to-real
 * Record sim-to-real validation result
 */
syntheticRoutes.post(
  '/validate-sim-to-real',
  async (req: Request, res: Response) => {
    try {
      const body = req.body as ValidateSimToRealRequest;

      // Validate required fields
      if (!body.syntheticJobId) {
        return res.status(400).json({ error: 'syntheticJobId is required' });
      }

      if (!body.modelVersionId) {
        return res.status(400).json({ error: 'modelVersionId is required' });
      }

      if (
        typeof body.simSuccessRate !== 'number' ||
        body.simSuccessRate < 0 ||
        body.simSuccessRate > 1
      ) {
        return res.status(400).json({
          error: 'simSuccessRate must be a number between 0 and 1',
        });
      }

      if (
        typeof body.realSuccessRate !== 'number' ||
        body.realSuccessRate < 0 ||
        body.realSuccessRate > 1
      ) {
        return res.status(400).json({
          error: 'realSuccessRate must be a number between 0 and 1',
        });
      }

      if (!body.realTestCount || body.realTestCount < 1) {
        return res.status(400).json({
          error: 'realTestCount must be a positive integer',
        });
      }

      if (!Array.isArray(body.taskCategories) || body.taskCategories.length === 0) {
        return res.status(400).json({
          error: 'taskCategories must be a non-empty array',
        });
      }

      // Verify job exists
      const job = await syntheticDataService.getJob(body.syntheticJobId);
      if (!job) {
        return res.status(404).json({ error: 'Synthetic job not found' });
      }

      const validation = await syntheticDataService.recordSimToRealValidation(body);

      res.status(201).json({
        validation,
        interpretation: interpretDomainGap(validation.domainGapScore),
      });
    } catch (error) {
      console.error('[SyntheticRoutes] Error recording validation:', error);
      res.status(500).json({ error: 'Failed to record validation' });
    }
  }
);

/**
 * GET /api/synthetic/validations
 * List sim-to-real validations
 */
syntheticRoutes.get('/validations', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const validations = await syntheticDataService.listValidations({
      modelVersionId: query.modelVersionId,
      minRealSuccessRate: query.minRealSuccessRate
        ? parseFloat(query.minRealSuccessRate)
        : undefined,
      maxDomainGap: query.maxDomainGap
        ? parseFloat(query.maxDomainGap)
        : undefined,
    });

    res.json({
      validations,
      count: validations.length,
    });
  } catch (error) {
    console.error('[SyntheticRoutes] Error listing validations:', error);
    res.status(500).json({ error: 'Failed to list validations' });
  }
});

/**
 * GET /api/synthetic/validations/:id
 * Get a specific validation
 */
syntheticRoutes.get('/validations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const validation = await syntheticDataService.getValidation(id);
    if (!validation) {
      return res.status(404).json({ error: 'Validation not found' });
    }

    res.json({
      validation,
      interpretation: interpretDomainGap(validation.domainGapScore),
    });
  } catch (error) {
    console.error('[SyntheticRoutes] Error getting validation:', error);
    res.status(500).json({ error: 'Failed to get validation' });
  }
});

/**
 * GET /api/synthetic/jobs/:id/validations
 * Get validations for a specific job
 */
syntheticRoutes.get(
  '/jobs/:id/validations',
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const validations = await syntheticDataService.getValidationsForJob(id);

      res.json({
        syntheticJobId: id,
        validations,
        count: validations.length,
      });
    } catch (error) {
      console.error('[SyntheticRoutes] Error getting job validations:', error);
      res.status(500).json({ error: 'Failed to get job validations' });
    }
  }
);

// ============================================================================
// SERVICE STATUS
// ============================================================================

/**
 * GET /api/synthetic/status
 * Get Isaac Lab service status
 */
syntheticRoutes.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await syntheticDataService.checkIsaacLabStatus();

    res.json(status);
  } catch (error) {
    console.error('[SyntheticRoutes] Error checking status:', error);
    res.status(500).json({ error: 'Failed to check service status' });
  }
});

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * GET /api/synthetic/statistics
 * Get job statistics
 */
syntheticRoutes.get('/statistics', async (_req: Request, res: Response) => {
  try {
    const stats = await syntheticDataService.getJobStatistics();

    res.json(stats);
  } catch (error) {
    console.error('[SyntheticRoutes] Error getting statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Interpret domain gap score
 */
function interpretDomainGap(score: number): {
  level: 'excellent' | 'good' | 'moderate' | 'poor';
  message: string;
  recommendation: string;
} {
  if (score < 0.1) {
    return {
      level: 'excellent',
      message: 'Excellent sim-to-real transfer',
      recommendation:
        'Synthetic data is highly effective. Consider increasing synthetic data volume.',
    };
  } else if (score < 0.2) {
    return {
      level: 'good',
      message: 'Good sim-to-real transfer',
      recommendation:
        'Synthetic data is useful. Fine-tune domain randomization for specific failure cases.',
    };
  } else if (score < 0.35) {
    return {
      level: 'moderate',
      message: 'Moderate domain gap detected',
      recommendation:
        'Consider adjusting domain randomization parameters or collecting more real data for challenging scenarios.',
    };
  } else {
    return {
      level: 'poor',
      message: 'Significant domain gap',
      recommendation:
        'Review domain randomization settings. The current synthetic data may not transfer well. Consider more aggressive randomization or real data collection.',
    };
  }
}

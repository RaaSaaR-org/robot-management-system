/**
 * @file isaac-lab.routes.ts
 * @description REST API routes for Isaac Lab synthetic data generation jobs
 * @feature simulation
 */

import { Router, type Request, type Response } from 'express';
import { isaacLabClient } from '../services/IsaacLabClient.js';
import type { IsaacLabJobConfig, IsaacLabJobFilter } from '../services/IsaacLabClient.js';
import { sendFailure } from '../utils/routeErrors.js';

export const isaacLabRoutes = Router();

// IsaacLabClient's own sentences (IsaacLabClient.ts:449, :464, :483, :487),
// matched by their shape rather than by substring. Prisma's P2025 message also
// ends in "not found", and echoing that would put the failing query and the
// absolute server path in the response.
const JOB_NOT_FOUND = /^Job '[^']*' not found$/;
const JOB_NOT_COMPLETED = /^Job '[^']*' is not completed/;

// ============================================================================
// JOB ROUTES
// ============================================================================

/**
 * POST /api/isaac-lab/jobs — Submit a new Isaac Lab job
 */
isaacLabRoutes.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { datasetId, config } = req.body as { datasetId?: string; config?: IsaacLabJobConfig };

    if (!datasetId) {
      return res.status(400).json({ error: 'datasetId is required' });
    }
    if (!config) {
      return res.status(400).json({ error: 'config is required' });
    }
    if (!config.sceneType) {
      return res.status(400).json({ error: 'config.sceneType is required' });
    }
    if (!config.modalities || !Array.isArray(config.modalities) || config.modalities.length === 0) {
      return res.status(400).json({ error: 'config.modalities must be a non-empty array' });
    }

    const job = await isaacLabClient.submitJob(datasetId, config);
    res.status(201).json(job);
  } catch (error) {
    console.error('[isaac-lab.routes] submitJob error:', error);
    // The circuit-breaker sentence is the client's own and names when the
    // next attempt is due, so it stays readable.
    if (error instanceof Error && error.message.includes('Circuit breaker')) {
      return res.status(503).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to submit Isaac Lab job', 500);
  }
});

/**
 * GET /api/isaac-lab/jobs — List jobs with optional filters
 */
isaacLabRoutes.get('/jobs', async (req: Request, res: Response) => {
  try {
    const filter: IsaacLabJobFilter = {};

    if (req.query.status) {
      filter.status = req.query.status as IsaacLabJob['status'];
    }
    if (req.query.datasetId) {
      filter.datasetId = req.query.datasetId as string;
    }

    const jobs = await isaacLabClient.listJobs(filter);
    res.json(jobs);
  } catch (error) {
    console.error('[isaac-lab.routes] listJobs error:', error);
    sendFailure(res, error, 'Failed to list Isaac Lab jobs', 500);
  }
});

/**
 * GET /api/isaac-lab/jobs/:id — Get job status and progress
 */
isaacLabRoutes.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await isaacLabClient.getJobStatus(req.params.id);
    res.json(job);
  } catch (error) {
    console.error('[isaac-lab.routes] getJobStatus error:', error);
    if (error instanceof Error && JOB_NOT_FOUND.test(error.message)) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to get job status', 500);
  }
});

/**
 * DELETE /api/isaac-lab/jobs/:id — Cancel a job
 */
isaacLabRoutes.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await isaacLabClient.cancelJob(req.params.id);
    res.json(job);
  } catch (error) {
    console.error('[isaac-lab.routes] cancelJob error:', error);
    if (error instanceof Error && JOB_NOT_FOUND.test(error.message)) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to cancel job', 500);
  }
});

/**
 * GET /api/isaac-lab/jobs/:id/output — Get output URL for completed job
 */
isaacLabRoutes.get('/jobs/:id/output', async (req: Request, res: Response) => {
  try {
    const output = await isaacLabClient.getJobOutput(req.params.id);
    res.json(output);
  } catch (error) {
    console.error('[isaac-lab.routes] getJobOutput error:', error);
    if (error instanceof Error && JOB_NOT_FOUND.test(error.message)) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof Error && JOB_NOT_COMPLETED.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to get job output', 500);
  }
});

// ============================================================================
// HEALTH ROUTES
// ============================================================================

/**
 * GET /api/isaac-lab/health — Health check + circuit breaker state
 */
isaacLabRoutes.get('/health', async (_req: Request, res: Response) => {
  try {
    const [health, circuitBreaker] = await Promise.all([
      isaacLabClient.healthCheck(),
      Promise.resolve(isaacLabClient.getCircuitBreakerState()),
    ]);

    res.json({
      ...health,
      circuitBreaker,
      mockMode: isaacLabClient.isMockMode(),
      // Honesty label (TASK-184 Phase 3): 'real' only when ISAAC_LAB_URL is configured
      backend: isaacLabClient.isMockMode() ? 'mock' : 'real',
    });
  } catch (error) {
    console.error('[isaac-lab.routes] healthCheck error:', error);
    sendFailure(res, error, 'Failed to check Isaac Lab health', 500);
  }
});

// Type import for filter usage
import type { IsaacLabJob } from '../services/IsaacLabClient.js';

/**
 * @file isaac-lab.routes.ts
 * @description REST API routes for Isaac Lab synthetic data generation jobs
 * @feature simulation
 */

import { Router, type Request, type Response } from 'express';
import { isaacLabClient } from '../services/IsaacLabClient.js';
import type { IsaacLabJobConfig, IsaacLabJobFilter } from '../services/IsaacLabClient.js';

export const isaacLabRoutes = Router();

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
    if (error instanceof Error && error.message.includes('Circuit breaker')) {
      return res.status(503).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to submit Isaac Lab job' });
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
    res.status(500).json({ error: 'Failed to list Isaac Lab jobs' });
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
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to get job status' });
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
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to cancel job' });
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
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof Error && error.message.includes('not completed')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to get job output' });
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
    });
  } catch (error) {
    console.error('[isaac-lab.routes] healthCheck error:', error);
    res.status(500).json({ error: 'Failed to check Isaac Lab health' });
  }
});

// Type import for filter usage
import type { IsaacLabJob } from '../services/IsaacLabClient.js';

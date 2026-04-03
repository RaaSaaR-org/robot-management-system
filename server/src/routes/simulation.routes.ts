/**
 * @file simulation.routes.ts
 * @description REST API routes for simulation job management
 * @feature simulation
 */

import { Router, type Request, type Response } from 'express';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import { simulationService } from '../services/SimulationService.js';

export const simulationRoutes = Router();

// ============================================================================
// POST /api/simulation/jobs — Submit a new simulation job
// ============================================================================

simulationRoutes.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { modelId, environment, rolloutCount, backend } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }
    if (!environment) {
      return res.status(400).json({ error: 'environment is required' });
    }
    if (!rolloutCount || typeof rolloutCount !== 'number') {
      return res.status(400).json({ error: 'rolloutCount is required and must be a number' });
    }
    if (!backend) {
      return res.status(400).json({ error: 'backend is required' });
    }

    const job = simulationService.submitJob(modelId, environment, rolloutCount, backend);

    res.status(201).json({
      job,
      message: 'Simulation job submitted successfully',
    });
  } catch (error) {
    console.error('[SimulationRoutes] Error submitting job:', error);
    const message = error instanceof Error ? error.message : 'Failed to submit simulation job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/simulation/jobs — List all simulation jobs
// ============================================================================

simulationRoutes.get('/jobs', async (req: Request, res: Response) => {
  try {
    const filter: { modelId?: string; environment?: string; status?: 'queued' | 'running' | 'completed' | 'failed' } = {};

    if (req.query.modelId) {
      filter.modelId = req.query.modelId as string;
    }
    if (req.query.environment) {
      filter.environment = req.query.environment as string;
    }
    if (req.query.status) {
      filter.status = req.query.status as 'queued' | 'running' | 'completed' | 'failed';
    }

    const jobs = simulationService.listJobs(filter);

    res.json({ jobs });
  } catch (error) {
    console.error('[SimulationRoutes] Error listing jobs:', error);
    const message = error instanceof Error ? error.message : 'Failed to list simulation jobs';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/simulation/jobs/:id — Get a specific simulation job
// ============================================================================

simulationRoutes.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = simulationService.getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ error: 'Simulation job not found' });
    }

    res.json({ job });
  } catch (error) {
    console.error('[SimulationRoutes] Error getting job:', error);
    const message = error instanceof Error ? error.message : 'Failed to get simulation job';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// DELETE /api/simulation/jobs/:id — Cancel a simulation job
// ============================================================================

simulationRoutes.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = simulationService.cancelJob(req.params.id);

    res.json({
      job,
      message: 'Simulation job cancelled',
    });
  } catch (error) {
    console.error('[SimulationRoutes] Error cancelling job:', error);
    const message = error instanceof Error ? error.message : 'Failed to cancel simulation job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/simulation/environments — List available simulation environments
// ============================================================================

simulationRoutes.get('/environments', async (_req: Request, res: Response) => {
  try {
    const environments = simulationService.getAvailableEnvironments();

    res.json({ environments });
  } catch (error) {
    console.error('[SimulationRoutes] Error listing environments:', error);
    const message = error instanceof Error ? error.message : 'Failed to list environments';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/simulation/comparison/:modelId — Sim-to-real comparison
// ============================================================================

simulationRoutes.get('/comparison/:modelId', async (req: Request, res: Response) => {
  try {
    const comparisons = simulationService.getSimToRealComparison(req.params.modelId);

    res.json({ comparisons });
  } catch (error) {
    console.error('[SimulationRoutes] Error getting comparison:', error);
    const message = error instanceof Error ? error.message : 'Failed to get sim-to-real comparison';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/simulation/jobs/:id/frames/:filename — Serve a captured frame image
// ============================================================================

simulationRoutes.get('/jobs/:id/frames/:filename', async (req: Request, res: Response) => {
  try {
    const framesDir = simulationService.getFramesDir(req.params.id);
    if (!framesDir) {
      return res.status(404).json({ error: 'No frames available for this job' });
    }

    const filename = path.basename(req.params.filename); // Prevent path traversal
    const framePath = path.join(framesDir, filename);

    if (!existsSync(framePath)) {
      return res.status(404).json({ error: 'Frame not found' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(framePath).pipe(res);
  } catch (error) {
    console.error('[SimulationRoutes] Error serving frame:', error);
    res.status(500).json({ error: 'Failed to serve frame' });
  }
});

// ============================================================================
// GET /api/simulation/preview/:environment — Serve environment preview image
// ============================================================================

simulationRoutes.get('/preview/:environment', async (req: Request, res: Response) => {
  try {
    const previewPath = await simulationService.getEnvironmentPreview(req.params.environment);

    if (!previewPath) {
      return res.status(404).json({ error: 'Preview not available' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(previewPath).pipe(res);
  } catch (error) {
    console.error('[SimulationRoutes] Error serving preview:', error);
    res.status(500).json({ error: 'Failed to serve preview' });
  }
});

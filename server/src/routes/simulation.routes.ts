/**
 * @file simulation.routes.ts
 * @description REST API routes for simulation job management
 * @feature simulation
 */

import { Router, type Request, type Response } from 'express';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import { simulationService } from '../services/SimulationService.js';
import { simToRealValidationService } from '../services/SimToRealValidationService.js';
import { modelVersionRepository } from '../repositories/index.js';

export const simulationRoutes = Router();

// ============================================================================
// POST /api/simulation/jobs — Submit a new simulation job
// ============================================================================

simulationRoutes.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { modelId, environment, sceneId, rolloutCount, backend } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }
    if (!rolloutCount || typeof rolloutCount !== 'number') {
      return res.status(400).json({ error: 'rolloutCount is required and must be a number' });
    }

    // Scene-registry path (TASK-171): backend + embodiment + scene file are
    // resolved from the SimScene. Legacy path still accepts environment+backend.
    let job;
    if (sceneId) {
      job = await simulationService.submitJobForScene(modelId, sceneId, rolloutCount);
    } else {
      if (!environment) {
        return res.status(400).json({ error: 'environment or sceneId is required' });
      }
      if (!backend) {
        return res.status(400).json({ error: 'backend is required' });
      }
      job = simulationService.submitJob(modelId, environment, rolloutCount, backend);
    }

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
// GET /api/simulation/scenes — Registered scenes (built-ins + ready twins)
// ============================================================================

simulationRoutes.get('/scenes', async (_req: Request, res: Response) => {
  try {
    const scenes = await simulationService.getAvailableScenes();
    res.json({ scenes });
  } catch (error) {
    console.error('[SimulationRoutes] Error listing scenes:', error);
    const message = error instanceof Error ? error.message : 'Failed to list scenes';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// POST /api/simulation/scenes/generate — build/refresh a twin's MuJoCo scene
// from its real occupancy floor-plan + zones (works for any ready twin).
// ============================================================================

simulationRoutes.post('/scenes/generate', async (req: Request, res: Response) => {
  try {
    const { twinId } = req.body ?? {};
    if (!twinId || typeof twinId !== 'string') {
      return res.status(400).json({ error: 'twinId is required' });
    }
    const scene = await simulationService.generateSceneFromTwin(twinId);
    res.status(201).json({ scene });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate scene';
    console.error('[SimulationRoutes] Error generating scene:', error);
    const status = /Unknown twin|no usable bounds/.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// ============================================================================
// GET /api/simulation/comparison/:modelId — Sim-to-real comparison
// ============================================================================

simulationRoutes.get('/comparison/:modelId', async (req: Request, res: Response) => {
  try {
    const comparisons = await simulationService.getSimToRealComparison(req.params.modelId);

    res.json({ comparisons });
  } catch (error) {
    console.error('[SimulationRoutes] Error getting comparison:', error);
    const message = error instanceof Error ? error.message : 'Failed to get sim-to-real comparison';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Sim-to-Real validations (TASK-171 Phase 3)
// ============================================================================

// POST /api/simulation/validations — record a measured sim-to-real gap. The
// real success rate is derived from real-hardware EvaluationEpisodes when not
// supplied explicitly.
simulationRoutes.post('/validations', async (req: Request, res: Response) => {
  try {
    const {
      modelVersionId,
      modelVersion,
      twinId,
      simSceneId,
      embodimentTag,
      simSuccessRate,
      simOnly,
      realSuccessRate,
      realTestCount,
      realRobotId,
      period,
      taskCategories,
      notes,
    } = req.body;

    if (!modelVersionId) {
      return res.status(400).json({ error: 'modelVersionId is required' });
    }
    if (typeof simSuccessRate !== 'number') {
      return res.status(400).json({ error: 'simSuccessRate (0–1) is required and must be a number' });
    }

    // Sim-only gate (TASK-172.C): an `rl_policy` has no real-hardware
    // counterpart, so its validation must store a null gap and let the deploy
    // gate fall back to an absolute simSuccessRate threshold. Honour an explicit
    // `simOnly`, else auto-derive it from the model type so a caller that forgets
    // the flag does not get a bogus realSuccessRate=0 → domainGap=simSuccessRate.
    let resolvedSimOnly = simOnly;
    if (resolvedSimOnly === undefined) {
      const mv = await modelVersionRepository.findById(modelVersionId).catch(() => null);
      resolvedSimOnly = mv?.modelType === 'rl_policy';
    }

    const validation = await simToRealValidationService.createValidation({
      modelVersionId,
      modelVersion,
      twinId,
      simSceneId,
      embodimentTag,
      simSuccessRate,
      simOnly: resolvedSimOnly,
      realSuccessRate,
      realTestCount,
      realRobotId,
      period,
      taskCategories,
      notes,
    });

    res.status(201).json({ validation, message: 'Sim-to-real validation recorded' });
  } catch (error) {
    console.error('[SimulationRoutes] Error creating validation:', error);
    const message = error instanceof Error ? error.message : 'Failed to record validation';
    res.status(400).json({ error: message });
  }
});

// GET /api/simulation/validations/:modelVersionId — list validations for a model
simulationRoutes.get('/validations/:modelVersionId', async (req: Request, res: Response) => {
  try {
    const validations = await simToRealValidationService.listForModelVersion(
      req.params.modelVersionId,
    );
    res.json({ validations });
  } catch (error) {
    console.error('[SimulationRoutes] Error listing validations:', error);
    const message = error instanceof Error ? error.message : 'Failed to list validations';
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

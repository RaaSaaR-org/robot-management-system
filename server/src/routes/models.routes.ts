/**
 * @file models.routes.ts
 * @description API routes for MLflow model registry integration
 * @feature vla-training
 */

import { Router, Request, Response } from 'express';
import { mlflowService, MLflowError } from '../services/MLflowService.js';
import type {
  MLflowModelStage,
  CreateExperimentRequest,
  CreateRegisteredModelRequest,
  TransitionStageRequest,
  MetricToLog,
} from '../types/mlflow.types.js';

export const modelsRoutes = Router();

// ============================================================================
// Middleware: Check MLflow availability
// ============================================================================

const requireMLflow = (_req: Request, res: Response, next: () => void) => {
  if (!mlflowService.isInitialized()) {
    return res.status(503).json({
      error: 'MLflow not available',
      message: 'MLflow model registry is not initialized',
    });
  }
  next();
};

modelsRoutes.use(requireMLflow);

// ============================================================================
// Experiment Endpoints
// ============================================================================

/**
 * POST /api/models/experiments - Create experiment
 */
modelsRoutes.post('/experiments', async (req: Request, res: Response) => {
  try {
    const { name, tags, artifactLocation } = req.body as CreateExperimentRequest;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const experiment = await mlflowService.createExperiment(name, tags, artifactLocation);

    res.status(201).json({
      experiment,
      message: 'Experiment created successfully',
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error creating experiment:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/experiments - List experiments
 */
modelsRoutes.get('/experiments', async (_req: Request, res: Response) => {
  try {
    const experiments = await mlflowService.listExperiments();

    res.json({
      experiments,
      count: experiments.length,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error listing experiments:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/experiments/:id - Get experiment by ID
 */
modelsRoutes.get('/experiments/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const experiment = await mlflowService.getExperiment(id);

    res.json({ experiment });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting experiment:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/experiments/:id/runs - List runs in experiment
 */
modelsRoutes.get('/experiments/:id/runs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { filter, orderBy } = req.query;

    const runs = await mlflowService.searchRuns(
      [id],
      filter as string | undefined,
      orderBy ? (orderBy as string).split(',') : undefined
    );

    res.json({
      runs,
      count: runs.length,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error listing runs:', error);
    handleMLflowError(res, error);
  }
});

// ============================================================================
// Run Endpoints
// ============================================================================

/**
 * POST /api/models/runs - Create run
 */
modelsRoutes.post('/runs', async (req: Request, res: Response) => {
  try {
    const { experimentId, runName, tags } = req.body;

    if (!experimentId) {
      return res.status(400).json({ error: 'experimentId is required' });
    }

    const run = await mlflowService.createRun(experimentId, runName, tags);

    res.status(201).json({
      run,
      message: 'Run created successfully',
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error creating run:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/runs/:id - Get run details
 */
modelsRoutes.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const run = await mlflowService.getRun(id);

    res.json({ run });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting run:', error);
    handleMLflowError(res, error);
  }
});

/**
 * PUT /api/models/runs/:id/params - Log parameters
 */
modelsRoutes.put('/runs/:id/params', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { params } = req.body;

    if (!params || typeof params !== 'object') {
      return res.status(400).json({ error: 'params object is required' });
    }

    await mlflowService.logParams(id, params);

    res.json({ message: 'Parameters logged successfully' });
  } catch (error) {
    console.error('[ModelsRoutes] Error logging params:', error);
    handleMLflowError(res, error);
  }
});

/**
 * PUT /api/models/runs/:id/metrics - Log metrics
 */
modelsRoutes.put('/runs/:id/metrics', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { metrics } = req.body as { metrics: MetricToLog[] };

    if (!metrics || !Array.isArray(metrics)) {
      return res.status(400).json({ error: 'metrics array is required' });
    }

    await mlflowService.logMetrics(id, metrics);

    res.json({ message: 'Metrics logged successfully' });
  } catch (error) {
    console.error('[ModelsRoutes] Error logging metrics:', error);
    handleMLflowError(res, error);
  }
});

/**
 * PUT /api/models/runs/:id/end - End run
 */
modelsRoutes.put('/runs/:id/end', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await mlflowService.endRun(id, status || 'FINISHED');

    res.json({ message: 'Run ended successfully' });
  } catch (error) {
    console.error('[ModelsRoutes] Error ending run:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/runs/:id/metrics/:key - Get metric history
 */
modelsRoutes.get('/runs/:id/metrics/:key', async (req: Request, res: Response) => {
  try {
    const { id, key } = req.params;
    const metrics = await mlflowService.getMetricHistory(id, key);

    res.json({
      runId: id,
      metricKey: key,
      metrics,
      count: metrics.length,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting metric history:', error);
    handleMLflowError(res, error);
  }
});

// ============================================================================
// Model Registry Endpoints
// ============================================================================

/**
 * POST /api/models/registry - Register model
 */
modelsRoutes.post('/registry', async (req: Request, res: Response) => {
  try {
    const { name, description, tags } = req.body as CreateRegisteredModelRequest;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const model = await mlflowService.createRegisteredModel(name, description, tags);

    res.status(201).json({
      registeredModel: model,
      message: 'Model registered successfully',
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error registering model:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/registry - List registered models
 */
modelsRoutes.get('/registry', async (_req: Request, res: Response) => {
  try {
    const models = await mlflowService.listRegisteredModels();

    res.json({
      registeredModels: models,
      count: models.length,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error listing registered models:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/registry/:name - Get model details
 */
modelsRoutes.get('/registry/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const model = await mlflowService.getRegisteredModel(decodeURIComponent(name));

    res.json({ registeredModel: model });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting registered model:', error);
    handleMLflowError(res, error);
  }
});

/**
 * DELETE /api/models/registry/:name - Delete registered model
 */
modelsRoutes.delete('/registry/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    await mlflowService.deleteRegisteredModel(decodeURIComponent(name));

    res.json({ message: 'Model deleted successfully' });
  } catch (error) {
    console.error('[ModelsRoutes] Error deleting registered model:', error);
    handleMLflowError(res, error);
  }
});

// ============================================================================
// Model Version Endpoints
// ============================================================================

/**
 * GET /api/models/registry/:name/versions - List versions
 */
modelsRoutes.get('/registry/:name/versions', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const model = await mlflowService.getRegisteredModel(decodeURIComponent(name));

    res.json({
      modelName: name,
      versions: model.latestVersions || [],
      count: model.latestVersions?.length || 0,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error listing model versions:', error);
    handleMLflowError(res, error);
  }
});

/**
 * POST /api/models/registry/:name/versions - Create version
 */
modelsRoutes.post('/registry/:name/versions', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { source, runId, description, tags } = req.body;

    if (!source) {
      return res.status(400).json({ error: 'source is required' });
    }

    const version = await mlflowService.createModelVersion(
      decodeURIComponent(name),
      source,
      runId,
      description,
      tags
    );

    res.status(201).json({
      modelVersion: version,
      message: 'Model version created successfully',
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error creating model version:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/registry/:name/versions/:version - Get version
 */
modelsRoutes.get('/registry/:name/versions/:version', async (req: Request, res: Response) => {
  try {
    const { name, version } = req.params;
    const modelVersion = await mlflowService.getModelVersion(
      decodeURIComponent(name),
      version
    );

    res.json({ modelVersion });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting model version:', error);
    handleMLflowError(res, error);
  }
});

/**
 * PUT /api/models/registry/:name/versions/:version/stage - Transition stage
 */
modelsRoutes.put('/registry/:name/versions/:version/stage', async (req: Request, res: Response) => {
  try {
    const { name, version } = req.params;
    const { stage, archiveExistingVersions } = req.body as TransitionStageRequest;

    if (!stage) {
      return res.status(400).json({ error: 'stage is required' });
    }

    const validStages: MLflowModelStage[] = ['None', 'Staging', 'Production', 'Archived'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({
        error: `Invalid stage. Must be one of: ${validStages.join(', ')}`,
      });
    }

    const modelVersion = await mlflowService.transitionModelVersionStage(
      decodeURIComponent(name),
      version,
      stage,
      archiveExistingVersions
    );

    res.json({
      modelVersion,
      message: `Model version transitioned to ${stage}`,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error transitioning model stage:', error);
    handleMLflowError(res, error);
  }
});

/**
 * DELETE /api/models/registry/:name/versions/:version - Delete version
 */
modelsRoutes.delete('/registry/:name/versions/:version', async (req: Request, res: Response) => {
  try {
    const { name, version } = req.params;
    await mlflowService.deleteModelVersion(decodeURIComponent(name), version);

    res.json({ message: 'Model version deleted successfully' });
  } catch (error) {
    console.error('[ModelsRoutes] Error deleting model version:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/registry/:name/latest - Get latest by stage(s)
 */
modelsRoutes.get('/registry/:name/latest', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { stages } = req.query;

    let stageFilter: MLflowModelStage[] | undefined;
    if (stages) {
      stageFilter = (stages as string).split(',') as MLflowModelStage[];
    }

    const versions = await mlflowService.getLatestVersions(
      decodeURIComponent(name),
      stageFilter
    );

    res.json({
      modelName: name,
      latestVersions: versions,
      count: versions.length,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting latest versions:', error);
    handleMLflowError(res, error);
  }
});

// ============================================================================
// Model Alias Endpoints
// ============================================================================

/**
 * PUT /api/models/registry/:name/alias/:alias - Set alias
 */
modelsRoutes.put('/registry/:name/alias/:alias', async (req: Request, res: Response) => {
  try {
    const { name, alias } = req.params;
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({ error: 'version is required' });
    }

    await mlflowService.setModelAlias(decodeURIComponent(name), alias, version);

    res.json({
      message: `Alias '${alias}' set to version ${version}`,
      modelName: name,
      alias,
      version,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error setting model alias:', error);
    handleMLflowError(res, error);
  }
});

/**
 * DELETE /api/models/registry/:name/alias/:alias - Delete alias
 */
modelsRoutes.delete('/registry/:name/alias/:alias', async (req: Request, res: Response) => {
  try {
    const { name, alias } = req.params;
    await mlflowService.deleteModelAlias(decodeURIComponent(name), alias);

    res.json({ message: `Alias '${alias}' deleted successfully` });
  } catch (error) {
    console.error('[ModelsRoutes] Error deleting model alias:', error);
    handleMLflowError(res, error);
  }
});

/**
 * GET /api/models/registry/:name/alias/:alias - Get version by alias
 */
modelsRoutes.get('/registry/:name/alias/:alias', async (req: Request, res: Response) => {
  try {
    const { name, alias } = req.params;
    const version = await mlflowService.getModelVersionByAlias(
      decodeURIComponent(name),
      alias
    );

    res.json({
      modelName: name,
      alias,
      modelVersion: version,
    });
  } catch (error) {
    console.error('[ModelsRoutes] Error getting version by alias:', error);
    handleMLflowError(res, error);
  }
});

// ============================================================================
// Compare Endpoints
// ============================================================================

/**
 * GET /api/models/compare - Compare runs by metrics
 */
modelsRoutes.get('/compare', async (req: Request, res: Response) => {
  try {
    const { runIds, metricKeys } = req.query;

    if (!runIds) {
      return res.status(400).json({ error: 'runIds query parameter is required' });
    }

    if (!metricKeys) {
      return res.status(400).json({ error: 'metricKeys query parameter is required' });
    }

    const runIdList = (runIds as string).split(',');
    const metricKeyList = (metricKeys as string).split(',');

    const comparison = await mlflowService.compareRuns(runIdList, metricKeyList);

    res.json(comparison);
  } catch (error) {
    console.error('[ModelsRoutes] Error comparing runs:', error);
    handleMLflowError(res, error);
  }
});

// ============================================================================
// Health Endpoint
// ============================================================================

/**
 * GET /api/models/health - Check MLflow health
 */
modelsRoutes.get('/health', async (_req: Request, res: Response) => {
  try {
    const isHealthy = await mlflowService.healthCheck();

    if (isHealthy) {
      res.json({
        status: 'healthy',
        message: 'MLflow is available',
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        message: 'MLflow is not responding',
      });
    }
  } catch (error) {
    console.error('[ModelsRoutes] Error checking health:', error);
    res.status(503).json({
      status: 'unhealthy',
      message: 'Failed to check MLflow health',
    });
  }
});

// ============================================================================
// Error Handler
// ============================================================================

function handleMLflowError(res: Response, error: unknown): void {
  if (error instanceof MLflowError) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Not found', message: error.message });
    } else if (error.statusCode >= 400 && error.statusCode < 500) {
      res.status(error.statusCode).json({ error: 'Bad request', message: error.message });
    } else {
      res.status(500).json({ error: 'MLflow error', message: error.message });
    }
  } else {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', message });
  }
}

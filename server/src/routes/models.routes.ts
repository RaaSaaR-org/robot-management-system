/**
 * @file models.routes.ts
 * @description REST API for the VLA model registry: list, register (POST), amend
 *   (PATCH), read one with its relations and evaluation rollup, and walk its
 *   lineage. The deployment UI (deploymentApi `GET /api/models/versions`) needs
 *   the list to populate the "Select Model Version" step; it filters client-side
 *   to deploymentStatus === 'staging'.
 * @feature deployment
 */
import { Router, type Request, type Response } from 'express';
import { modelVersionRepository } from '../repositories/index.js';
import { modelRegistryService } from '../services/ModelRegistryService.js';
import {
  ModelDeploymentStatuses,
  type CreateModelVersionInput,
  type ModelDeploymentStatus,
  type ModelType,
  type TrainingMetrics,
  type UpdateModelVersionInput,
} from '../types/vla.types.js';

export const modelsRoutes = Router();

/**
 * Schemes an `artifactUri` may carry, following the `TrainingRunManifestDataset.uri`
 * convention in `types/mixture.types.ts` — and enforced for the same reason: a
 * bare path is not portable, so a machine handed one fails in a way nobody can
 * debug.
 */
const ACCEPTED_ARTIFACT_URI_SCHEMES = ['hf://', 's3://', 'file://'] as const;

const ARTIFACT_URI_SCHEME_ERROR =
  `artifactUri must be scheme-tagged with one of ${ACCEPTED_ARTIFACT_URI_SCHEMES.join(', ')} — ` +
  'a bare path is not portable and fails on another machine in a way nobody can debug';

const MODEL_TYPES: readonly ModelType[] = ['vla', 'rl_policy'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A nullable string field: present-and-string, present-and-null, or absent. */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function hasAcceptedScheme(uri: string): boolean {
  return ACCEPTED_ARTIFACT_URI_SCHEMES.some(
    (scheme) => uri.startsWith(scheme) && uri.length > scheme.length
  );
}

/**
 * GET /api/models
 * Base-path index: serves the model-version collection (same data as
 * /versions) so the base path answers like its sibling collections instead
 * of 404ing.
 */
modelsRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await modelVersionRepository.findAll();
    res.json({ modelVersions: result.data, pagination: result.pagination });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list model versions' });
  }
});

/**
 * GET /api/models/versions
 * List model versions, newest first (created by TrainingOrchestrator.completeJob).
 * Response shape matches the deployment client: `{ modelVersions, pagination }`.
 */
modelsRoutes.get('/versions', async (_req: Request, res: Response) => {
  try {
    const result = await modelVersionRepository.findAll();
    res.json({ modelVersions: result.data, pagination: result.pagination });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list model versions' });
  }
});

/**
 * POST /api/models/versions
 * Register a model version. `trainingJobId` is optional: an imported checkpoint
 * was trained somewhere this server cannot see, so there is no TrainingJob row
 * to point at.
 */
modelsRoutes.post('/versions', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(body.version)) {
    return res.status(400).json({ error: 'version is required' });
  }
  if (!isNonEmptyString(body.artifactUri)) {
    return res.status(400).json({ error: 'artifactUri is required' });
  }
  if (!hasAcceptedScheme(body.artifactUri)) {
    return res.status(400).json({ error: ARTIFACT_URI_SCHEME_ERROR });
  }
  if (body.modelType !== undefined && !MODEL_TYPES.includes(body.modelType as ModelType)) {
    return res.status(400).json({ error: `modelType must be one of ${MODEL_TYPES.join(', ')}` });
  }
  if (
    body.deploymentStatus !== undefined &&
    !ModelDeploymentStatuses.includes(body.deploymentStatus as ModelDeploymentStatus)
  ) {
    return res
      .status(400)
      .json({ error: `deploymentStatus must be one of ${ModelDeploymentStatuses.join(', ')}` });
  }

  const parentModelVersionId = isNonEmptyString(body.parentModelVersionId)
    ? body.parentModelVersionId
    : null;

  try {
    // Checked here rather than left to the foreign key, so a bad parent comes
    // back as a 400 naming the field instead of an opaque write failure.
    if (parentModelVersionId && !(await modelVersionRepository.findById(parentModelVersionId))) {
      return res
        .status(400)
        .json({ error: `parentModelVersionId ${parentModelVersionId} does not exist` });
    }

    const input: CreateModelVersionInput = {
      skillId: isNonEmptyString(body.skillId) ? body.skillId : null,
      trainingJobId: isNonEmptyString(body.trainingJobId) ? body.trainingJobId : null,
      name: isNonEmptyString(body.name) ? body.name : null,
      // Nothing registered through this endpoint came out of this server's
      // orchestrator; one registered against a parent is a fine-tune of it.
      sourceKind: parentModelVersionId ? 'derived' : 'imported',
      parentModelVersionId,
      version: body.version,
      artifactUri: body.artifactUri,
      trainingMetrics: body.trainingMetrics as TrainingMetrics | undefined,
      validationMetrics: body.validationMetrics as TrainingMetrics | undefined,
    };
    if (body.modelType !== undefined) input.modelType = body.modelType as ModelType;
    if (body.deploymentStatus !== undefined) {
      input.deploymentStatus = body.deploymentStatus as ModelDeploymentStatus;
    }

    // Through the service, not the repository: a registration that names a
    // skill has to move the skill's own pointer too (TASK-238).
    const modelVersion = await modelRegistryService.register(input);
    res.status(201).json({ modelVersion });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to register model version' });
  }
});

/**
 * PATCH /api/models/versions/:id
 * Amend a registered model: link it to a skill, rename it, or move it along the
 * deployment ladder. An explicit `null` clears `skillId` / `name`; an absent key
 * leaves the column untouched.
 */
modelsRoutes.patch('/versions/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;

  if ('skillId' in body && !isNullableString(body.skillId)) {
    return res.status(400).json({ error: 'skillId must be a string or null' });
  }
  if ('name' in body && !isNullableString(body.name)) {
    return res.status(400).json({ error: 'name must be a string or null' });
  }
  if (
    'deploymentStatus' in body &&
    !ModelDeploymentStatuses.includes(body.deploymentStatus as ModelDeploymentStatus)
  ) {
    return res
      .status(400)
      .json({ error: `deploymentStatus must be one of ${ModelDeploymentStatuses.join(', ')}` });
  }

  const input: UpdateModelVersionInput = {};
  if ('skillId' in body) input.skillId = body.skillId as string | null;
  if ('name' in body) input.name = body.name as string | null;
  if ('deploymentStatus' in body) {
    input.deploymentStatus = body.deploymentStatus as ModelDeploymentStatus;
  }

  try {
    // The repository returns null for both "no such row" and "the write was
    // rejected", so existence is established first to tell 404 from 400.
    if (!(await modelVersionRepository.findById(id))) {
      return res.status(404).json({ error: 'Model version not found' });
    }

    const modelVersion = await modelRegistryService.update(id, input);
    if (!modelVersion) {
      return res.status(400).json({ error: 'Update rejected — check skillId' });
    }

    res.json({ modelVersion });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to update model version' });
  }
});

/**
 * GET /api/models/versions/:id/lineage
 * The ancestor chain to the root (nearest parent first) plus the direct
 * children, for a lineage view.
 */
modelsRoutes.get('/versions/:id/lineage', async (req: Request, res: Response) => {
  try {
    const lineage = await modelVersionRepository.getLineage(req.params.id);
    if (!lineage) {
      return res.status(404).json({ error: 'Model version not found' });
    }
    res.json({ lineage });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to resolve model lineage' });
  }
});

/**
 * GET /api/models/versions/:id
 * One version with its skill, training job, parent, children and persisted
 * checkpoints, plus the evaluation rollup counted over EvaluationEpisode rows
 * that carry this model's id.
 */
modelsRoutes.get('/versions/:id', async (req: Request, res: Response) => {
  try {
    const modelVersion = await modelVersionRepository.findByIdWithRelations(req.params.id);
    if (!modelVersion) {
      return res.status(404).json({ error: 'Model version not found' });
    }

    const evaluation = await modelVersionRepository.getEvaluationSummary(modelVersion.id);
    res.json({ modelVersion, evaluation });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to load model version' });
  }
});

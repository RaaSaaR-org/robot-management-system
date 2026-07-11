/**
 * @file curation.routes.ts
 * @description REST API endpoints for data curation and augmentation
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { dataCurationService } from '../services/DataCurationService.js';
import { dataAugmentationService } from '../services/DataAugmentationService.js';
import { datasetCurationService, CurationError } from '../services/DatasetCurationService.js';
import type {
  AnalyzeDistributionRequest,
  CreateBalancedSubsetRequest,
  RunCurationRequest,
  ApplyAugmentationRequest,
  CategorizeTrajectoryRequest,
  BalancingConfig,
  CurationConfig,
  AugmentationConfig,
} from '../types/curation.types.js';

export const curationRoutes = Router();

// ============================================================================
// DISTRIBUTION ANALYSIS
// ============================================================================

/**
 * GET /api/datasets/:id/distribution
 * Get task/environment distribution analysis
 */
curationRoutes.get('/:id/distribution', async (req: Request, res: Response) => {
  try {
    const { id: datasetId } = req.params;

    // In a full implementation, this would load trajectories from storage
    // For now, return a stub response
    res.json({
      datasetId,
      message: 'Distribution analysis requires loading dataset from storage',
      hint: 'This endpoint will analyze task and environment distribution when dataset loading is implemented',
      stubResult: {
        byTask: {},
        byEnvironment: {},
        byTaxonomyLevel: { primitive: 0, composed: 0, long_horizon: 0 },
        imbalanceScore: 0,
        totalTrajectories: 0,
        recommendations: ['Load dataset to perform analysis'],
      },
    });
  } catch (error) {
    console.error('[CurationRoutes] Error analyzing distribution:', error);
    res.status(500).json({ error: 'Failed to analyze distribution' });
  }
});

// ============================================================================
// DATASET BALANCING
// ============================================================================

/**
 * POST /api/datasets/:id/balance
 * Create balanced subset of dataset
 */
curationRoutes.post('/:id/balance', async (req: Request, res: Response) => {
  try {
    const { id: datasetId } = req.params;
    const body = req.body as CreateBalancedSubsetRequest;

    // Validate config
    if (!body.config) {
      return res.status(400).json({ error: 'config is required' });
    }

    const validMethods = ['uniform', 'sqrt', 'dro'];
    if (!validMethods.includes(body.config.method)) {
      return res.status(400).json({
        error: `Invalid method. Must be one of: ${validMethods.join(', ')}`,
      });
    }

    const validGroupBy = ['task', 'environment', 'taxonomy_level'];
    if (!validGroupBy.includes(body.config.groupBy)) {
      return res.status(400).json({
        error: `Invalid groupBy. Must be one of: ${validGroupBy.join(', ')}`,
      });
    }

    // In a full implementation, this would:
    // 1. Load dataset trajectories
    // 2. Apply balancing algorithm
    // 3. Create new dataset with balanced subset
    res.json({
      datasetId,
      message: 'Balanced subset creation queued',
      config: body.config,
      outputName: body.outputName ?? `${datasetId}_balanced`,
    });
  } catch (error) {
    console.error('[CurationRoutes] Error creating balanced subset:', error);
    res.status(500).json({ error: 'Failed to create balanced subset' });
  }
});

// ============================================================================
// CURATION PIPELINE
// ============================================================================

/**
 * POST /api/datasets/:id/curate
 * Run curation pipeline (filter, dedupe, flag harmful)
 */
curationRoutes.post('/:id/curate', async (req: Request, res: Response) => {
  try {
    const { id: datasetId } = req.params;
    const body = req.body as RunCurationRequest | undefined;

    const config: CurationConfig = {
      minQualityScore: body?.config?.minQualityScore ?? 50,
      deduplicationThreshold: body?.config?.deduplicationThreshold ?? 0.95,
      identifyHarmful: body?.config?.identifyHarmful ?? true,
      hindsightRelabeling: body?.config?.hindsightRelabeling ?? false,
    };

    // In a full implementation, this would run the curation pipeline
    res.json({
      datasetId,
      message: 'Curation pipeline queued',
      config,
      createNewDataset: body?.createNewDataset ?? false,
      outputName: body?.outputName,
    });
  } catch (error) {
    console.error('[CurationRoutes] Error running curation:', error);
    res.status(500).json({ error: 'Failed to run curation' });
  }
});

// ============================================================================
// AUGMENTATION
// ============================================================================

/**
 * POST /api/datasets/:id/augment
 * Apply augmentation pipeline
 */
curationRoutes.post('/:id/augment', async (req: Request, res: Response) => {
  try {
    const { id: datasetId } = req.params;
    const body = req.body as ApplyAugmentationRequest | undefined;

    const config: AugmentationConfig = {
      action: {
        enabled: body?.config?.action?.enabled ?? true,
        noiseScale: body?.config?.action?.noiseScale ?? 0.05,
        temporalJitterMs: body?.config?.action?.temporalJitterMs,
        interpolationFactor: body?.config?.action?.interpolationFactor,
      },
      image: {
        enabled: body?.config?.image?.enabled ?? true,
        colorJitter: body?.config?.image?.colorJitter ?? true,
        randomCrops: body?.config?.image?.randomCrops ?? false,
        horizontalFlip: body?.config?.image?.horizontalFlip ?? false,
        backgroundRandomization: body?.config?.image?.backgroundRandomization ?? false,
      },
      language: {
        enabled: body?.config?.language?.enabled ?? false,
        paraphrasesPerInstruction: body?.config?.language?.paraphrasesPerInstruction ?? 3,
        useLLM: body?.config?.language?.useLLM ?? false,
        enableSkillChaining: body?.config?.language?.enableSkillChaining ?? false,
      },
    };

    // In a full implementation, this would run the augmentation pipeline
    res.json({
      datasetId,
      message: 'Augmentation pipeline queued',
      config,
      createNewDataset: body?.createNewDataset ?? false,
      outputName: body?.outputName,
    });
  } catch (error) {
    console.error('[CurationRoutes] Error applying augmentation:', error);
    res.status(500).json({ error: 'Failed to apply augmentation' });
  }
});

// ============================================================================
// TAXONOMY
// ============================================================================

/**
 * GET /api/taxonomy
 * Get task taxonomy
 */
curationRoutes.get('/taxonomy', async (_req: Request, res: Response) => {
  try {
    const taxonomy = dataCurationService.getTaxonomy();

    // Group by level
    const byLevel = {
      primitive: taxonomy.filter((t) => t.level === 'primitive'),
      composed: taxonomy.filter((t) => t.level === 'composed'),
      long_horizon: taxonomy.filter((t) => t.level === 'long_horizon'),
    };

    res.json({
      taxonomy,
      byLevel,
      totalTasks: taxonomy.length,
    });
  } catch (error) {
    console.error('[CurationRoutes] Error getting taxonomy:', error);
    res.status(500).json({ error: 'Failed to get taxonomy' });
  }
});

/**
 * POST /api/taxonomy/categorize
 * Categorize a trajectory based on instruction
 */
curationRoutes.post('/taxonomy/categorize', async (req: Request, res: Response) => {
  try {
    const body = req.body as CategorizeTrajectoryRequest;

    if (!body.languageInstruction) {
      return res.status(400).json({ error: 'languageInstruction is required' });
    }

    const result = dataCurationService.categorizeTrajectory(body.languageInstruction);

    res.json({
      instruction: body.languageInstruction,
      categorization: result,
    });
  } catch (error) {
    console.error('[CurationRoutes] Error categorizing trajectory:', error);
    res.status(500).json({ error: 'Failed to categorize trajectory' });
  }
});

// ============================================================================
// DUPLICATES
// ============================================================================

/**
 * GET /api/datasets/:id/duplicates
 * Find near-duplicate trajectories
 */
curationRoutes.get('/:id/duplicates', async (req: Request, res: Response) => {
  try {
    const { id: datasetId } = req.params;
    const query = req.query as Record<string, string | undefined>;
    const threshold = query.threshold ? parseFloat(query.threshold) : 0.95;

    // In a full implementation, this would find duplicates
    res.json({
      datasetId,
      threshold,
      message: 'Duplicate detection requires loading dataset trajectories',
      duplicateGroups: [],
    });
  } catch (error) {
    console.error('[CurationRoutes] Error finding duplicates:', error);
    res.status(500).json({ error: 'Failed to find duplicates' });
  }
});

// ============================================================================
// HINDSIGHT RELABELING
// ============================================================================

/**
 * POST /api/datasets/:id/relabel-hindsight
 * Apply hindsight relabeling to failed trajectories
 */
curationRoutes.post('/:id/relabel-hindsight', async (req: Request, res: Response) => {
  try {
    const { id: datasetId } = req.params;

    // In a full implementation, this would:
    // 1. Load failed trajectories
    // 2. Generate new instructions based on achieved states
    // 3. Update dataset
    res.json({
      datasetId,
      message: 'Hindsight relabeling queued',
      hint: 'This will relabel failed trajectories based on achieved states',
    });
  } catch (error) {
    console.error('[CurationRoutes] Error applying hindsight relabeling:', error);
    res.status(500).json({ error: 'Failed to apply hindsight relabeling' });
  }
});

// ============================================================================
// LANGUAGE AUGMENTATION UTILITIES
// ============================================================================

/**
 * POST /api/curation/paraphrase
 * Generate paraphrases for an instruction
 */
curationRoutes.post('/paraphrase', async (req: Request, res: Response) => {
  try {
    const { instruction, count } = req.body as {
      instruction?: string;
      count?: number;
    };

    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }

    const paraphrases = dataAugmentationService.paraphraseInstruction(
      instruction,
      count ?? 3
    );

    res.json({
      original: instruction,
      paraphrases,
      count: paraphrases.length,
    });
  } catch (error) {
    console.error('[CurationRoutes] Error generating paraphrases:', error);
    res.status(500).json({ error: 'Failed to generate paraphrases' });
  }
});

/**
 * POST /api/curation/diversity-score
 * Compute diversity score for a set of instructions
 */
curationRoutes.post('/diversity-score', async (req: Request, res: Response) => {
  try {
    const { instructions } = req.body as { instructions?: string[] };

    if (!Array.isArray(instructions) || instructions.length === 0) {
      return res.status(400).json({ error: 'instructions array is required' });
    }

    const score = dataAugmentationService.computeDiversityScore(instructions);

    res.json({
      instructionCount: instructions.length,
      diversityScore: score,
      interpretation:
        score > 0.8
          ? 'High diversity'
          : score > 0.5
            ? 'Moderate diversity'
            : 'Low diversity - consider adding more varied instructions',
    });
  } catch (error) {
    console.error('[CurationRoutes] Error computing diversity score:', error);
    res.status(500).json({ error: 'Failed to compute diversity score' });
  }
});

// ============================================================================
// EPISODE EDITING (interactive trim / delete / suggest for the curation GUI)
// ============================================================================

/** Map a curation failure to an HTTP response (CurationError codes -> 400). */
function sendCurationError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof CurationError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: error instanceof Error ? error.message : fallback });
}

/**
 * POST /api/curation/:id/episodes/delete
 * Body: { episodes: number[], datasetPath?: string }
 * Deletes whole episodes, writing a new dataset revision. When the dataset id
 * exists in the DB, the revision is registered as a NEW Dataset row and the
 * response carries `newDatasetId` / `newDatasetName`.
 */
curationRoutes.post('/:id/episodes/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { episodes, datasetPath } = req.body as { episodes?: number[]; datasetPath?: string };
    if (!Array.isArray(episodes) || episodes.length === 0) {
      return res.status(400).json({ error: 'episodes (non-empty number[]) is required' });
    }
    const result = await datasetCurationService.deleteEpisodes(id, episodes, datasetPath);
    res.json(result);
  } catch (error) {
    console.error('[CurationRoutes] Error deleting episodes:', error);
    sendCurationError(res, error, 'Failed to delete episodes');
  }
});

/**
 * POST /api/curation/:id/episodes/:index/trim
 * Body: { start: number, end?: number | null, datasetPath?: string }
 * Trims one episode to the frame range [start, end), writing a new dataset
 * revision (registered as a NEW Dataset row when the id exists in the DB).
 */
curationRoutes.post('/:id/episodes/:index/trim', async (req: Request, res: Response) => {
  try {
    const { id, index } = req.params;
    const episodeIndex = Number(index);
    const { start, end, datasetPath } = req.body as {
      start?: number;
      end?: number | null;
      datasetPath?: string;
    };
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
      return res.status(400).json({ error: 'episode index must be a non-negative integer' });
    }
    if (typeof start !== 'number' || start < 0) {
      return res.status(400).json({ error: 'start (>= 0) is required' });
    }
    const result = await datasetCurationService.trimEpisode(
      id,
      episodeIndex,
      start,
      end ?? null,
      datasetPath,
    );
    res.json(result);
  } catch (error) {
    console.error('[CurationRoutes] Error trimming episode:', error);
    sendCurationError(res, error, 'Failed to trim episode');
  }
});

/**
 * POST /api/curation/:id/suggest
 * Body: { episode?: number, datasetPath?: string }
 * Phase-2 "video-use" AI suggestions: motion heuristics over the dataset's
 * action/state traces (optionally VLM-enriched via CURATION_VLM=gemini).
 * Read-only — the operator reviews and applies suggestions manually.
 */
curationRoutes.post('/:id/suggest', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { episode, datasetPath } = req.body as { episode?: number; datasetPath?: string };
    if (episode !== undefined && (!Number.isInteger(episode) || episode < 0)) {
      return res.status(400).json({ error: 'episode must be a non-negative integer' });
    }
    const result = await datasetCurationService.suggest(id, { episode, datasetPath });
    res.json(result);
  } catch (error) {
    console.error('[CurationRoutes] Error suggesting curation edits:', error);
    sendCurationError(res, error, 'Failed to compute curation suggestions');
  }
});

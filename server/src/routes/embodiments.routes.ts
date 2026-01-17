/**
 * @file embodiments.routes.ts
 * @description REST API endpoints for embodiment configuration management
 * @feature vla
 */

import { Router, Request, Response } from 'express';
import { embodimentService } from '../services/EmbodimentService.js';
import type {
  CreateEmbodimentInput,
  UpdateEmbodimentInput,
  EmbodimentQueryParams,
} from '../types/embodiment.types.js';

export const embodimentsRoutes = Router();

// ============================================================================
// EMBODIMENT CRUD ROUTES
// ============================================================================

/**
 * POST /api/embodiments - Create or upsert embodiment
 */
embodimentsRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const input = req.body as CreateEmbodimentInput;

    // Validate required fields
    if (!input.tag) {
      return res.status(400).json({ error: 'tag is required' });
    }
    if (!input.manufacturer) {
      return res.status(400).json({ error: 'manufacturer is required' });
    }
    if (!input.model) {
      return res.status(400).json({ error: 'model is required' });
    }
    if (!input.configYaml) {
      return res.status(400).json({ error: 'configYaml is required' });
    }
    if (typeof input.actionDim !== 'number' || input.actionDim <= 0) {
      return res.status(400).json({ error: 'actionDim must be a positive integer' });
    }
    if (typeof input.proprioceptionDim !== 'number' || input.proprioceptionDim <= 0) {
      return res.status(400).json({ error: 'proprioceptionDim must be a positive integer' });
    }

    // Upsert (create or update)
    const embodiment = await embodimentService.upsertEmbodiment(input);

    res.status(201).json({
      embodiment,
      message: 'Embodiment created/updated successfully',
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error creating embodiment:', error);
    const message = error instanceof Error ? error.message : 'Failed to create embodiment';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/embodiments - List embodiments with filtering
 */
embodimentsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const params: EmbodimentQueryParams = {
      manufacturer: query.manufacturer,
      model: query.model,
      robotTypeId: query.robotTypeId,
      page: query.page ? parseInt(query.page, 10) : undefined,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : undefined,
    };

    const result = await embodimentService.listEmbodiments(params);

    res.json({
      embodiments: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error listing embodiments:', error);
    const message = error instanceof Error ? error.message : 'Failed to list embodiments';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/embodiments/:tag - Get embodiment by tag
 */
embodimentsRoutes.get('/:tag', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;
    const embodiment = await embodimentService.getEmbodiment(tag);

    if (!embodiment) {
      return res.status(404).json({ error: 'Embodiment not found' });
    }

    res.json({ embodiment });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error getting embodiment:', error);
    const message = error instanceof Error ? error.message : 'Failed to get embodiment';
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/embodiments/:tag - Update embodiment
 */
embodimentsRoutes.put('/:tag', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;
    const input = req.body as UpdateEmbodimentInput;

    const embodiment = await embodimentService.updateEmbodiment(tag, input);

    if (!embodiment) {
      return res.status(404).json({ error: 'Embodiment not found' });
    }

    res.json({
      embodiment,
      message: 'Embodiment updated successfully',
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error updating embodiment:', error);
    const message = error instanceof Error ? error.message : 'Failed to update embodiment';
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/embodiments/:tag - Delete embodiment
 */
embodimentsRoutes.delete('/:tag', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;

    const deleted = await embodimentService.deleteEmbodiment(tag);

    if (!deleted) {
      return res.status(404).json({ error: 'Embodiment not found' });
    }

    res.json({ message: 'Embodiment deleted successfully' });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error deleting embodiment:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete embodiment';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// VALIDATION ROUTES
// ============================================================================

/**
 * POST /api/embodiments/validate - Validate YAML configuration
 */
embodimentsRoutes.post('/validate', async (req: Request, res: Response) => {
  try {
    const { configYaml } = req.body as { configYaml: string };

    if (!configYaml) {
      return res.status(400).json({ error: 'configYaml is required' });
    }

    const result = embodimentService.validateYamlConfig(configYaml);

    res.json({
      valid: result.valid,
      errors: result.errors,
      parsedConfig: result.parsedConfig,
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error validating config:', error);
    const message = error instanceof Error ? error.message : 'Failed to validate config';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// LINKING ROUTES
// ============================================================================

/**
 * POST /api/embodiments/:tag/link - Link embodiment to robot type
 */
embodimentsRoutes.post('/:tag/link', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;
    const { robotTypeId } = req.body as { robotTypeId: string };

    if (!robotTypeId) {
      return res.status(400).json({ error: 'robotTypeId is required' });
    }

    const embodiment = await embodimentService.linkToRobotType(tag, robotTypeId);

    res.json({
      embodiment,
      message: 'Embodiment linked to robot type successfully',
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error linking embodiment:', error);
    const message = error instanceof Error ? error.message : 'Failed to link embodiment';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/embodiments/:tag/unlink - Unlink embodiment from robot type
 */
embodimentsRoutes.post('/:tag/unlink', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;

    const embodiment = await embodimentService.unlinkFromRobotType(tag);

    res.json({
      embodiment,
      message: 'Embodiment unlinked from robot type successfully',
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error unlinking embodiment:', error);
    const message = error instanceof Error ? error.message : 'Failed to unlink embodiment';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/embodiments/:tag/config - Get parsed YAML config
 */
embodimentsRoutes.get('/:tag/config', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;
    const embodiment = await embodimentService.getEmbodiment(tag);

    if (!embodiment) {
      return res.status(404).json({ error: 'Embodiment not found' });
    }

    const parsedConfig = embodimentService.parseYamlConfig(embodiment.configYaml);

    if (!parsedConfig) {
      return res.status(500).json({ error: 'Failed to parse stored configuration' });
    }

    res.json({
      tag,
      config: parsedConfig,
    });
  } catch (error) {
    console.error('[EmbodimentsRoutes] Error getting config:', error);
    const message = error instanceof Error ? error.message : 'Failed to get config';
    res.status(500).json({ error: message });
  }
});

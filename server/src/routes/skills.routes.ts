/**
 * @file skills.routes.ts
 * @description REST API endpoints for skill library management
 * @feature vla
 */

import { Router, Request, Response } from 'express';
import { skillLibraryService } from '../services/SkillLibraryService.js';
import { skillExecutionService } from '../services/SkillExecutionService.js';
import type {
  CreateSkillDefinitionInput,
  UpdateSkillDefinitionInput,
  SkillDefinitionQueryParams,
  SkillStatus,
} from '../types/vla.types.js';
import type {
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  SkillChainStatus,
  ExecuteSkillRequest,
  ExecuteChainRequest,
  ValidateParametersRequest,
} from '../types/skill.types.js';

export const skillsRoutes = Router();

// ============================================================================
// SKILL DEFINITION ROUTES
// ============================================================================

/**
 * POST /api/skills - Create new skill definition
 */
skillsRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const input = req.body as CreateSkillDefinitionInput;

    // Validate required fields
    if (!input.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!input.version) {
      return res.status(400).json({ error: 'version is required' });
    }

    const skill = await skillLibraryService.createSkill(input);

    res.status(201).json({
      skill,
      message: 'Skill created successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error creating skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to create skill';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/skills - List skills with filtering
 */
skillsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const params: SkillDefinitionQueryParams = {
      name: query.name,
      page: query.page ? parseInt(query.page, 10) : undefined,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : undefined,
      robotTypeId: query.robotTypeId,
      capability: query.capability,
      linkedModelVersionId: query.linkedModelVersionId,
    };

    // Parse status (can be single or comma-separated)
    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as SkillStatus[])
        : (query.status as SkillStatus);
    }

    const result = await skillLibraryService.listSkills(params);

    res.json({
      skills: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error listing skills:', error);
    const message = error instanceof Error ? error.message : 'Failed to list skills';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/skills/published - List published skills
 */
skillsRoutes.get('/published', async (_req: Request, res: Response) => {
  try {
    const skills = await skillLibraryService.listPublishedSkills();

    res.json({
      skills,
      count: skills.length,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error listing published skills:', error);
    const message = error instanceof Error ? error.message : 'Failed to list published skills';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/skills/for-robot/:robotId - List skills compatible with a robot
 */
skillsRoutes.get('/for-robot/:robotId', async (req: Request, res: Response) => {
  try {
    const { robotId } = req.params;

    const skills = await skillLibraryService.getSkillsForRobot(robotId);

    res.json({
      robotId,
      skills,
      count: skills.length,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error getting skills for robot:', error);
    const message = error instanceof Error ? error.message : 'Failed to get skills for robot';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/skills/:id - Get skill details
 */
skillsRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const skill = await skillLibraryService.getSkillWithRelations(id);

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ skill });
  } catch (error) {
    console.error('[SkillsRoutes] Error getting skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to get skill';
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/skills/:id - Update skill definition
 */
skillsRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input = req.body as UpdateSkillDefinitionInput;

    const skill = await skillLibraryService.updateSkill(id, input);

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({
      skill,
      message: 'Skill updated successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error updating skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to update skill';
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/skills/:id - Delete skill definition
 */
skillsRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await skillLibraryService.deleteSkill(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ message: 'Skill deleted successfully' });
  } catch (error) {
    console.error('[SkillsRoutes] Error deleting skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete skill';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// SKILL STATUS ROUTES
// ============================================================================

/**
 * POST /api/skills/:id/publish - Publish skill
 */
skillsRoutes.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const skill = await skillLibraryService.publishSkill(id);

    res.json({
      skill,
      message: 'Skill published successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error publishing skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to publish skill';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/skills/:id/deprecate - Deprecate skill
 */
skillsRoutes.post('/:id/deprecate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const skill = await skillLibraryService.deprecateSkill(id);

    res.json({
      skill,
      message: 'Skill deprecated successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error deprecating skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to deprecate skill';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/skills/:id/archive - Archive skill
 */
skillsRoutes.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const skill = await skillLibraryService.archiveSkill(id);

    res.json({
      skill,
      message: 'Skill archived successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error archiving skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to archive skill';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// PARAMETER VALIDATION ROUTES
// ============================================================================

/**
 * POST /api/skills/:id/validate - Validate parameters for a skill
 */
skillsRoutes.post('/:id/validate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { parameters } = req.body as { parameters: Record<string, unknown> };

    if (!parameters) {
      return res.status(400).json({ error: 'parameters is required' });
    }

    const result = await skillLibraryService.validateSkillParameters(id, parameters);

    res.json({
      skillId: id,
      ...result,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error validating parameters:', error);
    const message = error instanceof Error ? error.message : 'Failed to validate parameters';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// COMPATIBILITY ROUTES
// ============================================================================

/**
 * GET /api/skills/:id/compatible-robots - Get robots compatible with a skill
 */
skillsRoutes.get('/:id/compatible-robots', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await skillLibraryService.getCompatibleRobots(id);

    res.json(result);
  } catch (error) {
    console.error('[SkillsRoutes] Error getting compatible robots:', error);
    const message = error instanceof Error ? error.message : 'Failed to get compatible robots';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/skills/:id/check-robot/:robotId - Check if a robot is compatible with a skill
 */
skillsRoutes.get('/:id/check-robot/:robotId', async (req: Request, res: Response) => {
  try {
    const { id, robotId } = req.params;

    const result = await skillLibraryService.checkRobotCompatibility(id, robotId);

    res.json(result);
  } catch (error) {
    console.error('[SkillsRoutes] Error checking robot compatibility:', error);
    const message = error instanceof Error ? error.message : 'Failed to check compatibility';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// SKILL EXECUTION ROUTES
// ============================================================================

/**
 * POST /api/skills/:id/execute - Execute a skill on a robot
 */
skillsRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Omit<ExecuteSkillRequest, 'skillId'>;

    if (!body.robotId) {
      return res.status(400).json({ error: 'robotId is required' });
    }

    const request: ExecuteSkillRequest = {
      skillId: id,
      robotId: body.robotId,
      parameters: body.parameters,
      skipPreconditions: body.skipPreconditions,
      skipPostconditions: body.skipPostconditions,
    };

    const result = await skillExecutionService.executeSkill(request);

    const statusCode = result.status === 'completed' ? 200 : 400;

    res.status(statusCode).json({
      result,
      message: result.status === 'completed' ? 'Skill executed successfully' : 'Skill execution failed',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error executing skill:', error);
    const message = error instanceof Error ? error.message : 'Failed to execute skill';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// SKILL CHAIN ROUTES
// ============================================================================

/**
 * POST /api/skill-chains - Create new skill chain
 */
skillsRoutes.post('/chains', async (req: Request, res: Response) => {
  try {
    const input = req.body as CreateSkillChainInput;

    if (!input.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!input.steps || input.steps.length === 0) {
      return res.status(400).json({ error: 'steps is required and must not be empty' });
    }

    const chain = await skillLibraryService.createChain(input);

    res.status(201).json({
      chain,
      message: 'Skill chain created successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error creating skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to create skill chain';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/skill-chains - List skill chains
 */
skillsRoutes.get('/chains', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const params: SkillChainQueryParams = {
      name: query.name,
      page: query.page ? parseInt(query.page, 10) : undefined,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : undefined,
    };

    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as SkillChainStatus[])
        : (query.status as SkillChainStatus);
    }

    const result = await skillLibraryService.listChains(params);

    res.json({
      chains: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error listing skill chains:', error);
    const message = error instanceof Error ? error.message : 'Failed to list skill chains';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/skill-chains/active - List active skill chains
 */
skillsRoutes.get('/chains/active', async (_req: Request, res: Response) => {
  try {
    const chains = await skillLibraryService.listActiveChains();

    res.json({
      chains,
      count: chains.length,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error listing active chains:', error);
    const message = error instanceof Error ? error.message : 'Failed to list active chains';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/skill-chains/:id - Get skill chain details
 */
skillsRoutes.get('/chains/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const chain = await skillLibraryService.getChain(id);

    if (!chain) {
      return res.status(404).json({ error: 'Skill chain not found' });
    }

    res.json({ chain });
  } catch (error) {
    console.error('[SkillsRoutes] Error getting skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to get skill chain';
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/skill-chains/:id - Update skill chain
 */
skillsRoutes.put('/chains/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input = req.body as UpdateSkillChainInput;

    const chain = await skillLibraryService.updateChain(id, input);

    if (!chain) {
      return res.status(404).json({ error: 'Skill chain not found' });
    }

    res.json({
      chain,
      message: 'Skill chain updated successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error updating skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to update skill chain';
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/skill-chains/:id - Delete skill chain
 */
skillsRoutes.delete('/chains/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await skillLibraryService.deleteChain(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Skill chain not found' });
    }

    res.json({ message: 'Skill chain deleted successfully' });
  } catch (error) {
    console.error('[SkillsRoutes] Error deleting skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete skill chain';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/skill-chains/:id/activate - Activate skill chain
 */
skillsRoutes.post('/chains/:id/activate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const chain = await skillLibraryService.activateChain(id);

    res.json({
      chain,
      message: 'Skill chain activated successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error activating skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to activate skill chain';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/skill-chains/:id/archive - Archive skill chain
 */
skillsRoutes.post('/chains/:id/archive', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const chain = await skillLibraryService.archiveChain(id);

    res.json({
      chain,
      message: 'Skill chain archived successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error archiving skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to archive skill chain';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/skill-chains/:id/execute - Execute skill chain on a robot
 */
skillsRoutes.post('/chains/:id/execute', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Omit<ExecuteChainRequest, 'chainId'>;

    if (!body.robotId) {
      return res.status(400).json({ error: 'robotId is required' });
    }

    const request: ExecuteChainRequest = {
      chainId: id,
      robotId: body.robotId,
      initialParameters: body.initialParameters,
      startFromStep: body.startFromStep,
    };

    const result = await skillExecutionService.executeChain(request);

    const statusCode = result.status === 'completed' ? 200 : 400;

    res.status(statusCode).json({
      result,
      message: result.status === 'completed' ? 'Chain executed successfully' : 'Chain execution failed',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error executing skill chain:', error);
    const message = error instanceof Error ? error.message : 'Failed to execute skill chain';
    res.status(500).json({ error: message });
  }
});

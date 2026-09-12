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
import { sendFailure } from '../utils/routeErrors.js';

export const skillsRoutes = Router();

// ============================================================================
// SKILL CHAIN ROUTES (mounted first to avoid `/:id` shadowing `/chains`)
// ============================================================================

const chainsRoutes = Router();

/**
 * POST /api/skills/chains - Create new skill chain
 */
chainsRoutes.post('/', async (req: Request, res: Response) => {
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
    sendFailure(res, error, 'Failed to create skill chain', 400);
  }
});

/**
 * GET /api/skills/chains - List skill chains
 */
chainsRoutes.get('/', async (req: Request, res: Response) => {
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
    sendFailure(res, error, 'Failed to list skill chains', 500);
  }
});

/**
 * GET /api/skills/chains/active - List active skill chains
 */
chainsRoutes.get('/active', async (_req: Request, res: Response) => {
  try {
    const chains = await skillLibraryService.listActiveChains();

    res.json({
      chains,
      count: chains.length,
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error listing active chains:', error);
    sendFailure(res, error, 'Failed to list active chains', 500);
  }
});

/**
 * GET /api/skills/chains/:id - Get skill chain details
 */
chainsRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const chain = await skillLibraryService.getChain(id);

    if (!chain) {
      return res.status(404).json({ error: 'Skill chain not found' });
    }

    res.json({ chain });
  } catch (error) {
    console.error('[SkillsRoutes] Error getting skill chain:', error);
    sendFailure(res, error, 'Failed to get skill chain', 500);
  }
});

/**
 * PUT /api/skills/chains/:id - Update skill chain
 */
chainsRoutes.put('/:id', async (req: Request, res: Response) => {
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
    sendFailure(res, error, 'Failed to update skill chain', 400);
  }
});

/**
 * DELETE /api/skills/chains/:id - Delete skill chain
 */
chainsRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await skillLibraryService.deleteChain(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Skill chain not found' });
    }

    res.json({ message: 'Skill chain deleted successfully' });
  } catch (error) {
    console.error('[SkillsRoutes] Error deleting skill chain:', error);
    sendFailure(res, error, 'Failed to delete skill chain', 400);
  }
});

/**
 * POST /api/skills/chains/:id/activate - Activate skill chain
 */
chainsRoutes.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const chain = await skillLibraryService.activateChain(id);

    res.json({
      chain,
      message: 'Skill chain activated successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error activating skill chain:', error);
    sendFailure(res, error, 'Failed to activate skill chain', 400);
  }
});

/**
 * POST /api/skills/chains/:id/archive - Archive skill chain
 */
chainsRoutes.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const chain = await skillLibraryService.archiveChain(id);

    res.json({
      chain,
      message: 'Skill chain archived successfully',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error archiving skill chain:', error);
    sendFailure(res, error, 'Failed to archive skill chain', 400);
  }
});

/**
 * POST /api/skills/chains/:id/execute - Execute skill chain on a robot
 */
chainsRoutes.post('/:id/execute', async (req: Request, res: Response) => {
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
    sendFailure(res, error, 'Failed to execute skill chain', 500);
  }
});

skillsRoutes.use('/chains', chainsRoutes);

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
    sendFailure(res, error, 'Failed to create skill', 400);
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
    sendFailure(res, error, 'Failed to list skills', 500);
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
    sendFailure(res, error, 'Failed to list published skills', 500);
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
    sendFailure(res, error, 'Failed to get skills for robot', 400);
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
    sendFailure(res, error, 'Failed to get skill', 500);
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
    sendFailure(res, error, 'Failed to update skill', 400);
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
    sendFailure(res, error, 'Failed to delete skill', 400);
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
    sendFailure(res, error, 'Failed to publish skill', 400);
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
    sendFailure(res, error, 'Failed to deprecate skill', 400);
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
    sendFailure(res, error, 'Failed to archive skill', 400);
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
    sendFailure(res, error, 'Failed to validate parameters', 400);
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
    sendFailure(res, error, 'Failed to get compatible robots', 400);
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
    sendFailure(res, error, 'Failed to check compatibility', 400);
  }
});

// ============================================================================
// SKILL EXECUTION ROUTES
// ============================================================================

/**
 * POST /api/skills/:id/abort - Abort a running skill execution on a robot.
 * Forwards to the robot agent's /skills/abort endpoint. (TASK-146)
 */
skillsRoutes.post('/:id/abort', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as { robotId?: string };
    if (!body.robotId) {
      return res.status(400).json({ error: 'robotId is required' });
    }
    const aborted = await skillExecutionService.abortSkillOnRobot(id, body.robotId);
    if (!aborted) {
      return res.status(404).json({ error: 'No active execution to abort' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('[SkillsRoutes] Error aborting skill:', error);
    sendFailure(res, error, 'Failed to abort skill', 500);
  }
});

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
      // lerobot-rollout strategy (TASK-179 §5) — forwarded unchanged to the
      // robot agent by SkillExecutionService.
      rolloutStrategy: body.rolloutStrategy,
    };

    const result = await skillExecutionService.executeSkill(request);

    const statusCode = result.status === 'completed' ? 200 : 400;

    res.status(statusCode).json({
      result,
      message: result.status === 'completed' ? 'Skill executed successfully' : 'Skill execution failed',
    });
  } catch (error) {
    console.error('[SkillsRoutes] Error executing skill:', error);
    sendFailure(res, error, 'Failed to execute skill', 500);
  }
});

// (Skill chain routes are mounted at the top of this file via `chainsRoutes`
// to avoid being shadowed by the `/:id` route.)

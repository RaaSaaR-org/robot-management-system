/**
 * @file command.routes.ts
 * @description REST API routes for natural language command interpretation
 */

import { Router, type Request, type Response } from 'express';
import { commandInterpreter } from '../services/CommandInterpreter.js';
import { commandRepository } from '../repositories/index.js';

export const commandRoutes = Router();

/**
 * POST /interpret - Interpret a natural language command
 * Body:
 *   - text: string (required) - The natural language command
 *   - robotId: string (required) - Target robot ID
 *   - context?: object - Additional context for interpretation
 */
commandRoutes.post('/interpret', async (req: Request, res: Response) => {
  try {
    const { text, robotId, context } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Missing required field: text (string)',
      });
    }

    if (!robotId || typeof robotId !== 'string') {
      return res.status(400).json({
        error: 'Missing required field: robotId (string)',
      });
    }

    const interpretation = await commandInterpreter.interpretCommand({
      text,
      robotId,
      context,
    });

    res.json(interpretation);
  } catch (error) {
    console.error('Error interpreting command:', error);
    res.status(500).json({
      error: 'Failed to interpret command',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /history - Get command history with pagination
 * Query params:
 *   - page: number (default: 1)
 *   - pageSize: number (default: 50)
 *   - robotId: string (optional) - Filter by robot ID
 */
commandRoutes.get('/history', async (req: Request, res: Response) => {
  try {
    const { page, pageSize, robotId } = req.query;

    const pagination = {
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : 50,
    };

    let result;
    if (robotId && typeof robotId === 'string') {
      result = await commandRepository.findByRobotId(robotId, pagination);
    } else {
      result = await commandRepository.findAll(pagination);
    }

    // Transform to match frontend CommandHistoryEntry type
    // Frontend expects nested `interpretation` object, not flat structure
    const entries = result.entries.map((entry) => ({
      id: entry.id,
      robotId: entry.robotId,
      robotName: entry.robotId, // Use robotId as fallback for robotName
      originalText: entry.originalText,
      interpretation: {
        id: entry.id,
        originalText: entry.originalText,
        commandType: entry.commandType,
        parameters: entry.parameters,
        confidence: entry.confidence,
        safetyClassification: entry.safetyClassification,
        warnings: entry.warnings,
        suggestedAlternatives: entry.suggestedAlternatives,
        timestamp: entry.createdAt,
      },
      status: entry.status,
      createdAt: entry.createdAt,
      executedAt: entry.executedAt,
    }));

    res.json({ entries, pagination: result.pagination });
  } catch (error) {
    console.error('Error fetching command history:', error);
    res.status(500).json({ error: 'Failed to fetch command history' });
  }
});

/**
 * GET /:id - Get a single command interpretation by ID
 */
commandRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const interpretation = await commandRepository.findById(req.params.id);

    if (!interpretation) {
      return res.status(404).json({ error: 'Command interpretation not found' });
    }

    res.json(interpretation);
  } catch (error) {
    console.error('Error fetching command interpretation:', error);
    res.status(500).json({ error: 'Failed to fetch command interpretation' });
  }
});

/**
 * PATCH /:id/status - Update command interpretation status
 * Body:
 *   - status: string (required) - New status
 *   - executedCommandId?: string - ID of the executed command
 */
commandRoutes.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, executedCommandId } = req.body;

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        error: 'Missing required field: status (string)',
      });
    }

    const validStatuses = ['interpreted', 'confirmed', 'executed', 'cancelled', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const interpretation = await commandRepository.updateStatus(
      req.params.id,
      status as 'interpreted' | 'confirmed' | 'executed' | 'cancelled' | 'failed',
      executedCommandId
    );

    if (!interpretation) {
      return res.status(404).json({ error: 'Command interpretation not found' });
    }

    res.json(interpretation);
  } catch (error) {
    console.error('Error updating command status:', error);
    res.status(500).json({ error: 'Failed to update command status' });
  }
});

/**
 * DELETE /:id - Delete a command interpretation
 */
commandRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await commandRepository.delete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Command interpretation not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting command interpretation:', error);
    res.status(500).json({ error: 'Failed to delete command interpretation' });
  }
});

/**
 * @file legal-hold.routes.ts
 * @description REST API routes for legal hold management
 * @feature compliance
 */

import { Router, type Request, type Response } from 'express';
import { legalHoldService } from '../services/LegalHoldService.js';

export const legalHoldRoutes = Router();

/**
 * GET /legal-holds - List all legal holds
 * Query params:
 *   - activeOnly: boolean (default: false) - If true, only return active holds
 */
legalHoldRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const holds = activeOnly
      ? await legalHoldService.getActiveHolds()
      : await legalHoldService.getAllHolds();
    res.json({ holds });
  } catch (error) {
    console.error('Error fetching legal holds:', error);
    res.status(500).json({ error: 'Failed to fetch legal holds' });
  }
});

/**
 * GET /legal-holds/:id - Get a specific legal hold
 */
legalHoldRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const hold = await legalHoldService.getHold(req.params.id);

    if (!hold) {
      return res.status(404).json({ error: 'Legal hold not found' });
    }

    res.json(hold);
  } catch (error) {
    console.error('Error fetching legal hold:', error);
    res.status(500).json({ error: 'Failed to fetch legal hold' });
  }
});

/**
 * POST /legal-holds - Create a new legal hold
 * Body:
 *   - name: string (required)
 *   - reason: string (required)
 *   - createdBy: string (required) - User ID creating the hold
 *   - logIds: string[] (required) - Array of compliance log IDs to hold
 *   - endDate: string (optional) - ISO date string for expected end
 */
legalHoldRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { name, reason, createdBy, logIds, endDate } = req.body;

    if (!name || !reason || !createdBy || !logIds || !Array.isArray(logIds)) {
      return res.status(400).json({
        error: 'Missing required fields: name, reason, createdBy, logIds (array)',
      });
    }

    if (logIds.length === 0) {
      return res.status(400).json({
        error: 'logIds array must contain at least one log ID',
      });
    }

    const hold = await legalHoldService.createHold({
      name,
      reason,
      createdBy,
      logIds,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.status(201).json(hold);
  } catch (error) {
    console.error('Error creating legal hold:', error);
    res.status(500).json({ error: 'Failed to create legal hold' });
  }
});

/**
 * DELETE /legal-holds/:id - Release a legal hold
 */
legalHoldRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const hold = await legalHoldService.releaseHold(req.params.id);

    if (!hold) {
      return res.status(404).json({ error: 'Legal hold not found' });
    }

    res.json({ message: 'Legal hold released', hold });
  } catch (error) {
    console.error('Error releasing legal hold:', error);
    res.status(500).json({ error: 'Failed to release legal hold' });
  }
});

/**
 * POST /legal-holds/:id/logs - Add logs to an existing legal hold
 * Body:
 *   - logIds: string[] (required)
 */
legalHoldRoutes.post('/:id/logs', async (req: Request, res: Response) => {
  try {
    const { logIds } = req.body;

    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: logIds (non-empty array)',
      });
    }

    const hold = await legalHoldService.addLogsToHold({
      holdId: req.params.id,
      logIds,
    });

    if (!hold) {
      return res.status(404).json({ error: 'Legal hold not found or not active' });
    }

    res.json(hold);
  } catch (error) {
    console.error('Error adding logs to legal hold:', error);
    res.status(500).json({ error: 'Failed to add logs to legal hold' });
  }
});

/**
 * DELETE /legal-holds/:id/logs - Remove logs from a legal hold
 * Body:
 *   - logIds: string[] (required)
 */
legalHoldRoutes.delete('/:id/logs', async (req: Request, res: Response) => {
  try {
    const { logIds } = req.body;

    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: logIds (non-empty array)',
      });
    }

    const hold = await legalHoldService.removeLogsFromHold(req.params.id, logIds);

    if (!hold) {
      return res.status(404).json({ error: 'Legal hold not found' });
    }

    res.json(hold);
  } catch (error) {
    console.error('Error removing logs from legal hold:', error);
    res.status(500).json({ error: 'Failed to remove logs from legal hold' });
  }
});

/**
 * GET /legal-holds/check/:logId - Check if a log is under legal hold
 */
legalHoldRoutes.get('/check/:logId', async (req: Request, res: Response) => {
  try {
    const isUnderHold = await legalHoldService.isLogUnderHold(req.params.logId);
    res.json({ logId: req.params.logId, isUnderHold });
  } catch (error) {
    console.error('Error checking legal hold status:', error);
    res.status(500).json({ error: 'Failed to check legal hold status' });
  }
});

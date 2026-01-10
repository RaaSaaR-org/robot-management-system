/**
 * @file retention.routes.ts
 * @description REST API routes for retention policy management
 * @feature compliance
 */

import { Router, type Request, type Response } from 'express';
import { retentionPolicyService } from '../services/RetentionPolicyService.js';
import { retentionCleanupJob } from '../jobs/RetentionCleanupJob.js';
import type { ComplianceEventType } from '../types/compliance.types.js';

export const retentionRoutes = Router();

/**
 * GET /retention - List all retention policies
 */
retentionRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const policies = await retentionPolicyService.getAllPolicies();
    res.json({ policies });
  } catch (error) {
    console.error('Error fetching retention policies:', error);
    res.status(500).json({ error: 'Failed to fetch retention policies' });
  }
});

/**
 * GET /retention/:eventType - Get retention policy for a specific event type
 */
retentionRoutes.get('/:eventType', async (req: Request, res: Response) => {
  try {
    const { eventType } = req.params;
    const validEventTypes = ['ai_decision', 'safety_action', 'command_execution', 'system_event', 'access_audit'];

    if (!validEventTypes.includes(eventType)) {
      return res.status(400).json({
        error: `Invalid eventType. Must be one of: ${validEventTypes.join(', ')}`,
      });
    }

    const policy = await retentionPolicyService.getPolicy(eventType as ComplianceEventType);
    res.json(policy);
  } catch (error) {
    console.error('Error fetching retention policy:', error);
    res.status(500).json({ error: 'Failed to fetch retention policy' });
  }
});

/**
 * PUT /retention/:eventType - Set or update retention policy
 * Body:
 *   - retentionDays: number (required)
 *   - description: string (optional)
 */
retentionRoutes.put('/:eventType', async (req: Request, res: Response) => {
  try {
    const { eventType } = req.params;
    const { retentionDays, description } = req.body;

    const validEventTypes = ['ai_decision', 'safety_action', 'command_execution', 'system_event', 'access_audit'];

    if (!validEventTypes.includes(eventType)) {
      return res.status(400).json({
        error: `Invalid eventType. Must be one of: ${validEventTypes.join(', ')}`,
      });
    }

    if (typeof retentionDays !== 'number' || retentionDays < 1) {
      return res.status(400).json({
        error: 'retentionDays must be a positive number',
      });
    }

    const policy = await retentionPolicyService.setPolicy({
      eventType: eventType as ComplianceEventType,
      retentionDays,
      description,
    });

    res.json(policy);
  } catch (error) {
    console.error('Error setting retention policy:', error);
    res.status(500).json({ error: 'Failed to set retention policy' });
  }
});

/**
 * DELETE /retention/:eventType - Delete custom policy (reverts to default)
 */
retentionRoutes.delete('/:eventType', async (req: Request, res: Response) => {
  try {
    const { eventType } = req.params;
    const deleted = await retentionPolicyService.deletePolicy(eventType as ComplianceEventType);

    if (!deleted) {
      return res.status(404).json({ error: 'Custom policy not found' });
    }

    // Return the default policy
    const defaultPolicy = await retentionPolicyService.getPolicy(eventType as ComplianceEventType);
    res.json({ message: 'Custom policy deleted, reverted to default', policy: defaultPolicy });
  } catch (error) {
    console.error('Error deleting retention policy:', error);
    res.status(500).json({ error: 'Failed to delete retention policy' });
  }
});

/**
 * POST /retention/cleanup - Trigger manual cleanup
 */
retentionRoutes.post('/cleanup', async (_req: Request, res: Response) => {
  try {
    const result = await retentionCleanupJob.runCleanup();
    res.json(result);
  } catch (error) {
    console.error('Error running cleanup:', error);
    res.status(500).json({ error: 'Failed to run cleanup' });
  }
});

/**
 * GET /retention/stats - Get retention statistics
 */
retentionRoutes.get('/cleanup/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await retentionCleanupJob.getRetentionStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching retention stats:', error);
    res.status(500).json({ error: 'Failed to fetch retention stats' });
  }
});

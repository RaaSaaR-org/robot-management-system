/**
 * @file safety.routes.ts
 * @description REST API routes for safety management (E-stop, fleet safety)
 * @feature safety
 */

import { Router, type Request, type Response } from 'express';
import { safetyService } from '../services/SafetyService.js';

export const safetyRoutes = Router();

// ============================================================================
// INDIVIDUAL ROBOT SAFETY
// ============================================================================

/**
 * GET /safety/robots/:id - Get safety status for a single robot
 */
safetyRoutes.get('/robots/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const status = await safetyService.getRobotSafetyStatus(id);

    res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('not connected')) {
      return res.status(503).json({ error: message });
    }

    res.status(500).json({ error: 'Failed to get safety status' });
  }
});

/**
 * POST /safety/robots/:id/estop - Trigger E-stop on a single robot
 */
safetyRoutes.post('/robots/:id/estop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, triggeredBy } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await safetyService.triggerRobotEStop(
      id,
      reason,
      triggeredBy || 'server'
    );

    res.json({
      message: 'Emergency stop triggered',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('not connected')) {
      return res.status(503).json({ error: message });
    }

    res.status(500).json({ error: 'Failed to trigger E-stop' });
  }
});

/**
 * POST /safety/robots/:id/estop/reset - Reset E-stop on a single robot
 */
safetyRoutes.post('/robots/:id/estop/reset', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await safetyService.resetRobotEStop(id);

    res.json({
      message: 'E-stop reset successfully',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('not connected')) {
      return res.status(503).json({ error: message });
    }
    if (message.includes('Cannot reset')) {
      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: 'Failed to reset E-stop' });
  }
});

// ============================================================================
// FLEET-WIDE SAFETY
// ============================================================================

/**
 * GET /safety/fleet - Get safety status for all robots
 */
safetyRoutes.get('/fleet', async (_req: Request, res: Response) => {
  try {
    const status = await safetyService.getFleetSafetyStatus();

    res.json({
      timestamp: new Date().toISOString(),
      ...status,
    });
  } catch (error) {
    console.error('Error getting fleet safety status:', error);
    res.status(500).json({ error: 'Failed to get fleet safety status' });
  }
});

/**
 * POST /safety/fleet/estop - Trigger fleet-wide E-stop
 */
safetyRoutes.post('/fleet/estop', async (req: Request, res: Response) => {
  try {
    const { reason, triggeredBy } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await safetyService.triggerFleetEStop(
      reason,
      triggeredBy || 'server'
    );

    res.json({
      message: 'Fleet-wide emergency stop triggered',
      ...result,
    });
  } catch (error) {
    console.error('Error triggering fleet E-stop:', error);
    res.status(500).json({ error: 'Failed to trigger fleet E-stop' });
  }
});

/**
 * POST /safety/fleet/estop/reset - Reset fleet-wide E-stop
 */
safetyRoutes.post('/fleet/estop/reset', async (_req: Request, res: Response) => {
  try {
    const result = await safetyService.resetFleetEStop();

    res.json({
      message: 'Fleet E-stop reset initiated',
      ...result,
    });
  } catch (error) {
    console.error('Error resetting fleet E-stop:', error);
    res.status(500).json({ error: 'Failed to reset fleet E-stop' });
  }
});

// ============================================================================
// ZONE-BASED SAFETY
// ============================================================================

/**
 * POST /safety/zones/:id/estop - Trigger E-stop for all robots in a zone
 */
safetyRoutes.post('/zones/:id/estop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, triggeredBy } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await safetyService.triggerZoneEStop(
      id,
      reason,
      triggeredBy || 'server'
    );

    res.json({
      message: `Zone E-stop triggered for ${result.zoneName}`,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }

    console.error('Error triggering zone E-stop:', error);
    res.status(500).json({ error: 'Failed to trigger zone E-stop' });
  }
});

// ============================================================================
// E-STOP EVENT LOG
// ============================================================================

/**
 * GET /safety/events - Get E-stop event log
 */
safetyRoutes.get('/events', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const events = safetyService.getEStopLog(limit);

    res.json({
      events,
      count: events.length,
    });
  } catch (error) {
    console.error('Error getting E-stop events:', error);
    res.status(500).json({ error: 'Failed to get E-stop events' });
  }
});

// ============================================================================
// HEARTBEAT CONTROL
// ============================================================================

/**
 * POST /safety/heartbeats/start - Start sending heartbeats to robots
 */
safetyRoutes.post('/heartbeats/start', (req: Request, res: Response) => {
  try {
    const { intervalMs } = req.body;
    safetyService.startHeartbeats(intervalMs || 500);

    res.json({
      message: 'Heartbeats started',
      intervalMs: intervalMs || 500,
    });
  } catch (error) {
    console.error('Error starting heartbeats:', error);
    res.status(500).json({ error: 'Failed to start heartbeats' });
  }
});

/**
 * POST /safety/heartbeats/stop - Stop sending heartbeats
 */
safetyRoutes.post('/heartbeats/stop', (_req: Request, res: Response) => {
  try {
    safetyService.stopHeartbeats();

    res.json({
      message: 'Heartbeats stopped',
    });
  } catch (error) {
    console.error('Error stopping heartbeats:', error);
    res.status(500).json({ error: 'Failed to stop heartbeats' });
  }
});

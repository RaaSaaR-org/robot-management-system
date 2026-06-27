/**
 * @file scansession.routes.ts
 * @description REST routes for digital-twin scan sessions (TASK-170). The server
 *              drives the agent (scan/start, scan/stop) and runs the capture
 *              loop; these endpoints expose session lifecycle + frame listing.
 * @feature digitaltwin
 */

import { Router, type Request, type Response } from 'express';
import { scanSessionService } from '../services/ScanSessionService.js';

export const scanSessionRoutes = Router();

/**
 * POST /api/scan-sessions — start a sweep: creates the session, calls the
 * agent scan/start, and starts the server-side capture loop.
 */
scanSessionRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const robotId = typeof req.body?.robotId === 'string' ? req.body.robotId : undefined;
    const twinId = typeof req.body?.twinId === 'string' ? req.body.twinId : undefined;
    if (!robotId || !twinId) {
      return res.status(400).json({ error: 'robotId and twinId are required' });
    }
    const session = await scanSessionService.startSession({ robotId, twinId });
    res.status(201).json(session);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    console.error('[ScanSession] start error:', error);
    res.status(500).json({ error: 'Failed to start scan session' });
  }
});

/**
 * POST /api/scan-sessions/:id/stop — stop the sweep, call agent scan/stop, and
 * queue the sidecar build (session → processing).
 */
scanSessionRoutes.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const session = await scanSessionService.stopSession(req.params.id);
    res.json(session);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    console.error('[ScanSession] stop error:', error);
    res.status(500).json({ error: 'Failed to stop scan session' });
  }
});

/**
 * GET /api/scan-sessions/:id — fetch one session.
 */
scanSessionRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const session = await scanSessionService.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Scan session not found' });
    res.json(session);
  } catch (error) {
    console.error('[ScanSession] get error:', error);
    res.status(500).json({ error: 'Failed to get scan session' });
  }
});

/**
 * GET /api/scan-sessions/:id/frames — list the recorded frames of a sweep.
 */
scanSessionRoutes.get('/:id/frames', async (req: Request, res: Response) => {
  try {
    const frames = await scanSessionService.listFrames(req.params.id);
    res.json({ frames });
  } catch (error) {
    console.error('[ScanSession] frames error:', error);
    res.status(500).json({ error: 'Failed to list session frames' });
  }
});

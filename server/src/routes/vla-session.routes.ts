/**
 * @file vla-session.routes.ts
 * @description REST API routes for VLA session compliance logging
 * @feature robots
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/index.js';

export const vlaSessionRoutes = Router();

/**
 * POST /api/robots/:robotId/vla-sessions - Create a new VLA session
 */
vlaSessionRoutes.post('/:robotId/vla-sessions', async (req: Request, res: Response) => {
  try {
    const { robotId } = req.params;
    const { prompt, serverUrl } = req.body;

    if (!prompt || !serverUrl) {
      return res.status(400).json({ error: 'prompt and serverUrl are required' });
    }

    // Verify robot exists
    const robot = await prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    const session = await prisma.vlaSession.create({
      data: {
        robotId,
        prompt,
        serverUrl,
        status: 'running',
      },
    });

    res.status(201).json(session);
  } catch (error) {
    console.error('[VlaSession] Error creating session:', error);
    res.status(500).json({ error: 'Failed to create VLA session' });
  }
});

/**
 * PATCH /api/robots/:robotId/vla-sessions/:sessionId/stop - Stop a VLA session
 */
vlaSessionRoutes.patch('/:robotId/vla-sessions/:sessionId/stop', async (req: Request, res: Response) => {
  try {
    const { robotId, sessionId } = req.params;
    const { errorMsg } = req.body as { errorMsg?: string };

    const session = await prisma.vlaSession.findFirst({
      where: { id: sessionId, robotId },
    });

    if (!session) {
      return res.status(404).json({ error: 'VLA session not found' });
    }

    if (session.status !== 'running') {
      return res.status(400).json({ error: 'Session is not running' });
    }

    const updated = await prisma.vlaSession.update({
      where: { id: sessionId },
      data: {
        stoppedAt: new Date(),
        status: errorMsg ? 'error' : 'stopped',
        errorMsg: errorMsg ?? null,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('[VlaSession] Error stopping session:', error);
    res.status(500).json({ error: 'Failed to stop VLA session' });
  }
});

/**
 * GET /api/robots/:robotId/vla-sessions - List VLA sessions for a robot
 */
vlaSessionRoutes.get('/:robotId/vla-sessions', async (req: Request, res: Response) => {
  try {
    const { robotId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const sessions = await prisma.vlaSession.findMany({
      where: { robotId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    res.json({ sessions });
  } catch (error) {
    console.error('[VlaSession] Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list VLA sessions' });
  }
});

/**
 * GET /api/robots/:robotId/vla-sessions/active - Get active VLA session
 */
vlaSessionRoutes.get('/:robotId/vla-sessions/active', async (req: Request, res: Response) => {
  try {
    const { robotId } = req.params;

    const session = await prisma.vlaSession.findFirst({
      where: { robotId, status: 'running' },
      orderBy: { startedAt: 'desc' },
    });

    res.json({ session: session ?? null });
  } catch (error) {
    console.error('[VlaSession] Error fetching active session:', error);
    res.status(500).json({ error: 'Failed to fetch active VLA session' });
  }
});

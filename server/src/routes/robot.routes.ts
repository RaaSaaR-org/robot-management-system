/**
 * @file robot.routes.ts
 * @description REST API routes for robot management
 */

import { Router, type Request, type Response } from 'express';
import { robotManager } from '../services/RobotManager.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from '../services/HttpClient.js';
import { prisma } from '../database/index.js';

export const robotRoutes = Router();

/**
 * POST /register - Register a robot from URL
 */
robotRoutes.post('/register', async (req: Request, res: Response) => {
  try {
    const { robotUrl } = req.body;

    if (!robotUrl) {
      return res.status(400).json({ error: 'robotUrl is required' });
    }

    // Validate URL format
    try {
      new URL(robotUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const registered = await robotManager.registerRobot(robotUrl);

    res.json({
      robot: registered.robot,
      endpoints: registered.endpoints,
      agentCard: registered.agentCard,
    });
  } catch (error) {
    console.error('Error registering robot:', error);
    // Don't leak internal error details - return generic message
    const internalMessage = error instanceof Error ? error.message : 'Unknown error';
    // Only expose specific expected errors
    if (internalMessage.includes('ECONNREFUSED') || internalMessage.includes('fetch failed')) {
      return res.status(502).json({ error: 'Unable to connect to robot. Please check the URL and ensure the robot is online.' });
    }
    res.status(500).json({ error: 'Failed to register robot' });
  }
});

/**
 * GET / - List all registered robots
 */
robotRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const robots = await robotManager.listRobots();
    res.json({
      robots,
      pagination: {
        page: 1,
        pageSize: robots.length,
        total: robots.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error('Error listing robots:', error);
    res.status(500).json({ error: 'Failed to list robots' });
  }
});

/**
 * GET /:id - Get a single robot by ID
 */
robotRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const robot = await robotManager.getRobot(req.params.id);

    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    res.json(robot);
  } catch (error) {
    console.error('Error getting robot:', error);
    res.status(500).json({ error: 'Failed to get robot' });
  }
});

/**
 * DELETE /:id - Unregister a robot
 */
robotRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await robotManager.unregisterRobot(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error unregistering robot:', error);
    res.status(500).json({ error: 'Failed to unregister robot' });
  }
});

/**
 * POST /:id/command - Send command to robot
 */
robotRoutes.post('/:id/command', async (req: Request, res: Response) => {
  try {
    const { type, payload, priority } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Command type is required' });
    }

    const command = await robotManager.sendCommand(req.params.id, {
      type,
      payload,
      priority,
    });

    res.json(command);
  } catch (error) {
    console.error('Error sending command:', error);
    const internalMessage = error instanceof Error ? error.message : 'Unknown error';

    // Only expose expected errors, hide internal details
    if (internalMessage.toLowerCase().includes('not found')) {
      return res.status(404).json({ error: 'Robot not found' });
    }
    if (internalMessage.includes('ECONNREFUSED') || internalMessage.includes('timeout')) {
      return res.status(502).json({ error: 'Unable to communicate with robot' });
    }

    res.status(500).json({ error: 'Failed to send command' });
  }
});

/**
 * GET /:id/telemetry - Get robot telemetry
 */
robotRoutes.get('/:id/telemetry', async (req: Request, res: Response) => {
  try {
    const telemetry = await robotManager.getTelemetry(req.params.id);
    res.json(telemetry);
  } catch (error) {
    console.error('Error getting telemetry:', error);
    const internalMessage = error instanceof Error ? error.message : 'Unknown error';

    // Only expose expected errors, hide internal details
    if (internalMessage.toLowerCase().includes('not found')) {
      return res.status(404).json({ error: 'Robot not found' });
    }
    if (internalMessage.includes('ECONNREFUSED') || internalMessage.includes('timeout')) {
      return res.status(502).json({ error: 'Unable to communicate with robot' });
    }

    res.status(500).json({ error: 'Failed to get telemetry' });
  }
});

// ============================================================================
// VLA PROXY ROUTES (TASK-077) — forward to robot agent VLA endpoints
// ============================================================================

/**
 * GET /:id/proxy/vla — Proxy VLA status from robot agent
 */
robotRoutes.get('/:id/proxy/vla', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
    const data = await httpClient.get(`/api/v1/robots/${req.params.id}/vla`);
    res.json(data);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    console.error('[VLA Proxy] Status error:', error);
    res.status(500).json({ error: 'Failed to get VLA status' });
  }
});

/**
 * POST /:id/proxy/vla/start — Proxy VLA start + create VlaSession
 */
robotRoutes.post('/:id/proxy/vla/start', async (req: Request, res: Response) => {
  try {
    const { id: robotId } = req.params;
    const { instruction, config: vlaConfig } = req.body;

    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }

    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Forward to robot agent
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.LONG);
    const data = await httpClient.post(`/api/v1/robots/${robotId}/vla/start`, {
      instruction,
      config: vlaConfig,
    });

    // Create VlaSession in DB for compliance logging
    const serverUrl = (vlaConfig as { serverUrl?: string } | undefined)?.serverUrl ?? 'unknown';
    const session = await prisma.vlaSession.create({
      data: {
        robotId,
        prompt: instruction,
        serverUrl,
        status: 'running',
      },
    });

    res.json({ ...data as object, sessionId: session.id });
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    console.error('[VLA Proxy] Start error:', error);
    res.status(500).json({ error: 'Failed to start VLA' });
  }
});

/**
 * POST /:id/proxy/vla/stop — Proxy VLA stop + update VlaSession
 */
robotRoutes.post('/:id/proxy/vla/stop', async (req: Request, res: Response) => {
  try {
    const { id: robotId } = req.params;

    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Forward to robot agent
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.LONG);
    const data = await httpClient.post(`/api/v1/robots/${robotId}/vla/stop`);

    // Stop active VlaSession in DB
    const activeSession = await prisma.vlaSession.findFirst({
      where: { robotId, status: 'running' },
      orderBy: { startedAt: 'desc' },
    });
    if (activeSession) {
      await prisma.vlaSession.update({
        where: { id: activeSession.id },
        data: { stoppedAt: new Date(), status: 'stopped' },
      });
    }

    res.json(data);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    console.error('[VLA Proxy] Stop error:', error);
    res.status(500).json({ error: 'Failed to stop VLA' });
  }
});

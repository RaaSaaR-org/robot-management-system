/**
 * @file robot.routes.ts
 * @description REST API routes for robot management
 */

import { Router, type Request, type Response } from 'express';
import { robotManager } from '../services/RobotManager.js';

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
    const message = error instanceof Error ? error.message : 'Failed to register robot';
    res.status(500).json({ error: message });
  }
});

/**
 * GET / - List all registered robots
 */
robotRoutes.get('/', (_req: Request, res: Response) => {
  try {
    const robots = robotManager.listRobots();
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
robotRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    const robot = robotManager.getRobot(req.params.id);

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
robotRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = robotManager.unregisterRobot(req.params.id);

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
    const message = error instanceof Error ? error.message : 'Failed to send command';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }

    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get telemetry';

    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }

    res.status(500).json({ error: message });
  }
});

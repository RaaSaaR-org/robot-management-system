/**
 * @file rest-routes.ts
 * @description REST API routes compatible with RoboMindOS robot interface
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RobotStateManager } from '../robot/state.js';
import type { RobotCommandRequest, RegistrationInfo } from '../robot/types.js';
import { config } from '../config/config.js';

export function createRestRoutes(robotStateManager: RobotStateManager): Router {
  const router = Router();

  // GET /robots/:id - Get robot details (RoboMindOS compatible)
  router.get('/robots/:id', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }
    res.json(robot);
  });

  // POST /robots/:id/command - Send command to robot
  router.post('/robots/:id/command', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const commandRequest: RobotCommandRequest = req.body;

    if (!commandRequest.type) {
      res.status(400).json({
        code: 'INVALID_COMMAND',
        message: 'Command type is required',
      });
      return;
    }

    try {
      const command = await robotStateManager.executeCommand(
        commandRequest.type,
        commandRequest.payload || {}
      );
      res.json(command);
    } catch (error: any) {
      res.status(500).json({
        code: 'COMMAND_FAILED',
        message: error.message,
      });
    }
  });

  // GET /robots/:id/telemetry - Get current telemetry
  router.get('/robots/:id/telemetry', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const telemetry = robotStateManager.getTelemetry();
    res.json(telemetry);
  });

  // GET /robots/:id/commands - Get command history
  router.get('/robots/:id/commands', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const commands = robotStateManager.getCommandHistory();
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;

    const startIndex = (page - 1) * pageSize;
    const paginatedCommands = commands.slice(startIndex, startIndex + pageSize);

    res.json({
      commands: paginatedCommands,
      pagination: {
        page,
        pageSize,
        total: commands.length,
        totalPages: Math.ceil(commands.length / pageSize),
      },
    });
  });

  // GET /register - Registration info for RoboMindOS
  router.get('/register', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    const registrationInfo: RegistrationInfo = {
      robot,
      endpoints: {
        robot: `/api/v1/robots/${robot.id}`,
        command: `/api/v1/robots/${robot.id}/command`,
        telemetry: `/api/v1/robots/${robot.id}/telemetry`,
        telemetryWs: `ws://localhost:${config.port}/ws/telemetry/${robot.id}`,
      },
      a2a: {
        agentCard: `/.well-known/agent-card.json`,
      },
    };
    res.json(registrationInfo);
  });

  // GET /health - Health check endpoint
  router.get('/health', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    res.json({
      status: 'healthy',
      robotId: robot.id,
      robotStatus: robot.status,
      batteryLevel: robot.batteryLevel,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

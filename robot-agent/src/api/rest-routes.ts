/**
 * @file rest-routes.ts
 * @description REST API routes compatible with RoboMindOS robot interface
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RobotStateManager } from '../robot/state.js';
import type {
  RobotCommandRequest,
  RegistrationInfo,
  PushedTask,
  TaskStatusUpdateRequest,
} from '../robot/types.js';
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Command execution failed';
      res.status(500).json({
        code: 'COMMAND_FAILED',
        message: errorMessage,
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

  // ============================================================================
  // TASK ENDPOINTS (for server push model)
  // ============================================================================

  // POST /robots/:id/tasks - Receive a pushed task from server
  router.post('/robots/:id/tasks', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const task: PushedTask = req.body;

    if (!task.id || !task.actionType) {
      res.status(400).json({
        code: 'INVALID_TASK',
        message: 'Task id and actionType are required',
      });
      return;
    }

    try {
      // Queue the task for execution
      const accepted = await robotStateManager.acceptTask(task);
      if (accepted) {
        console.log(`[Task] Accepted task ${task.id}: ${task.instruction}`);
        res.status(202).json({
          taskId: task.id,
          status: 'accepted',
          message: 'Task queued for execution',
          queuePosition: robotStateManager.getTaskQueueLength(),
        });
      } else {
        res.status(503).json({
          code: 'ROBOT_UNAVAILABLE',
          message: 'Robot cannot accept tasks at this time',
          robotStatus: robot.status,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to accept task';
      res.status(500).json({
        code: 'TASK_ACCEPT_FAILED',
        message: errorMessage,
      });
    }
  });

  // GET /robots/:id/tasks - Get task queue
  router.get('/robots/:id/tasks', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const tasks = robotStateManager.getTaskQueue();
    res.json({
      robotId: robot.id,
      tasks,
      queueLength: tasks.length,
      currentTask: robotStateManager.getCurrentTask(),
    });
  });

  // POST /robots/:id/reset - Reset robot state (for testing/recovery)
  router.post('/robots/:id/reset', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    robotStateManager.reset();
    const updatedRobot = robotStateManager.getRobotInterface();
    res.json({
      message: 'Robot reset successfully',
      robot: updatedRobot,
    });
  });

  // DELETE /robots/:id/tasks/:taskId - Cancel a task
  router.delete('/robots/:id/tasks/:taskId', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const { taskId } = req.params;
    const cancelled = await robotStateManager.cancelTask(taskId);

    if (cancelled) {
      res.json({
        taskId,
        status: 'cancelled',
        message: 'Task cancelled successfully',
      });
    } else {
      res.status(404).json({
        code: 'TASK_NOT_FOUND',
        message: `Task ${taskId} not found or already completed`,
      });
    }
  });

  return router;
}

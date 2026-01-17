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

  // ============================================================================
  // SAFETY ENDPOINTS (per ISO 10218-1, ISO/TS 15066, MR Annex III)
  // ============================================================================

  // GET /robots/:id/safety - Get safety status
  router.get('/robots/:id/safety', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const safetyStatus = robotStateManager.getSafetyStatus();
    res.json({
      robotId: robot.id,
      ...safetyStatus,
    });
  });

  // GET /robots/:id/safety/estop - Get E-stop state
  router.get('/robots/:id/safety/estop', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const estopState = robotStateManager.getEStopState();
    res.json({
      robotId: robot.id,
      ...estopState,
    });
  });

  // POST /robots/:id/safety/estop - Trigger emergency stop
  router.post('/robots/:id/safety/estop', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const { reason, triggeredBy } = req.body;

    robotStateManager.triggerEmergencyStop(
      triggeredBy || 'remote',
      reason || 'Remote E-stop triggered'
    );

    // Update server heartbeat since we received communication
    robotStateManager.updateServerHeartbeat();

    const estopState = robotStateManager.getEStopState();
    res.json({
      robotId: robot.id,
      message: 'Emergency stop triggered',
      ...estopState,
    });
  });

  // POST /robots/:id/safety/estop/reset - Reset E-stop
  router.post('/robots/:id/safety/estop/reset', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    // Update server heartbeat
    robotStateManager.updateServerHeartbeat();

    const success = robotStateManager.resetEmergencyStop();
    const estopState = robotStateManager.getEStopState();

    if (success) {
      res.json({
        robotId: robot.id,
        message: 'E-stop reset successfully',
        ...estopState,
      });
    } else {
      res.status(400).json({
        code: 'ESTOP_RESET_FAILED',
        message: 'Cannot reset E-stop - safety conditions not met',
        ...estopState,
      });
    }
  });

  // GET /robots/:id/safety/events - Get safety event log
  router.get('/robots/:id/safety/events', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const events = robotStateManager.getSafetyEvents(limit);

    res.json({
      robotId: robot.id,
      events,
      count: events.length,
    });
  });

  // PUT /robots/:id/safety/mode - Set operating mode
  router.put('/robots/:id/safety/mode', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const { mode } = req.body;
    const validModes = ['automatic', 'manual_reduced_speed', 'manual_full_speed'];

    if (!mode || !validModes.includes(mode)) {
      res.status(400).json({
        code: 'INVALID_MODE',
        message: `Invalid operating mode. Must be one of: ${validModes.join(', ')}`,
      });
      return;
    }

    robotStateManager.setOperatingMode(mode);
    robotStateManager.updateServerHeartbeat();

    res.json({
      robotId: robot.id,
      message: `Operating mode set to ${mode}`,
      mode,
      speedLimit: robotStateManager.getEffectiveSpeedLimit(),
    });
  });

  // POST /robots/:id/safety/heartbeat - Server heartbeat
  router.post('/robots/:id/safety/heartbeat', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    robotStateManager.updateServerHeartbeat();

    res.json({
      robotId: robot.id,
      message: 'Heartbeat received',
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // VLA CONTROL ENDPOINTS (Task 46)
  // ============================================================================

  // GET /robots/:id/vla - Get VLA control status
  router.get('/robots/:id/vla', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const vlaStatus = robotStateManager.getVLAStatus();

    res.json({
      robotId: robot.id,
      active: robotStateManager.isVLAActive(),
      status: vlaStatus,
    });
  });

  // POST /robots/:id/vla/start - Start VLA control
  router.post('/robots/:id/vla/start', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const { instruction, config: vlaConfig } = req.body;

    if (!instruction) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'instruction is required to start VLA control',
      });
      return;
    }

    try {
      await robotStateManager.startVLAControl(instruction, vlaConfig);

      res.json({
        robotId: robot.id,
        message: 'VLA control started',
        instruction,
        status: robotStateManager.getVLAStatus(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start VLA control';
      res.status(500).json({
        code: 'VLA_START_FAILED',
        message: errorMessage,
      });
    }
  });

  // POST /robots/:id/vla/stop - Stop VLA control
  router.post('/robots/:id/vla/stop', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    try {
      await robotStateManager.stopVLAControl();

      res.json({
        robotId: robot.id,
        message: 'VLA control stopped',
        active: robotStateManager.isVLAActive(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to stop VLA control';
      res.status(500).json({
        code: 'VLA_STOP_FAILED',
        message: errorMessage,
      });
    }
  });

  // POST /robots/:id/vla/pause - Pause VLA control
  router.post('/robots/:id/vla/pause', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    robotStateManager.pauseVLAControl();

    res.json({
      robotId: robot.id,
      message: 'VLA control paused',
      status: robotStateManager.getVLAStatus(),
    });
  });

  // POST /robots/:id/vla/resume - Resume VLA control
  router.post('/robots/:id/vla/resume', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    robotStateManager.resumeVLAControl();

    res.json({
      robotId: robot.id,
      message: 'VLA control resumed',
      status: robotStateManager.getVLAStatus(),
    });
  });

  // ============================================================================
  // VLA MODEL MANAGEMENT ENDPOINTS (Task 47)
  // ============================================================================

  // POST /robots/:id/vla/model/switch - Switch VLA model version
  router.post('/robots/:id/vla/model/switch', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const { modelVersionId, artifactUri, rollback } = req.body;

    if (!modelVersionId || !artifactUri) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'modelVersionId and artifactUri are required',
      });
      return;
    }

    try {
      const result = await robotStateManager.switchVLAModel({
        modelVersionId,
        artifactUri,
        rollback: rollback ?? false,
      });

      if (result.success) {
        res.json({
          robotId: robot.id,
          previousModelVersion: result.previousModelVersion,
          newModelVersion: result.newModelVersion,
          status: 'switched',
          switchTimeMs: result.switchTimeMs,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          robotId: robot.id,
          previousModelVersion: result.previousModelVersion,
          newModelVersion: result.newModelVersion,
          status: 'failed',
          error: result.error,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to switch model';
      res.status(500).json({
        code: 'MODEL_SWITCH_FAILED',
        message: errorMessage,
      });
    }
  });

  // GET /robots/:id/vla/model - Get current VLA model info
  router.get('/robots/:id/vla/model', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    res.json({
      robotId: robot.id,
      currentModelVersion: robotStateManager.getVLAModelVersion(),
      timestamp: new Date().toISOString(),
    });
  });

  // GET /robots/:id/vla/metrics - Get VLA inference metrics
  router.get('/robots/:id/vla/metrics', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    res.json({
      robotId: robot.id,
      metrics: robotStateManager.getVLAInferenceMetrics(),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

/**
 * @file rest-routes.ts
 * @description REST API routes compatible with NeoDEM robot interface
 * @status live
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { RobotStateManager } from '../robot/state.js';
import type {
  RobotCommandRequest,
  RegistrationInfo,
  PushedTask,
  TaskStatusUpdateRequest,
} from '../robot/types.js';
import { config } from '../config/config.js';
import type { DeviceIdentityManager } from '../security/device-identity.js';
import type { SecureBootVerifier } from '../security/secure-boot.js';
import { SkillExecutor, skillExecutorRegistry } from '../vla/skill-executor.js';
import { RolloutStrategies, type RolloutStrategy } from '../vla/types.js';

export function createRestRoutes(
  robotStateManager: RobotStateManager,
  deviceIdentity?: DeviceIdentityManager,
  secureBoot?: SecureBootVerifier,
): Router {
  const router = Router();

  // Any inbound REST call proves the control plane can reach this agent —
  // count it as server liveness so the communication-timeout protective stop
  // only fires (and only persists) when traffic has actually ceased, not just
  // when the dedicated /safety/heartbeat endpoint goes unused.
  router.use((_req: Request, _res: Response, next: NextFunction) => {
    robotStateManager.updateServerHeartbeat();
    next();
  });

  // GET /robots/:id - Get robot details (NeoDEM compatible)
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

  // GET /robots/:id/pointcloud - Get a point-cloud frame from a depth/LiDAR sensor.
  // Query: ?sensor=<name> (defaults to the primary sensor), ?full=true for a
  // full-resolution capture (used by the server's scan-capture path).
  router.get('/robots/:id/pointcloud', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const sensorName = typeof req.query.sensor === 'string' ? req.query.sensor : undefined;
    const full = req.query.full === 'true' || req.query.full === '1';

    try {
      const frame = await robotStateManager.getPointCloudFrame(sensorName, { full });
      res.json(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate point cloud';
      res.status(500).json({ code: 'POINTCLOUD_FAILED', message });
    }
  });

  // POST /robots/:id/pointcloud/lidar/switch — toggle the physical LiDAR via
  // the hardware sidecar (rt/utlidar/switch: a sensor enable, no motion).
  // Body: {on: boolean}. Always 200 with {ok, lidar?, error?} unless the
  // request itself is malformed — transport problems surface as ok:false.
  router.post('/robots/:id/pointcloud/lidar/switch', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({ code: 'ROBOT_NOT_FOUND', message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}` });
      return;
    }
    const on = req.body?.on;
    if (typeof on !== 'boolean') {
      res.status(400).json({ ok: false, error: 'body must be {on: boolean}' });
      return;
    }
    res.json(await robotStateManager.setLidarSwitch(on));
  });

  // Scan sessions (digital-twin sweep): start/stop/status. While a session is
  // active the /pointcloud endpoint returns pose-dependent slices of one fixed
  // world room, so accumulated frames reconstruct the room as the robot walks.
  router.post('/robots/:id/pointcloud/scan/start', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({ code: 'ROBOT_NOT_FOUND', message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}` });
      return;
    }
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    res.status(201).json(robotStateManager.startScanSession({ sessionId }));
  });

  router.post('/robots/:id/pointcloud/scan/stop', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({ code: 'ROBOT_NOT_FOUND', message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}` });
      return;
    }
    res.json(robotStateManager.stopScanSession());
  });

  router.get('/robots/:id/pointcloud/scan/status', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({ code: 'ROBOT_NOT_FOUND', message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}` });
      return;
    }
    res.json(robotStateManager.getScanStatus());
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

  // GET /register - Registration info for NeoDEM
  router.get('/register', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    const registrationInfo: RegistrationInfo = {
      robot,
      endpoints: {
        robot: `/api/v1/robots/${robot.id}`,
        command: `/api/v1/robots/${robot.id}/command`,
        telemetry: `/api/v1/robots/${robot.id}/telemetry`,
        telemetryWs: `ws://localhost:${config.port}/ws/telemetry/${robot.id}`,
        pointCloud: `/api/v1/robots/${robot.id}/pointcloud`,
        pointCloudWs: `ws://localhost:${config.port}/ws/pointcloud/${robot.id}`,
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
    const telemetry = robotStateManager.getTelemetry();
    res.json({
      status: 'healthy',
      robotId: robot.id,
      robotStatus: robot.status,
      batteryLevel: telemetry.batteryLevel,
      powerSource: telemetry.powerSource,
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // TASK ENDPOINTS (for server push model)
  // ============================================================================

  // POST /robots/:id/skills/execute - Execute a Skill on this robot.
  //
  // TASK-146 closes the loop:
  //   1. If a `linkedModelVersionId` + `artifactUri` are provided and the
  //      robot's currently-loaded model differs, switch the VLA adapter via
  //      vla-server `/load-adapter` (real, not simulated).
  //   2. Run the closed-loop SkillExecutor: observe → /predict → execute →
  //      repeat. On hardware it drives the sidecar HTTP endpoints (snapshot /
  //      state/fast / action). In sim it runs the same loop with synthetic
  //      frames.
  //   3. TASK-179: an optional `rolloutStrategy` body field selects a
  //      LeRobot-0.6.0-style rollout strategy ('default' | 'sentry' |
  //      'highlight' | 'dagger'); the result carries `output.rollout` metadata.
  //
  // The companion `POST /robots/:id/skills/abort` route below stops it.
  router.post('/robots/:id/skills/execute', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const body = req.body as {
      skillId?: string;
      skillName?: string;
      skillVersion?: string;
      parameters?: Record<string, unknown>;
      timeout?: number;
      linkedModelVersionId?: string;
      artifactUri?: string;
      taskPrompt?: string;
      maxSteps?: number;
      rolloutStrategy?: string;
    };

    if (!body.skillId) {
      res.status(400).json({ status: 'failed', error: 'skillId is required' });
      return;
    }

    // TASK-179: optional rollout strategy — defaults to 'default' (unchanged behavior).
    const rolloutStrategy = (body.rolloutStrategy ?? 'default') as RolloutStrategy;
    if (!RolloutStrategies.includes(rolloutStrategy)) {
      res.status(400).json({
        status: 'failed',
        error: `Invalid rolloutStrategy '${body.rolloutStrategy}'. Must be one of: ${RolloutStrategies.join(', ')}`,
      });
      return;
    }

    // 1. Adapter swap (best-effort: only if a model version + artifact are
    //    provided AND it differs from the currently-loaded model).
    if (body.linkedModelVersionId && body.artifactUri) {
      const current = robotStateManager.getVLAModelVersion();
      if (current !== body.linkedModelVersionId) {
        console.log(
          `[Skill] Loading adapter for skill ${body.skillName ?? body.skillId}: ${body.linkedModelVersionId}`
        );
        const switchResult = await robotStateManager.switchVLAModel({
          modelVersionId: body.linkedModelVersionId,
          artifactUri: body.artifactUri,
        });
        if (!switchResult.success) {
          res.status(502).json({
            status: 'failed',
            error: `Adapter load failed: ${switchResult.error ?? 'unknown'}`,
          });
          return;
        }
      }
    }

    // 2. Closed loop.
    const taskPrompt =
      body.taskPrompt ??
      (typeof body.parameters?.taskPrompt === 'string' ? body.parameters.taskPrompt : '') ??
      `Execute skill ${body.skillName ?? body.skillId}`;
    const maxSteps =
      body.maxSteps ??
      (typeof body.parameters?.maxSteps === 'number' ? body.parameters.maxSteps : 200);
    // The server's `timeout` field is the skill timeout in **seconds** (from
    // SkillDefinition). Convert to milliseconds. Default 60s.
    const timeoutMs = body.timeout != null ? body.timeout * 1000 : 60_000;

    const executor = new SkillExecutor(robotStateManager);
    skillExecutorRegistry.register(body.skillId, executor);
    console.log(
      `[Skill] Running ${body.skillName ?? body.skillId} on robot ${robot.id} (maxSteps=${maxSteps}, timeoutMs=${timeoutMs}, strategy=${rolloutStrategy})`
    );

    let result;
    try {
      result = await executor.run({
        skillId: body.skillId,
        taskPrompt: taskPrompt as string,
        maxSteps,
        timeoutMs,
        rolloutStrategy,
        robotId: robot.id,
      });
    } finally {
      skillExecutorRegistry.unregister(body.skillId);
    }

    console.log(
      `[Skill] ${body.skillName ?? body.skillId}: ${result.status} after ${result.steps} steps in ${result.durationMs}ms`
    );

    if (result.status === 'failed' || result.status === 'timeout') {
      res.status(result.status === 'timeout' ? 504 : 500).json({
        status: 'failed',
        error: result.error ?? result.message ?? result.status,
        // rollout metadata matters most on failure (highlight → incidentId).
        output: { steps: result.steps, durationMs: result.durationMs, rollout: result.rollout },
      });
      return;
    }

    res.json({
      status: result.status, // 'completed' | 'aborted'
      output: {
        skillId: body.skillId,
        skillName: body.skillName,
        linkedModelVersionId: body.linkedModelVersionId ?? null,
        steps: result.steps,
        durationMs: result.durationMs,
        lastAction: result.lastAction,
        message: result.message,
        rollout: result.rollout,
      },
    });
  });

  // POST /robots/:id/skills/abort - Abort a running skill execution.
  router.post('/robots/:id/skills/abort', (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }
    const { skillId } = req.body as { skillId?: string };
    if (!skillId) {
      res.status(400).json({ error: 'skillId is required' });
      return;
    }
    const aborted = skillExecutorRegistry.abort(skillId);
    if (!aborted) {
      res.status(404).json({ error: `No active execution for skill ${skillId}` });
      return;
    }
    res.status(204).send();
  });

  // POST /robots/:id/evaluation/run - Run N closed-loop episodes for a skill
  // and report each one to the server's /api/evaluation/episodes endpoint.
  // (TASK-146 / Phase C). Returns a summary; per-episode rows live on the server.
  router.post('/robots/:id/evaluation/run', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const body = req.body as {
      skillId?: string;
      modelVersionId?: string;
      artifactUri?: string;
      taskPrompt?: string;
      episodes?: number;
      maxStepsPerEpisode?: number;
      timeoutMsPerEpisode?: number;
      serverBaseUrl?: string; // override for tests
    };

    if (!body.skillId || !body.taskPrompt) {
      res.status(400).json({ error: 'skillId and taskPrompt are required' });
      return;
    }

    // Optional adapter swap before evaluation
    if (body.modelVersionId && body.artifactUri) {
      const current = robotStateManager.getVLAModelVersion();
      if (current !== body.modelVersionId) {
        const sw = await robotStateManager.switchVLAModel({
          modelVersionId: body.modelVersionId,
          artifactUri: body.artifactUri,
        });
        if (!sw.success) {
          res.status(502).json({ error: `Adapter load failed: ${sw.error}` });
          return;
        }
      }
    }

    const episodes = Math.max(1, Math.min(body.episodes ?? 5, 50));
    const maxSteps = body.maxStepsPerEpisode ?? 200;
    const timeoutMs = body.timeoutMsPerEpisode ?? 60_000;
    const serverBaseUrl = body.serverBaseUrl ?? process.env.NEODEM_SERVER_URL ?? 'http://localhost:3001';

    const results: Array<{
      index: number;
      status: string;
      steps: number;
      durationMs: number;
      error?: string;
    }> = [];
    const overallStartedAt = new Date();

    for (let i = 0; i < episodes; i++) {
      const startedAt = new Date();
      const executor = new SkillExecutor(robotStateManager);
      // Track on the same registry so an abort on the skill aborts the eval too.
      skillExecutorRegistry.register(body.skillId, executor);
      let result;
      try {
        result = await executor.run({
          skillId: body.skillId,
          taskPrompt: body.taskPrompt,
          maxSteps,
          timeoutMs,
        });
      } finally {
        skillExecutorRegistry.unregister(body.skillId);
      }
      const endedAt = new Date();

      results.push({
        index: i,
        status: result.status,
        steps: result.steps,
        durationMs: result.durationMs,
        error: result.error,
      });

      // Best-effort: POST the episode to the server. Don't let a failed POST
      // abort the evaluation run.
      try {
        await fetch(`${serverBaseUrl}/api/evaluation/episodes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            robotId: robot.id,
            modelVersion: body.modelVersionId ?? 'unknown',
            taskPrompt: body.taskPrompt,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: result.durationMs,
            success: result.status === 'completed',
            errorType: result.status === 'completed' ? null : (result.error ?? result.status),
            metadata: { steps: result.steps, episodeIndex: i, skillId: body.skillId },
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Evaluation] Failed to record episode ${i}: ${msg}`);
      }

      // Stop the run early on abort.
      if (result.status === 'aborted') break;
    }

    const successCount = results.filter((r) => r.status === 'completed').length;
    res.json({
      robotId: robot.id,
      skillId: body.skillId,
      episodes: results.length,
      successCount,
      successRate: results.length > 0 ? successCount / results.length : 0,
      startedAt: overallStartedAt.toISOString(),
      results,
    });
  });

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

  // NOTE (TASK-184): GET /robots/:id/vla/safety (Task 63) was removed together
  // with RobotStateManager.getVLASafetyStatus() — it surfaced the deleted
  // VLARunner sidecar path (`/safety/status`) and had no live caller.

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

  // ============================================================================
  // SECURITY ENDPOINTS (CRA Annex I, TASK-023)
  // ============================================================================

  // GET /security/attestation - Boot attestation record
  router.get('/security/attestation', (_req: Request, res: Response) => {
    if (!secureBoot) {
      res.status(503).json({ code: 'SECURE_BOOT_UNAVAILABLE', message: 'Secure boot not initialized' });
      return;
    }

    const attestation = secureBoot.getAttestation();
    if (!attestation) {
      res.status(503).json({ code: 'NO_ATTESTATION', message: 'Boot attestation not yet available' });
      return;
    }

    res.json(attestation);
  });

  // GET /security/certificate - Public device certificate (PEM)
  router.get('/security/certificate', (_req: Request, res: Response) => {
    if (!deviceIdentity) {
      res.status(503).json({ code: 'IDENTITY_UNAVAILABLE', message: 'Device identity not initialized' });
      return;
    }

    const identity = deviceIdentity.getIdentity();
    res.json({
      deviceId: identity.deviceId,
      fingerprint: identity.fingerprint,
      certificate: identity.certificate,
      publicKey: identity.publicKey,
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
    });
  });

  // POST /security/verify - Challenge-response verification
  router.post('/security/verify', (req: Request, res: Response) => {
    if (!deviceIdentity) {
      res.status(503).json({ code: 'IDENTITY_UNAVAILABLE', message: 'Device identity not initialized' });
      return;
    }

    const { nonce } = req.body;
    if (!nonce || typeof nonce !== 'string') {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'nonce (string) is required' });
      return;
    }

    try {
      const response = deviceIdentity.signChallenge(nonce);
      res.json(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Signing failed';
      res.status(500).json({ code: 'SIGNING_FAILED', message: msg });
    }
  });

  return router;
}

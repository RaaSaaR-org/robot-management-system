/**
 * @file rest-routes.ts
 * @description REST API routes compatible with NeoDEM robot interface
 * @status live
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { RobotStateManager } from '../robot/state.js';
import { ControlBusyError } from '../robot/state.js';
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
import { agentModeController } from '../agent-mode/agent-mode-controller.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import { controlOwnerLock } from '../agent-mode/control-owner.js';
import { INTENT_MAX_CHARS } from '../agent-mode/intents.js';
import { getIdentityStore } from '../agent-mode/identity.js';

/**
 * Shared secret that unlocks the personal-data routes from off-box.
 *
 * Read from the environment per request, not from `config` (frozen at import):
 * rotating this must not require a robot restart, and a test must be able to
 * turn it on and off. Unset ⇒ loopback-only, which is the safe default for the
 * dev profiles in this repo.
 */
export const MEMORY_TOKEN_ENV = 'AGENT_MEMORY_TOKEN';

/** Loopback literals, in the shapes Node hands them to Express. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const addr = address.replace(/^::ffff:/, '');
  return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.');
}

/**
 * Same-origin, in the only sense that matters here: a browser page served from
 * this very agent. Anything else — including the operator UI on another port —
 * must present the token.
 */
function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The gate in front of everything that serves or destroys PERSONAL DATA:
 * `MEMORY.md`, the memory digest, erasure, and the standing intents.
 *
 * The rest of this agent is deliberately open (estop, toggle, command) and this
 * does not widen that pattern to durable operator-authored text. Three things
 * happen, in order:
 *
 *  1. The permissive `Access-Control-Allow-Origin: *` that `app.use(cors())`
 *     put on the response is REMOVED, so no browser page can read the body even
 *     if the request itself is allowed. `Vary: Origin` keeps a cache from
 *     serving one origin's answer to another.
 *  2. A cross-origin request is refused outright. That is the attack in the
 *     finding — any page on the network `fetch`ing the robot — and it is refused
 *     whether or not the browser would have let the page read the answer.
 *  3. Then either a matching bearer token (when `AGENT_MEMORY_TOKEN` is set) or
 *     a loopback peer. With no token configured, off-box callers get 401 with
 *     the variable's name in the message rather than silence.
 *
 * Not a substitute for real authentication of the whole agent — see the
 * follow-up recorded with this change — but the narrowest thing that stops the
 * cross-site read today.
 */
export function personalDataGate(req: Request, res: Response, next: NextFunction): void {
  res.removeHeader('Access-Control-Allow-Origin');
  res.setHeader('Vary', 'Origin');

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin && !isSameOrigin(origin, req.headers.host)) {
    res.status(403).json({
      code: 'CROSS_ORIGIN_FORBIDDEN',
      message:
        'This endpoint serves personal data and refuses cross-origin browser requests. ' +
        'Call it from a server-side client with a bearer token.',
    });
    return;
  }

  const expected = process.env[MEMORY_TOKEN_ENV] ?? '';
  if (expected) {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !timingSafeEquals(presented, expected)) {
      res.status(401).json({
        code: 'MEMORY_TOKEN_REQUIRED',
        message: `This endpoint serves personal data. Present the ${MEMORY_TOKEN_ENV} as a bearer token.`,
      });
      return;
    }
    next();
    return;
  }

  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(401).json({
      code: 'MEMORY_TOKEN_REQUIRED',
      message:
        'This endpoint serves personal data and no shared secret is configured, so it ' +
        `answers loopback callers only. Set ${MEMORY_TOKEN_ENV} to reach it from off-box.`,
    });
    return;
  }

  next();
}

/** Constant-time-ish comparison, so a token cannot be guessed byte by byte. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
    // The frame travels WITH the pose (TASK-207): the server relays it to the
    // other robots, which draw this one only if they share it.
    res.json({ ...robot, location: { ...robot.location, frame: hardwareClient.getOdometryFrame() } });
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
  router.post('/robots/:id/safety/estop', async (req: Request, res: Response) => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({
        code: 'ROBOT_NOT_FOUND',
        message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
      });
      return;
    }

    const { reason, triggeredBy } = req.body;
    const stopReason = reason || 'Remote E-stop triggered';

    // Latched FIRST: it is synchronous and cannot fail, while the Agent Mode
    // stop below goes over HTTP to the sidecar. The latch keeps the real trigger
    // source because SafetyMonitor records the first trigger and ignores the
    // 'local' one that agentModeController.estop() raises a moment later.
    robotStateManager.triggerEmergencyStop(triggeredBy || 'remote', stopReason);

    // TASK-194: the platform E-Stop has to reach Agent Mode. SafetyMonitor's
    // stop only zeroes the simulated speed and raises a warning — it never
    // touches the LocoClient the block executor is driving, so without this the
    // robot kept walking while the whole product reported it as e-stopped.
    // Best-effort: a failing Agent Mode stop is reported, never swallowed.
    let agentModeStopped = false;
    let agentModeError: string | undefined;
    try {
      const result = await agentModeController.estop(`Platform E-Stop: ${stopReason}`);
      agentModeStopped = result.stopped;
      // The stop latched but StopMove/Damp never reached the robot — that is a
      // delivery failure, and hiding it renders an un-damped robot as stopped.
      if (!result.delivered) {
        agentModeError = result.deliveryError ?? 'stop/damp not confirmed by the sidecar';
      }
    } catch (error) {
      agentModeError = error instanceof Error ? error.message : String(error);
      console.error('[REST] Agent Mode E-Stop failed during platform E-Stop:', agentModeError);
    }

    // Update server heartbeat since we received communication
    robotStateManager.updateServerHeartbeat();

    const estopState = robotStateManager.getEStopState();
    res.json({
      robotId: robot.id,
      message: 'Emergency stop triggered',
      // Honest report of what this stop actually reached.
      agentModeStopped,
      ...(agentModeError ? { agentModeError } : {}),
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

    // TASK-194 arbitration: control is exclusive. A VLA rollout must not start
    // while Agent Mode (or a human at the teleop controls) owns the robot.
    // The claim itself lives in startVLAControl() together with every release,
    // so this route never holds a lock it could leak — or hand back on behalf
    // of a rollout that is still running.
    try {
      await robotStateManager.startVLAControl(instruction, vlaConfig);

      res.json({
        robotId: robot.id,
        message: 'VLA control started',
        instruction,
        status: robotStateManager.getVLAStatus(),
      });
    } catch (error) {
      if (error instanceof ControlBusyError) {
        res.status(409).json({
          code: 'CONTROL_BUSY',
          message: `Cannot start VLA control: ${error.reason}`,
          controlOwner: controlOwnerLock.get(),
        });
        return;
      }
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
      // stopVLAControl() releases the control lock itself — see startVLAControl.
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
  // AGENT MODE ENDPOINTS (TASK-194)
  //
  // Full paths are /api/v1/robots/:id/agent-mode/... — see the wire contract.
  // Plans are ephemeral: nothing here touches the database.
  // ============================================================================

  /** Shared 404 guard — this agent serves exactly one robot. */
  const wrongRobot = (req: Request, res: Response): boolean => {
    const robot = robotStateManager.getRobotInterface();
    if (req.params.id === robot.id) return false;
    res.status(404).json({
      code: 'ROBOT_NOT_FOUND',
      message: `Robot ${req.params.id} not found. This agent serves robot ${robot.id}`,
    });
    return true;
  };

  // GET /robots/:id/agent-mode — full AgentModeState
  //
  // GATED: the state embeds `plan.command` — the operator's own words, verbatim
  // — plus the scene's VLM captions of whoever is standing in front of the
  // robot. Same data category as MEMORY.md, so the same gate. The control verbs
  // below it (toggle, command, estop) stay open on purpose: an E-Stop that
  // needs a bearer token is a worse failure than an ungated one.
  router.get('/robots/:id/agent-mode', personalDataGate, (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    res.json(agentModeController.getState());
  });

  // POST /robots/:id/agent-mode/toggle — {enabled: boolean}
  router.post('/robots/:id/agent-mode/toggle', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'body must be {enabled: boolean}' });
      return;
    }
    res.json(agentModeController.setEnabled(enabled));
  });

  // POST /robots/:id/agent-mode/command — {text, contextId?, spoken?}
  router.post('/robots/:id/agent-mode/command', async (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'body must be {text: string}' });
      return;
    }
    const contextId = typeof req.body?.contextId === 'string' ? req.body.contextId : undefined;
    // `spoken: true` is honoured, `spoken: false` is not a thing: a caller may
    // only ever LOWER the trust of its own turn (see `rememberTrust`). A REST
    // push-to-talk bridge can declare itself; nothing can declare itself typed.
    const spoken = req.body?.spoken === true;
    const result = await agentModeController.submitCommand({
      text,
      ...(contextId ? { contextId } : {}),
      ...(spoken ? { spoken: true } : {}),
    });
    // A refusal is a normal, expected answer (mode off, E-Stop latched, control
    // held elsewhere) — the caller reads `accepted`, not the status code.
    res.json(result);
  });

  // POST /robots/:id/agent-mode/estop — {reason?}
  router.post('/robots/:id/agent-mode/estop', async (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Manual E-Stop from the operator UI';
    res.json(await agentModeController.estop(reason));
  });

  // POST /robots/:id/agent-mode/estop/reset
  router.post('/robots/:id/agent-mode/estop/reset', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    res.json(agentModeController.resetEstop());
  });

  // GET /robots/:id/agent-mode/scene — SceneMemory | null
  // GATED: VLM captions of the people and the room in front of the robot.
  router.get('/robots/:id/agent-mode/scene', personalDataGate, (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    res.json(agentModeController.getScene());
  });

  // GET /robots/:id/agent-mode/scene.md — the current_view.md dump
  // GATED: same content as `/scene`, rendered.
  router.get('/robots/:id/agent-mode/scene.md', personalDataGate, (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    res.type('text/markdown').send(agentModeController.sceneMarkdown());
  });

  // GET /robots/:id/map — the robot's own occupancy grid (TASK-206)
  //
  // Not gated: geometry only — no captions, no operator words. `frame: 'odom'`
  // is stated on the payload because it is the whole caveat: the grid inherits
  // odometry drift and is only comparable with the place graph when that graph
  // is registered to odometry (`registered`), otherwise `keepouts` is `[]`.
  // `?format=pgm` returns the grid as a binary PGM for eyeballing.
  router.get('/robots/:id/map', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const status = agentModeController.mapStatus();
    if (!status || !status.enabled) {
      res.status(404).json({ ok: false, error: 'occupancy map is disabled on this agent (AGENT_MAP_ENABLED)' });
      return;
    }
    if (req.query.format === 'pgm') {
      const map = agentModeController.occupancyMap();
      if (!map || !map.isAllocated()) {
        res.status(404).json({ ok: false, error: 'no map yet — nothing has been integrated' });
        return;
      }
      res.type('image/x-portable-graymap').send(map.toPgm());
      return;
    }
    const grid = agentModeController.mapSnapshot();
    // Same odometry the map was built from — never the place belief's copy,
    // which carries no yaw and may lag a poll.
    const pose = hardwareClient.getCachedPose();
    const belief = robotStateManager.getPlaceBelief();
    const registration = robotStateManager.getPlaceFrameRegistration();
    const registered = registration?.registered === true;
    const keepouts = registered
      ? robotStateManager
          .getPlaces()
          .filter((p) => p.keepout)
          .map((p) => ({ id: p.id, name: p.name, polygon: p.polygon.map(([x, y]) => [x, y]) }))
      : [];
    // Other robots (TASK-207): only the ones in OUR frame; the rest are a count.
    const peers = agentModeController.peers().map((p) => ({
      robotId: p.robotId,
      name: p.name,
      x: p.x,
      y: p.y,
      headingDeg: p.headingDeg,
      footprintRadiusM: p.footprintRadiusM,
      place: p.place,
      updatedAt: p.updatedAt,
    }));
    const peerStatus = agentModeController.peerStatus();
    res.json({
      ok: true,
      frame: 'odom',
      frameId: hardwareClient.getOdometryFrame(),
      grid,
      pose: pose ? { x: pose.x, y: pose.y, yawDeg: pose.yawDeg, source: pose.source, atMs: pose.atMs } : null,
      place: belief?.place ?? null,
      registered,
      registrationReason: registration && !registration.registered ? registration.reason : null,
      keepouts,
      peers,
      peersDropped: peerStatus?.dropped ?? 0,
      peersEnabled: peerStatus?.enabled ?? false,
      status,
    });
  });

  // ============================================================================
  // DURABLE MEMORY (TASK-197)
  //
  // Everything below the gate serves or destroys operator-authored personal
  // data — see {@link personalDataGate}. This is the first thing in this agent
  // that does, which is why it is the first thing with a gate.
  // ============================================================================

  router.use('/robots/:id/memory', personalDataGate);
  router.use('/robots/:id/memory.md', personalDataGate);
  router.use('/robots/:id/agent-mode/intents', personalDataGate);

  // GET /robots/:id/memory — the digest (counts, not content)
  router.get('/robots/:id/memory', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const digest = agentModeController.memoryDigest();
    if (!digest) {
      // 404 rather than an empty digest: "this robot has no memory workspace"
      // and "this robot remembers nothing" are different answers, and only one
      // of them is a fact about the robot's experience.
      res.status(404).json({
        code: 'NO_MEMORY_WORKSPACE',
        message: 'This agent has no memory workspace configured.',
      });
      return;
    }
    res.json(digest);
  });

  // GET /robots/:id/memory.md — MEMORY.md verbatim
  router.get('/robots/:id/memory.md', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    res.type('text/markdown').send(agentModeController.memoryMarkdown());
  });

  // DELETE /robots/:id/memory — GDPR Art. 17 erasure of the workspace.
  // Wipes MEMORY.md, every place note, the journal, the standing intents, the
  // boot lineage and every orphaned scratch file, and blanks Operator/Site on
  // IDENTITY.md; the operating rules (AGENTS.md) and the surveyed place graph
  // survive — they are configuration and site geometry, not anything observed
  // about a person. See `Workspace.erase`.
  router.delete('/robots/:id/memory', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const result = agentModeController.eraseMemory();
    // The card was redacted ON DISK; this drops the copy this process is still
    // holding in memory, so the very next GET /identity cannot answer with the
    // operator's name that was just erased.
    try {
      getIdentityStore().load();
    } catch (err) {
      console.warn('[Identity] could not reload the ID card after erasure:', err);
    }
    // Reported, never thrown: a partial erasure that claims success is the one
    // answer a data-subject request must not get.
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ============================================================================
  // STANDING INTENTS (TASK-199)
  //
  // The arming path. Without one, `IntentStore.arm()` had no production caller
  // at all: the cooldown, the fire budget, the expiry and the `intent_matched`
  // heartbeat predicate were all reachable only by hand-writing JSONL onto the
  // robot's disk. A REST endpoint rather than a planner block on purpose —
  // gemma3:4b prompt length is a measured regression risk in this repo, and
  // `planner.test.ts` is the gate that would have to be re-earned.
  // ============================================================================

  /** The store, or a 404 for an agent with no workspace to hold intents in. */
  const intentStore = (res: Response): ReturnType<typeof agentModeController.standingIntents> => {
    const store = agentModeController.standingIntents();
    if (!store) {
      res.status(404).json({
        code: 'NO_MEMORY_WORKSPACE',
        message: 'This agent has no workspace, so it cannot hold standing intents.',
      });
    }
    return store;
  };

  // GET /robots/:id/agent-mode/intents — every intent, whatever its state
  router.get('/robots/:id/agent-mode/intents', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const store = intentStore(res);
    if (!store) return;
    res.json({ intents: store.list() });
  });

  // POST /robots/:id/agent-mode/intents — arm one
  //
  // Origin is `operator`, and hardcoded: this route exists BECAUSE an operator
  // is the only thing allowed to leave the robot a standing intent. An agent
  // that could arm its own is an agent that can schedule its own wake-ups, and
  // `IntentStore.arm` refuses that regardless of what is passed here.
  router.post('/robots/:id/agent-mode/intents', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const store = intentStore(res);
    if (!store) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      res.status(400).json({
        code: 'INVALID_INTENT',
        message: `body must be {text: string (max ${INTENT_MAX_CHARS} chars), place?, keywords?}`,
      });
      return;
    }
    const place = typeof body.place === 'string' && body.place.trim() ? body.place : null;
    const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];
    if (rawKeywords.some((k) => typeof k !== 'string')) {
      res.status(400).json({ code: 'INVALID_INTENT', message: 'keywords must be strings.' });
      return;
    }
    const keywords = (rawKeywords as string[]).map((k) => k.trim()).filter(Boolean);

    const numeric = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

    const result = store.arm(
      {
        trigger: { ...(place ? { place } : {}), ...(keywords.length > 0 ? { keywords } : {}) },
        text,
        ...(numeric(body.cooldownMs) === undefined ? {} : { cooldownMs: numeric(body.cooldownMs)! }),
        ...(numeric(body.fires) === undefined ? {} : { fires: numeric(body.fires)! }),
        ...(numeric(body.ttlMs) === undefined ? {} : { ttlMs: numeric(body.ttlMs)! }),
      },
      'operator',
    );
    // A refusal (no trigger, over the cap, empty text) is a normal answer with a
    // reason in it — 400, so a caller cannot mistake it for an armed intent.
    res.status(result.ok ? 201 : 400).json(result);
  });

  // DELETE /robots/:id/agent-mode/intents/:intentId — disarm one
  router.delete('/robots/:id/agent-mode/intents/:intentId', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const store = intentStore(res);
    if (!store) return;
    const disarmed = store.disarm(req.params.intentId);
    if (!disarmed) {
      res.status(404).json({
        code: 'INTENT_NOT_FOUND',
        message: `No armed intent ${req.params.intentId}.`,
      });
      return;
    }
    res.json({ ok: true, id: req.params.intentId });
  });

  // ============================================================================
  // IDENTITY (TASK-198)
  //
  // GATED, all of it. IDENTITY.md carries `Operator` and `Site` — the two labels
  // `Workspace.IDENTITY_PERSONAL_LABELS` classifies as personal data and blanks
  // on an Art. 17 erasure — so a route serving them is serving the same data
  // category as MEMORY.md and gets the same gate. `POST` is gated for the second
  // reason too: ungated, any page on the network could rename the robot and
  // rewrite its operator. `/identity/body.md` is generated from configuration
  // and carries no personal data, but it sits under the same prefix and a
  // hardware inventory is not something to hand out cross-origin either.
  // ============================================================================

  router.use('/robots/:id/identity', personalDataGate);

  // GET /robots/:id/identity — the ID card plus the per-turn sensorium.
  router.get('/robots/:id/identity', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const identity = agentModeController.identitySnapshot();
    if (!identity) {
      // A garbled card and a missing identity store are both "no identity", and
      // both are reported as such rather than as a generic robot — the whole
      // point of the file split is that a robot never quietly becomes someone
      // else. `problem` says which of the two it is.
      res.status(404).json({
        code: 'NO_IDENTITY',
        message: 'This agent has no readable identity.',
        problem: agentModeController.identityProblem(),
      });
      return;
    }
    res.json({
      identity,
      self: agentModeController.selfState(),
      report: agentModeController.selfReport('en'),
    });
  });

  // GET /robots/:id/identity/body.md — BODY.md verbatim (generated at boot)
  router.get('/robots/:id/identity/body.md', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    res
      .type('text/markdown')
      .send(agentModeController.bodyMarkdown() || '# Body\n\n(not generated yet)\n');
  });

  // POST /robots/:id/identity — the naming ritual's non-conversational door.
  // Only Name / Emoji / Operator / Site; Robot-Id, Serial, Unit and BODY.md are
  // regenerated from configuration at every boot and cannot be set here.
  router.post('/robots/:id/identity', (req: Request, res: Response) => {
    if (wrongRobot(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, string | null> = {};
    for (const label of ['Name', 'Emoji', 'Operator', 'Site'] as const) {
      // Presence, not truthiness. `??` treated an explicit `{"Site": null}` —
      // an operator CLEARING the site — as "not sent" (it fell through to the
      // absent lower-case key), so the one way to unset a label silently did
      // nothing and the old value stayed on the card.
      const lower = label.toLowerCase();
      const key = label in body ? label : lower in body ? lower : null;
      if (key === null) continue;
      const value = body[key];
      if (value === undefined) continue;
      if (value === null) patch[label] = null;
      else if (typeof value === 'string') patch[label] = value;
      else {
        res.status(400).json({ code: 'INVALID_IDENTITY', message: `${label} must be a string or null.` });
        return;
      }
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({
        code: 'INVALID_IDENTITY',
        message: 'Provide at least one of Name, Emoji, Operator, Site.',
      });
      return;
    }
    const result = agentModeController.writeIdentity(patch);
    if (!result.ok) {
      res.status(400).json({ code: 'IDENTITY_REFUSED', message: result.message });
      return;
    }
    res.json({ ok: true, identity: result.identity, self: agentModeController.selfState() });
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

/**
 * @file robot.routes.ts
 * @description REST API routes for robot management
 */

import { Router, type Request, type Response } from 'express';
import { robotManager } from '../services/RobotManager.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from '../services/HttpClient.js';
import { sensorScanService } from '../services/SensorScanService.js';
import { robotRepository } from '../repositories/index.js';
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

/**
 * GET /:id/telemetry/history — Persisted telemetry rows (TASK-184)
 * Query params: from=<ISO>, to=<ISO>, limit=<n, max 2000, default 500>.
 * Rows are ascending by timestamp with JSON columns parsed back to objects.
 * Without `from` the default window is the LAST HOUR and the newest rows in
 * range win the limit, so naive consumers see recent data instead of the
 * oldest persisted rows.
 */
robotRoutes.get('/:id/telemetry/history', async (req: Request, res: Response) => {
  try {
    const robot = await robotManager.getRobot(req.params.id);
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    let from: Date | undefined;
    let to: Date | undefined;
    if (req.query.from !== undefined) {
      from = new Date(String(req.query.from));
      if (Number.isNaN(from.getTime())) {
        return res.status(400).json({ error: 'from must be a valid ISO timestamp' });
      }
    }
    if (req.query.to !== undefined) {
      to = new Date(String(req.query.to));
      if (Number.isNaN(to.getTime())) {
        return res.status(400).json({ error: 'to must be a valid ISO timestamp' });
      }
    }

    let limit = 500;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        return res.status(400).json({ error: 'limit must be a positive integer' });
      }
      limit = Math.min(limit, 2000);
    }

    // No explicit range: default to the last hour, newest rows first in the
    // limit budget (response stays ascending). Explicit ?from= keeps the
    // original oldest-first-from-that-point behavior.
    const noExplicitFrom = from === undefined;
    if (from === undefined && to === undefined) {
      from = new Date(Date.now() - 60 * 60 * 1000);
    }

    const telemetry = await robotRepository.getTelemetryHistory(req.params.id, {
      from,
      to,
      limit,
      newest: noExplicitFrom,
    });
    res.json({ telemetry });
  } catch (error) {
    console.error('Error getting telemetry history:', error);
    res.status(500).json({ error: 'Failed to get telemetry history' });
  }
});

// ============================================================================
// VLA PROXY ROUTES (TASK-077) — forward to robot agent VLA endpoints
// ============================================================================

/**
 * GET /:id/camera/:name — Proxy MJPEG camera stream from robot sidecar (port 8765)
 */
robotRoutes.get('/:id/camera/:name', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Derive sidecar URL (port 8765) from agent URL
    const agentUrl = new URL(registered.baseUrl);
    const sidecarUrl = `http://${agentUrl.hostname}:8765`;
    const camName = req.params.name;

    // Pipe the MJPEG stream through to the browser
    const http = await import('http');
    const upstream = http.get(`${sidecarUrl}/camera/${camName}`, (stream) => {
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=FRAME',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'close',
      });
      stream.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Cannot reach robot camera' });
      }
    });
    req.on('close', () => upstream.destroy());
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Camera proxy error' });
    }
  }
});

// ============================================================================
// POINT CLOUD / PERCEPTION ROUTES — live snapshot proxy + scan capture
// ============================================================================

/**
 * GET /:id/pointcloud/snapshot — Proxy a live point-cloud frame from the agent.
 */
robotRoutes.get('/:id/pointcloud/snapshot', async (req: Request, res: Response) => {
  try {
    const sensor = typeof req.query.sensor === 'string' ? req.query.sensor : undefined;
    const frame = await sensorScanService.getLiveSnapshot(req.params.id, sensor);
    res.json(frame);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: 'Robot not found' });
    }
    console.error('[PointCloud] snapshot error:', error);
    res.status(500).json({ error: 'Failed to get point cloud' });
  }
});

/**
 * POST /:id/pointcloud/capture — Capture a full-resolution scan into storage.
 */
robotRoutes.post('/:id/pointcloud/capture', async (req: Request, res: Response) => {
  try {
    const sensor = typeof req.body?.sensor === 'string' ? req.body.sensor : undefined;
    const scan = await sensorScanService.captureScan(req.params.id, sensor);
    res.status(201).json(scan);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: 'Robot not found' });
    }
    console.error('[PointCloud] capture error:', error);
    res.status(500).json({ error: 'Failed to capture scan' });
  }
});

/**
 * POST /:id/pointcloud/lidar/switch — Toggle the robot's physical LiDAR.
 * Thin proxy to the agent → hardware sidecar (rt/utlidar/switch — a sensor
 * enable that commands no robot motion). Body: {on: boolean}; the agent
 * answers 200 with {ok, lidar?, error?}.
 */
robotRoutes.post('/:id/pointcloud/lidar/switch', async (req: Request, res: Response) => {
  try {
    const on = req.body?.on;
    if (typeof on !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'body must be {on: boolean}' });
    }
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) return res.status(404).json({ ok: false, error: 'Robot not found' });
    // LONG: the agent's sidecar call publishes the DDS switch for ~3 s and its
    // own timeout is 10 s — MEDIUM (also 10 s) would race it.
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.LONG);
    const data = await httpClient.post(`/api/v1/robots/${req.params.id}/pointcloud/lidar/switch`, { on });
    res.json(data);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ ok: false, error: 'Unable to communicate with robot agent' });
    }
    console.error('[PointCloud] LiDAR switch error:', error);
    res.status(500).json({ ok: false, error: 'Failed to switch LiDAR' });
  }
});

// ----------------------------------------------------------------------------
// Scan sessions (digital-twin sweep) — thin proxy to the agent. The agent holds
// the session + fixed world room; the server forwards start/stop/status so the
// browser talks only to the server (agent-direct WS isn't reachable in prod).
// The server-of-record ScanSession (persistence) lands in a later phase.
// ----------------------------------------------------------------------------

robotRoutes.post('/:id/pointcloud/scan/start', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) return res.status(404).json({ error: 'Robot not found' });
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
    const data = await httpClient.post(`/api/v1/robots/${req.params.id}/pointcloud/scan/start`, {
      sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
    });
    res.status(201).json(data);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    console.error('[ScanSession] start error:', error);
    res.status(500).json({ error: 'Failed to start scan session' });
  }
});

robotRoutes.post('/:id/pointcloud/scan/stop', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) return res.status(404).json({ error: 'Robot not found' });
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
    const data = await httpClient.post(`/api/v1/robots/${req.params.id}/pointcloud/scan/stop`);
    res.json(data);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    console.error('[ScanSession] stop error:', error);
    res.status(500).json({ error: 'Failed to stop scan session' });
  }
});

robotRoutes.get('/:id/pointcloud/scan/status', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) return res.status(404).json({ error: 'Robot not found' });
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
    const data = await httpClient.get(`/api/v1/robots/${req.params.id}/pointcloud/scan/status`);
    res.json(data);
  } catch (error) {
    if (error instanceof HttpClientError && error.isNetworkError()) {
      return res.status(502).json({ error: 'Unable to communicate with robot agent' });
    }
    console.error('[ScanSession] status error:', error);
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

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

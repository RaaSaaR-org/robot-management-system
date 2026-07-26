/**
 * @file agent-mode.routes.ts
 * @description REST routes for Agent Mode (TASK-194). Mounted on `/api/robots`,
 *              so every path here is `/api/robots/:id/agent-mode/...`.
 *              Two kinds of route: the ingest endpoint the robot-agent pushes
 *              plan/block/scene events to (stored in memory + broadcast over
 *              the A2A WebSocket), and thin proxies that forward operator
 *              actions to the robot-agent's own `/api/v1` Agent Mode API.
 *
 *              Nothing is persisted — Agent Mode plans are ephemeral.
 *
 *              Named `agent-mode.routes.ts` (not `agent.routes.ts`) because
 *              that name is already taken by A2A agent discovery.
 */

import { Router, type Request, type Response } from 'express';
import { robotManager } from '../services/RobotManager.js';
import { agentModeService, isValidAgentModeSnapshot } from '../services/AgentModeService.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from '../services/HttpClient.js';
import {
  AgentModeEventTypes,
  type AgentModeEvent,
  type AgentModeEventType,
} from '../types/agent-mode.types.js';

export const agentModeRoutes = Router();

/**
 * Map a proxy failure onto a response, identical to the `/:id/proxy/vla*`
 * routes: network problems (ECONNREFUSED / timeout) are 502, everything else
 * is a generic 500. A missing robot is handled by the caller before this.
 */
function respondProxyError(res: Response, error: unknown, action: string): void {
  if (error instanceof HttpClientError && error.isNetworkError()) {
    return void res.status(502).json({ error: 'Unable to communicate with robot agent' });
  }
  console.error(`[AgentMode] ${action} error:`, error);
  res.status(500).json({ error: `Failed to ${action}` });
}

// ============================================================================
// INGEST (robot-agent → server)
// ============================================================================

/**
 * POST /:id/agent-mode/events — Ingest an Agent Mode event from the robot-agent.
 * Body: { type: AgentModeEventType, robotId, plan?, block?, scene?, state?, timestamp? }
 *
 * Unauthenticated in practice: the robot-agent pushes without an Authorization
 * header, which works because the route sits behind `authMiddleware` and dev
 * runs with `AUTH_DISABLED=true` — same as the compliance-log and task-status
 * pushes. The push is fire-and-forget on the agent side, so this must be cheap
 * and must never fail for reasons the agent cannot act on.
 */
agentModeRoutes.post('/:id/agent-mode/events', (req: Request, res: Response) => {
  try {
    const { type, robotId, plan, block, scene, state, timestamp } = req.body ?? {};

    if (!AgentModeEventTypes.includes(type as AgentModeEventType)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${AgentModeEventTypes.join(', ')}`,
      });
    }

    if (typeof robotId !== 'string' || robotId.length === 0) {
      return res.status(400).json({ error: 'robotId is required' });
    }

    // The path parameter is the addressed resource and wins over the body, so a
    // mismatched payload can never scribble on another robot's state.
    const event: AgentModeEvent = {
      type: type as AgentModeEventType,
      robotId: req.params.id,
      plan,
      block,
      scene,
      state,
      timestamp: typeof timestamp === 'string' ? timestamp : new Date().toISOString(),
    };

    const merged = agentModeService.ingest(event);
    res.json({ ok: true, state: merged });
  } catch (error) {
    console.error('[AgentMode] Ingest error:', error);
    res.status(500).json({ error: 'Failed to ingest agent mode event' });
  }
});

// ============================================================================
// READS (server memory)
// ============================================================================

/**
 * GET /:id/agent-mode — Last known AgentModeState for a robot.
 *
 * The mirror is in-memory and event-driven, so "nothing mirrored yet" is the
 * normal state twice over: right after the robot boots, and after every server
 * restart. Answering 404 then made the UI render a robot whose Agent Mode was
 * ON as "Agent Mode off" — and disable the command box, so the operator could
 * not even prove otherwise. On a miss, ask the robot directly; it is the
 * authority on its own mode either way.
 *
 * The same applies to a mirror seeded by a plan/block/scene event: only
 * `agent:state:changed` carries a snapshot, so an otherwise-populated entry can
 * still be asserting `enabled: false` / `estopActive: false` as bare defaults.
 * Serving that would report a latched E-Stop as clear. `isHydrated()` tells the
 * two apart; an unhydrated entry is treated exactly like a miss.
 *
 * 404 is still the answer when the robot is unknown or unreachable — that is a
 * genuinely unknown state, and guessing at it is what caused the bug.
 */
agentModeRoutes.get('/:id/agent-mode', async (req: Request, res: Response) => {
  try {
    // Only a state the robot itself asserted may be served. A mirror seeded by
    // a plan/block/scene event carries `enabled`/`estopActive` from
    // `emptyState()`, which is a guess wearing the same shape as an answer.
    const state = agentModeService.getState(req.params.id);
    if (state && agentModeService.isHydrated(req.params.id)) {
      return res.json(state);
    }

    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'No agent mode state for robot' });
    }

    try {
      const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
      const live: unknown = await httpClient.get(`/api/v1/robots/${req.params.id}/agent-mode`);
      // A 200 with an empty or shapeless body is not an answer. Ingesting it
      // anyway would seed the mirror from emptyState() and serve fabricated
      // `enabled: false` / `estopActive: false` — the exact bug this fallback
      // exists to avoid. Treat it like an unreachable robot instead.
      if (!isValidAgentModeSnapshot(live)) {
        return res.status(404).json({ error: 'No agent mode state for robot' });
      }
      // Seed the mirror through the normal path, so the stored state and the
      // WebSocket feed agree from here on instead of diverging until the first
      // real event. Subscribers get an ordinary 'agent:state:changed'.
      const merged = agentModeService.ingest({
        type: 'agent:state:changed',
        robotId: req.params.id,
        state: live,
        timestamp: new Date().toISOString(),
      });
      return res.json(merged);
    } catch {
      return res.status(404).json({ error: 'No agent mode state for robot' });
    }
  } catch (error) {
    console.error('[AgentMode] Get state error:', error);
    res.status(500).json({ error: 'Failed to get agent mode state' });
  }
});

/**
 * GET /:id/agent-mode/scene — Last known SceneMemory for a robot, or null.
 */
agentModeRoutes.get('/:id/agent-mode/scene', (req: Request, res: Response) => {
  try {
    res.json(agentModeService.getScene(req.params.id));
  } catch (error) {
    console.error('[AgentMode] Get scene error:', error);
    res.status(500).json({ error: 'Failed to get agent mode scene' });
  }
});

// ============================================================================
// PROXIES (server → robot-agent)
// ============================================================================

/**
 * POST /:id/agent-mode/command — Forward a plain-language command to the planner.
 * Body: { text: string, contextId?: string }
 */
agentModeRoutes.post('/:id/agent-mode/command', async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.LONG);
    const data = await httpClient.post(
      `/api/v1/robots/${req.params.id}/agent-mode/command`,
      { text, contextId: req.body?.contextId }
    );
    res.json(data);
  } catch (error) {
    respondProxyError(res, error, 'send agent mode command');
  }
});

/**
 * POST /:id/agent-mode/toggle — Turn Agent Mode on/off. Body: { enabled: boolean }
 */
agentModeRoutes.post('/:id/agent-mode/toggle', async (req: Request, res: Response) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
    const data = await httpClient.post(
      `/api/v1/robots/${req.params.id}/agent-mode/toggle`,
      { enabled }
    );
    res.json(data);
  } catch (error) {
    respondProxyError(res, error, 'toggle agent mode');
  }
});

/**
 * POST /:id/agent-mode/estop — Manual E-Stop: discard the plan and stop the robot.
 * Body: { reason?: string }. Manual E-Stop is the only safety gate in v1 — see
 * the recorded deviation in TASK-194.
 */
agentModeRoutes.post('/:id/agent-mode/estop', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
    const data = await httpClient.post(
      `/api/v1/robots/${req.params.id}/agent-mode/estop`,
      { reason: req.body?.reason }
    );
    res.json(data);
  } catch (error) {
    respondProxyError(res, error, 'trigger agent mode e-stop');
  }
});

/**
 * POST /:id/agent-mode/estop/reset — Clear a latched E-Stop.
 *
 * Without this the latch is a dead end: the UI can stop the robot but never let
 * the operator hand control back. Clearing is always an explicit human action —
 * nothing resets the latch automatically.
 */
agentModeRoutes.post('/:id/agent-mode/estop/reset', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
    const data = await httpClient.post(
      `/api/v1/robots/${req.params.id}/agent-mode/estop/reset`,
      {}
    );
    res.json(data);
  } catch (error) {
    respondProxyError(res, error, 'reset agent mode e-stop');
  }
});

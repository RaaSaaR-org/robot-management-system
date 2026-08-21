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
import { agentServiceAuthHeaders } from '../services/agentServiceAuth.js';
import { patrolService } from '../services/PatrolService.js';
import { tourService } from '../services/TourService.js';
import {
  AgentModeEventTypes,
  type AgentModeEvent,
  type AgentModeEventType,
  type AgentModeState,
  type MirroredAgentModeState,
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
 * Body: { type: AgentModeEventType, robotId, plan?, block?, scene?, state?, memory?, patrol?, finding?, tour?, turn?, timestamp? }
 *
 * Unauthenticated in practice: the robot-agent pushes without an Authorization
 * header, which works because the route sits behind `authMiddleware` and dev
 * runs with `AUTH_DISABLED=true` — same as the compliance-log and task-status
 * pushes. The push is fire-and-forget on the agent side, so this must be cheap
 * and must never fail for reasons the agent cannot act on.
 */
agentModeRoutes.post('/:id/agent-mode/events', (req: Request, res: Response) => {
  try {
    const { type, robotId, plan, block, scene, state, memory, patrol, finding, tour, turn, timestamp } = req.body ?? {};

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
      // Carried, not merged: the digest is not part of AgentModeState, it rides
      // the event out to the WebSocket. Dropping it here is what kept
      // `agent:memory:updated` from ever reaching the app — the robot emitted
      // it, the server re-broadcast an event with the field missing, and the
      // MemoryPanel had nothing to show until someone re-fetched by hand.
      memory,
      // Patrol (TASK-212): the run / finding ride the event to the WebSocket
      // exactly like `memory` — and are ALSO persisted, below.
      patrol,
      finding,
      // Host mode (TASK-213): the tour run / the answered question ride the
      // event out to the WebSocket like `patrol` — and are ALSO persisted below.
      tour,
      turn,
      timestamp: typeof timestamp === 'string' ? timestamp : new Date().toISOString(),
    };

    const merged = agentModeService.ingest(event);
    // Persist patrol runs / findings and raise their alerts. Fire-and-forget:
    // the robot's push must not wait on Prisma, and PatrolService.ingest never
    // throws (it logs). Only the patrol/finding families are handed over.
    if (event.type.startsWith('agent:patrol:') || event.type.startsWith('agent:finding:')) {
      void patrolService.ingest(event);
    }
    // Tour runs + their transcript, same contract: fire-and-forget, and
    // TourService.ingest never throws (it logs).
    if (event.type.startsWith('agent:tour:')) {
      void tourService.ingest(event);
    }
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
 * Body of the 502 below: the robot's Agent Mode state could not be obtained.
 *
 * A DISTINCT answer from the 404, on purpose. A client that folds them together
 * renders "Agent Mode off, E-Stop clear" for a robot nobody could reach — a
 * false-safe reading on a safety surface, and the worst direction for this to
 * fail in. `code` is what a client should branch on; `error` is what it may show.
 */
export const AGENT_STATE_UNAVAILABLE = {
  code: 'AGENT_STATE_UNAVAILABLE',
  error:
    'Agent Mode state UNKNOWN: the robot agent could not be reached or did not answer with a ' +
    'state. This is not "Agent Mode off" — the mode, the plan and the E-Stop latch are all ' +
    'unknown until the robot answers.',
} as const;

/**
 * Stamp a mirrored state with the instants it was ingested (TASK-200).
 *
 * Separate top-level fields rather than something folded into the state: the
 * state is the ROBOT's answer and must stay byte-comparable with what the robot
 * pushed, while these are this SERVER's observations about it. `null` when the
 * service cannot say — never omitted, so a client can tell "the age is unknown"
 * from "this server predates the field" only by the value it sees.
 *
 *  - `mirroredAt` — last ingest of ANY event: the agent was alive then.
 *  - `stateMirroredAt` — last ingest of a SNAPSHOT: the age of THIS body.
 *    Always the one to date `self` by; a block event moves the former and
 *    leaves the state (and its `self`) untouched.
 *  - `serverNow` — this server's clock as it answers, so the age can be taken
 *    inside one frame instead of across two machines' clocks.
 */
function withMirrorTiming(robotId: string, state: AgentModeState): MirroredAgentModeState {
  return {
    ...state,
    mirroredAt: agentModeService.getMirroredAt(robotId),
    stateMirroredAt: agentModeService.getStateMirroredAt(robotId),
    serverNow: agentModeService.nowIso(),
  };
}

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
 * Two failure answers, and the difference between them is the point:
 *
 *  - **404** — this server has no such robot. Nothing exists to have a state.
 *  - **502 `AGENT_STATE_UNAVAILABLE`** — the robot exists and could not be
 *    asked (unreachable, timed out, 401 from its personal-data gate, or an
 *    answer that is not a state). Its mode and its E-Stop latch are UNKNOWN.
 *    This used to be a 404 too, and a client that reads 404 as "nothing yet"
 *    then painted a transport failure as an idle, unlatched robot.
 *
 * Every 200 carries `mirroredAt`, `stateMirroredAt` and `serverNow` (TASK-200).
 * Without them the age of the answer is unknowable downstream, so the app
 * stamped its own fetch time and rendered a 68-minute-old snapshot of a DEAD
 * process as "just now". `stateMirroredAt` — not `mirroredAt` — is the age of
 * THIS body, and `serverNow` is the frame both are measured in, so the reader
 * never subtracts one machine's clock from another's. See {@link
 * MirroredAgentModeState}.
 */
agentModeRoutes.get('/:id/agent-mode', async (req: Request, res: Response) => {
  try {
    // Only a state the robot itself asserted may be served. A mirror seeded by
    // a plan/block/scene event carries `enabled`/`estopActive` from
    // `emptyState()`, which is a guess wearing the same shape as an answer.
    const state = agentModeService.getState(req.params.id);
    if (state && agentModeService.isHydrated(req.params.id)) {
      return res.json(withMirrorTiming(req.params.id, state));
    }

    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ error: 'No agent mode state for robot' });
    }

    try {
      // The agent's `personalDataGate` guards this route: the plan carries the
      // operator's own words. Loopback passes without a token, which is why a
      // single-box deployment never noticed the missing header — off-box it is
      // a 401, and a 401 must not read as "Agent Mode off".
      const httpClient = new HttpClient(
        registered.baseUrl,
        HTTP_TIMEOUTS.SHORT,
        agentServiceAuthHeaders(),
      );
      const live: unknown = await httpClient.get(`/api/v1/robots/${req.params.id}/agent-mode`);
      // A 200 with an empty or shapeless body is not an answer. Ingesting it
      // anyway would seed the mirror from emptyState() and serve fabricated
      // `enabled: false` / `estopActive: false` — the exact bug this fallback
      // exists to avoid. Treat it like an unreachable robot instead.
      if (!isValidAgentModeSnapshot(live)) {
        return res.status(502).json(AGENT_STATE_UNAVAILABLE);
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
      return res.json(withMirrorTiming(req.params.id, merged));
    } catch (error) {
      // Logged, because a 401 here is a deployment fault (no AGENT_MEMORY_TOKEN
      // on a split-host fleet) that is otherwise invisible on the server side.
      console.warn(
        `[AgentMode] live state fetch failed for ${req.params.id}:`,
        error instanceof Error ? error.message : error,
      );
      return res.status(502).json(AGENT_STATE_UNAVAILABLE);
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
 * Statuses a robot-agent answer may keep on its way through a proxy.
 *
 * `404` is the agent's own "I have no memory workspace" / "I have no readable
 * identity", and `400` is its validation of an identity patch — both are things
 * the ROBOT asserted about itself, and both carry a `code` the app branches on.
 * Everything else the agent can return (401/403 from `personalDataGate`, any
 * 5xx) is a fault of the link between server and robot, not an answer, and
 * collapses into {@link AGENT_STATE_UNAVAILABLE}.
 */
const AGENT_ASSERTED_STATUSES: ReadonlySet<number> = new Set([400, 404]);

/** The map is a few hundred KiB at most and served from memory; 5 s is generous. */
const MAP_PROXY_TIMEOUT_MS = 5000;
/** The cloud is up to a few MB of base64 — give it longer than the grid. */
const CLOUD_PROXY_TIMEOUT_MS = 15000;

/**
 * True when a proxied body is something the robot actually said, rather than an
 * empty 200. Same guard as {@link isValidAgentModeSnapshot} serves for the state
 * route: a 200 with no body must become a 502, never a fabricated answer.
 */
function isObjectBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/**
 * Answer a failed personal-data proxy call.
 *
 * Forwards the agent's own 400/404 with its body intact, so the app sees
 * `NO_MEMORY_WORKSPACE` / `NO_IDENTITY` / `IDENTITY_REFUSED` and its reason.
 * Anything else becomes a 502 `AGENT_STATE_UNAVAILABLE` — deliberately NOT a
 * 404: the previous defect on `/agent-mode` was exactly that collapse, and a
 * client reading 404 as "nothing yet" then painted an unreachable robot as an
 * idle, unlatched one.
 */
function respondAgentProxyFailure(
  res: Response,
  error: unknown,
  robotId: string,
  what: string,
): void {
  if (
    error instanceof HttpClientError &&
    error.statusCode !== undefined &&
    AGENT_ASSERTED_STATUSES.has(error.statusCode) &&
    isObjectBody(error.responseBody)
  ) {
    res.status(error.statusCode).json(error.responseBody);
    return;
  }
  // Logged, because a 401 here means `AGENT_MEMORY_TOKEN` is missing on a
  // split-host fleet — a deployment fault that is otherwise invisible.
  console.warn(
    `[AgentMode] ${what} fetch failed for ${robotId}:`,
    error instanceof Error ? error.message : error,
  );
  res.status(502).json(AGENT_STATE_UNAVAILABLE);
}

/**
 * GET /:id/agent-mode/map/cloud — the robot's own 3-D world cloud (TASK-211).
 * A pure proxy to the agent's `GET /api/v1/robots/:id/map/cloud`; `?max=`
 * (points to return, 0 = all) passes through. Same error contract as `/map`:
 * the agent's 404s ("cloud disabled", "nothing yet") pass through, anything
 * else is a 502. The cloud can be a few MB — the budget is longer than the
 * grid's.
 */
agentModeRoutes.get('/:id/agent-mode/map/cloud', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ code: 'ROBOT_NOT_FOUND', error: 'Robot not found' });
    }
    try {
      const httpClient = new HttpClient(registered.baseUrl, CLOUD_PROXY_TIMEOUT_MS);
      const params: Record<string, unknown> = {};
      if (typeof req.query.max === 'string' && /^\d+$/.test(req.query.max)) params.max = req.query.max;
      const cloud: unknown = await httpClient.get(`/api/v1/robots/${req.params.id}/map/cloud`, { params });
      if (!isObjectBody(cloud) || cloud.ok !== true) {
        return res.status(502).json({ ...AGENT_STATE_UNAVAILABLE, error: 'agent returned no cloud' });
      }
      return res.json(cloud);
    } catch (error) {
      if (error instanceof HttpClientError && error.statusCode === 404 && isObjectBody(error.responseBody)) {
        return res.status(404).json(error.responseBody);
      }
      const why = error instanceof Error ? error.message : String(error);
      console.warn(`[AgentMode] cloud fetch failed for ${req.params.id}: ${why}`);
      return res.status(502).json({ ...AGENT_STATE_UNAVAILABLE, error: why });
    }
  } catch (error) {
    console.error('[AgentMode] cloud proxy error:', error);
    return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to fetch cloud' });
  }
});

/**
 * GET /:id/agent-mode/map — the robot's own occupancy map, peers included
 * (TASK-206/207). A pure proxy to the agent's `GET /api/v1/robots/:id/map`:
 * the grid is the ROBOT's belief and the server keeps no copy of it. The
 * agent's own 404s ("map disabled", "nothing integrated yet") pass through
 * with their body; anything else is a 502 with the agent's error text — never
 * an empty map, which would read as "the room is unknown".
 */
agentModeRoutes.get('/:id/agent-mode/map', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ code: 'ROBOT_NOT_FOUND', error: 'Robot not found' });
    }
    try {
      const httpClient = new HttpClient(registered.baseUrl, MAP_PROXY_TIMEOUT_MS);
      const map: unknown = await httpClient.get(`/api/v1/robots/${req.params.id}/map`);
      if (!isObjectBody(map) || map.ok !== true) {
        return res.status(502).json({ ...AGENT_STATE_UNAVAILABLE, error: 'agent returned no map' });
      }
      return res.json(map);
    } catch (error) {
      if (
        error instanceof HttpClientError &&
        error.statusCode === 404 &&
        isObjectBody(error.responseBody)
      ) {
        return res.status(404).json(error.responseBody);
      }
      const why = error instanceof Error ? error.message : String(error);
      console.warn(`[AgentMode] map fetch failed for ${req.params.id}: ${why}`);
      return res.status(502).json({ ...AGENT_STATE_UNAVAILABLE, error: why });
    }
  } catch (error) {
    console.error('[AgentMode] Get map error:', error);
    res.status(500).json({ error: 'Failed to get agent map' });
  }
});

/**
 * GET /:id/agent-mode/memory — the robot's durable-memory digest (TASK-197).
 *
 * A pure proxy to the agent's `GET /api/v1/robots/:id/memory`, and it has to be
 * one: that route sits behind the agent's `personalDataGate`, which strips
 * `Access-Control-Allow-Origin` and refuses cross-origin browser requests
 * outright, so the app can never reach it directly. The header comes from
 * {@link agentServiceAuthHeaders} so it also works off-loopback.
 *
 * Counts, never content — `MEMORY.md` itself stays on the robot, where a read
 * of it can be authorised and audited.
 */
agentModeRoutes.get('/:id/agent-mode/memory', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ code: 'ROBOT_NOT_FOUND', error: 'Robot not found' });
    }

    try {
      const httpClient = new HttpClient(
        registered.baseUrl,
        HTTP_TIMEOUTS.SHORT,
        agentServiceAuthHeaders(),
      );
      const digest: unknown = await httpClient.get(`/api/v1/robots/${req.params.id}/memory`);
      if (!isObjectBody(digest)) {
        return res.status(502).json(AGENT_STATE_UNAVAILABLE);
      }
      return res.json(digest);
    } catch (error) {
      return respondAgentProxyFailure(res, error, req.params.id, 'memory digest');
    }
  } catch (error) {
    console.error('[AgentMode] Get memory error:', error);
    res.status(500).json({ error: 'Failed to get agent memory digest' });
  }
});

/**
 * GET /:id/agent-mode/identity — the robot's ID card, its self and its report.
 *
 * Gated on the agent for the same reason as the memory digest: `IDENTITY.md`
 * carries `Operator` and `Site`, which are personal data.
 */
agentModeRoutes.get('/:id/agent-mode/identity', async (req: Request, res: Response) => {
  try {
    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ code: 'ROBOT_NOT_FOUND', error: 'Robot not found' });
    }

    try {
      const httpClient = new HttpClient(
        registered.baseUrl,
        HTTP_TIMEOUTS.SHORT,
        agentServiceAuthHeaders(),
      );
      const answer: unknown = await httpClient.get(`/api/v1/robots/${req.params.id}/identity`);
      // The robot is authoritative for who it is; an answer without an
      // `identity` is not an identity, and inventing an empty one would let the
      // naming dialog present an unnamed robot as a named one.
      if (!isObjectBody(answer) || !isObjectBody(answer.identity)) {
        return res.status(502).json(AGENT_STATE_UNAVAILABLE);
      }
      return res.json(answer);
    } catch (error) {
      return respondAgentProxyFailure(res, error, req.params.id, 'identity');
    }
  } catch (error) {
    console.error('[AgentMode] Get identity error:', error);
    res.status(500).json({ error: 'Failed to get agent identity' });
  }
});

/** The only labels a client may write; everything else on the card is derived. */
const IDENTITY_LABELS = ['Name', 'Emoji', 'Operator', 'Site'] as const;

/**
 * POST /:id/agent-mode/identity — name the robot. Body: `{Name?, Emoji?,
 * Operator?, Site?}`; `null` clears a field.
 *
 * ONLY the labels the operator actually sent are forwarded. Filling absent ones
 * in with `null` would look like a harmless normalisation and would in fact
 * blank the `Site` of every robot renamed through the dialog — the patch is a
 * patch, and "not mentioned" is not "clear it".
 */
agentModeRoutes.post('/:id/agent-mode/identity', async (req: Request, res: Response) => {
  try {
    const body = isObjectBody(req.body) ? req.body : {};
    const patch: Record<string, unknown> = {};
    for (const label of IDENTITY_LABELS) {
      // Presence, not truthiness: `{Site: null}` is an operator explicitly
      // CLEARING the site, and a `??` chain would swallow it as "not sent".
      const key = label in body ? label : label.toLowerCase() in body ? label.toLowerCase() : null;
      if (key !== null) patch[label] = body[key];
    }
    // Value types are the robot's call, not the proxy's — it owns the card and
    // answers 400 `INVALID_IDENTITY`, which is forwarded verbatim. An EMPTY
    // patch is refused here only to save a round trip.
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        code: 'INVALID_IDENTITY',
        message: 'Provide at least one of Name, Emoji, Operator, Site.',
      });
    }

    const registered = await robotManager.getRegisteredRobot(req.params.id);
    if (!registered) {
      return res.status(404).json({ code: 'ROBOT_NOT_FOUND', error: 'Robot not found' });
    }

    try {
      const httpClient = new HttpClient(
        registered.baseUrl,
        HTTP_TIMEOUTS.SHORT,
        agentServiceAuthHeaders(),
      );
      const answer: unknown = await httpClient.post(
        `/api/v1/robots/${req.params.id}/identity`,
        patch,
      );
      // A write whose result nobody can read is not a confirmed write: the
      // dialog would close on `ok` and the operator would believe a name landed
      // that may not have.
      if (!isObjectBody(answer) || answer.ok !== true) {
        return res.status(502).json(AGENT_STATE_UNAVAILABLE);
      }
      return res.json(answer);
    } catch (error) {
      return respondAgentProxyFailure(res, error, req.params.id, 'identity write');
    }
  } catch (error) {
    console.error('[AgentMode] Write identity error:', error);
    res.status(500).json({ error: 'Failed to write agent identity' });
  }
});

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

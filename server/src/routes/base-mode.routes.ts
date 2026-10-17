/**
 * @file base-mode.routes.ts
 * @description The robot's locomotion MODE — limp / stand / balance — changed
 *              from NeoDEM instead of the Unitree remote (TASK-398). A thin,
 *              audited proxy to the robot agent's `/robots/:id/base/mode`.
 *              Mounted under `/api/robots`.
 * @feature robots
 *
 * | Route                    | Guard          |
 * | ------------------------ | -------------- |
 * | `GET  /:id/base-mode`    | viewerOrAbove  |
 * | `POST /:id/base-mode`    | memberOrAbove  |
 *
 * The authority for what may happen is NOT here. The G1 sidecar measures the
 * FSM and enforces the transition table (stand only from limp, balance only
 * after a settled stand, neither with the arms engaged or its E-stop latched,
 * every change confirmed); the agent adds the control lease, its own latch and
 * Agent Mode. This route adds the role, the lease fields and one compliance
 * entry per attempt, and passes the agent's status and body through verbatim
 * so the UI can show the exact refusal (`bad_transition`, `not_settled`, …).
 */

import { Router, type Request, type Response } from 'express';
import {
  memberOrAbove,
  viewerOrAbove,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js';
import { prisma } from '../database/index.js';
import { robotManager } from '../services/RobotManager.js';
import { complianceLogService } from '../services/ComplianceLogService.js';
import { HttpClient, HttpClientError } from '../services/HttpClient.js';
import { agentServiceAuthHeaders } from '../services/agentServiceAuth.js';
import { getRobotReadinessService } from '../services/robot-supervisor/index.js';

/** The three modes an operator may command. */
export const BASE_MODES = ['limp', 'stand', 'balance'] as const;
export type BaseMode = (typeof BASE_MODES)[number];

/** RPC + GetFsmId confirmation on the sidecar takes up to ~12 s; leave room. */
const POST_TIMEOUT_MS = 16_000;
const GET_TIMEOUT_MS = 4_000;

export interface AgentAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * How the route reaches a robot agent. Injected in tests. Resolves with ANY
 * answer the agent gave (4xx/5xx included); throws only when there was none.
 */
export interface BaseModeAgentPort {
  get(baseUrl: string, robotId: string): Promise<AgentAnswer>;
  post(baseUrl: string, robotId: string, body: Record<string, unknown>): Promise<AgentAnswer>;
}

/** One compliance entry per POST attempt. Never carries the lease id. */
export interface BaseModeAuditEntry {
  robotId: string;
  userId: string;
  tenantId: string | null;
  result: 'ok' | 'denied' | 'failed';
  mode: string | null;
  fromMode: string | null;
  fsmId: number | null;
  code: string | null;
  status: number;
}

export interface BaseModeRoutesOptions {
  /** The agent base URL of a robot the caller may see, or null (→ 404). */
  resolveRobot?: (robotId: string) => Promise<{ baseUrl: string } | null>;
  agent?: BaseModeAgentPort;
  audit?: (entry: BaseModeAuditEntry) => Promise<void> | void;
  /**
   * Whether the robot's sidecar answers, from a fresh cached readiness
   * snapshot (TASK-409); null when none is cached. Lets the app say "sidecar
   * not reachable" instead of "mode control is off".
   */
  sidecarReachable?: (robotId: string) => boolean | null;
}

function cachedSidecarReachable(robotId: string): boolean | null {
  const agent = getRobotReadinessService().cachedAgentReadiness(robotId);
  return agent?.readiness?.sidecar.reachable ?? null;
}

class AgentUnreachableError extends Error {}

function agentPath(robotId: string): string {
  return `/api/v1/robots/${encodeURIComponent(robotId)}/base/mode`;
}

function clientFor(baseUrl: string, timeoutMs: number): HttpClient {
  return new HttpClient(baseUrl.replace(/\/$/, ''), timeoutMs, agentServiceAuthHeaders());
}

/** An agent answer of any status, or AgentUnreachableError when there was none. */
async function call(run: () => Promise<unknown>): Promise<AgentAnswer> {
  try {
    const body = await run();
    return { status: 200, body: (body ?? {}) as Record<string, unknown> };
  } catch (error) {
    if (error instanceof HttpClientError && error.statusCode !== undefined) {
      const body = error.responseBody;
      return {
        status: error.statusCode,
        body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
      };
    }
    throw new AgentUnreachableError(error instanceof Error ? error.message : String(error));
  }
}

export const httpBaseModeAgent: BaseModeAgentPort = {
  get: (baseUrl, robotId) => call(() => clientFor(baseUrl, GET_TIMEOUT_MS).get(agentPath(robotId))),
  post: (baseUrl, robotId, body) =>
    call(() => clientFor(baseUrl, POST_TIMEOUT_MS).post(agentPath(robotId), body)),
};

/** The robot row through the tenant-scoped client, then its agent URL. */
async function defaultResolveRobot(robotId: string): Promise<{ baseUrl: string } | null> {
  const row = await prisma.robot.findUnique({ where: { id: robotId }, select: { id: true } });
  if (!row) return null;
  const registered = await robotManager.getRegisteredRobot(robotId);
  return registered ? { baseUrl: registered.baseUrl } : null;
}

export async function auditBaseModeAttempt(entry: BaseModeAuditEntry): Promise<void> {
  await complianceLogService.logAccess({
    sessionId: `base-mode:${entry.robotId}`,
    robotId: entry.robotId,
    operatorId: entry.userId,
    severity: entry.result === 'ok' ? 'info' : 'warning',
    payload: {
      description: `Robot mode ${entry.mode ?? '?'} ${entry.result}${entry.code ? ` (${entry.code})` : ''}`,
      resourceType: 'robot_base_mode',
      resourceId: entry.robotId,
      action: 'base_mode',
      // The typed field is allowed/denied; the three-way outcome rides in
      // metadata.result.
      result: entry.result === 'ok' ? 'allowed' : 'denied',
      metadata: {
        tenantId: entry.tenantId,
        result: entry.result,
        mode: entry.mode,
        fromMode: entry.fromMode,
        fsmId: entry.fsmId,
        code: entry.code,
        status: entry.status,
      },
    },
  });
}

function isBaseMode(v: unknown): v is BaseMode {
  return typeof v === 'string' && (BASE_MODES as readonly string[]).includes(v);
}

function outcomeOf(status: number): BaseModeAuditEntry['result'] {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 400 && status < 500) return 'denied';
  return 'failed';
}

export function createBaseModeRoutes(options: BaseModeRoutesOptions = {}): Router {
  const router = Router();
  const resolveRobot = options.resolveRobot ?? defaultResolveRobot;
  const agent = options.agent ?? httpBaseModeAgent;
  const audit = options.audit ?? auditBaseModeAttempt;
  const sidecarReachable = options.sidecarReachable ?? cachedSidecarReachable;

  router.get('/:id/base-mode', viewerOrAbove, async (req: Request, res: Response) => {
    const robot = await resolveRobot(req.params.id).catch(() => null);
    if (!robot) {
      res.status(404).json({ code: 'robot_not_found' });
      return;
    }
    try {
      const answer = await agent.get(robot.baseUrl, req.params.id);
      res.status(answer.status).json({ ...answer.body, sidecarReachable: sidecarReachable(req.params.id) });
    } catch {
      res.status(503).json({ code: 'agent_unreachable', error: 'the robot agent did not answer' });
    }
  });

  router.post('/:id/base-mode', memberOrAbove, async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const body = (req.body ?? {}) as { mode?: unknown; leaseId?: unknown; generation?: unknown };
    const robotId = req.params.id;
    const record = (status: number, extra: Partial<BaseModeAuditEntry>): void => {
      Promise.resolve(
        audit({
          robotId,
          userId: user?.id ?? 'unknown',
          tenantId: user?.tenantId ?? null,
          result: outcomeOf(status),
          mode: isBaseMode(body.mode) ? body.mode : null,
          fromMode: null,
          fsmId: null,
          code: null,
          status,
          ...extra,
        }),
      ).catch(() => console.error('[base-mode] audit failed'));
    };

    if (!isBaseMode(body.mode)) {
      record(400, { code: 'invalid_mode' });
      res.status(400).json({ code: 'invalid_mode', error: 'mode must be one of limp, stand, balance' });
      return;
    }
    if (
      typeof body.leaseId !== 'string' ||
      body.leaseId.length === 0 ||
      body.leaseId.length > 128 ||
      typeof body.generation !== 'number' ||
      !Number.isSafeInteger(body.generation) ||
      body.generation < 1
    ) {
      record(400, { code: 'lease_required' });
      res.status(400).json({
        code: 'lease_required',
        error: 'take control first — leaseId (string) and generation (integer ≥ 1) are required',
      });
      return;
    }
    const robot = await resolveRobot(robotId).catch(() => null);
    if (!robot) {
      record(404, { code: 'robot_not_found' });
      res.status(404).json({ code: 'robot_not_found' });
      return;
    }
    try {
      const answer = await agent.post(robot.baseUrl, robotId, {
        mode: body.mode,
        leaseId: body.leaseId,
        generation: body.generation,
      });
      const reply = answer.body;
      const fsmId = typeof reply.fsm_id === 'number' ? reply.fsm_id : null;
      record(answer.status, {
        code: typeof reply.code === 'string' ? reply.code : null,
        fromMode: typeof reply.fromMode === 'string' ? reply.fromMode : null,
        fsmId,
      });
      res.status(answer.status).json(reply);
    } catch {
      // The port throws only when there was no answer at all.
      record(503, { code: 'agent_unreachable' });
      res.status(503).json({ code: 'agent_unreachable', error: 'the robot agent did not answer' });
    }
  });

  return router;
}

export const baseModeRoutes = createBaseModeRoutes();

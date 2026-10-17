/**
 * @file robot-bringup.routes.ts
 * @description A robot's readiness and its robot side (TASK-409): one merged
 *              readiness snapshot (supervisor + agent), and Start/Stop of the
 *              robot-side processes proxied to the robot supervisor (TASK-403)
 *              with role checks, lease checks and one compliance entry per
 *              write. Mounted under `/api/robots`.
 * @feature robots
 *
 * | Route                                         | Guard                          |
 * | --------------------------------------------- | ------------------------------ |
 * | `GET  /:id/readiness`                         | viewerOrAbove (opens the watch)|
 * | `GET  /:id/bringup`                           | viewerOrAbove                  |
 * | `POST /:id/bringup/start`                     | memberOrAbove (+ lease for arm_sdk) |
 * | `POST /:id/bringup/stop`                      | memberOrAbove                  |
 * | `POST /:id/bringup/sidecar-mode`              | memberOrAbove (+ lease for arm_sdk) |
 * | `POST /:id/bringup/steps/:step/(adopt|leave)` | memberOrAbove                  |
 * | `POST /:id/bringup/lan-up`                    | memberOrAbove                  |
 * | `GET  /:id/bringup/logs/:proc?tail=`          | memberOrAbove                  |
 * | `GET  /:id/bringup/logs/:proc/stream`         | memberOrAbove (SSE passthrough)|
 *
 * Nothing here moves the robot. `read_only` cannot command a joint; `arm_sdk`
 * is the motion path, so it needs `confirm: true` AND a control lease the
 * caller holds (D3). Stop never touches the FSM: it answers the last known
 * base mode so the UI can offer "Limp first?" through the base-mode route.
 */

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import {
  memberOrAbove,
  viewerOrAbove,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js';
import { prisma } from '../database/index.js';
import { runAsPlatform } from '../middleware/tenantContext.js';
import { complianceLogService } from '../services/ComplianceLogService.js';
import { hashLeaseId } from '../services/ControlLeaseService.js';
import {
  getRobotReadinessService,
  getSupervisors,
  SIDECAR_MODES,
  SUPERVISOR_PROCS,
  SUPERVISOR_STEP_IDS,
  SupervisorUnreachableError,
  type RobotReadinessService,
  type SupervisorAnswer,
  type SupervisorClient,
  type SupervisorProc,
  type SupervisorSidecarMode,
  type SupervisorStatus,
  type SupervisorStepId,
} from '../services/robot-supervisor/index.js';

export type BringupAction =
  | 'bringup_start'
  | 'bringup_stop'
  | 'bringup_sidecar_mode'
  | 'bringup_adopt'
  | 'bringup_leave'
  | 'bringup_lan_up';

/** One compliance entry per POST. Never carries the lease id. */
export interface BringupAuditEntry {
  robotId: string;
  userId: string;
  tenantId: string | null;
  action: BringupAction;
  mode: string | null;
  step: string | null;
  result: 'ok' | 'denied' | 'failed';
  code: string | null;
  status: number;
}

/** Whether the caller's tenant sees the robot row, another tenant owns it, or no row exists. */
export type RobotVisibility = 'visible' | 'foreign' | 'absent';

export interface RobotBringupRoutesOptions {
  service?: RobotReadinessService;
  supervisorFor?: (robotId: string) => SupervisorClient | undefined;
  visibility?: (robotId: string) => Promise<RobotVisibility>;
  /** The caller holds the robot's live control lease with this secret and generation. */
  holdsLease?: (userId: string, robotId: string, leaseId: string, generation: number) => Promise<boolean>;
  audit?: (entry: BringupAuditEntry) => Promise<void> | void;
}

export async function auditBringupAttempt(entry: BringupAuditEntry): Promise<void> {
  await complianceLogService.logAccess({
    sessionId: `bringup:${entry.robotId}`,
    robotId: entry.robotId,
    operatorId: entry.userId,
    severity: entry.result === 'ok' ? 'info' : 'warning',
    payload: {
      description:
        `Robot side ${entry.action.replace('bringup_', '').replace('_', ' ')}` +
        `${entry.mode ? ` ${entry.mode}` : ''}${entry.step ? ` ${entry.step}` : ''} ${entry.result}` +
        `${entry.code ? ` (${entry.code})` : ''}`,
      resourceType: 'robot_bringup',
      resourceId: entry.robotId,
      action: entry.action,
      result: entry.result === 'ok' ? 'allowed' : 'denied',
      metadata: {
        tenantId: entry.tenantId,
        result: entry.result,
        mode: entry.mode,
        step: entry.step,
        code: entry.code,
        status: entry.status,
      },
    },
  });
}

async function defaultVisibility(robotId: string): Promise<RobotVisibility> {
  const mine = await prisma.robot.findUnique({ where: { id: robotId }, select: { id: true } });
  if (mine) return 'visible';
  const any = await runAsPlatform(() => prisma.robot.findUnique({ where: { id: robotId }, select: { id: true } }));
  return any ? 'foreign' : 'absent';
}

/** The same lease the base-mode POST presents: live, this generation, this secret, this user. */
export async function defaultHoldsLease(
  userId: string,
  robotId: string,
  leaseId: string,
  generation: number,
): Promise<boolean> {
  const row = await prisma.robotControlLease.findUnique({ where: { robotId } });
  return (
    row !== null &&
    row.state === 'held' &&
    row.generation === generation &&
    row.userId === userId &&
    row.leaseIdHash === hashLeaseId(leaseId) &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() > Date.now()
  );
}

/** The write paths, relative to the `/api/robots` mount. */
const BRINGUP_WRITE_PATH =
  /^\/([^/]+)\/bringup\/(start|stop|sidecar-mode|lan-up|steps\/([^/]+)\/(adopt|leave))\/?$/;

function actionOf(sub: string, stepAction: string | undefined): BringupAction {
  if (stepAction === 'adopt') return 'bringup_adopt';
  if (stepAction === 'leave') return 'bringup_leave';
  return ({ start: 'bringup_start', stop: 'bringup_stop', 'sidecar-mode': 'bringup_sidecar_mode', 'lan-up': 'bringup_lan_up' } as const)[
    sub as 'start' | 'stop' | 'sidecar-mode' | 'lan-up'
  ];
}

/**
 * A viewer's bringup write is refused by `writeRoleGuard` on the first
 * `/api/robots` mount, before this router runs. This watcher, mounted ahead of
 * it in `app.ts`, audits that 403 too, so every POST leaves one entry. The
 * router's own handlers never answer 403, so nothing is audited twice.
 */
export function bringupDenialAudit(
  audit: (entry: BringupAuditEntry) => Promise<void> | void = auditBringupAttempt,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const match = req.method === 'POST' ? BRINGUP_WRITE_PATH.exec(req.path) : null;
    if (!match || res.locals.bringupDenialAudit) {
      next();
      return;
    }
    res.locals.bringupDenialAudit = true;
    res.on('finish', () => {
      if (res.statusCode !== 403) return;
      const user = (req as AuthenticatedRequest).user;
      const body = (req.body ?? {}) as { mode?: unknown };
      Promise.resolve(
        audit({
          robotId: decodeURIComponent(match[1]),
          userId: user?.id ?? 'unknown',
          tenantId: user?.tenantId ?? null,
          action: actionOf(match[2].split('/')[0], match[4]),
          mode: typeof body.mode === 'string' ? body.mode.slice(0, 32) : null,
          step: match[3] ?? null,
          result: 'denied',
          code: 'forbidden',
          status: 403,
        }),
      ).catch(() => console.error('[bringup] audit of a role denial failed'));
    });
    next();
  };
}

function isSidecarMode(v: unknown): v is SupervisorSidecarMode {
  return typeof v === 'string' && (SIDECAR_MODES as readonly string[]).includes(v);
}

function leaseFields(body: Record<string, unknown>): { leaseId: string; generation: number } | null {
  const { leaseId, generation } = body;
  if (
    typeof leaseId !== 'string' ||
    leaseId.length === 0 ||
    leaseId.length > 128 ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    return null;
  }
  return { leaseId, generation };
}

function outcomeOf(status: number): BringupAuditEntry['result'] {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 400 && status < 500) return 'denied';
  return 'failed';
}

/** A refusal this route answers itself, before the supervisor is asked. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly text: string,
  ) {
    super(code);
  }
}

export function createRobotBringupRoutes(options: RobotBringupRoutesOptions = {}): Router {
  const router = Router();
  let svc = options.service;
  const service = (): RobotReadinessService => (svc ??= getRobotReadinessService());
  const supervisorFor = options.supervisorFor ?? ((id: string) => getSupervisors().get(id));
  const visibility = options.visibility ?? defaultVisibility;
  const holdsLease = options.holdsLease ?? defaultHoldsLease;
  const audit = options.audit ?? auditBringupAttempt;

  /**
   * The caller may see this robot: its row is in the caller's tenant, or no
   * row exists yet and the server has a supervisor for it (a robot side that
   * has never been started is not registered).
   */
  const mayAccess = async (robotId: string): Promise<boolean> => {
    const v = await visibility(robotId).catch((): RobotVisibility => 'foreign');
    return v === 'visible' || (v === 'absent' && supervisorFor(robotId) !== undefined);
  };

  const requireSupervisor = async (robotId: string): Promise<SupervisorClient> => {
    if (!(await mayAccess(robotId))) throw new Refusal(404, 'robot_not_found', 'no such robot');
    const sup = supervisorFor(robotId);
    if (!sup) throw new Refusal(404, 'no_supervisor', 'this robot has no supervisor configured on the server (ROBOT_SUPERVISORS)');
    return sup;
  };

  const requireLease = async (req: Request, robotId: string, body: Record<string, unknown>): Promise<void> => {
    const user = (req as AuthenticatedRequest).user;
    const lease = leaseFields(body);
    const held = lease && user ? await holdsLease(user.id, robotId, lease.leaseId, lease.generation).catch(() => false) : false;
    if (!held) {
      throw new Refusal(409, 'lease_required', 'arm_sdk is the motion path — take control of the robot first (leaseId + generation of your live lease)');
    }
  };

  /** Run one audited write: exactly one compliance entry per request. */
  const write = (
    action: BringupAction,
    run: (req: Request, sup: SupervisorClient) => Promise<{ answer: SupervisorAnswer; reply?: unknown }>,
  ): RequestHandler => {
    return async (req: Request, res: Response) => {
      const user = (req as AuthenticatedRequest).user;
      const robotId = req.params.id;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const record = (status: number, code: string | null): void => {
        Promise.resolve(
          audit({
            robotId,
            userId: user?.id ?? 'unknown',
            tenantId: user?.tenantId ?? null,
            action,
            mode: typeof body.mode === 'string' ? body.mode.slice(0, 32) : null,
            step: req.params.step ?? null,
            result: outcomeOf(status),
            code,
            status,
          }),
        ).catch(() => console.error('[bringup] audit failed'));
      };
      try {
        const sup = await requireSupervisor(robotId);
        const { answer, reply } = await run(req, sup);
        const out = relay(answer.status, reply ?? answer.body);
        const outBody = out.body as Record<string, unknown> | null;
        const code = outBody && typeof outBody.code === 'string' ? outBody.code : null;
        record(out.status, code);
        service().touch(robotId);
        res.status(out.status).json(out.body);
      } catch (error) {
        if (error instanceof Refusal) {
          record(error.status, error.code);
          res.status(error.status).json({ code: error.code, error: error.text });
          return;
        }
        if (error instanceof SupervisorUnreachableError) {
          record(503, 'supervisor_unreachable');
          res.status(503).json({ code: 'supervisor_unreachable', error: `the robot supervisor did not answer: ${error.message}` });
          return;
        }
        console.error(`[bringup] ${action} failed:`, error instanceof Error ? error.message : error);
        record(500, 'bringup_error');
        if (!res.headersSent) res.status(500).json({ code: 'bringup_error' });
      }
    };
  };

  // -------------------------------------------------------------- reads

  router.get('/:id/readiness', viewerOrAbove, async (req: Request, res: Response) => {
    const robotId = req.params.id;
    if (!(await mayAccess(robotId))) {
      res.status(404).json({ code: 'robot_not_found' });
      return;
    }
    try {
      res.json(await service().getReadiness(robotId));
    } catch (error) {
      console.error('[bringup] readiness failed:', error instanceof Error ? error.message : error);
      res.status(500).json({ code: 'readiness_error' });
    }
  });

  router.get('/:id/bringup', viewerOrAbove, async (req: Request, res: Response) => {
    try {
      const sup = await requireSupervisor(req.params.id);
      const answer = await sup.status();
      sendRelayed(res, answer.status, answer.body);
    } catch (error) {
      sendReadError(res, error);
    }
  });

  router.get('/:id/bringup/logs/:proc', memberOrAbove, async (req: Request, res: Response) => {
    try {
      const sup = await requireSupervisor(req.params.id);
      const proc = procOf(req.params.proc);
      const tail = Math.min(2000, Math.max(1, Number(req.query.tail ?? 200) || 200));
      const answer = await sup.logs(proc, tail);
      sendRelayed(res, answer.status, answer.body);
    } catch (error) {
      sendReadError(res, error);
    }
  });

  router.get('/:id/bringup/logs/:proc/stream', memberOrAbove, async (req: Request, res: Response) => {
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const sup = await requireSupervisor(req.params.id);
      const proc = procOf(req.params.proc);
      const upstream = await sup.streamLogs(proc, abort.signal);
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => '');
        let body: unknown = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { code: 'supervisor_error' };
        }
        sendRelayed(res, upstream.status, body);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const stream = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
      stream.on('error', () => res.end());
      stream.pipe(res);
    } catch (error) {
      if (abort.signal.aborted) return;
      sendReadError(res, error);
    }
  });

  // -------------------------------------------------------------- writes

  router.post(
    '/:id/bringup/start',
    memberOrAbove,
    write('bringup_start', async (req, sup) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isSidecarMode(body.mode)) throw new Refusal(400, 'invalid_mode', 'mode must be read_only or arm_sdk');
      if (body.mode === 'arm_sdk') {
        if (body.confirm !== true) {
          throw new Refusal(400, 'confirm_required', 'starting in arm_sdk needs {"confirm": true}');
        }
        await requireLease(req, req.params.id, body);
      }
      const answer = await sup.start(body.mode);
      if (answer.status >= 200 && answer.status < 300) {
        // Registered by the readiness poll once the agent step is ok.
        const user = (req as AuthenticatedRequest).user;
        service().expectRegistration(req.params.id, user?.tenantId ?? null);
      }
      return { answer };
    }),
  );

  router.post(
    '/:id/bringup/stop',
    memberOrAbove,
    write('bringup_stop', async (req, sup) => {
      const answer = await sup.stop();
      if (answer.status < 200 || answer.status >= 300) return { answer };
      const status = answer.body as unknown as SupervisorStatus;
      const agent = service().cachedAgentReadiness(req.params.id);
      const base = agent?.readiness?.base;
      const baseMode = base
        ? { mode: base.mode, fsmId: base.fsmId ?? null, source: 'agent' as const }
        : status.lastBase
          ? { mode: status.lastBase.mode, fsmId: status.lastBase.fsmId, source: 'supervisor' as const }
          : null;
      return { answer, reply: { status, baseMode } };
    }),
  );

  router.post(
    '/:id/bringup/sidecar-mode',
    memberOrAbove,
    write('bringup_sidecar_mode', async (req, sup) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isSidecarMode(body.mode)) throw new Refusal(400, 'invalid_mode', 'mode must be read_only or arm_sdk');
      if (body.confirm !== true) {
        throw new Refusal(400, 'confirm_required', 'a sidecar mode switch needs {"confirm": true}');
      }
      if (body.mode === 'arm_sdk') await requireLease(req, req.params.id, body);
      return { answer: await sup.sidecarMode(body.mode, true) };
    }),
  );

  for (const action of ['adopt', 'leave'] as const) {
    router.post(
      `/:id/bringup/steps/:step/${action}`,
      memberOrAbove,
      write(action === 'adopt' ? 'bringup_adopt' : 'bringup_leave', async (req, sup) => {
        const step = req.params.step;
        if (!(SUPERVISOR_STEP_IDS as readonly string[]).includes(step)) {
          throw new Refusal(404, 'no_step', `no step ${step}`);
        }
        return { answer: await sup.step(step as SupervisorStepId, action) };
      }),
    );
  }

  router.post(
    '/:id/bringup/lan-up',
    memberOrAbove,
    write('bringup_lan_up', async (_req, sup) => ({ answer: await sup.lanUp() })),
  );

  return router;
}

function procOf(raw: string): SupervisorProc {
  if (!(SUPERVISOR_PROCS as readonly string[]).includes(raw)) throw new Refusal(404, 'no_proc', `no process ${raw}`);
  return raw as SupervisorProc;
}

/**
 * A supervisor answer as the browser should see it. The supervisor's 401
 * means the server's ROBOT_SUPERVISOR_TOKEN is wrong — a server
 * misconfiguration, not the caller's session — and a 401 passed through would
 * make the app refresh its token and resend the request (a second start, a
 * second compliance entry). It goes out as 502 supervisor_auth_failed.
 */
function relay(status: number, body: unknown): { status: number; body: unknown } {
  if (status !== 401) return { status, body };
  return {
    status: 502,
    body: {
      code: 'supervisor_auth_failed',
      error: 'the robot supervisor refused the server\'s token — check ROBOT_SUPERVISOR_TOKEN in the server configuration',
    },
  };
}

function sendRelayed(res: Response, status: number, body: unknown): void {
  const out = relay(status, body);
  res.status(out.status).json(out.body);
}

function sendReadError(res: Response, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof Refusal) {
    res.status(error.status).json({ code: error.code, error: error.text });
    return;
  }
  if (error instanceof SupervisorUnreachableError) {
    res.status(503).json({ code: 'supervisor_unreachable', error: `the robot supervisor did not answer: ${error.message}` });
    return;
  }
  console.error('[bringup] read failed:', error instanceof Error ? error.message : error);
  res.status(500).json({ code: 'bringup_error' });
}

export const robotBringupRoutes = createRobotBringupRoutes();

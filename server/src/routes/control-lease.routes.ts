/**
 * @file control-lease.routes.ts
 * @description Acquire / release / observe a robot-wide control lease
 *              (TASK-317, epic TASK-313). Mounted under `/api/robots`.
 * @feature robots
 *
 * | Route                              | Guard          |
 * | ---------------------------------- | -------------- |
 * | `GET  /:id/control-lease`          | viewerOrAbove  |
 * | `POST /:id/control-lease`          | memberOrAbove  |
 * | `POST /:id/control-lease/release`  | memberOrAbove  |
 *
 * Behind `CONTROL_LEASES_ENABLED` (default off): the GET still answers, with
 * `capability.enabled: false`; both POSTs answer 404 `control_leases_disabled`.
 */

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import {
  memberOrAbove,
  viewerOrAbove,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js';
import {
  ControlLeaseError,
  ControlLeaseService,
  controlLeasesEnabled,
  httpControlLeaseAgent,
  type ControlLeaseAuditEvent,
  type ControlLeaseUser,
} from '../services/ControlLeaseService.js';
import { prisma } from '../database/index.js';
import { robotManager } from '../services/RobotManager.js';
import { complianceLogService } from '../services/ComplianceLogService.js';

/**
 * One compliance entry per lease event. The metadata carries tenant, robot,
 * user, session and generation — by construction never the secret or its hash.
 */
export async function auditControlLeaseEvent(event: ControlLeaseAuditEvent): Promise<void> {
  await complianceLogService.logAccess({
    sessionId: event.sessionId ?? `control-lease:${event.robotId}`,
    robotId: event.robotId,
    operatorId: event.userId,
    severity: event.result === 'denied' ? 'warning' : 'info',
    payload: {
      description: `Control lease ${event.action}${event.reason ? ` (${event.reason})` : ''}`,
      resourceType: 'control_lease',
      resourceId: event.robotId,
      action: event.action,
      result: event.result,
      metadata: {
        tenantId: event.tenantId,
        userId: event.userId,
        sessionId: event.sessionId,
        generation: event.generation,
        ...(event.reason ? { reason: event.reason } : {}),
      },
    },
  });
}

/**
 * The production wiring: the robot row read through the tenant-scoped client
 * (so a foreign tenant's robot is simply not found), the agent URL from the
 * registry, and the real HTTP agent port.
 */
export function createDefaultControlLeaseService(): ControlLeaseService {
  return new ControlLeaseService({
    db: prisma,
    agent: httpControlLeaseAgent,
    audit: auditControlLeaseEvent,
    resolveRobot: async (robotId) => {
      const row = await prisma.robot.findUnique({
        where: { id: robotId },
        select: { id: true, tenantId: true },
      });
      if (!row) return null;
      const registered = await robotManager.getRegisteredRobot(robotId);
      if (!registered) return null;
      return { robotId: row.id, tenantId: row.tenantId ?? null, baseUrl: registered.baseUrl };
    },
  });
}

function leaseUser(req: Request): ControlLeaseUser | null {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    tenantId: user.tenantId ?? null,
    name: user.name,
    email: user.email,
  };
}

function sendError(res: Response, error: unknown, what: string): void {
  if (error instanceof ControlLeaseError) {
    res.status(error.status).json(error.body);
    return;
  }
  // Never echo the error: it may come from Prisma, and nothing about the
  // request (the secret included) belongs in a log line or a response.
  console.error(`[control-lease] ${what} failed`);
  if (!res.headersSent) res.status(500).json({ code: 'control_lease_error' });
}

/** The two write paths, relative to the `/api/robots` mount. */
const LEASE_WRITE_PATH = /^\/([^/]+)\/control-lease(?:\/release)?\/?$/;

/**
 * A role refusal happens in a guard (`writeRoleGuard` at the mount,
 * `memberOrAbove` in the router) before any handler here runs. This watches
 * for it so a viewer's attempt to take or release a robot is audited too. It
 * is mounted ahead of `...protect` in `app.ts` and again inside the router;
 * `res.locals` keeps one request from being audited twice.
 */
export function controlLeaseDenialAudit(
  audit: (event: ControlLeaseAuditEvent) => Promise<void> | void = auditControlLeaseEvent
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const match = req.method === 'POST' ? LEASE_WRITE_PATH.exec(req.path) : null;
    if (!match || res.locals.controlLeaseDenialAudit) {
      next();
      return;
    }
    res.locals.controlLeaseDenialAudit = true;
    const robotId = decodeURIComponent(match[1]);
    res.on('finish', () => {
      if (res.statusCode !== 403) return;
      const user = leaseUser(req);
      Promise.resolve(
        audit({
          action: 'deny',
          result: 'denied',
          robotId,
          tenantId: user?.tenantId ?? null,
          userId: user?.id ?? 'unknown',
          sessionId: null,
          generation: null,
          reason: 'forbidden',
        })
      ).catch(() => console.error('[control-lease] audit of a role denial failed'));
    });
    next();
  };
}

export interface ControlLeaseRoutesOptions {
  service?: ControlLeaseService;
  enabled?: () => boolean;
  audit?: (event: ControlLeaseAuditEvent) => Promise<void> | void;
}

export function createControlLeaseRoutes(options: ControlLeaseRoutesOptions = {}): Router {
  const router = Router();
  const enabled = options.enabled ?? controlLeasesEnabled;
  const audit = options.audit ?? auditControlLeaseEvent;
  let service = options.service;
  const svc = (): ControlLeaseService => (service ??= createDefaultControlLeaseService());
  const auditRoleDenial = controlLeaseDenialAudit(audit);

  /** 404 while the flag is off — the feature does not exist yet. */
  const requireEnabled: RequestHandler = (_req, res, next) => {
    if (!enabled()) {
      res.status(404).json({ code: 'control_leases_disabled' });
      return;
    }
    next();
  };

  router.get('/:id/control-lease', viewerOrAbove, async (req: Request, res: Response) => {
    try {
      const on = enabled();
      const capability = svc().capability(on);
      if (!on) {
        res.json({ capability, holder: null });
        return;
      }
      const user = leaseUser(req);
      if (!user) {
        res.status(401).json({ code: 'unauthorized' });
        return;
      }
      res.json({ capability, holder: await svc().observe(user, req.params.id) });
    } catch (error) {
      sendError(res, error, 'observe');
    }
  });

  router.post(
    '/:id/control-lease',
    requireEnabled,
    auditRoleDenial,
    memberOrAbove,
    async (req: Request, res: Response) => {
      try {
        const user = leaseUser(req);
        if (!user) {
          res.status(401).json({ code: 'unauthorized' });
          return;
        }
        const body = (req.body ?? {}) as { displayName?: unknown };
        const displayName = typeof body.displayName === 'string' ? body.displayName : undefined;
        res.status(201).json(await svc().acquire(user, req.params.id, displayName));
      } catch (error) {
        sendError(res, error, 'acquire');
      }
    }
  );

  router.post(
    '/:id/control-lease/release',
    requireEnabled,
    auditRoleDenial,
    memberOrAbove,
    async (req: Request, res: Response) => {
      try {
        const user = leaseUser(req);
        if (!user) {
          res.status(401).json({ code: 'unauthorized' });
          return;
        }
        const body = (req.body ?? {}) as { leaseId?: unknown; generation?: unknown };
        if (
          typeof body.leaseId !== 'string' ||
          body.leaseId.length === 0 ||
          body.leaseId.length > 128 ||
          typeof body.generation !== 'number' ||
          !Number.isSafeInteger(body.generation) ||
          body.generation < 1
        ) {
          res.status(400).json({ code: 'invalid_release', message: 'leaseId (string) and generation (integer ≥ 1) are required' });
          return;
        }
        res.json(await svc().release(user, req.params.id, body.leaseId, body.generation));
      } catch (error) {
        sendError(res, error, 'release');
      }
    }
  );

  return router;
}

export const controlLeaseRoutes = createControlLeaseRoutes();

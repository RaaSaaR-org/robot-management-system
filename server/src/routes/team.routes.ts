/**
 * @file team.routes.ts
 * @description REST API for tenant-scoped team management (TASK-163).
 * All endpoints require `ownerOnly` — tenant owners manage their own
 * teammates. Super-admins can reach everything via impersonation
 * (TASK-160). Auto-scoped by the Prisma isolation extension.
 * @feature team
 */

import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { ownerOnly } from '../middleware/auth.middleware.js';
import {
  teamService,
  LastOwnerError,
  EmailTakenError,
  InvalidRoleError,
  TeamMemberNotFoundError,
  type AssignableRole,
} from '../services/TeamService.js';
import { prismaErrorToAppError } from '../utils/errors.js';

export const teamRoutes = Router();

// All routes require a tenant-owner or super-admin.
teamRoutes.use(ownerOnly);

function resolveTenantId(req: AuthenticatedRequest): string | null {
  return req.user?.tenantId ?? null;
}

function resolveActorId(req: AuthenticatedRequest): string {
  return req.user?.id ?? 'unknown';
}

/**
 * Last resort in a catch block. Prisma stringifies a failure as the query it
 * tried to run plus the file and line that ran it, so it is mapped first —
 * the owner adding a teammate must never read a database dump.
 */
function sendFailure(res: Response, error: unknown, fallbackStatus: number): void {
  const prismaError = prismaErrorToAppError(error);
  if (prismaError) {
    res.status(prismaError.statusCode).json({ error: prismaError.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  res.status(fallbackStatus).json({ error: message });
}

// ============================================================================
// GET /api/team — list members of the caller's tenant
// ============================================================================

teamRoutes.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res
        .status(400)
        .json({ error: 'Caller has no tenantId — platform users cannot list team members directly.' });
    }
    const members = await teamService.list(tenantId);
    res.json({ members });
  } catch (error) {
    sendFailure(res, error, 500);
  }
});

// ============================================================================
// POST /api/team — add a new teammate
// ============================================================================

teamRoutes.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res
        .status(400)
        .json({ error: 'Caller has no tenantId — cannot add a teammate.' });
    }

    const { name, email, role, tempPassword } = (req.body ?? {}) as {
      name?: string;
      email?: string;
      role?: string;
      tempPassword?: string;
    };

    if (!name || !email || !role) {
      return res
        .status(400)
        .json({ error: 'name, email, and role are required' });
    }

    const result = await teamService.add({
      tenantId,
      name,
      email,
      role: role as AssignableRole,
      tempPassword,
      actorId: resolveActorId(req),
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof InvalidRoleError) {
      return res.status(400).json({ error: error.message });
    }
    sendFailure(res, error, 400);
  }
});

// ============================================================================
// PATCH /api/team/:id — change role or toggle active
// ============================================================================

teamRoutes.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Caller has no tenantId' });
    }

    const { role, isActive } = (req.body ?? {}) as {
      role?: string;
      isActive?: boolean;
    };

    let member;
    if (role) {
      member = await teamService.changeRole({
        tenantId,
        userId: req.params.id,
        newRole: role as AssignableRole,
        actorId: resolveActorId(req),
      });
    }
    if (typeof isActive === 'boolean') {
      if (isActive === false) {
        member = await teamService.deactivate({
          tenantId,
          userId: req.params.id,
          actorId: resolveActorId(req),
        });
      } else {
        member = await teamService.reactivate({
          tenantId,
          userId: req.params.id,
          actorId: resolveActorId(req),
        });
      }
    }

    if (!member) {
      return res
        .status(400)
        .json({ error: 'No supported fields in body (role, isActive)' });
    }
    res.json(member);
  } catch (error) {
    if (error instanceof LastOwnerError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof InvalidRoleError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof TeamMemberNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 400);
  }
});

// ============================================================================
// DELETE /api/team/:id — alias for soft-deactivate
// ============================================================================

teamRoutes.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Caller has no tenantId' });
    }
    const member = await teamService.deactivate({
      tenantId,
      userId: req.params.id,
      actorId: resolveActorId(req),
    });
    res.json(member);
  } catch (error) {
    if (error instanceof LastOwnerError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof TeamMemberNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 400);
  }
});

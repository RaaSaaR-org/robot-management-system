/**
 * @file service-accounts.routes.ts
 * @description REST API for service account + API token management (TASK-165).
 * Mounted at `/api/team/service-accounts`. All endpoints require ownerOnly.
 * @feature auth
 */

import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { ownerOnly } from '../middleware/auth.middleware.js';
import {
  serviceAccountService,
  InvalidServiceRoleError,
  ServiceAccountNotFoundError,
  TokenNotFoundError,
  DuplicateNameError,
  DuplicateTokenNameError,
  type AssignableServiceRole,
} from '../services/ServiceAccountService.js';
import { prismaErrorToAppError } from '../utils/errors.js';

export const serviceAccountRoutes = Router();

serviceAccountRoutes.use(ownerOnly);

function resolveTenantId(req: AuthenticatedRequest): string | null {
  return req.user?.tenantId ?? null;
}

function resolveActorId(req: AuthenticatedRequest): string {
  return req.user?.id ?? 'unknown';
}

/**
 * Last resort in a catch block. Prisma stringifies a failure as the query it
 * tried to run plus the file and line that ran it, so it is mapped first —
 * the owner creating a service account must never read a database dump.
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
// GET / — list service accounts
// ============================================================================

serviceAccountRoutes.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Caller has no tenantId' });
    }
    const accounts = await serviceAccountService.list(tenantId);
    res.json({ accounts });
  } catch (error) {
    // Reads keep the plain 500 they always had. The Prisma mapping is for the
    // write paths: a "record not found" answered by a *collection* endpoint
    // would put the UI in an empty not-found state over a server fault.
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ============================================================================
// POST / — create a service account
// ============================================================================

serviceAccountRoutes.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Caller has no tenantId' });
    }

    const { name, role } = (req.body ?? {}) as { name?: string; role?: string };
    if (!name || !role) {
      return res.status(400).json({ error: 'name and role are required' });
    }

    const account = await serviceAccountService.create({
      tenantId,
      name: name.trim(),
      role: role as AssignableServiceRole,
      actorId: resolveActorId(req),
    });

    res.status(201).json(account);
  } catch (error) {
    if (error instanceof InvalidServiceRoleError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof DuplicateNameError) {
      return res.status(409).json({ error: error.message });
    }
    sendFailure(res, error, 400);
  }
});

// ============================================================================
// DELETE /:id — soft-delete a service account
// ============================================================================

serviceAccountRoutes.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Caller has no tenantId' });
    }

    await serviceAccountService.delete({
      tenantId,
      serviceAccountId: req.params.id,
      actorId: resolveActorId(req),
    });

    res.json({ success: true });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 400);
  }
});

// ============================================================================
// GET /:id/tokens — list tokens for a service account
// ============================================================================

serviceAccountRoutes.get('/:id/tokens', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tokens = await serviceAccountService.listTokens(req.params.id);
    res.json({ tokens });
  } catch (error) {
    sendFailure(res, error, 500);
  }
});

// ============================================================================
// POST /:id/tokens — mint a new token
// ============================================================================

serviceAccountRoutes.post('/:id/tokens', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, expiresInDays } = (req.body ?? {}) as {
      name?: string;
      expiresInDays?: number;
    };
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const result = await serviceAccountService.createToken({
      serviceAccountId: req.params.id,
      name: name.trim(),
      expiresInDays,
      actorId: resolveActorId(req),
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof DuplicateTokenNameError) {
      return res.status(409).json({ error: error.message });
    }
    sendFailure(res, error, 400);
  }
});

// ============================================================================
// POST /:id/tokens/:tokenId/rotate — rotate a token
// ============================================================================

serviceAccountRoutes.post(
  '/:id/tokens/:tokenId/rotate',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await serviceAccountService.rotateToken({
        tokenId: req.params.tokenId,
        serviceAccountId: req.params.id,
        actorId: resolveActorId(req),
      });

      res.json(result);
    } catch (error) {
      if (error instanceof TokenNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      sendFailure(res, error, 400);
    }
  }
);

// ============================================================================
// DELETE /:id/tokens/:tokenId — revoke a token
// ============================================================================

serviceAccountRoutes.delete(
  '/:id/tokens/:tokenId',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await serviceAccountService.revokeToken({
        tokenId: req.params.tokenId,
        serviceAccountId: req.params.id,
        actorId: resolveActorId(req),
      });

      res.json(result);
    } catch (error) {
      if (error instanceof TokenNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      sendFailure(res, error, 400);
    }
  }
);

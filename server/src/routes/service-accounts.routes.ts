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

export const serviceAccountRoutes = Router();

serviceAccountRoutes.use(ownerOnly);

function resolveTenantId(req: AuthenticatedRequest): string | null {
  return req.user?.tenantId ?? null;
}

function resolveActorId(req: AuthenticatedRequest): string {
  return req.user?.id ?? 'unknown';
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ error: message });
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  }
);

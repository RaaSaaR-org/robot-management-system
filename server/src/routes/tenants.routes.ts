/**
 * @file tenants.routes.ts
 * @description REST API for tenant (Organization) management.
 * Visible only when MULTI_TENANCY_ENABLED=true — when the flag is off
 * these routes still respond, but the frontend doesn't surface them.
 * @feature multi-tenancy
 */

import { Router, type Request, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import {
  tenantService,
  TenantNotEmptyError,
  TenantSlugTakenError,
} from '../services/TenantService.js';
import { getTenantId } from '../middleware/tenantContext.js';
import { MULTI_TENANCY_ENABLED, DEFAULT_TENANT_ID } from '../config/features.js';

export const tenantsRoutes = Router();

// ============================================================================
// GET /api/tenants — list all tenants (platform admin view)
// ============================================================================

tenantsRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const tenants = await tenantService.list();
    res.json({ tenants });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /api/tenants/current — caller's own tenant
// ============================================================================
//
// When multi-tenancy is OFF, falls back to the user's `tenantId` claim or
// DEFAULT so the frontend can still render the badge uniformly in dev.

tenantsRoutes.get('/current', async (req: Request, res: Response) => {
  try {
    const fromStore = MULTI_TENANCY_ENABLED ? getTenantId() : undefined;
    const fromUser = (req as AuthenticatedRequest).user?.tenantId;
    const tenantId = fromStore ?? fromUser ?? DEFAULT_TENANT_ID;

    const tenant = await tenantService.get(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Current tenant not found' });
    }
    res.json(tenant);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// POST /api/tenants — create a new tenant
// ============================================================================

tenantsRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { name, slug, logoUrl, plan } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    const tenant = await tenantService.create({
      name,
      slug: typeof slug === 'string' ? slug : undefined,
      logoUrl: typeof logoUrl === 'string' ? logoUrl : null,
      plan: typeof plan === 'string' ? plan : null,
    });
    res.status(201).json(tenant);
  } catch (error) {
    if (error instanceof TenantSlugTakenError) {
      return res.status(409).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// DELETE /api/tenants/:id — delete a tenant (rejects DEFAULT + non-empty)
// ============================================================================

tenantsRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    await tenantService.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    if (error instanceof TenantNotEmptyError) {
      return res.status(409).json({
        error: 'Tenant is not empty',
        counts: error.counts,
      });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Tenant not found' ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

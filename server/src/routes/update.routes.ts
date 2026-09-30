/**
 * @file update.routes.ts
 * @description REST API routes for secure OTA update management
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10 — CLAIMED, NOT MET; see @status.
 * @status unshipped — these routes manage update metadata only. `POST /`
 *   falls back to a fabricated `update-package-<version>` buffer when no
 *   `fileData` is posted, and the UI posts none, so the package that gets
 *   signed is a constant; there is no upload, download or artifact endpoint,
 *   and `POST /:id/deploy/:robotId` records the intent without contacting the
 *   robot. See `../services/UpdateService.ts`. (TASK-302)
 */

import { Router, type Request, type Response } from 'express';
import { updateService, SEMVER_REGEX } from '../services/UpdateService.js';
import type { UpdatePackageStatus } from '../services/UpdateService.js';
import { sendFailure } from '../utils/routeErrors.js';
import { auditBuildAct } from '../services/buildAudit.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const updateRoutes = Router();

function actorOf(req: Request): string | undefined {
  return (req as AuthenticatedRequest).user?.id;
}

// ============================================================================
// PACKAGE ENDPOINTS
// ============================================================================

/**
 * GET / - List all update packages
 * Query params:
 *   - status: 'pending' | 'approved' | 'deployed' | 'rolled_back' | 'archived'
 *   - includeArchived: 'true' to list archived (deleted-with-history) packages too
 */
updateRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as UpdatePackageStatus | undefined;
    const includeArchived = req.query.includeArchived === 'true';
    const packages = await updateService.getUpdatePackages(status, includeArchived);
    res.json(packages);
  } catch (error) {
    console.error('Error listing update packages:', error);
    res.status(500).json({ error: 'Failed to list update packages' });
  }
});

/**
 * POST / - Create a new signed update package
 * Body: { version: string, changelog: string, fileData?: string (base64) }
 */
updateRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { version, changelog, fileData } = req.body;

    if (!version || !changelog) {
      return res.status(400).json({ error: 'Missing required fields: version, changelog' });
    }

    if (!SEMVER_REGEX.test(version)) {
      return res.status(400).json({ error: `Invalid version format: ${version}. Must be semver (e.g. 1.2.3)` });
    }

    // Use provided file data or create a placeholder buffer
    const fileBuffer = fileData
      ? Buffer.from(fileData, 'base64')
      : Buffer.from(`update-package-${version}`);

    const pkg = await updateService.createUpdatePackage({ version, changelog, fileBuffer });
    await auditBuildAct({
      resourceType: 'update_package',
      resourceId: pkg.id,
      action: 'create',
      actorId: actorOf(req),
      metadata: { version: pkg.version, checksum: pkg.checksum },
    });
    res.status(201).json(pkg);
  } catch (error) {
    console.error('Error creating update package:', error);
    res.status(500).json({ error: 'Failed to create update package' });
  }
});

/**
 * GET /deployments/:robotId - Get deployment history for a robot
 * NOTE: Must be registered BEFORE /:id to prevent Express matching
 * "/deployments/abc" as /:id with id="deployments"
 */
updateRoutes.get('/deployments/:robotId', async (req: Request, res: Response) => {
  try {
    const deployments = await updateService.getDeploymentHistory(req.params.robotId);
    res.json(deployments);
  } catch (error) {
    console.error('Error getting deployment history:', error);
    res.status(500).json({ error: 'Failed to get deployment history' });
  }
});

/**
 * GET /:id - Get update package details
 */
updateRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const pkg = await updateService.getUpdatePackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: 'Update package not found' });
    }
    res.json(pkg);
  } catch (error) {
    console.error('Error getting update package:', error);
    res.status(500).json({ error: 'Failed to get update package' });
  }
});

// ============================================================================
// APPROVAL ENDPOINTS
// ============================================================================

/**
 * POST /:id/approve - Approve an update package
 * Body: { approverId: string }
 */
updateRoutes.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { approverId } = req.body;
    if (!approverId) {
      return res.status(400).json({ error: 'Missing required field: approverId' });
    }

    const pkg = await updateService.approveUpdate(req.params.id, approverId);
    res.json(pkg);
  } catch (error) {
    console.error('Error approving update:', error);
    sendFailure(res, error, 'Failed to approve update', 400);
  }
});

// ============================================================================
// DEPLOYMENT ENDPOINTS
// ============================================================================

/**
 * POST /:id/deploy/:robotId - Deploy update to a robot
 * Body: { previousVersion?: string }
 */
updateRoutes.post('/:id/deploy/:robotId', async (req: Request, res: Response) => {
  try {
    const { previousVersion } = req.body;
    const deployment = await updateService.deployToRobot(
      req.params.id,
      req.params.robotId,
      previousVersion
    );
    res.status(201).json(deployment);
  } catch (error) {
    console.error('Error deploying update:', error);
    sendFailure(res, error, 'Failed to deploy update', 400);
  }
});

/**
 * POST /:id/rollback/:robotId - Trigger rollback for a robot
 * Body: { targetVersion: string }
 */
updateRoutes.post('/:id/rollback/:robotId', async (req: Request, res: Response) => {
  try {
    const { targetVersion } = req.body;
    if (!targetVersion) {
      return res.status(400).json({ error: 'Missing required field: targetVersion' });
    }

    const deployment = await updateService.triggerRollback(req.params.id, req.params.robotId, targetVersion);
    await auditBuildAct({
      resourceType: 'update_package',
      resourceId: req.params.id,
      action: 'rollback',
      actorId: actorOf(req),
      metadata: { robotId: req.params.robotId, targetVersion, deploymentId: deployment.id },
    });
    res.json(deployment);
  } catch (error) {
    console.error('Error triggering rollback:', error);
    sendFailure(res, error, 'Failed to trigger rollback', 400);
  }
});

/**
 * DELETE /:id - Delete an update package (TASK-272)
 * Never deployed: the row is removed. Deployed at least once: it is archived
 * instead, so the deployment history stays. Answers { id, outcome }.
 */
updateRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { outcome, snapshot } = await updateService.deleteUpdatePackage(req.params.id);
    await auditBuildAct({
      resourceType: 'update_package',
      resourceId: req.params.id,
      action: outcome === 'deleted' ? 'delete' : 'archive',
      actorId: actorOf(req),
      metadata: { version: snapshot.version, status: snapshot.status, checksum: snapshot.checksum },
    });
    res.json({ id: req.params.id, outcome });
  } catch (error) {
    console.error('Error deleting update package:', error);
    sendFailure(res, error, 'Failed to delete update package');
  }
});

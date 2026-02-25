/**
 * @file update.routes.ts
 * @description REST API routes for secure OTA update management
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10
 */

import { Router, type Request, type Response } from 'express';
import { updateService, SEMVER_REGEX } from '../services/UpdateService.js';
import type { UpdatePackageStatus } from '../services/UpdateService.js';

export const updateRoutes = Router();

// ============================================================================
// PACKAGE ENDPOINTS
// ============================================================================

/**
 * GET / - List all update packages
 * Query params:
 *   - status: 'pending' | 'approved' | 'deployed' | 'rolled_back'
 */
updateRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as UpdatePackageStatus | undefined;
    const packages = await updateService.getUpdatePackages(status);
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
    const message = error instanceof Error ? error.message : 'Failed to approve update';
    console.error('Error approving update:', error);
    res.status(400).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to deploy update';
    console.error('Error deploying update:', error);
    res.status(400).json({ error: message });
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

    const deployment = await updateService.triggerRollback(req.params.robotId, targetVersion);
    res.json(deployment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to trigger rollback';
    console.error('Error triggering rollback:', error);
    res.status(400).json({ error: message });
  }
});

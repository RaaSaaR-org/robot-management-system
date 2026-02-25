/**
 * @file UpdateService.ts
 * @description Secure OTA update management service with Ed25519 signing
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10, Annex I
 */

import crypto from 'node:crypto';
import { prisma } from '../database/index.js';

// ============================================================================
// TYPES
// ============================================================================

export type UpdatePackageStatus = 'pending' | 'approved' | 'deployed' | 'rolled_back';
export type DeploymentStatus = 'pending' | 'downloading' | 'installing' | 'success' | 'failed' | 'rolled_back';

export interface UpdatePackage {
  id: string;
  version: string;
  changelog: string;
  signature: string;
  publicKey: string;
  checksum: string;
  fileSize: number;
  status: UpdatePackageStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface UpdateDeployment {
  id: string;
  packageId: string;
  robotId: string;
  status: DeploymentStatus;
  previousVersion: string | null;
  deployedAt: string | null;
  rolledBackAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface CreateUpdateInput {
  version: string;
  changelog: string;
  fileBuffer: Buffer;
}

export interface UpdateEvent {
  type: 'package_created' | 'package_approved' | 'deployment_started' | 'deployment_completed' | 'rollback_triggered';
  data: UpdatePackage | UpdateDeployment;
  timestamp: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimum allowed version for anti-rollback protection */
const MIN_ALLOWED_VERSION = '0.0.1';

// ============================================================================
// SERVICE
// ============================================================================

export class UpdateService {
  private eventCallbacks: Set<(event: UpdateEvent) => void> = new Set();

  // --------------------------------------------------------------------------
  // PACKAGE MANAGEMENT
  // --------------------------------------------------------------------------

  /**
   * Create a signed update package with Ed25519 signature
   */
  async createUpdatePackage(input: CreateUpdateInput): Promise<UpdatePackage> {
    const { version, changelog, fileBuffer } = input;

    // Generate Ed25519 keypair for this package
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    // Compute SHA-256 checksum of the file
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Sign the checksum with Ed25519
    const signature = crypto.sign(null, Buffer.from(checksum), privateKey);
    const signatureBase64 = signature.toString('base64');
    const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const pkg = await prisma.updatePackage.create({
      data: {
        version,
        changelog,
        signature: signatureBase64,
        publicKey: publicKeyBase64,
        checksum,
        fileSize: fileBuffer.length,
        status: 'pending',
      },
    });

    const result = this.toDomainPackage(pkg);
    this.emitEvent({ type: 'package_created', data: result, timestamp: new Date().toISOString() });
    return result;
  }

  /**
   * Verify an Ed25519 signature against a package checksum
   */
  verifyPackageSignature(packageChecksum: string, signatureBase64: string, publicKeyBase64: string): boolean {
    try {
      const signature = Buffer.from(signatureBase64, 'base64');
      const publicKeyDer = Buffer.from(publicKeyBase64, 'base64');
      const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });

      return crypto.verify(null, Buffer.from(packageChecksum), publicKey, signature);
    } catch (error) {
      console.error('[UpdateService] Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Get all update packages with optional status filter
   */
  async getUpdatePackages(status?: UpdatePackageStatus): Promise<UpdatePackage[]> {
    const where = status ? { status } : {};
    const packages = await prisma.updatePackage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return packages.map((pkg) => this.toDomainPackage(pkg));
  }

  /**
   * Get a single update package by ID
   */
  async getUpdatePackage(id: string): Promise<UpdatePackage | null> {
    const pkg = await prisma.updatePackage.findUnique({ where: { id } });
    return pkg ? this.toDomainPackage(pkg) : null;
  }

  /**
   * Get available updates for a robot (approved packages not yet deployed to that robot)
   */
  async getAvailableUpdates(robotId: string): Promise<UpdatePackage[]> {
    const packages = await prisma.updatePackage.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out packages already deployed to this robot
    const deployed = await prisma.updateDeployment.findMany({
      where: { robotId, status: { in: ['success', 'downloading', 'installing'] } },
      select: { packageId: true },
    });
    const deployedIds = new Set(deployed.map((d) => d.packageId));

    return packages
      .filter((pkg) => !deployedIds.has(pkg.id))
      .map((pkg) => this.toDomainPackage(pkg));
  }

  // --------------------------------------------------------------------------
  // APPROVAL WORKFLOW
  // --------------------------------------------------------------------------

  /**
   * Approve an update package (changes status to 'approved')
   */
  async approveUpdate(updateId: string, approverId: string): Promise<UpdatePackage> {
    const existing = await prisma.updatePackage.findUnique({ where: { id: updateId } });
    if (!existing) {
      throw new Error(`Update package ${updateId} not found`);
    }
    if (existing.status !== 'pending') {
      throw new Error(`Update package ${updateId} is not in pending state (current: ${existing.status})`);
    }

    const pkg = await prisma.updatePackage.update({
      where: { id: updateId },
      data: {
        status: 'approved',
        approvedBy: approverId,
        approvedAt: new Date(),
      },
    });

    const result = this.toDomainPackage(pkg);
    this.emitEvent({ type: 'package_approved', data: result, timestamp: new Date().toISOString() });
    return result;
  }

  // --------------------------------------------------------------------------
  // DEPLOYMENT
  // --------------------------------------------------------------------------

  /**
   * Create a deployment for a robot
   */
  async deployToRobot(packageId: string, robotId: string, previousVersion?: string): Promise<UpdateDeployment> {
    const pkg = await prisma.updatePackage.findUnique({ where: { id: packageId } });
    if (!pkg) {
      throw new Error(`Update package ${packageId} not found`);
    }
    if (pkg.status !== 'approved' && pkg.status !== 'deployed') {
      throw new Error(`Update package ${packageId} must be approved before deployment`);
    }

    // Anti-rollback check
    if (!this.isVersionAllowed(pkg.version)) {
      throw new Error(`Version ${pkg.version} is below minimum allowed version ${MIN_ALLOWED_VERSION}`);
    }

    const deployment = await prisma.updateDeployment.create({
      data: {
        packageId,
        robotId,
        status: 'pending',
        previousVersion: previousVersion ?? null,
      },
    });

    // Update package status to deployed
    if (pkg.status === 'approved') {
      await prisma.updatePackage.update({
        where: { id: packageId },
        data: { status: 'deployed' },
      });
    }

    const result = this.toDomainDeployment(deployment);
    this.emitEvent({ type: 'deployment_started', data: result, timestamp: new Date().toISOString() });
    return result;
  }

  /**
   * Update deployment status
   */
  async updateDeploymentStatus(
    deploymentId: string,
    status: DeploymentStatus,
    errorMessage?: string
  ): Promise<UpdateDeployment> {
    const data: Record<string, unknown> = { status };
    if (status === 'success') {
      data.deployedAt = new Date();
    }
    if (errorMessage) {
      data.errorMessage = errorMessage;
    }

    const deployment = await prisma.updateDeployment.update({
      where: { id: deploymentId },
      data,
    });

    const result = this.toDomainDeployment(deployment);
    if (status === 'success' || status === 'failed') {
      this.emitEvent({ type: 'deployment_completed', data: result, timestamp: new Date().toISOString() });
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // ROLLBACK
  // --------------------------------------------------------------------------

  /**
   * Trigger a rollback for a robot to a previous version
   */
  async triggerRollback(robotId: string, targetVersion: string): Promise<UpdateDeployment> {
    // Anti-rollback: don't allow rollback below minimum version
    if (!this.isVersionAllowed(targetVersion)) {
      throw new Error(`Cannot rollback to version ${targetVersion}: below minimum allowed version ${MIN_ALLOWED_VERSION}`);
    }

    // Find the last successful deployment for this robot
    const lastDeployment = await prisma.updateDeployment.findFirst({
      where: { robotId, status: 'success' },
      orderBy: { deployedAt: 'desc' },
    });

    if (lastDeployment) {
      // Mark previous deployment as rolled back
      await prisma.updateDeployment.update({
        where: { id: lastDeployment.id },
        data: { status: 'rolled_back', rolledBackAt: new Date() },
      });
    }

    // Create a rollback deployment record
    const rollbackDeployment = await prisma.updateDeployment.create({
      data: {
        packageId: lastDeployment?.packageId ?? 'rollback',
        robotId,
        status: 'rolled_back',
        previousVersion: lastDeployment?.previousVersion ?? null,
        rolledBackAt: new Date(),
      },
    });

    const result = this.toDomainDeployment(rollbackDeployment);
    this.emitEvent({ type: 'rollback_triggered', data: result, timestamp: new Date().toISOString() });
    return result;
  }

  // --------------------------------------------------------------------------
  // DEPLOYMENT HISTORY
  // --------------------------------------------------------------------------

  /**
   * Get deployment history for a robot
   */
  async getDeploymentHistory(robotId: string): Promise<UpdateDeployment[]> {
    const deployments = await prisma.updateDeployment.findMany({
      where: { robotId },
      orderBy: { createdAt: 'desc' },
    });
    return deployments.map((d) => this.toDomainDeployment(d));
  }

  // --------------------------------------------------------------------------
  // ANTI-ROLLBACK
  // --------------------------------------------------------------------------

  /**
   * Check if a version is above the minimum allowed version
   */
  isVersionAllowed(version: string): boolean {
    return this.compareVersions(version, MIN_ALLOWED_VERSION) >= 0;
  }

  /**
   * Compare two semver-like version strings
   * Returns: positive if a > b, negative if a < b, 0 if equal
   */
  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  // --------------------------------------------------------------------------
  // EVENTS
  // --------------------------------------------------------------------------

  onEvent(callback: (event: UpdateEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  private emitEvent(event: UpdateEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[UpdateService] Event callback error:', error);
      }
    });
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private toDomainPackage(pkg: {
    id: string;
    version: string;
    changelog: string;
    signature: string;
    publicKey: string;
    checksum: string;
    fileSize: number;
    status: string;
    approvedBy: string | null;
    approvedAt: Date | null;
    createdAt: Date;
  }): UpdatePackage {
    return {
      id: pkg.id,
      version: pkg.version,
      changelog: pkg.changelog,
      signature: pkg.signature,
      publicKey: pkg.publicKey,
      checksum: pkg.checksum,
      fileSize: pkg.fileSize,
      status: pkg.status as UpdatePackageStatus,
      approvedBy: pkg.approvedBy,
      approvedAt: pkg.approvedAt?.toISOString() ?? null,
      createdAt: pkg.createdAt.toISOString(),
    };
  }

  private toDomainDeployment(d: {
    id: string;
    packageId: string;
    robotId: string;
    status: string;
    previousVersion: string | null;
    deployedAt: Date | null;
    rolledBackAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
  }): UpdateDeployment {
    return {
      id: d.id,
      packageId: d.packageId,
      robotId: d.robotId,
      status: d.status as DeploymentStatus,
      previousVersion: d.previousVersion,
      deployedAt: d.deployedAt?.toISOString() ?? null,
      rolledBackAt: d.rolledBackAt?.toISOString() ?? null,
      errorMessage: d.errorMessage,
      createdAt: d.createdAt.toISOString(),
    };
  }
}

// Singleton export
export const updateService = new UpdateService();

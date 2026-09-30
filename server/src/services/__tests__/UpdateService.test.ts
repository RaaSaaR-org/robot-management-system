/**
 * @file UpdateService.test.ts
 * @description Unit tests for UpdateService — Ed25519 signing, approval, rollback, anti-rollback
 * @feature updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing the service
vi.mock('../../database/index.js', () => ({
  prisma: {
    updatePackage: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    updateDeployment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { UpdateService } from '../UpdateService.js';

describe('UpdateService', () => {
  let service: UpdateService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UpdateService();
  });

  // --------------------------------------------------------------------------
  // PACKAGE CREATION & SIGNING
  // --------------------------------------------------------------------------

  describe('createUpdatePackage', () => {
    it('creates a signed package with Ed25519 signature', async () => {
      const { prisma } = await import('../../database/index.js');
      const fileBuffer = Buffer.from('test-update-package');

      (prisma.updatePackage.create as any).mockImplementation(async ({ data }: any) => ({
        id: 'pkg-001',
        version: data.version,
        changelog: data.changelog,
        signature: data.signature,
        publicKey: data.publicKey,
        checksum: data.checksum,
        fileSize: data.fileSize,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        createdAt: new Date(),
      }));

      const result = await service.createUpdatePackage({
        version: '1.1.0',
        changelog: 'Bug fixes and improvements',
        fileBuffer,
      });

      expect(result.id).toBe('pkg-001');
      expect(result.version).toBe('1.1.0');
      expect(result.changelog).toBe('Bug fixes and improvements');
      expect(result.signature).toBeDefined();
      expect(result.signature.length).toBeGreaterThan(0);
      expect(result.publicKey).toBeDefined();
      expect(result.publicKey.length).toBeGreaterThan(0);
      expect(result.checksum).toBeDefined();
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
      expect(result.status).toBe('pending');
    });
  });

  describe('version validation', () => {
    it('rejects invalid semver versions', async () => {
      const fileBuffer = Buffer.from('test-update-package');

      await expect(service.createUpdatePackage({
        version: '../../../etc/passwd',
        changelog: 'malicious',
        fileBuffer,
      })).rejects.toThrow('Invalid version format');
    });

    it('rejects partial semver versions', async () => {
      const fileBuffer = Buffer.from('test-update-package');

      await expect(service.createUpdatePackage({
        version: '1.2',
        changelog: 'partial',
        fileBuffer,
      })).rejects.toThrow('Invalid version format');
    });
  });

  // --------------------------------------------------------------------------
  // SIGNATURE VERIFICATION
  // --------------------------------------------------------------------------

  describe('verifyPackageSignature', () => {
    it('returns true for a valid signature', async () => {
      // Create a real Ed25519 keypair and signature to test verification
      const crypto = await import('node:crypto');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const checksum = 'abc123checksumvalue';
      const signature = crypto.sign(null, Buffer.from(checksum), privateKey);
      const signatureBase64 = signature.toString('base64');
      const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      const result = service.verifyPackageSignature(checksum, signatureBase64, publicKeyBase64);
      expect(result).toBe(true);
    });

    it('returns false for a tampered package', async () => {
      const crypto = await import('node:crypto');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const originalChecksum = 'original-checksum';
      const tamperedChecksum = 'tampered-checksum';
      const signature = crypto.sign(null, Buffer.from(originalChecksum), privateKey);
      const signatureBase64 = signature.toString('base64');
      const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      const result = service.verifyPackageSignature(tamperedChecksum, signatureBase64, publicKeyBase64);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // APPROVAL WORKFLOW
  // --------------------------------------------------------------------------

  describe('approveUpdate', () => {
    it('changes status to approved', async () => {
      const { prisma } = await import('../../database/index.js');

      (prisma.updatePackage.findUnique as any).mockResolvedValue({
        id: 'pkg-001',
        version: '1.1.0',
        changelog: 'Changes',
        signature: 'sig',
        publicKey: 'pk',
        checksum: 'cs',
        fileSize: 100,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        createdAt: new Date(),
      } as any);

      (prisma.updatePackage.update as any).mockResolvedValue({
        id: 'pkg-001',
        version: '1.1.0',
        changelog: 'Changes',
        signature: 'sig',
        publicKey: 'pk',
        checksum: 'cs',
        fileSize: 100,
        status: 'approved',
        approvedBy: 'admin-001',
        approvedAt: new Date(),
        createdAt: new Date(),
      } as any);

      const result = await service.approveUpdate('pkg-001', 'admin-001');
      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('admin-001');
      expect(result.approvedAt).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // ROLLBACK
  // --------------------------------------------------------------------------

  describe('triggerRollback', () => {
    const pkgRow = {
      id: 'pkg-001',
      version: '1.1.0',
      changelog: 'c',
      signature: 's',
      publicKey: 'k',
      checksum: 'x',
      fileSize: 1,
      status: 'deployed',
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(),
    };

    const echoCreate = async ({ data }: any) => ({
      id: 'dep-rb',
      deployedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      ...data,
    });

    it('files the rollback under the rolled-back package when the robot has no successful deployment (TASK-272 FK fix)', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(pkgRow);
      (prisma.updateDeployment.findFirst as any).mockResolvedValue(null);
      (prisma.updateDeployment.create as any).mockImplementation(echoCreate);

      const result = await service.triggerRollback('pkg-001', 'robot-009', '1.0.0');

      const data = (prisma.updateDeployment.create as any).mock.calls[0][0].data;
      // Before the fix this was the literal 'rollback', which no package row has.
      expect(data.packageId).toBe('pkg-001');
      expect(data.previousVersion).toBe('1.0.0');
      expect(result.packageId).toBe('pkg-001');
      expect(result.status).toBe('rolled_back');
      expect(prisma.updateDeployment.update).not.toHaveBeenCalled();
    });

    it('looks up the last successful deployment of this package on this robot only', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(pkgRow);
      (prisma.updateDeployment.findFirst as any).mockResolvedValue(null);
      (prisma.updateDeployment.create as any).mockImplementation(echoCreate);

      await service.triggerRollback('pkg-001', 'robot-001', '1.0.0');

      expect((prisma.updateDeployment.findFirst as any).mock.calls[0][0].where).toEqual({
        packageId: 'pkg-001',
        robotId: 'robot-001',
        status: 'success',
      });
    });

    it('refuses an unknown package with a 404 instead of a foreign-key error', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(null);

      await expect(service.triggerRollback('nope', 'robot-001', '1.0.0')).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.updateDeployment.create).not.toHaveBeenCalled();
    });

    it('creates a rollback deployment', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(pkgRow);

      (prisma.updateDeployment.findFirst as any).mockResolvedValue({
        id: 'dep-001',
        packageId: 'pkg-001',
        robotId: 'robot-001',
        status: 'success',
        previousVersion: '1.0.0',
        deployedAt: new Date(),
        rolledBackAt: null,
        errorMessage: null,
        createdAt: new Date(),
      } as any);

      (prisma.updateDeployment.update as any).mockResolvedValue({} as any);

      (prisma.updateDeployment.create as any).mockResolvedValue({
        id: 'dep-002',
        packageId: 'pkg-001',
        robotId: 'robot-001',
        status: 'rolled_back',
        previousVersion: '1.0.0',
        deployedAt: null,
        rolledBackAt: new Date(),
        errorMessage: null,
        createdAt: new Date(),
      } as any);

      const result = await service.triggerRollback('pkg-001', 'robot-001', '1.0.0');
      expect(result.status).toBe('rolled_back');
      expect(result.rolledBackAt).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // ANTI-ROLLBACK
  // --------------------------------------------------------------------------

  describe('anti-rollback', () => {
    it('rejects downgrade below minAllowedVersion', async () => {
      const { prisma } = await import('../../database/index.js');

      (prisma.updateDeployment.findFirst as any).mockResolvedValue(null);

      await expect(
        service.triggerRollback('pkg-001', 'robot-001', '0.0.0')
      ).rejects.toThrow('below minimum allowed version');
    });

    it('allows version at or above minimum', () => {
      expect(service.isVersionAllowed('0.0.1')).toBe(true);
      expect(service.isVersionAllowed('1.0.0')).toBe(true);
      expect(service.isVersionAllowed('0.0.0')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE (TASK-272)
  // --------------------------------------------------------------------------

  describe('deleteUpdatePackage', () => {
    const row = (status: string) => ({
      id: 'pkg-001',
      version: '1.1.0',
      changelog: 'c',
      signature: 's',
      publicKey: 'k',
      checksum: 'x',
      fileSize: 1,
      status,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(),
    });

    it('removes a package that was never deployed', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(row('approved'));
      (prisma.updateDeployment.count as any).mockResolvedValue(0);

      const result = await service.deleteUpdatePackage('pkg-001');

      expect(result.outcome).toBe('deleted');
      expect(result.snapshot.version).toBe('1.1.0');
      expect(prisma.updatePackage.delete).toHaveBeenCalledWith({ where: { id: 'pkg-001' } });
    });

    it('archives a package with deployment history instead of removing it', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(row('deployed'));
      (prisma.updateDeployment.count as any).mockResolvedValueOnce(3).mockResolvedValueOnce(0);

      const result = await service.deleteUpdatePackage('pkg-001');

      expect(result.outcome).toBe('archived');
      expect(prisma.updatePackage.delete).not.toHaveBeenCalled();
      expect(prisma.updatePackage.update).toHaveBeenCalledWith({
        where: { id: 'pkg-001' },
        data: { status: 'archived' },
      });
    });

    it('refuses while the package is still installing somewhere', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(row('deployed'));
      (prisma.updateDeployment.count as any).mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      await expect(service.deleteUpdatePackage('pkg-001')).rejects.toMatchObject({ statusCode: 409 });
      expect(prisma.updatePackage.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown package', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findUnique as any).mockResolvedValue(null);

      await expect(service.deleteUpdatePackage('nope')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getUpdatePackages', () => {
    it('leaves archived packages out unless asked for', async () => {
      const { prisma } = await import('../../database/index.js');
      (prisma.updatePackage.findMany as any).mockResolvedValue([]);

      await service.getUpdatePackages();
      expect((prisma.updatePackage.findMany as any).mock.calls[0][0].where).toEqual({ status: { not: 'archived' } });

      await service.getUpdatePackages(undefined, true);
      expect((prisma.updatePackage.findMany as any).mock.calls[1][0].where).toEqual({});
    });
  });
});

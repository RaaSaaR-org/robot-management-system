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
    },
    updateDeployment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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
    it('creates a rollback deployment', async () => {
      const { prisma } = await import('../../database/index.js');

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

      const result = await service.triggerRollback('robot-001', '1.0.0');
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
        service.triggerRollback('robot-001', '0.0.0')
      ).rejects.toThrow('below minimum allowed version');
    });

    it('allows version at or above minimum', () => {
      expect(service.isVersionAllowed('0.0.1')).toBe(true);
      expect(service.isVersionAllowed('1.0.0')).toBe(true);
      expect(service.isVersionAllowed('0.0.0')).toBe(false);
    });
  });
});

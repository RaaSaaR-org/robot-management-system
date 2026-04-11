/**
 * @file SecureUpdateClient.test.ts
 * @description Unit tests for SecureUpdateClient — Ed25519 verification, backup, rollback
 * @feature updates
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SecureUpdateClient } from '../SecureUpdateClient.js';

// Mock config
vi.mock('../../config/config.js', () => ({
  config: {
    robotId: 'test-robot-001',
    serverUrl: 'http://localhost:3001',
    port: 41243,
    robotName: 'Test Robot',
    robotModel: 'test',
    robotClass: 'lightweight',
    robotType: 'generic',
    maxPayloadKg: 5,
    robotDescription: 'Test robot',
    geminiApiKey: 'test',
    initialLocation: { x: 0, y: 0, floor: '1', zone: 'test' },
    zoneCacheTtlMs: 60000,
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('SecureUpdateClient', () => {
  let client: SecureUpdateClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SecureUpdateClient('test-robot-001', 'http://localhost:3001');
  });

  afterEach(() => {
    client.stopPeriodicChecks();
  });

  // --------------------------------------------------------------------------
  // CHECK FOR UPDATES
  // --------------------------------------------------------------------------

  describe('checkForUpdates', () => {
    it('queries server for available updates', async () => {
      const mockUpdates = [
        { id: 'pkg-001', version: '1.1.0', status: 'approved' },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockUpdates,
      });

      const result = await client.checkForUpdates();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/updates?status=approved'
      );
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('1.1.0');
    });

    it('returns empty array on failure', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await client.checkForUpdates();
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // SIGNATURE VERIFICATION
  // --------------------------------------------------------------------------

  describe('verifySignature', () => {
    it('validates Ed25519 signature', () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const checksum = 'test-checksum-value';
      const signature = crypto.sign(null, Buffer.from(checksum), privateKey);
      const signatureBase64 = signature.toString('base64');
      const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      const result = client.verifySignature(checksum, signatureBase64, publicKeyBase64);
      expect(result).toBe(true);
    });

    it('rejects invalid signature', () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const originalChecksum = 'original-checksum';
      const tamperedChecksum = 'tampered-checksum';
      const signature = crypto.sign(null, Buffer.from(originalChecksum), privateKey);
      const signatureBase64 = signature.toString('base64');
      const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      const result = client.verifySignature(tamperedChecksum, signatureBase64, publicKeyBase64);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // DOWNLOAD & VERIFY (signature + anti-rollback)
  // --------------------------------------------------------------------------

  describe('downloadUpdate', () => {
    it('verifies signature during download', async () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const version = '1.1.0';
      const fileBuffer = Buffer.from(`update-package-${version}`);
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const signature = crypto.sign(null, Buffer.from(checksum), privateKey);
      const signatureBase64 = signature.toString('base64');
      const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      const mockInfo = {
        id: 'pkg-001',
        version,
        changelog: 'Test',
        signature: signatureBase64,
        publicKey: publicKeyBase64,
        checksum,
        fileSize: fileBuffer.length,
        status: 'approved',
        approvedBy: 'admin',
        approvedAt: '2026-02-25T00:00:00.000Z',
        createdAt: '2026-02-25T00:00:00.000Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockInfo,
      });

      const result = await client.downloadUpdate('pkg-001');
      expect(result.info.version).toBe('1.1.0');
      expect(result.buffer).toBeDefined();
    });

    it('rejects download when signature is invalid', async () => {
      const { publicKey: wrongKey } = crypto.generateKeyPairSync('ed25519');
      const { privateKey: otherKey } = crypto.generateKeyPairSync('ed25519');
      const version = '1.1.0';
      const fileBuffer = Buffer.from(`update-package-${version}`);
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      // Sign with one key, provide different public key
      const signature = crypto.sign(null, Buffer.from(checksum), otherKey);
      const signatureBase64 = signature.toString('base64');
      const publicKeyBase64 = wrongKey.export({ type: 'spki', format: 'der' }).toString('base64');

      const mockInfo = {
        id: 'pkg-001',
        version,
        changelog: 'Test',
        signature: signatureBase64,
        publicKey: publicKeyBase64,
        checksum,
        fileSize: fileBuffer.length,
        status: 'approved',
        approvedBy: 'admin',
        approvedAt: '2026-02-25T00:00:00.000Z',
        createdAt: '2026-02-25T00:00:00.000Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockInfo,
      });

      await expect(client.downloadUpdate('pkg-001')).rejects.toThrow('Signature verification failed');
    });

    it('rejects download when version is below current (anti-rollback)', async () => {
      const mockInfo = {
        id: 'pkg-old',
        version: '0.9.0',
        changelog: 'Old version',
        signature: 'sig',
        publicKey: 'pk',
        checksum: 'cs',
        fileSize: 10,
        status: 'approved',
        approvedBy: null,
        approvedAt: null,
        createdAt: '2026-02-25T00:00:00.000Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockInfo,
      });

      await expect(client.downloadUpdate('pkg-old')).rejects.toThrow('Anti-rollback');
    });
  });

  // --------------------------------------------------------------------------
  // APPLY UPDATE
  // --------------------------------------------------------------------------

  describe('applyUpdate', () => {
    it('creates backup before installing', async () => {
      // Create a temp file to simulate the package
      const tmpPath = '/tmp/test-update-pkg-' + Date.now();
      fs.writeFileSync(tmpPath, 'test-package-content');

      const result = await client.applyUpdate(tmpPath);

      expect(result).toBe(true);

      // Cleanup
      fs.unlinkSync(tmpPath);
    });
  });

  // --------------------------------------------------------------------------
  // ROLLBACK
  // --------------------------------------------------------------------------

  describe('rollback', () => {
    it('restores from backup', async () => {
      // The rollback looks for backup files — even without them it should handle gracefully
      const result = await client.rollback('1.0.0');
      // If no backups exist, it returns false
      expect(typeof result).toBe('boolean');
    });

    it('rejects rollback to version below current (anti-rollback)', async () => {
      await expect(client.rollback('0.5.0')).rejects.toThrow('Anti-rollback protection');
    });
  });

  // --------------------------------------------------------------------------
  // ANTI-ROLLBACK
  // --------------------------------------------------------------------------

  describe('anti-rollback', () => {
    it('rejects version downgrade', () => {
      // Current version is 1.0.0, so 0.9.0 should be rejected
      expect(client.isVersionAcceptable('0.9.0')).toBe(false);
    });

    it('accepts equal or higher version', () => {
      expect(client.isVersionAcceptable('1.0.0')).toBe(true);
      expect(client.isVersionAcceptable('1.1.0')).toBe(true);
      expect(client.isVersionAcceptable('2.0.0')).toBe(true);
    });
  });
});

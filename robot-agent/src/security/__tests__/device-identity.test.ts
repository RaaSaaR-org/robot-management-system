/**
 * @file device-identity.test.ts
 * @description Tests for X.509 device identity management
 * @feature security
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeviceIdentityManager } from '../device-identity.js';

describe('DeviceIdentityManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-id-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates a new certificate on first init', async () => {
    const manager = new DeviceIdentityManager('test-robot-001', tmpDir);
    const identity = await manager.initialize();

    expect(identity.deviceId).toBe('test-robot-001');
    expect(identity.fingerprint).toBeTruthy();
    expect(identity.fingerprint).toContain(':'); // colon-separated hex
    expect(identity.certificate).toContain('-----BEGIN CERTIFICATE-----');
    expect(identity.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(identity.issuedAt).toBeTruthy();
    expect(identity.expiresAt).toBeTruthy();
  });

  it('persists cert and key files to disk', async () => {
    const manager = new DeviceIdentityManager('test-robot-002', tmpDir);
    await manager.initialize();

    expect(fs.existsSync(manager.getCertPath())).toBe(true);
    expect(fs.existsSync(manager.getKeyPath())).toBe(true);

    // Key file should have restrictive permissions
    const keyStats = fs.statSync(manager.getKeyPath());
    // 0o600 = owner rw only (on Unix-like systems)
    expect(keyStats.mode & 0o777).toBe(0o600);
  });

  it('loads existing certificate on subsequent init', async () => {
    const manager1 = new DeviceIdentityManager('test-robot-003', tmpDir);
    const identity1 = await manager1.initialize();

    const manager2 = new DeviceIdentityManager('test-robot-003', tmpDir);
    const identity2 = await manager2.initialize();

    expect(identity2.fingerprint).toBe(identity1.fingerprint);
    expect(identity2.certificate).toBe(identity1.certificate);
  });

  it('generates unique fingerprints per device', async () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'device-id-1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'device-id-2-'));

    try {
      const m1 = new DeviceIdentityManager('robot-A', dir1);
      const m2 = new DeviceIdentityManager('robot-B', dir2);

      const id1 = await m1.initialize();
      const id2 = await m2.initialize();

      expect(id1.fingerprint).not.toBe(id2.fingerprint);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  describe('signChallenge / verifySignature', () => {
    it('signs and verifies a challenge nonce', async () => {
      const manager = new DeviceIdentityManager('test-robot-004', tmpDir);
      await manager.initialize();

      const nonce = 'random-challenge-123456';
      const response = manager.signChallenge(nonce);

      expect(response.nonce).toBe(nonce);
      expect(response.signature).toBeTruthy();
      expect(response.algorithm).toBe('RSA-SHA256');
      expect(response.deviceId).toBe('test-robot-004');

      // Self-verify
      const valid = manager.verifySignature(nonce, response.signature);
      expect(valid).toBe(true);
    });

    it('rejects tampered signature', async () => {
      const manager = new DeviceIdentityManager('test-robot-005', tmpDir);
      await manager.initialize();

      const response = manager.signChallenge('test-nonce');
      const valid = manager.verifySignature('different-nonce', response.signature);
      expect(valid).toBe(false);
    });

    it('throws if not initialized', () => {
      const manager = new DeviceIdentityManager('test-robot-006', tmpDir);
      expect(() => manager.signChallenge('nonce')).toThrow('not initialized');
    });
  });

  describe('getters', () => {
    it('getDeviceCertificate returns PEM', async () => {
      const manager = new DeviceIdentityManager('test-robot-007', tmpDir);
      await manager.initialize();

      const cert = manager.getDeviceCertificate();
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
      expect(cert).toContain('-----END CERTIFICATE-----');
    });

    it('getDeviceFingerprint returns colon-separated hex', async () => {
      const manager = new DeviceIdentityManager('test-robot-008', tmpDir);
      await manager.initialize();

      const fp = manager.getDeviceFingerprint();
      expect(fp).toMatch(/^[A-F0-9]{2}(:[A-F0-9]{2})+$/);
    });

    it('getters throw if not initialized', () => {
      const manager = new DeviceIdentityManager('test-robot-009', tmpDir);
      expect(() => manager.getDeviceCertificate()).toThrow('not initialized');
      expect(() => manager.getDeviceFingerprint()).toThrow('not initialized');
      expect(() => manager.getIdentity()).toThrow('not initialized');
    });
  });
});

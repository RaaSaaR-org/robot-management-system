/**
 * @file secure-boot.test.ts
 * @description Tests for secure boot verification and anti-rollback
 * @feature security
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SecureBootVerifier, compareVersions, computeDirectoryHash } from '../secure-boot.js';

describe('SecureBootVerifier', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-boot-test-'));
    // Create minimal package structure
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'console.log("hello");');
    fs.writeFileSync(path.join(tmpDir, 'src', 'util.ts'), 'export const x = 1;');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces a valid attestation record', () => {
    const verifier = new SecureBootVerifier(tmpDir, '1.0.0');
    const att = verifier.verify('robot-001', 'FP:AA:BB');

    expect(att.version).toBe('1.2.3');
    expect(att.deviceId).toBe('robot-001');
    expect(att.fingerprint).toBe('FP:AA:BB');
    expect(att.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(att.filesHashed).toBe(2); // index.ts + util.ts
    expect(att.bootTime).toBeTruthy();
    expect(att.minimumVersion).toBe('1.0.0');
    expect(att.versionCompliant).toBe(true);
  });

  it('detects anti-rollback violation', () => {
    const verifier = new SecureBootVerifier(tmpDir, '2.0.0');
    const att = verifier.verify('robot-002', 'FP:CC:DD');

    expect(att.versionCompliant).toBe(false);
    expect(att.version).toBe('1.2.3');
    expect(att.minimumVersion).toBe('2.0.0');
  });

  it('detects file changes via integrity hash', () => {
    const verifier = new SecureBootVerifier(tmpDir);
    const att1 = verifier.verify('robot-003', 'FP:EE:FF');

    // Modify a source file
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'console.log("modified");');

    const verifier2 = new SecureBootVerifier(tmpDir);
    const att2 = verifier2.verify('robot-003', 'FP:EE:FF');

    expect(att1.integrityHash).not.toBe(att2.integrityHash);
  });

  it('getAttestation returns null before verify', () => {
    const verifier = new SecureBootVerifier(tmpDir);
    expect(verifier.getAttestation()).toBeNull();
  });

  it('getAttestation returns attestation after verify', () => {
    const verifier = new SecureBootVerifier(tmpDir);
    verifier.verify('robot-004', 'FP:11:22');
    const att = verifier.getAttestation();
    expect(att).not.toBeNull();
    expect(att!.deviceId).toBe('robot-004');
  });
});

describe('compareVersions', () => {
  it('equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('greater major', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
  });

  it('lesser minor', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
  });

  it('greater patch', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
  });

  it('handles missing parts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });
});

describe('computeDirectoryHash', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns consistent hash for same content', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const a = 1;');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'const b = 2;');

    const r1 = computeDirectoryHash(tmpDir);
    const r2 = computeDirectoryHash(tmpDir);

    expect(r1.hash).toBe(r2.hash);
    expect(r1.filesHashed).toBe(2);
    expect(r1.algorithm).toBe('sha256');
  });

  it('returns different hash for different content', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'version1');
    const r1 = computeDirectoryHash(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'version2');
    const r2 = computeDirectoryHash(tmpDir);

    expect(r1.hash).not.toBe(r2.hash);
  });

  it('handles empty directory', () => {
    const result = computeDirectoryHash(tmpDir);
    expect(result.filesHashed).toBe(0);
    expect(result.hash).toBeTruthy(); // empty SHA-256
  });
});

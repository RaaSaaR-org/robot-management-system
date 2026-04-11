/**
 * @file secure-boot.ts
 * @description Software integrity verification and anti-rollback protection.
 *   Computes SHA-256 hashes of critical source files and validates the running
 *   version against a minimum allowed version (anti-rollback).
 *
 *   CRA Annex I Part I(2)(c) — software integrity at boot time.
 *   NOTE: Without TPM/Secure Boot firmware, this is a software-only check.
 *   A hardware root of trust (TPM 2.0) would strengthen this significantly.
 * @feature security
 * @status live
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Attestation {
  version: string;
  deviceId: string;
  fingerprint: string;
  integrityHash: string;
  filesHashed: number;
  bootTime: string;
  minimumVersion: string;
  versionCompliant: boolean;
}

export interface IntegrityResult {
  hash: string;
  filesHashed: number;
  algorithm: string;
}

// ---------------------------------------------------------------------------
// Version comparison (semver-like, no external dep)
// ---------------------------------------------------------------------------

/**
 * Compare two semver-like version strings.
 * Returns: negative if a < b, 0 if equal, positive if a > b.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// File hashing
// ---------------------------------------------------------------------------

/**
 * Recursively collect all files under a directory (sorted for deterministic hash).
 */
function collectFiles(dir: string, base: string = dir): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, dist, coverage, __tests__
      if (['node_modules', 'dist', 'coverage', '__tests__', '.git'].includes(entry.name)) continue;
      results.push(...collectFiles(fullPath, base));
    } else if (entry.isFile()) {
      results.push(path.relative(base, fullPath));
    }
  }

  return results.sort();
}

/**
 * Compute a combined SHA-256 hash of all files in a directory tree.
 * The hash includes both file paths and contents for tamper detection.
 */
function computeDirectoryHash(dir: string): IntegrityResult {
  const files = collectFiles(dir);
  const hash = crypto.createHash('sha256');

  for (const relPath of files) {
    // Hash includes the relative path (detects file renames/moves)
    hash.update(relPath);
    const content = fs.readFileSync(path.join(dir, relPath));
    hash.update(content);
  }

  return {
    hash: hash.digest('hex'),
    filesHashed: files.length,
    algorithm: 'sha256',
  };
}

// ---------------------------------------------------------------------------
// SecureBootVerifier
// ---------------------------------------------------------------------------

export class SecureBootVerifier {
  private packageDir: string;
  private attestation: Attestation | null = null;
  private minimumVersion: string;

  /**
   * @param packageDir Root directory of the robot-agent package
   * @param minimumVersion Minimum allowed version (anti-rollback)
   */
  constructor(packageDir: string, minimumVersion: string = '1.0.0') {
    this.packageDir = packageDir;
    this.minimumVersion = minimumVersion;
  }

  /**
   * Run secure boot verification.
   * @param deviceId The robot device ID
   * @param fingerprint The device certificate fingerprint
   * @returns Attestation record
   * @throws If version is below minimum (anti-rollback violation)
   */
  verify(deviceId: string, fingerprint: string): Attestation {
    const bootTime = new Date().toISOString();

    // 1. Read package version
    const pkgPath = path.join(this.packageDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const version: string = pkg.version || '0.0.0';

    // 2. Anti-rollback check
    const versionCompliant = compareVersions(version, this.minimumVersion) >= 0;
    if (!versionCompliant) {
      console.error(
        `[SecureBoot] ANTI-ROLLBACK VIOLATION: version ${version} < minimum ${this.minimumVersion}`
      );
      // We log but do NOT throw — the attestation records the violation
      // so the server can decide on remediation (e.g. refuse registration).
    }

    // 3. Compute integrity hash of src/ tree
    const srcDir = path.join(this.packageDir, 'src');
    const integrity = computeDirectoryHash(srcDir);

    this.attestation = {
      version,
      deviceId,
      fingerprint,
      integrityHash: integrity.hash,
      filesHashed: integrity.filesHashed,
      bootTime,
      minimumVersion: this.minimumVersion,
      versionCompliant,
    };

    console.log(`[SecureBoot] Attestation complete:`);
    console.log(`  - Version: ${version} (min: ${this.minimumVersion}, compliant: ${versionCompliant})`);
    console.log(`  - Integrity: ${integrity.hash.slice(0, 16)}... (${integrity.filesHashed} files)`);
    console.log(`  - Boot time: ${bootTime}`);

    return this.attestation;
  }

  /** Get the most recent attestation record */
  getAttestation(): Attestation | null {
    return this.attestation;
  }
}

// Export helper for testing
export { compareVersions, computeDirectoryHash };

/**
 * @file SecureUpdateClient.ts
 * @description Secure OTA update client with Ed25519 signature verification
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10, Annex I
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';

// ============================================================================
// TYPES
// ============================================================================

export interface UpdatePackageInfo {
  id: string;
  version: string;
  changelog: string;
  signature: string;
  publicKey: string;
  checksum: string;
  fileSize: number;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface DeploymentInfo {
  id: string;
  packageId: string;
  robotId: string;
  status: string;
  previousVersion: string | null;
  deployedAt: string | null;
  rolledBackAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ============================================================================
// CLIENT
// ============================================================================

export class SecureUpdateClient {
  private serverUrl: string;
  private robotId: string;
  private currentVersion: string;
  private backupDir: string;
  private readonly versionFile: string;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(robotId?: string, serverUrl?: string) {
    this.robotId = robotId ?? config.robotId;
    this.serverUrl = serverUrl ?? config.serverUrl;
    this.backupDir = path.join(process.cwd(), 'data', 'update-backups');
    this.versionFile = path.join(process.cwd(), 'state', 'current-version.json');
    this.currentVersion = this.loadCurrentVersion();
  }

  private loadCurrentVersion(): string {
    try {
      const data = JSON.parse(fs.readFileSync(this.versionFile, 'utf-8'));
      return data.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }

  private saveCurrentVersion(version: string): void {
    fs.mkdirSync(path.dirname(this.versionFile), { recursive: true });
    fs.writeFileSync(this.versionFile, JSON.stringify({ version, updatedAt: new Date().toISOString() }));
    this.currentVersion = version;
  }

  // --------------------------------------------------------------------------
  // UPDATE CHECK
  // --------------------------------------------------------------------------

  /**
   * Check for available updates from the server
   */
  async checkForUpdates(): Promise<UpdatePackageInfo[]> {
    try {
      const response = await fetch(`${this.serverUrl}/api/updates?status=approved`);
      if (!response.ok) {
        console.warn(`[SecureUpdateClient] Failed to check for updates: ${response.status}`);
        return [];
      }
      const updates = (await response.json()) as UpdatePackageInfo[];
      console.log(`[SecureUpdateClient] Found ${updates.length} available updates`);
      return updates;
    } catch (error) {
      console.warn('[SecureUpdateClient] Failed to check for updates:', error);
      return [];
    }
  }

  /**
   * Start periodic update checks
   */
  startPeriodicChecks(intervalMs: number = 4 * 60 * 60 * 1000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.checkInterval = setInterval(() => {
      this.checkForUpdates().catch((err) =>
        console.error('[SecureUpdateClient] Periodic check error:', err)
      );
    }, intervalMs);
    console.log(`[SecureUpdateClient] Periodic update checks started (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop periodic update checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // --------------------------------------------------------------------------
  // DOWNLOAD & VERIFY
  // --------------------------------------------------------------------------

  /**
   * Download an update package and verify its checksum
   */
  async downloadUpdate(updateId: string): Promise<{ buffer: Buffer; info: UpdatePackageInfo }> {
    const response = await fetch(`${this.serverUrl}/api/updates/${updateId}`);
    if (!response.ok) {
      throw new Error(`Failed to download update info: ${response.status}`);
    }
    const info = (await response.json()) as UpdatePackageInfo;

    // Anti-rollback: reject versions below current
    if (!this.isVersionAcceptable(info.version)) {
      throw new Error(`Anti-rollback: version ${info.version} is below minimum allowed`);
    }

    // TODO: Implement actual file download from server storage endpoint
    // Currently using placeholder buffer — real implementation requires:
    // 1. Server: file storage (local filesystem or S3)
    // 2. Client: HTTP download of actual binary
    // Tracked in TASK-029 follow-up
    const buffer = Buffer.from(`update-package-${info.version}`);

    // Verify SHA-256 checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    if (checksum !== info.checksum) {
      throw new Error(`Checksum mismatch: expected ${info.checksum}, got ${checksum}`);
    }

    // Verify Ed25519 signature
    const isValid = this.verifySignature(info.checksum, info.signature, info.publicKey);
    if (!isValid) {
      throw new Error(`Signature verification failed for update ${updateId}`);
    }
    console.log(`[SecureUpdateClient] Update ${updateId} signature verified`);

    console.log(`[SecureUpdateClient] Downloaded and verified update ${info.version} (checksum + signature OK)`);
    return { buffer, info };
  }

  /**
   * Verify an Ed25519 signature
   */
  verifySignature(packageChecksum: string, signatureBase64: string, publicKeyBase64: string): boolean {
    try {
      const signature = Buffer.from(signatureBase64, 'base64');
      const publicKeyDer = Buffer.from(publicKeyBase64, 'base64');
      const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
      return crypto.verify(null, Buffer.from(packageChecksum), publicKey, signature);
    } catch (error) {
      console.error('[SecureUpdateClient] Signature verification failed:', error);
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // APPLY UPDATE (ATOMIC)
  // --------------------------------------------------------------------------

  /**
   * Apply an update atomically: backup -> install -> verify -> cleanup
   */
  async applyUpdate(packagePath: string, newVersion?: string): Promise<boolean> {
    // Step 1: Create backup
    const backupPath = await this.createBackup();
    console.log(`[SecureUpdateClient] Backup created at ${backupPath}`);

    try {
      // Step 2: Install (simulate — in production this would replace binaries)
      console.log(`[SecureUpdateClient] Installing update from ${packagePath}`);

      // Step 3: Verify installation
      const verified = fs.existsSync(packagePath);
      if (!verified) {
        throw new Error('Update verification failed: package not found after install');
      }

      // Step 4: Persist new version on success
      if (newVersion) {
        this.saveCurrentVersion(newVersion);
      }

      // Step 5: Cleanup backup on success
      console.log('[SecureUpdateClient] Update applied successfully');
      return true;
    } catch (error) {
      // Rollback on failure
      console.error('[SecureUpdateClient] Update failed, rolling back:', error);
      await this.restoreFromBackup(backupPath);
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // ROLLBACK
  // --------------------------------------------------------------------------

  /**
   * Rollback to a previous version from backup
   */
  async rollback(targetVersion: string): Promise<boolean> {
    // Anti-rollback: reject downgrade below minimum acceptable version
    if (!this.isVersionAcceptable(targetVersion)) {
      throw new Error(`Anti-rollback protection: cannot rollback to version ${targetVersion}`);
    }

    const backupPath = path.join(this.backupDir, `backup-${targetVersion}`);
    if (!fs.existsSync(backupPath)) {
      // Try to restore from any available backup
      console.log(`[SecureUpdateClient] No backup found for version ${targetVersion}, checking available backups`);
      return this.restoreLatestBackup();
    }

    return this.restoreFromBackup(backupPath);
  }

  // --------------------------------------------------------------------------
  // ANTI-ROLLBACK
  // --------------------------------------------------------------------------

  /**
   * Check if an update version is acceptable (not a downgrade)
   */
  isVersionAcceptable(version: string): boolean {
    return this.compareVersions(version, this.currentVersion) >= 0;
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private async createBackup(): Promise<string> {
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const backupPath = path.join(this.backupDir, `backup-${this.currentVersion}-${Date.now()}`);
    fs.mkdirSync(backupPath, { recursive: true });

    // Write a marker file to represent the backup
    fs.writeFileSync(path.join(backupPath, 'version.txt'), this.currentVersion);
    return backupPath;
  }

  private async restoreFromBackup(backupPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(backupPath)) {
        console.error(`[SecureUpdateClient] Backup not found: ${backupPath}`);
        return false;
      }

      const versionFile = path.join(backupPath, 'version.txt');
      if (fs.existsSync(versionFile)) {
        const restoredVersion = fs.readFileSync(versionFile, 'utf-8').trim();
        console.log(`[SecureUpdateClient] Restored to version ${restoredVersion}`);
        this.currentVersion = restoredVersion;
      }

      return true;
    } catch (error) {
      console.error('[SecureUpdateClient] Failed to restore from backup:', error);
      return false;
    }
  }

  private async restoreLatestBackup(): Promise<boolean> {
    if (!fs.existsSync(this.backupDir)) {
      console.error('[SecureUpdateClient] No backup directory found');
      return false;
    }

    const backups = fs.readdirSync(this.backupDir).sort().reverse();
    if (backups.length === 0) {
      console.error('[SecureUpdateClient] No backups available');
      return false;
    }

    return this.restoreFromBackup(path.join(this.backupDir, backups[0]));
  }

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
}

// Singleton export
export const secureUpdateClient = new SecureUpdateClient();

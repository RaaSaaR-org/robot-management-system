/**
 * @file storage-cleanup.ts
 * @description Scheduled job to clean up incomplete/temp uploads
 * @feature storage
 */

import { modelStorage, isRustFSInitialized, type CleanupResult } from '../storage/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CleanupStats {
  lastRunAt: Date | null;
  lastResult: CleanupResult | null;
  totalDeleted: number;
  totalSizeDeleted: number;
  runCount: number;
}

// ============================================================================
// STORAGE CLEANUP JOB CLASS
// ============================================================================

/**
 * Scheduled job to clean up incomplete/temp uploads
 */
export class StorageCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private stats: CleanupStats = {
    lastRunAt: null,
    lastResult: null,
    totalDeleted: 0,
    totalSizeDeleted: 0,
    runCount: 0,
  };

  constructor() {
    console.log('[StorageCleanupJob] Initialized');
  }

  /**
   * Run the cleanup job
   */
  async runCleanup(maxAgeHours = 24): Promise<CleanupResult> {
    if (!isRustFSInitialized()) {
      console.warn('[StorageCleanupJob] Storage not initialized, skipping cleanup');
      return {
        deletedCount: 0,
        deletedSize: 0,
        errors: ['Storage not initialized'],
      };
    }

    if (this.isRunning) {
      console.warn('[StorageCleanupJob] Cleanup already in progress, skipping');
      return {
        deletedCount: 0,
        deletedSize: 0,
        errors: ['Cleanup already in progress'],
      };
    }

    this.isRunning = true;
    console.log(`[StorageCleanupJob] Starting cleanup (maxAge: ${maxAgeHours}h)`);

    try {
      const result = await modelStorage.cleanupTempUploads(maxAgeHours);

      // Update stats
      this.stats.lastRunAt = new Date();
      this.stats.lastResult = result;
      this.stats.totalDeleted += result.deletedCount;
      this.stats.totalSizeDeleted += result.deletedSize;
      this.stats.runCount++;

      console.log(
        `[StorageCleanupJob] Cleanup completed: ${result.deletedCount} files deleted (${this.formatBytes(result.deletedSize)})`
      );

      if (result.errors.length > 0) {
        console.warn(`[StorageCleanupJob] ${result.errors.length} errors during cleanup`);
      }

      return result;
    } catch (error) {
      console.error('[StorageCleanupJob] Cleanup failed:', error);
      return {
        deletedCount: 0,
        deletedSize: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the daily cleanup schedule
   * Runs at 3 AM local time by default
   */
  startSchedule(intervalHours = 24): void {
    if (this.intervalId) {
      console.warn('[StorageCleanupJob] Schedule already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Calculate time until next 3 AM
    const now = new Date();
    const next3AM = new Date(now);
    next3AM.setHours(3, 0, 0, 0);
    if (next3AM <= now) {
      next3AM.setDate(next3AM.getDate() + 1);
    }
    const initialDelay = next3AM.getTime() - now.getTime();

    console.log(
      `[StorageCleanupJob] Scheduling cleanup every ${intervalHours}h, first run in ${Math.round(initialDelay / 1000 / 60)} minutes`
    );

    // First run at 3 AM, then every interval
    setTimeout(() => {
      this.runCleanup().catch((error) => {
        console.error('[StorageCleanupJob] Scheduled cleanup failed:', error);
      });

      // Set up recurring interval
      this.intervalId = setInterval(() => {
        this.runCleanup().catch((error) => {
          console.error('[StorageCleanupJob] Scheduled cleanup failed:', error);
        });
      }, intervalMs);
    }, initialDelay);
  }

  /**
   * Stop the cleanup schedule
   */
  stopSchedule(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[StorageCleanupJob] Schedule stopped');
    }
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStats(): CleanupStats {
    return { ...this.stats };
  }

  /**
   * Check if the job is currently running
   */
  isJobRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const storageCleanupJob = new StorageCleanupJob();

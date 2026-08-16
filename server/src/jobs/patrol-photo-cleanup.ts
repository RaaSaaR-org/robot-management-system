/**
 * @file patrol-photo-cleanup.ts
 * @description Retention sweep for patrol photos (TASK-212): control photos
 *              after PATROL_PHOTO_RETENTION_H (72 h), baseline/finding photos
 *              after PATROL_PHOTO_RETENTION_DAYS (30 d). Runs shortly after
 *              boot and then hourly — the 72 h window is too fine for the
 *              daily jobs.
 * @feature patrol
 */

import { patrolPhotoStore, photoRetentionFromEnv, type PatrolPhotoSweepResult } from '../services/PatrolPhotoStore.js';

const FIRST_RUN_DELAY_MS = 60_000;

export class PatrolPhotoCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeout: NodeJS.Timeout | null = null;
  private isRunning = false;

  async runCleanup(): Promise<PatrolPhotoSweepResult> {
    if (this.isRunning) {
      return { scanned: 0, deleted: 0, errors: ['Cleanup already in progress'] };
    }
    this.isRunning = true;
    try {
      const retention = photoRetentionFromEnv();
      const result = await patrolPhotoStore.sweep(retention);
      if (result.deleted > 0 || result.errors.length > 0) {
        console.log(
          `[PatrolPhotoCleanupJob] scanned ${result.scanned}, deleted ${result.deleted} ` +
            `(control ${retention.controlHours}h, other ${retention.keepDays}d)` +
            (result.errors.length ? `, ${result.errors.length} error(s)` : ''),
        );
      }
      return result;
    } catch (error) {
      console.error('[PatrolPhotoCleanupJob] Cleanup failed:', error);
      return { scanned: 0, deleted: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] };
    } finally {
      this.isRunning = false;
    }
  }

  /** Start: first sweep one minute after boot, then every `intervalHours` (default 1). */
  startSchedule(intervalHours = 1): void {
    if (this.intervalId || this.initialTimeout) {
      console.warn('[PatrolPhotoCleanupJob] Schedule already running');
      return;
    }
    const intervalMs = intervalHours * 60 * 60 * 1000;
    console.log(`[PatrolPhotoCleanupJob] Scheduling sweep every ${intervalHours}h`);
    this.initialTimeout = setTimeout(() => {
      this.initialTimeout = null;
      void this.runCleanup();
      this.intervalId = setInterval(() => {
        void this.runCleanup();
      }, intervalMs);
    }, FIRST_RUN_DELAY_MS);
  }

  stopSchedule(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const patrolPhotoCleanupJob = new PatrolPhotoCleanupJob();

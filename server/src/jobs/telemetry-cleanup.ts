/**
 * @file telemetry-cleanup.ts
 * @description Scheduled job to delete old persisted robot telemetry rows (TASK-184)
 * @feature robots
 *
 * Runs daily and deletes RobotTelemetry rows older than
 * TELEMETRY_RETENTION_DAYS (default 30).
 */

import { robotRepository } from '../repositories/index.js';

const DEFAULT_RETENTION_DAYS = 30;

function retentionDays(): number {
  const parsed = Number(process.env.TELEMETRY_RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

export interface TelemetryCleanupResult {
  cutoff: Date;
  deletedCount: number;
  errors: string[];
}

export class TelemetryCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeout: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    console.log('[TelemetryCleanupJob] Initialized');
  }

  /**
   * Run the cleanup job: delete telemetry rows past the retention window.
   */
  async runCleanup(): Promise<TelemetryCleanupResult> {
    const days = retentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    if (this.isRunning) {
      console.warn('[TelemetryCleanupJob] Cleanup already in progress, skipping');
      return { cutoff, deletedCount: 0, errors: ['Cleanup already in progress'] };
    }

    this.isRunning = true;
    try {
      const deletedCount = await robotRepository.deleteTelemetryBefore(cutoff);
      if (deletedCount > 0) {
        console.log(
          `[TelemetryCleanupJob] Deleted ${deletedCount} telemetry row(s) older than ${days}d`
        );
      }
      return { cutoff, deletedCount, errors: [] };
    } catch (error) {
      console.error('[TelemetryCleanupJob] Cleanup failed:', error);
      return {
        cutoff,
        deletedCount: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the daily cleanup schedule.
   * Runs at 4 AM local time by default (2 AM = retention, 3 AM = storage).
   */
  startSchedule(intervalHours = 24): void {
    if (this.intervalId || this.initialTimeout) {
      console.warn('[TelemetryCleanupJob] Schedule already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Calculate time until next 4 AM
    const now = new Date();
    const next4AM = new Date(now);
    next4AM.setHours(4, 0, 0, 0);
    if (next4AM <= now) {
      next4AM.setDate(next4AM.getDate() + 1);
    }
    const initialDelay = next4AM.getTime() - now.getTime();

    console.log(
      `[TelemetryCleanupJob] Scheduling cleanup every ${intervalHours}h, first run in ${Math.round(initialDelay / 1000 / 60)} minutes (retention ${retentionDays()}d)`
    );

    // First run at 4 AM, then every interval
    this.initialTimeout = setTimeout(() => {
      this.initialTimeout = null;
      this.runCleanup().catch((error) => {
        console.error('[TelemetryCleanupJob] Scheduled cleanup failed:', error);
      });

      this.intervalId = setInterval(() => {
        this.runCleanup().catch((error) => {
          console.error('[TelemetryCleanupJob] Scheduled cleanup failed:', error);
        });
      }, intervalMs);
    }, initialDelay);
  }

  /**
   * Stop the cleanup schedule
   */
  stopSchedule(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[TelemetryCleanupJob] Schedule stopped');
  }
}

// Export singleton instance
export const telemetryCleanupJob = new TelemetryCleanupJob();

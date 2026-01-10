/**
 * @file RetentionCleanupJob.ts
 * @description Background job for automatic compliance log retention cleanup
 * @feature compliance
 *
 * Runs daily to delete logs past their retention period.
 * Respects legal holds - logs under hold are never deleted.
 */

import { prisma } from '../database/index.js';
import { legalHoldService } from '../services/LegalHoldService.js';
import type { CleanupResult } from '../types/retention.types.js';

export class RetentionCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    console.log('[RetentionCleanupJob] Initialized');
  }

  /**
   * Run the cleanup job
   */
  async runCleanup(): Promise<CleanupResult> {
    if (this.isRunning) {
      console.warn('[RetentionCleanupJob] Cleanup already in progress, skipping');
      return {
        startedAt: new Date(),
        completedAt: new Date(),
        logsScanned: 0,
        logsDeleted: 0,
        logsSkipped: 0,
        errors: [],
      };
    }

    this.isRunning = true;
    const startedAt = new Date();
    const errors: Array<{ logId: string; error: string }> = [];
    let logsDeleted = 0;
    let logsSkipped = 0;

    try {
      console.log('[RetentionCleanupJob] Starting cleanup...');

      // Get all logs that are past their retention expiry
      const expiredLogs = await prisma.complianceLog.findMany({
        where: {
          retentionExpiresAt: {
            lt: new Date(),
          },
          immutable: true, // Only process immutable logs
        },
        select: {
          id: true,
          legalHoldId: true,
          eventType: true,
        },
      });

      console.log(`[RetentionCleanupJob] Found ${expiredLogs.length} expired logs`);

      // Get all log IDs under active legal holds
      const logsUnderHold = new Set(await legalHoldService.getLogsUnderHold());

      // Process each expired log
      for (const log of expiredLogs) {
        try {
          // Check if log is under legal hold
          if (log.legalHoldId || logsUnderHold.has(log.id)) {
            logsSkipped++;
            continue;
          }

          // Delete the log
          await prisma.complianceLog.delete({
            where: { id: log.id },
          });
          logsDeleted++;
        } catch (error) {
          errors.push({
            logId: log.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const completedAt = new Date();
      const result: CleanupResult = {
        startedAt,
        completedAt,
        logsScanned: expiredLogs.length,
        logsDeleted,
        logsSkipped,
        errors,
      };

      console.log(
        `[RetentionCleanupJob] Cleanup completed: ${logsDeleted} deleted, ${logsSkipped} skipped (legal hold), ${errors.length} errors`,
      );

      // Log cleanup as system event (if any logs were processed)
      if (expiredLogs.length > 0) {
        await this.logCleanupActivity(result);
      }

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Log cleanup activity to compliance logs
   */
  private async logCleanupActivity(result: CleanupResult): Promise<void> {
    try {
      // Import dynamically to avoid circular dependency
      const { complianceLogService } = await import('../services/ComplianceLogService.js');

      await complianceLogService.logSystemEvent({
        sessionId: 'system-retention-cleanup',
        robotId: 'system',
        payload: {
          description: 'Automated retention cleanup completed',
          eventName: 'retention_cleanup',
          component: 'RetentionCleanupJob',
          metadata: {
            logsScanned: result.logsScanned,
            logsDeleted: result.logsDeleted,
            logsSkipped: result.logsSkipped,
            errorCount: result.errors.length,
            duration: result.completedAt.getTime() - result.startedAt.getTime(),
          },
        },
        severity: result.errors.length > 0 ? 'warning' : 'info',
      });
    } catch (error) {
      console.error('[RetentionCleanupJob] Failed to log cleanup activity:', error);
    }
  }

  /**
   * Start the daily cleanup schedule
   * Runs at 2 AM local time by default
   */
  startSchedule(intervalHours: number = 24): void {
    if (this.intervalId) {
      console.warn('[RetentionCleanupJob] Schedule already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Calculate time until next 2 AM
    const now = new Date();
    const next2AM = new Date(now);
    next2AM.setHours(2, 0, 0, 0);
    if (next2AM <= now) {
      next2AM.setDate(next2AM.getDate() + 1);
    }
    const initialDelay = next2AM.getTime() - now.getTime();

    console.log(
      `[RetentionCleanupJob] Scheduling cleanup every ${intervalHours}h, first run in ${Math.round(initialDelay / 1000 / 60)} minutes`,
    );

    // First run at 2 AM, then every interval
    setTimeout(() => {
      this.runCleanup().catch((error) => {
        console.error('[RetentionCleanupJob] Scheduled cleanup failed:', error);
      });

      // Set up recurring interval
      this.intervalId = setInterval(() => {
        this.runCleanup().catch((error) => {
          console.error('[RetentionCleanupJob] Scheduled cleanup failed:', error);
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
      console.log('[RetentionCleanupJob] Schedule stopped');
    }
  }

  /**
   * Get statistics about logs approaching retention expiry
   */
  async getRetentionStats(): Promise<{
    totalLogs: number;
    expiringWithin30Days: number;
    expiringWithin90Days: number;
    underLegalHold: number;
    withoutExpiry: number;
  }> {
    const now = new Date();
    const in30Days = new Date(now);
    in30Days.setDate(in30Days.getDate() + 30);
    const in90Days = new Date(now);
    in90Days.setDate(in90Days.getDate() + 90);

    const [total, expiring30, expiring90, underHold, noExpiry] = await Promise.all([
      prisma.complianceLog.count(),
      prisma.complianceLog.count({
        where: {
          retentionExpiresAt: { lte: in30Days, gt: now },
        },
      }),
      prisma.complianceLog.count({
        where: {
          retentionExpiresAt: { lte: in90Days, gt: now },
        },
      }),
      prisma.complianceLog.count({
        where: {
          legalHoldId: { not: null },
        },
      }),
      prisma.complianceLog.count({
        where: {
          retentionExpiresAt: null,
        },
      }),
    ]);

    return {
      totalLogs: total,
      expiringWithin30Days: expiring30,
      expiringWithin90Days: expiring90,
      underLegalHold: underHold,
      withoutExpiry: noExpiry,
    };
  }
}

// Export singleton instance
export const retentionCleanupJob = new RetentionCleanupJob();

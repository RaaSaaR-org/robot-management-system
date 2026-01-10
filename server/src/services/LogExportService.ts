/**
 * @file LogExportService.ts
 * @description Service for exporting compliance logs to JSON
 * @feature compliance
 *
 * Provides export capabilities for audit and regulatory purposes.
 * Exports can include decrypted payloads and are logged in access audit.
 */

import { prisma } from '../database/index.js';
import { decrypt } from '../security/encryption.js';
import type { ExportOptions, ExportResult, ExportedLog } from '../types/retention.types.js';
import { v4 as uuidv4 } from 'uuid';

export class LogExportService {
  constructor() {
    console.log('[LogExportService] Initialized');
  }

  /**
   * Export compliance logs to JSON format
   */
  async exportToJson(options: ExportOptions, exportedBy?: string): Promise<ExportResult> {
    const exportId = uuidv4();
    const exportedAt = new Date();

    // Build query filters
    const where: Record<string, unknown> = {};

    if (options.startDate) {
      where.timestamp = { ...(where.timestamp as object || {}), gte: options.startDate };
    }
    if (options.endDate) {
      where.timestamp = { ...(where.timestamp as object || {}), lte: options.endDate };
    }
    if (options.eventTypes && options.eventTypes.length > 0) {
      where.eventType = { in: options.eventTypes };
    }
    if (options.robotIds && options.robotIds.length > 0) {
      where.robotId = { in: options.robotIds };
    }
    if (options.sessionIds && options.sessionIds.length > 0) {
      where.sessionId = { in: options.sessionIds };
    }

    // Fetch logs
    const logs = await prisma.complianceLog.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    });

    // Transform logs for export
    const exportedLogs: ExportedLog[] = logs.map((log) => {
      const exportedLog: ExportedLog = {
        id: log.id,
        sessionId: log.sessionId,
        robotId: log.robotId,
        operatorId: log.operatorId,
        eventType: log.eventType,
        severity: log.severity,
        payloadHash: log.payloadHash,
        modelVersion: log.modelVersion,
        inputHash: log.inputHash,
        outputHash: log.outputHash,
        previousHash: log.previousHash,
        currentHash: log.currentHash,
        decisionId: log.decisionId,
        timestamp: log.timestamp.toISOString(),
      };

      // Optionally decrypt payload
      if (options.includeDecrypted) {
        try {
          const decrypted = decrypt({ ciphertext: log.payloadEncrypted, iv: log.payloadIv });
          exportedLog.payload = JSON.parse(decrypted);
        } catch (error) {
          console.error(`[LogExportService] Failed to decrypt log ${log.id}:`, error);
          exportedLog.payload = { error: 'Decryption failed' };
        }
      }

      return exportedLog;
    });

    // Record export access for each log
    const accessRecords = logs.map((log) => ({
      logId: log.id,
      userId: exportedBy,
      accessType: 'export' as const,
    }));

    if (accessRecords.length > 0) {
      await prisma.complianceLogAccess.createMany({
        data: accessRecords,
      });
    }

    const filename = `compliance-export-${exportId}.json`;

    console.log(
      `[LogExportService] Exported ${exportedLogs.length} logs to ${filename}`,
    );

    return {
      exportId,
      filename,
      recordCount: exportedLogs.length,
      exportedAt: exportedAt.toISOString(),
      exportedBy: exportedBy ?? null,
      options,
      data: exportedLogs,
    };
  }

  /**
   * Get export history (from access audit logs)
   */
  async getExportHistory(limit: number = 50): Promise<
    Array<{
      timestamp: Date;
      userId: string | null;
      logCount: number;
    }>
  > {
    // Group export accesses by timestamp (within 1 second window)
    const exports = await prisma.complianceLogAccess.findMany({
      where: { accessType: 'export' },
      orderBy: { timestamp: 'desc' },
      take: limit * 10, // Get more to group
    });

    // Group by timestamp (rounded to second) and userId
    const grouped = new Map<string, { timestamp: Date; userId: string | null; count: number }>();

    for (const exp of exports) {
      const key = `${Math.floor(exp.timestamp.getTime() / 1000)}-${exp.userId}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(key, {
          timestamp: exp.timestamp,
          userId: exp.userId,
          count: 1,
        });
      }
    }

    return Array.from(grouped.values())
      .slice(0, limit)
      .map((g) => ({
        timestamp: g.timestamp,
        userId: g.userId,
        logCount: g.count,
      }));
  }
}

// Export singleton instance
export const logExportService = new LogExportService();

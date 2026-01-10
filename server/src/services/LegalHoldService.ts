/**
 * @file LegalHoldService.ts
 * @description Service for managing legal holds on compliance logs
 * @feature compliance
 *
 * Legal holds prevent deletion of logs during investigations or litigation.
 * Logs under legal hold are excluded from retention cleanup.
 */

import { prisma } from '../database/index.js';
import type { LegalHold, LegalHoldInput, AddLogsToHoldInput } from '../types/retention.types.js';

export class LegalHoldService {
  constructor() {
    console.log('[LegalHoldService] Initialized');
  }

  /**
   * Create a new legal hold
   */
  async createHold(input: LegalHoldInput): Promise<LegalHold> {
    const hold = await prisma.legalHold.create({
      data: {
        name: input.name,
        reason: input.reason,
        createdBy: input.createdBy,
        logIds: input.logIds,
        endDate: input.endDate,
        isActive: true,
      },
    });

    // Update compliance logs with legal hold reference
    if (input.logIds.length > 0) {
      await prisma.complianceLog.updateMany({
        where: { id: { in: input.logIds } },
        data: { legalHoldId: hold.id },
      });
    }

    console.log(
      `[LegalHoldService] Created legal hold "${hold.name}" with ${input.logIds.length} logs`,
    );

    return {
      id: hold.id,
      name: hold.name,
      reason: hold.reason,
      createdBy: hold.createdBy,
      startDate: hold.startDate,
      endDate: hold.endDate,
      isActive: hold.isActive,
      logIds: hold.logIds,
      createdAt: hold.createdAt,
      updatedAt: hold.updatedAt,
    };
  }

  /**
   * Release (deactivate) a legal hold
   */
  async releaseHold(holdId: string): Promise<LegalHold | null> {
    const hold = await prisma.legalHold.update({
      where: { id: holdId },
      data: {
        isActive: false,
        endDate: new Date(),
      },
    });

    if (!hold) return null;

    // Clear legal hold reference from logs
    await prisma.complianceLog.updateMany({
      where: { legalHoldId: holdId },
      data: { legalHoldId: null },
    });

    console.log(`[LegalHoldService] Released legal hold "${hold.name}"`);

    return {
      id: hold.id,
      name: hold.name,
      reason: hold.reason,
      createdBy: hold.createdBy,
      startDate: hold.startDate,
      endDate: hold.endDate,
      isActive: hold.isActive,
      logIds: hold.logIds,
      createdAt: hold.createdAt,
      updatedAt: hold.updatedAt,
    };
  }

  /**
   * Get a legal hold by ID
   */
  async getHold(holdId: string): Promise<LegalHold | null> {
    const hold = await prisma.legalHold.findUnique({
      where: { id: holdId },
    });

    if (!hold) return null;

    return {
      id: hold.id,
      name: hold.name,
      reason: hold.reason,
      createdBy: hold.createdBy,
      startDate: hold.startDate,
      endDate: hold.endDate,
      isActive: hold.isActive,
      logIds: hold.logIds,
      createdAt: hold.createdAt,
      updatedAt: hold.updatedAt,
    };
  }

  /**
   * Get all active legal holds
   */
  async getActiveHolds(): Promise<LegalHold[]> {
    const holds = await prisma.legalHold.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return holds.map((hold) => ({
      id: hold.id,
      name: hold.name,
      reason: hold.reason,
      createdBy: hold.createdBy,
      startDate: hold.startDate,
      endDate: hold.endDate,
      isActive: hold.isActive,
      logIds: hold.logIds,
      createdAt: hold.createdAt,
      updatedAt: hold.updatedAt,
    }));
  }

  /**
   * Get all legal holds (active and inactive)
   */
  async getAllHolds(): Promise<LegalHold[]> {
    const holds = await prisma.legalHold.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return holds.map((hold) => ({
      id: hold.id,
      name: hold.name,
      reason: hold.reason,
      createdBy: hold.createdBy,
      startDate: hold.startDate,
      endDate: hold.endDate,
      isActive: hold.isActive,
      logIds: hold.logIds,
      createdAt: hold.createdAt,
      updatedAt: hold.updatedAt,
    }));
  }

  /**
   * Check if a log is under any active legal hold
   */
  async isLogUnderHold(logId: string): Promise<boolean> {
    const log = await prisma.complianceLog.findUnique({
      where: { id: logId },
      select: { legalHoldId: true },
    });

    if (!log?.legalHoldId) return false;

    const hold = await prisma.legalHold.findUnique({
      where: { id: log.legalHoldId },
      select: { isActive: true },
    });

    return hold?.isActive ?? false;
  }

  /**
   * Get all log IDs under active legal holds
   */
  async getLogsUnderHold(): Promise<string[]> {
    const activeHolds = await prisma.legalHold.findMany({
      where: { isActive: true },
      select: { logIds: true },
    });

    const allLogIds = new Set<string>();
    for (const hold of activeHolds) {
      for (const logId of hold.logIds) {
        allLogIds.add(logId);
      }
    }

    return Array.from(allLogIds);
  }

  /**
   * Add logs to an existing legal hold
   */
  async addLogsToHold(input: AddLogsToHoldInput): Promise<LegalHold | null> {
    const hold = await prisma.legalHold.findUnique({
      where: { id: input.holdId },
    });

    if (!hold || !hold.isActive) return null;

    // Merge new log IDs with existing (deduplicated)
    const existingIds = new Set(hold.logIds);
    for (const logId of input.logIds) {
      existingIds.add(logId);
    }
    const updatedLogIds = Array.from(existingIds);

    const updated = await prisma.legalHold.update({
      where: { id: input.holdId },
      data: { logIds: updatedLogIds },
    });

    // Update compliance logs with legal hold reference
    await prisma.complianceLog.updateMany({
      where: { id: { in: input.logIds } },
      data: { legalHoldId: input.holdId },
    });

    console.log(
      `[LegalHoldService] Added ${input.logIds.length} logs to hold "${hold.name}"`,
    );

    return {
      id: updated.id,
      name: updated.name,
      reason: updated.reason,
      createdBy: updated.createdBy,
      startDate: updated.startDate,
      endDate: updated.endDate,
      isActive: updated.isActive,
      logIds: updated.logIds,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Remove logs from a legal hold
   */
  async removeLogsFromHold(holdId: string, logIds: string[]): Promise<LegalHold | null> {
    const hold = await prisma.legalHold.findUnique({
      where: { id: holdId },
    });

    if (!hold) return null;

    const logIdsToRemove = new Set(logIds);
    const updatedLogIds = hold.logIds.filter((id) => !logIdsToRemove.has(id));

    const updated = await prisma.legalHold.update({
      where: { id: holdId },
      data: { logIds: updatedLogIds },
    });

    // Clear legal hold reference from removed logs
    await prisma.complianceLog.updateMany({
      where: { id: { in: logIds }, legalHoldId: holdId },
      data: { legalHoldId: null },
    });

    console.log(
      `[LegalHoldService] Removed ${logIds.length} logs from hold "${hold.name}"`,
    );

    return {
      id: updated.id,
      name: updated.name,
      reason: updated.reason,
      createdBy: updated.createdBy,
      startDate: updated.startDate,
      endDate: updated.endDate,
      isActive: updated.isActive,
      logIds: updated.logIds,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}

// Export singleton instance
export const legalHoldService = new LegalHoldService();

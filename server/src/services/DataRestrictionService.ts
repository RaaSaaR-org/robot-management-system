/**
 * @file DataRestrictionService.ts
 * @description Service for managing data processing restrictions (GDPR Art. 18)
 * @feature gdpr
 *
 * Handles processing restrictions when:
 * - User disputes accuracy of data
 * - Processing is unlawful but user opposes erasure
 * - Controller no longer needs data but user needs it for legal claims
 * - User has objected to processing (pending verification)
 */

import { prisma } from '../database/index.js';
import type {
  DataRestriction,
  RestrictionScope,
  RestrictionReason,
  CreateRestrictionInput,
} from '../types/gdpr.types.js';

export class DataRestrictionService {
  constructor() {
    console.log('[DataRestrictionService] Initialized');
  }

  /**
   * Create a new data restriction
   */
  async createRestriction(input: CreateRestrictionInput): Promise<DataRestriction> {
    const restriction = await prisma.dataRestriction.create({
      data: {
        userId: input.userId,
        scope: input.scope,
        reason: input.reason,
        gdprRequestId: input.gdprRequestId,
        isActive: true,
      },
    });

    console.log(
      `[DataRestrictionService] Created ${input.scope} restriction for user ${input.userId}: ${input.reason}`,
    );

    return this.mapToDataRestriction(restriction);
  }

  /**
   * Lift (deactivate) a restriction
   */
  async liftRestriction(restrictionId: string, adminId?: string): Promise<DataRestriction> {
    const restriction = await prisma.dataRestriction.update({
      where: { id: restrictionId },
      data: {
        isActive: false,
        endDate: new Date(),
      },
    });

    console.log(
      `[DataRestrictionService] Lifted restriction ${restrictionId}${adminId ? ` by ${adminId}` : ''}`,
    );

    return this.mapToDataRestriction(restriction);
  }

  /**
   * Get all restrictions for a user
   */
  async getUserRestrictions(userId: string, activeOnly = true): Promise<DataRestriction[]> {
    const where: Record<string, unknown> = { userId };
    if (activeOnly) {
      where.isActive = true;
    }

    const restrictions = await prisma.dataRestriction.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });

    return restrictions.map(this.mapToDataRestriction);
  }

  /**
   * Check if processing is restricted for a user in a specific scope
   */
  async isProcessingRestricted(userId: string, scope: RestrictionScope): Promise<boolean> {
    const restriction = await prisma.dataRestriction.findFirst({
      where: {
        userId,
        isActive: true,
        OR: [{ scope: 'all' }, { scope }],
      },
    });

    return restriction !== null;
  }

  /**
   * Get all active restrictions (admin view)
   */
  async getActiveRestrictions(): Promise<DataRestriction[]> {
    const restrictions = await prisma.dataRestriction.findMany({
      where: { isActive: true },
      orderBy: { startDate: 'desc' },
    });

    return restrictions.map(this.mapToDataRestriction);
  }

  /**
   * Get restriction by ID
   */
  async getRestriction(restrictionId: string): Promise<DataRestriction | null> {
    const restriction = await prisma.dataRestriction.findUnique({
      where: { id: restrictionId },
    });

    return restriction ? this.mapToDataRestriction(restriction) : null;
  }

  /**
   * Lift all restrictions for a user (e.g., when objection is resolved)
   */
  async liftAllRestrictions(userId: string, reason?: string): Promise<number> {
    const result = await prisma.dataRestriction.updateMany({
      where: { userId, isActive: true },
      data: {
        isActive: false,
        endDate: new Date(),
      },
    });

    console.log(
      `[DataRestrictionService] Lifted ${result.count} restrictions for user ${userId}${reason ? `: ${reason}` : ''}`,
    );

    return result.count;
  }

  /**
   * Get restrictions by GDPR request ID
   */
  async getRestrictionsByRequest(gdprRequestId: string): Promise<DataRestriction[]> {
    const restrictions = await prisma.dataRestriction.findMany({
      where: { gdprRequestId },
      orderBy: { startDate: 'desc' },
    });

    return restrictions.map(this.mapToDataRestriction);
  }

  /**
   * Get restriction statistics (admin)
   */
  async getRestrictionStats(): Promise<{
    activeRestrictions: number;
    restrictionsByScope: Record<string, number>;
    restrictionsByReason: Record<string, number>;
  }> {
    const [activeCount, byScope, byReason] = await Promise.all([
      prisma.dataRestriction.count({ where: { isActive: true } }),
      prisma.dataRestriction.groupBy({
        by: ['scope'],
        where: { isActive: true },
        _count: true,
      }),
      prisma.dataRestriction.groupBy({
        by: ['reason'],
        where: { isActive: true },
        _count: true,
      }),
    ]);

    return {
      activeRestrictions: activeCount,
      restrictionsByScope: Object.fromEntries(byScope.map((r) => [r.scope, r._count])),
      restrictionsByReason: Object.fromEntries(byReason.map((r) => [r.reason, r._count])),
    };
  }

  private mapToDataRestriction(restriction: {
    id: string;
    userId: string;
    scope: string;
    reason: string;
    gdprRequestId: string | null;
    startDate: Date;
    endDate: Date | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): DataRestriction {
    return {
      id: restriction.id,
      userId: restriction.userId,
      scope: restriction.scope as RestrictionScope,
      reason: restriction.reason as RestrictionReason,
      gdprRequestId: restriction.gdprRequestId,
      startDate: restriction.startDate,
      endDate: restriction.endDate,
      isActive: restriction.isActive,
      createdAt: restriction.createdAt,
      updatedAt: restriction.updatedAt,
    };
  }
}

// Export singleton instance
export const dataRestrictionService = new DataRestrictionService();

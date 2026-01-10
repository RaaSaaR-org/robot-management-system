/**
 * @file ConsentService.ts
 * @description Service for managing user consent (GDPR-compliant)
 * @feature gdpr
 *
 * Tracks user consent for various data processing activities.
 * All consent changes are logged for audit purposes.
 */

import { prisma } from '../database/index.js';
import type {
  UserConsent,
  ConsentType,
  ConsentInput,
  ConsentUpdateBatch,
  CONSENT_POLICY_VERSION,
} from '../types/gdpr.types.js';

export class ConsentService {
  constructor() {
    console.log('[ConsentService] Initialized');
  }

  /**
   * Grant consent for a specific type
   */
  async grantConsent(
    userId: string,
    consentType: ConsentType,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserConsent> {
    const consent = await prisma.userConsent.upsert({
      where: {
        userId_consentType: { userId, consentType },
      },
      create: {
        userId,
        consentType,
        granted: true,
        grantedAt: new Date(),
        version: '1.0.0',
        ipAddress,
        userAgent,
      },
      update: {
        granted: true,
        grantedAt: new Date(),
        revokedAt: null,
        version: '1.0.0',
        ipAddress,
        userAgent,
      },
    });

    console.log(`[ConsentService] User ${userId} granted consent for ${consentType}`);

    return this.mapToUserConsent(consent);
  }

  /**
   * Revoke consent for a specific type
   */
  async revokeConsent(userId: string, consentType: ConsentType): Promise<UserConsent> {
    const consent = await prisma.userConsent.update({
      where: {
        userId_consentType: { userId, consentType },
      },
      data: {
        granted: false,
        revokedAt: new Date(),
      },
    });

    console.log(`[ConsentService] User ${userId} revoked consent for ${consentType}`);

    return this.mapToUserConsent(consent);
  }

  /**
   * Update consent (grant or revoke)
   */
  async updateConsent(
    userId: string,
    consentType: ConsentType,
    granted: boolean,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserConsent> {
    if (granted) {
      return this.grantConsent(userId, consentType, ipAddress, userAgent);
    } else {
      return this.revokeConsent(userId, consentType);
    }
  }

  /**
   * Update multiple consents at once
   */
  async updateMultipleConsents(
    userId: string,
    batch: ConsentUpdateBatch,
  ): Promise<UserConsent[]> {
    const results: UserConsent[] = [];

    for (const consent of batch.consents) {
      const updated = await this.updateConsent(
        userId,
        consent.consentType,
        consent.granted,
        batch.ipAddress,
        batch.userAgent,
      );
      results.push(updated);
    }

    return results;
  }

  /**
   * Get all consents for a user
   */
  async getUserConsents(userId: string): Promise<UserConsent[]> {
    const consents = await prisma.userConsent.findMany({
      where: { userId },
      orderBy: { consentType: 'asc' },
    });

    return consents.map(this.mapToUserConsent);
  }

  /**
   * Check if user has granted a specific consent
   */
  async hasConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    const consent = await prisma.userConsent.findUnique({
      where: {
        userId_consentType: { userId, consentType },
      },
    });

    return consent?.granted ?? false;
  }

  /**
   * Get consent by type for a user
   */
  async getConsent(userId: string, consentType: ConsentType): Promise<UserConsent | null> {
    const consent = await prisma.userConsent.findUnique({
      where: {
        userId_consentType: { userId, consentType },
      },
    });

    return consent ? this.mapToUserConsent(consent) : null;
  }

  /**
   * Revoke all consents for a user (used during account deletion)
   */
  async revokeAllConsents(userId: string): Promise<number> {
    const result = await prisma.userConsent.updateMany({
      where: { userId, granted: true },
      data: {
        granted: false,
        revokedAt: new Date(),
      },
    });

    console.log(`[ConsentService] Revoked all consents for user ${userId}`);

    return result.count;
  }

  /**
   * Initialize default consents for a new user (all false by default)
   */
  async initializeDefaults(userId: string): Promise<UserConsent[]> {
    const consentTypes: ConsentType[] = [
      'marketing',
      'analytics',
      'ai_processing',
      'data_sharing',
      'third_party',
    ];

    const consents: UserConsent[] = [];

    for (const consentType of consentTypes) {
      const existing = await prisma.userConsent.findUnique({
        where: { userId_consentType: { userId, consentType } },
      });

      if (!existing) {
        const consent = await prisma.userConsent.create({
          data: {
            userId,
            consentType,
            granted: false,
            version: '1.0.0',
          },
        });
        consents.push(this.mapToUserConsent(consent));
      }
    }

    return consents;
  }

  /**
   * Get consent metrics (admin)
   */
  async getConsentMetrics(): Promise<{
    totalUsers: number;
    consentsByType: Record<string, { granted: number; revoked: number }>;
  }> {
    const [totalUsers, consentStats] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.userConsent.groupBy({
        by: ['consentType', 'granted'],
        _count: true,
      }),
    ]);

    const consentsByType: Record<string, { granted: number; revoked: number }> = {};

    for (const stat of consentStats) {
      if (!consentsByType[stat.consentType]) {
        consentsByType[stat.consentType] = { granted: 0, revoked: 0 };
      }
      if (stat.granted) {
        consentsByType[stat.consentType].granted = stat._count;
      } else {
        consentsByType[stat.consentType].revoked = stat._count;
      }
    }

    return { totalUsers, consentsByType };
  }

  private mapToUserConsent(consent: {
    id: string;
    userId: string;
    consentType: string;
    granted: boolean;
    grantedAt: Date | null;
    revokedAt: Date | null;
    version: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserConsent {
    return {
      id: consent.id,
      userId: consent.userId,
      consentType: consent.consentType as ConsentType,
      granted: consent.granted,
      grantedAt: consent.grantedAt,
      revokedAt: consent.revokedAt,
      version: consent.version,
      ipAddress: consent.ipAddress,
      userAgent: consent.userAgent,
      createdAt: consent.createdAt,
      updatedAt: consent.updatedAt,
    };
  }
}

// Export singleton instance
export const consentService = new ConsentService();

/**
 * @file RetentionPolicyService.ts
 * @description Service for managing compliance log retention policies
 * @feature compliance
 *
 * Implements configurable retention policies per event type:
 * - EU AI Act Article 12 requires 10 years for AI decisions
 * - Safety records require 5 years
 * - Operational records require 1 year
 */

import { prisma } from '../database/index.js';
import type {
  RetentionPolicy,
  RetentionPolicyInput,
} from '../types/retention.types.js';
import { DEFAULT_RETENTION_DAYS } from '../types/retention.types.js';
import type { ComplianceEventType } from '../types/compliance.types.js';

export class RetentionPolicyService {
  constructor() {
    console.log('[RetentionPolicyService] Initialized');
  }

  /**
   * Get retention policy for an event type
   * Returns default if no custom policy exists
   */
  async getPolicy(eventType: ComplianceEventType): Promise<RetentionPolicy> {
    const policy = await prisma.retentionPolicy.findUnique({
      where: { eventType },
    });

    if (policy) {
      return {
        id: policy.id,
        eventType: policy.eventType as ComplianceEventType,
        retentionDays: policy.retentionDays,
        description: policy.description,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      };
    }

    // Return default policy
    const defaultDays = DEFAULT_RETENTION_DAYS[eventType];
    return {
      id: `default-${eventType}`,
      eventType,
      retentionDays: defaultDays,
      description: `Default retention policy for ${eventType}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Set or update a retention policy
   */
  async setPolicy(input: RetentionPolicyInput): Promise<RetentionPolicy> {
    const policy = await prisma.retentionPolicy.upsert({
      where: { eventType: input.eventType },
      create: {
        eventType: input.eventType,
        retentionDays: input.retentionDays,
        description: input.description,
      },
      update: {
        retentionDays: input.retentionDays,
        description: input.description,
      },
    });

    console.log(
      `[RetentionPolicyService] Set policy for ${input.eventType}: ${input.retentionDays} days`,
    );

    return {
      id: policy.id,
      eventType: policy.eventType as ComplianceEventType,
      retentionDays: policy.retentionDays,
      description: policy.description,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }

  /**
   * Get all retention policies (including defaults for unconfigured types)
   */
  async getAllPolicies(): Promise<RetentionPolicy[]> {
    const customPolicies = await prisma.retentionPolicy.findMany();
    const customPolicyMap = new Map(customPolicies.map((p) => [p.eventType, p]));

    const allEventTypes: ComplianceEventType[] = [
      'ai_decision',
      'safety_action',
      'command_execution',
      'system_event',
      'access_audit',
    ];

    return allEventTypes.map((eventType) => {
      const custom = customPolicyMap.get(eventType);
      if (custom) {
        return {
          id: custom.id,
          eventType: custom.eventType as ComplianceEventType,
          retentionDays: custom.retentionDays,
          description: custom.description,
          createdAt: custom.createdAt,
          updatedAt: custom.updatedAt,
        };
      }
      return {
        id: `default-${eventType}`,
        eventType,
        retentionDays: DEFAULT_RETENTION_DAYS[eventType],
        description: `Default retention policy for ${eventType}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  }

  /**
   * Calculate expiration date for a new log based on event type
   */
  async calculateExpirationDate(eventType: ComplianceEventType): Promise<Date> {
    const policy = await this.getPolicy(eventType);
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + policy.retentionDays);
    return expirationDate;
  }

  /**
   * Delete a custom policy (reverts to default)
   */
  async deletePolicy(eventType: ComplianceEventType): Promise<boolean> {
    try {
      await prisma.retentionPolicy.delete({
        where: { eventType },
      });
      console.log(`[RetentionPolicyService] Deleted custom policy for ${eventType}`);
      return true;
    } catch {
      return false; // Policy didn't exist
    }
  }

  /**
   * Initialize default policies in database (for first run)
   */
  async initializeDefaults(): Promise<void> {
    const eventTypes: ComplianceEventType[] = [
      'ai_decision',
      'safety_action',
      'command_execution',
      'system_event',
      'access_audit',
    ];

    for (const eventType of eventTypes) {
      const existing = await prisma.retentionPolicy.findUnique({
        where: { eventType },
      });

      if (!existing) {
        await prisma.retentionPolicy.create({
          data: {
            eventType,
            retentionDays: DEFAULT_RETENTION_DAYS[eventType],
            description: `Default retention policy for ${eventType} events`,
          },
        });
      }
    }

    console.log('[RetentionPolicyService] Default policies initialized');
  }
}

// Export singleton instance
export const retentionPolicyService = new RetentionPolicyService();

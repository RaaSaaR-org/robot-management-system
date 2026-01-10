/**
 * @file RopaService.ts
 * @description Service for managing Records of Processing Activities (RoPA)
 * @feature compliance
 *
 * GDPR Article 30 requires maintaining records of processing activities.
 * This service manages RoPA entries for regulatory compliance.
 */

import { prisma } from '../database/index.js';
import type { RopaEntry, RopaEntryInput, RopaReport } from '../types/retention.types.js';

export class RopaService {
  constructor() {
    console.log('[RopaService] Initialized');
  }

  /**
   * Create a new RoPA entry
   */
  async createEntry(input: RopaEntryInput): Promise<RopaEntry> {
    const entry = await prisma.ropaEntry.create({
      data: {
        processingActivity: input.processingActivity,
        purpose: input.purpose,
        dataCategories: input.dataCategories,
        dataSubjects: input.dataSubjects,
        recipients: input.recipients,
        thirdCountryTransfers: input.thirdCountryTransfers,
        retentionPeriod: input.retentionPeriod,
        securityMeasures: input.securityMeasures,
        legalBasis: input.legalBasis,
      },
    });

    console.log(`[RopaService] Created RoPA entry: ${entry.processingActivity}`);

    return {
      id: entry.id,
      processingActivity: entry.processingActivity,
      purpose: entry.purpose,
      dataCategories: entry.dataCategories,
      dataSubjects: entry.dataSubjects,
      recipients: entry.recipients,
      thirdCountryTransfers: entry.thirdCountryTransfers,
      retentionPeriod: entry.retentionPeriod,
      securityMeasures: entry.securityMeasures,
      legalBasis: entry.legalBasis,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * Update an existing RoPA entry
   */
  async updateEntry(id: string, input: Partial<RopaEntryInput>): Promise<RopaEntry | null> {
    try {
      const entry = await prisma.ropaEntry.update({
        where: { id },
        data: {
          ...(input.processingActivity && { processingActivity: input.processingActivity }),
          ...(input.purpose && { purpose: input.purpose }),
          ...(input.dataCategories && { dataCategories: input.dataCategories }),
          ...(input.dataSubjects && { dataSubjects: input.dataSubjects }),
          ...(input.recipients && { recipients: input.recipients }),
          ...(input.thirdCountryTransfers !== undefined && {
            thirdCountryTransfers: input.thirdCountryTransfers,
          }),
          ...(input.retentionPeriod && { retentionPeriod: input.retentionPeriod }),
          ...(input.securityMeasures && { securityMeasures: input.securityMeasures }),
          ...(input.legalBasis && { legalBasis: input.legalBasis }),
        },
      });

      console.log(`[RopaService] Updated RoPA entry: ${entry.processingActivity}`);

      return {
        id: entry.id,
        processingActivity: entry.processingActivity,
        purpose: entry.purpose,
        dataCategories: entry.dataCategories,
        dataSubjects: entry.dataSubjects,
        recipients: entry.recipients,
        thirdCountryTransfers: entry.thirdCountryTransfers,
        retentionPeriod: entry.retentionPeriod,
        securityMeasures: entry.securityMeasures,
        legalBasis: entry.legalBasis,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get all RoPA entries
   */
  async getAllEntries(): Promise<RopaEntry[]> {
    const entries = await prisma.ropaEntry.findMany({
      orderBy: { processingActivity: 'asc' },
    });

    return entries.map((entry) => ({
      id: entry.id,
      processingActivity: entry.processingActivity,
      purpose: entry.purpose,
      dataCategories: entry.dataCategories,
      dataSubjects: entry.dataSubjects,
      recipients: entry.recipients,
      thirdCountryTransfers: entry.thirdCountryTransfers,
      retentionPeriod: entry.retentionPeriod,
      securityMeasures: entry.securityMeasures,
      legalBasis: entry.legalBasis,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  /**
   * Get a single RoPA entry by ID
   */
  async getEntry(id: string): Promise<RopaEntry | null> {
    const entry = await prisma.ropaEntry.findUnique({
      where: { id },
    });

    if (!entry) return null;

    return {
      id: entry.id,
      processingActivity: entry.processingActivity,
      purpose: entry.purpose,
      dataCategories: entry.dataCategories,
      dataSubjects: entry.dataSubjects,
      recipients: entry.recipients,
      thirdCountryTransfers: entry.thirdCountryTransfers,
      retentionPeriod: entry.retentionPeriod,
      securityMeasures: entry.securityMeasures,
      legalBasis: entry.legalBasis,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * Delete a RoPA entry
   */
  async deleteEntry(id: string): Promise<boolean> {
    try {
      await prisma.ropaEntry.delete({
        where: { id },
      });
      console.log(`[RopaService] Deleted RoPA entry: ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate RoPA report for regulatory submission
   */
  async generateReport(organizationName: string = 'RoboMindOS'): Promise<RopaReport> {
    const entries = await this.getAllEntries();

    return {
      generatedAt: new Date().toISOString(),
      organizationName,
      entries,
      totalProcessingActivities: entries.length,
    };
  }

  /**
   * Initialize default RoPA entries for robot management system
   */
  async initializeDefaults(): Promise<void> {
    const existingCount = await prisma.ropaEntry.count();
    if (existingCount > 0) {
      console.log('[RopaService] RoPA entries already exist, skipping initialization');
      return;
    }

    const defaultEntries: RopaEntryInput[] = [
      {
        processingActivity: 'AI Command Interpretation',
        purpose:
          'Process natural language commands to control robots using AI models',
        dataCategories: [
          'Command text',
          'Robot state data',
          'User identifiers',
          'AI model outputs',
        ],
        dataSubjects: ['Robot operators', 'System administrators'],
        recipients: ['AI model provider (Google Gemini)', 'Internal systems'],
        thirdCountryTransfers: 'Data may be processed in US by Google Cloud',
        retentionPeriod: '10 years per EU AI Act Article 12',
        securityMeasures: [
          'AES-256-GCM encryption at rest',
          'TLS 1.3 in transit',
          'Hash chain tamper detection',
          'Access logging',
        ],
        legalBasis: 'legitimate_interests',
      },
      {
        processingActivity: 'Safety Monitoring',
        purpose:
          'Monitor robot operations for safety compliance and emergency response',
        dataCategories: [
          'Robot telemetry',
          'Safety events',
          'Emergency stop triggers',
          'Proximity sensor data',
        ],
        dataSubjects: ['Robot operators', 'Bystanders in robot operating areas'],
        recipients: ['Internal safety systems', 'Audit systems'],
        retentionPeriod: '5 years for safety-critical records',
        securityMeasures: [
          'Real-time monitoring',
          'Encrypted storage',
          'Tamper-evident logging',
          'Access controls',
        ],
        legalBasis: 'legal_obligation',
      },
      {
        processingActivity: 'Compliance Audit Trail',
        purpose:
          'Maintain tamper-evident records for regulatory compliance and audits',
        dataCategories: [
          'System events',
          'User actions',
          'AI decisions',
          'Access logs',
        ],
        dataSubjects: ['System users', 'Robot operators', 'Administrators'],
        recipients: ['Internal compliance team', 'External auditors'],
        retentionPeriod: 'Varies by event type (6 months to 10 years)',
        securityMeasures: [
          'Cryptographic hash chains',
          'Encrypted payloads',
          'Immutable storage',
          'Legal hold support',
        ],
        legalBasis: 'legal_obligation',
      },
    ];

    for (const entry of defaultEntries) {
      await this.createEntry(entry);
    }

    console.log('[RopaService] Default RoPA entries initialized');
  }
}

// Export singleton instance
export const ropaService = new RopaService();

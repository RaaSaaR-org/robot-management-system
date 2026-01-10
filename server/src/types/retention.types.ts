/**
 * @file retention.types.ts
 * @description Type definitions for retention policies, legal holds, export, and RoPA
 * @feature compliance
 *
 * Implements types for GDPR Article 30 compliance:
 * - Retention policies with automatic cleanup
 * - Legal holds to prevent deletion during investigations
 * - Log export capabilities
 * - Records of Processing Activities (RoPA)
 * - AI Provider documentation tracking
 */

import type { ComplianceEventType, ComplianceLog } from './compliance.types';

// ============================================================================
// RETENTION POLICY TYPES
// ============================================================================

/**
 * Retention policy for compliance logs
 */
export interface RetentionPolicy {
  id: string;
  eventType: ComplianceEventType;
  retentionDays: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating a retention policy
 */
export interface RetentionPolicyInput {
  eventType: ComplianceEventType;
  retentionDays: number;
  description?: string;
}

/**
 * Default retention periods (in days) per EU AI Act requirements
 */
export const DEFAULT_RETENTION_DAYS: Record<ComplianceEventType, number> = {
  ai_decision: 3650, // 10 years - EU AI Act Art. 12
  safety_action: 1825, // 5 years - Safety-critical records
  command_execution: 365, // 1 year - Operational records
  system_event: 180, // 6 months - System diagnostics
  access_audit: 1825, // 5 years - Security compliance
};

// ============================================================================
// LEGAL HOLD TYPES
// ============================================================================

/**
 * Legal hold preventing deletion of logs
 */
export interface LegalHold {
  id: string;
  name: string;
  reason: string;
  createdBy: string;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  logIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a legal hold
 */
export interface LegalHoldInput {
  name: string;
  reason: string;
  createdBy: string;
  logIds: string[];
  endDate?: Date;
}

/**
 * Input for adding logs to an existing legal hold
 */
export interface AddLogsToHoldInput {
  holdId: string;
  logIds: string[];
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

/**
 * Options for exporting compliance logs
 */
export interface ExportOptions {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: ComplianceEventType[];
  robotIds?: string[];
  sessionIds?: string[];
  includeDecrypted?: boolean;
}

/**
 * Exported log entry (may include decrypted payload)
 */
export interface ExportedLog {
  id: string;
  sessionId: string;
  robotId: string;
  operatorId: string | null;
  eventType: string;
  severity: string;
  payload?: Record<string, unknown>; // Decrypted if includeDecrypted=true
  payloadHash: string;
  modelVersion: string | null;
  inputHash: string | null;
  outputHash: string | null;
  previousHash: string;
  currentHash: string;
  decisionId: string | null;
  timestamp: string; // ISO 8601
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  exportId: string;
  filename: string;
  recordCount: number;
  exportedAt: string; // ISO 8601
  exportedBy: string | null;
  options: ExportOptions;
  data: ExportedLog[];
}

// ============================================================================
// ROPA TYPES (Records of Processing Activities - GDPR Art. 30)
// ============================================================================

/**
 * GDPR legal bases for data processing
 */
export const LegalBases = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
] as const;

export type LegalBasis = (typeof LegalBases)[number];

/**
 * Record of Processing Activity (RoPA) entry
 */
export interface RopaEntry {
  id: string;
  processingActivity: string;
  purpose: string;
  dataCategories: string[];
  dataSubjects: string[];
  recipients: string[];
  thirdCountryTransfers: string | null;
  retentionPeriod: string;
  securityMeasures: string[];
  legalBasis: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating a RoPA entry
 */
export interface RopaEntryInput {
  processingActivity: string;
  purpose: string;
  dataCategories: string[];
  dataSubjects: string[];
  recipients: string[];
  thirdCountryTransfers?: string;
  retentionPeriod: string;
  securityMeasures: string[];
  legalBasis: string;
}

/**
 * RoPA report for regulatory submission
 */
export interface RopaReport {
  generatedAt: string; // ISO 8601
  organizationName: string;
  entries: RopaEntry[];
  totalProcessingActivities: number;
}

// ============================================================================
// PROVIDER DOCUMENTATION TYPES
// ============================================================================

/**
 * Document types for AI provider documentation
 */
export const DocumentTypes = [
  'technical_doc',
  'risk_assessment',
  'conformity_declaration',
  'user_manual',
  'training_data_description',
  'model_card',
] as const;

export type DocumentType = (typeof DocumentTypes)[number];

/**
 * AI Provider documentation entry
 */
export interface ProviderDocumentation {
  id: string;
  providerName: string;
  modelVersion: string;
  documentType: string;
  documentUrl: string | null;
  content: string;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating provider documentation
 */
export interface ProviderDocInput {
  providerName: string;
  modelVersion: string;
  documentType: DocumentType;
  documentUrl?: string;
  content: string;
  validFrom: Date;
  validTo?: Date;
}

/**
 * Summary of a provider's documentation
 */
export interface ProviderSummary {
  providerName: string;
  modelVersions: string[];
  documentCount: number;
  lastUpdated: Date;
}

// ============================================================================
// CLEANUP TYPES
// ============================================================================

/**
 * Result of a retention cleanup operation
 */
export interface CleanupResult {
  startedAt: Date;
  completedAt: Date;
  logsScanned: number;
  logsDeleted: number;
  logsSkipped: number; // Logs under legal hold
  errors: Array<{
    logId: string;
    error: string;
  }>;
}

/**
 * Statistics about logs approaching retention expiry
 */
export interface RetentionStats {
  totalLogs: number;
  expiringWithin30Days: number;
  expiringWithin90Days: number;
  underLegalHold: number;
  byEventType: Record<
    ComplianceEventType,
    {
      total: number;
      expiringSoon: number;
    }
  >;
}

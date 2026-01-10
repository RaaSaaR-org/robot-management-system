/**
 * @file compliance.types.ts
 * @description Type definitions for compliance logging feature
 * @feature compliance
 */

// Event types
export type ComplianceEventType =
  | 'ai_decision'
  | 'safety_action'
  | 'command_execution'
  | 'system_event'
  | 'access_audit';

export type ComplianceSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

// Payload types
export interface BasePayload {
  description: string;
  metadata?: Record<string, unknown>;
}

export interface AIDecisionPayload extends BasePayload {
  inputText?: string;
  inputContext?: Record<string, unknown>;
  outputText?: string;
  outputAction?: string;
  confidence?: number;
  reasoning?: string[];
  alternatives?: Array<{ action: string; reason: string }>;
  safetyClassification?: 'safe' | 'caution' | 'dangerous';
}

export interface SafetyActionPayload extends BasePayload {
  actionType: string;
  triggerReason: string;
  robotState?: {
    location?: { x: number; y: number; z: number };
    speed?: number;
    force?: number;
    operatingMode?: string;
  };
  affectedRobots?: string[];
  resolutionRequired?: boolean;
}

export interface CommandExecutionPayload extends BasePayload {
  commandType: string;
  parameters?: Record<string, unknown>;
  executionStatus: 'success' | 'failure' | 'partial';
  errorMessage?: string;
  durationMs?: number;
}

export interface SystemEventPayload extends BasePayload {
  eventName: string;
  component?: string;
  version?: string;
  configuration?: Record<string, unknown>;
}

export type CompliancePayload =
  | AIDecisionPayload
  | SafetyActionPayload
  | CommandExecutionPayload
  | SystemEventPayload;

// Compliance log entity
export interface ComplianceLog {
  id: string;
  sessionId: string;
  robotId: string;
  operatorId: string | null;
  eventType: ComplianceEventType;
  severity: ComplianceSeverity;
  payload: CompliancePayload;
  modelVersion: string | null;
  modelHash: string | null;
  inputHash: string | null;
  outputHash: string | null;
  previousHash: string;
  currentHash: string;
  decisionId: string | null;
  timestamp: string;
  immutable: boolean;
}

// Paginated response
export interface ComplianceLogListResponse {
  logs: ComplianceLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Hash chain verification
export interface HashChainVerificationResult {
  isValid: boolean;
  totalLogs: number;
  verifiedLogs: number;
  firstLogTimestamp?: string;
  lastLogTimestamp?: string;
  brokenLinks: Array<{
    logId: string;
    expectedHash: string;
    actualPreviousHash: string;
    timestamp: string;
  }>;
  verifiedAt: string;
}

// Event type metrics
export interface EventTypeMetrics {
  eventType: ComplianceEventType;
  count: number;
  lastOccurrence: string | null;
}

// Metrics summary
export interface ComplianceMetricsSummary {
  totalLogs: number;
  eventTypeCounts: EventTypeMetrics[];
  severityCounts: Record<ComplianceSeverity, number>;
  uniqueSessions: number;
  uniqueRobots: number;
  dateRange: {
    start: string | null;
    end: string | null;
  };
}

// Session
export interface ComplianceSession {
  sessionId: string;
  robotId: string;
  startedAt: string;
  endedAt?: string;
  logCount: number;
}

// Query parameters
export interface ComplianceLogQueryParams {
  page?: number;
  limit?: number;
  sessionId?: string;
  robotId?: string;
  eventType?: ComplianceEventType;
  severity?: ComplianceSeverity;
  startDate?: string;
  endDate?: string;
  decisionId?: string;
  sortBy?: 'timestamp' | 'severity' | 'eventType';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// RETENTION POLICY TYPES
// ============================================================================

export interface RetentionPolicy {
  id: string;
  eventType: ComplianceEventType;
  retentionDays: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionPolicyInput {
  eventType: ComplianceEventType;
  retentionDays: number;
  description?: string;
}

// ============================================================================
// LEGAL HOLD TYPES
// ============================================================================

export interface LegalHold {
  id: string;
  name: string;
  reason: string;
  createdBy: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  logIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LegalHoldInput {
  name: string;
  reason: string;
  createdBy: string;
  logIds: string[];
  endDate?: string;
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

export interface ExportOptions {
  startDate?: string;
  endDate?: string;
  eventTypes?: ComplianceEventType[];
  robotIds?: string[];
  sessionIds?: string[];
  includeDecrypted?: boolean;
}

export interface ExportedLog {
  id: string;
  sessionId: string;
  robotId: string;
  operatorId: string | null;
  eventType: string;
  severity: string;
  payload?: Record<string, unknown>;
  payloadHash: string;
  modelVersion: string | null;
  inputHash: string | null;
  outputHash: string | null;
  previousHash: string;
  currentHash: string;
  decisionId: string | null;
  timestamp: string;
}

export interface ExportResult {
  exportId: string;
  filename: string;
  recordCount: number;
  exportedAt: string;
  exportedBy: string | null;
  options: ExportOptions;
  data: ExportedLog[];
}

// ============================================================================
// ROPA TYPES (Records of Processing Activities - GDPR Art. 30)
// ============================================================================

export type LegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interests';

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
  createdAt: string;
  updatedAt: string;
}

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

export interface RopaReport {
  generatedAt: string;
  organizationName: string;
  entries: RopaEntry[];
  totalProcessingActivities: number;
}

// ============================================================================
// PROVIDER DOCUMENTATION TYPES
// ============================================================================

export type DocumentType =
  | 'technical_doc'
  | 'risk_assessment'
  | 'conformity_declaration'
  | 'user_manual'
  | 'training_data_description'
  | 'model_card';

export interface ProviderDocumentation {
  id: string;
  providerName: string;
  modelVersion: string;
  documentType: string;
  documentUrl: string | null;
  content: string;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderSummary {
  providerName: string;
  modelVersions: string[];
  documentCount: number;
  lastUpdated: string;
}

// ============================================================================
// RETENTION STATS TYPES
// ============================================================================

export interface RetentionStats {
  totalLogs: number;
  expiringWithin30Days: number;
  expiringWithin90Days: number;
  underLegalHold: number;
  withoutExpiry: number;
}

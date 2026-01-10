/**
 * @file compliance.types.ts
 * @description Type definitions for compliance logging infrastructure
 * @feature compliance
 *
 * Implements structured logging types for regulatory compliance:
 * - EU AI Act Article 12 (Record-keeping)
 * - GDPR Article 30 (Records of processing activities)
 * - Machinery Regulation Annex III
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const ComplianceEventTypes = [
  'ai_decision',
  'safety_action',
  'command_execution',
  'system_event',
  'access_audit',
] as const;

export type ComplianceEventType = (typeof ComplianceEventTypes)[number];

export const ComplianceSeverities = [
  'debug',
  'info',
  'warning',
  'error',
  'critical',
] as const;

export type ComplianceSeverity = (typeof ComplianceSeverities)[number];

export const AccessTypes = ['view', 'export', 'verify', 'audit'] as const;

export type AccessType = (typeof AccessTypes)[number];

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

/**
 * Base interface for all compliance log payloads
 */
export interface BaseCompliancePayload {
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * Payload for AI decision events
 */
export interface AIDecisionPayload extends BaseCompliancePayload {
  inputText?: string;
  inputContext?: Record<string, unknown>;
  outputText?: string;
  outputAction?: string;
  confidence?: number;
  reasoning?: string[];
  alternatives?: Array<{
    action: string;
    reason: string;
  }>;
  safetyClassification?: 'safe' | 'caution' | 'dangerous';
}

/**
 * Payload for safety action events
 */
export interface SafetyActionPayload extends BaseCompliancePayload {
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

/**
 * Payload for command execution events
 */
export interface CommandExecutionPayload extends BaseCompliancePayload {
  commandType: string;
  parameters?: Record<string, unknown>;
  executionStatus: 'success' | 'failure' | 'partial';
  errorMessage?: string;
  durationMs?: number;
}

/**
 * Payload for system events
 */
export interface SystemEventPayload extends BaseCompliancePayload {
  eventName: string;
  component?: string;
  version?: string;
  configuration?: Record<string, unknown>;
}

/**
 * Payload for access audit events
 */
export interface AccessAuditPayload extends BaseCompliancePayload {
  resourceType: string;
  resourceId: string;
  action: string;
  result: 'allowed' | 'denied';
}

export type CompliancePayload =
  | AIDecisionPayload
  | SafetyActionPayload
  | CommandExecutionPayload
  | SystemEventPayload
  | AccessAuditPayload;

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating a compliance log entry
 */
export interface CreateComplianceLogInput {
  sessionId: string;
  robotId: string;
  operatorId?: string;
  eventType: ComplianceEventType;
  severity?: ComplianceSeverity;
  payload: CompliancePayload;
  modelVersion?: string;
  modelHash?: string;
  inputHash?: string;
  outputHash?: string;
  decisionId?: string;
}

/**
 * Input for recording log access
 */
export interface CreateLogAccessInput {
  logId: string;
  userId?: string;
  accessType: AccessType;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================================================
// DOMAIN TYPES
// ============================================================================

/**
 * Compliance log entry with decrypted payload
 */
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
  timestamp: Date;
  immutable: boolean;
}

/**
 * Compliance log as stored in database (encrypted)
 */
export interface ComplianceLogEncrypted {
  id: string;
  sessionId: string;
  robotId: string;
  operatorId: string | null;
  eventType: string;
  severity: string;
  payloadEncrypted: string;
  payloadIv: string;
  payloadHash: string;
  modelVersion: string | null;
  modelHash: string | null;
  inputHash: string | null;
  outputHash: string | null;
  previousHash: string;
  currentHash: string;
  decisionId: string | null;
  timestamp: Date;
  immutable: boolean;
}

/**
 * Log access record
 */
export interface ComplianceLogAccess {
  id: string;
  logId: string;
  userId: string | null;
  accessType: AccessType;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing compliance logs
 */
export interface ComplianceLogQueryParams {
  page?: number;
  limit?: number;
  sessionId?: string;
  robotId?: string;
  operatorId?: string;
  eventType?: ComplianceEventType;
  severity?: ComplianceSeverity;
  startDate?: Date;
  endDate?: Date;
  decisionId?: string;
  sortBy?: 'timestamp' | 'severity' | 'eventType';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response for compliance logs
 */
export interface ComplianceLogListResponse {
  logs: ComplianceLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================================
// VERIFICATION TYPES
// ============================================================================

/**
 * Result of hash chain verification
 */
export interface HashChainVerificationResult {
  isValid: boolean;
  totalLogs: number;
  verifiedLogs: number;
  firstLogTimestamp?: Date;
  lastLogTimestamp?: Date;
  brokenLinks: Array<{
    logId: string;
    expectedHash: string;
    actualPreviousHash: string;
    timestamp: Date;
  }>;
  verifiedAt: Date;
}

/**
 * Event type count metrics
 */
export interface EventTypeMetrics {
  eventType: ComplianceEventType;
  count: number;
  lastOccurrence: Date | null;
}

/**
 * Compliance metrics summary
 */
export interface ComplianceMetricsSummary {
  totalLogs: number;
  eventTypeCounts: EventTypeMetrics[];
  severityCounts: Record<ComplianceSeverity, number>;
  uniqueSessions: number;
  uniqueRobots: number;
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
}

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Compliance logging session
 */
export interface ComplianceSession {
  sessionId: string;
  robotId: string;
  startedAt: Date;
  endedAt?: Date;
  logCount: number;
}

/**
 * Session start response
 */
export interface SessionStartResponse {
  sessionId: string;
  robotId: string;
  startedAt: Date;
}

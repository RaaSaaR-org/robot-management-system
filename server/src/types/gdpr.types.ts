/**
 * @file gdpr.types.ts
 * @description Type definitions for GDPR Rights Self-Service Portal
 * @feature gdpr
 *
 * Implements types for GDPR Articles 15-22:
 * - Art. 15: Right of Access
 * - Art. 16: Right to Rectification
 * - Art. 17: Right to Erasure
 * - Art. 18: Right to Restriction
 * - Art. 20: Right to Portability
 * - Art. 21: Right to Object
 * - Art. 22: Automated Decision Making Safeguards
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/**
 * GDPR request types corresponding to GDPR articles
 */
export const GDPRRequestTypes = [
  'access', // Art. 15
  'rectification', // Art. 16
  'erasure', // Art. 17
  'restriction', // Art. 18
  'portability', // Art. 20
  'objection', // Art. 21
  'adm_review', // Art. 22
] as const;

export type GDPRRequestType = (typeof GDPRRequestTypes)[number];

/**
 * Status of a GDPR request
 */
export const GDPRRequestStatuses = [
  'pending', // Awaiting processing
  'acknowledged', // Received, within 72h for ADM
  'in_progress', // Being processed
  'awaiting_verification', // Needs user verification
  'completed', // Successfully processed
  'rejected', // Denied with reason
  'cancelled', // Cancelled by user
] as const;

export type GDPRRequestStatus = (typeof GDPRRequestStatuses)[number];

/**
 * Consent types for user data processing
 */
export const ConsentTypes = [
  'marketing', // Marketing communications
  'analytics', // Usage analytics
  'ai_processing', // AI/ML processing of data
  'data_sharing', // Sharing with partners
  'third_party', // Third-party integrations
] as const;

export type ConsentType = (typeof ConsentTypes)[number];

/**
 * Data restriction scopes
 */
export const RestrictionScopes = [
  'all', // All processing
  'ai_processing', // AI/ML processing only
  'sharing', // Data sharing only
  'marketing', // Marketing only
] as const;

export type RestrictionScope = (typeof RestrictionScopes)[number];

/**
 * Reasons for data restriction (Art. 18)
 */
export const RestrictionReasons = [
  'accuracy_disputed', // User disputes accuracy
  'unlawful_processing', // Processing is unlawful
  'no_longer_needed', // Controller no longer needs data
  'objection_pending', // Objection is being verified
] as const;

export type RestrictionReason = (typeof RestrictionReasons)[number];

/**
 * ADM Review statuses
 */
export const ADMReviewStatuses = [
  'queued', // Awaiting assignment
  'assigned', // Assigned to admin
  'under_review', // Being reviewed
  'decision_overturned', // Original decision changed
  'decision_upheld', // Original decision confirmed
] as const;

export type ADMReviewStatus = (typeof ADMReviewStatuses)[number];

/**
 * ADM Review priorities
 */
export const ADMReviewPriorities = ['low', 'normal', 'high', 'urgent'] as const;

export type ADMReviewPriority = (typeof ADMReviewPriorities)[number];

// ============================================================================
// GDPR REQUEST TYPES
// ============================================================================

/**
 * GDPR Request entity
 */
export interface GDPRRequest {
  id: string;
  userId: string;
  requestType: GDPRRequestType;
  status: GDPRRequestStatus;

  // SLA tracking
  submittedAt: Date;
  acknowledgedAt: Date | null;
  slaDeadline: Date;
  completedAt: Date | null;

  // Request details
  requestData: Record<string, unknown>;
  responseData: Record<string, unknown> | null;

  // Verification
  verificationToken: string | null;
  verificationExpires: Date | null;
  verifiedAt: Date | null;

  // Processing
  assignedTo: string | null;
  internalNotes: string | null;
  rejectionReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a GDPR request
 */
export interface CreateGDPRRequestInput {
  userId: string;
  requestType: GDPRRequestType;
  requestData?: Record<string, unknown>;
}

/**
 * Input for specific request types
 */
export interface AccessRequestInput {
  format?: 'json' | 'csv';
  includeMetadata?: boolean;
}

export interface RectificationRequestInput {
  fields: Array<{
    field: string;
    currentValue: unknown;
    newValue: unknown;
    reason: string;
  }>;
}

export interface ErasureRequestInput {
  reason?: string;
  scope?: 'all' | 'specific';
  specificData?: string[];
}

export interface RestrictionRequestInput {
  scope: RestrictionScope;
  reason: RestrictionReason;
  details?: string;
}

export interface PortabilityRequestInput {
  format: 'json' | 'csv';
  dataCategories?: string[];
}

export interface ObjectionRequestInput {
  processingActivity: string;
  reason: string;
  details?: string;
}

export interface ADMReviewRequestInput {
  decisionId: string;
  contestReason: string;
  evidence?: string;
}

/**
 * Status history entry
 */
export interface GDPRRequestStatusHistory {
  id: string;
  requestId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  reason: string | null;
  timestamp: Date;
}

/**
 * List response with pagination
 */
export interface GDPRRequestListResponse {
  requests: GDPRRequest[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Query filters for requests
 */
export interface GDPRRequestFilters {
  status?: GDPRRequestStatus | GDPRRequestStatus[];
  requestType?: GDPRRequestType | GDPRRequestType[];
  userId?: string;
  assignedTo?: string;
  fromDate?: Date;
  toDate?: Date;
  overdue?: boolean;
}

// ============================================================================
// CONSENT TYPES
// ============================================================================

/**
 * User consent entity
 */
export interface UserConsent {
  id: string;
  userId: string;
  consentType: ConsentType;
  granted: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
  version: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating consent
 */
export interface ConsentInput {
  userId: string;
  consentType: ConsentType;
  granted: boolean;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Bulk consent update
 */
export interface ConsentUpdateBatch {
  consents: Array<{
    consentType: ConsentType;
    granted: boolean;
  }>;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================================================
// DATA RESTRICTION TYPES
// ============================================================================

/**
 * Data restriction entity
 */
export interface DataRestriction {
  id: string;
  userId: string;
  scope: RestrictionScope;
  reason: RestrictionReason;
  gdprRequestId: string | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a restriction
 */
export interface CreateRestrictionInput {
  userId: string;
  scope: RestrictionScope;
  reason: RestrictionReason;
  gdprRequestId?: string;
}

// ============================================================================
// ADM REVIEW TYPES
// ============================================================================

/**
 * ADM Review Queue entity
 */
export interface ADMReviewQueue {
  id: string;
  gdprRequestId: string;
  decisionId: string;
  userId: string;
  contestReason: string;
  userEvidence: string | null;
  status: ADMReviewStatus;
  priority: ADMReviewPriority;
  assignedTo: string | null;
  reviewNotes: string | null;
  reviewOutcome: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/**
 * ADM Review completion input
 */
export interface CompleteADMReviewInput {
  outcome: 'decision_overturned' | 'decision_upheld';
  notes: string;
  newDecisionData?: Record<string, unknown>;
}

// ============================================================================
// DATA EXPORT TYPES
// ============================================================================

/**
 * Result of data export operation
 */
export interface DataExportResult {
  format: 'json' | 'csv';
  data: string; // Base64 encoded or file path
  generatedAt: Date;
  expiresAt: Date;
  downloadUrl?: string;
  recordCount: number;
  categories: string[];
}

/**
 * Result of erasure operation
 */
export interface ErasureResult {
  deletedRecords: number;
  skippedRecords: number;
  pseudonymizedRecords: number;
  blockedReasons: string[];
  completedAt: Date;
}

/**
 * Erasure eligibility check result
 */
export interface ErasureEligibility {
  eligible: boolean;
  blockedReasons: string[];
  retainedDataCategories: string[];
  estimatedRecordsAffected: number;
}

// ============================================================================
// METRICS & REPORTING TYPES
// ============================================================================

/**
 * GDPR metrics for admin dashboard
 */
export interface GDPRMetrics {
  totalRequests: number;
  pendingRequests: number;
  overdueRequests: number;
  completedLast30Days: number;
  averageResponseTimeHours: number;
  requestsByType: Record<GDPRRequestType, number>;
  requestsByStatus: Record<GDPRRequestStatus, number>;
  slaComplianceRate: number; // 0-100%
}

/**
 * SLA compliance report
 */
export interface SLAReport {
  totalRequests: number;
  onTimeRequests: number;
  overdueRequests: number;
  nearingDeadline: number; // Within 48 hours
  complianceRate: number;
  averageResponseTime: number;
  longestOpenRequest: {
    id: string;
    daysOpen: number;
    requestType: GDPRRequestType;
  } | null;
}

// ============================================================================
// SLA CONSTANTS
// ============================================================================

/**
 * SLA deadlines in days
 */
export const SLA_DEADLINES = {
  standard: 30, // 30 days for most requests
  admAcknowledgment: 3, // 72 hours (3 days) for ADM acknowledgment
} as const;

/**
 * Consent policy version
 */
export const CONSENT_POLICY_VERSION = '1.0.0';

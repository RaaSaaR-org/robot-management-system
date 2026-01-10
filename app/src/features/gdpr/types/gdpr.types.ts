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

export const GDPRRequestTypes = [
  'access',
  'rectification',
  'erasure',
  'restriction',
  'portability',
  'objection',
  'adm_review',
] as const;

export type GDPRRequestType = (typeof GDPRRequestTypes)[number];

export const GDPRRequestStatuses = [
  'pending',
  'acknowledged',
  'in_progress',
  'awaiting_verification',
  'completed',
  'rejected',
  'cancelled',
] as const;

export type GDPRRequestStatus = (typeof GDPRRequestStatuses)[number];

export const ConsentTypes = [
  'marketing',
  'analytics',
  'ai_processing',
  'data_sharing',
  'third_party',
] as const;

export type ConsentType = (typeof ConsentTypes)[number];

export const RestrictionScopes = ['all', 'ai_processing', 'sharing', 'marketing'] as const;

export type RestrictionScope = (typeof RestrictionScopes)[number];

export const RestrictionReasons = [
  'accuracy_disputed',
  'unlawful_processing',
  'no_longer_needed',
  'objection_pending',
] as const;

export type RestrictionReason = (typeof RestrictionReasons)[number];

// ============================================================================
// GDPR REQUEST TYPES
// ============================================================================

export interface GDPRRequest {
  id: string;
  userId: string;
  requestType: GDPRRequestType;
  status: GDPRRequestStatus;
  submittedAt: string;
  acknowledgedAt: string | null;
  slaDeadline: string;
  completedAt: string | null;
  requestData: Record<string, unknown>;
  responseData: Record<string, unknown> | null;
  verificationToken: string | null;
  verificationExpires: string | null;
  verifiedAt: string | null;
  assignedTo: string | null;
  internalNotes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GDPRRequestStatusHistory {
  id: string;
  requestId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  reason: string | null;
  timestamp: string;
}

export interface GDPRRequestListResponse {
  requests: GDPRRequest[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// CONSENT TYPES
// ============================================================================

export interface UserConsent {
  id: string;
  userId: string;
  consentType: ConsentType;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  version: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// METRICS TYPES
// ============================================================================

export interface GDPRMetrics {
  totalRequests: number;
  pendingRequests: number;
  overdueRequests: number;
  completedLast30Days: number;
  averageResponseTimeHours: number;
  requestsByType: Record<string, number>;
  requestsByStatus: Record<string, number>;
  slaComplianceRate: number;
}

export interface SLAReport {
  totalRequests: number;
  onTimeRequests: number;
  overdueRequests: number;
  nearingDeadline: number;
  complianceRate: number;
  averageResponseTime: number;
  longestOpenRequest: {
    id: string;
    daysOpen: number;
    requestType: GDPRRequestType;
  } | null;
}

// ============================================================================
// REQUEST INPUT TYPES
// ============================================================================

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

// ============================================================================
// STORE TYPES
// ============================================================================

export interface GDPRState {
  requests: GDPRRequest[];
  selectedRequest: GDPRRequest | null;
  requestHistory: GDPRRequestStatusHistory[];
  consents: UserConsent[];
  metrics: GDPRMetrics | null;
  slaReport: SLAReport | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  isLoading: boolean;
  isLoadingRequest: boolean;
  isLoadingConsents: boolean;
  isLoadingMetrics: boolean;
  isSubmitting: boolean;
  error: string | null;
}

export interface GDPRActions {
  // User requests
  fetchMyRequests: () => Promise<void>;
  fetchRequest: (id: string) => Promise<void>;
  submitAccessRequest: (input?: AccessRequestInput) => Promise<GDPRRequest>;
  submitRectificationRequest: (input: RectificationRequestInput) => Promise<GDPRRequest>;
  submitErasureRequest: (input?: ErasureRequestInput) => Promise<GDPRRequest>;
  submitRestrictionRequest: (input: RestrictionRequestInput) => Promise<GDPRRequest>;
  submitPortabilityRequest: (input: PortabilityRequestInput) => Promise<GDPRRequest>;
  submitObjectionRequest: (input: ObjectionRequestInput) => Promise<GDPRRequest>;
  submitADMReviewRequest: (input: ADMReviewRequestInput) => Promise<GDPRRequest>;
  cancelRequest: (id: string) => Promise<void>;
  downloadExport: (id: string) => Promise<Record<string, unknown>>;

  // Consents
  fetchConsents: () => Promise<void>;
  updateConsent: (type: ConsentType, granted: boolean) => Promise<void>;

  // Admin
  fetchAdminRequests: (filters?: AdminRequestFilters) => Promise<void>;
  acknowledgeRequest: (id: string) => Promise<void>;
  completeRequest: (id: string, responseData?: Record<string, unknown>) => Promise<void>;
  rejectRequest: (id: string, reason: string) => Promise<void>;
  fetchMetrics: () => Promise<void>;
  fetchSLAReport: () => Promise<void>;

  // State management
  clearSelectedRequest: () => void;
  clearError: () => void;
  reset: () => void;
}

export interface AdminRequestFilters {
  status?: GDPRRequestStatus | GDPRRequestStatus[];
  requestType?: GDPRRequestType | GDPRRequestType[];
  userId?: string;
  assignedTo?: string;
  overdue?: boolean;
  page?: number;
  limit?: number;
}

export type GDPRStore = GDPRState & GDPRActions;

// ============================================================================
// CONSTANTS
// ============================================================================

export const REQUEST_TYPE_LABELS: Record<GDPRRequestType, string> = {
  access: 'Data Access',
  rectification: 'Rectification',
  erasure: 'Erasure',
  restriction: 'Restriction',
  portability: 'Data Portability',
  objection: 'Objection',
  adm_review: 'ADM Review',
};

export const REQUEST_TYPE_DESCRIPTIONS: Record<GDPRRequestType, string> = {
  access: 'Request a copy of all your personal data (Article 15)',
  rectification: 'Request correction of inaccurate personal data (Article 16)',
  erasure: 'Request deletion of your personal data (Article 17)',
  restriction: 'Request restriction of data processing (Article 18)',
  portability: 'Request your data in a portable format (Article 20)',
  objection: 'Object to specific data processing activities (Article 21)',
  adm_review: 'Contest an automated decision (Article 22)',
};

export const REQUEST_STATUS_LABELS: Record<GDPRRequestStatus, string> = {
  pending: 'Pending',
  acknowledged: 'Acknowledged',
  in_progress: 'In Progress',
  awaiting_verification: 'Awaiting Verification',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const REQUEST_STATUS_COLORS: Record<GDPRRequestStatus, string> = {
  pending: 'yellow',
  acknowledged: 'blue',
  in_progress: 'blue',
  awaiting_verification: 'orange',
  completed: 'green',
  rejected: 'red',
  cancelled: 'gray',
};

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  marketing: 'Marketing Communications',
  analytics: 'Usage Analytics',
  ai_processing: 'AI/ML Processing',
  data_sharing: 'Data Sharing with Partners',
  third_party: 'Third-Party Integrations',
};

export const CONSENT_TYPE_DESCRIPTIONS: Record<ConsentType, string> = {
  marketing: 'Receive promotional emails and marketing communications',
  analytics: 'Allow anonymous usage analytics to improve the service',
  ai_processing: 'Allow AI and machine learning processing of your data',
  data_sharing: 'Share data with business partners for enhanced services',
  third_party: 'Enable third-party integrations and features',
};

export const RESTRICTION_SCOPE_LABELS: Record<RestrictionScope, string> = {
  all: 'All Processing',
  ai_processing: 'AI Processing Only',
  sharing: 'Data Sharing Only',
  marketing: 'Marketing Only',
};

export const RESTRICTION_REASON_LABELS: Record<RestrictionReason, string> = {
  accuracy_disputed: 'Data Accuracy Disputed',
  unlawful_processing: 'Unlawful Processing',
  no_longer_needed: 'Controller No Longer Needs Data',
  objection_pending: 'Objection Pending Verification',
};

export const SLA_DEADLINE_DAYS = 30;
export const ADM_ACKNOWLEDGMENT_HOURS = 72;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function isRequestOverdue(request: GDPRRequest): boolean {
  if (request.status === 'completed' || request.status === 'rejected' || request.status === 'cancelled') {
    return false;
  }
  return new Date(request.slaDeadline) < new Date();
}

export function getDaysUntilDeadline(request: GDPRRequest): number {
  const deadline = new Date(request.slaDeadline);
  const now = new Date();
  const diffTime = deadline.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

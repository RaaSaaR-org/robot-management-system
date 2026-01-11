/**
 * @file approval.types.ts
 * @description Type definitions for Human Approval Workflows
 * @feature approvals
 *
 * Implements types for:
 * - GDPR Art. 22: Human review of automated decisions
 * - AI Act Art. 14: Human oversight with meaningful engagement
 * - EDPB WP251: Worker rights in automated processing
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/** Entity types that require human approval */
export const ApprovalEntityTypes = [
  'performance_evaluation',
  'shift_change',
  'disciplinary_action',
  'safety_parameter_modification',
  'software_update',
] as const;

export type ApprovalEntityType = (typeof ApprovalEntityTypes)[number];

/** Types of approval workflows */
export const ApprovalTypes = [
  'single_approval', // One approver (e.g., supervisor)
  'dual_approval', // Two approvers (e.g., safety officer + admin)
  'chain_approval', // Sequential multi-step (change control board)
] as const;

export type ApprovalType = (typeof ApprovalTypes)[number];

/** Priority levels for approval requests */
export const ApprovalPriorities = ['low', 'normal', 'high', 'critical', 'urgent'] as const;

export type ApprovalPriority = (typeof ApprovalPriorities)[number];

/** Status progression for approval requests */
export const ApprovalStatuses = [
  'pending', // Awaiting first action
  'in_progress', // At least one step completed (for multi-step)
  'approved', // All required approvals granted
  'rejected', // Rejected by an approver
  'escalated', // Escalated due to SLA breach
  'expired', // SLA deadline passed without action
  'cancelled', // Cancelled by requestor or admin
] as const;

export type ApprovalStatus = (typeof ApprovalStatuses)[number];

/** Status for individual approval steps */
export const ApprovalStepStatuses = [
  'pending', // Not yet ready for action
  'awaiting', // Ready for approver action
  'approved', // Approved by approver
  'rejected', // Rejected by approver
  'skipped', // Skipped (e.g., due to rejection in chain)
] as const;

export type ApprovalStepStatus = (typeof ApprovalStepStatuses)[number];

/** Roles that can approve requests */
export const ApproverRoles = ['supervisor', 'manager', 'safety_officer', 'admin'] as const;

export type ApproverRole = (typeof ApproverRoles)[number];

/** Decision options for approvers */
export const ApprovalDecisions = [
  'approve', // Grant approval
  'reject', // Deny approval
  'defer', // Defer decision to another approver
  'request_info', // Request additional information
] as const;

export type ApprovalDecision = (typeof ApprovalDecisions)[number];

/** Status for worker viewpoints */
export const WorkerViewpointStatuses = [
  'submitted', // Initial submission
  'acknowledged', // Approver has seen it
  'considered', // Taken into account in decision
  'addressed', // Response provided
] as const;

export type WorkerViewpointStatus = (typeof WorkerViewpointStatuses)[number];

/** Status for decision contests */
export const DecisionContestStatuses = [
  'submitted', // Initial submission
  'under_review', // Being reviewed by admin
  'human_intervention_granted', // Human intervention provided
  'decision_overturned', // Original decision reversed
  'decision_upheld', // Original decision confirmed
] as const;

export type DecisionContestStatus = (typeof DecisionContestStatuses)[number];

// ============================================================================
// SLA CONSTANTS
// ============================================================================

/** SLA hours by entity type */
export const SLA_HOURS: Record<ApprovalEntityType, number> = {
  performance_evaluation: 48, // Art. 22: 48 hours for worker-affecting
  shift_change: 24, // Supervisor approval
  disciplinary_action: 72, // Manager sign-off - allows investigation
  safety_parameter_modification: 4, // Safety-critical - urgent
  software_update: 168, // 1 week for change control board
};

/** Approval workflow configuration by entity type */
export const APPROVAL_TYPE_MAP: Record<
  ApprovalEntityType,
  { type: ApprovalType; roles: ApproverRole[]; blocking: boolean }
> = {
  performance_evaluation: { type: 'single_approval', roles: ['supervisor'], blocking: true },
  shift_change: { type: 'single_approval', roles: ['supervisor'], blocking: true },
  disciplinary_action: { type: 'single_approval', roles: ['manager'], blocking: true },
  safety_parameter_modification: {
    type: 'dual_approval',
    roles: ['safety_officer', 'admin'],
    blocking: true,
  },
  software_update: {
    type: 'chain_approval',
    roles: ['safety_officer', 'manager', 'admin'],
    blocking: true,
  },
};

/** Minimum review time in seconds to be considered active engagement (Art. 14) */
export const MINIMUM_REVIEW_SECONDS = 30;

/** Warning threshold for reviews completed too quickly */
export const RUBBER_STAMP_WARNING_SECONDS = 10;

// ============================================================================
// ENTITY INTERFACES
// ============================================================================

/** Main approval request entity */
export interface ApprovalRequest {
  id: string;
  requestNumber: string;
  entityType: ApprovalEntityType;
  entityId: string;
  entityData: Record<string, unknown>;
  approvalType: ApprovalType;
  priority: ApprovalPriority;
  status: ApprovalStatus;
  affectedUserId: string | null;
  affectedRobotId: string | null;
  slaHours: number;
  slaDeadline: Date;
  escalatedAt: Date | null;
  escalationLevel: number;
  requestedBy: string;
  requestReason: string;
  blocksExecution: boolean;
  rollbackPlan: RollbackPlan | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;

  // Optional joined relations
  chain?: ApprovalChain;
  steps?: ApprovalStep[];
  workerViewpoint?: WorkerViewpoint;
  decisionContest?: DecisionContest;
  statusHistory?: ApprovalStatusHistory[];

  // Computed/joined fields
  requestedByUser?: { id: string; name: string; email: string };
  affectedUser?: { id: string; name: string; email: string };
}

/** Multi-step approval chain configuration */
export interface ApprovalChain {
  id: string;
  approvalRequestId: string;
  name: string;
  description: string | null;
  requiredSteps: number;
  currentStepIndex: number;
  isSequential: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Individual approval step */
export interface ApprovalStep {
  id: string;
  approvalRequestId: string;
  stepOrder: number;
  approverRole: ApproverRole;
  assignedTo: string | null;
  status: ApprovalStepStatus;
  decision: ApprovalDecision | null;
  decidedBy: string | null;
  decisionNotes: string | null;
  activeEngagement: boolean;
  reviewDurationSec: number | null;
  competenceVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  assignedAt: Date | null;
  decidedAt: Date | null;

  // Optional joined data
  assignedToUser?: { id: string; name: string; email: string };
  decidedByUser?: { id: string; name: string; email: string };
}

/** Status change history for audit trail */
export interface ApprovalStatusHistory {
  id: string;
  approvalRequestId: string;
  fromStatus: ApprovalStatus | null;
  toStatus: ApprovalStatus;
  changedBy: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

/** Worker viewpoint submission (GDPR Art. 22) */
export interface WorkerViewpoint {
  id: string;
  approvalRequestId: string;
  workerId: string;
  statement: string;
  supportingDocs: string[];
  status: WorkerViewpointStatus;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  response: string | null;
  respondedAt: Date | null;
  respondedBy: string | null;
  submittedAt: Date;
  updatedAt: Date;

  // Optional joined data
  workerUser?: { id: string; name: string; email: string };
}

/** Decision contest by affected worker */
export interface DecisionContest {
  id: string;
  approvalRequestId: string | null;
  decisionId: string;
  workerId: string;
  contestReason: string;
  contestEvidence: Record<string, unknown> | null;
  requestedOutcome: string | null;
  status: DecisionContestStatus;
  priority: ApprovalPriority;
  assignedTo: string | null;
  reviewNotes: string | null;
  reviewOutcome: string | null;
  humanInterventionProvided: boolean;
  newDecisionData: Record<string, unknown> | null;
  submittedAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  completedAt: Date | null;

  // Optional joined data
  workerUser?: { id: string; name: string; email: string };
  assignedToUser?: { id: string; name: string; email: string };
}

/** Rollback plan for safety-critical software updates */
export interface RollbackPlan {
  description: string;
  steps: RollbackStep[];
  testProcedure: string;
  approvedBy: string | null;
  approvedAt: Date | null;
}

export interface RollbackStep {
  order: number;
  action: string;
  automated: boolean;
  estimatedDurationMinutes: number;
}

/** Escalation rule configuration */
export interface EscalationRule {
  id: string;
  name: string;
  description: string | null;
  entityType: ApprovalEntityType;
  approvalType: ApprovalType | null;
  triggerCondition: 'overdue' | 'near_deadline' | 'high_priority' | 'repeated_rejection';
  triggerThreshold: number;
  escalateTo: ApproverRole;
  notifyOriginal: boolean;
  notifyAdmin: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/** Input for creating a new approval request */
export interface CreateApprovalRequestInput {
  entityType: ApprovalEntityType;
  entityId: string;
  entityData?: Record<string, unknown>;
  approvalType?: ApprovalType;
  priority?: ApprovalPriority;
  affectedUserId?: string;
  affectedRobotId?: string;
  requestedBy: string;
  requestReason: string;
  blocksExecution?: boolean;
  rollbackPlan?: RollbackPlan;

  /** For explicitly defining approval chain (overrides default from APPROVAL_TYPE_MAP) */
  approverChain?: Array<{
    role: ApproverRole;
    assignedTo?: string;
  }>;
}

/** Input for processing an approval decision */
export interface ProcessApprovalInput {
  approvalRequestId: string;
  stepId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decisionNotes?: string;
  reviewDurationSec?: number;
  competenceVerified?: boolean;
}

/** Input for submitting worker viewpoint */
export interface SubmitWorkerViewpointInput {
  approvalRequestId: string;
  workerId: string;
  statement: string;
  supportingDocs?: string[];
}

/** Input for contesting a decision */
export interface ContestDecisionInput {
  decisionId: string;
  workerId: string;
  contestReason: string;
  contestEvidence?: Record<string, unknown>;
  requestedOutcome?: string;
}

/** Input for processing a contest */
export interface ProcessContestInput {
  contestId: string;
  outcome: 'human_intervention_granted' | 'decision_overturned' | 'decision_upheld';
  reviewNotes: string;
  processedBy: string;
  newDecisionData?: Record<string, unknown>;
}

/** Input for responding to a viewpoint */
export interface RespondToViewpointInput {
  viewpointId: string;
  response: string;
  respondedBy: string;
}

// ============================================================================
// QUERY & FILTER TYPES
// ============================================================================

/** Filters for querying approval requests */
export interface ApprovalRequestFilters {
  status?: ApprovalStatus | ApprovalStatus[];
  entityType?: ApprovalEntityType | ApprovalEntityType[];
  priority?: ApprovalPriority | ApprovalPriority[];
  assignedTo?: string;
  affectedUserId?: string;
  requestedBy?: string;
  overdue?: boolean;
  nearingDeadline?: boolean;
  nearingDeadlineHours?: number;
  fromDate?: Date;
  toDate?: Date;
}

/** Paginated response for approval requests */
export interface ApprovalRequestListResponse {
  requests: ApprovalRequest[];
  total: number;
  page: number;
  limit: number;
}

/** Filters for querying contests */
export interface DecisionContestFilters {
  status?: DecisionContestStatus | DecisionContestStatus[];
  workerId?: string;
  assignedTo?: string;
  fromDate?: Date;
  toDate?: Date;
}

/** Paginated response for contests */
export interface DecisionContestListResponse {
  contests: DecisionContest[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// METRICS & REPORTING
// ============================================================================

/** Dashboard metrics for approvals */
export interface ApprovalMetrics {
  totalRequests: number;
  pendingRequests: number;
  inProgressRequests: number;
  overdueRequests: number;
  nearingDeadlineRequests: number;
  avgResponseTimeHours: number;
  slaComplianceRate: number;
  requestsByType: Record<ApprovalEntityType, number>;
  requestsByStatus: Record<ApprovalStatus, number>;
  approvalsByRole: Record<ApproverRole, number>;
  activeContests: number;
  pendingViewpoints: number;
}

/** SLA compliance report */
export interface SLAComplianceReport {
  totalRequests: number;
  onTimeRequests: number;
  overdueRequests: number;
  nearingDeadline: number;
  complianceRate: number;
  avgResponseTimeHours: number;
  escalatedCount: number;
  byEntityType: Record<
    ApprovalEntityType,
    {
      total: number;
      onTime: number;
      overdue: number;
      avgHours: number;
    }
  >;
}

/** Meaningful oversight metrics (Art. 14) */
export interface MeaningfulOversightMetrics {
  totalApprovals: number;
  quickApprovals: number; // < RUBBER_STAMP_WARNING_SECONDS
  properReviews: number; // >= MINIMUM_REVIEW_SECONDS
  avgReviewDurationSec: number;
  activeEngagementRate: number;
  competenceVerificationRate: number;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/** Events emitted by the approval workflow system */
export type ApprovalEventType =
  | 'approval_request_created'
  | 'approval_request_updated'
  | 'approval_step_completed'
  | 'approval_approved'
  | 'approval_rejected'
  | 'approval_escalated'
  | 'approval_expired'
  | 'approval_cancelled'
  | 'viewpoint_submitted'
  | 'viewpoint_acknowledged'
  | 'viewpoint_responded'
  | 'contest_submitted'
  | 'contest_reviewed'
  | 'sla_warning'
  | 'sla_breach';

export interface ApprovalEvent {
  type: ApprovalEventType;
  approvalRequestId?: string;
  stepId?: string;
  viewpointId?: string;
  contestId?: string;
  userId?: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export type ApprovalEventCallback = (event: ApprovalEvent) => void;

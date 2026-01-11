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

export type ApprovalEntityType =
  | 'performance_evaluation'
  | 'shift_change'
  | 'disciplinary_action'
  | 'safety_parameter_modification'
  | 'software_update';

export const ApprovalEntityTypes: ApprovalEntityType[] = [
  'performance_evaluation',
  'shift_change',
  'disciplinary_action',
  'safety_parameter_modification',
  'software_update',
];

export type ApprovalType = 'single_approval' | 'dual_approval' | 'chain_approval';

export type ApprovalPriority = 'low' | 'normal' | 'high' | 'critical' | 'urgent';

export const ApprovalPriorities: ApprovalPriority[] = ['low', 'normal', 'high', 'critical', 'urgent'];

export type ApprovalStatus =
  | 'pending'
  | 'in_progress'
  | 'approved'
  | 'rejected'
  | 'escalated'
  | 'expired'
  | 'cancelled';

export const ApprovalStatuses: ApprovalStatus[] = [
  'pending',
  'in_progress',
  'approved',
  'rejected',
  'escalated',
  'expired',
  'cancelled',
];

export type ApprovalStepStatus = 'pending' | 'awaiting' | 'approved' | 'rejected' | 'skipped';

export type ApproverRole = 'supervisor' | 'manager' | 'safety_officer' | 'admin';

export const ApproverRoles: ApproverRole[] = ['supervisor', 'manager', 'safety_officer', 'admin'];

export type ApprovalDecision = 'approve' | 'reject' | 'defer' | 'request_info';

export type WorkerViewpointStatus = 'submitted' | 'acknowledged' | 'considered' | 'addressed';

export type DecisionContestStatus =
  | 'submitted'
  | 'under_review'
  | 'human_intervention_granted'
  | 'decision_overturned'
  | 'decision_upheld';

// ============================================================================
// SLA CONSTANTS
// ============================================================================

export const SLA_HOURS: Record<ApprovalEntityType, number> = {
  performance_evaluation: 48,
  shift_change: 24,
  disciplinary_action: 72,
  safety_parameter_modification: 4,
  software_update: 168,
};

export const MINIMUM_REVIEW_SECONDS = 30;
export const RUBBER_STAMP_WARNING_SECONDS = 10;

// ============================================================================
// ENTITY INTERFACES
// ============================================================================

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
  slaDeadline: string;
  escalatedAt: string | null;
  escalationLevel: number;
  requestedBy: string;
  requestReason: string;
  blocksExecution: boolean;
  rollbackPlan: RollbackPlan | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;

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

export interface ApprovalChain {
  id: string;
  approvalRequestId: string;
  name: string;
  description: string | null;
  requiredSteps: number;
  currentStepIndex: number;
  isSequential: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  decidedAt: string | null;

  // Optional joined data
  assignedToUser?: { id: string; name: string; email: string };
  decidedByUser?: { id: string; name: string; email: string };
}

export interface ApprovalStatusHistory {
  id: string;
  approvalRequestId: string;
  fromStatus: ApprovalStatus | null;
  toStatus: ApprovalStatus;
  changedBy: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface WorkerViewpoint {
  id: string;
  approvalRequestId: string;
  workerId: string;
  statement: string;
  supportingDocs: string[];
  status: WorkerViewpointStatus;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  response: string | null;
  respondedAt: string | null;
  respondedBy: string | null;
  submittedAt: string;
  updatedAt: string;

  // Optional joined data
  workerUser?: { id: string; name: string; email: string };
}

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
  submittedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  completedAt: string | null;

  // Optional joined data
  workerUser?: { id: string; name: string; email: string };
  assignedToUser?: { id: string; name: string; email: string };
}

export interface RollbackPlan {
  description: string;
  steps: RollbackStep[];
  testProcedure: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface RollbackStep {
  order: number;
  action: string;
  automated: boolean;
  estimatedDurationMinutes: number;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

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
  approverChain?: Array<{
    role: ApproverRole;
    assignedTo?: string;
  }>;
}

export interface ProcessApprovalInput {
  decision: ApprovalDecision;
  decidedBy: string;
  decisionNotes?: string;
  reviewDurationSec?: number;
  competenceVerified?: boolean;
}

export interface SubmitWorkerViewpointInput {
  workerId: string;
  statement: string;
  supportingDocs?: string[];
}

export interface ContestDecisionInput {
  workerId: string;
  contestReason: string;
  contestEvidence?: Record<string, unknown>;
  requestedOutcome?: string;
}

export interface ProcessContestInput {
  outcome: 'human_intervention_granted' | 'decision_overturned' | 'decision_upheld';
  reviewNotes: string;
  processedBy: string;
  newDecisionData?: Record<string, unknown>;
}

export interface RespondToViewpointInput {
  response: string;
  respondedBy: string;
}

// ============================================================================
// QUERY & FILTER TYPES
// ============================================================================

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
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface ApprovalRequestListResponse {
  requests: ApprovalRequest[];
  total: number;
  page: number;
  limit: number;
}

export interface DecisionContestFilters {
  status?: DecisionContestStatus | DecisionContestStatus[];
  workerId?: string;
  assignedTo?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface DecisionContestListResponse {
  contests: DecisionContest[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// METRICS & REPORTING
// ============================================================================

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

export interface MeaningfulOversightMetrics {
  totalApprovals: number;
  quickApprovals: number;
  properReviews: number;
  avgReviewDurationSec: number;
  activeEngagementRate: number;
  competenceVerificationRate: number;
}

// ============================================================================
// UI HELPER TYPES
// ============================================================================

export interface ApprovalQueueItem extends ApprovalRequest {
  isOverdue: boolean;
  hoursRemaining: number;
  urgencyLevel: 'normal' | 'warning' | 'critical';
  awaitingStep?: ApprovalStep;
}

export function getApprovalUrgency(request: ApprovalRequest): 'normal' | 'warning' | 'critical' {
  const deadline = new Date(request.slaDeadline);
  const now = new Date();
  const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursRemaining < 0) return 'critical';
  if (hoursRemaining < 2) return 'critical';
  if (hoursRemaining < request.slaHours * 0.25) return 'warning';
  return 'normal';
}

export function formatEntityType(type: ApprovalEntityType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function formatApproverRole(role: ApproverRole): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function getStatusColor(status: ApprovalStatus): string {
  switch (status) {
    case 'pending':
      return 'yellow';
    case 'in_progress':
      return 'blue';
    case 'approved':
      return 'green';
    case 'rejected':
      return 'red';
    case 'escalated':
      return 'orange';
    case 'expired':
      return 'gray';
    case 'cancelled':
      return 'gray';
    default:
      return 'gray';
  }
}

export function getPriorityColor(priority: ApprovalPriority): string {
  switch (priority) {
    case 'low':
      return 'gray';
    case 'normal':
      return 'blue';
    case 'high':
      return 'yellow';
    case 'critical':
      return 'orange';
    case 'urgent':
      return 'red';
    default:
      return 'gray';
  }
}

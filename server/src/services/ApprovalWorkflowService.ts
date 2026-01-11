/**
 * @file ApprovalWorkflowService.ts
 * @description Service for managing human approval workflows
 * @feature approvals
 *
 * Implements compliance requirements:
 * - GDPR Art. 22: Human review of automated decisions
 * - AI Act Art. 14: Human oversight with meaningful engagement
 * - EDPB WP251: Worker rights in automated processing
 */

import {
  approvalRequestRepository,
  approvalStepRepository,
  workerViewpointRepository,
  decisionContestRepository,
  escalationRuleRepository,
} from '../repositories/ApprovalRepository.js';
import { alertService } from './AlertService.js';
import {
  MINIMUM_REVIEW_SECONDS,
  RUBBER_STAMP_WARNING_SECONDS,
} from '../types/approval.types.js';
import type {
  ApprovalRequest,
  ApprovalStep,
  WorkerViewpoint,
  DecisionContest,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  SubmitWorkerViewpointInput,
  ContestDecisionInput,
  ProcessContestInput,
  RespondToViewpointInput,
  ApprovalRequestFilters,
  ApprovalRequestListResponse,
  DecisionContestFilters,
  DecisionContestListResponse,
  ApprovalMetrics,
  SLAComplianceReport,
  MeaningfulOversightMetrics,
  ApprovalEvent,
  ApprovalEventCallback,
  ApprovalStatus,
  ApproverRole,
  ApprovalEntityType,
} from '../types/approval.types.js';

// ============================================================================
// APPROVAL WORKFLOW SERVICE
// ============================================================================

/**
 * ApprovalWorkflowService - Manages human approval workflows for regulatory compliance
 */
export class ApprovalWorkflowService {
  private eventCallbacks: Set<ApprovalEventCallback> = new Set();
  private initialized = false;
  private slaCheckInterval?: NodeJS.Timeout;
  private escalationCheckInterval?: NodeJS.Timeout;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the approval workflow service
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    console.log('[ApprovalWorkflowService] Initializing human approval workflows...');

    // Check SLA compliance every 15 minutes
    this.slaCheckInterval = setInterval(
      () => this.checkSLACompliance(),
      15 * 60 * 1000
    );

    // Check for escalations every 30 minutes
    this.escalationCheckInterval = setInterval(
      () => this.escalateOverdueApprovals(),
      30 * 60 * 1000
    );

    this.initialized = true;
    console.log('[ApprovalWorkflowService] Human approval workflow service active');
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.slaCheckInterval) {
      clearInterval(this.slaCheckInterval);
      this.slaCheckInterval = undefined;
    }
    if (this.escalationCheckInterval) {
      clearInterval(this.escalationCheckInterval);
      this.escalationCheckInterval = undefined;
    }
    this.initialized = false;
    console.log('[ApprovalWorkflowService] Shutdown complete');
  }

  // ============================================================================
  // APPROVAL REQUEST LIFECYCLE
  // ============================================================================

  /**
   * Create a new approval request
   */
  async createApprovalRequest(input: CreateApprovalRequestInput): Promise<ApprovalRequest> {
    console.log(`[ApprovalWorkflowService] Creating approval request for ${input.entityType}:${input.entityId}`);

    const request = await approvalRequestRepository.create(input);

    // Create alert for the appropriate approvers
    const firstStep = request.steps?.[0];
    if (firstStep) {
      await alertService.createAlert({
        severity: input.priority === 'urgent' || input.priority === 'critical' ? 'critical' : 'warning',
        title: 'New Approval Required',
        message: `${input.entityType.replace(/_/g, ' ')} approval request (${request.requestNumber}) requires ${firstStep.approverRole} review. SLA: ${request.slaHours}h`,
        source: 'system',
        autoDismissMs: request.slaHours * 60 * 60 * 1000,
      });
    }

    // Emit event
    this.emitEvent({
      type: 'approval_request_created',
      approvalRequestId: request.id,
      data: { requestNumber: request.requestNumber, entityType: input.entityType },
      timestamp: new Date(),
    });

    console.log(`[ApprovalWorkflowService] Created approval request ${request.requestNumber}`);
    return request;
  }

  /**
   * Process an approval decision
   */
  async processApproval(input: ProcessApprovalInput): Promise<ApprovalRequest> {
    console.log(`[ApprovalWorkflowService] Processing approval for step ${input.stepId}`);

    // Get the approval request
    const request = await approvalRequestRepository.findById(input.approvalRequestId);
    if (!request) {
      throw new Error(`Approval request ${input.approvalRequestId} not found`);
    }

    // Verify the step is in awaiting status
    const step = await approvalStepRepository.findById(input.stepId);
    if (!step) {
      throw new Error(`Approval step ${input.stepId} not found`);
    }
    if (step.status !== 'awaiting') {
      throw new Error(`Step ${input.stepId} is not awaiting approval (status: ${step.status})`);
    }

    // Check for rubber-stamping (Art. 14 meaningful oversight)
    const reviewDuration = input.reviewDurationSec || 0;
    const isRubberStamp = reviewDuration < RUBBER_STAMP_WARNING_SECONDS;
    const isActiveEngagement = reviewDuration >= MINIMUM_REVIEW_SECONDS;

    if (isRubberStamp && input.decision === 'approve') {
      console.warn(
        `[ApprovalWorkflowService] Warning: Possible rubber-stamp approval detected (${reviewDuration}s review)`
      );
      // Log but don't block - this is tracked for compliance reporting
    }

    // Process the decision
    await approvalStepRepository.processDecision({
      ...input,
      reviewDurationSec: reviewDuration,
      competenceVerified: input.competenceVerified ?? false,
    });

    let newStatus: ApprovalStatus = request.status;
    let eventType: ApprovalEvent['type'] = 'approval_step_completed';

    if (input.decision === 'approve') {
      // Check if all steps are complete
      const allApproved = await approvalStepRepository.areAllStepsApproved(input.approvalRequestId);

      if (allApproved) {
        // All steps approved - mark request as approved
        newStatus = 'approved';
        eventType = 'approval_approved';
        await approvalRequestRepository.updateStatus(
          input.approvalRequestId,
          'approved',
          input.decidedBy,
          'All required approvals granted'
        );

        console.log(`[ApprovalWorkflowService] Approval request ${request.requestNumber} fully approved`);
      } else {
        // More steps needed - advance to next step
        newStatus = 'in_progress';
        await approvalStepRepository.advanceToNextStep(input.approvalRequestId);
        await approvalRequestRepository.updateStatus(
          input.approvalRequestId,
          'in_progress',
          input.decidedBy,
          `Step ${step.stepOrder + 1} approved, proceeding to next step`
        );
      }
    } else if (input.decision === 'reject') {
      // Rejection - mark request as rejected and skip remaining steps
      newStatus = 'rejected';
      eventType = 'approval_rejected';
      await approvalStepRepository.skipRemainingSteps(input.approvalRequestId);
      await approvalRequestRepository.updateStatus(
        input.approvalRequestId,
        'rejected',
        input.decidedBy,
        input.decisionNotes || 'Approval rejected'
      );

      console.log(`[ApprovalWorkflowService] Approval request ${request.requestNumber} rejected`);
    } else if (input.decision === 'defer') {
      // Deferred - keep current status, may need reassignment
      console.log(`[ApprovalWorkflowService] Approval step ${input.stepId} deferred`);
    } else if (input.decision === 'request_info') {
      // More info needed - keep current status
      console.log(`[ApprovalWorkflowService] Additional info requested for ${request.requestNumber}`);
    }

    // Emit event
    this.emitEvent({
      type: eventType,
      approvalRequestId: input.approvalRequestId,
      stepId: input.stepId,
      userId: input.decidedBy,
      data: {
        decision: input.decision,
        reviewDurationSec: reviewDuration,
        activeEngagement: isActiveEngagement,
        rubberStampWarning: isRubberStamp,
      },
      timestamp: new Date(),
    });

    // Return updated request
    const updatedRequest = await approvalRequestRepository.findById(input.approvalRequestId);
    return updatedRequest!;
  }

  /**
   * Cancel an approval request
   */
  async cancelApprovalRequest(
    requestId: string,
    cancelledBy: string,
    reason: string
  ): Promise<ApprovalRequest | null> {
    console.log(`[ApprovalWorkflowService] Cancelling approval request ${requestId}`);

    const request = await approvalRequestRepository.updateStatus(
      requestId,
      'cancelled',
      cancelledBy,
      reason
    );

    if (request) {
      // Skip remaining steps
      await approvalStepRepository.skipRemainingSteps(requestId);

      // Emit event
      this.emitEvent({
        type: 'approval_cancelled',
        approvalRequestId: requestId,
        userId: cancelledBy,
        data: { reason },
        timestamp: new Date(),
      });
    }

    return request;
  }

  /**
   * Manually escalate an approval request
   */
  async escalateRequest(
    requestId: string,
    escalatedBy: string,
    reason?: string
  ): Promise<ApprovalRequest | null> {
    console.log(`[ApprovalWorkflowService] Manually escalating approval request ${requestId}`);

    const request = await approvalRequestRepository.escalate(requestId, escalatedBy);

    if (request) {
      // Create alert for escalation
      await alertService.createAlert({
        severity: 'error',
        title: 'Approval Escalated',
        message: `Approval request ${request.requestNumber} has been escalated. ${reason || 'Manual escalation'}`,
        source: 'system',
      });

      // Emit event
      this.emitEvent({
        type: 'approval_escalated',
        approvalRequestId: requestId,
        userId: escalatedBy,
        data: { reason, escalationLevel: request.escalationLevel },
        timestamp: new Date(),
      });
    }

    return request;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get approval request by ID
   */
  async getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
    return approvalRequestRepository.findById(id);
  }

  /**
   * Get approval request by request number
   */
  async getApprovalRequestByNumber(requestNumber: string): Promise<ApprovalRequest | null> {
    return approvalRequestRepository.findByRequestNumber(requestNumber);
  }

  /**
   * Get all approval requests with filters
   */
  async getApprovalRequests(
    filters?: ApprovalRequestFilters,
    page?: number,
    limit?: number
  ): Promise<ApprovalRequestListResponse> {
    return approvalRequestRepository.findAll(filters, page, limit);
  }

  /**
   * Get pending approvals for a specific user
   */
  async getPendingApprovalsForUser(userId: string): Promise<ApprovalRequest[]> {
    return approvalRequestRepository.findPendingForUser(userId);
  }

  /**
   * Get pending approvals by role
   */
  async getPendingApprovalsByRole(role: ApproverRole): Promise<ApprovalRequest[]> {
    return approvalRequestRepository.findPendingByRole(role);
  }

  /**
   * Get overdue approvals
   */
  async getOverdueApprovals(): Promise<ApprovalRequest[]> {
    return approvalRequestRepository.findOverdue();
  }

  /**
   * Get approvals nearing deadline
   */
  async getApprovalsNearingDeadline(withinHours = 4): Promise<ApprovalRequest[]> {
    return approvalRequestRepository.findNearingDeadline(withinHours);
  }

  // ============================================================================
  // WORKER RIGHTS (GDPR Art. 22 & EDPB WP251)
  // ============================================================================

  /**
   * Submit worker viewpoint on an approval request
   */
  async submitWorkerViewpoint(input: SubmitWorkerViewpointInput): Promise<WorkerViewpoint> {
    console.log(`[ApprovalWorkflowService] Worker ${input.workerId} submitting viewpoint`);

    // Verify the approval request exists and affects this worker
    const request = await approvalRequestRepository.findById(input.approvalRequestId);
    if (!request) {
      throw new Error(`Approval request ${input.approvalRequestId} not found`);
    }

    // Check if worker is affected
    if (request.affectedUserId && request.affectedUserId !== input.workerId) {
      throw new Error('Worker is not the affected party for this approval request');
    }

    // Check if viewpoint already exists
    const existing = await workerViewpointRepository.findByRequestId(input.approvalRequestId);
    if (existing) {
      throw new Error('A viewpoint has already been submitted for this approval request');
    }

    const viewpoint = await workerViewpointRepository.create(input);

    // Emit event
    this.emitEvent({
      type: 'viewpoint_submitted',
      approvalRequestId: input.approvalRequestId,
      viewpointId: viewpoint.id,
      userId: input.workerId,
      timestamp: new Date(),
    });

    // Create alert for approvers
    await alertService.createAlert({
      severity: 'info',
      title: 'Worker Viewpoint Submitted',
      message: `A worker has submitted a viewpoint on approval request ${request.requestNumber}. This must be considered per GDPR Art. 22.`,
      source: 'system',
    });

    console.log(`[ApprovalWorkflowService] Viewpoint submitted for ${request.requestNumber}`);
    return viewpoint;
  }

  /**
   * Acknowledge a worker viewpoint
   */
  async acknowledgeViewpoint(viewpointId: string, acknowledgedBy: string): Promise<WorkerViewpoint | null> {
    const viewpoint = await workerViewpointRepository.acknowledge(viewpointId, acknowledgedBy);

    if (viewpoint) {
      this.emitEvent({
        type: 'viewpoint_acknowledged',
        approvalRequestId: viewpoint.approvalRequestId,
        viewpointId: viewpoint.id,
        userId: acknowledgedBy,
        timestamp: new Date(),
      });
    }

    return viewpoint;
  }

  /**
   * Respond to a worker viewpoint
   */
  async respondToViewpoint(input: RespondToViewpointInput): Promise<WorkerViewpoint | null> {
    const viewpoint = await workerViewpointRepository.respond(
      input.viewpointId,
      input.response,
      input.respondedBy
    );

    if (viewpoint) {
      this.emitEvent({
        type: 'viewpoint_responded',
        approvalRequestId: viewpoint.approvalRequestId,
        viewpointId: viewpoint.id,
        userId: input.respondedBy,
        timestamp: new Date(),
      });

      console.log(`[ApprovalWorkflowService] Viewpoint ${input.viewpointId} responded to`);
    }

    return viewpoint;
  }

  /**
   * Get viewpoint for an approval request
   */
  async getViewpoint(approvalRequestId: string): Promise<WorkerViewpoint | null> {
    return workerViewpointRepository.findByRequestId(approvalRequestId);
  }

  /**
   * Contest an automated decision
   */
  async contestDecision(input: ContestDecisionInput): Promise<DecisionContest> {
    console.log(`[ApprovalWorkflowService] Worker ${input.workerId} contesting decision ${input.decisionId}`);

    const contest = await decisionContestRepository.create(input);

    // Emit event
    this.emitEvent({
      type: 'contest_submitted',
      contestId: contest.id,
      userId: input.workerId,
      data: { decisionId: input.decisionId },
      timestamp: new Date(),
    });

    // Create high-priority alert
    await alertService.createAlert({
      severity: 'error',
      title: 'Decision Contested',
      message: `A worker has contested decision ${input.decisionId}. Human intervention required per GDPR Art. 22.`,
      source: 'system',
    });

    console.log(`[ApprovalWorkflowService] Decision contest created: ${contest.id}`);
    return contest;
  }

  /**
   * Request human intervention on a decision (EDPB WP251)
   */
  async requestHumanIntervention(
    decisionId: string,
    workerId: string,
    reason: string
  ): Promise<DecisionContest> {
    return this.contestDecision({
      decisionId,
      workerId,
      contestReason: `Human intervention requested: ${reason}`,
      requestedOutcome: 'human_review',
    });
  }

  /**
   * Process a decision contest
   */
  async processContest(input: ProcessContestInput): Promise<DecisionContest | null> {
    console.log(`[ApprovalWorkflowService] Processing contest ${input.contestId}`);

    const contest = await decisionContestRepository.updateStatus(
      input.contestId,
      input.outcome,
      input.reviewNotes,
      input.outcome === 'decision_overturned' ? 'Decision overturned' : 'Contest reviewed',
      input.processedBy
    );

    if (contest) {
      this.emitEvent({
        type: 'contest_reviewed',
        contestId: contest.id,
        userId: input.processedBy,
        data: {
          outcome: input.outcome,
          humanInterventionProvided: input.outcome === 'human_intervention_granted',
        },
        timestamp: new Date(),
      });

      console.log(`[ApprovalWorkflowService] Contest ${input.contestId} processed: ${input.outcome}`);
    }

    return contest;
  }

  /**
   * Get decision contests with filters
   */
  async getContests(
    filters?: DecisionContestFilters,
    page?: number,
    limit?: number
  ): Promise<DecisionContestListResponse> {
    return decisionContestRepository.findAll(filters, page, limit);
  }

  /**
   * Get contest by ID
   */
  async getContest(id: string): Promise<DecisionContest | null> {
    return decisionContestRepository.findById(id);
  }

  // ============================================================================
  // SLA MANAGEMENT
  // ============================================================================

  /**
   * Check SLA compliance and create warnings
   */
  async checkSLACompliance(): Promise<void> {
    console.log('[ApprovalWorkflowService] Checking SLA compliance...');

    // Get approvals nearing deadline (within 2 hours)
    const nearingDeadline = await approvalRequestRepository.findNearingDeadline(2);

    for (const request of nearingDeadline) {
      const hoursRemaining = Math.max(
        0,
        (new Date(request.slaDeadline).getTime() - Date.now()) / (1000 * 60 * 60)
      );

      // Emit SLA warning
      this.emitEvent({
        type: 'sla_warning',
        approvalRequestId: request.id,
        data: {
          requestNumber: request.requestNumber,
          slaDeadline: request.slaDeadline,
          hoursRemaining: Math.round(hoursRemaining * 10) / 10,
        },
        timestamp: new Date(),
      });

      // Create alert if within 1 hour
      if (hoursRemaining < 1) {
        await alertService.createAlert({
          severity: 'error',
          title: 'SLA Deadline Imminent',
          message: `Approval ${request.requestNumber} deadline in ${Math.round(hoursRemaining * 60)} minutes`,
          source: 'system',
          autoDismissMs: 60 * 60 * 1000,
        });
      }
    }

    // Check for breaches
    const overdue = await approvalRequestRepository.findOverdue();
    for (const request of overdue) {
      this.emitEvent({
        type: 'sla_breach',
        approvalRequestId: request.id,
        data: {
          requestNumber: request.requestNumber,
          slaDeadline: request.slaDeadline,
          overdueHours: Math.round(
            (Date.now() - new Date(request.slaDeadline).getTime()) / (1000 * 60 * 60) * 10
          ) / 10,
        },
        timestamp: new Date(),
      });
    }

    console.log(
      `[ApprovalWorkflowService] SLA check complete: ${nearingDeadline.length} nearing deadline, ${overdue.length} overdue`
    );
  }

  /**
   * Escalate overdue approvals automatically
   */
  async escalateOverdueApprovals(): Promise<void> {
    console.log('[ApprovalWorkflowService] Checking for escalations...');

    const overdue = await approvalRequestRepository.findOverdue();

    for (const request of overdue) {
      // Only escalate if not already escalated recently
      if (request.status !== 'escalated') {
        // Get escalation rules for this entity type
        const rules = await escalationRuleRepository.findActiveForEntityType(
          request.entityType
        );

        for (const rule of rules) {
          if (rule.triggerCondition === 'overdue') {
            const overdueHours =
              (Date.now() - new Date(request.slaDeadline).getTime()) / (1000 * 60 * 60);

            if (overdueHours >= rule.triggerThreshold) {
              await this.escalateRequest(request.id, 'system', 'Auto-escalated: SLA breach');
              break; // Only escalate once per request per check
            }
          }
        }
      }
    }
  }

  // ============================================================================
  // MEANINGFUL OVERSIGHT (AI Act Art. 14)
  // ============================================================================

  /**
   * Verify if a review constitutes active engagement
   */
  verifyActiveEngagement(reviewDurationSec: number): { isActive: boolean; warning?: string } {
    if (reviewDurationSec >= MINIMUM_REVIEW_SECONDS) {
      return { isActive: true };
    }

    if (reviewDurationSec < RUBBER_STAMP_WARNING_SECONDS) {
      return {
        isActive: false,
        warning: `Review duration (${reviewDurationSec}s) indicates possible rubber-stamping. Minimum ${MINIMUM_REVIEW_SECONDS}s recommended for meaningful oversight.`,
      };
    }

    return {
      isActive: false,
      warning: `Review duration (${reviewDurationSec}s) below recommended minimum of ${MINIMUM_REVIEW_SECONDS}s.`,
    };
  }

  // ============================================================================
  // METRICS & REPORTING
  // ============================================================================

  /**
   * Get approval workflow metrics
   */
  async getMetrics(): Promise<ApprovalMetrics> {
    const [
      statusCounts,
      overdueCount,
      nearingDeadlineRequests,
      activeContests,
      pendingViewpoints,
    ] = await Promise.all([
      approvalRequestRepository.countByStatus(),
      approvalRequestRepository.countOverdue(),
      approvalRequestRepository.findNearingDeadline(4),
      decisionContestRepository.countActive(),
      workerViewpointRepository.countPending(),
    ]);

    // Get all requests for type breakdown
    const allRequests = await approvalRequestRepository.findAll({}, 1, 1000);

    // Calculate request counts by type
    const requestsByType: Record<ApprovalEntityType, number> = {
      performance_evaluation: 0,
      shift_change: 0,
      disciplinary_action: 0,
      safety_parameter_modification: 0,
      software_update: 0,
    };

    for (const req of allRequests.requests) {
      requestsByType[req.entityType]++;
    }

    // Calculate approvals by role (from completed steps)
    const approvalsByRole: Record<ApproverRole, number> = {
      supervisor: 0,
      manager: 0,
      safety_officer: 0,
      admin: 0,
    };

    // This would need a more efficient query in production
    // For now, we use placeholder data based on request types
    for (const req of allRequests.requests) {
      if (req.status === 'approved' && req.steps) {
        for (const step of req.steps) {
          if (step.status === 'approved') {
            approvalsByRole[step.approverRole]++;
          }
        }
      }
    }

    // Calculate average response time
    const completedRequests = allRequests.requests.filter(
      (r) => r.completedAt && (r.status === 'approved' || r.status === 'rejected')
    );
    const avgResponseTimeHours =
      completedRequests.length > 0
        ? completedRequests.reduce((sum, r) => {
            const responseTime =
              (new Date(r.completedAt!).getTime() - new Date(r.createdAt).getTime()) /
              (1000 * 60 * 60);
            return sum + responseTime;
          }, 0) / completedRequests.length
        : 0;

    // Calculate SLA compliance rate
    const slaCompliantRequests = completedRequests.filter(
      (r) => new Date(r.completedAt!) <= new Date(r.slaDeadline)
    );
    const slaComplianceRate =
      completedRequests.length > 0
        ? (slaCompliantRequests.length / completedRequests.length) * 100
        : 100;

    return {
      totalRequests: allRequests.total,
      pendingRequests: statusCounts.pending,
      inProgressRequests: statusCounts.in_progress,
      overdueRequests: overdueCount,
      nearingDeadlineRequests: nearingDeadlineRequests.length,
      avgResponseTimeHours: Math.round(avgResponseTimeHours * 10) / 10,
      slaComplianceRate: Math.round(slaComplianceRate * 10) / 10,
      requestsByType,
      requestsByStatus: statusCounts,
      approvalsByRole,
      activeContests,
      pendingViewpoints,
    };
  }

  /**
   * Get SLA compliance report
   */
  async getSLAComplianceReport(): Promise<SLAComplianceReport> {
    const allRequests = await approvalRequestRepository.findAll({}, 1, 1000);
    const overdueRequests = await approvalRequestRepository.findOverdue();
    const nearingDeadline = await approvalRequestRepository.findNearingDeadline(4);

    const completedRequests = allRequests.requests.filter(
      (r) => r.completedAt && (r.status === 'approved' || r.status === 'rejected')
    );

    const onTimeRequests = completedRequests.filter(
      (r) => new Date(r.completedAt!) <= new Date(r.slaDeadline)
    );

    const escalatedCount = allRequests.requests.filter(
      (r) => r.status === 'escalated' || r.escalationLevel > 0
    ).length;

    // Calculate by entity type
    const byEntityType: Record<
      ApprovalEntityType,
      { total: number; onTime: number; overdue: number; avgHours: number }
    > = {
      performance_evaluation: { total: 0, onTime: 0, overdue: 0, avgHours: 0 },
      shift_change: { total: 0, onTime: 0, overdue: 0, avgHours: 0 },
      disciplinary_action: { total: 0, onTime: 0, overdue: 0, avgHours: 0 },
      safety_parameter_modification: { total: 0, onTime: 0, overdue: 0, avgHours: 0 },
      software_update: { total: 0, onTime: 0, overdue: 0, avgHours: 0 },
    };

    for (const req of completedRequests) {
      const entry = byEntityType[req.entityType];
      entry.total++;

      const responseHours =
        (new Date(req.completedAt!).getTime() - new Date(req.createdAt).getTime()) /
        (1000 * 60 * 60);
      entry.avgHours = (entry.avgHours * (entry.total - 1) + responseHours) / entry.total;

      if (new Date(req.completedAt!) <= new Date(req.slaDeadline)) {
        entry.onTime++;
      } else {
        entry.overdue++;
      }
    }

    // Round average hours
    for (const type of Object.keys(byEntityType) as ApprovalEntityType[]) {
      byEntityType[type].avgHours = Math.round(byEntityType[type].avgHours * 10) / 10;
    }

    const avgResponseTimeHours =
      completedRequests.length > 0
        ? completedRequests.reduce((sum, r) => {
            const responseTime =
              (new Date(r.completedAt!).getTime() - new Date(r.createdAt).getTime()) /
              (1000 * 60 * 60);
            return sum + responseTime;
          }, 0) / completedRequests.length
        : 0;

    return {
      totalRequests: allRequests.total,
      onTimeRequests: onTimeRequests.length,
      overdueRequests: overdueRequests.length,
      nearingDeadline: nearingDeadline.length,
      complianceRate:
        completedRequests.length > 0
          ? Math.round((onTimeRequests.length / completedRequests.length) * 1000) / 10
          : 100,
      avgResponseTimeHours: Math.round(avgResponseTimeHours * 10) / 10,
      escalatedCount,
      byEntityType,
    };
  }

  /**
   * Get meaningful oversight metrics (Art. 14 compliance)
   */
  async getMeaningfulOversightMetrics(): Promise<MeaningfulOversightMetrics> {
    // Get all completed approval steps
    const allRequests = await approvalRequestRepository.findAll({}, 1, 1000);

    let totalApprovals = 0;
    let quickApprovals = 0;
    let properReviews = 0;
    let totalDuration = 0;
    let activeEngagementCount = 0;
    let competenceVerifiedCount = 0;

    for (const req of allRequests.requests) {
      if (req.steps) {
        for (const step of req.steps) {
          if (step.decision === 'approve' || step.decision === 'reject') {
            totalApprovals++;

            if (step.reviewDurationSec != null) {
              totalDuration += step.reviewDurationSec;

              if (step.reviewDurationSec < RUBBER_STAMP_WARNING_SECONDS) {
                quickApprovals++;
              }
              if (step.reviewDurationSec >= MINIMUM_REVIEW_SECONDS) {
                properReviews++;
              }
            }

            if (step.activeEngagement) {
              activeEngagementCount++;
            }
            if (step.competenceVerified) {
              competenceVerifiedCount++;
            }
          }
        }
      }
    }

    return {
      totalApprovals,
      quickApprovals,
      properReviews,
      avgReviewDurationSec:
        totalApprovals > 0 ? Math.round(totalDuration / totalApprovals) : 0,
      activeEngagementRate:
        totalApprovals > 0
          ? Math.round((activeEngagementCount / totalApprovals) * 1000) / 10
          : 100,
      competenceVerificationRate:
        totalApprovals > 0
          ? Math.round((competenceVerifiedCount / totalApprovals) * 1000) / 10
          : 100,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Subscribe to approval events
   */
  onApprovalEvent(callback: ApprovalEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an approval event to all subscribers
   */
  private emitEvent(event: ApprovalEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[ApprovalWorkflowService] Event callback error:', error);
      }
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const approvalWorkflowService = new ApprovalWorkflowService();

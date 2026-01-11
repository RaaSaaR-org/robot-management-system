/**
 * @file ApprovalRepository.ts
 * @description Data access layer for Human Approval Workflow entities
 * @feature approvals
 *
 * Implements GDPR Art. 22 and AI Act Art. 14 approval mechanisms
 */

import { prisma } from '../database/index.js';
import type {
  ApprovalRequest as PrismaApprovalRequest,
  ApprovalChain as PrismaApprovalChain,
  ApprovalStep as PrismaApprovalStep,
  ApprovalStatusHistory as PrismaApprovalStatusHistory,
  WorkerViewpoint as PrismaWorkerViewpoint,
  DecisionContest as PrismaDecisionContest,
  EscalationRule as PrismaEscalationRule,
} from '@prisma/client';
import {
  SLA_HOURS,
  APPROVAL_TYPE_MAP,
} from '../types/approval.types.js';
import type {
  ApprovalRequest,
  ApprovalChain,
  ApprovalStep,
  ApprovalStatusHistory,
  WorkerViewpoint,
  DecisionContest,
  EscalationRule,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  SubmitWorkerViewpointInput,
  ContestDecisionInput,
  ApprovalRequestFilters,
  ApprovalRequestListResponse,
  DecisionContestFilters,
  DecisionContestListResponse,
  ApprovalEntityType,
  ApprovalType,
  ApprovalPriority,
  ApprovalStatus,
  ApprovalStepStatus,
  ApproverRole,
  ApprovalDecision,
  WorkerViewpointStatus,
  DecisionContestStatus,
} from '../types/approval.types.js';

// ============================================================================
// TYPES FOR PRISMA INCLUDES
// ============================================================================

type ApprovalRequestWithRelations = PrismaApprovalRequest & {
  chain?: PrismaApprovalChain | null;
  steps?: PrismaApprovalStep[];
  workerViewpoint?: PrismaWorkerViewpoint | null;
  decisionContest?: PrismaDecisionContest | null;
  statusHistory?: PrismaApprovalStatusHistory[];
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function dbApprovalRequestToDomain(
  db: ApprovalRequestWithRelations
): ApprovalRequest {
  return {
    id: db.id,
    requestNumber: db.requestNumber,
    entityType: db.entityType as ApprovalEntityType,
    entityId: db.entityId,
    entityData: JSON.parse(db.entityData) as Record<string, unknown>,
    approvalType: db.approvalType as ApprovalType,
    priority: db.priority as ApprovalPriority,
    status: db.status as ApprovalStatus,
    affectedUserId: db.affectedUserId,
    affectedRobotId: db.affectedRobotId,
    slaHours: db.slaHours,
    slaDeadline: db.slaDeadline,
    escalatedAt: db.escalatedAt,
    escalationLevel: db.escalationLevel,
    requestedBy: db.requestedBy,
    requestReason: db.requestReason,
    blocksExecution: db.blocksExecution,
    rollbackPlan: db.rollbackPlan ? JSON.parse(db.rollbackPlan) : null,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
    completedAt: db.completedAt,
    chain: db.chain ? dbApprovalChainToDomain(db.chain) : undefined,
    steps: db.steps?.map(dbApprovalStepToDomain),
    workerViewpoint: db.workerViewpoint
      ? dbWorkerViewpointToDomain(db.workerViewpoint)
      : undefined,
    decisionContest: db.decisionContest
      ? dbDecisionContestToDomain(db.decisionContest)
      : undefined,
    statusHistory: db.statusHistory?.map(dbStatusHistoryToDomain),
  };
}

function dbApprovalChainToDomain(db: PrismaApprovalChain): ApprovalChain {
  return {
    id: db.id,
    approvalRequestId: db.approvalRequestId,
    name: db.name,
    description: db.description,
    requiredSteps: db.requiredSteps,
    currentStepIndex: db.currentStepIndex,
    isSequential: db.isSequential,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function dbApprovalStepToDomain(db: PrismaApprovalStep): ApprovalStep {
  return {
    id: db.id,
    approvalRequestId: db.approvalRequestId,
    stepOrder: db.stepOrder,
    approverRole: db.approverRole as ApproverRole,
    assignedTo: db.assignedTo,
    status: db.status as ApprovalStepStatus,
    decision: db.decision as ApprovalDecision | null,
    decidedBy: db.decidedBy,
    decisionNotes: db.decisionNotes,
    activeEngagement: db.activeEngagement,
    reviewDurationSec: db.reviewDurationSec,
    competenceVerified: db.competenceVerified,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
    assignedAt: db.assignedAt,
    decidedAt: db.decidedAt,
  };
}

function dbStatusHistoryToDomain(
  db: PrismaApprovalStatusHistory
): ApprovalStatusHistory {
  return {
    id: db.id,
    approvalRequestId: db.approvalRequestId,
    fromStatus: db.fromStatus as ApprovalStatus | null,
    toStatus: db.toStatus as ApprovalStatus,
    changedBy: db.changedBy,
    reason: db.reason,
    metadata: JSON.parse(db.metadata) as Record<string, unknown>,
    timestamp: db.timestamp,
  };
}

function dbWorkerViewpointToDomain(db: PrismaWorkerViewpoint): WorkerViewpoint {
  return {
    id: db.id,
    approvalRequestId: db.approvalRequestId,
    workerId: db.workerId,
    statement: db.statement,
    supportingDocs: JSON.parse(db.supportingDocs) as string[],
    status: db.status as WorkerViewpointStatus,
    acknowledgedAt: db.acknowledgedAt,
    acknowledgedBy: db.acknowledgedBy,
    response: db.response,
    respondedAt: db.respondedAt,
    respondedBy: db.respondedBy,
    submittedAt: db.submittedAt,
    updatedAt: db.updatedAt,
  };
}

function dbDecisionContestToDomain(db: PrismaDecisionContest): DecisionContest {
  return {
    id: db.id,
    approvalRequestId: db.approvalRequestId,
    decisionId: db.decisionId,
    workerId: db.workerId,
    contestReason: db.contestReason,
    contestEvidence: db.contestEvidence
      ? (JSON.parse(db.contestEvidence) as Record<string, unknown>)
      : null,
    requestedOutcome: db.requestedOutcome,
    status: db.status as DecisionContestStatus,
    priority: db.priority as ApprovalPriority,
    assignedTo: db.assignedTo,
    reviewNotes: db.reviewNotes,
    reviewOutcome: db.reviewOutcome,
    humanInterventionProvided: db.humanInterventionProvided,
    newDecisionData: db.newDecisionData
      ? (JSON.parse(db.newDecisionData) as Record<string, unknown>)
      : null,
    submittedAt: db.submittedAt,
    updatedAt: db.updatedAt,
    reviewedAt: db.reviewedAt,
    completedAt: db.completedAt,
  };
}

function dbEscalationRuleToDomain(db: PrismaEscalationRule): EscalationRule {
  return {
    id: db.id,
    name: db.name,
    description: db.description,
    entityType: db.entityType as ApprovalEntityType,
    approvalType: db.approvalType as ApprovalType | null,
    triggerCondition: db.triggerCondition as
      | 'overdue'
      | 'near_deadline'
      | 'high_priority'
      | 'repeated_rejection',
    triggerThreshold: db.triggerThreshold,
    escalateTo: db.escalateTo as ApproverRole,
    notifyOriginal: db.notifyOriginal,
    notifyAdmin: db.notifyAdmin,
    isActive: db.isActive,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

/**
 * Generate a unique request number in format APR-YYYY-NNNNN
 */
async function generateRequestNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `APR-${year}-`;

  const lastRequest = await prisma.approvalRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { requestNumber: 'desc' },
    select: { requestNumber: true },
  });

  let nextNumber = 1;
  if (lastRequest) {
    const lastNumber = parseInt(lastRequest.requestNumber.split('-')[2], 10);
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(5, '0')}`;
}

// ============================================================================
// APPROVAL REQUEST REPOSITORY
// ============================================================================

export class ApprovalRequestRepository {
  private includeRelations = {
    chain: true,
    steps: { orderBy: { stepOrder: 'asc' as const } },
    workerViewpoint: true,
    decisionContest: true,
    statusHistory: { orderBy: { timestamp: 'desc' as const } },
  };

  /**
   * Find an approval request by ID
   */
  async findById(id: string): Promise<ApprovalRequest | null> {
    const request = await prisma.approvalRequest.findUnique({
      where: { id },
      include: this.includeRelations,
    });
    return request ? dbApprovalRequestToDomain(request) : null;
  }

  /**
   * Find by request number
   */
  async findByRequestNumber(requestNumber: string): Promise<ApprovalRequest | null> {
    const request = await prisma.approvalRequest.findUnique({
      where: { requestNumber },
      include: this.includeRelations,
    });
    return request ? dbApprovalRequestToDomain(request) : null;
  }

  /**
   * Find approvals for an entity
   */
  async findByEntity(
    entityType: ApprovalEntityType,
    entityId: string
  ): Promise<ApprovalRequest[]> {
    const requests = await prisma.approvalRequest.findMany({
      where: { entityType, entityId },
      include: this.includeRelations,
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(dbApprovalRequestToDomain);
  }

  /**
   * Find pending approvals for a specific user
   */
  async findPendingForUser(userId: string): Promise<ApprovalRequest[]> {
    const requests = await prisma.approvalRequest.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        steps: {
          some: {
            assignedTo: userId,
            status: 'awaiting',
          },
        },
      },
      include: this.includeRelations,
      orderBy: [{ priority: 'desc' }, { slaDeadline: 'asc' }],
    });
    return requests.map(dbApprovalRequestToDomain);
  }

  /**
   * Find pending approvals by role
   */
  async findPendingByRole(role: ApproverRole): Promise<ApprovalRequest[]> {
    const requests = await prisma.approvalRequest.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        steps: {
          some: {
            approverRole: role,
            status: 'awaiting',
            assignedTo: null, // Not assigned to specific user
          },
        },
      },
      include: this.includeRelations,
      orderBy: [{ priority: 'desc' }, { slaDeadline: 'asc' }],
    });
    return requests.map(dbApprovalRequestToDomain);
  }

  /**
   * Find overdue approvals
   */
  async findOverdue(): Promise<ApprovalRequest[]> {
    const now = new Date();
    const requests = await prisma.approvalRequest.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        slaDeadline: { lt: now },
      },
      include: this.includeRelations,
      orderBy: { slaDeadline: 'asc' },
    });
    return requests.map(dbApprovalRequestToDomain);
  }

  /**
   * Find approvals nearing deadline
   */
  async findNearingDeadline(withinHours: number): Promise<ApprovalRequest[]> {
    const now = new Date();
    const threshold = new Date(now.getTime() + withinHours * 60 * 60 * 1000);
    const requests = await prisma.approvalRequest.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        slaDeadline: { gt: now, lt: threshold },
      },
      include: this.includeRelations,
      orderBy: { slaDeadline: 'asc' },
    });
    return requests.map(dbApprovalRequestToDomain);
  }

  /**
   * Find all with filters and pagination
   */
  async findAll(
    filters: ApprovalRequestFilters = {},
    page = 1,
    limit = 20
  ): Promise<ApprovalRequestListResponse> {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }

    if (filters.entityType) {
      where.entityType = Array.isArray(filters.entityType)
        ? { in: filters.entityType }
        : filters.entityType;
    }

    if (filters.priority) {
      where.priority = Array.isArray(filters.priority)
        ? { in: filters.priority }
        : filters.priority;
    }

    if (filters.affectedUserId) {
      where.affectedUserId = filters.affectedUserId;
    }

    if (filters.requestedBy) {
      where.requestedBy = filters.requestedBy;
    }

    if (filters.overdue) {
      where.slaDeadline = { lt: new Date() };
      where.status = { in: ['pending', 'in_progress'] };
    }

    if (filters.fromDate || filters.toDate) {
      where.createdAt = {};
      if (filters.fromDate) {
        (where.createdAt as Record<string, Date>).gte = filters.fromDate;
      }
      if (filters.toDate) {
        (where.createdAt as Record<string, Date>).lte = filters.toDate;
      }
    }

    const [requests, total] = await Promise.all([
      prisma.approvalRequest.findMany({
        where,
        include: this.includeRelations,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.approvalRequest.count({ where }),
    ]);

    return {
      requests: requests.map(dbApprovalRequestToDomain),
      total,
      page,
      limit,
    };
  }

  /**
   * Create a new approval request
   */
  async create(input: CreateApprovalRequestInput): Promise<ApprovalRequest> {
    const requestNumber = await generateRequestNumber();
    const config = APPROVAL_TYPE_MAP[input.entityType];
    const approvalType = input.approvalType || config.type;
    const slaHours = SLA_HOURS[input.entityType];
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    // Determine approval steps
    const approverChain = input.approverChain || config.roles.map((role) => ({ role, assignedTo: undefined }));

    const request = await prisma.approvalRequest.create({
      data: {
        requestNumber,
        entityType: input.entityType,
        entityId: input.entityId,
        entityData: JSON.stringify(input.entityData || {}),
        approvalType,
        priority: input.priority || 'normal',
        status: 'pending',
        affectedUserId: input.affectedUserId || null,
        affectedRobotId: input.affectedRobotId || null,
        slaHours,
        slaDeadline,
        escalationLevel: 0,
        requestedBy: input.requestedBy,
        requestReason: input.requestReason,
        blocksExecution: input.blocksExecution ?? config.blocking,
        rollbackPlan: input.rollbackPlan ? JSON.stringify(input.rollbackPlan) : null,
        // Create chain if multi-step
        chain:
          approvalType !== 'single_approval'
            ? {
                create: {
                  name: `${input.entityType} Approval Chain`,
                  requiredSteps: approverChain.length,
                  currentStepIndex: 0,
                  isSequential: true,
                },
              }
            : undefined,
        // Create steps
        steps: {
          create: approverChain.map((step, index) => ({
            stepOrder: index,
            approverRole: step.role,
            assignedTo: step.assignedTo || null,
            status: index === 0 ? 'awaiting' : 'pending',
          })),
        },
        // Create initial status history
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: 'pending',
            changedBy: input.requestedBy,
            reason: 'Approval request created',
            metadata: JSON.stringify({ entityType: input.entityType }),
          },
        },
      },
      include: this.includeRelations,
    });

    return dbApprovalRequestToDomain(request);
  }

  /**
   * Update approval request status
   */
  async updateStatus(
    id: string,
    status: ApprovalStatus,
    changedBy: string,
    reason?: string
  ): Promise<ApprovalRequest | null> {
    const current = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!current) return null;

    const request = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status,
        completedAt:
          status === 'approved' || status === 'rejected' || status === 'cancelled'
            ? new Date()
            : undefined,
        escalatedAt: status === 'escalated' ? new Date() : undefined,
        statusHistory: {
          create: {
            fromStatus: current.status,
            toStatus: status,
            changedBy,
            reason,
            metadata: JSON.stringify({}),
          },
        },
      },
      include: this.includeRelations,
    });

    return dbApprovalRequestToDomain(request);
  }

  /**
   * Escalate approval request
   */
  async escalate(id: string, escalatedBy: string): Promise<ApprovalRequest | null> {
    const current = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { status: true, escalationLevel: true },
    });

    if (!current) return null;

    const request = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'escalated',
        escalatedAt: new Date(),
        escalationLevel: current.escalationLevel + 1,
        statusHistory: {
          create: {
            fromStatus: current.status,
            toStatus: 'escalated',
            changedBy: escalatedBy,
            reason: 'SLA deadline exceeded - auto-escalated',
            metadata: JSON.stringify({ escalationLevel: current.escalationLevel + 1 }),
          },
        },
      },
      include: this.includeRelations,
    });

    return dbApprovalRequestToDomain(request);
  }

  /**
   * Count approvals by status
   */
  async countByStatus(): Promise<Record<ApprovalStatus, number>> {
    const counts = await prisma.approvalRequest.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const result: Record<string, number> = {
      pending: 0,
      in_progress: 0,
      approved: 0,
      rejected: 0,
      escalated: 0,
      expired: 0,
      cancelled: 0,
    };

    for (const item of counts) {
      result[item.status] = item._count.status;
    }

    return result as Record<ApprovalStatus, number>;
  }

  /**
   * Count overdue approvals
   */
  async countOverdue(): Promise<number> {
    return prisma.approvalRequest.count({
      where: {
        status: { in: ['pending', 'in_progress'] },
        slaDeadline: { lt: new Date() },
      },
    });
  }
}

// ============================================================================
// APPROVAL STEP REPOSITORY
// ============================================================================

export class ApprovalStepRepository {
  /**
   * Find step by ID
   */
  async findById(id: string): Promise<ApprovalStep | null> {
    const step = await prisma.approvalStep.findUnique({ where: { id } });
    return step ? dbApprovalStepToDomain(step) : null;
  }

  /**
   * Find current awaiting step for a request
   */
  async findAwaitingStep(approvalRequestId: string): Promise<ApprovalStep | null> {
    const step = await prisma.approvalStep.findFirst({
      where: { approvalRequestId, status: 'awaiting' },
      orderBy: { stepOrder: 'asc' },
    });
    return step ? dbApprovalStepToDomain(step) : null;
  }

  /**
   * Process approval decision
   */
  async processDecision(input: ProcessApprovalInput): Promise<ApprovalStep | null> {
    const step = await prisma.approvalStep.update({
      where: { id: input.stepId },
      data: {
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decision: input.decision,
        decidedBy: input.decidedBy,
        decisionNotes: input.decisionNotes || null,
        reviewDurationSec: input.reviewDurationSec || null,
        competenceVerified: input.competenceVerified || false,
        activeEngagement: (input.reviewDurationSec || 0) >= 30,
        decidedAt: new Date(),
      },
    });

    return dbApprovalStepToDomain(step);
  }

  /**
   * Advance to next step in chain
   */
  async advanceToNextStep(approvalRequestId: string): Promise<ApprovalStep | null> {
    const nextStep = await prisma.approvalStep.findFirst({
      where: { approvalRequestId, status: 'pending' },
      orderBy: { stepOrder: 'asc' },
    });

    if (!nextStep) return null;

    const updated = await prisma.approvalStep.update({
      where: { id: nextStep.id },
      data: { status: 'awaiting' },
    });

    // Update chain current index
    await prisma.approvalChain.updateMany({
      where: { approvalRequestId },
      data: { currentStepIndex: nextStep.stepOrder },
    });

    return dbApprovalStepToDomain(updated);
  }

  /**
   * Skip remaining steps (on rejection)
   */
  async skipRemainingSteps(approvalRequestId: string): Promise<void> {
    await prisma.approvalStep.updateMany({
      where: { approvalRequestId, status: 'pending' },
      data: { status: 'skipped' },
    });
  }

  /**
   * Check if all required steps are approved
   */
  async areAllStepsApproved(approvalRequestId: string): Promise<boolean> {
    const pendingOrAwaiting = await prisma.approvalStep.count({
      where: {
        approvalRequestId,
        status: { in: ['pending', 'awaiting'] },
      },
    });
    return pendingOrAwaiting === 0;
  }
}

// ============================================================================
// WORKER VIEWPOINT REPOSITORY
// ============================================================================

export class WorkerViewpointRepository {
  /**
   * Find by approval request ID
   */
  async findByRequestId(approvalRequestId: string): Promise<WorkerViewpoint | null> {
    const viewpoint = await prisma.workerViewpoint.findUnique({
      where: { approvalRequestId },
    });
    return viewpoint ? dbWorkerViewpointToDomain(viewpoint) : null;
  }

  /**
   * Create worker viewpoint
   */
  async create(input: SubmitWorkerViewpointInput): Promise<WorkerViewpoint> {
    const viewpoint = await prisma.workerViewpoint.create({
      data: {
        approvalRequestId: input.approvalRequestId,
        workerId: input.workerId,
        statement: input.statement,
        supportingDocs: JSON.stringify(input.supportingDocs || []),
        status: 'submitted',
      },
    });
    return dbWorkerViewpointToDomain(viewpoint);
  }

  /**
   * Acknowledge viewpoint
   */
  async acknowledge(id: string, acknowledgedBy: string): Promise<WorkerViewpoint | null> {
    const viewpoint = await prisma.workerViewpoint.update({
      where: { id },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy,
      },
    });
    return dbWorkerViewpointToDomain(viewpoint);
  }

  /**
   * Respond to viewpoint
   */
  async respond(
    id: string,
    response: string,
    respondedBy: string
  ): Promise<WorkerViewpoint | null> {
    const viewpoint = await prisma.workerViewpoint.update({
      where: { id },
      data: {
        status: 'addressed',
        response,
        respondedAt: new Date(),
        respondedBy,
      },
    });
    return dbWorkerViewpointToDomain(viewpoint);
  }

  /**
   * Count pending viewpoints
   */
  async countPending(): Promise<number> {
    return prisma.workerViewpoint.count({
      where: { status: { in: ['submitted', 'acknowledged'] } },
    });
  }
}

// ============================================================================
// DECISION CONTEST REPOSITORY
// ============================================================================

export class DecisionContestRepository {
  /**
   * Find by ID
   */
  async findById(id: string): Promise<DecisionContest | null> {
    const contest = await prisma.decisionContest.findUnique({ where: { id } });
    return contest ? dbDecisionContestToDomain(contest) : null;
  }

  /**
   * Find by decision ID
   */
  async findByDecisionId(decisionId: string): Promise<DecisionContest[]> {
    const contests = await prisma.decisionContest.findMany({
      where: { decisionId },
      orderBy: { submittedAt: 'desc' },
    });
    return contests.map(dbDecisionContestToDomain);
  }

  /**
   * Find all with filters
   */
  async findAll(
    filters: DecisionContestFilters = {},
    page = 1,
    limit = 20
  ): Promise<DecisionContestListResponse> {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }

    if (filters.workerId) {
      where.workerId = filters.workerId;
    }

    if (filters.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }

    const [contests, total] = await Promise.all([
      prisma.decisionContest.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { submittedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.decisionContest.count({ where }),
    ]);

    return {
      contests: contests.map(dbDecisionContestToDomain),
      total,
      page,
      limit,
    };
  }

  /**
   * Create contest
   */
  async create(input: ContestDecisionInput): Promise<DecisionContest> {
    const contest = await prisma.decisionContest.create({
      data: {
        decisionId: input.decisionId,
        workerId: input.workerId,
        contestReason: input.contestReason,
        contestEvidence: input.contestEvidence
          ? JSON.stringify(input.contestEvidence)
          : null,
        requestedOutcome: input.requestedOutcome || null,
        status: 'submitted',
        priority: 'normal',
      },
    });
    return dbDecisionContestToDomain(contest);
  }

  /**
   * Update contest status
   */
  async updateStatus(
    id: string,
    status: DecisionContestStatus,
    reviewNotes?: string,
    reviewOutcome?: string,
    processedBy?: string
  ): Promise<DecisionContest | null> {
    const contest = await prisma.decisionContest.update({
      where: { id },
      data: {
        status,
        reviewNotes,
        reviewOutcome,
        assignedTo: processedBy,
        reviewedAt: ['under_review'].includes(status) ? new Date() : undefined,
        completedAt: [
          'human_intervention_granted',
          'decision_overturned',
          'decision_upheld',
        ].includes(status)
          ? new Date()
          : undefined,
        humanInterventionProvided: status === 'human_intervention_granted',
      },
    });
    return dbDecisionContestToDomain(contest);
  }

  /**
   * Count active contests
   */
  async countActive(): Promise<number> {
    return prisma.decisionContest.count({
      where: { status: { in: ['submitted', 'under_review'] } },
    });
  }
}

// ============================================================================
// ESCALATION RULE REPOSITORY
// ============================================================================

export class EscalationRuleRepository {
  /**
   * Find active rules for entity type
   */
  async findActiveForEntityType(entityType: ApprovalEntityType): Promise<EscalationRule[]> {
    const rules = await prisma.escalationRule.findMany({
      where: { entityType, isActive: true },
      orderBy: { triggerThreshold: 'asc' },
    });
    return rules.map(dbEscalationRuleToDomain);
  }

  /**
   * Find all active rules
   */
  async findAllActive(): Promise<EscalationRule[]> {
    const rules = await prisma.escalationRule.findMany({
      where: { isActive: true },
      orderBy: [{ entityType: 'asc' }, { triggerThreshold: 'asc' }],
    });
    return rules.map(dbEscalationRuleToDomain);
  }
}

// ============================================================================
// SINGLETON EXPORTS
// ============================================================================

export const approvalRequestRepository = new ApprovalRequestRepository();
export const approvalStepRepository = new ApprovalStepRepository();
export const workerViewpointRepository = new WorkerViewpointRepository();
export const decisionContestRepository = new DecisionContestRepository();
export const escalationRuleRepository = new EscalationRuleRepository();

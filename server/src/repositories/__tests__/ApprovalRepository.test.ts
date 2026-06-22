/**
 * @file ApprovalRepository.test.ts
 * @description Unit tests for the Human Approval Workflow data-access layer
 *   (ApprovalRequestRepository, ApprovalStepRepository, WorkerViewpointRepository,
 *   DecisionContestRepository, EscalationRuleRepository). The prisma client (the
 *   I/O boundary) is mocked; the inline db<->domain mapper functions run for real
 *   so JSON parsing, date passthrough and nullable handling are exercised end-to-end.
 * @feature approvals
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ApprovalRequest as PrismaApprovalRequest,
  ApprovalChain as PrismaApprovalChain,
  ApprovalStep as PrismaApprovalStep,
  ApprovalStatusHistory as PrismaApprovalStatusHistory,
  WorkerViewpoint as PrismaWorkerViewpoint,
  DecisionContest as PrismaDecisionContest,
  EscalationRule as PrismaEscalationRule,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock prisma before importing the repository. Each model gets exactly the
// methods the repository invokes, as vi.fn()s.
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  approvalRequest: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  approvalStep: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  approvalChain: {
    updateMany: vi.fn(),
  },
  workerViewpoint: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  decisionContest: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  escalationRule: {
    findMany: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({ prisma: mockPrisma }));

import {
  ApprovalRequestRepository,
  ApprovalStepRepository,
  WorkerViewpointRepository,
  DecisionContestRepository,
  EscalationRuleRepository,
  approvalRequestRepository,
} from '../ApprovalRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — db-row shapes the inline mappers accept (Date columns, JSON
// strings, nullable columns as null).
// ---------------------------------------------------------------------------

const D = (s: string) => new Date(s);

function makeRequestRow(
  overrides: Partial<PrismaApprovalRequest> = {}
): PrismaApprovalRequest {
  return {
    id: 'req-1',
    requestNumber: 'APR-2026-00001',
    entityType: 'performance_evaluation',
    entityId: 'ent-1',
    entityData: JSON.stringify({ score: 5 }),
    approvalType: 'single_approval',
    priority: 'normal',
    status: 'pending',
    affectedUserId: null,
    affectedRobotId: null,
    slaHours: 48,
    slaDeadline: D('2026-06-25T00:00:00.000Z'),
    escalatedAt: null,
    escalationLevel: 0,
    requestedBy: 'user-req',
    requestReason: 'periodic review',
    blocksExecution: true,
    rollbackPlan: null,
    createdAt: D('2026-06-22T00:00:00.000Z'),
    updatedAt: D('2026-06-22T00:00:00.000Z'),
    completedAt: null,
    tenantId: null,
    ...overrides,
  } as PrismaApprovalRequest;
}

function makeChainRow(
  overrides: Partial<PrismaApprovalChain> = {}
): PrismaApprovalChain {
  return {
    id: 'chain-1',
    approvalRequestId: 'req-1',
    name: 'Chain',
    description: null,
    requiredSteps: 2,
    currentStepIndex: 0,
    isSequential: true,
    createdAt: D('2026-06-22T00:00:00.000Z'),
    updatedAt: D('2026-06-22T00:00:00.000Z'),
    ...overrides,
  } as PrismaApprovalChain;
}

function makeStepRow(
  overrides: Partial<PrismaApprovalStep> = {}
): PrismaApprovalStep {
  return {
    id: 'step-1',
    approvalRequestId: 'req-1',
    stepOrder: 0,
    approverRole: 'supervisor',
    assignedTo: null,
    status: 'awaiting',
    decision: null,
    decidedBy: null,
    decisionNotes: null,
    activeEngagement: false,
    reviewDurationSec: null,
    competenceVerified: false,
    createdAt: D('2026-06-22T00:00:00.000Z'),
    updatedAt: D('2026-06-22T00:00:00.000Z'),
    assignedAt: null,
    decidedAt: null,
    ...overrides,
  } as PrismaApprovalStep;
}

function makeStatusHistoryRow(
  overrides: Partial<PrismaApprovalStatusHistory> = {}
): PrismaApprovalStatusHistory {
  return {
    id: 'hist-1',
    approvalRequestId: 'req-1',
    fromStatus: null,
    toStatus: 'pending',
    changedBy: 'user-req',
    reason: 'created',
    metadata: JSON.stringify({ entityType: 'performance_evaluation' }),
    timestamp: D('2026-06-22T00:00:00.000Z'),
    ...overrides,
  } as PrismaApprovalStatusHistory;
}

function makeViewpointRow(
  overrides: Partial<PrismaWorkerViewpoint> = {}
): PrismaWorkerViewpoint {
  return {
    id: 'vp-1',
    approvalRequestId: 'req-1',
    workerId: 'worker-1',
    statement: 'I disagree',
    supportingDocs: JSON.stringify(['doc-1']),
    status: 'submitted',
    acknowledgedAt: null,
    acknowledgedBy: null,
    response: null,
    respondedAt: null,
    respondedBy: null,
    submittedAt: D('2026-06-22T00:00:00.000Z'),
    updatedAt: D('2026-06-22T00:00:00.000Z'),
    ...overrides,
  } as PrismaWorkerViewpoint;
}

function makeContestRow(
  overrides: Partial<PrismaDecisionContest> = {}
): PrismaDecisionContest {
  return {
    id: 'contest-1',
    approvalRequestId: null,
    decisionId: 'dec-1',
    workerId: 'worker-1',
    contestReason: 'unfair',
    contestEvidence: null,
    requestedOutcome: null,
    status: 'submitted',
    priority: 'normal',
    assignedTo: null,
    reviewNotes: null,
    reviewOutcome: null,
    humanInterventionProvided: false,
    newDecisionData: null,
    submittedAt: D('2026-06-22T00:00:00.000Z'),
    updatedAt: D('2026-06-22T00:00:00.000Z'),
    reviewedAt: null,
    completedAt: null,
    ...overrides,
  } as PrismaDecisionContest;
}

function makeEscalationRuleRow(
  overrides: Partial<PrismaEscalationRule> = {}
): PrismaEscalationRule {
  return {
    id: 'rule-1',
    name: 'Overdue rule',
    description: null,
    entityType: 'performance_evaluation',
    approvalType: null,
    triggerCondition: 'overdue',
    triggerThreshold: 2,
    escalateTo: 'manager',
    notifyOriginal: true,
    notifyAdmin: true,
    isActive: true,
    createdAt: D('2026-06-22T00:00:00.000Z'),
    updatedAt: D('2026-06-22T00:00:00.000Z'),
    ...overrides,
  } as PrismaEscalationRule;
}

const includeRelations = {
  chain: true,
  steps: { orderBy: { stepOrder: 'asc' } },
  workerViewpoint: true,
  decisionContest: true,
  statusHistory: { orderBy: { timestamp: 'desc' } },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// ApprovalRequestRepository
// ===========================================================================

describe('ApprovalRequestRepository', () => {
  let repo: ApprovalRequestRepository;
  beforeEach(() => {
    repo = new ApprovalRequestRepository();
  });

  describe('findById', () => {
    it('queries by id with relations and maps nested rows', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(
        makeRequestRow({
          chain: makeChainRow(),
          steps: [makeStepRow()],
          workerViewpoint: makeViewpointRow(),
          decisionContest: makeContestRow(),
          statusHistory: [makeStatusHistoryRow()],
        } as Partial<PrismaApprovalRequest>)
      );

      const result = await repo.findById('req-1');

      expect(mockPrisma.approvalRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        include: includeRelations,
      });
      expect(result?.id).toBe('req-1');
      // entityData JSON parsed by the real mapper
      expect(result?.entityData).toEqual({ score: 5 });
      expect(result?.chain?.id).toBe('chain-1');
      expect(result?.steps?.[0].id).toBe('step-1');
      expect(result?.workerViewpoint?.supportingDocs).toEqual(['doc-1']);
      expect(result?.decisionContest?.decisionId).toBe('dec-1');
      expect(result?.statusHistory?.[0].metadata).toEqual({
        entityType: 'performance_evaluation',
      });
      expect(result?.slaDeadline).toEqual(D('2026-06-25T00:00:00.000Z'));
    });

    it('returns null when not found', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(null);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });

    it('maps rollbackPlan JSON when present', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(
        makeRequestRow({ rollbackPlan: JSON.stringify({ description: 'undo' }) })
      );
      const result = await repo.findById('req-1');
      expect(result?.rollbackPlan).toEqual({ description: 'undo' });
    });
  });

  describe('findByRequestNumber', () => {
    it('queries by requestNumber with relations', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(makeRequestRow());
      const result = await repo.findByRequestNumber('APR-2026-00001');
      expect(mockPrisma.approvalRequest.findUnique).toHaveBeenCalledWith({
        where: { requestNumber: 'APR-2026-00001' },
        include: includeRelations,
      });
      expect(result?.requestNumber).toBe('APR-2026-00001');
    });

    it('returns null when not found', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(null);
      expect(await repo.findByRequestNumber('nope')).toBeNull();
    });
  });

  describe('findByEntity', () => {
    it('filters by entityType+entityId ordered by createdAt desc', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([makeRequestRow()]);
      const result = await repo.findByEntity('performance_evaluation', 'ent-1');
      expect(mockPrisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: { entityType: 'performance_evaluation', entityId: 'ent-1' },
        include: includeRelations,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });

    it('returns empty array when none', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);
      expect(await repo.findByEntity('shift_change', 'x')).toEqual([]);
    });
  });

  describe('findPendingForUser', () => {
    it('builds the assigned-step where clause and priority ordering', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([makeRequestRow()]);
      await repo.findPendingForUser('user-42');
      expect(mockPrisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'in_progress'] },
          steps: { some: { assignedTo: 'user-42', status: 'awaiting' } },
        },
        include: includeRelations,
        orderBy: [{ priority: 'desc' }, { slaDeadline: 'asc' }],
      });
    });
  });

  describe('findPendingByRole', () => {
    it('filters by role with assignedTo null', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);
      await repo.findPendingByRole('manager');
      expect(mockPrisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'in_progress'] },
          steps: {
            some: { approverRole: 'manager', status: 'awaiting', assignedTo: null },
          },
        },
        include: includeRelations,
        orderBy: [{ priority: 'desc' }, { slaDeadline: 'asc' }],
      });
    });
  });

  describe('findOverdue', () => {
    it('queries slaDeadline < now for active statuses', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([makeRequestRow()]);
      const before = Date.now();
      await repo.findOverdue();
      const call = mockPrisma.approvalRequest.findMany.mock.calls[0][0] as {
        where: { status: unknown; slaDeadline: { lt: Date } };
        orderBy: unknown;
      };
      expect(call.where.status).toEqual({ in: ['pending', 'in_progress'] });
      expect(call.where.slaDeadline.lt).toBeInstanceOf(Date);
      expect(call.where.slaDeadline.lt.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.orderBy).toEqual({ slaDeadline: 'asc' });
    });
  });

  describe('findNearingDeadline', () => {
    it('builds a gt now / lt threshold window', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);
      const before = Date.now();
      await repo.findNearingDeadline(5);
      const call = mockPrisma.approvalRequest.findMany.mock.calls[0][0] as {
        where: { slaDeadline: { gt: Date; lt: Date } };
      };
      const { gt, lt } = call.where.slaDeadline;
      expect(gt).toBeInstanceOf(Date);
      expect(lt).toBeInstanceOf(Date);
      // threshold ~ now + 5h
      expect(lt.getTime() - gt.getTime()).toBeCloseTo(5 * 60 * 60 * 1000, -3);
      expect(gt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('findAll', () => {
    it('uses defaults (empty where, page 1, limit 20) and returns paginated response', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([makeRequestRow()]);
      mockPrisma.approvalRequest.count.mockResolvedValue(1);

      const result = await repo.findAll();

      expect(mockPrisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: {},
        include: includeRelations,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(mockPrisma.approvalRequest.count).toHaveBeenCalledWith({ where: {} });
      expect(result).toEqual({
        requests: result.requests,
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(result.requests).toHaveLength(1);
    });

    it('translates array filters to `in` clauses and scalar filters directly, with pagination', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);
      mockPrisma.approvalRequest.count.mockResolvedValue(0);

      await repo.findAll(
        {
          status: ['pending', 'approved'],
          entityType: 'shift_change',
          priority: ['high'],
          affectedUserId: 'u-1',
          requestedBy: 'u-2',
          fromDate: D('2026-01-01T00:00:00.000Z'),
          toDate: D('2026-02-01T00:00:00.000Z'),
        },
        3,
        10
      );

      const call = mockPrisma.approvalRequest.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        skip: number;
        take: number;
      };
      expect(call.where).toEqual({
        status: { in: ['pending', 'approved'] },
        entityType: 'shift_change',
        priority: { in: ['high'] },
        affectedUserId: 'u-1',
        requestedBy: 'u-2',
        createdAt: {
          gte: D('2026-01-01T00:00:00.000Z'),
          lte: D('2026-02-01T00:00:00.000Z'),
        },
      });
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
    });

    it('overdue filter overrides status to active set with slaDeadline < now', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);
      mockPrisma.approvalRequest.count.mockResolvedValue(0);

      await repo.findAll({ overdue: true });

      const call = mockPrisma.approvalRequest.findMany.mock.calls[0][0] as {
        where: { status: unknown; slaDeadline: { lt: Date } };
      };
      expect(call.where.status).toEqual({ in: ['pending', 'in_progress'] });
      expect(call.where.slaDeadline.lt).toBeInstanceOf(Date);
    });
  });

  describe('create', () => {
    it('generates request number, computes SLA, builds single_approval data (no chain) and maps result', async () => {
      // generateRequestNumber -> findFirst
      mockPrisma.approvalRequest.findFirst.mockResolvedValue(null);
      const created = makeRequestRow({
        requestNumber: 'APR-' + new Date().getFullYear() + '-00001',
        steps: [makeStepRow()],
        statusHistory: [makeStatusHistoryRow()],
      } as Partial<PrismaApprovalRequest>);
      mockPrisma.approvalRequest.create.mockResolvedValue(created);

      const result = await repo.create({
        entityType: 'performance_evaluation',
        entityId: 'ent-1',
        entityData: { score: 5 },
        requestedBy: 'user-req',
        requestReason: 'periodic review',
      });

      expect(mockPrisma.approvalRequest.findFirst).toHaveBeenCalledWith({
        where: { requestNumber: { startsWith: `APR-${new Date().getFullYear()}-` } },
        orderBy: { requestNumber: 'desc' },
        select: { requestNumber: true },
      });

      const data = mockPrisma.approvalRequest.create.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data.requestNumber).toBe(`APR-${new Date().getFullYear()}-00001`);
      expect(data.entityType).toBe('performance_evaluation');
      expect(data.entityData).toBe(JSON.stringify({ score: 5 }));
      // single_approval default from APPROVAL_TYPE_MAP
      expect(data.approvalType).toBe('single_approval');
      expect(data.priority).toBe('normal');
      expect(data.status).toBe('pending');
      expect(data.slaHours).toBe(48); // SLA_HOURS.performance_evaluation
      expect(data.slaDeadline).toBeInstanceOf(Date);
      expect(data.blocksExecution).toBe(true); // config.blocking
      expect(data.rollbackPlan).toBeNull();
      // No chain for single_approval
      expect(data.chain).toBeUndefined();
      // One step (supervisor) created, first awaiting
      const steps = (data.steps as { create: Array<Record<string, unknown>> }).create;
      expect(steps).toEqual([
        { stepOrder: 0, approverRole: 'supervisor', assignedTo: null, status: 'awaiting' },
      ]);
      // initial status history
      const hist = (data.statusHistory as { create: Record<string, unknown> }).create;
      expect(hist.fromStatus).toBeNull();
      expect(hist.toStatus).toBe('pending');
      expect(hist.changedBy).toBe('user-req');

      expect(result.requestNumber).toBe(`APR-${new Date().getFullYear()}-00001`);
    });

    it('increments request number from the last one and creates a chain for chain_approval', async () => {
      mockPrisma.approvalRequest.findFirst.mockResolvedValue({
        requestNumber: `APR-${new Date().getFullYear()}-00041`,
      });
      mockPrisma.approvalRequest.create.mockResolvedValue(makeRequestRow());

      await repo.create({
        entityType: 'software_update',
        entityId: 'sw-1',
        requestedBy: 'user-req',
        requestReason: 'deploy',
      });

      const data = mockPrisma.approvalRequest.create.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data.requestNumber).toBe(`APR-${new Date().getFullYear()}-00042`);
      expect(data.approvalType).toBe('chain_approval');
      expect(data.slaHours).toBe(168);
      // chain created with requiredSteps = 3 roles
      const chain = (data.chain as { create: Record<string, unknown> }).create;
      expect(chain.requiredSteps).toBe(3);
      expect(chain.isSequential).toBe(true);
      const steps = (data.steps as { create: Array<Record<string, unknown>> }).create;
      expect(steps).toHaveLength(3);
      expect(steps[0].status).toBe('awaiting');
      expect(steps[1].status).toBe('pending');
    });

    it('honors explicit approverChain and rollbackPlan', async () => {
      mockPrisma.approvalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.approvalRequest.create.mockResolvedValue(makeRequestRow());

      await repo.create({
        entityType: 'safety_parameter_modification',
        entityId: 'safe-1',
        requestedBy: 'user-req',
        requestReason: 'tune',
        approverChain: [{ role: 'safety_officer', assignedTo: 'u-9' }],
        rollbackPlan: { description: 'revert' } as never,
        priority: 'critical',
      });

      const data = mockPrisma.approvalRequest.create.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data.priority).toBe('critical');
      expect(data.rollbackPlan).toBe(JSON.stringify({ description: 'revert' }));
      const steps = (data.steps as { create: Array<Record<string, unknown>> }).create;
      expect(steps).toEqual([
        { stepOrder: 0, approverRole: 'safety_officer', assignedTo: 'u-9', status: 'awaiting' },
      ]);
    });
  });

  describe('updateStatus', () => {
    it('returns null when the request does not exist', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(null);
      const result = await repo.updateStatus('missing', 'approved', 'u-1');
      expect(result).toBeNull();
      expect(mockPrisma.approvalRequest.update).not.toHaveBeenCalled();
    });

    it('sets completedAt for terminal statuses and writes status history', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({ status: 'pending' });
      mockPrisma.approvalRequest.update.mockResolvedValue(
        makeRequestRow({ status: 'approved', completedAt: D('2026-06-23T00:00:00.000Z') })
      );

      const result = await repo.updateStatus('req-1', 'approved', 'u-1', 'looks good');

      const arg = mockPrisma.approvalRequest.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'req-1' });
      expect(arg.data.status).toBe('approved');
      expect(arg.data.completedAt).toBeInstanceOf(Date);
      expect(arg.data.escalatedAt).toBeUndefined();
      const hist = (arg.data.statusHistory as { create: Record<string, unknown> }).create;
      expect(hist.fromStatus).toBe('pending');
      expect(hist.toStatus).toBe('approved');
      expect(hist.changedBy).toBe('u-1');
      expect(hist.reason).toBe('looks good');
      expect(result?.status).toBe('approved');
    });

    it('sets escalatedAt (not completedAt) for escalated status', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({ status: 'pending' });
      mockPrisma.approvalRequest.update.mockResolvedValue(makeRequestRow({ status: 'escalated' }));

      await repo.updateStatus('req-1', 'escalated', 'u-1');

      const data = mockPrisma.approvalRequest.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.completedAt).toBeUndefined();
      expect(data.escalatedAt).toBeInstanceOf(Date);
    });
  });

  describe('escalate', () => {
    it('returns null when the request does not exist', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(null);
      expect(await repo.escalate('missing', 'u-1')).toBeNull();
      expect(mockPrisma.approvalRequest.update).not.toHaveBeenCalled();
    });

    it('increments escalationLevel and records history', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        status: 'pending',
        escalationLevel: 2,
      });
      mockPrisma.approvalRequest.update.mockResolvedValue(
        makeRequestRow({ status: 'escalated', escalationLevel: 3 })
      );

      const result = await repo.escalate('req-1', 'u-1');

      const data = mockPrisma.approvalRequest.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.status).toBe('escalated');
      expect(data.escalationLevel).toBe(3);
      expect(data.escalatedAt).toBeInstanceOf(Date);
      const hist = (data.statusHistory as { create: Record<string, unknown> }).create;
      expect(hist.fromStatus).toBe('pending');
      expect(hist.toStatus).toBe('escalated');
      expect(hist.metadata).toBe(JSON.stringify({ escalationLevel: 3 }));
      expect(result?.escalationLevel).toBe(3);
    });
  });

  describe('countByStatus', () => {
    it('seeds all statuses to 0 and fills in groupBy counts', async () => {
      mockPrisma.approvalRequest.groupBy.mockResolvedValue([
        { status: 'pending', _count: { status: 4 } },
        { status: 'approved', _count: { status: 7 } },
      ]);

      const result = await repo.countByStatus();

      expect(mockPrisma.approvalRequest.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        _count: { status: true },
      });
      expect(result).toEqual({
        pending: 4,
        in_progress: 0,
        approved: 7,
        rejected: 0,
        escalated: 0,
        expired: 0,
        cancelled: 0,
      });
    });
  });

  describe('countOverdue', () => {
    it('counts active requests past the SLA deadline', async () => {
      mockPrisma.approvalRequest.count.mockResolvedValue(9);
      const result = await repo.countOverdue();
      const arg = mockPrisma.approvalRequest.count.mock.calls[0][0] as {
        where: { status: unknown; slaDeadline: { lt: Date } };
      };
      expect(arg.where.status).toEqual({ in: ['pending', 'in_progress'] });
      expect(arg.where.slaDeadline.lt).toBeInstanceOf(Date);
      expect(result).toBe(9);
    });
  });

  it('exposes a shared singleton wired to the mocked prisma', async () => {
    mockPrisma.approvalRequest.findUnique.mockResolvedValue(null);
    expect(await approvalRequestRepository.findById('x')).toBeNull();
  });
});

// ===========================================================================
// ApprovalStepRepository
// ===========================================================================

describe('ApprovalStepRepository', () => {
  let repo: ApprovalStepRepository;
  beforeEach(() => {
    repo = new ApprovalStepRepository();
  });

  describe('findById', () => {
    it('queries by id and maps', async () => {
      mockPrisma.approvalStep.findUnique.mockResolvedValue(makeStepRow({ id: 's-2' }));
      const result = await repo.findById('s-2');
      expect(mockPrisma.approvalStep.findUnique).toHaveBeenCalledWith({ where: { id: 's-2' } });
      expect(result?.id).toBe('s-2');
    });

    it('returns null when not found', async () => {
      mockPrisma.approvalStep.findUnique.mockResolvedValue(null);
      expect(await repo.findById('x')).toBeNull();
    });
  });

  describe('findAwaitingStep', () => {
    it('finds the first awaiting step ordered by stepOrder', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue(makeStepRow());
      const result = await repo.findAwaitingStep('req-1');
      expect(mockPrisma.approvalStep.findFirst).toHaveBeenCalledWith({
        where: { approvalRequestId: 'req-1', status: 'awaiting' },
        orderBy: { stepOrder: 'asc' },
      });
      expect(result?.id).toBe('step-1');
    });

    it('returns null when no awaiting step', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue(null);
      expect(await repo.findAwaitingStep('req-1')).toBeNull();
    });
  });

  describe('processDecision', () => {
    it('maps approve decision and derives activeEngagement from review duration', async () => {
      mockPrisma.approvalStep.update.mockResolvedValue(
        makeStepRow({ status: 'approved', decision: 'approve' })
      );
      await repo.processDecision({
        approvalRequestId: 'req-1',
        stepId: 'step-1',
        decision: 'approve',
        decidedBy: 'u-1',
        decisionNotes: 'ok',
        reviewDurationSec: 45,
        competenceVerified: true,
      });
      const arg = mockPrisma.approvalStep.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'step-1' });
      expect(arg.data.status).toBe('approved');
      expect(arg.data.decision).toBe('approve');
      expect(arg.data.decisionNotes).toBe('ok');
      expect(arg.data.reviewDurationSec).toBe(45);
      expect(arg.data.competenceVerified).toBe(true);
      expect(arg.data.activeEngagement).toBe(true); // >= 30
      expect(arg.data.decidedAt).toBeInstanceOf(Date);
    });

    it('maps reject decision and flags low engagement when fast / no duration', async () => {
      mockPrisma.approvalStep.update.mockResolvedValue(
        makeStepRow({ status: 'rejected', decision: 'reject' })
      );
      await repo.processDecision({
        approvalRequestId: 'req-1',
        stepId: 'step-1',
        decision: 'reject',
        decidedBy: 'u-1',
      });
      const data = mockPrisma.approvalStep.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.status).toBe('rejected');
      expect(data.decisionNotes).toBeNull();
      expect(data.reviewDurationSec).toBeNull();
      expect(data.competenceVerified).toBe(false);
      expect(data.activeEngagement).toBe(false); // 0 < 30
    });
  });

  describe('advanceToNextStep', () => {
    it('returns null when there is no pending step', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue(null);
      const result = await repo.advanceToNextStep('req-1');
      expect(result).toBeNull();
      expect(mockPrisma.approvalStep.update).not.toHaveBeenCalled();
      expect(mockPrisma.approvalChain.updateMany).not.toHaveBeenCalled();
    });

    it('activates the next pending step and syncs the chain index', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue(
        makeStepRow({ id: 'step-2', stepOrder: 1, status: 'pending' })
      );
      mockPrisma.approvalStep.update.mockResolvedValue(
        makeStepRow({ id: 'step-2', stepOrder: 1, status: 'awaiting' })
      );
      mockPrisma.approvalChain.updateMany.mockResolvedValue({ count: 1 });

      const result = await repo.advanceToNextStep('req-1');

      expect(mockPrisma.approvalStep.findFirst).toHaveBeenCalledWith({
        where: { approvalRequestId: 'req-1', status: 'pending' },
        orderBy: { stepOrder: 'asc' },
      });
      expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith({
        where: { id: 'step-2' },
        data: { status: 'awaiting' },
      });
      expect(mockPrisma.approvalChain.updateMany).toHaveBeenCalledWith({
        where: { approvalRequestId: 'req-1' },
        data: { currentStepIndex: 1 },
      });
      expect(result?.status).toBe('awaiting');
    });
  });

  describe('skipRemainingSteps', () => {
    it('marks all pending steps as skipped', async () => {
      mockPrisma.approvalStep.updateMany.mockResolvedValue({ count: 2 });
      await repo.skipRemainingSteps('req-1');
      expect(mockPrisma.approvalStep.updateMany).toHaveBeenCalledWith({
        where: { approvalRequestId: 'req-1', status: 'pending' },
        data: { status: 'skipped' },
      });
    });
  });

  describe('areAllStepsApproved', () => {
    it('returns true when no pending/awaiting steps remain', async () => {
      mockPrisma.approvalStep.count.mockResolvedValue(0);
      const result = await repo.areAllStepsApproved('req-1');
      expect(mockPrisma.approvalStep.count).toHaveBeenCalledWith({
        where: { approvalRequestId: 'req-1', status: { in: ['pending', 'awaiting'] } },
      });
      expect(result).toBe(true);
    });

    it('returns false when steps are still outstanding', async () => {
      mockPrisma.approvalStep.count.mockResolvedValue(2);
      expect(await repo.areAllStepsApproved('req-1')).toBe(false);
    });
  });
});

// ===========================================================================
// WorkerViewpointRepository
// ===========================================================================

describe('WorkerViewpointRepository', () => {
  let repo: WorkerViewpointRepository;
  beforeEach(() => {
    repo = new WorkerViewpointRepository();
  });

  describe('findByRequestId', () => {
    it('queries by approvalRequestId and parses supportingDocs', async () => {
      mockPrisma.workerViewpoint.findUnique.mockResolvedValue(
        makeViewpointRow({ supportingDocs: JSON.stringify(['a', 'b']) })
      );
      const result = await repo.findByRequestId('req-1');
      expect(mockPrisma.workerViewpoint.findUnique).toHaveBeenCalledWith({
        where: { approvalRequestId: 'req-1' },
      });
      expect(result?.supportingDocs).toEqual(['a', 'b']);
    });

    it('returns null when not found', async () => {
      mockPrisma.workerViewpoint.findUnique.mockResolvedValue(null);
      expect(await repo.findByRequestId('req-1')).toBeNull();
    });
  });

  describe('create', () => {
    it('serializes supportingDocs and defaults status to submitted', async () => {
      mockPrisma.workerViewpoint.create.mockResolvedValue(makeViewpointRow());
      await repo.create({
        approvalRequestId: 'req-1',
        workerId: 'worker-1',
        statement: 'I disagree',
        supportingDocs: ['doc-1'],
      });
      const data = mockPrisma.workerViewpoint.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.approvalRequestId).toBe('req-1');
      expect(data.supportingDocs).toBe(JSON.stringify(['doc-1']));
      expect(data.status).toBe('submitted');
    });

    it('defaults supportingDocs to empty array when omitted', async () => {
      mockPrisma.workerViewpoint.create.mockResolvedValue(
        makeViewpointRow({ supportingDocs: '[]' })
      );
      await repo.create({
        approvalRequestId: 'req-1',
        workerId: 'worker-1',
        statement: 'x',
      });
      const data = mockPrisma.workerViewpoint.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.supportingDocs).toBe('[]');
    });
  });

  describe('acknowledge', () => {
    it('sets acknowledged status, timestamp and actor', async () => {
      mockPrisma.workerViewpoint.update.mockResolvedValue(
        makeViewpointRow({ status: 'acknowledged' })
      );
      await repo.acknowledge('vp-1', 'mgr-1');
      const arg = mockPrisma.workerViewpoint.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'vp-1' });
      expect(arg.data.status).toBe('acknowledged');
      expect(arg.data.acknowledgedBy).toBe('mgr-1');
      expect(arg.data.acknowledgedAt).toBeInstanceOf(Date);
    });
  });

  describe('respond', () => {
    it('sets addressed status with response payload', async () => {
      mockPrisma.workerViewpoint.update.mockResolvedValue(
        makeViewpointRow({ status: 'addressed', response: 'noted' })
      );
      const result = await repo.respond('vp-1', 'noted', 'mgr-1');
      const data = mockPrisma.workerViewpoint.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.status).toBe('addressed');
      expect(data.response).toBe('noted');
      expect(data.respondedBy).toBe('mgr-1');
      expect(data.respondedAt).toBeInstanceOf(Date);
      expect(result?.response).toBe('noted');
    });
  });

  describe('countPending', () => {
    it('counts submitted/acknowledged viewpoints', async () => {
      mockPrisma.workerViewpoint.count.mockResolvedValue(3);
      const result = await repo.countPending();
      expect(mockPrisma.workerViewpoint.count).toHaveBeenCalledWith({
        where: { status: { in: ['submitted', 'acknowledged'] } },
      });
      expect(result).toBe(3);
    });
  });
});

// ===========================================================================
// DecisionContestRepository
// ===========================================================================

describe('DecisionContestRepository', () => {
  let repo: DecisionContestRepository;
  beforeEach(() => {
    repo = new DecisionContestRepository();
  });

  describe('findById', () => {
    it('queries by id and maps nullable JSON columns to null', async () => {
      mockPrisma.decisionContest.findUnique.mockResolvedValue(makeContestRow());
      const result = await repo.findById('contest-1');
      expect(mockPrisma.decisionContest.findUnique).toHaveBeenCalledWith({
        where: { id: 'contest-1' },
      });
      expect(result?.contestEvidence).toBeNull();
      expect(result?.newDecisionData).toBeNull();
    });

    it('parses contestEvidence/newDecisionData JSON when present', async () => {
      mockPrisma.decisionContest.findUnique.mockResolvedValue(
        makeContestRow({
          contestEvidence: JSON.stringify({ k: 1 }),
          newDecisionData: JSON.stringify({ result: 'overturned' }),
        })
      );
      const result = await repo.findById('contest-1');
      expect(result?.contestEvidence).toEqual({ k: 1 });
      expect(result?.newDecisionData).toEqual({ result: 'overturned' });
    });

    it('returns null when not found', async () => {
      mockPrisma.decisionContest.findUnique.mockResolvedValue(null);
      expect(await repo.findById('x')).toBeNull();
    });
  });

  describe('findByDecisionId', () => {
    it('filters by decisionId ordered by submittedAt desc', async () => {
      mockPrisma.decisionContest.findMany.mockResolvedValue([makeContestRow()]);
      const result = await repo.findByDecisionId('dec-1');
      expect(mockPrisma.decisionContest.findMany).toHaveBeenCalledWith({
        where: { decisionId: 'dec-1' },
        orderBy: { submittedAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('uses defaults and returns paginated response', async () => {
      mockPrisma.decisionContest.findMany.mockResolvedValue([makeContestRow()]);
      mockPrisma.decisionContest.count.mockResolvedValue(1);
      const result = await repo.findAll();
      expect(mockPrisma.decisionContest.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ priority: 'desc' }, { submittedAt: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        contests: result.contests,
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('translates array status to `in`, scalar workerId/assignedTo directly, and paginates', async () => {
      mockPrisma.decisionContest.findMany.mockResolvedValue([]);
      mockPrisma.decisionContest.count.mockResolvedValue(0);
      await repo.findAll(
        { status: ['submitted', 'under_review'], workerId: 'w-1', assignedTo: 'a-1' },
        2,
        5
      );
      const call = mockPrisma.decisionContest.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        skip: number;
        take: number;
      };
      expect(call.where).toEqual({
        status: { in: ['submitted', 'under_review'] },
        workerId: 'w-1',
        assignedTo: 'a-1',
      });
      expect(call.skip).toBe(5);
      expect(call.take).toBe(5);
    });
  });

  describe('create', () => {
    it('serializes evidence and defaults status/priority', async () => {
      mockPrisma.decisionContest.create.mockResolvedValue(makeContestRow());
      await repo.create({
        decisionId: 'dec-1',
        workerId: 'worker-1',
        contestReason: 'unfair',
        contestEvidence: { proof: true },
        requestedOutcome: 'reinstate',
      });
      const data = mockPrisma.decisionContest.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.decisionId).toBe('dec-1');
      expect(data.contestEvidence).toBe(JSON.stringify({ proof: true }));
      expect(data.requestedOutcome).toBe('reinstate');
      expect(data.status).toBe('submitted');
      expect(data.priority).toBe('normal');
    });

    it('stores null evidence/outcome when omitted', async () => {
      mockPrisma.decisionContest.create.mockResolvedValue(makeContestRow());
      await repo.create({ decisionId: 'dec-1', workerId: 'w', contestReason: 'r' });
      const data = mockPrisma.decisionContest.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.contestEvidence).toBeNull();
      expect(data.requestedOutcome).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('sets reviewedAt for under_review and not completedAt', async () => {
      mockPrisma.decisionContest.update.mockResolvedValue(
        makeContestRow({ status: 'under_review' })
      );
      await repo.updateStatus('contest-1', 'under_review', 'note', undefined, 'admin-1');
      const arg = mockPrisma.decisionContest.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'contest-1' });
      expect(arg.data.status).toBe('under_review');
      expect(arg.data.reviewNotes).toBe('note');
      expect(arg.data.assignedTo).toBe('admin-1');
      expect(arg.data.reviewedAt).toBeInstanceOf(Date);
      expect(arg.data.completedAt).toBeUndefined();
      expect(arg.data.humanInterventionProvided).toBe(false);
    });

    it('sets completedAt and humanInterventionProvided for human_intervention_granted', async () => {
      mockPrisma.decisionContest.update.mockResolvedValue(
        makeContestRow({ status: 'human_intervention_granted', humanInterventionProvided: true })
      );
      await repo.updateStatus('contest-1', 'human_intervention_granted');
      const data = mockPrisma.decisionContest.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(data.reviewedAt).toBeUndefined();
      expect(data.humanInterventionProvided).toBe(true);
    });
  });

  describe('countActive', () => {
    it('counts submitted/under_review contests', async () => {
      mockPrisma.decisionContest.count.mockResolvedValue(5);
      const result = await repo.countActive();
      expect(mockPrisma.decisionContest.count).toHaveBeenCalledWith({
        where: { status: { in: ['submitted', 'under_review'] } },
      });
      expect(result).toBe(5);
    });
  });
});

// ===========================================================================
// EscalationRuleRepository
// ===========================================================================

describe('EscalationRuleRepository', () => {
  let repo: EscalationRuleRepository;
  beforeEach(() => {
    repo = new EscalationRuleRepository();
  });

  describe('findActiveForEntityType', () => {
    it('filters by entityType + isActive ordered by threshold', async () => {
      mockPrisma.escalationRule.findMany.mockResolvedValue([makeEscalationRuleRow()]);
      const result = await repo.findActiveForEntityType('performance_evaluation');
      expect(mockPrisma.escalationRule.findMany).toHaveBeenCalledWith({
        where: { entityType: 'performance_evaluation', isActive: true },
        orderBy: { triggerThreshold: 'asc' },
      });
      expect(result[0].triggerCondition).toBe('overdue');
      expect(result[0].escalateTo).toBe('manager');
    });

    it('returns empty array when no active rules', async () => {
      mockPrisma.escalationRule.findMany.mockResolvedValue([]);
      expect(await repo.findActiveForEntityType('shift_change')).toEqual([]);
    });
  });

  describe('findAllActive', () => {
    it('filters by isActive ordered by entityType then threshold', async () => {
      mockPrisma.escalationRule.findMany.mockResolvedValue([makeEscalationRuleRow()]);
      await repo.findAllActive();
      expect(mockPrisma.escalationRule.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ entityType: 'asc' }, { triggerThreshold: 'asc' }],
      });
    });
  });
});

/**
 * @file ApprovalWorkflowService.test.ts
 * @description Unit tests for ApprovalWorkflowService — approval request lifecycle, worker
 *   rights (viewpoints/contests), SLA/escalation, meaningful oversight metrics, and events.
 *   All repositories and the alert service are mocked; no DB/network/filesystem is touched.
 * @feature approvals
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ApprovalRequest,
  ApprovalStep,
  WorkerViewpoint,
  DecisionContest,
  ApprovalRequestListResponse,
} from '../../types/approval.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (repository singletons + alert service)
// ---------------------------------------------------------------------------

vi.mock('../../repositories/ApprovalRepository.js', () => ({
  approvalRequestRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByRequestNumber: vi.fn(),
    findAll: vi.fn(),
    findPendingForUser: vi.fn(),
    findPendingByRole: vi.fn(),
    findOverdue: vi.fn(),
    findNearingDeadline: vi.fn(),
    updateStatus: vi.fn(),
    escalate: vi.fn(),
    countByStatus: vi.fn(),
    countOverdue: vi.fn(),
  },
  approvalStepRepository: {
    findById: vi.fn(),
    processDecision: vi.fn(),
    areAllStepsApproved: vi.fn(),
    advanceToNextStep: vi.fn(),
    skipRemainingSteps: vi.fn(),
  },
  workerViewpointRepository: {
    findByRequestId: vi.fn(),
    create: vi.fn(),
    acknowledge: vi.fn(),
    respond: vi.fn(),
    countPending: vi.fn(),
  },
  decisionContestRepository: {
    create: vi.fn(),
    updateStatus: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    countActive: vi.fn(),
  },
  escalationRuleRepository: {
    findActiveForEntityType: vi.fn(),
  },
}));

vi.mock('../AlertService.js', () => ({
  alertService: {
    createAlert: vi.fn(),
  },
}));

import { ApprovalWorkflowService } from '../ApprovalWorkflowService.js';
import {
  approvalRequestRepository,
  approvalStepRepository,
  workerViewpointRepository,
  decisionContestRepository,
  escalationRuleRepository,
} from '../../repositories/ApprovalRepository.js';
import { alertService } from '../AlertService.js';
import {
  MINIMUM_REVIEW_SECONDS,
  RUBBER_STAMP_WARNING_SECONDS,
} from '../../types/approval.types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    id: 'step1',
    approvalRequestId: 'req1',
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
    createdAt: new Date(),
    updatedAt: new Date(),
    assignedAt: null,
    decidedAt: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req1',
    requestNumber: 'AR-0001',
    entityType: 'performance_evaluation',
    entityId: 'e1',
    entityData: {},
    approvalType: 'single_approval',
    priority: 'normal',
    status: 'pending',
    affectedUserId: null,
    affectedRobotId: null,
    slaHours: 48,
    slaDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
    escalatedAt: null,
    escalationLevel: 0,
    requestedBy: 'u1',
    requestReason: 'review',
    blocksExecution: true,
    rollbackPlan: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    steps: [makeStep()],
    ...overrides,
  };
}

function makeViewpoint(overrides: Partial<WorkerViewpoint> = {}): WorkerViewpoint {
  return {
    id: 'vp1',
    approvalRequestId: 'req1',
    workerId: 'w1',
    statement: 'I disagree',
    supportingDocs: [],
    status: 'submitted',
    acknowledgedAt: null,
    acknowledgedBy: null,
    response: null,
    respondedAt: null,
    respondedBy: null,
    submittedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeContest(overrides: Partial<DecisionContest> = {}): DecisionContest {
  return {
    id: 'c1',
    approvalRequestId: null,
    decisionId: 'd1',
    workerId: 'w1',
    contestReason: 'unfair',
    contestEvidence: null,
    requestedOutcome: null,
    status: 'submitted',
    priority: 'high',
    assignedTo: null,
    reviewNotes: null,
    reviewOutcome: null,
    humanInterventionProvided: false,
    newDecisionData: null,
    submittedAt: new Date(),
    updatedAt: new Date(),
    reviewedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeListResponse(
  requests: ApprovalRequest[],
  total?: number
): ApprovalRequestListResponse {
  return { requests, total: total ?? requests.length, page: 1, limit: 1000 };
}

// Each test uses a fresh service instance to avoid shared event-callback state.
let service: ApprovalWorkflowService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new ApprovalWorkflowService();
  vi.mocked(alertService.createAlert).mockResolvedValue({} as never);
});

// ===========================================================================
// createApprovalRequest
// ===========================================================================

describe('createApprovalRequest', () => {
  it('creates the request, raises an alert for the first step, and emits an event', async () => {
    const request = makeRequest({ priority: 'normal' });
    vi.mocked(approvalRequestRepository.create).mockResolvedValue(request);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.createApprovalRequest({
      entityType: 'performance_evaluation',
      entityId: 'e1',
      requestedBy: 'u1',
      requestReason: 'review',
    });

    expect(result).toBe(request);
    expect(approvalRequestRepository.create).toHaveBeenCalledOnce();
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', title: 'New Approval Required' })
    );
    expect(events).toContain('approval_request_created');
  });

  it('uses critical severity for urgent priority', async () => {
    vi.mocked(approvalRequestRepository.create).mockResolvedValue(makeRequest());

    await service.createApprovalRequest({
      entityType: 'safety_parameter_modification',
      entityId: 'e1',
      requestedBy: 'u1',
      requestReason: 'urgent fix',
      priority: 'urgent',
    });

    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical' })
    );
  });

  it('does not create an alert when the request has no steps', async () => {
    vi.mocked(approvalRequestRepository.create).mockResolvedValue(
      makeRequest({ steps: [] })
    );

    await service.createApprovalRequest({
      entityType: 'shift_change',
      entityId: 'e1',
      requestedBy: 'u1',
      requestReason: 'swap',
    });

    expect(alertService.createAlert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// processApproval
// ===========================================================================

describe('processApproval', () => {
  it('throws when the approval request is not found', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(null);

    await expect(
      service.processApproval({
        approvalRequestId: 'missing',
        stepId: 'step1',
        decision: 'approve',
        decidedBy: 'u1',
      })
    ).rejects.toThrow('Approval request missing not found');
  });

  it('throws when the step is not found', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(makeRequest());
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(null);

    await expect(
      service.processApproval({
        approvalRequestId: 'req1',
        stepId: 'gone',
        decision: 'approve',
        decidedBy: 'u1',
      })
    ).rejects.toThrow('Approval step gone not found');
  });

  it('throws when the step is not awaiting approval', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(makeRequest());
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(
      makeStep({ status: 'approved' })
    );

    await expect(
      service.processApproval({
        approvalRequestId: 'req1',
        stepId: 'step1',
        decision: 'approve',
        decidedBy: 'u1',
      })
    ).rejects.toThrow('is not awaiting approval');
  });

  it('marks the request approved when all steps are approved', async () => {
    const req = makeRequest();
    const updated = makeRequest({ status: 'approved' });
    vi.mocked(approvalRequestRepository.findById)
      .mockResolvedValueOnce(req) // initial lookup
      .mockResolvedValueOnce(updated); // final return
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(makeStep());
    vi.mocked(approvalStepRepository.processDecision).mockResolvedValue(undefined as never);
    vi.mocked(approvalStepRepository.areAllStepsApproved).mockResolvedValue(true);
    vi.mocked(approvalRequestRepository.updateStatus).mockResolvedValue(updated);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.processApproval({
      approvalRequestId: 'req1',
      stepId: 'step1',
      decision: 'approve',
      decidedBy: 'u1',
      reviewDurationSec: MINIMUM_REVIEW_SECONDS + 5,
    });

    expect(result).toBe(updated);
    expect(approvalRequestRepository.updateStatus).toHaveBeenCalledWith(
      'req1',
      'approved',
      'u1',
      'All required approvals granted'
    );
    expect(events).toContain('approval_approved');
  });

  it('advances to the next step when not all steps are approved', async () => {
    const req = makeRequest();
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(req);
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(makeStep());
    vi.mocked(approvalStepRepository.processDecision).mockResolvedValue(undefined as never);
    vi.mocked(approvalStepRepository.areAllStepsApproved).mockResolvedValue(false);
    vi.mocked(approvalStepRepository.advanceToNextStep).mockResolvedValue(undefined as never);
    vi.mocked(approvalRequestRepository.updateStatus).mockResolvedValue(req);

    await service.processApproval({
      approvalRequestId: 'req1',
      stepId: 'step1',
      decision: 'approve',
      decidedBy: 'u1',
      reviewDurationSec: 60,
    });

    expect(approvalStepRepository.advanceToNextStep).toHaveBeenCalledWith('req1');
    expect(approvalRequestRepository.updateStatus).toHaveBeenCalledWith(
      'req1',
      'in_progress',
      'u1',
      expect.stringContaining('proceeding to next step')
    );
  });

  it('rejects the request and skips remaining steps on a reject decision', async () => {
    const req = makeRequest();
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(req);
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(makeStep());
    vi.mocked(approvalStepRepository.processDecision).mockResolvedValue(undefined as never);
    vi.mocked(approvalStepRepository.skipRemainingSteps).mockResolvedValue(undefined as never);
    vi.mocked(approvalRequestRepository.updateStatus).mockResolvedValue(req);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    await service.processApproval({
      approvalRequestId: 'req1',
      stepId: 'step1',
      decision: 'reject',
      decidedBy: 'u1',
      decisionNotes: 'not good enough',
    });

    expect(approvalStepRepository.skipRemainingSteps).toHaveBeenCalledWith('req1');
    expect(approvalRequestRepository.updateStatus).toHaveBeenCalledWith(
      'req1',
      'rejected',
      'u1',
      'not good enough'
    );
    expect(events).toContain('approval_rejected');
  });

  it('flags a rubber-stamp approval in the emitted event without blocking', async () => {
    const req = makeRequest();
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(req);
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(makeStep());
    vi.mocked(approvalStepRepository.processDecision).mockResolvedValue(undefined as never);
    vi.mocked(approvalStepRepository.areAllStepsApproved).mockResolvedValue(true);
    vi.mocked(approvalRequestRepository.updateStatus).mockResolvedValue(req);

    const captured: Array<Record<string, unknown> | undefined> = [];
    service.onApprovalEvent((e) => {
      if (e.type === 'approval_approved') captured.push(e.data);
    });

    await service.processApproval({
      approvalRequestId: 'req1',
      stepId: 'step1',
      decision: 'approve',
      decidedBy: 'u1',
      reviewDurationSec: RUBBER_STAMP_WARNING_SECONDS - 1,
    });

    expect(captured[0]).toMatchObject({
      rubberStampWarning: true,
      activeEngagement: false,
    });
  });

  it('keeps the current status on a defer decision (no status update)', async () => {
    const req = makeRequest({ status: 'in_progress' });
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(req);
    vi.mocked(approvalStepRepository.findById).mockResolvedValue(makeStep());
    vi.mocked(approvalStepRepository.processDecision).mockResolvedValue(undefined as never);

    await service.processApproval({
      approvalRequestId: 'req1',
      stepId: 'step1',
      decision: 'defer',
      decidedBy: 'u1',
    });

    expect(approvalRequestRepository.updateStatus).not.toHaveBeenCalled();
    expect(approvalStepRepository.areAllStepsApproved).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// cancelApprovalRequest
// ===========================================================================

describe('cancelApprovalRequest', () => {
  it('cancels, skips remaining steps, and emits an event', async () => {
    const cancelled = makeRequest({ status: 'cancelled' });
    vi.mocked(approvalRequestRepository.updateStatus).mockResolvedValue(cancelled);
    vi.mocked(approvalStepRepository.skipRemainingSteps).mockResolvedValue(undefined as never);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.cancelApprovalRequest('req1', 'admin', 'no longer needed');

    expect(result).toBe(cancelled);
    expect(approvalRequestRepository.updateStatus).toHaveBeenCalledWith(
      'req1',
      'cancelled',
      'admin',
      'no longer needed'
    );
    expect(approvalStepRepository.skipRemainingSteps).toHaveBeenCalledWith('req1');
    expect(events).toContain('approval_cancelled');
  });

  it('does nothing extra when the request to cancel does not exist', async () => {
    vi.mocked(approvalRequestRepository.updateStatus).mockResolvedValue(null);

    const result = await service.cancelApprovalRequest('missing', 'admin', 'reason');

    expect(result).toBeNull();
    expect(approvalStepRepository.skipRemainingSteps).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// escalateRequest
// ===========================================================================

describe('escalateRequest', () => {
  it('escalates, raises an alert, and emits an event', async () => {
    const escalated = makeRequest({ status: 'escalated', escalationLevel: 1 });
    vi.mocked(approvalRequestRepository.escalate).mockResolvedValue(escalated);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.escalateRequest('req1', 'admin', 'too slow');

    expect(result).toBe(escalated);
    expect(approvalRequestRepository.escalate).toHaveBeenCalledWith('req1', 'admin');
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', title: 'Approval Escalated' })
    );
    expect(events).toContain('approval_escalated');
  });

  it('returns null without alerting when escalation target is missing', async () => {
    vi.mocked(approvalRequestRepository.escalate).mockResolvedValue(null);

    const result = await service.escalateRequest('missing', 'admin');

    expect(result).toBeNull();
    expect(alertService.createAlert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Query passthrough methods
// ===========================================================================

describe('query methods', () => {
  it('getApprovalRequest delegates to findById', async () => {
    const req = makeRequest();
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(req);
    await expect(service.getApprovalRequest('req1')).resolves.toBe(req);
    expect(approvalRequestRepository.findById).toHaveBeenCalledWith('req1');
  });

  it('getApprovalRequestByNumber delegates to findByRequestNumber', async () => {
    const req = makeRequest();
    vi.mocked(approvalRequestRepository.findByRequestNumber).mockResolvedValue(req);
    await expect(service.getApprovalRequestByNumber('AR-0001')).resolves.toBe(req);
    expect(approvalRequestRepository.findByRequestNumber).toHaveBeenCalledWith('AR-0001');
  });

  it('getApprovalRequests forwards filters and pagination', async () => {
    const resp = makeListResponse([]);
    vi.mocked(approvalRequestRepository.findAll).mockResolvedValue(resp);
    const filters = { status: 'pending' as const };
    await expect(service.getApprovalRequests(filters, 2, 50)).resolves.toBe(resp);
    expect(approvalRequestRepository.findAll).toHaveBeenCalledWith(filters, 2, 50);
  });

  it('getPendingApprovalsForUser delegates correctly', async () => {
    vi.mocked(approvalRequestRepository.findPendingForUser).mockResolvedValue([]);
    await service.getPendingApprovalsForUser('u1');
    expect(approvalRequestRepository.findPendingForUser).toHaveBeenCalledWith('u1');
  });

  it('getPendingApprovalsByRole delegates correctly', async () => {
    vi.mocked(approvalRequestRepository.findPendingByRole).mockResolvedValue([]);
    await service.getPendingApprovalsByRole('manager');
    expect(approvalRequestRepository.findPendingByRole).toHaveBeenCalledWith('manager');
  });

  it('getApprovalsNearingDeadline defaults to 4 hours', async () => {
    vi.mocked(approvalRequestRepository.findNearingDeadline).mockResolvedValue([]);
    await service.getApprovalsNearingDeadline();
    expect(approvalRequestRepository.findNearingDeadline).toHaveBeenCalledWith(4);
  });
});

// ===========================================================================
// submitWorkerViewpoint
// ===========================================================================

describe('submitWorkerViewpoint', () => {
  it('throws when the approval request does not exist', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(null);
    await expect(
      service.submitWorkerViewpoint({
        approvalRequestId: 'missing',
        workerId: 'w1',
        statement: 'x',
      })
    ).rejects.toThrow('not found');
  });

  it('throws when the worker is not the affected party', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(
      makeRequest({ affectedUserId: 'other' })
    );
    await expect(
      service.submitWorkerViewpoint({
        approvalRequestId: 'req1',
        workerId: 'w1',
        statement: 'x',
      })
    ).rejects.toThrow('not the affected party');
  });

  it('throws when a viewpoint already exists', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(
      makeRequest({ affectedUserId: 'w1' })
    );
    vi.mocked(workerViewpointRepository.findByRequestId).mockResolvedValue(makeViewpoint());
    await expect(
      service.submitWorkerViewpoint({
        approvalRequestId: 'req1',
        workerId: 'w1',
        statement: 'x',
      })
    ).rejects.toThrow('already been submitted');
  });

  it('creates a viewpoint, alerts approvers, and emits an event', async () => {
    vi.mocked(approvalRequestRepository.findById).mockResolvedValue(
      makeRequest({ affectedUserId: 'w1' })
    );
    vi.mocked(workerViewpointRepository.findByRequestId).mockResolvedValue(null);
    const vp = makeViewpoint();
    vi.mocked(workerViewpointRepository.create).mockResolvedValue(vp);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.submitWorkerViewpoint({
      approvalRequestId: 'req1',
      workerId: 'w1',
      statement: 'I disagree',
    });

    expect(result).toBe(vp);
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info', title: 'Worker Viewpoint Submitted' })
    );
    expect(events).toContain('viewpoint_submitted');
  });
});

// ===========================================================================
// acknowledgeViewpoint / respondToViewpoint / getViewpoint
// ===========================================================================

describe('viewpoint acknowledge/respond/get', () => {
  it('acknowledgeViewpoint emits an event when a viewpoint is returned', async () => {
    const vp = makeViewpoint({ status: 'acknowledged' });
    vi.mocked(workerViewpointRepository.acknowledge).mockResolvedValue(vp);
    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.acknowledgeViewpoint('vp1', 'mgr');
    expect(result).toBe(vp);
    expect(events).toContain('viewpoint_acknowledged');
  });

  it('acknowledgeViewpoint emits nothing when null is returned', async () => {
    vi.mocked(workerViewpointRepository.acknowledge).mockResolvedValue(null);
    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.acknowledgeViewpoint('missing', 'mgr');
    expect(result).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('respondToViewpoint forwards args and emits an event', async () => {
    const vp = makeViewpoint({ response: 'considered' });
    vi.mocked(workerViewpointRepository.respond).mockResolvedValue(vp);
    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.respondToViewpoint({
      viewpointId: 'vp1',
      response: 'we considered it',
      respondedBy: 'mgr',
    });

    expect(result).toBe(vp);
    expect(workerViewpointRepository.respond).toHaveBeenCalledWith(
      'vp1',
      'we considered it',
      'mgr'
    );
    expect(events).toContain('viewpoint_responded');
  });

  it('getViewpoint delegates to findByRequestId', async () => {
    vi.mocked(workerViewpointRepository.findByRequestId).mockResolvedValue(null);
    await service.getViewpoint('req1');
    expect(workerViewpointRepository.findByRequestId).toHaveBeenCalledWith('req1');
  });
});

// ===========================================================================
// contestDecision / requestHumanIntervention / processContest / getContest(s)
// ===========================================================================

describe('contests', () => {
  it('contestDecision creates a contest, alerts, and emits an event', async () => {
    const contest = makeContest();
    vi.mocked(decisionContestRepository.create).mockResolvedValue(contest);
    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.contestDecision({
      decisionId: 'd1',
      workerId: 'w1',
      contestReason: 'unfair',
    });

    expect(result).toBe(contest);
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', title: 'Decision Contested' })
    );
    expect(events).toContain('contest_submitted');
  });

  it('requestHumanIntervention forwards as a contest with human_review outcome', async () => {
    const contest = makeContest();
    vi.mocked(decisionContestRepository.create).mockResolvedValue(contest);

    await service.requestHumanIntervention('d1', 'w1', 'I want a human');

    expect(decisionContestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 'd1',
        workerId: 'w1',
        requestedOutcome: 'human_review',
        contestReason: expect.stringContaining('Human intervention requested'),
      })
    );
  });

  it('processContest updates status and emits an event when found', async () => {
    const contest = makeContest({ status: 'decision_overturned' });
    vi.mocked(decisionContestRepository.updateStatus).mockResolvedValue(contest);
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    service.onApprovalEvent((e) => events.push({ type: e.type, data: e.data }));

    const result = await service.processContest({
      contestId: 'c1',
      outcome: 'decision_overturned',
      reviewNotes: 'reversed',
      processedBy: 'admin',
    });

    expect(result).toBe(contest);
    expect(decisionContestRepository.updateStatus).toHaveBeenCalledWith(
      'c1',
      'decision_overturned',
      'reversed',
      'Decision overturned',
      'admin'
    );
    const reviewed = events.find((e) => e.type === 'contest_reviewed');
    expect(reviewed?.data).toMatchObject({ humanInterventionProvided: false });
  });

  it('processContest emits nothing when the contest is missing', async () => {
    vi.mocked(decisionContestRepository.updateStatus).mockResolvedValue(null);
    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    const result = await service.processContest({
      contestId: 'missing',
      outcome: 'decision_upheld',
      reviewNotes: 'no change',
      processedBy: 'admin',
    });

    expect(result).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('getContests and getContest delegate to the repository', async () => {
    const list = { contests: [], total: 0, page: 1, limit: 1000 };
    vi.mocked(decisionContestRepository.findAll).mockResolvedValue(list);
    vi.mocked(decisionContestRepository.findById).mockResolvedValue(null);

    await expect(service.getContests({ workerId: 'w1' }, 1, 10)).resolves.toBe(list);
    expect(decisionContestRepository.findAll).toHaveBeenCalledWith({ workerId: 'w1' }, 1, 10);

    await service.getContest('c1');
    expect(decisionContestRepository.findById).toHaveBeenCalledWith('c1');
  });
});

// ===========================================================================
// checkSLACompliance
// ===========================================================================

describe('checkSLACompliance', () => {
  it('emits sla_warning for nearing deadlines and sla_breach for overdue', async () => {
    const nearing = makeRequest({
      id: 'near',
      slaDeadline: new Date(Date.now() + 30 * 60 * 1000), // 30 min away → < 1h alert
    });
    const overdue = makeRequest({
      id: 'over',
      slaDeadline: new Date(Date.now() - 60 * 60 * 1000),
    });
    vi.mocked(approvalRequestRepository.findNearingDeadline).mockResolvedValue([nearing]);
    vi.mocked(approvalRequestRepository.findOverdue).mockResolvedValue([overdue]);

    const events: string[] = [];
    service.onApprovalEvent((e) => events.push(e.type));

    await service.checkSLACompliance();

    expect(events).toContain('sla_warning');
    expect(events).toContain('sla_breach');
    // within 1 hour → an imminent-deadline alert is raised
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'SLA Deadline Imminent' })
    );
  });

  it('does not raise an imminent alert when more than an hour remains', async () => {
    const nearing = makeRequest({
      slaDeadline: new Date(Date.now() + 90 * 60 * 1000), // 1.5h away
    });
    vi.mocked(approvalRequestRepository.findNearingDeadline).mockResolvedValue([nearing]);
    vi.mocked(approvalRequestRepository.findOverdue).mockResolvedValue([]);

    await service.checkSLACompliance();

    expect(alertService.createAlert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// escalateOverdueApprovals
// ===========================================================================

describe('escalateOverdueApprovals', () => {
  it('auto-escalates an overdue request when an overdue rule threshold is met', async () => {
    const overdue = makeRequest({
      id: 'req1',
      status: 'pending',
      slaDeadline: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h overdue
    });
    vi.mocked(approvalRequestRepository.findOverdue).mockResolvedValue([overdue]);
    vi.mocked(escalationRuleRepository.findActiveForEntityType).mockResolvedValue([
      {
        id: 'rule1',
        name: 'r',
        description: null,
        entityType: 'performance_evaluation',
        approvalType: null,
        triggerCondition: 'overdue',
        triggerThreshold: 2,
        escalateTo: 'admin',
        notifyOriginal: false,
        notifyAdmin: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    vi.mocked(approvalRequestRepository.escalate).mockResolvedValue(
      makeRequest({ status: 'escalated', escalationLevel: 1 })
    );

    await service.escalateOverdueApprovals();

    expect(approvalRequestRepository.escalate).toHaveBeenCalledWith('req1', 'system');
  });

  it('skips already-escalated requests', async () => {
    vi.mocked(approvalRequestRepository.findOverdue).mockResolvedValue([
      makeRequest({ status: 'escalated' }),
    ]);

    await service.escalateOverdueApprovals();

    expect(escalationRuleRepository.findActiveForEntityType).not.toHaveBeenCalled();
    expect(approvalRequestRepository.escalate).not.toHaveBeenCalled();
  });

  it('does not escalate when the overdue threshold is not yet reached', async () => {
    const overdue = makeRequest({
      status: 'pending',
      slaDeadline: new Date(Date.now() - 30 * 60 * 1000), // 0.5h overdue
    });
    vi.mocked(approvalRequestRepository.findOverdue).mockResolvedValue([overdue]);
    vi.mocked(escalationRuleRepository.findActiveForEntityType).mockResolvedValue([
      {
        id: 'rule1',
        name: 'r',
        description: null,
        entityType: 'performance_evaluation',
        approvalType: null,
        triggerCondition: 'overdue',
        triggerThreshold: 5, // 5h required
        escalateTo: 'admin',
        notifyOriginal: false,
        notifyAdmin: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await service.escalateOverdueApprovals();

    expect(approvalRequestRepository.escalate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// verifyActiveEngagement
// ===========================================================================

describe('verifyActiveEngagement', () => {
  it('reports active engagement at or above the minimum', () => {
    const result = service.verifyActiveEngagement(MINIMUM_REVIEW_SECONDS);
    expect(result).toEqual({ isActive: true });
  });

  it('warns about rubber-stamping below the warning threshold', () => {
    const result = service.verifyActiveEngagement(RUBBER_STAMP_WARNING_SECONDS - 1);
    expect(result.isActive).toBe(false);
    expect(result.warning).toContain('rubber-stamping');
  });

  it('warns about being below the minimum in the middle band', () => {
    const mid = Math.floor((RUBBER_STAMP_WARNING_SECONDS + MINIMUM_REVIEW_SECONDS) / 2);
    const result = service.verifyActiveEngagement(mid);
    expect(result.isActive).toBe(false);
    expect(result.warning).toContain('below recommended minimum');
  });
});

// ===========================================================================
// getMetrics
// ===========================================================================

describe('getMetrics', () => {
  it('aggregates status counts, type counts, and SLA compliance', async () => {
    vi.mocked(approvalRequestRepository.countByStatus).mockResolvedValue({
      pending: 2,
      in_progress: 1,
      approved: 1,
      rejected: 0,
      escalated: 0,
      expired: 0,
      cancelled: 0,
    });
    vi.mocked(approvalRequestRepository.countOverdue).mockResolvedValue(3);
    vi.mocked(approvalRequestRepository.findNearingDeadline).mockResolvedValue([
      makeRequest(),
    ]);
    vi.mocked(decisionContestRepository.countActive).mockResolvedValue(4);
    vi.mocked(workerViewpointRepository.countPending).mockResolvedValue(5);

    const created = new Date('2026-01-01T00:00:00Z');
    const completedOnTime = new Date('2026-01-01T02:00:00Z'); // 2h response
    const approvedReq = makeRequest({
      entityType: 'shift_change',
      status: 'approved',
      createdAt: created,
      completedAt: completedOnTime,
      slaDeadline: new Date('2026-01-01T05:00:00Z'),
      steps: [makeStep({ status: 'approved', approverRole: 'supervisor' })],
    });
    vi.mocked(approvalRequestRepository.findAll).mockResolvedValue(
      makeListResponse([approvedReq], 1)
    );

    const metrics = await service.getMetrics();

    expect(metrics.totalRequests).toBe(1);
    expect(metrics.pendingRequests).toBe(2);
    expect(metrics.inProgressRequests).toBe(1);
    expect(metrics.overdueRequests).toBe(3);
    expect(metrics.nearingDeadlineRequests).toBe(1);
    expect(metrics.activeContests).toBe(4);
    expect(metrics.pendingViewpoints).toBe(5);
    expect(metrics.requestsByType.shift_change).toBe(1);
    expect(metrics.approvalsByRole.supervisor).toBe(1);
    expect(metrics.avgResponseTimeHours).toBe(2);
    expect(metrics.slaComplianceRate).toBe(100);
  });

  it('returns 100% compliance and zero averages when there are no completed requests', async () => {
    vi.mocked(approvalRequestRepository.countByStatus).mockResolvedValue({
      pending: 0,
      in_progress: 0,
      approved: 0,
      rejected: 0,
      escalated: 0,
      expired: 0,
      cancelled: 0,
    });
    vi.mocked(approvalRequestRepository.countOverdue).mockResolvedValue(0);
    vi.mocked(approvalRequestRepository.findNearingDeadline).mockResolvedValue([]);
    vi.mocked(decisionContestRepository.countActive).mockResolvedValue(0);
    vi.mocked(workerViewpointRepository.countPending).mockResolvedValue(0);
    vi.mocked(approvalRequestRepository.findAll).mockResolvedValue(makeListResponse([], 0));

    const metrics = await service.getMetrics();

    expect(metrics.slaComplianceRate).toBe(100);
    expect(metrics.avgResponseTimeHours).toBe(0);
    expect(metrics.totalRequests).toBe(0);
  });
});

// ===========================================================================
// getSLAComplianceReport
// ===========================================================================

describe('getSLAComplianceReport', () => {
  it('computes on-time vs overdue completions and escalation counts', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const onTime = makeRequest({
      entityType: 'shift_change',
      status: 'approved',
      createdAt: created,
      completedAt: new Date('2026-01-01T01:00:00Z'),
      slaDeadline: new Date('2026-01-01T05:00:00Z'),
    });
    const late = makeRequest({
      id: 'late',
      entityType: 'shift_change',
      status: 'rejected',
      escalationLevel: 1,
      createdAt: created,
      completedAt: new Date('2026-01-01T10:00:00Z'),
      slaDeadline: new Date('2026-01-01T05:00:00Z'),
    });
    vi.mocked(approvalRequestRepository.findAll).mockResolvedValue(
      makeListResponse([onTime, late], 2)
    );
    vi.mocked(approvalRequestRepository.findOverdue).mockResolvedValue([]);
    vi.mocked(approvalRequestRepository.findNearingDeadline).mockResolvedValue([]);

    const report = await service.getSLAComplianceReport();

    expect(report.totalRequests).toBe(2);
    expect(report.onTimeRequests).toBe(1);
    expect(report.complianceRate).toBe(50);
    expect(report.escalatedCount).toBe(1);
    expect(report.byEntityType.shift_change.total).toBe(2);
    expect(report.byEntityType.shift_change.onTime).toBe(1);
    expect(report.byEntityType.shift_change.overdue).toBe(1);
  });
});

// ===========================================================================
// getMeaningfulOversightMetrics
// ===========================================================================

describe('getMeaningfulOversightMetrics', () => {
  it('classifies quick vs proper reviews and engagement rates', async () => {
    const req = makeRequest({
      steps: [
        makeStep({
          decision: 'approve',
          reviewDurationSec: RUBBER_STAMP_WARNING_SECONDS - 1, // quick
          activeEngagement: false,
          competenceVerified: false,
        }),
        makeStep({
          id: 'step2',
          decision: 'reject',
          reviewDurationSec: MINIMUM_REVIEW_SECONDS + 10, // proper
          activeEngagement: true,
          competenceVerified: true,
        }),
      ],
    });
    vi.mocked(approvalRequestRepository.findAll).mockResolvedValue(
      makeListResponse([req], 1)
    );

    const metrics = await service.getMeaningfulOversightMetrics();

    expect(metrics.totalApprovals).toBe(2);
    expect(metrics.quickApprovals).toBe(1);
    expect(metrics.properReviews).toBe(1);
    expect(metrics.activeEngagementRate).toBe(50);
    expect(metrics.competenceVerificationRate).toBe(50);
  });

  it('returns safe defaults when there are no decided steps', async () => {
    vi.mocked(approvalRequestRepository.findAll).mockResolvedValue(
      makeListResponse([makeRequest({ steps: [makeStep({ decision: null })] })], 1)
    );

    const metrics = await service.getMeaningfulOversightMetrics();

    expect(metrics.totalApprovals).toBe(0);
    expect(metrics.avgReviewDurationSec).toBe(0);
    expect(metrics.activeEngagementRate).toBe(100);
    expect(metrics.competenceVerificationRate).toBe(100);
  });
});

// ===========================================================================
// Event subscription handling
// ===========================================================================

describe('onApprovalEvent', () => {
  it('unsubscribes when the returned disposer is called', async () => {
    const cb = vi.fn();
    const unsubscribe = service.onApprovalEvent(cb);
    vi.mocked(approvalRequestRepository.create).mockResolvedValue(makeRequest());

    await service.createApprovalRequest({
      entityType: 'shift_change',
      entityId: 'e1',
      requestedBy: 'u1',
      requestReason: 'x',
    });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    await service.createApprovalRequest({
      entityType: 'shift_change',
      entityId: 'e1',
      requestedBy: 'u1',
      requestReason: 'y',
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber from the others', async () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    service.onApprovalEvent(bad);
    service.onApprovalEvent(good);
    vi.mocked(approvalRequestRepository.create).mockResolvedValue(makeRequest());

    await expect(
      service.createApprovalRequest({
        entityType: 'shift_change',
        entityId: 'e1',
        requestedBy: 'u1',
        requestReason: 'x',
      })
    ).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
  });
});

/**
 * @file approval.routes.ts
 * @description REST API routes for human approval workflows
 * @feature approvals
 *
 * Implements API endpoints for:
 * - GDPR Art. 22: Human review of automated decisions
 * - AI Act Art. 14: Human oversight with meaningful engagement
 * - EDPB WP251: Worker rights in automated processing
 */

import { Router, type Request, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { approvalWorkflowService } from '../services/ApprovalWorkflowService.js';
import type {
  ApprovalEntityType,
  ApprovalStatus,
  ApprovalPriority,
  ApproverRole,
  ApprovalDecision,
  DecisionContestStatus,
} from '../types/approval.types.js';
import { sendFailure } from '../utils/routeErrors.js';

export const approvalRoutes = Router();

// ============================================================================
// APPROVAL REQUESTS
// ============================================================================

/**
 * GET /approvals - List approval requests with filters
 * Query params: status, entityType, priority, affectedUserId, requestedBy, overdue, page, limit
 */
approvalRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const {
      status,
      entityType,
      priority,
      affectedUserId,
      requestedBy,
      overdue,
      fromDate,
      toDate,
      page,
      limit,
    } = req.query;

    const filters: Record<string, unknown> = {};

    if (status) {
      const statuses = (status as string).split(',') as ApprovalStatus[];
      filters.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    if (entityType) {
      const types = (entityType as string).split(',') as ApprovalEntityType[];
      filters.entityType = types.length === 1 ? types[0] : types;
    }

    if (priority) {
      const priorities = (priority as string).split(',') as ApprovalPriority[];
      filters.priority = priorities.length === 1 ? priorities[0] : priorities;
    }

    if (affectedUserId) filters.affectedUserId = affectedUserId as string;
    if (requestedBy) filters.requestedBy = requestedBy as string;
    if (overdue === 'true') filters.overdue = true;
    if (fromDate) filters.fromDate = new Date(fromDate as string);
    if (toDate) filters.toDate = new Date(toDate as string);

    const pageNum = page ? parseInt(page as string, 10) : 1;
    const limitNum = limit ? parseInt(limit as string, 10) : 20;

    const result = await approvalWorkflowService.getApprovalRequests(filters, pageNum, limitNum);
    res.json(result);
  } catch (error) {
    sendFailure(res, error, 'Failed to get approval requests', 500);
  }
});

/**
 * POST /approvals - Create a new approval request
 * Body: { entityType, entityId, entityData?, priority?, affectedUserId?, affectedRobotId?,
 *         requestedBy, requestReason, blocksExecution?, rollbackPlan?, approverChain? }
 */
approvalRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const {
      entityType,
      entityId,
      entityData,
      approvalType,
      priority,
      affectedUserId,
      affectedRobotId,
      requestedBy,
      requestReason,
      blocksExecution,
      rollbackPlan,
      approverChain,
    } = req.body;

    if (!entityType || !entityId || !requestedBy || !requestReason) {
      return res.status(400).json({
        error: 'entityType, entityId, requestedBy, and requestReason are required',
      });
    }

    const request = await approvalWorkflowService.createApprovalRequest({
      entityType,
      entityId,
      entityData,
      approvalType,
      priority,
      affectedUserId,
      affectedRobotId,
      requestedBy,
      requestReason,
      blocksExecution,
      rollbackPlan,
      approverChain,
    });

    res.status(201).json(request);
  } catch (error) {
    sendFailure(res, error, 'Failed to create approval request', 500);
  }
});

/**
 * GET /approvals/pending/me - Get pending approvals for current user
 * Query param: userId (TODO: get from auth)
 */
approvalRoutes.get('/pending/me', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string || 'system'; // TODO: Get from auth

    const requests = await approvalWorkflowService.getPendingApprovalsForUser(userId);
    res.json(requests);
  } catch (error) {
    sendFailure(res, error, 'Failed to get pending approvals', 500);
  }
});

/**
 * GET /approvals/pending/role/:role - Get pending approvals by role
 */
approvalRoutes.get('/pending/role/:role', async (req: Request, res: Response) => {
  try {
    const role = req.params.role as ApproverRole;
    const validRoles: ApproverRole[] = ['supervisor', 'manager', 'safety_officer', 'admin'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const requests = await approvalWorkflowService.getPendingApprovalsByRole(role);
    res.json(requests);
  } catch (error) {
    sendFailure(res, error, 'Failed to get pending approvals by role', 500);
  }
});

/**
 * GET /approvals/overdue - Get overdue approvals
 */
approvalRoutes.get('/overdue', async (req: Request, res: Response) => {
  try {
    const requests = await approvalWorkflowService.getOverdueApprovals();
    res.json(requests);
  } catch (error) {
    sendFailure(res, error, 'Failed to get overdue approvals', 500);
  }
});

/**
 * GET /approvals/nearing-deadline - Get approvals nearing SLA deadline
 * Query param: withinHours (default: 4)
 */
approvalRoutes.get('/nearing-deadline', async (req: Request, res: Response) => {
  try {
    const withinHours = req.query.withinHours
      ? parseInt(req.query.withinHours as string, 10)
      : 4;

    const requests = await approvalWorkflowService.getApprovalsNearingDeadline(withinHours);
    res.json(requests);
  } catch (error) {
    sendFailure(res, error, 'Failed to get approvals nearing deadline', 500);
  }
});

// ============================================================================
// APPROVAL ACTIONS
// ============================================================================

/**
 * The actor of an oversight decision (EU AI Act Art. 14), taken from the
 * authenticated session and never from the request body — a body-supplied
 * actor lets any caller attribute their decision to a colleague.
 *
 * Persists the user **id**, not the email: `schema.prisma` documents
 * `ApprovalStatusHistory.changedBy` as "User ID who made the change",
 * `team.routes.ts` resolves its actor the same way, and emails are
 * re-assignable while ids are the audit key.
 *
 * Returns null when the request carries no identity at all, which the three
 * decision routes answer with a 401 rather than writing an unattributed record.
 */
function resolveActor(req: AuthenticatedRequest): string | null {
  return req.user?.id ?? null;
}

/**
 * 400 for a request that tries to name its own actor. Refusing loudly beats
 * silently ignoring the field: a client that still sends one is a client that
 * believes it is choosing who the audit trail blames.
 */
function rejectsBodyActor(req: Request, res: Response, field: string): boolean {
  if (field in (req.body ?? {})) {
    res.status(400).json({
      error: `${field} is not accepted — the decision actor is taken from the authenticated session`,
    });
    return true;
  }
  return false;
}

/**
 * 401 for a session with no identity. Never write an Art. 14 record without an
 * actor — an unattributed oversight decision is not oversight.
 */
const UNAUTHENTICATED = { error: 'Unauthorized', message: 'Authentication required' } as const;

/**
 * POST /approvals/:id/steps/:stepId/decide - Process an approval decision
 * Body: { decision, decisionNotes?, reviewDurationSec?, competenceVerified? }
 * The deciding user comes from the session; a body `decidedBy` is refused.
 */
approvalRoutes.post('/:id/steps/:stepId/decide', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const approvalRequestId = req.params.id;
    const stepId = req.params.stepId;

    if (rejectsBodyActor(req, res, 'decidedBy')) return;
    const actor = resolveActor(req);
    if (!actor) return res.status(401).json(UNAUTHENTICATED);

    const { decision, decisionNotes, reviewDurationSec, competenceVerified } = req.body;

    const validDecisions: ApprovalDecision[] = ['approve', 'reject', 'defer', 'request_info'];
    if (!decision || !validDecisions.includes(decision)) {
      return res.status(400).json({
        error: `Valid decision is required. Must be one of: ${validDecisions.join(', ')}`,
      });
    }

    const request = await approvalWorkflowService.processApproval({
      approvalRequestId,
      stepId,
      decision,
      decidedBy: actor,
      decisionNotes,
      reviewDurationSec,
      competenceVerified,
    });

    res.json(request);
  } catch (error) {
    sendFailure(res, error, 'Failed to process approval decision', 500);
  }
});

/**
 * POST /approvals/:id/cancel - Cancel an approval request
 * Body: { reason }
 * The cancelling user comes from the session; a body `cancelledBy` is refused.
 */
approvalRoutes.post('/:id/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id;

    if (rejectsBodyActor(req, res, 'cancelledBy')) return;
    const actor = resolveActor(req);
    if (!actor) return res.status(401).json(UNAUTHENTICATED);

    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const request = await approvalWorkflowService.cancelApprovalRequest(id, actor, reason);

    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    res.json(request);
  } catch (error) {
    sendFailure(res, error, 'Failed to cancel approval request', 500);
  }
});

/**
 * POST /approvals/:id/escalate - Manually escalate an approval request
 * Body: { reason? }
 * The escalating user comes from the session; a body `escalatedBy` is refused.
 */
approvalRoutes.post('/:id/escalate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id;

    if (rejectsBodyActor(req, res, 'escalatedBy')) return;
    const actor = resolveActor(req);
    if (!actor) return res.status(401).json(UNAUTHENTICATED);

    const { reason } = req.body;

    const request = await approvalWorkflowService.escalateRequest(id, actor, reason);

    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    res.json(request);
  } catch (error) {
    sendFailure(res, error, 'Failed to escalate approval request', 500);
  }
});

// ============================================================================
// WORKER RIGHTS (GDPR Art. 22)
// ============================================================================

/**
 * POST /approvals/:id/viewpoint - Submit a worker viewpoint
 * Body: { workerId, statement, supportingDocs? }
 */
approvalRoutes.post('/:id/viewpoint', async (req: Request, res: Response) => {
  try {
    const approvalRequestId = req.params.id;
    const { workerId, statement, supportingDocs } = req.body;

    if (!workerId || !statement) {
      return res.status(400).json({ error: 'workerId and statement are required' });
    }

    const viewpoint = await approvalWorkflowService.submitWorkerViewpoint({
      approvalRequestId,
      workerId,
      statement,
      supportingDocs,
    });

    res.status(201).json(viewpoint);
  } catch (error) {
    sendFailure(res, error, 'Failed to submit viewpoint', 500);
  }
});

/**
 * GET /approvals/:id/viewpoint - Get viewpoint for an approval request
 */
approvalRoutes.get('/:id/viewpoint', async (req: Request, res: Response) => {
  try {
    const approvalRequestId = req.params.id;
    const viewpoint = await approvalWorkflowService.getViewpoint(approvalRequestId);

    if (!viewpoint) {
      return res.status(404).json({ error: 'No viewpoint found for this approval request' });
    }

    res.json(viewpoint);
  } catch (error) {
    sendFailure(res, error, 'Failed to get viewpoint', 500);
  }
});

/**
 * POST /approvals/:id/viewpoint/acknowledge - Acknowledge a worker viewpoint
 * Body: { acknowledgedBy }
 */
approvalRoutes.post('/:id/viewpoint/acknowledge', async (req: Request, res: Response) => {
  try {
    const approvalRequestId = req.params.id;
    const { acknowledgedBy } = req.body;

    if (!acknowledgedBy) {
      return res.status(400).json({ error: 'acknowledgedBy is required' });
    }

    // Get the viewpoint first
    const existingViewpoint = await approvalWorkflowService.getViewpoint(approvalRequestId);
    if (!existingViewpoint) {
      return res.status(404).json({ error: 'No viewpoint found for this approval request' });
    }

    const viewpoint = await approvalWorkflowService.acknowledgeViewpoint(
      existingViewpoint.id,
      acknowledgedBy
    );

    res.json(viewpoint);
  } catch (error) {
    sendFailure(res, error, 'Failed to acknowledge viewpoint', 500);
  }
});

/**
 * POST /approvals/:id/viewpoint/respond - Respond to a worker viewpoint
 * Body: { response, respondedBy }
 */
approvalRoutes.post('/:id/viewpoint/respond', async (req: Request, res: Response) => {
  try {
    const approvalRequestId = req.params.id;
    const { response, respondedBy } = req.body;

    if (!response || !respondedBy) {
      return res.status(400).json({ error: 'response and respondedBy are required' });
    }

    // Get the viewpoint first
    const existingViewpoint = await approvalWorkflowService.getViewpoint(approvalRequestId);
    if (!existingViewpoint) {
      return res.status(404).json({ error: 'No viewpoint found for this approval request' });
    }

    const viewpoint = await approvalWorkflowService.respondToViewpoint({
      viewpointId: existingViewpoint.id,
      response,
      respondedBy,
    });

    res.json(viewpoint);
  } catch (error) {
    sendFailure(res, error, 'Failed to respond to viewpoint', 500);
  }
});

// ============================================================================
// DECISION CONTESTS
// ============================================================================

/**
 * POST /decisions/:id/contest - Contest an automated decision
 * Body: { workerId, contestReason, contestEvidence?, requestedOutcome? }
 */
approvalRoutes.post('/decisions/:decisionId/contest', async (req: Request, res: Response) => {
  try {
    const decisionId = req.params.decisionId;
    const { workerId, contestReason, contestEvidence, requestedOutcome } = req.body;

    if (!workerId || !contestReason) {
      return res.status(400).json({ error: 'workerId and contestReason are required' });
    }

    const contest = await approvalWorkflowService.contestDecision({
      decisionId,
      workerId,
      contestReason,
      contestEvidence,
      requestedOutcome,
    });

    res.status(201).json(contest);
  } catch (error) {
    sendFailure(res, error, 'Failed to contest decision', 500);
  }
});

/**
 * POST /decisions/:id/request-intervention - Request human intervention
 * Body: { workerId, reason }
 */
approvalRoutes.post('/decisions/:decisionId/request-intervention', async (req: Request, res: Response) => {
  try {
    const decisionId = req.params.decisionId;
    const { workerId, reason } = req.body;

    if (!workerId || !reason) {
      return res.status(400).json({ error: 'workerId and reason are required' });
    }

    const contest = await approvalWorkflowService.requestHumanIntervention(
      decisionId,
      workerId,
      reason
    );

    res.status(201).json(contest);
  } catch (error) {
    sendFailure(res, error, 'Failed to request human intervention', 500);
  }
});

/**
 * GET /contests - List decision contests with filters
 * Query params: status, workerId, assignedTo, fromDate, toDate, page, limit
 */
approvalRoutes.get('/contests', async (req: Request, res: Response) => {
  try {
    const { status, workerId, assignedTo, fromDate, toDate, page, limit } = req.query;

    const filters: Record<string, unknown> = {};

    if (status) {
      const statuses = (status as string).split(',') as DecisionContestStatus[];
      filters.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    if (workerId) filters.workerId = workerId as string;
    if (assignedTo) filters.assignedTo = assignedTo as string;
    if (fromDate) filters.fromDate = new Date(fromDate as string);
    if (toDate) filters.toDate = new Date(toDate as string);

    const pageNum = page ? parseInt(page as string, 10) : 1;
    const limitNum = limit ? parseInt(limit as string, 10) : 20;

    const result = await approvalWorkflowService.getContests(filters, pageNum, limitNum);
    res.json(result);
  } catch (error) {
    sendFailure(res, error, 'Failed to get contests', 500);
  }
});

/**
 * GET /contests/:id - Get contest by ID
 */
approvalRoutes.get('/contests/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const contest = await approvalWorkflowService.getContest(id);

    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    res.json(contest);
  } catch (error) {
    sendFailure(res, error, 'Failed to get contest', 500);
  }
});

/**
 * POST /contests/:id/review - Process a contest review
 * Body: { outcome, reviewNotes, processedBy, newDecisionData? }
 */
approvalRoutes.post('/contests/:id/review', async (req: Request, res: Response) => {
  try {
    const contestId = req.params.id;
    const { outcome, reviewNotes, processedBy, newDecisionData } = req.body;

    const validOutcomes = ['human_intervention_granted', 'decision_overturned', 'decision_upheld'];
    if (!outcome || !validOutcomes.includes(outcome)) {
      return res.status(400).json({
        error: `Valid outcome is required. Must be one of: ${validOutcomes.join(', ')}`,
      });
    }

    if (!reviewNotes || !processedBy) {
      return res.status(400).json({ error: 'reviewNotes and processedBy are required' });
    }

    const contest = await approvalWorkflowService.processContest({
      contestId,
      outcome,
      reviewNotes,
      processedBy,
      newDecisionData,
    });

    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    res.json(contest);
  } catch (error) {
    sendFailure(res, error, 'Failed to process contest', 500);
  }
});

// ============================================================================
// METRICS & REPORTING
// ============================================================================

/**
 * GET /approvals/metrics - Get approval workflow metrics
 */
approvalRoutes.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await approvalWorkflowService.getMetrics();
    res.json(metrics);
  } catch (error) {
    sendFailure(res, error, 'Failed to get metrics', 500);
  }
});

/**
 * GET /approvals/sla-report - Get SLA compliance report
 */
approvalRoutes.get('/sla-report', async (req: Request, res: Response) => {
  try {
    const report = await approvalWorkflowService.getSLAComplianceReport();
    res.json(report);
  } catch (error) {
    sendFailure(res, error, 'Failed to get SLA report', 500);
  }
});

/**
 * GET /approvals/oversight-metrics - Get meaningful oversight metrics (Art. 14)
 */
approvalRoutes.get('/oversight-metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await approvalWorkflowService.getMeaningfulOversightMetrics();
    res.json(metrics);
  } catch (error) {
    sendFailure(res, error, 'Failed to get oversight metrics', 500);
  }
});

// ============================================================================
// CATCH-ALL — MUST BE LAST
// ============================================================================

/**
 * GET /approvals/:id - Get approval request by ID
 *
 * Registered last on purpose: the single-segment '/:id' param route would
 * otherwise shadow the literal GET routes above (/contests, /metrics,
 * /sla-report, /oversight-metrics), capturing them as id='contests' etc.
 */
approvalRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const request = await approvalWorkflowService.getApprovalRequest(id);

    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    res.json(request);
  } catch (error) {
    sendFailure(res, error, 'Failed to get approval request', 500);
  }
});

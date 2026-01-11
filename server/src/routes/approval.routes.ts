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
import { approvalWorkflowService } from '../services/ApprovalWorkflowService.js';
import type {
  ApprovalEntityType,
  ApprovalStatus,
  ApprovalPriority,
  ApproverRole,
  ApprovalDecision,
  DecisionContestStatus,
} from '../types/approval.types.js';

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
    const message = error instanceof Error ? error.message : 'Failed to get approval requests';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to create approval request';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get pending approvals';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get pending approvals by role';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get overdue approvals';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get approvals nearing deadline';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /approvals/:id - Get approval request by ID
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
    const message = error instanceof Error ? error.message : 'Failed to get approval request';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// APPROVAL ACTIONS
// ============================================================================

/**
 * POST /approvals/:id/steps/:stepId/decide - Process an approval decision
 * Body: { decision, decidedBy, decisionNotes?, reviewDurationSec?, competenceVerified? }
 */
approvalRoutes.post('/:id/steps/:stepId/decide', async (req: Request, res: Response) => {
  try {
    const approvalRequestId = req.params.id;
    const stepId = req.params.stepId;
    const { decision, decidedBy, decisionNotes, reviewDurationSec, competenceVerified } = req.body;

    const validDecisions: ApprovalDecision[] = ['approve', 'reject', 'defer', 'request_info'];
    if (!decision || !validDecisions.includes(decision)) {
      return res.status(400).json({
        error: `Valid decision is required. Must be one of: ${validDecisions.join(', ')}`,
      });
    }

    if (!decidedBy) {
      return res.status(400).json({ error: 'decidedBy is required' });
    }

    const request = await approvalWorkflowService.processApproval({
      approvalRequestId,
      stepId,
      decision,
      decidedBy,
      decisionNotes,
      reviewDurationSec,
      competenceVerified,
    });

    res.json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process approval decision';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /approvals/:id/cancel - Cancel an approval request
 * Body: { cancelledBy, reason }
 */
approvalRoutes.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { cancelledBy, reason } = req.body;

    if (!cancelledBy || !reason) {
      return res.status(400).json({ error: 'cancelledBy and reason are required' });
    }

    const request = await approvalWorkflowService.cancelApprovalRequest(id, cancelledBy, reason);

    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    res.json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel approval request';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /approvals/:id/escalate - Manually escalate an approval request
 * Body: { escalatedBy, reason? }
 */
approvalRoutes.post('/:id/escalate', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { escalatedBy, reason } = req.body;

    if (!escalatedBy) {
      return res.status(400).json({ error: 'escalatedBy is required' });
    }

    const request = await approvalWorkflowService.escalateRequest(id, escalatedBy, reason);

    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    res.json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to escalate approval request';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to submit viewpoint';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get viewpoint';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to acknowledge viewpoint';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to respond to viewpoint';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to contest decision';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to request human intervention';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get contests';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get contest';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to process contest';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get metrics';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get SLA report';
    res.status(500).json({ error: message });
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
    const message = error instanceof Error ? error.message : 'Failed to get oversight metrics';
    res.status(500).json({ error: message });
  }
});

/**
 * @file approval-routes.test.ts
 * @description Integration tests for human approval workflow routes (GDPR Art. 22, AI Act Art. 14)
 * @feature approvals
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockApprovalWorkflowService } = vi.hoisted(() => ({
  mockApprovalWorkflowService: {
    getApprovalRequests: vi.fn(),
    createApprovalRequest: vi.fn(),
    getPendingApprovalsForUser: vi.fn(),
    getPendingApprovalsByRole: vi.fn(),
    getOverdueApprovals: vi.fn(),
    getApprovalsNearingDeadline: vi.fn(),
    getApprovalRequest: vi.fn(),
    processApproval: vi.fn(),
    cancelApprovalRequest: vi.fn(),
    escalateRequest: vi.fn(),
    submitWorkerViewpoint: vi.fn(),
    getViewpoint: vi.fn(),
    acknowledgeViewpoint: vi.fn(),
    respondToViewpoint: vi.fn(),
    contestDecision: vi.fn(),
    requestHumanIntervention: vi.fn(),
    getContests: vi.fn(),
    getContest: vi.fn(),
    processContest: vi.fn(),
    getMetrics: vi.fn(),
    getSLAComplianceReport: vi.fn(),
    getMeaningfulOversightMetrics: vi.fn(),
  },
}));

vi.mock('../services/ApprovalWorkflowService.js', () => ({
  approvalWorkflowService: mockApprovalWorkflowService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { approvalRoutes } from '../routes/approval.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/approvals', authMiddleware as any, approvalRoutes);
  return app;
}

const mockRequest = {
  id: 'appr-001',
  requestNumber: 'AR-0001',
  entityType: 'task',
  entityId: 'task-1',
  status: 'pending',
  priority: 'high',
  requestedBy: 'requester-1',
  requestReason: 'needs review',
};

const mockViewpoint = {
  id: 'vp-001',
  approvalRequestId: 'appr-001',
  workerId: 'worker-1',
  statement: 'I disagree',
};

const mockContest = {
  id: 'contest-001',
  decisionId: 'dec-1',
  workerId: 'worker-1',
  status: 'pending',
};

describe('Approval Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals
  // --------------------------------------------------------------------------

  describe('GET /api/approvals', () => {
    it('lists approval requests with parsed filters', async () => {
      const result = { data: [mockRequest], total: 1, page: 1, limit: 20 };
      mockApprovalWorkflowService.getApprovalRequests.mockResolvedValue(result);

      const response = await request(app)
        .get('/api/approvals')
        .query({ status: 'pending', entityType: 'task,zone', priority: 'high', overdue: 'true' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      const [filters, page, limit] = mockApprovalWorkflowService.getApprovalRequests.mock.calls[0];
      expect(filters.status).toBe('pending');
      expect(filters.entityType).toEqual(['task', 'zone']);
      expect(filters.priority).toBe('high');
      expect(filters.overdue).toBe(true);
      expect(page).toBe(1);
      expect(limit).toBe(20);
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getApprovalRequests.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/approvals');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals
  // --------------------------------------------------------------------------

  describe('POST /api/approvals', () => {
    it('creates an approval request', async () => {
      mockApprovalWorkflowService.createApprovalRequest.mockResolvedValue(mockRequest);

      const body = {
        entityType: 'task',
        entityId: 'task-1',
        requestedBy: 'requester-1',
        requestReason: 'needs review',
      };
      const response = await request(app).post('/api/approvals').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('appr-001');
      expect(mockApprovalWorkflowService.createApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining(body)
      );
    });

    it('returns 400 when required fields missing', async () => {
      const response = await request(app).post('/api/approvals').send({ entityType: 'task' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
      expect(mockApprovalWorkflowService.createApprovalRequest).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.createApprovalRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/approvals').send({
        entityType: 'task',
        entityId: 'task-1',
        requestedBy: 'requester-1',
        requestReason: 'needs review',
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/pending/me
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/pending/me', () => {
    it('returns pending approvals for given userId', async () => {
      mockApprovalWorkflowService.getPendingApprovalsForUser.mockResolvedValue([mockRequest]);

      const response = await request(app).get('/api/approvals/pending/me').query({ userId: 'u-9' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockApprovalWorkflowService.getPendingApprovalsForUser).toHaveBeenCalledWith('u-9');
    });

    it('defaults to system when userId missing', async () => {
      mockApprovalWorkflowService.getPendingApprovalsForUser.mockResolvedValue([]);

      const response = await request(app).get('/api/approvals/pending/me');

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.getPendingApprovalsForUser).toHaveBeenCalledWith('system');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getPendingApprovalsForUser.mockRejectedValue(new Error('x'));

      const response = await request(app).get('/api/approvals/pending/me');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('x');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/pending/role/:role
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/pending/role/:role', () => {
    it('returns pending approvals by valid role', async () => {
      mockApprovalWorkflowService.getPendingApprovalsByRole.mockResolvedValue([mockRequest]);

      const response = await request(app).get('/api/approvals/pending/role/supervisor');

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.getPendingApprovalsByRole).toHaveBeenCalledWith('supervisor');
    });

    it('returns 400 for invalid role', async () => {
      const response = await request(app).get('/api/approvals/pending/role/wizard');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid role');
      expect(mockApprovalWorkflowService.getPendingApprovalsByRole).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getPendingApprovalsByRole.mockRejectedValue(new Error('y'));

      const response = await request(app).get('/api/approvals/pending/role/admin');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('y');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/overdue
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/overdue', () => {
    it('returns overdue approvals', async () => {
      mockApprovalWorkflowService.getOverdueApprovals.mockResolvedValue([mockRequest]);

      const response = await request(app).get('/api/approvals/overdue');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockApprovalWorkflowService.getOverdueApprovals).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getOverdueApprovals.mockRejectedValue(new Error('z'));

      const response = await request(app).get('/api/approvals/overdue');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('z');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/nearing-deadline
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/nearing-deadline', () => {
    it('returns approvals nearing deadline with custom withinHours', async () => {
      mockApprovalWorkflowService.getApprovalsNearingDeadline.mockResolvedValue([mockRequest]);

      const response = await request(app)
        .get('/api/approvals/nearing-deadline')
        .query({ withinHours: '6' });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.getApprovalsNearingDeadline).toHaveBeenCalledWith(6);
    });

    it('defaults withinHours to 4', async () => {
      mockApprovalWorkflowService.getApprovalsNearingDeadline.mockResolvedValue([]);

      const response = await request(app).get('/api/approvals/nearing-deadline');

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.getApprovalsNearingDeadline).toHaveBeenCalledWith(4);
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getApprovalsNearingDeadline.mockRejectedValue(new Error('w'));

      const response = await request(app).get('/api/approvals/nearing-deadline');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('w');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/:id
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/:id', () => {
    it('returns approval request by id', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockResolvedValue(mockRequest);

      const response = await request(app).get('/api/approvals/appr-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('appr-001');
      expect(mockApprovalWorkflowService.getApprovalRequest).toHaveBeenCalledWith('appr-001');
    });

    it('returns 404 when not found', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Approval request not found');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockRejectedValue(new Error('e'));

      const response = await request(app).get('/api/approvals/appr-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('e');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/:id/steps/:stepId/decide
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/:id/steps/:stepId/decide', () => {
    it('processes an approval decision', async () => {
      mockApprovalWorkflowService.processApproval.mockResolvedValue(mockRequest);

      const response = await request(app)
        .post('/api/approvals/appr-001/steps/step-1/decide')
        .send({ decision: 'approve', decidedBy: 'user-123' });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.processApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalRequestId: 'appr-001',
          stepId: 'step-1',
          decision: 'approve',
          decidedBy: 'user-123',
        })
      );
    });

    it('returns 400 for invalid decision', async () => {
      const response = await request(app)
        .post('/api/approvals/appr-001/steps/step-1/decide')
        .send({ decision: 'maybe', decidedBy: 'user-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Valid decision is required');
    });

    it('returns 400 when decidedBy missing', async () => {
      const response = await request(app)
        .post('/api/approvals/appr-001/steps/step-1/decide')
        .send({ decision: 'approve' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('decidedBy is required');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.processApproval.mockRejectedValue(new Error('p'));

      const response = await request(app)
        .post('/api/approvals/appr-001/steps/step-1/decide')
        .send({ decision: 'reject', decidedBy: 'user-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('p');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/:id/cancel
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/:id/cancel', () => {
    it('cancels an approval request', async () => {
      mockApprovalWorkflowService.cancelApprovalRequest.mockResolvedValue(mockRequest);

      const response = await request(app)
        .post('/api/approvals/appr-001/cancel')
        .send({ cancelledBy: 'user-123', reason: 'no longer needed' });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.cancelApprovalRequest).toHaveBeenCalledWith(
        'appr-001',
        'user-123',
        'no longer needed'
      );
    });

    it('returns 400 when fields missing', async () => {
      const response = await request(app)
        .post('/api/approvals/appr-001/cancel')
        .send({ cancelledBy: 'user-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cancelledBy and reason are required');
    });

    it('returns 404 when not found', async () => {
      mockApprovalWorkflowService.cancelApprovalRequest.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/approvals/missing/cancel')
        .send({ cancelledBy: 'user-123', reason: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Approval request not found');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.cancelApprovalRequest.mockRejectedValue(new Error('c'));

      const response = await request(app)
        .post('/api/approvals/appr-001/cancel')
        .send({ cancelledBy: 'user-123', reason: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('c');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/:id/escalate
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/:id/escalate', () => {
    it('escalates an approval request', async () => {
      mockApprovalWorkflowService.escalateRequest.mockResolvedValue(mockRequest);

      const response = await request(app)
        .post('/api/approvals/appr-001/escalate')
        .send({ escalatedBy: 'user-123', reason: 'urgent' });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.escalateRequest).toHaveBeenCalledWith(
        'appr-001',
        'user-123',
        'urgent'
      );
    });

    it('returns 400 when escalatedBy missing', async () => {
      const response = await request(app).post('/api/approvals/appr-001/escalate').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('escalatedBy is required');
    });

    it('returns 404 when not found', async () => {
      mockApprovalWorkflowService.escalateRequest.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/approvals/missing/escalate')
        .send({ escalatedBy: 'user-123' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Approval request not found');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.escalateRequest.mockRejectedValue(new Error('esc'));

      const response = await request(app)
        .post('/api/approvals/appr-001/escalate')
        .send({ escalatedBy: 'user-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('esc');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/:id/viewpoint
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/:id/viewpoint', () => {
    it('submits a worker viewpoint', async () => {
      mockApprovalWorkflowService.submitWorkerViewpoint.mockResolvedValue(mockViewpoint);

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint')
        .send({ workerId: 'worker-1', statement: 'I disagree' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('vp-001');
      expect(mockApprovalWorkflowService.submitWorkerViewpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalRequestId: 'appr-001',
          workerId: 'worker-1',
          statement: 'I disagree',
        })
      );
    });

    it('returns 400 when fields missing', async () => {
      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint')
        .send({ workerId: 'worker-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('workerId and statement are required');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.submitWorkerViewpoint.mockRejectedValue(new Error('vp'));

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint')
        .send({ workerId: 'worker-1', statement: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('vp');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/:id/viewpoint
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/:id/viewpoint', () => {
    it('returns the viewpoint', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(mockViewpoint);

      const response = await request(app).get('/api/approvals/appr-001/viewpoint');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('vp-001');
      expect(mockApprovalWorkflowService.getViewpoint).toHaveBeenCalledWith('appr-001');
    });

    it('returns 404 when no viewpoint', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/appr-001/viewpoint');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No viewpoint found for this approval request');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getViewpoint.mockRejectedValue(new Error('gvp'));

      const response = await request(app).get('/api/approvals/appr-001/viewpoint');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('gvp');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/:id/viewpoint/acknowledge
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/:id/viewpoint/acknowledge', () => {
    it('acknowledges a viewpoint', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(mockViewpoint);
      mockApprovalWorkflowService.acknowledgeViewpoint.mockResolvedValue({
        ...mockViewpoint,
        acknowledgedBy: 'user-123',
      });

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/acknowledge')
        .send({ acknowledgedBy: 'user-123' });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.acknowledgeViewpoint).toHaveBeenCalledWith(
        'vp-001',
        'user-123'
      );
    });

    it('returns 400 when acknowledgedBy missing', async () => {
      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/acknowledge')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('acknowledgedBy is required');
    });

    it('returns 404 when no viewpoint exists', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/acknowledge')
        .send({ acknowledgedBy: 'user-123' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No viewpoint found for this approval request');
      expect(mockApprovalWorkflowService.acknowledgeViewpoint).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(mockViewpoint);
      mockApprovalWorkflowService.acknowledgeViewpoint.mockRejectedValue(new Error('ack'));

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/acknowledge')
        .send({ acknowledgedBy: 'user-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('ack');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/:id/viewpoint/respond
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/:id/viewpoint/respond', () => {
    it('responds to a viewpoint', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(mockViewpoint);
      mockApprovalWorkflowService.respondToViewpoint.mockResolvedValue({
        ...mockViewpoint,
        response: 'noted',
      });

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/respond')
        .send({ response: 'noted', respondedBy: 'user-123' });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.respondToViewpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          viewpointId: 'vp-001',
          response: 'noted',
          respondedBy: 'user-123',
        })
      );
    });

    it('returns 400 when fields missing', async () => {
      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/respond')
        .send({ response: 'noted' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('response and respondedBy are required');
    });

    it('returns 404 when no viewpoint exists', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/respond')
        .send({ response: 'noted', respondedBy: 'user-123' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No viewpoint found for this approval request');
      expect(mockApprovalWorkflowService.respondToViewpoint).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getViewpoint.mockResolvedValue(mockViewpoint);
      mockApprovalWorkflowService.respondToViewpoint.mockRejectedValue(new Error('resp'));

      const response = await request(app)
        .post('/api/approvals/appr-001/viewpoint/respond')
        .send({ response: 'noted', respondedBy: 'user-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('resp');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/decisions/:decisionId/contest
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/decisions/:decisionId/contest', () => {
    it('contests a decision', async () => {
      mockApprovalWorkflowService.contestDecision.mockResolvedValue(mockContest);

      const response = await request(app)
        .post('/api/approvals/decisions/dec-1/contest')
        .send({ workerId: 'worker-1', contestReason: 'unfair' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('contest-001');
      expect(mockApprovalWorkflowService.contestDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionId: 'dec-1',
          workerId: 'worker-1',
          contestReason: 'unfair',
        })
      );
    });

    it('returns 400 when fields missing', async () => {
      const response = await request(app)
        .post('/api/approvals/decisions/dec-1/contest')
        .send({ workerId: 'worker-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('workerId and contestReason are required');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.contestDecision.mockRejectedValue(new Error('cd'));

      const response = await request(app)
        .post('/api/approvals/decisions/dec-1/contest')
        .send({ workerId: 'worker-1', contestReason: 'unfair' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('cd');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/decisions/:decisionId/request-intervention
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/decisions/:decisionId/request-intervention', () => {
    it('requests human intervention', async () => {
      mockApprovalWorkflowService.requestHumanIntervention.mockResolvedValue(mockContest);

      const response = await request(app)
        .post('/api/approvals/decisions/dec-1/request-intervention')
        .send({ workerId: 'worker-1', reason: 'need human' });

      expect(response.status).toBe(201);
      expect(mockApprovalWorkflowService.requestHumanIntervention).toHaveBeenCalledWith(
        'dec-1',
        'worker-1',
        'need human'
      );
    });

    it('returns 400 when fields missing', async () => {
      const response = await request(app)
        .post('/api/approvals/decisions/dec-1/request-intervention')
        .send({ workerId: 'worker-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('workerId and reason are required');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.requestHumanIntervention.mockRejectedValue(new Error('ri'));

      const response = await request(app)
        .post('/api/approvals/decisions/dec-1/request-intervention')
        .send({ workerId: 'worker-1', reason: 'need human' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('ri');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/contests
  // NOTE: registered AFTER GET /:id, so it is shadowed and resolves via
  // getApprovalRequest('contests'). Asserting ACTUAL current behavior.
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/contests (shadowed by /:id)', () => {
    it('is captured by the /:id handler (current behavior)', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/contests');

      // /:id wins; getApprovalRequest('contests') returns null -> 404
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Approval request not found');
      expect(mockApprovalWorkflowService.getApprovalRequest).toHaveBeenCalledWith('contests');
      expect(mockApprovalWorkflowService.getContests).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/contests/:id
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/contests/:id', () => {
    it('returns a contest by id', async () => {
      mockApprovalWorkflowService.getContest.mockResolvedValue(mockContest);

      const response = await request(app).get('/api/approvals/contests/contest-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('contest-001');
      expect(mockApprovalWorkflowService.getContest).toHaveBeenCalledWith('contest-001');
    });

    it('returns 404 when contest not found', async () => {
      mockApprovalWorkflowService.getContest.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/contests/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contest not found');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.getContest.mockRejectedValue(new Error('gc'));

      const response = await request(app).get('/api/approvals/contests/contest-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('gc');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/approvals/contests/:id/review
  // --------------------------------------------------------------------------

  describe('POST /api/approvals/contests/:id/review', () => {
    it('processes a contest review', async () => {
      mockApprovalWorkflowService.processContest.mockResolvedValue(mockContest);

      const response = await request(app)
        .post('/api/approvals/contests/contest-001/review')
        .send({
          outcome: 'decision_upheld',
          reviewNotes: 'ok',
          processedBy: 'user-123',
        });

      expect(response.status).toBe(200);
      expect(mockApprovalWorkflowService.processContest).toHaveBeenCalledWith(
        expect.objectContaining({
          contestId: 'contest-001',
          outcome: 'decision_upheld',
          reviewNotes: 'ok',
          processedBy: 'user-123',
        })
      );
    });

    it('returns 400 for invalid outcome', async () => {
      const response = await request(app)
        .post('/api/approvals/contests/contest-001/review')
        .send({ outcome: 'whatever', reviewNotes: 'ok', processedBy: 'user-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Valid outcome is required');
    });

    it('returns 400 when reviewNotes or processedBy missing', async () => {
      const response = await request(app)
        .post('/api/approvals/contests/contest-001/review')
        .send({ outcome: 'decision_upheld' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('reviewNotes and processedBy are required');
    });

    it('returns 404 when contest not found', async () => {
      mockApprovalWorkflowService.processContest.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/approvals/contests/missing/review')
        .send({ outcome: 'decision_upheld', reviewNotes: 'ok', processedBy: 'user-123' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contest not found');
    });

    it('returns 500 on service error', async () => {
      mockApprovalWorkflowService.processContest.mockRejectedValue(new Error('pc'));

      const response = await request(app)
        .post('/api/approvals/contests/contest-001/review')
        .send({ outcome: 'decision_overturned', reviewNotes: 'ok', processedBy: 'user-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('pc');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/approvals/metrics, /sla-report, /oversight-metrics
  // NOTE: all registered AFTER GET /:id, so they are shadowed and resolve via
  // getApprovalRequest(<segment>). Asserting ACTUAL current behavior.
  // --------------------------------------------------------------------------

  describe('GET /api/approvals/metrics (shadowed by /:id)', () => {
    it('is captured by the /:id handler (current behavior)', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/metrics');

      expect(response.status).toBe(404);
      expect(mockApprovalWorkflowService.getApprovalRequest).toHaveBeenCalledWith('metrics');
      expect(mockApprovalWorkflowService.getMetrics).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/approvals/sla-report (shadowed by /:id)', () => {
    it('is captured by the /:id handler (current behavior)', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/sla-report');

      expect(response.status).toBe(404);
      expect(mockApprovalWorkflowService.getApprovalRequest).toHaveBeenCalledWith('sla-report');
      expect(mockApprovalWorkflowService.getSLAComplianceReport).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/approvals/oversight-metrics (shadowed by /:id)', () => {
    it('is captured by the /:id handler (current behavior)', async () => {
      mockApprovalWorkflowService.getApprovalRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/approvals/oversight-metrics');

      expect(response.status).toBe(404);
      expect(mockApprovalWorkflowService.getApprovalRequest).toHaveBeenCalledWith('oversight-metrics');
      expect(mockApprovalWorkflowService.getMeaningfulOversightMetrics).not.toHaveBeenCalled();
    });
  });
});

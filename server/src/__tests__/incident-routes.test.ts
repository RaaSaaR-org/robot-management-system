/**
 * @file incident-routes.test.ts
 * @description Integration tests for incident reporting/management and notification template routes
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockIncidentService, mockBreachAssessmentService, mockNotificationWorkflowService } =
  vi.hoisted(() => ({
    mockIncidentService: {
      listIncidents: vi.fn(),
      getDashboardStats: vi.fn(),
      getOpenIncidents: vi.fn(),
      getOverdueNotifications: vi.fn(),
      getIncident: vi.fn(),
      createIncident: vi.fn(),
      captureSystemSnapshot: vi.fn(),
      updateIncident: vi.fn(),
      deleteIncident: vi.fn(),
      linkEvidence: vi.fn(),
    },
    mockBreachAssessmentService: {
      assessRisk: vi.fn(),
      getRiskMatrix: vi.fn(),
    },
    mockNotificationWorkflowService: {
      createNotificationWorkflow: vi.fn(),
      getNotificationTimeline: vi.fn(),
      markNotificationSent: vi.fn(),
      generateNotificationContent: vi.fn(),
      updateNotificationContent: vi.fn(),
      getTemplates: vi.fn(),
      getTemplate: vi.fn(),
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
    },
  }));

vi.mock('../services/IncidentService.js', () => ({
  incidentService: mockIncidentService,
}));

vi.mock('../services/BreachAssessmentService.js', () => ({
  breachAssessmentService: mockBreachAssessmentService,
}));

vi.mock('../services/NotificationWorkflowService.js', () => ({
  notificationWorkflowService: mockNotificationWorkflowService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { incidentRoutes, templateRoutes } from '../routes/incident.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/incidents', authMiddleware as any, incidentRoutes);
  app.use('/api/notification-templates', authMiddleware as any, templateRoutes);
  return app;
}

const INCIDENT = {
  id: 'inc-001',
  incidentNumber: 'INC-2026-001',
  type: 'safety',
  severity: 'high',
  status: 'open',
  title: 'Test Incident',
  description: 'Something happened',
  complianceLogIds: ['log-1'],
  alertIds: ['alert-1'],
  systemSnapshot: { foo: 'bar' },
};

describe('Incident Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents
  // --------------------------------------------------------------------------

  describe('GET /api/incidents', () => {
    it('lists incidents with no filters', async () => {
      mockIncidentService.listIncidents.mockResolvedValue({ incidents: [INCIDENT], total: 1 });

      const response = await request(app).get('/api/incidents');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockIncidentService.listIncidents).toHaveBeenCalledWith({});
    });

    it('parses single and multi-value filters and pagination', async () => {
      mockIncidentService.listIncidents.mockResolvedValue({ incidents: [], total: 0 });

      const response = await request(app).get(
        '/api/incidents?type=safety,security&severity=high&status=open&robotId=r1&startDate=2026-01-01&endDate=2026-02-01&page=2&limit=10&sortBy=severity&sortOrder=asc'
      );

      expect(response.status).toBe(200);
      const callArg = mockIncidentService.listIncidents.mock.calls[0][0];
      expect(callArg.type).toEqual(['safety', 'security']);
      expect(callArg.severity).toBe('high');
      expect(callArg.status).toBe('open');
      expect(callArg.robotId).toBe('r1');
      expect(callArg.startDate).toBeInstanceOf(Date);
      expect(callArg.endDate).toBeInstanceOf(Date);
      expect(callArg.page).toBe(2);
      expect(callArg.limit).toBe(10);
      expect(callArg.sortBy).toBe('severity');
      expect(callArg.sortOrder).toBe('asc');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.listIncidents.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/incidents');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list incidents');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/dashboard
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/dashboard', () => {
    it('returns dashboard stats', async () => {
      mockIncidentService.getDashboardStats.mockResolvedValue({ total: 5, open: 2 });

      const response = await request(app).get('/api/incidents/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(5);
      expect(mockIncidentService.getDashboardStats).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.getDashboardStats.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/incidents/dashboard');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get dashboard stats');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/open
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/open', () => {
    it('returns open incidents wrapped in { incidents }', async () => {
      mockIncidentService.getOpenIncidents.mockResolvedValue([INCIDENT]);

      const response = await request(app).get('/api/incidents/open');

      expect(response.status).toBe(200);
      expect(response.body.incidents).toHaveLength(1);
      expect(mockIncidentService.getOpenIncidents).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.getOpenIncidents.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/incidents/open');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get open incidents');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/overdue
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/overdue', () => {
    it('returns overdue notifications wrapped in { notifications }', async () => {
      mockIncidentService.getOverdueNotifications.mockResolvedValue([{ id: 'n1' }]);

      const response = await request(app).get('/api/incidents/overdue');

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(1);
      expect(mockIncidentService.getOverdueNotifications).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.getOverdueNotifications.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/incidents/overdue');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get overdue notifications');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/risk-matrix
  // Registered before GET /:id so the literal route is reachable.
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/risk-matrix', () => {
    it('returns the risk matrix (no longer shadowed by /:id)', async () => {
      const matrix = [{ severity: 'high', likelihood: 'likely', risk: 'critical' }];
      mockBreachAssessmentService.getRiskMatrix.mockReturnValue(matrix);

      const response = await request(app).get('/api/incidents/risk-matrix');

      expect(response.status).toBe(200);
      expect(response.body.matrix).toEqual(matrix);
      expect(mockBreachAssessmentService.getRiskMatrix).toHaveBeenCalled();
      // The literal route now wins over /:id.
      expect(mockIncidentService.getIncident).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockBreachAssessmentService.getRiskMatrix.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/incidents/risk-matrix');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get risk matrix');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/:id
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/:id', () => {
    it('returns the incident', async () => {
      mockIncidentService.getIncident.mockResolvedValue(INCIDENT);

      const response = await request(app).get('/api/incidents/inc-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('inc-001');
      expect(mockIncidentService.getIncident).toHaveBeenCalledWith('inc-001');
    });

    it('returns 404 when not found', async () => {
      mockIncidentService.getIncident.mockResolvedValue(null);

      const response = await request(app).get('/api/incidents/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.getIncident.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/incidents/inc-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get incident');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents
  // --------------------------------------------------------------------------

  describe('POST /api/incidents', () => {
    it('creates an incident, captures snapshot, creates workflow, returns full incident', async () => {
      mockIncidentService.createIncident.mockResolvedValue({ id: 'inc-001' });
      mockIncidentService.captureSystemSnapshot.mockResolvedValue({ id: 'inc-001' });
      mockNotificationWorkflowService.createNotificationWorkflow.mockResolvedValue([]);
      mockIncidentService.getIncident.mockResolvedValue(INCIDENT);

      const response = await request(app).post('/api/incidents').send({
        type: 'safety',
        severity: 'high',
        title: 'Test Incident',
        description: 'Something happened',
        robotId: 'r1',
        detectedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('inc-001');
      expect(mockIncidentService.createIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'safety',
          severity: 'high',
          title: 'Test Incident',
          description: 'Something happened',
          robotId: 'r1',
          createdBy: 'user-123',
        })
      );
      expect(mockIncidentService.captureSystemSnapshot).toHaveBeenCalledWith('inc-001');
      expect(mockNotificationWorkflowService.createNotificationWorkflow).toHaveBeenCalledWith(
        'inc-001'
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post('/api/incidents').send({ type: 'safety' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields: type, title, description');
      expect(mockIncidentService.createIncident).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid type', async () => {
      const response = await request(app).post('/api/incidents').send({
        type: 'invalid',
        title: 'T',
        description: 'D',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid type. Must be one of:');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.createIncident.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/incidents').send({
        type: 'safety',
        title: 'T',
        description: 'D',
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create incident');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/incidents/:id
  // --------------------------------------------------------------------------

  describe('PATCH /api/incidents/:id', () => {
    it('updates only provided fields and sets resolvedAt on status=resolved', async () => {
      mockIncidentService.updateIncident.mockResolvedValue({ ...INCIDENT, status: 'resolved' });

      const response = await request(app).patch('/api/incidents/inc-001').send({
        status: 'resolved',
        rootCause: 'fixed',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('resolved');
      const [id, update] = mockIncidentService.updateIncident.mock.calls[0];
      expect(id).toBe('inc-001');
      expect(update.status).toBe('resolved');
      expect(update.rootCause).toBe('fixed');
      expect(update.resolvedAt).toBeInstanceOf(Date);
      expect(update).not.toHaveProperty('title');
    });

    it('returns 404 when incident not found', async () => {
      mockIncidentService.updateIncident.mockResolvedValue(null);

      const response = await request(app).patch('/api/incidents/missing').send({ title: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.updateIncident.mockRejectedValue(new Error('boom'));

      const response = await request(app).patch('/api/incidents/inc-001').send({ title: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update incident');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/incidents/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/incidents/:id', () => {
    it('deletes an incident', async () => {
      mockIncidentService.deleteIncident.mockResolvedValue(true);

      const response = await request(app).delete('/api/incidents/inc-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockIncidentService.deleteIncident).toHaveBeenCalledWith('inc-001');
    });

    it('returns 404 when not found', async () => {
      mockIncidentService.deleteIncident.mockResolvedValue(false);

      const response = await request(app).delete('/api/incidents/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.deleteIncident.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/incidents/inc-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete incident');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/:id/notifications
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/:id/notifications', () => {
    it('returns the notification timeline', async () => {
      mockNotificationWorkflowService.getNotificationTimeline.mockResolvedValue({
        incidentId: 'inc-001',
        notifications: [],
      });

      const response = await request(app).get('/api/incidents/inc-001/notifications');

      expect(response.status).toBe(200);
      expect(response.body.incidentId).toBe('inc-001');
      expect(mockNotificationWorkflowService.getNotificationTimeline).toHaveBeenCalledWith(
        'inc-001'
      );
    });

    it('returns 404 when timeline is null', async () => {
      mockNotificationWorkflowService.getNotificationTimeline.mockResolvedValue(null);

      const response = await request(app).get('/api/incidents/missing/notifications');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.getNotificationTimeline.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/incidents/inc-001/notifications');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get notification timeline');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents/:id/notifications
  // --------------------------------------------------------------------------

  describe('POST /api/incidents/:id/notifications', () => {
    it('creates a notification workflow', async () => {
      mockNotificationWorkflowService.createNotificationWorkflow.mockResolvedValue([{ id: 'n1' }]);

      const response = await request(app).post('/api/incidents/inc-001/notifications');

      expect(response.status).toBe(201);
      expect(response.body.notifications).toHaveLength(1);
      expect(mockNotificationWorkflowService.createNotificationWorkflow).toHaveBeenCalledWith(
        'inc-001'
      );
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.createNotificationWorkflow.mockRejectedValue(
        new Error('boom')
      );

      const response = await request(app).post('/api/incidents/inc-001/notifications');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create notification workflow');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents/:id/notifications/:notificationId/send
  // --------------------------------------------------------------------------

  describe('POST /api/incidents/:id/notifications/:notificationId/send', () => {
    it('marks a notification as sent', async () => {
      mockNotificationWorkflowService.markNotificationSent.mockResolvedValue({
        id: 'n1',
        status: 'sent',
      });

      const response = await request(app).post(
        '/api/incidents/inc-001/notifications/n1/send'
      );

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('sent');
      expect(mockNotificationWorkflowService.markNotificationSent).toHaveBeenCalledWith(
        'n1',
        'user-123'
      );
    });

    it('returns 404 when notification not found', async () => {
      mockNotificationWorkflowService.markNotificationSent.mockResolvedValue(null);

      const response = await request(app).post(
        '/api/incidents/inc-001/notifications/missing/send'
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Notification not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.markNotificationSent.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(
        '/api/incidents/inc-001/notifications/n1/send'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to mark notification as sent');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents/:id/notifications/:notificationId/generate
  // --------------------------------------------------------------------------

  describe('POST /api/incidents/:id/notifications/:notificationId/generate', () => {
    it('generates notification content', async () => {
      mockNotificationWorkflowService.generateNotificationContent.mockResolvedValue('content body');

      const response = await request(app)
        .post('/api/incidents/inc-001/notifications/n1/generate')
        .send({ templateId: 'tpl-1' });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('content body');
      expect(mockNotificationWorkflowService.generateNotificationContent).toHaveBeenCalledWith(
        'n1',
        'tpl-1'
      );
    });

    it('returns 404 when content is null', async () => {
      mockNotificationWorkflowService.generateNotificationContent.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/incidents/inc-001/notifications/n1/generate')
        .send({ templateId: 'tpl-1' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Notification or template not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.generateNotificationContent.mockRejectedValue(
        new Error('boom')
      );

      const response = await request(app)
        .post('/api/incidents/inc-001/notifications/n1/generate')
        .send({ templateId: 'tpl-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to generate notification content');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/incidents/:id/notifications/:notificationId
  // --------------------------------------------------------------------------

  describe('PATCH /api/incidents/:id/notifications/:notificationId', () => {
    it('updates notification content', async () => {
      mockNotificationWorkflowService.updateNotificationContent.mockResolvedValue({
        id: 'n1',
        content: 'new',
      });

      const response = await request(app)
        .patch('/api/incidents/inc-001/notifications/n1')
        .send({ content: 'new' });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('new');
      expect(mockNotificationWorkflowService.updateNotificationContent).toHaveBeenCalledWith(
        'n1',
        'new'
      );
    });

    it('returns 400 when content is missing', async () => {
      const response = await request(app)
        .patch('/api/incidents/inc-001/notifications/n1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Content is required');
      expect(mockNotificationWorkflowService.updateNotificationContent).not.toHaveBeenCalled();
    });

    it('returns 404 when notification not found', async () => {
      mockNotificationWorkflowService.updateNotificationContent.mockResolvedValue(null);

      const response = await request(app)
        .patch('/api/incidents/inc-001/notifications/missing')
        .send({ content: 'new' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Notification not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.updateNotificationContent.mockRejectedValue(
        new Error('boom')
      );

      const response = await request(app)
        .patch('/api/incidents/inc-001/notifications/n1')
        .send({ content: 'new' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update notification');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents/:id/assess
  // --------------------------------------------------------------------------

  describe('POST /api/incidents/:id/assess', () => {
    it('assesses risk for an incident', async () => {
      mockBreachAssessmentService.assessRisk.mockResolvedValue({ riskScore: 7 });

      const response = await request(app).post('/api/incidents/inc-001/assess');

      expect(response.status).toBe(200);
      expect(response.body.riskScore).toBe(7);
      expect(mockBreachAssessmentService.assessRisk).toHaveBeenCalledWith('inc-001', 'user-123');
    });

    it('returns 500 on service error', async () => {
      mockBreachAssessmentService.assessRisk.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/incidents/inc-001/assess');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to assess risk');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/:id/evidence
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/:id/evidence', () => {
    it('returns evidence references for an incident', async () => {
      mockIncidentService.getIncident.mockResolvedValue(INCIDENT);

      const response = await request(app).get('/api/incidents/inc-001/evidence');

      expect(response.status).toBe(200);
      expect(response.body.complianceLogIds).toEqual(['log-1']);
      expect(response.body.alertIds).toEqual(['alert-1']);
      expect(response.body.systemSnapshot).toEqual({ foo: 'bar' });
    });

    it('returns 404 when incident not found', async () => {
      mockIncidentService.getIncident.mockResolvedValue(null);

      const response = await request(app).get('/api/incidents/missing/evidence');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.getIncident.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/incidents/inc-001/evidence');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get evidence');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents/:id/evidence
  // --------------------------------------------------------------------------

  describe('POST /api/incidents/:id/evidence', () => {
    it('links evidence to an incident', async () => {
      mockIncidentService.linkEvidence.mockResolvedValue(INCIDENT);

      const response = await request(app)
        .post('/api/incidents/inc-001/evidence')
        .send({ complianceLogIds: ['log-2'], alertIds: ['alert-2'] });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('inc-001');
      expect(mockIncidentService.linkEvidence).toHaveBeenCalledWith(
        'inc-001',
        ['log-2'],
        ['alert-2']
      );
    });

    it('returns 404 when incident not found', async () => {
      mockIncidentService.linkEvidence.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/incidents/missing/evidence')
        .send({ complianceLogIds: [], alertIds: [] });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.linkEvidence.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/incidents/inc-001/evidence')
        .send({ complianceLogIds: [], alertIds: [] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to link evidence');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/incidents/:id/snapshot
  // --------------------------------------------------------------------------

  describe('POST /api/incidents/:id/snapshot', () => {
    it('captures a system snapshot', async () => {
      mockIncidentService.captureSystemSnapshot.mockResolvedValue(INCIDENT);

      const response = await request(app).post('/api/incidents/inc-001/snapshot');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('inc-001');
      expect(mockIncidentService.captureSystemSnapshot).toHaveBeenCalledWith('inc-001');
    });

    it('returns 404 when incident not found', async () => {
      mockIncidentService.captureSystemSnapshot.mockResolvedValue(null);

      const response = await request(app).post('/api/incidents/missing/snapshot');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('returns 500 on service error', async () => {
      mockIncidentService.captureSystemSnapshot.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/incidents/inc-001/snapshot');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to capture snapshot');
    });
  });

  // --------------------------------------------------------------------------
  // Notification Templates: GET /api/notification-templates
  // --------------------------------------------------------------------------

  describe('GET /api/notification-templates', () => {
    it('returns all templates', async () => {
      mockNotificationWorkflowService.getTemplates.mockResolvedValue([{ id: 'tpl-1' }]);

      const response = await request(app).get('/api/notification-templates');

      expect(response.status).toBe(200);
      expect(response.body.templates).toHaveLength(1);
      expect(mockNotificationWorkflowService.getTemplates).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.getTemplates.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/notification-templates');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get templates');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/notification-templates/:id
  // --------------------------------------------------------------------------

  describe('GET /api/notification-templates/:id', () => {
    it('returns a template by id', async () => {
      mockNotificationWorkflowService.getTemplate.mockResolvedValue({ id: 'tpl-1' });

      const response = await request(app).get('/api/notification-templates/tpl-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('tpl-1');
      expect(mockNotificationWorkflowService.getTemplate).toHaveBeenCalledWith('tpl-1');
    });

    it('returns 404 when template not found', async () => {
      mockNotificationWorkflowService.getTemplate.mockResolvedValue(null);

      const response = await request(app).get('/api/notification-templates/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Template not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.getTemplate.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/notification-templates/tpl-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get template');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/notification-templates
  // --------------------------------------------------------------------------

  describe('POST /api/notification-templates', () => {
    it('creates a template', async () => {
      mockNotificationWorkflowService.createTemplate.mockResolvedValue({ id: 'tpl-1' });

      const body = {
        name: 'GDPR Breach',
        regulation: 'GDPR',
        authority: 'DPA',
        type: 'authority',
        subject: 'Breach Notice',
        body: 'Hello',
        isDefault: true,
      };

      const response = await request(app).post('/api/notification-templates').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('tpl-1');
      expect(mockNotificationWorkflowService.createTemplate).toHaveBeenCalledWith(body);
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/notification-templates')
        .send({ name: 'Partial' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'Missing required fields: name, regulation, authority, type, subject, body'
      );
      expect(mockNotificationWorkflowService.createTemplate).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.createTemplate.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/notification-templates').send({
        name: 'n',
        regulation: 'r',
        authority: 'a',
        type: 't',
        subject: 's',
        body: 'b',
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create template');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/notification-templates/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/notification-templates/:id', () => {
    it('updates a template', async () => {
      mockNotificationWorkflowService.updateTemplate.mockResolvedValue({ id: 'tpl-1' });

      const response = await request(app)
        .put('/api/notification-templates/tpl-1')
        .send({ name: 'Updated', subject: 'S', body: 'B', isDefault: false });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('tpl-1');
      expect(mockNotificationWorkflowService.updateTemplate).toHaveBeenCalledWith('tpl-1', {
        name: 'Updated',
        subject: 'S',
        body: 'B',
        isDefault: false,
      });
    });

    it('returns 404 when template not found', async () => {
      mockNotificationWorkflowService.updateTemplate.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/notification-templates/missing')
        .send({ name: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Template not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.updateTemplate.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put('/api/notification-templates/tpl-1')
        .send({ name: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update template');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/notification-templates/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/notification-templates/:id', () => {
    it('deletes a template', async () => {
      mockNotificationWorkflowService.deleteTemplate.mockResolvedValue(true);

      const response = await request(app).delete('/api/notification-templates/tpl-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockNotificationWorkflowService.deleteTemplate).toHaveBeenCalledWith('tpl-1');
    });

    it('returns 404 when template not found', async () => {
      mockNotificationWorkflowService.deleteTemplate.mockResolvedValue(false);

      const response = await request(app).delete('/api/notification-templates/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Template not found');
    });

    it('returns 500 on service error', async () => {
      mockNotificationWorkflowService.deleteTemplate.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/notification-templates/tpl-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete template');
    });
  });
});

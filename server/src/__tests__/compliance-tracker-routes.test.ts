/**
 * @file compliance-tracker-routes.test.ts
 * @description Integration tests for compliance tracker routes
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockComplianceTrackerService } = vi.hoisted(() => ({
  mockComplianceTrackerService: {
    getDashboardStats: vi.fn(),
    getRegulatoryDeadlines: vi.fn(),
    createRegulatoryDeadline: vi.fn(),
    updateDeadlineProgress: vi.fn(),
    getGaps: vi.fn(),
    getGapSummaryByFramework: vi.fn(),
    createGap: vi.fn(),
    closeGap: vi.fn(),
    getExpiringDocuments: vi.fn(),
    getTrainingRecords: vi.fn(),
    getTrainingSummary: vi.fn(),
    createTrainingRecord: vi.fn(),
    getInspectionSchedules: vi.fn(),
    getInspectionSummary: vi.fn(),
    createInspectionSchedule: vi.fn(),
    recordInspectionCompletion: vi.fn(),
    getRiskAssessments: vi.fn(),
    createRiskAssessment: vi.fn(),
    updateRiskAssessment: vi.fn(),
    getRecentActivity: vi.fn(),
    initializeDefaults: vi.fn(),
  },
}));

vi.mock('../services/ComplianceTrackerService.js', () => ({
  complianceTrackerService: mockComplianceTrackerService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { complianceTrackerRoutes } from '../routes/compliance-tracker.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const BASE = '/api/compliance/tracker';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, authMiddleware as any, complianceTrackerRoutes);
  return app;
}

describe('Compliance Tracker Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /dashboard
  // --------------------------------------------------------------------------

  describe('GET /dashboard', () => {
    it('returns dashboard statistics', async () => {
      const stats = { overallScore: 87, openGaps: 3 };
      mockComplianceTrackerService.getDashboardStats.mockResolvedValue(stats);

      const response = await request(app).get(`${BASE}/dashboard`);

      expect(response.status).toBe(200);
      expect(response.body.overallScore).toBe(87);
      expect(mockComplianceTrackerService.getDashboardStats).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getDashboardStats.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/dashboard`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch dashboard statistics');
    });
  });

  // --------------------------------------------------------------------------
  // GET /deadlines
  // --------------------------------------------------------------------------

  describe('GET /deadlines', () => {
    it('returns regulatory deadlines wrapped in { deadlines }', async () => {
      const deadlines = [{ id: 'd1', name: 'EU AI Act' }];
      mockComplianceTrackerService.getRegulatoryDeadlines.mockResolvedValue(deadlines);

      const response = await request(app).get(`${BASE}/deadlines`);

      expect(response.status).toBe(200);
      expect(response.body.deadlines).toEqual(deadlines);
      expect(mockComplianceTrackerService.getRegulatoryDeadlines).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getRegulatoryDeadlines.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/deadlines`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch regulatory deadlines');
    });
  });

  // --------------------------------------------------------------------------
  // POST /deadlines
  // --------------------------------------------------------------------------

  describe('POST /deadlines', () => {
    const validBody = {
      framework: 'EU_AI_ACT',
      name: 'High-risk classification',
      deadline: '2026-08-01T00:00:00.000Z',
      description: 'Classify systems',
      requirements: ['req-1', 'req-2'],
      priority: 'high',
      notes: 'note',
    };

    it('creates a deadline and returns 201', async () => {
      const created = { id: 'd1', ...validBody };
      mockComplianceTrackerService.createRegulatoryDeadline.mockResolvedValue(created);

      const response = await request(app).post(`${BASE}/deadlines`).send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('d1');
      expect(mockComplianceTrackerService.createRegulatoryDeadline).toHaveBeenCalledWith(
        expect.objectContaining({
          framework: 'EU_AI_ACT',
          name: 'High-risk classification',
          deadline: new Date(validBody.deadline),
          description: 'Classify systems',
          requirements: ['req-1', 'req-2'],
          priority: 'high',
          notes: 'note',
        }),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post(`${BASE}/deadlines`).send({ name: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockComplianceTrackerService.createRegulatoryDeadline).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.createRegulatoryDeadline.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(`${BASE}/deadlines`).send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create regulatory deadline');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /deadlines/:id/progress
  // --------------------------------------------------------------------------

  describe('PUT /deadlines/:id/progress', () => {
    it('updates deadline progress', async () => {
      const updated = { id: 'd1', progress: 50 };
      mockComplianceTrackerService.updateDeadlineProgress.mockResolvedValue(updated);

      const response = await request(app)
        .put(`${BASE}/deadlines/d1/progress`)
        .send({ completedRequirements: ['req-1'] });

      expect(response.status).toBe(200);
      expect(response.body.progress).toBe(50);
      expect(mockComplianceTrackerService.updateDeadlineProgress).toHaveBeenCalledWith('d1', [
        'req-1',
      ]);
    });

    it('returns 400 when completedRequirements is not an array', async () => {
      const response = await request(app)
        .put(`${BASE}/deadlines/d1/progress`)
        .send({ completedRequirements: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('completedRequirements must be an array');
      expect(mockComplianceTrackerService.updateDeadlineProgress).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.updateDeadlineProgress.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put(`${BASE}/deadlines/d1/progress`)
        .send({ completedRequirements: [] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update deadline progress');
    });
  });

  // --------------------------------------------------------------------------
  // GET /gaps
  // --------------------------------------------------------------------------

  describe('GET /gaps', () => {
    it('returns gaps and forwards query filters', async () => {
      const gaps = [{ id: 'g1' }];
      mockComplianceTrackerService.getGaps.mockResolvedValue(gaps);

      const response = await request(app)
        .get(`${BASE}/gaps`)
        .query({ framework: 'EU_AI_ACT', severity: 'high', status: 'open' });

      expect(response.status).toBe(200);
      expect(response.body.gaps).toEqual(gaps);
      expect(mockComplianceTrackerService.getGaps).toHaveBeenCalledWith({
        framework: 'EU_AI_ACT',
        severity: 'high',
        status: 'open',
      });
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getGaps.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/gaps`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch compliance gaps');
    });
  });

  // --------------------------------------------------------------------------
  // GET /gaps/summary
  // --------------------------------------------------------------------------

  describe('GET /gaps/summary', () => {
    it('returns gap summary', async () => {
      const summary = { EU_AI_ACT: { open: 2 } };
      mockComplianceTrackerService.getGapSummaryByFramework.mockResolvedValue(summary);

      const response = await request(app).get(`${BASE}/gaps/summary`);

      expect(response.status).toBe(200);
      expect(response.body.summary).toEqual(summary);
      expect(mockComplianceTrackerService.getGapSummaryByFramework).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getGapSummaryByFramework.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/gaps/summary`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch gap summary');
    });
  });

  // --------------------------------------------------------------------------
  // POST /gaps
  // --------------------------------------------------------------------------

  describe('POST /gaps', () => {
    const validBody = {
      framework: 'EU_AI_ACT',
      requirement: 'Logging',
      articleReference: 'Art. 12',
      severity: 'high',
      description: 'desc',
      currentState: 'none',
      targetState: 'full',
      remediation: 'implement logging',
      estimatedEffort: '2w',
      dueDate: '2026-09-01T00:00:00.000Z',
      assignedTo: 'user-1',
    };

    it('creates a gap and returns 201', async () => {
      const gap = { id: 'g1', ...validBody };
      mockComplianceTrackerService.createGap.mockResolvedValue(gap);

      const response = await request(app).post(`${BASE}/gaps`).send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('g1');
      expect(mockComplianceTrackerService.createGap).toHaveBeenCalledWith(
        expect.objectContaining({
          framework: 'EU_AI_ACT',
          requirement: 'Logging',
          articleReference: 'Art. 12',
          severity: 'high',
          dueDate: new Date(validBody.dueDate),
          assignedTo: 'user-1',
        }),
      );
    });

    it('passes dueDate undefined when not provided', async () => {
      mockComplianceTrackerService.createGap.mockResolvedValue({ id: 'g2' });
      const { dueDate: _drop, ...noDate } = validBody;

      const response = await request(app).post(`${BASE}/gaps`).send(noDate);

      expect(response.status).toBe(201);
      expect(mockComplianceTrackerService.createGap).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: undefined }),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post(`${BASE}/gaps`).send({ framework: 'EU_AI_ACT' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockComplianceTrackerService.createGap).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.createGap.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(`${BASE}/gaps`).send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create compliance gap');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /gaps/:id/close
  // --------------------------------------------------------------------------

  describe('PUT /gaps/:id/close', () => {
    it('closes a gap', async () => {
      const gap = { id: 'g1', status: 'closed' };
      mockComplianceTrackerService.closeGap.mockResolvedValue(gap);

      const response = await request(app)
        .put(`${BASE}/gaps/g1/close`)
        .send({ closedBy: 'user-1' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('closed');
      expect(mockComplianceTrackerService.closeGap).toHaveBeenCalledWith('g1', 'user-1');
    });

    it('returns 400 when closedBy is missing', async () => {
      const response = await request(app).put(`${BASE}/gaps/g1/close`).send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('closedBy is required');
      expect(mockComplianceTrackerService.closeGap).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.closeGap.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put(`${BASE}/gaps/g1/close`)
        .send({ closedBy: 'user-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to close compliance gap');
    });
  });

  // --------------------------------------------------------------------------
  // GET /documents/expiring
  // --------------------------------------------------------------------------

  describe('GET /documents/expiring', () => {
    it('returns expiring documents with default 30 days', async () => {
      const documents = [{ id: 'doc1' }];
      mockComplianceTrackerService.getExpiringDocuments.mockResolvedValue(documents);

      const response = await request(app).get(`${BASE}/documents/expiring`);

      expect(response.status).toBe(200);
      expect(response.body.documents).toEqual(documents);
      expect(mockComplianceTrackerService.getExpiringDocuments).toHaveBeenCalledWith(30);
    });

    it('forwards withinDays query param', async () => {
      mockComplianceTrackerService.getExpiringDocuments.mockResolvedValue([]);

      const response = await request(app)
        .get(`${BASE}/documents/expiring`)
        .query({ withinDays: '90' });

      expect(response.status).toBe(200);
      expect(mockComplianceTrackerService.getExpiringDocuments).toHaveBeenCalledWith(90);
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getExpiringDocuments.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/documents/expiring`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch expiring documents');
    });
  });

  // --------------------------------------------------------------------------
  // GET /training
  // --------------------------------------------------------------------------

  describe('GET /training', () => {
    it('returns training records and forwards filters', async () => {
      const records = [{ id: 't1' }];
      mockComplianceTrackerService.getTrainingRecords.mockResolvedValue(records);

      const response = await request(app)
        .get(`${BASE}/training`)
        .query({ userId: 'u1', trainingType: 'SAFETY', status: 'valid' });

      expect(response.status).toBe(200);
      expect(response.body.records).toEqual(records);
      expect(mockComplianceTrackerService.getTrainingRecords).toHaveBeenCalledWith({
        userId: 'u1',
        trainingType: 'SAFETY',
        status: 'valid',
      });
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getTrainingRecords.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/training`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch training records');
    });
  });

  // --------------------------------------------------------------------------
  // GET /training/summary
  // --------------------------------------------------------------------------

  describe('GET /training/summary', () => {
    it('returns training summary', async () => {
      const summary = { valid: 5, expired: 1 };
      mockComplianceTrackerService.getTrainingSummary.mockResolvedValue(summary);

      const response = await request(app).get(`${BASE}/training/summary`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(5);
      expect(mockComplianceTrackerService.getTrainingSummary).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getTrainingSummary.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/training/summary`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch training summary');
    });
  });

  // --------------------------------------------------------------------------
  // POST /training
  // --------------------------------------------------------------------------

  describe('POST /training', () => {
    const validBody = {
      userId: 'u1',
      userName: 'Alice',
      userEmail: 'alice@example.com',
      trainingType: 'SAFETY',
      completedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      certificateUrl: 'https://example.com/cert',
      trainingProvider: 'DGUV',
      notes: 'ok',
    };

    it('creates a training record and returns 201', async () => {
      const record = { id: 't1', ...validBody };
      mockComplianceTrackerService.createTrainingRecord.mockResolvedValue(record);

      const response = await request(app).post(`${BASE}/training`).send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('t1');
      expect(mockComplianceTrackerService.createTrainingRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          userName: 'Alice',
          trainingType: 'SAFETY',
          completedAt: new Date(validBody.completedAt),
          expiresAt: new Date(validBody.expiresAt),
        }),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post(`${BASE}/training`).send({ userId: 'u1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockComplianceTrackerService.createTrainingRecord).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.createTrainingRecord.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(`${BASE}/training`).send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create training record');
    });
  });

  // --------------------------------------------------------------------------
  // GET /inspections
  // --------------------------------------------------------------------------

  describe('GET /inspections', () => {
    it('returns inspection schedules and forwards filters', async () => {
      const schedules = [{ id: 's1' }];
      mockComplianceTrackerService.getInspectionSchedules.mockResolvedValue(schedules);

      const response = await request(app)
        .get(`${BASE}/inspections`)
        .query({ robotId: 'r1', inspectionType: 'ELECTRICAL', status: 'overdue' });

      expect(response.status).toBe(200);
      expect(response.body.schedules).toEqual(schedules);
      expect(mockComplianceTrackerService.getInspectionSchedules).toHaveBeenCalledWith({
        robotId: 'r1',
        inspectionType: 'ELECTRICAL',
        status: 'overdue',
      });
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getInspectionSchedules.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/inspections`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch inspection schedules');
    });
  });

  // --------------------------------------------------------------------------
  // GET /inspections/summary
  // --------------------------------------------------------------------------

  describe('GET /inspections/summary', () => {
    it('returns inspection summary', async () => {
      const summary = { current: 3, overdue: 1 };
      mockComplianceTrackerService.getInspectionSummary.mockResolvedValue(summary);

      const response = await request(app).get(`${BASE}/inspections/summary`);

      expect(response.status).toBe(200);
      expect(response.body.overdue).toBe(1);
      expect(mockComplianceTrackerService.getInspectionSummary).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getInspectionSummary.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/inspections/summary`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch inspection summary');
    });
  });

  // --------------------------------------------------------------------------
  // POST /inspections
  // --------------------------------------------------------------------------

  describe('POST /inspections', () => {
    const validBody = {
      inspectionType: 'ELECTRICAL',
      robotId: 'r1',
      robotName: 'Robo',
      lastInspectionDate: '2025-01-01T00:00:00.000Z',
      nextDueDate: '2026-01-01T00:00:00.000Z',
      intervalYears: 1,
      inspectorName: 'Bob',
      inspectorCompany: 'TUV',
      reportUrl: 'https://example.com/report',
      notes: 'fine',
    };

    it('creates an inspection schedule and returns 201', async () => {
      const schedule = { id: 's1', ...validBody };
      mockComplianceTrackerService.createInspectionSchedule.mockResolvedValue(schedule);

      const response = await request(app).post(`${BASE}/inspections`).send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('s1');
      expect(mockComplianceTrackerService.createInspectionSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          inspectionType: 'ELECTRICAL',
          lastInspectionDate: new Date(validBody.lastInspectionDate),
          nextDueDate: new Date(validBody.nextDueDate),
          intervalYears: 1,
        }),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post(`${BASE}/inspections`)
        .send({ inspectionType: 'ELECTRICAL' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockComplianceTrackerService.createInspectionSchedule).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.createInspectionSchedule.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(`${BASE}/inspections`).send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create inspection schedule');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /inspections/:id/complete
  // --------------------------------------------------------------------------

  describe('PUT /inspections/:id/complete', () => {
    it('records inspection completion', async () => {
      const schedule = { id: 's1', status: 'current' };
      mockComplianceTrackerService.recordInspectionCompletion.mockResolvedValue(schedule);

      const response = await request(app)
        .put(`${BASE}/inspections/s1/complete`)
        .send({ reportUrl: 'https://example.com/r', inspectorName: 'Bob' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('current');
      expect(mockComplianceTrackerService.recordInspectionCompletion).toHaveBeenCalledWith(
        's1',
        'https://example.com/r',
        'Bob',
      );
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.recordInspectionCompletion.mockRejectedValue(new Error('boom'));

      const response = await request(app).put(`${BASE}/inspections/s1/complete`).send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to record inspection completion');
    });
  });

  // --------------------------------------------------------------------------
  // GET /risk-assessments
  // --------------------------------------------------------------------------

  describe('GET /risk-assessments', () => {
    it('returns risk assessments and forwards filters', async () => {
      const assessments = [{ id: 'ra1' }];
      mockComplianceTrackerService.getRiskAssessments.mockResolvedValue(assessments);

      const response = await request(app)
        .get(`${BASE}/risk-assessments`)
        .query({ assessmentType: 'MACHINE', status: 'current' });

      expect(response.status).toBe(200);
      expect(response.body.assessments).toEqual(assessments);
      expect(mockComplianceTrackerService.getRiskAssessments).toHaveBeenCalledWith({
        assessmentType: 'MACHINE',
        status: 'current',
      });
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getRiskAssessments.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/risk-assessments`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch risk assessments');
    });
  });

  // --------------------------------------------------------------------------
  // POST /risk-assessments
  // --------------------------------------------------------------------------

  describe('POST /risk-assessments', () => {
    const validBody = {
      assessmentType: 'MACHINE',
      name: 'Arm risk',
      version: '1.0',
      description: 'desc',
      lastUpdated: '2026-01-01T00:00:00.000Z',
      nextReviewDate: '2027-01-01T00:00:00.000Z',
      triggerConditions: ['new robot'],
      documentUrl: 'https://example.com/doc',
      responsiblePerson: 'Carol',
    };

    it('creates a risk assessment and returns 201', async () => {
      const assessment = { id: 'ra1', ...validBody };
      mockComplianceTrackerService.createRiskAssessment.mockResolvedValue(assessment);

      const response = await request(app).post(`${BASE}/risk-assessments`).send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('ra1');
      expect(mockComplianceTrackerService.createRiskAssessment).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentType: 'MACHINE',
          name: 'Arm risk',
          version: '1.0',
          lastUpdated: new Date(validBody.lastUpdated),
          nextReviewDate: new Date(validBody.nextReviewDate),
        }),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post(`${BASE}/risk-assessments`)
        .send({ name: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockComplianceTrackerService.createRiskAssessment).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.createRiskAssessment.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(`${BASE}/risk-assessments`).send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create risk assessment');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /risk-assessments/:id/update
  // --------------------------------------------------------------------------

  describe('PUT /risk-assessments/:id/update', () => {
    it('updates a risk assessment version', async () => {
      const assessment = { id: 'ra1', version: '2.0' };
      mockComplianceTrackerService.updateRiskAssessment.mockResolvedValue(assessment);

      const response = await request(app)
        .put(`${BASE}/risk-assessments/ra1/update`)
        .send({
          newVersion: '2.0',
          nextReviewDate: '2028-01-01T00:00:00.000Z',
          documentUrl: 'https://example.com/doc2',
        });

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('2.0');
      expect(mockComplianceTrackerService.updateRiskAssessment).toHaveBeenCalledWith(
        'ra1',
        '2.0',
        new Date('2028-01-01T00:00:00.000Z'),
        'https://example.com/doc2',
      );
    });

    it('returns 400 when newVersion or nextReviewDate is missing', async () => {
      const response = await request(app)
        .put(`${BASE}/risk-assessments/ra1/update`)
        .send({ newVersion: '2.0' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('newVersion and nextReviewDate are required');
      expect(mockComplianceTrackerService.updateRiskAssessment).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.updateRiskAssessment.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put(`${BASE}/risk-assessments/ra1/update`)
        .send({ newVersion: '2.0', nextReviewDate: '2028-01-01T00:00:00.000Z' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update risk assessment');
    });
  });

  // --------------------------------------------------------------------------
  // GET /activity
  // --------------------------------------------------------------------------

  describe('GET /activity', () => {
    it('returns activity with default limit of 20', async () => {
      const activity = [{ id: 'a1' }];
      mockComplianceTrackerService.getRecentActivity.mockResolvedValue(activity);

      const response = await request(app).get(`${BASE}/activity`);

      expect(response.status).toBe(200);
      expect(response.body.activity).toEqual(activity);
      expect(mockComplianceTrackerService.getRecentActivity).toHaveBeenCalledWith(20);
    });

    it('forwards limit query param', async () => {
      mockComplianceTrackerService.getRecentActivity.mockResolvedValue([]);

      const response = await request(app).get(`${BASE}/activity`).query({ limit: '5' });

      expect(response.status).toBe(200);
      expect(mockComplianceTrackerService.getRecentActivity).toHaveBeenCalledWith(5);
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.getRecentActivity.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/activity`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch compliance activity');
    });
  });

  // --------------------------------------------------------------------------
  // POST /initialize
  // --------------------------------------------------------------------------

  describe('POST /initialize', () => {
    it('initializes default deadlines', async () => {
      mockComplianceTrackerService.initializeDefaults.mockResolvedValue(undefined);

      const response = await request(app).post(`${BASE}/initialize`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Default regulatory deadlines initialized');
      expect(mockComplianceTrackerService.initializeDefaults).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockComplianceTrackerService.initializeDefaults.mockRejectedValue(new Error('boom'));

      const response = await request(app).post(`${BASE}/initialize`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to initialize defaults');
    });
  });
});

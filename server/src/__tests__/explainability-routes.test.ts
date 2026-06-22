/**
 * @file explainability-routes.test.ts
 * @description Integration tests for AI explainability routes (EU AI Act Art. 13, Art. 50)
 * @feature explainability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockExplainabilityService } = vi.hoisted(() => ({
  mockExplainabilityService: {
    listDecisions: vi.fn(),
    getDecision: vi.fn(),
    getFormattedExplanation: vi.fn(),
    getDecisionByEntityId: vi.fn(),
    storeDecision: vi.fn(),
    deleteDecision: vi.fn(),
    getPerformanceMetrics: vi.fn(),
    getDocumentation: vi.fn(),
    getLimitations: vi.fn(),
    getOperatingConditions: vi.fn(),
    getHumanOversightRequirements: vi.fn(),
  },
}));

vi.mock('../services/ExplainabilityService.js', () => ({
  explainabilityService: mockExplainabilityService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { explainabilityRoutes } from '../routes/explainability.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/explainability', authMiddleware as any, explainabilityRoutes);
  return app;
}

const DECISION = {
  id: 'decision-001',
  decisionType: 'navigation',
  entityId: 'task-001',
  robotId: 'robot-001',
  inputFactors: { obstacleDetected: false },
  reasoning: ['Path is clear', 'Battery sufficient'],
  modelUsed: 'gemini-2.5-flash',
  confidence: 0.92,
  alternatives: [],
  safetyFactors: { classification: 'safe', warnings: [], constraints: [] },
  createdAt: '2026-02-26T00:00:00.000Z',
};

describe('Explainability Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /decisions
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/decisions', () => {
    it('lists decisions with default pagination', async () => {
      const result = { decisions: [DECISION], total: 1, page: 1, pageSize: 50 };
      mockExplainabilityService.listDecisions.mockResolvedValue(result);

      const response = await request(app).get('/api/explainability/decisions');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.decisions).toHaveLength(1);
      expect(mockExplainabilityService.listDecisions).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        robotId: undefined,
        decisionType: undefined,
        startDate: undefined,
        endDate: undefined,
      });
    });

    it('parses query filters and pagination', async () => {
      mockExplainabilityService.listDecisions.mockResolvedValue({
        decisions: [],
        total: 0,
        page: 2,
        pageSize: 10,
      });

      const response = await request(app)
        .get('/api/explainability/decisions')
        .query({
          page: '2',
          pageSize: '10',
          robotId: 'robot-001',
          decisionType: 'navigation',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-02-01T00:00:00.000Z',
        });

      expect(response.status).toBe(200);
      const callArg = mockExplainabilityService.listDecisions.mock.calls[0][0];
      expect(callArg.page).toBe(2);
      expect(callArg.pageSize).toBe(10);
      expect(callArg.robotId).toBe('robot-001');
      expect(callArg.decisionType).toBe('navigation');
      expect(callArg.startDate).toBeInstanceOf(Date);
      expect(callArg.endDate).toBeInstanceOf(Date);
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.listDecisions.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/explainability/decisions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch decisions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /decisions/:id
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/decisions/:id', () => {
    it('returns a decision by id', async () => {
      mockExplainabilityService.getDecision.mockResolvedValue(DECISION);

      const response = await request(app).get('/api/explainability/decisions/decision-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('decision-001');
      expect(mockExplainabilityService.getDecision).toHaveBeenCalledWith('decision-001');
    });

    it('returns 404 when decision not found', async () => {
      mockExplainabilityService.getDecision.mockResolvedValue(null);

      const response = await request(app).get('/api/explainability/decisions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Decision not found');
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getDecision.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/explainability/decisions/decision-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch decision');
    });
  });

  // --------------------------------------------------------------------------
  // GET /decisions/:id/explanation
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/decisions/:id/explanation', () => {
    it('returns formatted explanation', async () => {
      const explanation = { summary: 'Robot chose to navigate', details: ['clear path'] };
      mockExplainabilityService.getFormattedExplanation.mockResolvedValue(explanation);

      const response = await request(app).get(
        '/api/explainability/decisions/decision-001/explanation'
      );

      expect(response.status).toBe(200);
      expect(response.body.summary).toBe('Robot chose to navigate');
      expect(mockExplainabilityService.getFormattedExplanation).toHaveBeenCalledWith('decision-001');
    });

    it('returns 404 when explanation not found', async () => {
      mockExplainabilityService.getFormattedExplanation.mockResolvedValue(null);

      const response = await request(app).get(
        '/api/explainability/decisions/missing/explanation'
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Decision not found');
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getFormattedExplanation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(
        '/api/explainability/decisions/decision-001/explanation'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch explanation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /decisions/entity/:entityId
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/decisions/entity/:entityId', () => {
    it('returns a decision by entity id', async () => {
      mockExplainabilityService.getDecisionByEntityId.mockResolvedValue(DECISION);

      const response = await request(app).get(
        '/api/explainability/decisions/entity/task-001'
      );

      expect(response.status).toBe(200);
      expect(response.body.entityId).toBe('task-001');
      expect(mockExplainabilityService.getDecisionByEntityId).toHaveBeenCalledWith('task-001');
    });

    it('returns 404 when no decision for entity', async () => {
      mockExplainabilityService.getDecisionByEntityId.mockResolvedValue(null);

      const response = await request(app).get(
        '/api/explainability/decisions/entity/missing'
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Decision not found for entity');
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getDecisionByEntityId.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(
        '/api/explainability/decisions/entity/task-001'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch decision');
    });
  });

  // --------------------------------------------------------------------------
  // POST /decisions
  // --------------------------------------------------------------------------

  describe('POST /api/explainability/decisions', () => {
    const validBody = {
      decisionType: 'navigation',
      entityId: 'task-001',
      robotId: 'robot-001',
      inputFactors: { obstacleDetected: false },
      reasoning: ['Path is clear'],
      modelUsed: 'gemini-2.5-flash',
      confidence: 0.92,
      alternatives: [],
      safetyFactors: { classification: 'safe', warnings: [], constraints: [] },
    };

    it('stores a decision and returns 201', async () => {
      mockExplainabilityService.storeDecision.mockResolvedValue(DECISION);

      const response = await request(app)
        .post('/api/explainability/decisions')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('decision-001');
      expect(mockExplainabilityService.storeDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'navigation',
          entityId: 'task-001',
          robotId: 'robot-001',
          modelUsed: 'gemini-2.5-flash',
          confidence: 0.92,
        })
      );
    });

    it('applies defaults for optional fields', async () => {
      mockExplainabilityService.storeDecision.mockResolvedValue(DECISION);

      const response = await request(app).post('/api/explainability/decisions').send({
        decisionType: 'navigation',
        entityId: 'task-001',
        robotId: 'robot-001',
        modelUsed: 'gemini-2.5-flash',
        confidence: 0.5,
      });

      expect(response.status).toBe(201);
      expect(mockExplainabilityService.storeDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          inputFactors: {},
          reasoning: [],
          alternatives: [],
          safetyFactors: { classification: 'safe', warnings: [], constraints: [] },
        })
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/explainability/decisions')
        .send({ entityId: 'task-001', robotId: 'robot-001' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockExplainabilityService.storeDecision).not.toHaveBeenCalled();
    });

    it('returns 400 when confidence is not a number', async () => {
      const response = await request(app)
        .post('/api/explainability/decisions')
        .send({ ...validBody, confidence: 'high' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid confidence');
      expect(mockExplainabilityService.storeDecision).not.toHaveBeenCalled();
    });

    it('returns 400 when confidence is out of range', async () => {
      const response = await request(app)
        .post('/api/explainability/decisions')
        .send({ ...validBody, confidence: 1.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid confidence');
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.storeDecision.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/explainability/decisions')
        .send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to store decision');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /decisions/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/explainability/decisions/:id', () => {
    it('deletes a decision', async () => {
      mockExplainabilityService.deleteDecision.mockResolvedValue(true);

      const response = await request(app).delete('/api/explainability/decisions/decision-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExplainabilityService.deleteDecision).toHaveBeenCalledWith('decision-001');
    });

    it('returns 404 when decision not found', async () => {
      mockExplainabilityService.deleteDecision.mockResolvedValue(false);

      const response = await request(app).delete('/api/explainability/decisions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Decision not found');
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.deleteDecision.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/explainability/decisions/decision-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete decision');
    });
  });

  // --------------------------------------------------------------------------
  // GET /metrics
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/metrics', () => {
    it('returns metrics with default period (weekly)', async () => {
      const metrics = { period: 'weekly', totalDecisions: 5 };
      mockExplainabilityService.getPerformanceMetrics.mockResolvedValue(metrics);

      const response = await request(app).get('/api/explainability/metrics');

      expect(response.status).toBe(200);
      expect(response.body.period).toBe('weekly');
      expect(mockExplainabilityService.getPerformanceMetrics).toHaveBeenCalledWith(
        'weekly',
        undefined
      );
    });

    it('honors a valid period and robotId filter', async () => {
      mockExplainabilityService.getPerformanceMetrics.mockResolvedValue({ period: 'daily' });

      const response = await request(app)
        .get('/api/explainability/metrics')
        .query({ period: 'daily', robotId: 'robot-001' });

      expect(response.status).toBe(200);
      expect(mockExplainabilityService.getPerformanceMetrics).toHaveBeenCalledWith(
        'daily',
        'robot-001'
      );
    });

    it('falls back to weekly for an invalid period', async () => {
      mockExplainabilityService.getPerformanceMetrics.mockResolvedValue({ period: 'weekly' });

      const response = await request(app)
        .get('/api/explainability/metrics')
        .query({ period: 'yearly' });

      expect(response.status).toBe(200);
      expect(mockExplainabilityService.getPerformanceMetrics).toHaveBeenCalledWith(
        'weekly',
        undefined
      );
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getPerformanceMetrics.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/explainability/metrics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch metrics');
    });
  });

  // --------------------------------------------------------------------------
  // GET /documentation
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/documentation', () => {
    it('returns documentation', async () => {
      const doc = { systemName: 'NeoDEM AI', version: '1.0' };
      mockExplainabilityService.getDocumentation.mockReturnValue(doc);

      const response = await request(app).get('/api/explainability/documentation');

      expect(response.status).toBe(200);
      expect(response.body.systemName).toBe('NeoDEM AI');
      expect(mockExplainabilityService.getDocumentation).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getDocumentation.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/explainability/documentation');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch documentation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /limitations
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/limitations', () => {
    it('returns limitations wrapped in object', async () => {
      mockExplainabilityService.getLimitations.mockReturnValue(['No outdoor navigation']);

      const response = await request(app).get('/api/explainability/limitations');

      expect(response.status).toBe(200);
      expect(response.body.limitations).toEqual(['No outdoor navigation']);
      expect(mockExplainabilityService.getLimitations).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getLimitations.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/explainability/limitations');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch limitations');
    });
  });

  // --------------------------------------------------------------------------
  // GET /operating-conditions
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/operating-conditions', () => {
    it('returns operating conditions wrapped in object', async () => {
      mockExplainabilityService.getOperatingConditions.mockReturnValue(['Indoor only']);

      const response = await request(app).get('/api/explainability/operating-conditions');

      expect(response.status).toBe(200);
      expect(response.body.conditions).toEqual(['Indoor only']);
      expect(mockExplainabilityService.getOperatingConditions).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getOperatingConditions.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/explainability/operating-conditions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch operating conditions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /human-oversight
  // --------------------------------------------------------------------------

  describe('GET /api/explainability/human-oversight', () => {
    it('returns human oversight requirements wrapped in object', async () => {
      mockExplainabilityService.getHumanOversightRequirements.mockReturnValue([
        'Operator must approve high-risk actions',
      ]);

      const response = await request(app).get('/api/explainability/human-oversight');

      expect(response.status).toBe(200);
      expect(response.body.requirements).toEqual([
        'Operator must approve high-risk actions',
      ]);
      expect(mockExplainabilityService.getHumanOversightRequirements).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockExplainabilityService.getHumanOversightRequirements.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/explainability/human-oversight');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch human oversight requirements');
    });
  });
});

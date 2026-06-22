/**
 * @file federated-routes.test.ts
 * @description Integration tests for federated learning routes
 * @feature fleet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockFederatedService } = vi.hoisted(() => ({
  mockFederatedService: {
    createRound: vi.fn(),
    listRounds: vi.fn(),
    getRound: vi.fn(),
    getParticipantsForRound: vi.fn(),
    selectParticipants: vi.fn(),
    distributeModel: vi.fn(),
    submitModelUpdate: vi.fn(),
    aggregateUpdates: vi.fn(),
    finalizeRound: vi.fn(),
    markParticipantFailed: vi.fn(),
    getOrCreatePrivacyBudget: vi.fn(),
    listPrivacyBudgets: vi.fn(),
    resetPrivacyBudget: vi.fn(),
    computeROHEMetrics: vi.fn(),
    recordIntervention: vi.fn(),
  },
}));

vi.mock('../services/FederatedLearningService.js', () => ({
  federatedLearningService: mockFederatedService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { federatedRoutes } from '../routes/federated.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/federated', authMiddleware as any, federatedRoutes);
  return app;
}

const ROUND = {
  id: 'round-001',
  globalModelVersion: 'v1',
  status: 'created',
  completedParticipants: 0,
  newModelVersion: 'v2',
};

describe('Federated Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds', () => {
    it('creates a round (201)', async () => {
      mockFederatedService.createRound.mockResolvedValue(ROUND);

      const response = await request(app)
        .post('/api/federated/rounds')
        .send({ globalModelVersion: 'v1' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('round-001');
      expect(mockFederatedService.createRound).toHaveBeenCalledWith({
        globalModelVersion: 'v1',
      });
    });

    it('returns 400 when globalModelVersion missing', async () => {
      const response = await request(app).post('/api/federated/rounds').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('globalModelVersion is required');
      expect(mockFederatedService.createRound).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.createRound.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/federated/rounds')
        .send({ globalModelVersion: 'v1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create federated round');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/federated/rounds
  // --------------------------------------------------------------------------

  describe('GET /api/federated/rounds', () => {
    it('lists rounds with defaults', async () => {
      mockFederatedService.listRounds.mockResolvedValue({ rounds: [ROUND], total: 1 });

      const response = await request(app).get('/api/federated/rounds');

      expect(response.status).toBe(200);
      expect(response.body.rounds).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(response.body.limit).toBe(50);
      expect(response.body.offset).toBe(0);
      expect(mockFederatedService.listRounds).toHaveBeenCalledWith({
        status: undefined,
        globalModelVersion: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('parses query params', async () => {
      mockFederatedService.listRounds.mockResolvedValue({ rounds: [], total: 0 });

      const response = await request(app)
        .get('/api/federated/rounds')
        .query({ status: 'created', globalModelVersion: 'v1', limit: '10', offset: '5' });

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(5);
      expect(mockFederatedService.listRounds).toHaveBeenCalledWith({
        status: 'created',
        globalModelVersion: 'v1',
        limit: 10,
        offset: 5,
      });
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.listRounds.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/federated/rounds');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list rounds');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/federated/rounds/:id
  // --------------------------------------------------------------------------

  describe('GET /api/federated/rounds/:id', () => {
    it('returns round with participants', async () => {
      mockFederatedService.getRound.mockResolvedValue(ROUND);
      mockFederatedService.getParticipantsForRound.mockResolvedValue([{ id: 'p1' }]);

      const response = await request(app).get('/api/federated/rounds/round-001');

      expect(response.status).toBe(200);
      expect(response.body.round.id).toBe('round-001');
      expect(response.body.participants).toHaveLength(1);
      expect(mockFederatedService.getRound).toHaveBeenCalledWith('round-001');
      expect(mockFederatedService.getParticipantsForRound).toHaveBeenCalledWith('round-001');
    });

    it('returns 404 when round not found', async () => {
      mockFederatedService.getRound.mockResolvedValue(null);

      const response = await request(app).get('/api/federated/rounds/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Round not found');
      expect(mockFederatedService.getParticipantsForRound).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.getRound.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/federated/rounds/round-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get round');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds/:id/select-participants
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds/:id/select-participants', () => {
    it('selects participants', async () => {
      mockFederatedService.selectParticipants.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const response = await request(app)
        .post('/api/federated/rounds/round-001/select-participants')
        .send({ strategy: 'random' });

      expect(response.status).toBe(200);
      expect(response.body.roundId).toBe('round-001');
      expect(response.body.participantCount).toBe(2);
      expect(response.body.participants).toHaveLength(2);
      expect(mockFederatedService.selectParticipants).toHaveBeenCalledWith('round-001', {
        strategy: 'random',
      });
    });

    it('returns 400 for invalid strategy', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-001/select-participants')
        .send({ strategy: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid strategy');
      expect(mockFederatedService.selectParticipants).not.toHaveBeenCalled();
    });

    it('returns 400 on service error', async () => {
      mockFederatedService.selectParticipants.mockRejectedValue(new Error('no eligible robots'));

      const response = await request(app)
        .post('/api/federated/rounds/round-001/select-participants')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('no eligible robots');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds/:id/distribute
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds/:id/distribute', () => {
    it('distributes model', async () => {
      mockFederatedService.distributeModel.mockResolvedValue({ ...ROUND, status: 'distributing' });

      const response = await request(app).post('/api/federated/rounds/round-001/distribute');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Model distributed to participants');
      expect(response.body.status).toBe('distributing');
      expect(mockFederatedService.distributeModel).toHaveBeenCalledWith('round-001');
    });

    it('returns 400 on service error', async () => {
      mockFederatedService.distributeModel.mockRejectedValue(new Error('round not ready'));

      const response = await request(app).post('/api/federated/rounds/round-001/distribute');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('round not ready');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds/:id/updates
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds/:id/updates', () => {
    const validBody = {
      participantId: 'p1',
      robotId: 'r1',
      localSamples: 100,
      localLoss: 0.5,
      modelDelta: 'delta-data',
      updateHash: 'hash123',
    };

    it('submits a model update (201)', async () => {
      mockFederatedService.submitModelUpdate.mockResolvedValue({
        participantId: 'p1',
        localSamples: 100,
        localLoss: 0.5,
        uploadedAt: '2026-06-22T00:00:00.000Z',
      });
      mockFederatedService.getRound.mockResolvedValue({
        ...ROUND,
        status: 'collecting',
        completedParticipants: 1,
      });

      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.update.participantId).toBe('p1');
      expect(response.body.roundStatus).toBe('collecting');
      expect(response.body.completedParticipants).toBe(1);
      expect(mockFederatedService.submitModelUpdate).toHaveBeenCalledWith(validBody);
      expect(mockFederatedService.getRound).toHaveBeenCalledWith('round-001');
    });

    it('returns 400 when participantId missing', async () => {
      const { participantId, ...rest } = validBody;
      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('participantId is required');
      expect(mockFederatedService.submitModelUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when robotId missing', async () => {
      const { robotId, ...rest } = validBody;
      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
    });

    it('returns 400 when localSamples is not a positive integer', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send({ ...validBody, localSamples: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('localSamples must be a positive integer');
    });

    it('returns 400 when localLoss is not a number', async () => {
      const { localLoss, ...rest } = validBody;
      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('localLoss is required');
    });

    it('returns 400 when modelDelta missing', async () => {
      const { modelDelta, ...rest } = validBody;
      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('modelDelta is required');
    });

    it('returns 400 when updateHash missing', async () => {
      const { updateHash, ...rest } = validBody;
      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('updateHash is required');
    });

    it('returns 400 on service error', async () => {
      mockFederatedService.submitModelUpdate.mockRejectedValue(new Error('duplicate update'));

      const response = await request(app)
        .post('/api/federated/rounds/round-001/updates')
        .send(validBody);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('duplicate update');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds/:id/aggregate
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds/:id/aggregate', () => {
    it('aggregates and finalizes', async () => {
      mockFederatedService.aggregateUpdates.mockResolvedValue({
        participantCount: 3,
        totalSamples: 300,
      });
      mockFederatedService.finalizeRound.mockResolvedValue({
        ...ROUND,
        newModelVersion: 'v2',
      });

      const response = await request(app).post('/api/federated/rounds/round-001/aggregate');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Aggregation completed');
      expect(response.body.newModelVersion).toBe('v2');
      expect(response.body.participantCount).toBe(3);
      expect(response.body.totalSamples).toBe(300);
      expect(mockFederatedService.aggregateUpdates).toHaveBeenCalledWith('round-001');
      expect(mockFederatedService.finalizeRound).toHaveBeenCalledWith('round-001');
    });

    it('returns 400 on service error', async () => {
      mockFederatedService.aggregateUpdates.mockRejectedValue(new Error('not enough updates'));

      const response = await request(app).post('/api/federated/rounds/round-001/aggregate');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('not enough updates');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/participants/:id/fail
  // --------------------------------------------------------------------------

  describe('POST /api/federated/participants/:id/fail', () => {
    it('marks participant failed with reason', async () => {
      mockFederatedService.markParticipantFailed.mockResolvedValue({ id: 'p1', status: 'failed' });

      const response = await request(app)
        .post('/api/federated/participants/p1/fail')
        .send({ reason: 'timeout' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Participant marked as failed');
      expect(response.body.participant.id).toBe('p1');
      expect(mockFederatedService.markParticipantFailed).toHaveBeenCalledWith('p1', 'timeout');
    });

    it('defaults reason when not provided', async () => {
      mockFederatedService.markParticipantFailed.mockResolvedValue({ id: 'p1', status: 'failed' });

      const response = await request(app).post('/api/federated/participants/p1/fail').send({});

      expect(response.status).toBe(200);
      expect(mockFederatedService.markParticipantFailed).toHaveBeenCalledWith(
        'p1',
        'Unknown reason'
      );
    });

    it('returns 404 when participant not found', async () => {
      mockFederatedService.markParticipantFailed.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/federated/participants/missing/fail')
        .send({ reason: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Participant not found');
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.markParticipantFailed.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/federated/participants/p1/fail')
        .send({ reason: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to mark participant as failed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/federated/robots/:id/privacy-budget
  // --------------------------------------------------------------------------

  describe('GET /api/federated/robots/:id/privacy-budget', () => {
    it('returns privacy budget with canParticipate true', async () => {
      mockFederatedService.getOrCreatePrivacyBudget.mockResolvedValue({ remainingEpsilon: 5 });

      const response = await request(app).get('/api/federated/robots/r1/privacy-budget');

      expect(response.status).toBe(200);
      expect(response.body.robotId).toBe('r1');
      expect(response.body.canParticipate).toBe(true);
      expect(mockFederatedService.getOrCreatePrivacyBudget).toHaveBeenCalledWith('r1');
    });

    it('returns canParticipate false when epsilon exhausted', async () => {
      mockFederatedService.getOrCreatePrivacyBudget.mockResolvedValue({ remainingEpsilon: 0 });

      const response = await request(app).get('/api/federated/robots/r1/privacy-budget');

      expect(response.status).toBe(200);
      expect(response.body.canParticipate).toBe(false);
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.getOrCreatePrivacyBudget.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/federated/robots/r1/privacy-budget');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get privacy budget');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/federated/privacy-budgets
  // --------------------------------------------------------------------------

  describe('GET /api/federated/privacy-budgets', () => {
    it('lists privacy budgets', async () => {
      mockFederatedService.listPrivacyBudgets.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);

      const response = await request(app).get('/api/federated/privacy-budgets');

      expect(response.status).toBe(200);
      expect(response.body.budgets).toHaveLength(2);
      expect(response.body.count).toBe(2);
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.listPrivacyBudgets.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/federated/privacy-budgets');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list privacy budgets');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/robots/:id/privacy-budget/reset
  // --------------------------------------------------------------------------

  describe('POST /api/federated/robots/:id/privacy-budget/reset', () => {
    it('resets privacy budget', async () => {
      mockFederatedService.resetPrivacyBudget.mockResolvedValue({ remainingEpsilon: 10 });

      const response = await request(app).post('/api/federated/robots/r1/privacy-budget/reset');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Privacy budget reset');
      expect(response.body.budget.remainingEpsilon).toBe(10);
      expect(mockFederatedService.resetPrivacyBudget).toHaveBeenCalledWith('r1');
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.resetPrivacyBudget.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post('/api/federated/robots/r1/privacy-budget/reset');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reset privacy budget');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/federated/metrics/rohe
  // --------------------------------------------------------------------------

  describe('GET /api/federated/metrics/rohe', () => {
    it('computes ROHE metrics with defaults', async () => {
      mockFederatedService.computeROHEMetrics.mockResolvedValue({ rohe: 1.5 });

      const response = await request(app).get('/api/federated/metrics/rohe');

      expect(response.status).toBe(200);
      expect(response.body.rohe).toBe(1.5);
      expect(mockFederatedService.computeROHEMetrics).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        robotId: undefined,
        task: undefined,
      });
    });

    it('passes query filters through', async () => {
      mockFederatedService.computeROHEMetrics.mockResolvedValue({ rohe: 2 });

      const response = await request(app)
        .get('/api/federated/metrics/rohe')
        .query({ startDate: '2026-01-01', endDate: '2026-02-01', robotId: 'r1', task: 'pick' });

      expect(response.status).toBe(200);
      const call = mockFederatedService.computeROHEMetrics.mock.calls[0][0];
      expect(call.robotId).toBe('r1');
      expect(call.task).toBe('pick');
      expect(call.startDate).toBeInstanceOf(Date);
      expect(call.endDate).toBeInstanceOf(Date);
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.computeROHEMetrics.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/federated/metrics/rohe');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compute ROHE metrics');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/interventions
  // --------------------------------------------------------------------------

  describe('POST /api/federated/interventions', () => {
    const validBody = {
      robotId: 'r1',
      task: 'pick',
      type: 'correction' as const,
      confidenceBefore: 0.4,
      confidenceAfter: 0.9,
      description: 'fixed grasp',
    };

    it('records an intervention (201)', async () => {
      mockFederatedService.recordIntervention.mockResolvedValue({ id: 'int-1' });

      const response = await request(app)
        .post('/api/federated/interventions')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('int-1');
      expect(mockFederatedService.recordIntervention).toHaveBeenCalledWith(
        'r1',
        'pick',
        'correction',
        0.4,
        0.9,
        'fixed grasp'
      );
    });

    it('returns 400 when robotId missing', async () => {
      const { robotId, ...rest } = validBody;
      const response = await request(app).post('/api/federated/interventions').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
      expect(mockFederatedService.recordIntervention).not.toHaveBeenCalled();
    });

    it('returns 400 when task missing', async () => {
      const { task, ...rest } = validBody;
      const response = await request(app).post('/api/federated/interventions').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('task is required');
    });

    it('returns 400 when type missing', async () => {
      const { type, ...rest } = validBody;
      const response = await request(app).post('/api/federated/interventions').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('type is required');
    });

    it('returns 400 for invalid type', async () => {
      const response = await request(app)
        .post('/api/federated/interventions')
        .send({ ...validBody, type: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid type');
      expect(mockFederatedService.recordIntervention).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockFederatedService.recordIntervention.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/federated/interventions')
        .send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to record intervention');
    });
  });
});

/**
 * @file oversight-routes.test.ts
 * @description Integration tests for human oversight routes (EU AI Act Art. 14)
 * @feature oversight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockOversightService } = vi.hoisted(() => ({
  mockOversightService: {
    activateManualMode: vi.fn(),
    deactivateManualMode: vi.fn(),
    getRobotManualSession: vi.fn(),
    getManualSessionHistory: vi.fn(),
    getVerificationSchedules: vi.fn(),
    createVerificationSchedule: vi.fn(),
    getDueVerifications: vi.fn(),
    completeVerification: vi.fn(),
    updateVerificationSchedule: vi.fn(),
    deactivateVerificationSchedule: vi.fn(),
    getAnomalies: vi.fn(),
    getActiveAnomalies: vi.fn(),
    getUnacknowledgedAnomalies: vi.fn(),
    acknowledgeAnomaly: vi.fn(),
    resolveAnomaly: vi.fn(),
    getRobotCapabilitiesSummary: vi.fn(),
    getFleetCapabilitiesOverview: vi.fn(),
    getOversightLogs: vi.fn(),
    getDashboardStats: vi.fn(),
  },
}));

vi.mock('../services/OversightService.js', () => ({
  oversightService: mockOversightService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { oversightRoutes } from '../routes/oversight.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/oversight', authMiddleware as any, oversightRoutes);
  return app;
}

describe('Oversight Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/oversight/robots/:id/manual-mode
  // --------------------------------------------------------------------------

  describe('POST /api/oversight/robots/:id/manual-mode', () => {
    it('activates manual mode successfully', async () => {
      const result = { sessionId: 'sess-1', robotId: 'robot-1', active: true };
      mockOversightService.activateManualMode.mockResolvedValue(result);

      const response = await request(app)
        .post('/api/oversight/robots/robot-1/manual-mode')
        .send({ reason: 'maintenance', mode: 'reduced_speed', operatorId: 'op-1' });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe('sess-1');
      expect(mockOversightService.activateManualMode).toHaveBeenCalledWith({
        robotId: 'robot-1',
        operatorId: 'op-1',
        reason: 'maintenance',
        mode: 'reduced_speed',
      });
    });

    it('defaults operatorId to "system" when omitted', async () => {
      mockOversightService.activateManualMode.mockResolvedValue({ sessionId: 'sess-2' });

      const response = await request(app)
        .post('/api/oversight/robots/robot-1/manual-mode')
        .send({ reason: 'inspection' });

      expect(response.status).toBe(200);
      expect(mockOversightService.activateManualMode).toHaveBeenCalledWith({
        robotId: 'robot-1',
        operatorId: 'system',
        reason: 'inspection',
        mode: undefined,
      });
    });

    it('returns 400 when reason is missing', async () => {
      const response = await request(app)
        .post('/api/oversight/robots/robot-1/manual-mode')
        .send({ mode: 'full_speed' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reason is required');
      expect(mockOversightService.activateManualMode).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockOversightService.activateManualMode.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/oversight/robots/robot-1/manual-mode')
        .send({ reason: 'maintenance' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/oversight/robots/:id/manual-mode
  // --------------------------------------------------------------------------

  describe('DELETE /api/oversight/robots/:id/manual-mode', () => {
    it('deactivates manual mode successfully', async () => {
      mockOversightService.getRobotManualSession.mockResolvedValue({ id: 'sess-1' });
      mockOversightService.deactivateManualMode.mockResolvedValue({ id: 'sess-1', active: false });

      const response = await request(app)
        .delete('/api/oversight/robots/robot-1/manual-mode')
        .send({ operatorId: 'op-1' });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);
      expect(mockOversightService.getRobotManualSession).toHaveBeenCalledWith('robot-1');
      expect(mockOversightService.deactivateManualMode).toHaveBeenCalledWith('sess-1', 'op-1');
    });

    it('returns 404 when no active session exists', async () => {
      mockOversightService.getRobotManualSession.mockResolvedValue(null);

      const response = await request(app).delete('/api/oversight/robots/robot-1/manual-mode');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No active manual session for this robot');
      expect(mockOversightService.deactivateManualMode).not.toHaveBeenCalled();
    });

    it('returns 404 when deactivation returns null', async () => {
      mockOversightService.getRobotManualSession.mockResolvedValue({ id: 'sess-1' });
      mockOversightService.deactivateManualMode.mockResolvedValue(null);

      const response = await request(app).delete('/api/oversight/robots/robot-1/manual-mode');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getRobotManualSession.mockRejectedValue(new Error('db down'));

      const response = await request(app).delete('/api/oversight/robots/robot-1/manual-mode');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('db down');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/manual-sessions
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/manual-sessions', () => {
    it('returns manual session history with filters', async () => {
      const sessions = [{ id: 'sess-1' }, { id: 'sess-2' }];
      mockOversightService.getManualSessionHistory.mockResolvedValue(sessions);

      const response = await request(app)
        .get('/api/oversight/manual-sessions')
        .query({ robotId: 'robot-1', operatorId: 'op-1', isActive: 'true' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockOversightService.getManualSessionHistory).toHaveBeenCalledWith({
        robotId: 'robot-1',
        operatorId: 'op-1',
        isActive: true,
      });
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getManualSessionHistory.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/manual-sessions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/verifications
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/verifications', () => {
    it('returns verification schedules with filters', async () => {
      mockOversightService.getVerificationSchedules.mockResolvedValue([{ id: 'v-1' }]);

      const response = await request(app)
        .get('/api/oversight/verifications')
        .query({ isActive: 'false', robotScope: 'all', scopeId: 'zone-1' });

      expect(response.status).toBe(200);
      expect(response.body[0].id).toBe('v-1');
      expect(mockOversightService.getVerificationSchedules).toHaveBeenCalledWith({
        isActive: false,
        robotScope: 'all',
        scopeId: 'zone-1',
      });
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getVerificationSchedules.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/verifications');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/oversight/verifications
  // --------------------------------------------------------------------------

  describe('POST /api/oversight/verifications', () => {
    it('creates a verification schedule', async () => {
      const schedule = { id: 'v-1', name: 'Daily check' };
      mockOversightService.createVerificationSchedule.mockResolvedValue(schedule);

      const response = await request(app)
        .post('/api/oversight/verifications')
        .send({ name: 'Daily check', intervalMinutes: 60, robotScope: 'all' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('v-1');
      expect(mockOversightService.createVerificationSchedule).toHaveBeenCalledWith({
        name: 'Daily check',
        description: undefined,
        intervalMinutes: 60,
        robotScope: 'all',
        scopeId: undefined,
      });
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/oversight/verifications')
        .send({ intervalMinutes: 60 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Name and intervalMinutes are required');
      expect(mockOversightService.createVerificationSchedule).not.toHaveBeenCalled();
    });

    it('returns 400 when intervalMinutes is missing', async () => {
      const response = await request(app)
        .post('/api/oversight/verifications')
        .send({ name: 'Daily check' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Name and intervalMinutes are required');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.createVerificationSchedule.mockRejectedValue(new Error('fail'));

      const response = await request(app)
        .post('/api/oversight/verifications')
        .send({ name: 'Daily check', intervalMinutes: 60 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/verifications/due
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/verifications/due', () => {
    it('returns due verifications', async () => {
      mockOversightService.getDueVerifications.mockResolvedValue([{ id: 'v-1' }]);

      const response = await request(app).get('/api/oversight/verifications/due');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockOversightService.getDueVerifications).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getDueVerifications.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/verifications/due');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/oversight/verifications/:id/complete
  // --------------------------------------------------------------------------

  describe('POST /api/oversight/verifications/:id/complete', () => {
    it('completes a verification', async () => {
      const completion = { id: 'comp-1', status: 'completed' };
      mockOversightService.completeVerification.mockResolvedValue(completion);

      const response = await request(app)
        .post('/api/oversight/verifications/v-1/complete')
        .send({ status: 'completed', notes: 'ok', robotId: 'robot-1', operatorId: 'op-1' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('comp-1');
      expect(mockOversightService.completeVerification).toHaveBeenCalledWith({
        scheduleId: 'v-1',
        operatorId: 'op-1',
        status: 'completed',
        notes: 'ok',
        robotId: 'robot-1',
      });
    });

    it('returns 400 when status is missing', async () => {
      const response = await request(app)
        .post('/api/oversight/verifications/v-1/complete')
        .send({ notes: 'ok' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid status is required');
      expect(mockOversightService.completeVerification).not.toHaveBeenCalled();
    });

    it('returns 400 when status is invalid', async () => {
      const response = await request(app)
        .post('/api/oversight/verifications/v-1/complete')
        .send({ status: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid status is required');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.completeVerification.mockRejectedValue(new Error('fail'));

      const response = await request(app)
        .post('/api/oversight/verifications/v-1/complete')
        .send({ status: 'skipped' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/oversight/verifications/:id
  // --------------------------------------------------------------------------

  describe('PATCH /api/oversight/verifications/:id', () => {
    it('updates a verification schedule', async () => {
      const schedule = { id: 'v-1', name: 'Updated' };
      mockOversightService.updateVerificationSchedule.mockResolvedValue(schedule);

      const response = await request(app)
        .patch('/api/oversight/verifications/v-1')
        .send({ name: 'Updated', intervalMinutes: 120 });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated');
      expect(mockOversightService.updateVerificationSchedule).toHaveBeenCalledWith('v-1', {
        name: 'Updated',
        description: undefined,
        intervalMinutes: 120,
        robotScope: undefined,
        scopeId: undefined,
      });
    });

    it('returns 404 when schedule not found', async () => {
      mockOversightService.updateVerificationSchedule.mockResolvedValue(null);

      const response = await request(app)
        .patch('/api/oversight/verifications/v-1')
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Verification schedule not found');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.updateVerificationSchedule.mockRejectedValue(new Error('fail'));

      const response = await request(app)
        .patch('/api/oversight/verifications/v-1')
        .send({ name: 'Updated' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/oversight/verifications/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/oversight/verifications/:id', () => {
    it('deactivates a verification schedule', async () => {
      mockOversightService.deactivateVerificationSchedule.mockResolvedValue({ id: 'v-1', isActive: false });

      const response = await request(app).delete('/api/oversight/verifications/v-1');

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
      expect(mockOversightService.deactivateVerificationSchedule).toHaveBeenCalledWith('v-1');
    });

    it('returns 404 when schedule not found', async () => {
      mockOversightService.deactivateVerificationSchedule.mockResolvedValue(null);

      const response = await request(app).delete('/api/oversight/verifications/v-1');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Verification schedule not found');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.deactivateVerificationSchedule.mockRejectedValue(new Error('fail'));

      const response = await request(app).delete('/api/oversight/verifications/v-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/anomalies
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/anomalies', () => {
    it('returns anomalies with single-value filters', async () => {
      const result = { anomalies: [{ id: 'a-1' }], total: 1 };
      mockOversightService.getAnomalies.mockResolvedValue(result);

      const response = await request(app)
        .get('/api/oversight/anomalies')
        .query({ robotId: 'robot-1', anomalyType: 'collision', severity: 'high', isActive: 'true', page: '2', limit: '10' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockOversightService.getAnomalies).toHaveBeenCalledWith({
        robotId: 'robot-1',
        isActive: true,
        anomalyType: 'collision',
        severity: 'high',
        page: 2,
        limit: 10,
      });
    });

    it('parses comma-separated anomalyType and severity into arrays', async () => {
      mockOversightService.getAnomalies.mockResolvedValue({ anomalies: [], total: 0 });

      const response = await request(app)
        .get('/api/oversight/anomalies')
        .query({ anomalyType: 'collision,fault', severity: 'high,critical' });

      expect(response.status).toBe(200);
      expect(mockOversightService.getAnomalies).toHaveBeenCalledWith({
        anomalyType: ['collision', 'fault'],
        severity: ['high', 'critical'],
      });
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getAnomalies.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/anomalies');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/anomalies/active
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/anomalies/active', () => {
    it('returns active anomalies filtered by robotId', async () => {
      mockOversightService.getActiveAnomalies.mockResolvedValue([{ id: 'a-1' }]);

      const response = await request(app)
        .get('/api/oversight/anomalies/active')
        .query({ robotId: 'robot-1' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockOversightService.getActiveAnomalies).toHaveBeenCalledWith('robot-1');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getActiveAnomalies.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/anomalies/active');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/anomalies/unacknowledged
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/anomalies/unacknowledged', () => {
    it('returns unacknowledged anomalies', async () => {
      mockOversightService.getUnacknowledgedAnomalies.mockResolvedValue([{ id: 'a-1' }]);

      const response = await request(app).get('/api/oversight/anomalies/unacknowledged');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockOversightService.getUnacknowledgedAnomalies).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getUnacknowledgedAnomalies.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/anomalies/unacknowledged');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/oversight/anomalies/:id/acknowledge
  // --------------------------------------------------------------------------

  describe('POST /api/oversight/anomalies/:id/acknowledge', () => {
    it('acknowledges an anomaly', async () => {
      mockOversightService.acknowledgeAnomaly.mockResolvedValue({ id: 'a-1', acknowledged: true });

      const response = await request(app)
        .post('/api/oversight/anomalies/a-1/acknowledge')
        .send({ operatorId: 'op-1' });

      expect(response.status).toBe(200);
      expect(response.body.acknowledged).toBe(true);
      expect(mockOversightService.acknowledgeAnomaly).toHaveBeenCalledWith('a-1', 'op-1');
    });

    it('returns 404 when anomaly not found', async () => {
      mockOversightService.acknowledgeAnomaly.mockResolvedValue(null);

      const response = await request(app).post('/api/oversight/anomalies/a-1/acknowledge');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Anomaly not found');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.acknowledgeAnomaly.mockRejectedValue(new Error('fail'));

      const response = await request(app).post('/api/oversight/anomalies/a-1/acknowledge');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/oversight/anomalies/:id/resolve
  // --------------------------------------------------------------------------

  describe('POST /api/oversight/anomalies/:id/resolve', () => {
    it('resolves an anomaly', async () => {
      mockOversightService.resolveAnomaly.mockResolvedValue({ id: 'a-1', resolved: true });

      const response = await request(app)
        .post('/api/oversight/anomalies/a-1/resolve')
        .send({ resolution: 'fixed', operatorId: 'op-1' });

      expect(response.status).toBe(200);
      expect(response.body.resolved).toBe(true);
      expect(mockOversightService.resolveAnomaly).toHaveBeenCalledWith('a-1', 'fixed', 'op-1');
    });

    it('returns 400 when resolution is missing', async () => {
      const response = await request(app)
        .post('/api/oversight/anomalies/a-1/resolve')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Resolution is required');
      expect(mockOversightService.resolveAnomaly).not.toHaveBeenCalled();
    });

    it('returns 404 when anomaly not found', async () => {
      mockOversightService.resolveAnomaly.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/oversight/anomalies/a-1/resolve')
        .send({ resolution: 'fixed' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Anomaly not found');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.resolveAnomaly.mockRejectedValue(new Error('fail'));

      const response = await request(app)
        .post('/api/oversight/anomalies/a-1/resolve')
        .send({ resolution: 'fixed' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/robots/:id/capabilities
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/robots/:id/capabilities', () => {
    it('returns robot capabilities summary', async () => {
      mockOversightService.getRobotCapabilitiesSummary.mockResolvedValue({ robotId: 'robot-1', autonomyLevel: 3 });

      const response = await request(app).get('/api/oversight/robots/robot-1/capabilities');

      expect(response.status).toBe(200);
      expect(response.body.autonomyLevel).toBe(3);
      expect(mockOversightService.getRobotCapabilitiesSummary).toHaveBeenCalledWith('robot-1');
    });

    it('returns 404 when robot not found', async () => {
      mockOversightService.getRobotCapabilitiesSummary.mockResolvedValue(null);

      const response = await request(app).get('/api/oversight/robots/robot-1/capabilities');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Robot not found');
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getRobotCapabilitiesSummary.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/robots/robot-1/capabilities');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/fleet/overview
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/fleet/overview', () => {
    it('returns fleet capabilities overview', async () => {
      mockOversightService.getFleetCapabilitiesOverview.mockResolvedValue({ totalRobots: 5 });

      const response = await request(app).get('/api/oversight/fleet/overview');

      expect(response.status).toBe(200);
      expect(response.body.totalRobots).toBe(5);
      expect(mockOversightService.getFleetCapabilitiesOverview).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getFleetCapabilitiesOverview.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/fleet/overview');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/logs
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/logs', () => {
    it('returns oversight logs with filters', async () => {
      const result = { logs: [{ id: 'log-1' }], total: 1 };
      mockOversightService.getOversightLogs.mockResolvedValue(result);

      const response = await request(app)
        .get('/api/oversight/logs')
        .query({ operatorId: 'op-1', robotId: 'robot-1', actionType: 'manual_mode_activated', page: '1', limit: '20' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockOversightService.getOversightLogs).toHaveBeenCalledWith({
        operatorId: 'op-1',
        robotId: 'robot-1',
        actionType: 'manual_mode_activated',
        page: 1,
        limit: 20,
      });
    });

    it('parses comma-separated actionType into an array', async () => {
      mockOversightService.getOversightLogs.mockResolvedValue({ logs: [], total: 0 });

      const response = await request(app)
        .get('/api/oversight/logs')
        .query({ actionType: 'manual_mode_activated,anomaly_resolved' });

      expect(response.status).toBe(200);
      expect(mockOversightService.getOversightLogs).toHaveBeenCalledWith({
        actionType: ['manual_mode_activated', 'anomaly_resolved'],
      });
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getOversightLogs.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/logs');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/oversight/dashboard
  // --------------------------------------------------------------------------

  describe('GET /api/oversight/dashboard', () => {
    it('returns dashboard statistics', async () => {
      mockOversightService.getDashboardStats.mockResolvedValue({ activeAnomalies: 3, manualSessions: 1 });

      const response = await request(app).get('/api/oversight/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.activeAnomalies).toBe(3);
      expect(mockOversightService.getDashboardStats).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockOversightService.getDashboardStats.mockRejectedValue(new Error('fail'));

      const response = await request(app).get('/api/oversight/dashboard');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('fail');
    });
  });
});

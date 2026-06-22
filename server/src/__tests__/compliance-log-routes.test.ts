/**
 * @file compliance-log-routes.test.ts
 * @description Integration tests for compliance log routes
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockComplianceLogService, mockLogExportService } = vi.hoisted(() => ({
  mockComplianceLogService: {
    listLogs: vi.fn(),
    getLog: vi.fn(),
    getLogAccessHistory: vi.fn(),
    getLogsByDecision: vi.fn(),
    getLogsBySession: vi.fn(),
    logAIDecision: vi.fn(),
    logSafetyAction: vi.fn(),
    logCommandExecution: vi.fn(),
    logSystemEvent: vi.fn(),
    logAccess: vi.fn(),
    verifyIntegrity: vi.fn(),
    getMetricsSummary: vi.fn(),
    getEventTypeCounts: vi.fn(),
    startSession: vi.fn(),
    getSession: vi.fn(),
    getSessionByRobotId: vi.fn(),
    endSession: vi.fn(),
  },
  mockLogExportService: {
    exportToJson: vi.fn(),
    getExportHistory: vi.fn(),
  },
}));

vi.mock('../services/ComplianceLogService.js', () => ({
  complianceLogService: mockComplianceLogService,
}));

vi.mock('../services/LogExportService.js', () => ({
  logExportService: mockLogExportService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { complianceLogRoutes } from '../routes/compliance-log.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/compliance', authMiddleware as any, complianceLogRoutes);
  return app;
}

const SAMPLE_LOG = {
  id: 'log-001',
  sessionId: 'session-001',
  robotId: 'robot-001',
  eventType: 'ai_decision',
  severity: 'info',
  timestamp: '2026-02-26T00:00:00.000Z',
};

describe('Compliance Log Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /logs
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/logs', () => {
    it('lists logs with parsed query params', async () => {
      const result = { logs: [SAMPLE_LOG], total: 1, page: 2, limit: 10 };
      mockComplianceLogService.listLogs.mockResolvedValue(result);

      const response = await request(app)
        .get('/api/compliance/logs')
        .query({
          page: '2',
          limit: '10',
          robotId: 'robot-001',
          eventType: 'ai_decision',
          sortBy: 'severity',
          sortOrder: 'asc',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-02-01T00:00:00.000Z',
        });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.logs[0].id).toBe('log-001');
      expect(mockComplianceLogService.listLogs).toHaveBeenCalledTimes(1);
      const args = mockComplianceLogService.listLogs.mock.calls[0][0];
      expect(args.page).toBe(2);
      expect(args.limit).toBe(10);
      expect(args.robotId).toBe('robot-001');
      expect(args.eventType).toBe('ai_decision');
      expect(args.sortBy).toBe('severity');
      expect(args.sortOrder).toBe('asc');
      expect(args.startDate).toBeInstanceOf(Date);
      expect(args.endDate).toBeInstanceOf(Date);
    });

    it('uses defaults when no query params provided', async () => {
      mockComplianceLogService.listLogs.mockResolvedValue({ logs: [], total: 0 });

      const response = await request(app).get('/api/compliance/logs');

      expect(response.status).toBe(200);
      const args = mockComplianceLogService.listLogs.mock.calls[0][0];
      expect(args.page).toBe(1);
      expect(args.limit).toBe(50);
      expect(args.startDate).toBeUndefined();
      expect(args.endDate).toBeUndefined();
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.listLogs.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/compliance/logs');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch compliance logs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /logs/:id
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/logs/:id', () => {
    it('returns a single log and passes audit info', async () => {
      mockComplianceLogService.getLog.mockResolvedValue(SAMPLE_LOG);

      const response = await request(app)
        .get('/api/compliance/logs/log-001')
        .set('User-Agent', 'vitest-agent');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('log-001');
      expect(mockComplianceLogService.getLog).toHaveBeenCalledTimes(1);
      const args = mockComplianceLogService.getLog.mock.calls[0];
      expect(args[0]).toBe('log-001');
      expect(args[1]).toBe('user-123');
      expect(args[3]).toBe('vitest-agent');
    });

    it('returns 404 when log not found', async () => {
      mockComplianceLogService.getLog.mockResolvedValue(null);

      const response = await request(app).get('/api/compliance/logs/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Compliance log not found');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getLog.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/logs/log-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch compliance log');
    });
  });

  // --------------------------------------------------------------------------
  // GET /logs/:id/access-history
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/logs/:id/access-history', () => {
    it('returns access history', async () => {
      mockComplianceLogService.getLogAccessHistory.mockResolvedValue([{ userId: 'u1' }]);

      const response = await request(app).get('/api/compliance/logs/log-001/access-history');

      expect(response.status).toBe(200);
      expect(response.body.history).toEqual([{ userId: 'u1' }]);
      expect(mockComplianceLogService.getLogAccessHistory).toHaveBeenCalledWith('log-001');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getLogAccessHistory.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/logs/log-001/access-history');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch access history');
    });
  });

  // --------------------------------------------------------------------------
  // GET /logs/decision/:decisionId
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/logs/decision/:decisionId', () => {
    it('returns logs by decision', async () => {
      mockComplianceLogService.getLogsByDecision.mockResolvedValue([SAMPLE_LOG]);

      const response = await request(app).get('/api/compliance/logs/decision/dec-001');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);
      expect(mockComplianceLogService.getLogsByDecision).toHaveBeenCalledWith('dec-001');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getLogsByDecision.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/logs/decision/dec-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch logs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /logs/session/:sessionId
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/logs/session/:sessionId', () => {
    it('returns logs by session', async () => {
      mockComplianceLogService.getLogsBySession.mockResolvedValue([SAMPLE_LOG]);

      const response = await request(app).get('/api/compliance/logs/session/session-001');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);
      expect(mockComplianceLogService.getLogsBySession).toHaveBeenCalledWith('session-001');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getLogsBySession.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/logs/session/session-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch logs');
    });
  });

  // --------------------------------------------------------------------------
  // POST /logs
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/logs', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/compliance/logs')
        .send({ sessionId: 'session-001' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('returns 400 for invalid eventType', async () => {
      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          eventType: 'bogus',
          payload: { foo: 'bar' },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid eventType');
    });

    it('creates an ai_decision log', async () => {
      mockComplianceLogService.logAIDecision.mockResolvedValue(SAMPLE_LOG);

      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          operatorId: 'op-1',
          eventType: 'ai_decision',
          severity: 'warning',
          payload: { foo: 'bar' },
          modelVersion: 'v1',
          modelHash: 'hash',
          decisionId: 'dec-001',
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('log-001');
      expect(mockComplianceLogService.logAIDecision).toHaveBeenCalledWith({
        sessionId: 'session-001',
        robotId: 'robot-001',
        operatorId: 'op-1',
        payload: { foo: 'bar' },
        modelVersion: 'v1',
        modelHash: 'hash',
        decisionId: 'dec-001',
        severity: 'warning',
      });
    });

    it('creates a safety_action log', async () => {
      mockComplianceLogService.logSafetyAction.mockResolvedValue(SAMPLE_LOG);

      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          operatorId: 'op-1',
          eventType: 'safety_action',
          payload: { foo: 'bar' },
          decisionId: 'dec-001',
        });

      expect(response.status).toBe(201);
      expect(mockComplianceLogService.logSafetyAction).toHaveBeenCalledWith({
        sessionId: 'session-001',
        robotId: 'robot-001',
        operatorId: 'op-1',
        payload: { foo: 'bar' },
        decisionId: 'dec-001',
      });
    });

    it('creates a command_execution log', async () => {
      mockComplianceLogService.logCommandExecution.mockResolvedValue(SAMPLE_LOG);

      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          eventType: 'command_execution',
          payload: { cmd: 'move' },
        });

      expect(response.status).toBe(201);
      expect(mockComplianceLogService.logCommandExecution).toHaveBeenCalledTimes(1);
    });

    it('creates a system_event log', async () => {
      mockComplianceLogService.logSystemEvent.mockResolvedValue(SAMPLE_LOG);

      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          eventType: 'system_event',
          severity: 'critical',
          payload: { evt: 'boot' },
        });

      expect(response.status).toBe(201);
      expect(mockComplianceLogService.logSystemEvent).toHaveBeenCalledWith({
        sessionId: 'session-001',
        robotId: 'robot-001',
        payload: { evt: 'boot' },
        severity: 'critical',
      });
    });

    it('creates an access_audit log', async () => {
      mockComplianceLogService.logAccess.mockResolvedValue(SAMPLE_LOG);

      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          eventType: 'access_audit',
          payload: { who: 'admin' },
        });

      expect(response.status).toBe(201);
      expect(mockComplianceLogService.logAccess).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.logAIDecision.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/compliance/logs')
        .send({
          sessionId: 'session-001',
          robotId: 'robot-001',
          eventType: 'ai_decision',
          payload: { foo: 'bar' },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create compliance log');
    });
  });

  // --------------------------------------------------------------------------
  // POST /verify
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/verify', () => {
    it('verifies integrity with date range', async () => {
      mockComplianceLogService.verifyIntegrity.mockResolvedValue({ valid: true });

      const response = await request(app)
        .post('/api/compliance/verify')
        .send({ startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-02-01T00:00:00.000Z' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      const args = mockComplianceLogService.verifyIntegrity.mock.calls[0];
      expect(args[0]).toBeInstanceOf(Date);
      expect(args[1]).toBeInstanceOf(Date);
    });

    it('verifies integrity without dates', async () => {
      mockComplianceLogService.verifyIntegrity.mockResolvedValue({ valid: true });

      const response = await request(app).post('/api/compliance/verify').send({});

      expect(response.status).toBe(200);
      const args = mockComplianceLogService.verifyIntegrity.mock.calls[0];
      expect(args[0]).toBeUndefined();
      expect(args[1]).toBeUndefined();
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.verifyIntegrity.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/compliance/verify').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to verify hash chain integrity');
    });
  });

  // --------------------------------------------------------------------------
  // GET /verify
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/verify', () => {
    it('performs quick verification', async () => {
      mockComplianceLogService.verifyIntegrity.mockResolvedValue({ valid: false });

      const response = await request(app).get('/api/compliance/verify');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(mockComplianceLogService.verifyIntegrity).toHaveBeenCalledWith();
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.verifyIntegrity.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/verify');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to verify hash chain integrity');
    });
  });

  // --------------------------------------------------------------------------
  // GET /metrics
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/metrics', () => {
    it('returns metrics summary', async () => {
      mockComplianceLogService.getMetricsSummary.mockResolvedValue({ total: 42 });

      const response = await request(app)
        .get('/api/compliance/metrics')
        .query({ startDate: '2026-01-01T00:00:00.000Z' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(42);
      const args = mockComplianceLogService.getMetricsSummary.mock.calls[0];
      expect(args[0]).toBeInstanceOf(Date);
      expect(args[1]).toBeUndefined();
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getMetricsSummary.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/metrics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch compliance metrics');
    });
  });

  // --------------------------------------------------------------------------
  // GET /metrics/event-types
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/metrics/event-types', () => {
    it('returns event type counts', async () => {
      mockComplianceLogService.getEventTypeCounts.mockResolvedValue({ ai_decision: 5 });

      const response = await request(app).get('/api/compliance/metrics/event-types');

      expect(response.status).toBe(200);
      expect(response.body.counts.ai_decision).toBe(5);
      expect(mockComplianceLogService.getEventTypeCounts).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getEventTypeCounts.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/metrics/event-types');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch event type counts');
    });
  });

  // --------------------------------------------------------------------------
  // POST /sessions
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/sessions', () => {
    it('starts a session', async () => {
      mockComplianceLogService.startSession.mockReturnValue({ id: 'session-001' });

      const response = await request(app)
        .post('/api/compliance/sessions')
        .send({ robotId: 'robot-001' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('session-001');
      expect(mockComplianceLogService.startSession).toHaveBeenCalledWith('robot-001');
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app).post('/api/compliance/sessions').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required field: robotId');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.startSession.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .post('/api/compliance/sessions')
        .send({ robotId: 'robot-001' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to start session');
    });
  });

  // --------------------------------------------------------------------------
  // GET /sessions/:sessionId
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/sessions/:sessionId', () => {
    it('returns session details', async () => {
      mockComplianceLogService.getSession.mockReturnValue({ id: 'session-001' });

      const response = await request(app).get('/api/compliance/sessions/session-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('session-001');
      expect(mockComplianceLogService.getSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 404 when session not found', async () => {
      mockComplianceLogService.getSession.mockReturnValue(null);

      const response = await request(app).get('/api/compliance/sessions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getSession.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/compliance/sessions/session-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch session');
    });
  });

  // --------------------------------------------------------------------------
  // GET /sessions/robot/:robotId
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/sessions/robot/:robotId', () => {
    it('returns session by robot id', async () => {
      mockComplianceLogService.getSessionByRobotId.mockReturnValue({ id: 'session-001' });

      const response = await request(app).get('/api/compliance/sessions/robot/robot-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('session-001');
      expect(mockComplianceLogService.getSessionByRobotId).toHaveBeenCalledWith('robot-001');
    });

    it('returns 404 when no active session', async () => {
      mockComplianceLogService.getSessionByRobotId.mockReturnValue(null);

      const response = await request(app).get('/api/compliance/sessions/robot/robot-001');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No active session for robot');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.getSessionByRobotId.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/compliance/sessions/robot/robot-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch session');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /sessions/:sessionId
  // --------------------------------------------------------------------------

  describe('DELETE /api/compliance/sessions/:sessionId', () => {
    it('ends a session', async () => {
      mockComplianceLogService.endSession.mockReturnValue({ id: 'session-001', ended: true });

      const response = await request(app).delete('/api/compliance/sessions/session-001');

      expect(response.status).toBe(200);
      expect(response.body.ended).toBe(true);
      expect(mockComplianceLogService.endSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 404 when session not found', async () => {
      mockComplianceLogService.endSession.mockReturnValue(null);

      const response = await request(app).delete('/api/compliance/sessions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    it('returns 500 on service error', async () => {
      mockComplianceLogService.endSession.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).delete('/api/compliance/sessions/session-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to end session');
    });
  });

  // --------------------------------------------------------------------------
  // POST /export
  // --------------------------------------------------------------------------

  describe('POST /api/compliance/export', () => {
    it('exports logs to JSON with download headers', async () => {
      mockLogExportService.exportToJson.mockResolvedValue({
        filename: 'export-2026.json',
        data: [],
      });

      const response = await request(app)
        .post('/api/compliance/export')
        .send({
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-02-01T00:00:00.000Z',
          eventTypes: ['ai_decision'],
          robotIds: ['robot-001'],
          sessionIds: ['session-001'],
          includeDecrypted: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.filename).toBe('export-2026.json');
      expect(response.headers['content-disposition']).toContain('export-2026.json');
      expect(mockLogExportService.exportToJson).toHaveBeenCalledTimes(1);
      const args = mockLogExportService.exportToJson.mock.calls[0];
      expect(args[0].startDate).toBeInstanceOf(Date);
      expect(args[0].endDate).toBeInstanceOf(Date);
      expect(args[0].eventTypes).toEqual(['ai_decision']);
      expect(args[0].includeDecrypted).toBe(true);
      expect(args[1]).toBe('user-123');
    });

    it('defaults includeDecrypted to false', async () => {
      mockLogExportService.exportToJson.mockResolvedValue({ filename: 'x.json' });

      await request(app).post('/api/compliance/export').send({});

      const args = mockLogExportService.exportToJson.mock.calls[0];
      expect(args[0].includeDecrypted).toBe(false);
      expect(args[0].startDate).toBeUndefined();
    });

    it('returns 500 on service error', async () => {
      mockLogExportService.exportToJson.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/compliance/export').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to export compliance logs');
    });
  });

  // --------------------------------------------------------------------------
  // GET /export/history
  // --------------------------------------------------------------------------

  describe('GET /api/compliance/export/history', () => {
    it('returns export history with default limit', async () => {
      mockLogExportService.getExportHistory.mockResolvedValue([{ filename: 'a.json' }]);

      const response = await request(app).get('/api/compliance/export/history');

      expect(response.status).toBe(200);
      expect(response.body.history).toHaveLength(1);
      expect(mockLogExportService.getExportHistory).toHaveBeenCalledWith(50);
    });

    it('honors the limit query param', async () => {
      mockLogExportService.getExportHistory.mockResolvedValue([]);

      const response = await request(app).get('/api/compliance/export/history').query({ limit: '5' });

      expect(response.status).toBe(200);
      expect(mockLogExportService.getExportHistory).toHaveBeenCalledWith(5);
    });

    it('returns 500 on service error', async () => {
      mockLogExportService.getExportHistory.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/export/history');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch export history');
    });
  });
});

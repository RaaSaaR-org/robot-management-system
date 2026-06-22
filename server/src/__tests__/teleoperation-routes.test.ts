/**
 * @file teleoperation-routes.test.ts
 * @description Integration tests for teleoperation data collection routes
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockTeleoperationService } = vi.hoisted(() => ({
  mockTeleoperationService: {
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    startSession: vi.fn(),
    pauseSession: vi.fn(),
    resumeSession: vi.fn(),
    endSession: vi.fn(),
    recordFrame: vi.fn(),
    recordFramesBatch: vi.fn(),
    getFrames: vi.fn(),
    annotateSession: vi.fn(),
    exportToLeRobot: vi.fn(),
  },
}));

vi.mock('../services/TeleoperationService.js', () => ({
  teleoperationService: mockTeleoperationService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { teleoperationRoutes } from '../routes/teleoperation.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teleoperation', authMiddleware as any, teleoperationRoutes);
  return app;
}

const SESSION = {
  id: 'session-001',
  operatorId: 'operator-1',
  robotId: 'robot-1',
  type: 'vr_quest',
  status: 'created',
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
};

describe('Teleoperation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions', () => {
    it('creates a session successfully', async () => {
      mockTeleoperationService.createSession.mockResolvedValue(SESSION);

      const response = await request(app)
        .post('/api/teleoperation/sessions')
        .send({ operatorId: 'operator-1', robotId: 'robot-1', type: 'vr_quest' });

      expect(response.status).toBe(201);
      expect(response.body.session.id).toBe('session-001');
      expect(response.body.message).toBe('Teleoperation session created successfully');
      expect(mockTeleoperationService.createSession).toHaveBeenCalledWith({
        operatorId: 'operator-1',
        robotId: 'robot-1',
        type: 'vr_quest',
      });
    });

    it('returns 400 when operatorId is missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions')
        .send({ robotId: 'robot-1', type: 'vr_quest' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('operatorId is required');
      expect(mockTeleoperationService.createSession).not.toHaveBeenCalled();
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions')
        .send({ operatorId: 'operator-1', type: 'vr_quest' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
    });

    it('returns 400 when type is missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions')
        .send({ operatorId: 'operator-1', robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('type is required');
    });

    it('returns 400 for invalid type', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions')
        .send({ operatorId: 'operator-1', robotId: 'robot-1', type: 'telepathy' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid type. Must be one of:');
      expect(mockTeleoperationService.createSession).not.toHaveBeenCalled();
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.createSession.mockRejectedValue(new Error('Robot not found'));

      const response = await request(app)
        .post('/api/teleoperation/sessions')
        .send({ operatorId: 'operator-1', robotId: 'robot-1', type: 'gamepad' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Robot not found');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/teleoperation/sessions
  // --------------------------------------------------------------------------

  describe('GET /api/teleoperation/sessions', () => {
    it('lists sessions with pagination', async () => {
      mockTeleoperationService.listSessions.mockResolvedValue({
        sessions: [SESSION],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const response = await request(app).get('/api/teleoperation/sessions');

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.pagination.total).toBe(1);
      expect(mockTeleoperationService.listSessions).toHaveBeenCalledWith({
        operatorId: undefined,
        robotId: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('parses query params (single type/status, dates, pagination)', async () => {
      mockTeleoperationService.listSessions.mockResolvedValue({
        sessions: [],
        pagination: { page: 2, limit: 5, total: 0, totalPages: 0 },
      });

      const response = await request(app)
        .get('/api/teleoperation/sessions')
        .query({
          operatorId: 'op-1',
          robotId: 'rb-1',
          page: '2',
          limit: '5',
          type: 'vr_quest',
          status: 'recording',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-02-01T00:00:00.000Z',
        });

      expect(response.status).toBe(200);
      const arg = mockTeleoperationService.listSessions.mock.calls[0][0];
      expect(arg.operatorId).toBe('op-1');
      expect(arg.robotId).toBe('rb-1');
      expect(arg.page).toBe(2);
      expect(arg.limit).toBe(5);
      expect(arg.type).toBe('vr_quest');
      expect(arg.status).toBe('recording');
      expect(arg.startDate).toBeInstanceOf(Date);
      expect(arg.endDate).toBeInstanceOf(Date);
    });

    it('parses comma-separated type and status into arrays', async () => {
      mockTeleoperationService.listSessions.mockResolvedValue({
        sessions: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const response = await request(app)
        .get('/api/teleoperation/sessions')
        .query({ type: 'vr_quest,gamepad', status: 'recording,completed' });

      expect(response.status).toBe(200);
      const arg = mockTeleoperationService.listSessions.mock.calls[0][0];
      expect(arg.type).toEqual(['vr_quest', 'gamepad']);
      expect(arg.status).toEqual(['recording', 'completed']);
    });

    it('returns 500 on service error', async () => {
      mockTeleoperationService.listSessions.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/teleoperation/sessions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list sessions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/teleoperation/sessions/:id
  // --------------------------------------------------------------------------

  describe('GET /api/teleoperation/sessions/:id', () => {
    it('returns session details', async () => {
      mockTeleoperationService.getSession.mockResolvedValue(SESSION);

      const response = await request(app).get('/api/teleoperation/sessions/session-001');

      expect(response.status).toBe(200);
      expect(response.body.session.id).toBe('session-001');
      expect(mockTeleoperationService.getSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 404 when not found', async () => {
      mockTeleoperationService.getSession.mockResolvedValue(null);

      const response = await request(app).get('/api/teleoperation/sessions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    it('returns 500 on service error', async () => {
      mockTeleoperationService.getSession.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/teleoperation/sessions/session-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get session');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/teleoperation/sessions/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/teleoperation/sessions/:id', () => {
    it('updates session metadata', async () => {
      const updated = { ...SESSION, notes: 'updated' };
      mockTeleoperationService.updateSession.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/teleoperation/sessions/session-001')
        .send({ notes: 'updated' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Session updated successfully');
      expect(mockTeleoperationService.updateSession).toHaveBeenCalledWith('session-001', {
        notes: 'updated',
      });
    });

    it('returns 404 when session not found', async () => {
      mockTeleoperationService.updateSession.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/teleoperation/sessions/missing')
        .send({ notes: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.updateSession.mockRejectedValue(new Error('Invalid field'));

      const response = await request(app)
        .put('/api/teleoperation/sessions/session-001')
        .send({ notes: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid field');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/teleoperation/sessions/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/teleoperation/sessions/:id', () => {
    it('deletes a session', async () => {
      mockTeleoperationService.deleteSession.mockResolvedValue(true);

      const response = await request(app).delete('/api/teleoperation/sessions/session-001');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Session deleted successfully');
      expect(mockTeleoperationService.deleteSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 404 when session not found', async () => {
      mockTeleoperationService.deleteSession.mockResolvedValue(false);

      const response = await request(app).delete('/api/teleoperation/sessions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    it('returns 500 on service error', async () => {
      mockTeleoperationService.deleteSession.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/teleoperation/sessions/session-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete session');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/start
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/start', () => {
    it('starts recording', async () => {
      mockTeleoperationService.startSession.mockResolvedValue({ ...SESSION, status: 'recording' });

      const response = await request(app).post('/api/teleoperation/sessions/session-001/start');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Recording started');
      expect(mockTeleoperationService.startSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.startSession.mockRejectedValue(new Error('Already recording'));

      const response = await request(app).post('/api/teleoperation/sessions/session-001/start');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Already recording');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/pause
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/pause', () => {
    it('pauses recording', async () => {
      mockTeleoperationService.pauseSession.mockResolvedValue({ ...SESSION, status: 'paused' });

      const response = await request(app).post('/api/teleoperation/sessions/session-001/pause');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Recording paused');
      expect(mockTeleoperationService.pauseSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.pauseSession.mockRejectedValue(new Error('Not recording'));

      const response = await request(app).post('/api/teleoperation/sessions/session-001/pause');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Not recording');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/resume
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/resume', () => {
    it('resumes recording', async () => {
      mockTeleoperationService.resumeSession.mockResolvedValue({ ...SESSION, status: 'recording' });

      const response = await request(app).post('/api/teleoperation/sessions/session-001/resume');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Recording resumed');
      expect(mockTeleoperationService.resumeSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.resumeSession.mockRejectedValue(new Error('Not paused'));

      const response = await request(app).post('/api/teleoperation/sessions/session-001/resume');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Not paused');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/end
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/end', () => {
    it('ends recording', async () => {
      mockTeleoperationService.endSession.mockResolvedValue({ ...SESSION, status: 'completed' });

      const response = await request(app).post('/api/teleoperation/sessions/session-001/end');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Recording ended');
      expect(mockTeleoperationService.endSession).toHaveBeenCalledWith('session-001');
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.endSession.mockRejectedValue(new Error('Already ended'));

      const response = await request(app).post('/api/teleoperation/sessions/session-001/end');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Already ended');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/frame
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/frame', () => {
    const validFrame = {
      timestamp: 1000,
      jointPositions: [0.1, 0.2],
      action: [0.3, 0.4],
    };

    it('records a single frame', async () => {
      mockTeleoperationService.recordFrame.mockResolvedValue({ id: 'frame-1', ...validFrame });

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frame')
        .send(validFrame);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Frame recorded');
      expect(response.body.frame.id).toBe('frame-1');
      expect(mockTeleoperationService.recordFrame).toHaveBeenCalledWith('session-001', validFrame);
    });

    it('returns 400 when timestamp is missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frame')
        .send({ jointPositions: [0.1], action: [0.2] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('timestamp is required');
      expect(mockTeleoperationService.recordFrame).not.toHaveBeenCalled();
    });

    it('returns 400 when jointPositions is empty/missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frame')
        .send({ timestamp: 1, jointPositions: [], action: [0.2] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('jointPositions is required');
    });

    it('returns 400 when action is empty/missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frame')
        .send({ timestamp: 1, jointPositions: [0.1], action: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('action is required');
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.recordFrame.mockRejectedValue(new Error('Session not recording'));

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frame')
        .send(validFrame);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Session not recording');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/frames
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/frames', () => {
    it('records a batch of frames', async () => {
      mockTeleoperationService.recordFramesBatch.mockResolvedValue({ recorded: 3 });

      const dto = {
        frames: [
          { timestamp: 1, jointPositions: [0.1], action: [0.2] },
          { timestamp: 2, jointPositions: [0.1], action: [0.2] },
          { timestamp: 3, jointPositions: [0.1], action: [0.2] },
        ],
      };

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frames')
        .send(dto);

      expect(response.status).toBe(201);
      expect(response.body.recorded).toBe(3);
      expect(response.body.message).toBe('Recorded 3 frames');
      expect(mockTeleoperationService.recordFramesBatch).toHaveBeenCalledWith('session-001', dto);
    });

    it('returns 400 when frames is not an array', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frames')
        .send({ frames: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('frames array is required');
      expect(mockTeleoperationService.recordFramesBatch).not.toHaveBeenCalled();
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.recordFramesBatch.mockRejectedValue(new Error('Batch failed'));

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/frames')
        .send({ frames: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Batch failed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/teleoperation/sessions/:id/frames
  // --------------------------------------------------------------------------

  describe('GET /api/teleoperation/sessions/:id/frames', () => {
    it('returns frames with count', async () => {
      mockTeleoperationService.getFrames.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);

      const response = await request(app)
        .get('/api/teleoperation/sessions/session-001/frames')
        .query({ startIndex: '0', limit: '10' });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe('session-001');
      expect(response.body.frameCount).toBe(2);
      expect(response.body.frames).toHaveLength(2);
      expect(mockTeleoperationService.getFrames).toHaveBeenCalledWith('session-001', 0, 10);
    });

    it('passes undefined start/limit when not provided', async () => {
      mockTeleoperationService.getFrames.mockResolvedValue([]);

      const response = await request(app).get('/api/teleoperation/sessions/session-001/frames');

      expect(response.status).toBe(200);
      expect(response.body.frameCount).toBe(0);
      expect(mockTeleoperationService.getFrames).toHaveBeenCalledWith(
        'session-001',
        undefined,
        undefined
      );
    });

    it('returns 500 on service error', async () => {
      mockTeleoperationService.getFrames.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/teleoperation/sessions/session-001/frames');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get frames');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/annotate
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/annotate', () => {
    it('annotates a session', async () => {
      mockTeleoperationService.annotateSession.mockResolvedValue({
        ...SESSION,
        languageInstr: 'pick up cube',
      });

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/annotate')
        .send({ languageInstr: 'pick up cube' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Session annotated successfully');
      expect(mockTeleoperationService.annotateSession).toHaveBeenCalledWith('session-001', {
        languageInstr: 'pick up cube',
      });
    });

    it('returns 400 when languageInstr is missing', async () => {
      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/annotate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('languageInstr is required');
      expect(mockTeleoperationService.annotateSession).not.toHaveBeenCalled();
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.annotateSession.mockRejectedValue(new Error('Session not found'));

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/annotate')
        .send({ languageInstr: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Session not found');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/teleoperation/sessions/:id/export
  // --------------------------------------------------------------------------

  describe('POST /api/teleoperation/sessions/:id/export', () => {
    it('exports a session to LeRobot format', async () => {
      mockTeleoperationService.exportToLeRobot.mockResolvedValue({
        datasetId: 'ds-1',
        path: '/exports/ds-1',
      });

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/export')
        .send({ repoId: 'user/dataset' });

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.message).toBe('Session exported to LeRobot format');
      expect(mockTeleoperationService.exportToLeRobot).toHaveBeenCalledWith('session-001', {
        repoId: 'user/dataset',
      });
    });

    it('defaults to empty options when no body sent', async () => {
      mockTeleoperationService.exportToLeRobot.mockResolvedValue({ datasetId: 'ds-2' });

      const response = await request(app).post('/api/teleoperation/sessions/session-001/export');

      expect(response.status).toBe(200);
      expect(mockTeleoperationService.exportToLeRobot).toHaveBeenCalledWith('session-001', {});
    });

    it('returns 400 with service error message on failure', async () => {
      mockTeleoperationService.exportToLeRobot.mockRejectedValue(new Error('Export failed'));

      const response = await request(app)
        .post('/api/teleoperation/sessions/session-001/export')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Export failed');
    });
  });
});

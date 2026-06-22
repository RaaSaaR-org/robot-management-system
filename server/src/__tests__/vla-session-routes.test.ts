/**
 * @file vla-session-routes.test.ts
 * @description Integration tests for VLA session compliance routes
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    robot: {
      findUnique: vi.fn(),
    },
    vlaSession: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../database/index.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { vlaSessionRoutes } from '../routes/vla-session.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/robots', authMiddleware as any, vlaSessionRoutes);
  return app;
}

const ROBOT_ID = 'robot-001';
const SESSION_ID = 'session-001';

const MOCK_SESSION = {
  id: SESSION_ID,
  robotId: ROBOT_ID,
  prompt: 'pick up the cube',
  serverUrl: 'http://vla:8000',
  status: 'running',
  errorMsg: null,
  startedAt: '2026-06-22T00:00:00.000Z',
  stoppedAt: null,
};

describe('VLA Session Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/robots/:robotId/vla-sessions
  // --------------------------------------------------------------------------

  describe('POST /api/robots/:robotId/vla-sessions', () => {
    it('creates a VLA session', async () => {
      mockPrisma.robot.findUnique.mockResolvedValue({ id: ROBOT_ID });
      mockPrisma.vlaSession.create.mockResolvedValue(MOCK_SESSION);

      const response = await request(app)
        .post(`/api/robots/${ROBOT_ID}/vla-sessions`)
        .send({ prompt: 'pick up the cube', serverUrl: 'http://vla:8000' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(SESSION_ID);
      expect(response.body.status).toBe('running');
      expect(mockPrisma.robot.findUnique).toHaveBeenCalledWith({ where: { id: ROBOT_ID } });
      expect(mockPrisma.vlaSession.create).toHaveBeenCalledWith({
        data: {
          robotId: ROBOT_ID,
          prompt: 'pick up the cube',
          serverUrl: 'http://vla:8000',
          status: 'running',
        },
      });
    });

    it('returns 400 when prompt is missing', async () => {
      const response = await request(app)
        .post(`/api/robots/${ROBOT_ID}/vla-sessions`)
        .send({ serverUrl: 'http://vla:8000' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('prompt and serverUrl are required');
      expect(mockPrisma.robot.findUnique).not.toHaveBeenCalled();
    });

    it('returns 400 when serverUrl is missing', async () => {
      const response = await request(app)
        .post(`/api/robots/${ROBOT_ID}/vla-sessions`)
        .send({ prompt: 'pick up the cube' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('prompt and serverUrl are required');
    });

    it('returns 404 when robot does not exist', async () => {
      mockPrisma.robot.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/robots/${ROBOT_ID}/vla-sessions`)
        .send({ prompt: 'pick up the cube', serverUrl: 'http://vla:8000' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Robot not found');
      expect(mockPrisma.vlaSession.create).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockPrisma.robot.findUnique.mockResolvedValue({ id: ROBOT_ID });
      mockPrisma.vlaSession.create.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post(`/api/robots/${ROBOT_ID}/vla-sessions`)
        .send({ prompt: 'pick up the cube', serverUrl: 'http://vla:8000' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create VLA session');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/robots/:robotId/vla-sessions/:sessionId/stop
  // --------------------------------------------------------------------------

  describe('PATCH /api/robots/:robotId/vla-sessions/:sessionId/stop', () => {
    it('stops a running session', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue({ ...MOCK_SESSION });
      const stopped = { ...MOCK_SESSION, status: 'stopped', stoppedAt: '2026-06-22T01:00:00.000Z' };
      mockPrisma.vlaSession.update.mockResolvedValue(stopped);

      const response = await request(app)
        .patch(`/api/robots/${ROBOT_ID}/vla-sessions/${SESSION_ID}/stop`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('stopped');
      expect(mockPrisma.vlaSession.findFirst).toHaveBeenCalledWith({
        where: { id: SESSION_ID, robotId: ROBOT_ID },
      });
      expect(mockPrisma.vlaSession.update).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        data: expect.objectContaining({ status: 'stopped', errorMsg: null }),
      });
    });

    it('stops a session with an error message', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue({ ...MOCK_SESSION });
      const errored = { ...MOCK_SESSION, status: 'error', errorMsg: 'crash' };
      mockPrisma.vlaSession.update.mockResolvedValue(errored);

      const response = await request(app)
        .patch(`/api/robots/${ROBOT_ID}/vla-sessions/${SESSION_ID}/stop`)
        .send({ errorMsg: 'crash' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('error');
      expect(mockPrisma.vlaSession.update).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        data: expect.objectContaining({ status: 'error', errorMsg: 'crash' }),
      });
    });

    it('returns 404 when session not found', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .patch(`/api/robots/${ROBOT_ID}/vla-sessions/${SESSION_ID}/stop`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VLA session not found');
      expect(mockPrisma.vlaSession.update).not.toHaveBeenCalled();
    });

    it('returns 400 when session is not running', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue({ ...MOCK_SESSION, status: 'stopped' });

      const response = await request(app)
        .patch(`/api/robots/${ROBOT_ID}/vla-sessions/${SESSION_ID}/stop`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Session is not running');
      expect(mockPrisma.vlaSession.update).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue({ ...MOCK_SESSION });
      mockPrisma.vlaSession.update.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .patch(`/api/robots/${ROBOT_ID}/vla-sessions/${SESSION_ID}/stop`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to stop VLA session');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/robots/:robotId/vla-sessions
  // --------------------------------------------------------------------------

  describe('GET /api/robots/:robotId/vla-sessions', () => {
    it('lists sessions with default limit', async () => {
      mockPrisma.vlaSession.findMany.mockResolvedValue([MOCK_SESSION]);

      const response = await request(app).get(`/api/robots/${ROBOT_ID}/vla-sessions`);

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0].id).toBe(SESSION_ID);
      expect(mockPrisma.vlaSession.findMany).toHaveBeenCalledWith({
        where: { robotId: ROBOT_ID },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });
    });

    it('respects the limit query param', async () => {
      mockPrisma.vlaSession.findMany.mockResolvedValue([]);

      const response = await request(app).get(`/api/robots/${ROBOT_ID}/vla-sessions?limit=5`);

      expect(response.status).toBe(200);
      expect(mockPrisma.vlaSession.findMany).toHaveBeenCalledWith({
        where: { robotId: ROBOT_ID },
        orderBy: { startedAt: 'desc' },
        take: 5,
      });
    });

    it('returns 500 on service error', async () => {
      mockPrisma.vlaSession.findMany.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`/api/robots/${ROBOT_ID}/vla-sessions`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list VLA sessions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/robots/:robotId/vla-sessions/active
  // --------------------------------------------------------------------------

  describe('GET /api/robots/:robotId/vla-sessions/active', () => {
    it('returns the active session', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue(MOCK_SESSION);

      const response = await request(app).get(`/api/robots/${ROBOT_ID}/vla-sessions/active`);

      expect(response.status).toBe(200);
      expect(response.body.session.id).toBe(SESSION_ID);
      expect(mockPrisma.vlaSession.findFirst).toHaveBeenCalledWith({
        where: { robotId: ROBOT_ID, status: 'running' },
        orderBy: { startedAt: 'desc' },
      });
    });

    it('returns null when no active session', async () => {
      mockPrisma.vlaSession.findFirst.mockResolvedValue(null);

      const response = await request(app).get(`/api/robots/${ROBOT_ID}/vla-sessions/active`);

      expect(response.status).toBe(200);
      expect(response.body.session).toBeNull();
    });

    it('returns 500 on service error', async () => {
      mockPrisma.vlaSession.findFirst.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`/api/robots/${ROBOT_ID}/vla-sessions/active`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch active VLA session');
    });
  });
});

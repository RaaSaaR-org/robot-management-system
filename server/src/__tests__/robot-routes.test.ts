/**
 * @file robot-routes.test.ts
 * @description Tests for robot API routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock robotManager
const mockRobotManager = {
  listRobots: vi.fn(),
  getRobot: vi.fn(),
  registerRobot: vi.fn(),
  unregisterRobot: vi.fn(),
  sendCommand: vi.fn(),
  getTelemetry: vi.fn(),
  getRegisteredRobot: vi.fn(),
  refreshPoses: vi.fn(),
  getPeers: vi.fn(),
};

// Mock the robotManager import
vi.mock('../services/RobotManager.js', () => ({
  robotManager: mockRobotManager,
}));

// Import after mocking
const { robotRoutes } = await import('../routes/robot.routes.js');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/robots', robotRoutes);
  return app;
}

describe('Robot Routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/robots/:id/camera/:name/ticket (TASK-214)', () => {
    /**
     * The route is mounted here WITHOUT authMiddleware, as every test in this
     * file is, so `req.user` has to be supplied — which is also the case the
     * route guards against: minting an unattributed ticket would be worse than
     * refusing, because the stream authenticates FROM the ticket.
     */
    function appWithUser(user: unknown) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as express.Request & { user?: unknown }).user = user;
        next();
      });
      app.use('/api/robots', robotRoutes);
      return app;
    }

    const USER = { id: 'user-7', email: 'op@neodem.local', role: 'operator', tenantId: 'tenant-a' };

    it('mints a ticket scoped to that robot and that camera', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      const { verifyCameraTicket } = await import('../security/cameraTicket.js');

      const res = await request(appWithUser(USER))
        .post('/api/robots/robot-001/camera/head_camera/ticket');

      expect(res.status).toBe(200);
      expect(typeof res.body.ticket).toBe('string');
      expect(res.body.expiresIn).toBeGreaterThan(0);
      expect(verifyCameraTicket(res.body.ticket)).toMatchObject({
        robotId: 'robot-001',
        cameraName: 'head_camera',
        userId: 'user-7',
        tenantId: 'tenant-a',
      });
    });

    it('does not put a bearer credential in the response', async () => {
      // The ticket ends up in a URL. The entire point of TASK-214 is that what
      // sits there is not the caller's access token.
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });

      const res = await request(appWithUser(USER))
        .post('/api/robots/robot-001/camera/head_camera/ticket');

      expect(JSON.stringify(res.body)).not.toContain('access_token');
      expect(Object.keys(res.body).sort()).toEqual(['expiresIn', 'ticket']);
    });

    it('404s for a robot that does not exist', async () => {
      // A signature over a robot id that means nothing is not a ticket, and
      // answering 200 would confirm which ids are real.
      mockRobotManager.getRegisteredRobot.mockResolvedValue(null);

      const res = await request(appWithUser(USER))
        .post('/api/robots/nope/camera/head_camera/ticket');

      expect(res.status).toBe(404);
    });

    it('401s when nothing authenticated the caller', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });

      const res = await request(appWithUser(undefined))
        .post('/api/robots/robot-001/camera/head_camera/ticket');

      expect(res.status).toBe(401);
    });

    it('500s when the lookup rejects, rather than rejecting into the void', async () => {
      // express 4 does not forward a rejected handler promise to the error
      // middleware, and `getRegisteredRobot` reaches Prisma on a cache miss. An
      // unguarded handler answers nothing at all here and takes the process down
      // on the unhandled rejection — every open camera stream, socket and A2A
      // connection with it. The sibling GET on this path has always caught; so
      // must this one.
      mockRobotManager.getRegisteredRobot.mockRejectedValue(
        new Error("Can't reach database server"),
      );

      const res = await request(appWithUser(USER))
        .post('/api/robots/robot-001/camera/head_camera/ticket');

      expect(res.status).toBe(500);
      // And the database's own words do not travel to the caller.
      expect(JSON.stringify(res.body)).not.toContain('database server');
    });
  });

  describe('GET /api/robots/:id/peers (TASK-207)', () => {
    it('refreshes poses first, then lists the other robots for the caller', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ robot: { id: 'r1' } });
      mockRobotManager.refreshPoses.mockResolvedValue(undefined);
      const peers = [{ robotId: 'r2', name: 'Bot-2', x: 1, y: 2, headingDeg: 0, frame: { kind: 'sim', id: 'room' }, footprintRadiusM: 0.35 }];
      mockRobotManager.getPeers.mockReturnValue(peers);

      const res = await request(app).get('/api/robots/r1/peers');

      expect(res.status).toBe(200);
      expect(res.body.robotId).toBe('r1');
      expect(res.body.peers).toEqual(peers);
      expect(typeof res.body.generatedAt).toBe('string');
      expect(mockRobotManager.refreshPoses).toHaveBeenCalledTimes(1);
      expect(mockRobotManager.getPeers).toHaveBeenCalledWith('r1');
    });

    it('404s an unknown caller instead of handing out the fleet', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(app).get('/api/robots/ghost/peers');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
      expect(mockRobotManager.getPeers).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/robots', () => {
    it('returns list of robots', async () => {
      const robots = [
        { id: 'r1', name: 'Bot-1', status: 'idle' },
        { id: 'r2', name: 'Bot-2', status: 'busy' },
      ];
      mockRobotManager.listRobots.mockResolvedValue(robots);

      const res = await request(app).get('/api/robots');

      expect(res.status).toBe(200);
      expect(res.body.robots).toHaveLength(2);
      expect(res.body.pagination.total).toBe(2);
    });

    it('returns empty list when no robots', async () => {
      mockRobotManager.listRobots.mockResolvedValue([]);

      const res = await request(app).get('/api/robots');

      expect(res.status).toBe(200);
      expect(res.body.robots).toHaveLength(0);
    });

    it('returns 500 on service error', async () => {
      mockRobotManager.listRobots.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/api/robots');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list robots');
    });
  });

  describe('GET /api/robots/:id', () => {
    it('returns a robot by ID', async () => {
      const robot = { id: 'r1', name: 'Bot-1', status: 'idle' };
      mockRobotManager.getRobot.mockResolvedValue(robot);

      const res = await request(app).get('/api/robots/r1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('r1');
    });

    it('returns 404 for unknown robot', async () => {
      mockRobotManager.getRobot.mockResolvedValue(null);

      const res = await request(app).get('/api/robots/unknown');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Robot not found');
    });
  });

  describe('POST /api/robots/register', () => {
    it('registers a robot from URL', async () => {
      mockRobotManager.registerRobot.mockResolvedValue({
        robot: { id: 'r1', name: 'New Bot' },
        endpoints: { rest: 'http://localhost:41243' },
        agentCard: { name: 'New Bot' },
      });

      const res = await request(app)
        .post('/api/robots/register')
        .send({ robotUrl: 'http://localhost:41243' });

      expect(res.status).toBe(200);
      expect(res.body.robot.id).toBe('r1');
    });

    it('returns 400 when robotUrl is missing', async () => {
      const res = await request(app)
        .post('/api/robots/register')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('robotUrl is required');
    });

    it('returns 400 for invalid URL', async () => {
      const res = await request(app)
        .post('/api/robots/register')
        .send({ robotUrl: 'not-a-url' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid URL format');
    });
  });

  describe('DELETE /api/robots/:id', () => {
    it('unregisters a robot', async () => {
      mockRobotManager.unregisterRobot.mockResolvedValue(true);

      const res = await request(app).delete('/api/robots/r1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for unknown robot', async () => {
      mockRobotManager.unregisterRobot.mockResolvedValue(false);

      const res = await request(app).delete('/api/robots/unknown');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/robots/:id/command', () => {
    it('sends command to robot', async () => {
      const cmd = { id: 'cmd-1', type: 'move', status: 'sent' };
      mockRobotManager.sendCommand.mockResolvedValue(cmd);

      const res = await request(app)
        .post('/api/robots/r1/command')
        .send({ type: 'move', payload: { x: 10, y: 20 } });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('cmd-1');
    });

    it('returns 400 when type is missing', async () => {
      const res = await request(app)
        .post('/api/robots/r1/command')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Command type is required');
    });

    it('returns 404 when robot not found', async () => {
      mockRobotManager.sendCommand.mockRejectedValue(new Error('Robot not found'));

      const res = await request(app)
        .post('/api/robots/r1/command')
        .send({ type: 'move' });

      expect(res.status).toBe(404);
    });
  });
});

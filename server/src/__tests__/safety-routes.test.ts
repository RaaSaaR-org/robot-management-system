/**
 * @file safety-routes.test.ts
 * @description Integration tests for safety routes (E-stop, fleet & zone safety, heartbeats)
 * @feature safety
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockSafetyService } = vi.hoisted(() => ({
  mockSafetyService: {
    getRobotSafetyStatus: vi.fn(),
    triggerRobotEStop: vi.fn(),
    resetRobotEStop: vi.fn(),
    getFleetSafetyStatus: vi.fn(),
    triggerFleetEStop: vi.fn(),
    resetFleetEStop: vi.fn(),
    triggerZoneEStop: vi.fn(),
    getEStopLog: vi.fn(),
    startHeartbeats: vi.fn(),
    stopHeartbeats: vi.fn(),
  },
}));

vi.mock('../services/SafetyService.js', () => ({
  safetyService: mockSafetyService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { safetyRoutes } from '../routes/safety.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/safety', authMiddleware as any, safetyRoutes);
  return app;
}

describe('Safety Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/safety/robots/:id
  // --------------------------------------------------------------------------

  describe('GET /api/safety/robots/:id', () => {
    it('returns robot safety status', async () => {
      const status = { robotId: 'robot-1', estopActive: false, connected: true };
      mockSafetyService.getRobotSafetyStatus.mockResolvedValue(status);

      const response = await request(app).get('/api/safety/robots/robot-1');

      expect(response.status).toBe(200);
      expect(response.body.robotId).toBe('robot-1');
      expect(response.body.estopActive).toBe(false);
      expect(mockSafetyService.getRobotSafetyStatus).toHaveBeenCalledWith('robot-1');
    });

    it('returns 404 when robot not found', async () => {
      mockSafetyService.getRobotSafetyStatus.mockRejectedValue(new Error('Robot not found'));

      const response = await request(app).get('/api/safety/robots/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Robot not found');
    });

    it('returns 503 when robot not connected', async () => {
      mockSafetyService.getRobotSafetyStatus.mockRejectedValue(
        new Error('Robot not connected')
      );

      const response = await request(app).get('/api/safety/robots/robot-1');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Robot not connected');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSafetyService.getRobotSafetyStatus.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/safety/robots/robot-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get safety status');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/robots/:id/estop
  // --------------------------------------------------------------------------

  describe('POST /api/safety/robots/:id/estop', () => {
    it('triggers E-stop on a robot', async () => {
      mockSafetyService.triggerRobotEStop.mockResolvedValue({ robotId: 'robot-1', estopActive: true });

      const response = await request(app)
        .post('/api/safety/robots/robot-1/estop')
        .send({ reason: 'obstacle', triggeredBy: 'operator-1' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Emergency stop triggered');
      expect(response.body.estopActive).toBe(true);
      expect(mockSafetyService.triggerRobotEStop).toHaveBeenCalledWith(
        'robot-1',
        'obstacle',
        'operator-1'
      );
    });

    it('defaults triggeredBy to "server" when omitted', async () => {
      mockSafetyService.triggerRobotEStop.mockResolvedValue({ robotId: 'robot-1', estopActive: true });

      const response = await request(app)
        .post('/api/safety/robots/robot-1/estop')
        .send({ reason: 'obstacle' });

      expect(response.status).toBe(200);
      expect(mockSafetyService.triggerRobotEStop).toHaveBeenCalledWith(
        'robot-1',
        'obstacle',
        'server'
      );
    });

    it('returns 400 when reason is missing', async () => {
      const response = await request(app)
        .post('/api/safety/robots/robot-1/estop')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reason is required');
      expect(mockSafetyService.triggerRobotEStop).not.toHaveBeenCalled();
    });

    it('returns 404 when robot not found', async () => {
      mockSafetyService.triggerRobotEStop.mockRejectedValue(new Error('Robot not found'));

      const response = await request(app)
        .post('/api/safety/robots/missing/estop')
        .send({ reason: 'test' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Robot not found');
    });

    it('returns 503 when robot not connected', async () => {
      mockSafetyService.triggerRobotEStop.mockRejectedValue(new Error('Robot not connected'));

      const response = await request(app)
        .post('/api/safety/robots/robot-1/estop')
        .send({ reason: 'test' });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Robot not connected');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSafetyService.triggerRobotEStop.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/safety/robots/robot-1/estop')
        .send({ reason: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to trigger E-stop');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/robots/:id/estop/reset
  // --------------------------------------------------------------------------

  describe('POST /api/safety/robots/:id/estop/reset', () => {
    it('resets E-stop on a robot', async () => {
      mockSafetyService.resetRobotEStop.mockResolvedValue({ robotId: 'robot-1', estopActive: false });

      const response = await request(app).post('/api/safety/robots/robot-1/estop/reset');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('E-stop reset successfully');
      expect(response.body.estopActive).toBe(false);
      expect(mockSafetyService.resetRobotEStop).toHaveBeenCalledWith('robot-1');
    });

    it('returns 404 when robot not found', async () => {
      mockSafetyService.resetRobotEStop.mockRejectedValue(new Error('Robot not found'));

      const response = await request(app).post('/api/safety/robots/missing/estop/reset');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Robot not found');
    });

    it('returns 503 when robot not connected', async () => {
      mockSafetyService.resetRobotEStop.mockRejectedValue(new Error('Robot not connected'));

      const response = await request(app).post('/api/safety/robots/robot-1/estop/reset');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Robot not connected');
    });

    it('returns 400 when reset is not allowed', async () => {
      mockSafetyService.resetRobotEStop.mockRejectedValue(
        new Error('Cannot reset E-stop while active fault present')
      );

      const response = await request(app).post('/api/safety/robots/robot-1/estop/reset');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Cannot reset');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSafetyService.resetRobotEStop.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/safety/robots/robot-1/estop/reset');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reset E-stop');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/safety/fleet
  // --------------------------------------------------------------------------

  describe('GET /api/safety/fleet', () => {
    it('returns fleet safety status with timestamp', async () => {
      mockSafetyService.getFleetSafetyStatus.mockResolvedValue({
        total: 3,
        estopped: 1,
        robots: [],
      });

      const response = await request(app).get('/api/safety/fleet');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(3);
      expect(response.body.estopped).toBe(1);
      expect(typeof response.body.timestamp).toBe('string');
      expect(mockSafetyService.getFleetSafetyStatus).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSafetyService.getFleetSafetyStatus.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/safety/fleet');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get fleet safety status');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/fleet/estop
  // --------------------------------------------------------------------------

  describe('POST /api/safety/fleet/estop', () => {
    it('triggers fleet-wide E-stop', async () => {
      mockSafetyService.triggerFleetEStop.mockResolvedValue({ triggered: 5, failed: 0 });

      const response = await request(app)
        .post('/api/safety/fleet/estop')
        .send({ reason: 'fire alarm', triggeredBy: 'operator-1' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Fleet-wide emergency stop triggered');
      expect(response.body.triggered).toBe(5);
      expect(mockSafetyService.triggerFleetEStop).toHaveBeenCalledWith('fire alarm', 'operator-1');
    });

    it('defaults triggeredBy to "server" when omitted', async () => {
      mockSafetyService.triggerFleetEStop.mockResolvedValue({ triggered: 1, failed: 0 });

      const response = await request(app)
        .post('/api/safety/fleet/estop')
        .send({ reason: 'fire alarm' });

      expect(response.status).toBe(200);
      expect(mockSafetyService.triggerFleetEStop).toHaveBeenCalledWith('fire alarm', 'server');
    });

    it('returns 400 when reason is missing', async () => {
      const response = await request(app).post('/api/safety/fleet/estop').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reason is required');
      expect(mockSafetyService.triggerFleetEStop).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSafetyService.triggerFleetEStop.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/safety/fleet/estop')
        .send({ reason: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to trigger fleet E-stop');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/fleet/estop/reset
  // --------------------------------------------------------------------------

  describe('POST /api/safety/fleet/estop/reset', () => {
    it('resets fleet-wide E-stop', async () => {
      mockSafetyService.resetFleetEStop.mockResolvedValue({ reset: 5, failed: 0 });

      const response = await request(app).post('/api/safety/fleet/estop/reset');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Fleet E-stop reset initiated');
      expect(response.body.reset).toBe(5);
      expect(mockSafetyService.resetFleetEStop).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSafetyService.resetFleetEStop.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/safety/fleet/estop/reset');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reset fleet E-stop');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/zones/:id/estop
  // --------------------------------------------------------------------------

  describe('POST /api/safety/zones/:id/estop', () => {
    it('triggers zone E-stop', async () => {
      mockSafetyService.triggerZoneEStop.mockResolvedValue({
        zoneName: 'Warehouse A',
        triggered: 2,
      });

      const response = await request(app)
        .post('/api/safety/zones/zone-1/estop')
        .send({ reason: 'spill', triggeredBy: 'operator-1' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Zone E-stop triggered for Warehouse A');
      expect(response.body.triggered).toBe(2);
      expect(mockSafetyService.triggerZoneEStop).toHaveBeenCalledWith(
        'zone-1',
        'spill',
        'operator-1'
      );
    });

    it('defaults triggeredBy to "server" when omitted', async () => {
      mockSafetyService.triggerZoneEStop.mockResolvedValue({ zoneName: 'Zone B', triggered: 0 });

      const response = await request(app)
        .post('/api/safety/zones/zone-1/estop')
        .send({ reason: 'spill' });

      expect(response.status).toBe(200);
      expect(mockSafetyService.triggerZoneEStop).toHaveBeenCalledWith('zone-1', 'spill', 'server');
    });

    it('returns 400 when reason is missing', async () => {
      const response = await request(app).post('/api/safety/zones/zone-1/estop').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reason is required');
      expect(mockSafetyService.triggerZoneEStop).not.toHaveBeenCalled();
    });

    it('returns 404 when zone not found', async () => {
      mockSafetyService.triggerZoneEStop.mockRejectedValue(new Error('Zone not found'));

      const response = await request(app)
        .post('/api/safety/zones/missing/estop')
        .send({ reason: 'test' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Zone not found');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSafetyService.triggerZoneEStop.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/safety/zones/zone-1/estop')
        .send({ reason: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to trigger zone E-stop');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/safety/events
  // --------------------------------------------------------------------------

  describe('GET /api/safety/events', () => {
    it('returns E-stop event log with default limit', async () => {
      const events = [{ id: 'e1' }, { id: 'e2' }];
      mockSafetyService.getEStopLog.mockReturnValue(events);

      const response = await request(app).get('/api/safety/events');

      expect(response.status).toBe(200);
      expect(response.body.events).toEqual(events);
      expect(response.body.count).toBe(2);
      expect(mockSafetyService.getEStopLog).toHaveBeenCalledWith(50);
    });

    it('respects the limit query param', async () => {
      mockSafetyService.getEStopLog.mockReturnValue([]);

      const response = await request(app).get('/api/safety/events?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(0);
      expect(mockSafetyService.getEStopLog).toHaveBeenCalledWith(10);
    });

    it('returns 500 on service error', async () => {
      mockSafetyService.getEStopLog.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/safety/events');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get E-stop events');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/heartbeats/start
  // --------------------------------------------------------------------------

  describe('POST /api/safety/heartbeats/start', () => {
    it('starts heartbeats with provided interval', async () => {
      mockSafetyService.startHeartbeats.mockReturnValue(undefined);

      const response = await request(app)
        .post('/api/safety/heartbeats/start')
        .send({ intervalMs: 1000 });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Heartbeats started');
      expect(response.body.intervalMs).toBe(1000);
      expect(mockSafetyService.startHeartbeats).toHaveBeenCalledWith(1000);
    });

    it('defaults interval to 500 when omitted', async () => {
      mockSafetyService.startHeartbeats.mockReturnValue(undefined);

      const response = await request(app).post('/api/safety/heartbeats/start').send({});

      expect(response.status).toBe(200);
      expect(response.body.intervalMs).toBe(500);
      expect(mockSafetyService.startHeartbeats).toHaveBeenCalledWith(500);
    });

    it('returns 500 on service error', async () => {
      mockSafetyService.startHeartbeats.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .post('/api/safety/heartbeats/start')
        .send({ intervalMs: 500 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to start heartbeats');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/safety/heartbeats/stop
  // --------------------------------------------------------------------------

  describe('POST /api/safety/heartbeats/stop', () => {
    it('stops heartbeats', async () => {
      mockSafetyService.stopHeartbeats.mockReturnValue(undefined);

      const response = await request(app).post('/api/safety/heartbeats/stop');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Heartbeats stopped');
      expect(mockSafetyService.stopHeartbeats).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSafetyService.stopHeartbeats.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).post('/api/safety/heartbeats/stop');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to stop heartbeats');
    });
  });
});

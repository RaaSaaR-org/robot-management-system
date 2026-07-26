/**
 * @file agent-mode-routes.test.ts
 * @description Integration tests for the Agent Mode routes (TASK-194):
 *              robot-agent event ingest + validation, in-memory state/scene
 *              reads, and the robot-agent proxies incl. error mapping.
 * @feature agentmode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockAgentModeService, mockRobotManager, mockPost, mockGet, MockHttpClient } = vi.hoisted(
  () => {
    const mockPost = vi.fn();
    const mockGet = vi.fn();
    return {
      mockAgentModeService: {
        ingest: vi.fn(),
        getState: vi.fn(),
        isHydrated: vi.fn(),
        getScene: vi.fn(),
        getRecentEvents: vi.fn(),
        onAgentModeEvent: vi.fn(),
      },
      mockRobotManager: {
        getRegisteredRobot: vi.fn(),
      },
      mockPost,
      mockGet,
      MockHttpClient: class {
        post = mockPost;
        get = mockGet;
      },
    };
  }
);

// Keep the real isValidAgentModeSnapshot so the GET fallback's anti-fabrication
// guard is exercised for real; only the stateful singleton is faked.
vi.mock('../services/AgentModeService.js', async () => {
  const actual = await vi.importActual<typeof import('../services/AgentModeService.js')>(
    '../services/AgentModeService.js'
  );
  return {
    ...actual,
    agentModeService: mockAgentModeService,
  };
});

vi.mock('../services/RobotManager.js', () => ({
  robotManager: mockRobotManager,
}));

// Keep the real HttpClientError / HTTP_TIMEOUTS so the 502 mapping is exercised
// against the real isNetworkError() logic; only the transport is faked.
vi.mock('../services/HttpClient.js', async () => {
  const actual = await vi.importActual<typeof import('../services/HttpClient.js')>(
    '../services/HttpClient.js'
  );
  return {
    ...actual,
    HttpClient: MockHttpClient,
  };
});

import { agentModeRoutes } from '../routes/agent-mode.routes.js';
import { HttpClientError } from '../services/HttpClient.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/robots', agentModeRoutes);
  return app;
}

const PLAN = {
  id: 'plan-1',
  robotId: 'robot-001',
  command: 'walk to the table with the hat',
  blocks: [
    { id: 'b1', kind: 'scan_room', params: { steps: 8 }, status: 'running' },
    { id: 'b2', kind: 'walk', params: { distanceM: 1, direction: 'forward' }, status: 'pending' },
  ],
  cursor: 0,
  status: 'running',
  createdAt: '2026-07-25T10:00:00.000Z',
  updatedAt: '2026-07-25T10:00:01.000Z',
};

const STATE = {
  robotId: 'robot-001',
  enabled: true,
  controlOwner: 'agent',
  plan: PLAN,
  scene: null,
  estopActive: false,
};

const SCENE = {
  robotId: 'robot-001',
  currentView: 'A table with a hat, a chair on the left.',
  entities: [
    { label: 'table', bearingDeg: 12, distanceEstM: 2.4, confidence: 0.8, lastSeen: '2026-07-25T10:00:02.000Z' },
  ],
  personVisible: false,
  updatedAt: '2026-07-25T10:00:02.000Z',
};

describe('agent-mode routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // -------------------------------------------------------------------------
  // Ingest
  // -------------------------------------------------------------------------
  describe('POST /:id/agent-mode/events', () => {
    it('ingests a valid event and returns the merged state', async () => {
      mockAgentModeService.ingest.mockReturnValue(STATE);

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({
          type: 'agent:block:started',
          robotId: 'robot-001',
          plan: PLAN,
          block: PLAN.blocks[0],
          timestamp: '2026-07-25T10:00:01.000Z',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.state).toMatchObject({ robotId: 'robot-001', enabled: true });
      expect(mockAgentModeService.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:block:started',
          robotId: 'robot-001',
          timestamp: '2026-07-25T10:00:01.000Z',
        })
      );
    });

    it('defaults a missing timestamp to now', async () => {
      mockAgentModeService.ingest.mockReturnValue(STATE);

      await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ type: 'agent:state:changed', robotId: 'robot-001', state: STATE });

      const event = mockAgentModeService.ingest.mock.calls[0][0];
      expect(typeof event.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    });

    it('uses the path parameter as the authoritative robotId', async () => {
      mockAgentModeService.ingest.mockReturnValue(STATE);

      await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ type: 'agent:scene:updated', robotId: 'someone-else', scene: SCENE });

      expect(mockAgentModeService.ingest.mock.calls[0][0].robotId).toBe('robot-001');
    });

    it('rejects an unknown event type with 400', async () => {
      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ type: 'agent:frobnicate', robotId: 'robot-001' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid type');
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('rejects a missing type with 400', async () => {
      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ robotId: 'robot-001' });

      expect(res.status).toBe(400);
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('rejects a missing robotId with 400', async () => {
      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ type: 'agent:plan:started', plan: PLAN });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('robotId is required');
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockAgentModeService.ingest.mockImplementation(() => {
        throw new Error('boom');
      });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ type: 'agent:plan:started', robotId: 'robot-001', plan: PLAN });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to ingest agent mode event');
    });
  });

  // -------------------------------------------------------------------------
  // State / scene reads
  // -------------------------------------------------------------------------
  describe('GET /:id/agent-mode', () => {
    it('returns the last known state', async () => {
      mockAgentModeService.getState.mockReturnValue(STATE);
      mockAgentModeService.isHydrated.mockReturnValue(true);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ robotId: 'robot-001', controlOwner: 'agent' });
      expect(res.body.plan.blocks).toHaveLength(2);
      expect(mockAgentModeService.getState).toHaveBeenCalledWith('robot-001');
      // No proxy call when the stored state is the robot's own answer.
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('404s when nothing has been ingested for the robot', async () => {
      mockAgentModeService.getState.mockReturnValue(null);

      const res = await request(createApp()).get('/api/robots/unknown/agent-mode');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No agent mode state for robot');
    });

    it('asks the robot when the mirror was only seeded by a partial event', async () => {
      // Seen live: server restart, then the running robot's next event was a
      // plan event. getState() returns a populated object whose `enabled` and
      // `estopActive` are `emptyState()` defaults — serving it reported an
      // enabled robot as off, and would report a latched E-Stop as clear.
      mockAgentModeService.getState.mockReturnValue({
        ...STATE,
        enabled: false,
        estopActive: false,
        controlOwner: 'idle',
      });
      mockAgentModeService.isHydrated.mockReturnValue(false);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue({ ...STATE, enabled: true, estopActive: true });
      mockAgentModeService.ingest.mockImplementation((e) => e.state);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.estopActive).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode');
      // The live snapshot is seeded back through ingest, so the mirror and the
      // WebSocket feed agree from here on.
      expect(mockAgentModeService.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent:state:changed', robotId: 'robot-001' })
      );
    });

    it('404s when the robot answers 200 with an empty body instead of fabricating a state', async () => {
      // A falsy body must not reach ingest: it would seed the mirror from
      // emptyState() and the route would return fabricated `enabled: false` /
      // `estopActive: false` with a 200.
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(undefined);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No agent mode state for robot');
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('404s when the robot answers 200 with a shapeless body', async () => {
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue({ robotId: 'robot-001' }); // no enabled / estopActive

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No agent mode state for robot');
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('404s rather than serving an unhydrated state when the robot is unreachable', async () => {
      mockAgentModeService.getState.mockReturnValue({ ...STATE, enabled: false });
      mockAgentModeService.isHydrated.mockReturnValue(false);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No agent mode state for robot');
    });
  });

  describe('GET /:id/agent-mode/scene', () => {
    it('returns the last known scene memory', async () => {
      mockAgentModeService.getScene.mockReturnValue(SCENE);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/scene');

      expect(res.status).toBe(200);
      expect(res.body.entities[0].label).toBe('table');
    });

    it('returns null when no scene is known', async () => {
      mockAgentModeService.getScene.mockReturnValue(null);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/scene');

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Proxies
  // -------------------------------------------------------------------------
  describe('POST /:id/agent-mode/command', () => {
    it('forwards the command to the robot agent', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ accepted: true, planId: 'plan-1', message: 'Verstanden' });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/command')
        .send({ text: 'walk to the table', contextId: 'ctx-1' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true, planId: 'plan-1' });
      expect(mockPost).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode/command', {
        text: 'walk to the table',
        contextId: 'ctx-1',
      });
    });

    it('400s on an empty command', async () => {
      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/command')
        .send({ text: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text is required');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('404s when the robot is not registered', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp())
        .post('/api/robots/nope/agent-mode/command')
        .send({ text: 'hallo' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Robot not found');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('502s when the robot agent is unreachable', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(new HttpClientError('Connection refused: http://robot:41243'));

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/command')
        .send({ text: 'hallo' });

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('Unable to communicate with robot agent');
    });

    it('500s on an unexpected proxy failure', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(new Error('kaboom'));

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/command')
        .send({ text: 'hallo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to send agent mode command');
    });
  });

  describe('POST /:id/agent-mode/toggle', () => {
    it('forwards the toggle to the robot agent', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ ...STATE, enabled: false });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/toggle')
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(mockPost).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode/toggle', {
        enabled: false,
      });
    });

    it('400s when enabled is not a boolean', async () => {
      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/toggle')
        .send({ enabled: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('enabled must be a boolean');
    });

    it('502s when the robot agent times out', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(new HttpClientError('Request timeout after 10000ms'));

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/toggle')
        .send({ enabled: true });

      expect(res.status).toBe(502);
    });
  });

  describe('POST /:id/agent-mode/estop', () => {
    it('forwards the e-stop with its reason', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ ok: true, stopped: true });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/estop')
        .send({ reason: 'operator pressed STOPP' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, stopped: true });
      expect(mockPost).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode/estop', {
        reason: 'operator pressed STOPP',
      });
    });

    it('404s when the robot is not registered', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp())
        .post('/api/robots/nope/agent-mode/estop')
        .send({});

      expect(res.status).toBe(404);
    });

    it('502s when the robot agent is unreachable', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(new HttpClientError('ECONNREFUSED'));

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/estop')
        .send({});

      expect(res.status).toBe(502);
    });
  });

  // Without this proxy a latched E-Stop is a dead end: the UI can stop the
  // robot but can never hand control back.
  describe('POST /:id/agent-mode/estop/reset', () => {
    it('forwards the reset to the robot agent', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ ...STATE, estopActive: false });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/estop/reset')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.estopActive).toBe(false);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/robots/robot-001/agent-mode/estop/reset',
        {}
      );
    });

    it('does not collide with the plain e-stop route', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ ok: true, stopped: true });

      await request(createApp()).post('/api/robots/robot-001/agent-mode/estop').send({});

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/robots/robot-001/agent-mode/estop',
        expect.anything()
      );
    });

    it('404s when the robot is not registered', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp())
        .post('/api/robots/nope/agent-mode/estop/reset')
        .send({});

      expect(res.status).toBe(404);
    });

    it('502s when the robot agent is unreachable', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(new HttpClientError('ECONNREFUSED'));

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/estop/reset')
        .send({});

      expect(res.status).toBe(502);
    });
  });
});

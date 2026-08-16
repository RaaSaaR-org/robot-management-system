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

const {
  mockAgentModeService,
  mockRobotManager,
  mockPost,
  mockGet,
  httpClientArgs,
  MockHttpClient,
} = vi.hoisted(() => {
  const mockPost = vi.fn();
  const mockGet = vi.fn();
  /** Constructor arguments of every HttpClient the routes build. */
  const httpClientArgs: unknown[][] = [];
  return {
    mockAgentModeService: {
      ingest: vi.fn(),
      getState: vi.fn(),
      getMirroredAt: vi.fn(),
      getStateMirroredAt: vi.fn(),
      nowIso: vi.fn(() => '2026-08-02T07:10:00.000Z'),
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
    httpClientArgs,
    MockHttpClient: class {
      post = mockPost;
      get = mockGet;
      constructor(...args: unknown[]) {
        httpClientArgs.push(args);
      }
    },
  };
});

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

import { agentModeRoutes, AGENT_STATE_UNAVAILABLE } from '../routes/agent-mode.routes.js';
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

const MEMORY_DIGEST = {
  robotId: 'robot-001',
  place: 'AISLE-3',
  memoryBytes: 412,
  memoryMaxBytes: 8192,
  memoryEntries: 3,
  places: [{ id: 'AISLE-3', entries: 2, bytes: 180 }],
  journalDays: ['2026-08-01', '2026-08-02'],
  retention: null,
  updatedAt: '2026-08-02T10:00:00.000Z',
};

const IDENTITY = {
  identity: { name: 'Nova', emoji: '🤖', operator: 'Sam Weber', site: 'Halle 3' },
  self: { robotId: 'robot-001', name: 'Nova', bootstrapRequired: false },
  report: 'I am Nova.',
};

describe('agent-mode routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpClientArgs.length = 0;
    vi.unstubAllEnvs();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

    it('carries the memory digest through to the service', async () => {
      // Dropped here, `agent:memory:updated` reached the WebSocket as an empty
      // envelope: the robot said its durable memory changed and the app was
      // told an event happened without being told what it was.
      mockAgentModeService.ingest.mockReturnValue(STATE);

      await request(createApp())
        .post('/api/robots/robot-001/agent-mode/events')
        .send({ type: 'agent:memory:updated', robotId: 'robot-001', memory: MEMORY_DIGEST });

      expect(mockAgentModeService.ingest.mock.calls[0][0].memory).toEqual(MEMORY_DIGEST);
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

    it('502s when the robot answers 200 with an empty body instead of fabricating a state', async () => {
      // A falsy body must not reach ingest: it would seed the mirror from
      // emptyState() and the route would return fabricated `enabled: false` /
      // `estopActive: false` with a 200.
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(undefined);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('502s when the robot answers 200 with a shapeless body', async () => {
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue({ robotId: 'robot-001' }); // no enabled / estopActive

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('502s rather than serving an unhydrated state when the robot is unreachable', async () => {
      mockAgentModeService.getState.mockReturnValue({ ...STATE, enabled: false });
      mockAgentModeService.isHydrated.mockReturnValue(false);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
    });

    it('answers a REACHABILITY failure differently from an unknown robot', async () => {
      // THE PROBE for the false-safe display. Both used to be 404 with the same
      // body, so a client could not tell "there is no such robot" from "nobody
      // could ask the robot" — and rendered the second one as
      // "Agent Mode off, E-Stop clear", which is a safety claim about a robot
      // whose latch is unknown.
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);
      const unknownRobot = await request(createApp()).get('/api/robots/nope/agent-mode');

      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new HttpClientError('HTTP 401: MEMORY_TOKEN_REQUIRED', 401));
      const unreachable = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(unknownRobot.status).toBe(404);
      expect(unknownRobot.body.code).toBeUndefined();
      expect(unreachable.status).toBe(502);
      expect(unreachable.body.code).toBe('AGENT_STATE_UNAVAILABLE');
      // The message must not read as a state — an operator seeing it has to
      // know the E-Stop latch is unknown, not clear.
      expect(unreachable.body.error).toContain('UNKNOWN');
      expect(mockAgentModeService.ingest).not.toHaveBeenCalled();
    });

    it('never dates a failure — the 404 and 502 bodies stay exactly as they were', async () => {
      // `mirroredAt` is a property of an ANSWER. Attaching it to "we could not
      // ask the robot" would be a timestamp on nothing, and a client keying off
      // its presence would read the 502 as a state.
      mockAgentModeService.getState.mockReturnValue(null);
      mockAgentModeService.getMirroredAt.mockReturnValue('2026-08-02T07:03:00.000Z');

      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);
      const notFound = await request(createApp()).get('/api/robots/nope/agent-mode');

      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new HttpClientError('ECONNREFUSED'));
      const unreachable = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(notFound.status).toBe(404);
      expect(notFound.body).toEqual({ error: 'No agent mode state for robot' });
      expect(unreachable.status).toBe(502);
      expect(unreachable.body).toEqual({ ...AGENT_STATE_UNAVAILABLE });
      expect('mirroredAt' in unreachable.body).toBe(false);
      expect('stateMirroredAt' in unreachable.body).toBe(false);
      expect('serverNow' in unreachable.body).toBe(false);
    });

    it('presents AGENT_MEMORY_TOKEN to the robot’s personal-data gate', async () => {
      // The agent gates this route. Off-loopback (a split-host deployment) an
      // unauthenticated fallback is a 401, and the whole fallback — the reason
      // this route asks the robot at all — never works there.
      vi.stubEnv('AGENT_MEMORY_TOKEN', 'fleet-secret');
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(STATE);
      mockAgentModeService.ingest.mockImplementation((e) => e.state);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(httpClientArgs.at(-1)).toEqual([
        'http://robot:41243',
        expect.any(Number),
        { Authorization: 'Bearer fleet-secret' },
      ]);
    });

    it('sends no Authorization header when no shared secret is configured', async () => {
      // The single-box default: the agent answers loopback callers without a
      // token, and inventing an empty bearer would only make it 401.
      vi.stubEnv('AGENT_MEMORY_TOKEN', '');
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(STATE);
      mockAgentModeService.ingest.mockImplementation((e) => e.state);

      await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(httpClientArgs.at(-1)?.[2]).toEqual({});
    });

    // TASK-200: the age of the answer. Without it no client can tell a live
    // robot from a snapshot a dead process left behind, and the app stamped its
    // own fetch time — which is always "just now".
    it('stamps the state with when the mirror last heard from the robot', async () => {
      mockAgentModeService.getState.mockReturnValue(STATE);
      mockAgentModeService.isHydrated.mockReturnValue(true);
      mockAgentModeService.getMirroredAt.mockReturnValue('2026-08-02T07:03:00.000Z');

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(res.body.mirroredAt).toBe('2026-08-02T07:03:00.000Z');
      expect(mockAgentModeService.getMirroredAt).toHaveBeenCalledWith('robot-001');
      // The robot's own answer is untouched beside it.
      expect(res.body).toMatchObject({ robotId: 'robot-001', enabled: true });
    });

    it('says null rather than omitting the age it cannot report', async () => {
      // Absent and null must not be the same wire answer: a client has to be
      // able to see "this server cannot date the snapshot" and render an
      // unknown age instead of inventing one.
      mockAgentModeService.getState.mockReturnValue(STATE);
      mockAgentModeService.isHydrated.mockReturnValue(true);
      mockAgentModeService.getMirroredAt.mockReturnValue(null);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(res.body.mirroredAt).toBeNull();
      expect('mirroredAt' in res.body).toBe(true);
    });

    it('stamps the state it seeded from the robot too', async () => {
      mockAgentModeService.getState.mockReturnValue(null);
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(STATE);
      mockAgentModeService.ingest.mockImplementation((e) => e.state);
      mockAgentModeService.getMirroredAt.mockReturnValue('2026-08-02T07:05:00.000Z');
      mockAgentModeService.getStateMirroredAt.mockReturnValue('2026-08-02T07:05:00.000Z');

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(res.body.mirroredAt).toBe('2026-08-02T07:05:00.000Z');
      expect(res.body.stateMirroredAt).toBe('2026-08-02T07:05:00.000Z');
    });

    // A reviewer's find: `mirroredAt` moves on ANY event, but the client dates
    // the `self` inside the body by it. A block event then re-dates a snapshot
    // it never touched.
    it('dates the BODY by the last snapshot, not by the last event of any kind', async () => {
      mockAgentModeService.getState.mockReturnValue(STATE);
      mockAgentModeService.isHydrated.mockReturnValue(true);
      // Alive 2 s ago (a block event); but what it last SAID is 30 minutes old.
      mockAgentModeService.getMirroredAt.mockReturnValue('2026-08-02T07:09:58.000Z');
      mockAgentModeService.getStateMirroredAt.mockReturnValue('2026-08-02T06:40:00.000Z');

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.status).toBe(200);
      expect(res.body.mirroredAt).toBe('2026-08-02T07:09:58.000Z');
      expect(res.body.stateMirroredAt).toBe('2026-08-02T06:40:00.000Z');
      expect(mockAgentModeService.getStateMirroredAt).toHaveBeenCalledWith('robot-001');
    });

    // A reviewer's find: the client used to subtract the server's stamp from
    // its OWN clock. Skew then either re-hid staleness or painted every fresh
    // read as cached. The frame the stamps live in has to travel with them.
    it('reports its own clock, so the age can be taken in one frame', async () => {
      mockAgentModeService.getState.mockReturnValue(STATE);
      mockAgentModeService.isHydrated.mockReturnValue(true);
      mockAgentModeService.getMirroredAt.mockReturnValue('2026-08-02T07:09:45.000Z');
      mockAgentModeService.getStateMirroredAt.mockReturnValue('2026-08-02T07:09:45.000Z');

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.body.serverNow).toBe('2026-08-02T07:10:00.000Z');
      expect(Date.parse(res.body.serverNow) - Date.parse(res.body.stateMirroredAt)).toBe(15_000);
    });

    it('says null rather than omitting a snapshot age it cannot report', async () => {
      mockAgentModeService.getState.mockReturnValue(STATE);
      mockAgentModeService.isHydrated.mockReturnValue(true);
      mockAgentModeService.getMirroredAt.mockReturnValue('2026-08-02T07:03:00.000Z');
      mockAgentModeService.getStateMirroredAt.mockReturnValue(null);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode');

      expect(res.body.stateMirroredAt).toBeNull();
      expect('stateMirroredAt' in res.body).toBe(true);
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
  // Occupancy map proxy (TASK-206/207)
  // -------------------------------------------------------------------------
  describe('GET /:id/agent-mode/map', () => {
    const MAP = {
      ok: true,
      frame: 'odom',
      grid: { encoding: 'int8-logodds-b64', width: 2, height: 1, data: 'AAA=' },
      pose: { x: 0, y: 0, yawDeg: 0 },
      keepouts: [],
      peers: [{ robotId: 'robot-002', name: 'Bravo', x: 2, y: 0, headingDeg: 90, footprintRadiusM: 0.35 }],
      peersDropped: 1,
    };

    it('proxies the robot’s map, peers and all, with a 5 s budget', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(MAP);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MAP);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/robots/robot-001/map');
      expect(httpClientArgs[0][0]).toBe('http://robot:41243');
      expect(httpClientArgs[0][1]).toBe(5000);
    });

    it('passes the robot’s own 404 through — "map disabled" is the robot’s answer', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(
        new HttpClientError('HTTP 404: {}', 404, undefined, undefined, {
          ok: false,
          error: 'occupancy map is disabled on this agent (AGENT_MAP_ENABLED)',
        })
      );

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('AGENT_MAP_ENABLED');
    });

    it('502s with the agent’s error text when the robot is unreachable — never an empty map', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new HttpClientError('ECONNREFUSED'));

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('AGENT_STATE_UNAVAILABLE');
      expect(res.body.error).toContain('ECONNREFUSED');
    });

    it('502s when the robot answers 200 without a map body', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue({});

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map');

      expect(res.status).toBe(502);
    });

    it('404s an unknown robot with the server’s own code', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp()).get('/api/robots/ghost/agent-mode/map');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/agent-mode/map/cloud (TASK-211)', () => {
    const CLOUD = { ok: true, frame: 'odom', frameId: 'b', voxelM: 0.05, pointCount: 3, returned: 3, encoding: 'f32-xyz-b64', positions: 'AAAA' };

    it('proxies the robot’s cloud with `max` and a 15 s budget', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(CLOUD);
      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map/cloud?max=500');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(CLOUD);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/robots/robot-001/map/cloud', { params: { max: '500' } });
      expect(httpClientArgs[0][1]).toBe(15000);
    });

    it('passes the robot’s own 404 through and 502s when unreachable', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new HttpClientError('HTTP 404: {}', 404, undefined, undefined, { ok: false, error: 'no cloud yet' }));
      let res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map/cloud');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('no cloud yet');
      mockGet.mockRejectedValue(new HttpClientError('ECONNREFUSED'));
      res = await request(createApp()).get('/api/robots/robot-001/agent-mode/map/cloud');
      expect(res.status).toBe(502);
    });
  });

  // -------------------------------------------------------------------------
  // Personal-data proxies (memory digest + identity)
  //
  // These MUST live on the server: the robot's `personalDataGate` strips
  // `Access-Control-Allow-Origin` and 403s any cross-origin browser request, so
  // the app can never reach the agent directly.
  // -------------------------------------------------------------------------
  describe('GET /:id/agent-mode/memory', () => {
    it('proxies the robot’s digest with the shared secret', async () => {
      vi.stubEnv('AGENT_MEMORY_TOKEN', 'fleet-secret');
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(MEMORY_DIGEST);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/memory');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ memoryEntries: 3, place: 'AISLE-3' });
      expect(mockGet).toHaveBeenCalledWith('/api/v1/robots/robot-001/memory');
      // Without the header this is a 401 on any split-host deployment — the
      // whole reason `agentServiceAuthHeaders()` exists.
      expect(httpClientArgs.at(-1)).toEqual([
        'http://robot:41243',
        expect.any(Number),
        { Authorization: 'Bearer fleet-secret' },
      ]);
    });

    it('404s when the robot is not registered on this server', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp()).get('/api/robots/nope/agent-mode/memory');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('forwards the robot’s own NO_MEMORY_WORKSPACE 404 with its code', async () => {
      // "This robot has no memory workspace" is something the ROBOT asserted,
      // not a transport failure — and it is distinguishable from the server's
      // own 404 by its code.
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(
        new HttpClientError('HTTP 404: {}', 404, undefined, undefined, {
          code: 'NO_MEMORY_WORKSPACE',
          message: 'This agent has no memory workspace configured.',
        })
      );

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/memory');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NO_MEMORY_WORKSPACE');
    });

    it('502s — not 404s — when the personal-data gate refuses the server', async () => {
      // THE PROBE for the collapse the previous round fixed on `/agent-mode`:
      // a 401 means AGENT_MEMORY_TOKEN is missing, which is a deployment fault.
      // Answering 404 would tell the app "this robot remembers nothing".
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(
        new HttpClientError('HTTP 401: MEMORY_TOKEN_REQUIRED', 401, undefined, undefined, {
          code: 'MEMORY_TOKEN_REQUIRED',
        })
      );

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/memory');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
    });

    it('502s when the robot is unreachable', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(new HttpClientError('Connection refused: http://robot:41243'));

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/memory');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
    });

    it('502s on a 200 with an empty body rather than serving it', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(undefined);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/memory');

      expect(res.status).toBe(502);
    });
  });

  describe('GET /:id/agent-mode/identity', () => {
    it('proxies the ID card, the self and the report', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue(IDENTITY);

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/identity');

      expect(res.status).toBe(200);
      expect(res.body.identity.name).toBe('Nova');
      expect(res.body.self.bootstrapRequired).toBe(false);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/robots/robot-001/identity');
    });

    it('forwards the robot’s NO_IDENTITY 404', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockRejectedValue(
        new HttpClientError('HTTP 404: {}', 404, undefined, undefined, {
          code: 'NO_IDENTITY',
          problem: 'unreadable',
        })
      );

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/identity');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NO_IDENTITY', problem: 'unreadable' });
    });

    it('502s on an answer that carries no identity', async () => {
      // An empty card must not reach the naming dialog: it would present an
      // unnamed robot as a named one.
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockGet.mockResolvedValue({ self: null });

      const res = await request(createApp()).get('/api/robots/robot-001/agent-mode/identity');

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
    });

    it('404s when the robot is not registered', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp()).get('/api/robots/nope/agent-mode/identity');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
    });
  });

  describe('POST /:id/agent-mode/identity', () => {
    it('forwards ONLY the labels the operator sent', async () => {
      // THE PROBE: filling absent labels in with null looks like harmless
      // normalisation and in fact blanks the Site of every robot renamed
      // through the dialog.
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ ok: true, identity: { name: 'Nova' }, self: IDENTITY.self });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/identity')
        .send({ Name: 'Nova' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockPost).toHaveBeenCalledWith('/api/v1/robots/robot-001/identity', { Name: 'Nova' });
      const sent = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.keys(sent)).toEqual(['Name']);
      expect('Site' in sent).toBe(false);
    });

    it('forwards an explicit null — the one way to clear a label', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ ok: true, identity: {} });

      await request(createApp())
        .post('/api/robots/robot-001/agent-mode/identity')
        .send({ Site: null });

      expect(mockPost).toHaveBeenCalledWith('/api/v1/robots/robot-001/identity', { Site: null });
    });

    it('400s on an empty patch without troubling the robot', async () => {
      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/identity')
        .send({ Serial: 'not-yours' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_IDENTITY');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('forwards the robot’s refusal and its reason', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(
        new HttpClientError('HTTP 400: {}', 400, undefined, undefined, {
          code: 'IDENTITY_REFUSED',
          message: 'Name must not be empty.',
        })
      );

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/identity')
        .send({ Name: ' ' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'IDENTITY_REFUSED', message: 'Name must not be empty.' });
    });

    it('502s on an answer that does not confirm the write', async () => {
      // The dialog closes on `ok`; an unconfirmed write must not look like one.
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockResolvedValue({ identity: { name: 'Nova' } });

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/identity')
        .send({ Name: 'Nova' });

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
    });

    it('502s when the robot is unreachable', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://robot:41243' });
      mockPost.mockRejectedValue(new HttpClientError('ECONNREFUSED'));

      const res = await request(createApp())
        .post('/api/robots/robot-001/agent-mode/identity')
        .send({ Name: 'Nova' });

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(AGENT_STATE_UNAVAILABLE.code);
    });

    it('404s when the robot is not registered', async () => {
      mockRobotManager.getRegisteredRobot.mockResolvedValue(undefined);

      const res = await request(createApp())
        .post('/api/robots/nope/agent-mode/identity')
        .send({ Name: 'Nova' });

      expect(res.status).toBe(404);
      expect(mockPost).not.toHaveBeenCalled();
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

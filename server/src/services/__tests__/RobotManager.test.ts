/**
 * @file RobotManager.test.ts
 * @description Unit tests for RobotManager — robot registry, registration/unregistration,
 *   robot access (cache + DB), command/telemetry forwarding, event subscriptions and
 *   health-check lifecycle.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { A2AAgentCard } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

// HttpClient is `new`-ed inside the service. Shared instance method mocks let us
// assert/control every outbound HTTP call regardless of which constructor was used.
const httpGet = vi.fn();
const httpPost = vi.fn();

vi.mock('../HttpClient.js', () => {
  class HttpClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'HttpClientError';
    }
  }
  return {
    HTTP_TIMEOUTS: { SHORT: 5000, MEDIUM: 10000, LONG: 30000 },
    HttpClientError,
    HttpClient: class {
      get = httpGet;
      post = httpPost;
    },
  };
});

vi.mock('../A2AClient.js', () => ({
  agentCardResolver: {
    fetchAgentCard: vi.fn(),
    clearCache: vi.fn(),
  },
}));

vi.mock('../ConversationManager.js', () => ({
  conversationManager: {
    registerAgent: vi.fn(),
    unregisterAgent: vi.fn(),
  },
}));

vi.mock('../../repositories/index.js', () => ({
  robotRepository: {
    getAllRegisteredRobots: vi.fn(),
    getRegisteredRobot: vi.fn(),
    upsertWithRegistration: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
    updateHealthCheck: vi.fn(),
  },
}));

import { RobotManager } from '../RobotManager.js';
import type {
  Robot,
  RegisteredRobot,
  RobotEndpoints,
  RegistrationInfo,
} from '../RobotManager.js';
import { agentCardResolver as _agentCardResolver } from '../A2AClient.js';
import { conversationManager as _conversationManager } from '../ConversationManager.js';
import { robotRepository as _robotRepository } from '../../repositories/index.js';

// Retype mocked singletons so .mock* methods typecheck (runtime unchanged).
const agentCardResolver = vi.mocked(_agentCardResolver, true);
const conversationManager = vi.mocked(_conversationManager, true);
const robotRepository = vi.mocked(_robotRepository, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'r1',
    name: 'Robot One',
    model: 'so101',
    status: 'online',
    batteryLevel: 90,
    location: { x: 0, y: 0, zone: 'Zone A' },
    lastSeen: new Date().toISOString(),
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgentCard(name = 'Robot One Agent'): A2AAgentCard {
  return { name } as A2AAgentCard;
}

function makeEndpoints(overrides: Partial<RobotEndpoints> = {}): RobotEndpoints {
  return {
    robot: 'http://robot.local/api/v1/robot',
    command: 'http://robot.local/api/v1/command',
    telemetry: 'http://robot.local/api/v1/telemetry',
    telemetryWs: 'ws://robot.local/api/v1/telemetry/ws',
    ...overrides,
  };
}

function makeRegistered(overrides: Partial<RegisteredRobot> = {}): RegisteredRobot {
  return {
    robot: makeRobot(),
    endpoints: makeEndpoints(),
    agentCard: makeAgentCard(),
    baseUrl: 'http://robot.local',
    lastHealthCheck: new Date().toISOString(),
    isConnected: true,
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRegistrationInfo(overrides: Partial<RegistrationInfo> = {}): RegistrationInfo {
  return {
    robot: makeRobot(),
    endpoints: {
      robot: '/api/v1/robot',
      command: '/api/v1/command',
      telemetry: '/api/v1/telemetry',
      telemetryWs: 'ws://robot.local/api/v1/telemetry/ws',
    },
    a2a: { agentCard: '/.well-known/agent.json' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  httpGet.mockReset();
  httpPost.mockReset();
});

// ===========================================================================
// initialize
// ===========================================================================

describe('initialize', () => {
  it('loads registered robots from the repository into the cache', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({ robot: makeRobot({ id: 'cached' }) });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);

    await mgr.initialize();

    // A cache hit means getRegisteredRobot must not consult the repository again.
    const result = await mgr.getRegisteredRobot('cached');
    expect(result).toBe(registered);
    expect(robotRepository.getRegisteredRobot).not.toHaveBeenCalled();
  });

  it('handles an empty database without error', async () => {
    const mgr = new RobotManager();
    robotRepository.getAllRegisteredRobots.mockResolvedValue([]);
    await expect(mgr.initialize()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// registerRobot
// ===========================================================================

describe('registerRobot', () => {
  it('fetches registration info + agent card, persists, caches and emits an event', async () => {
    const mgr = new RobotManager();
    const info = makeRegistrationInfo({ robot: makeRobot({ id: 'r1', name: 'Robot One' }) });
    httpGet.mockResolvedValue(info);
    const card = makeAgentCard();
    agentCardResolver.fetchAgentCard.mockResolvedValue(card);
    robotRepository.upsertWithRegistration.mockResolvedValue(undefined as never);
    conversationManager.registerAgent.mockResolvedValue(undefined);

    const events: { type: string; robotId: string }[] = [];
    mgr.onRobotEvent((e) => events.push(e));

    const result = await mgr.registerRobot('http://robot.local/');

    // trailing slash is normalized away
    expect(result.baseUrl).toBe('http://robot.local');
    expect(result.isConnected).toBe(true);
    expect(result.robot.a2aEnabled).toBe(true);
    expect(result.robot.a2aAgentUrl).toBe('http://robot.local');
    // endpoints are absolute (baseUrl + relative path)
    expect(result.endpoints.command).toBe('http://robot.local/api/v1/command');
    expect(result.endpoints.telemetryWs).toBe('ws://robot.local/api/v1/telemetry/ws');

    expect(httpGet).toHaveBeenCalledWith('/api/v1/register');
    expect(agentCardResolver.fetchAgentCard).toHaveBeenCalledWith('http://robot.local');
    expect(robotRepository.upsertWithRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', a2aEnabled: true }),
      expect.objectContaining({ command: 'http://robot.local/api/v1/command' }),
      card,
      'http://robot.local'
    );
    expect(conversationManager.registerAgent).toHaveBeenCalledWith(card);
    expect(events).toEqual([
      expect.objectContaining({ type: 'robot_registered', robotId: 'r1' }),
    ]);
  });

  it('caches the robot so it is retrievable without hitting the repository', async () => {
    const mgr = new RobotManager();
    httpGet.mockResolvedValue(makeRegistrationInfo({ robot: makeRobot({ id: 'r1' }) }));
    agentCardResolver.fetchAgentCard.mockResolvedValue(makeAgentCard());
    robotRepository.upsertWithRegistration.mockResolvedValue(undefined as never);
    conversationManager.registerAgent.mockResolvedValue(undefined);

    await mgr.registerRobot('http://robot.local');

    const robot = await mgr.getRobot('r1');
    expect(robot?.id).toBe('r1');
    expect(robotRepository.findById).not.toHaveBeenCalled();
  });

  it('throws a wrapped error when registration info is missing required fields', async () => {
    const mgr = new RobotManager();
    httpGet.mockResolvedValue({ robot: undefined, endpoints: undefined } as never);

    await expect(mgr.registerRobot('http://robot.local')).rejects.toThrow(
      'Failed to register robot: Invalid registration info: missing robot or endpoints'
    );
    expect(robotRepository.upsertWithRegistration).not.toHaveBeenCalled();
  });

  it('wraps HTTP errors from the registration fetch', async () => {
    const mgr = new RobotManager();
    httpGet.mockRejectedValue(new Error('connection refused'));

    await expect(mgr.registerRobot('http://robot.local')).rejects.toThrow(
      'Failed to register robot: connection refused'
    );
  });
});

// ===========================================================================
// unregisterRobot
// ===========================================================================

describe('unregisterRobot', () => {
  it('returns false when the robot is neither cached nor in the database', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(null);

    await expect(mgr.unregisterRobot('missing')).resolves.toBe(false);
    expect(robotRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes a DB-only robot (not cached) without touching A2A cleanup', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    robotRepository.delete.mockResolvedValue(true);

    const events: { type: string }[] = [];
    mgr.onRobotEvent((e) => events.push(e));

    const result = await mgr.unregisterRobot('r1');

    expect(result).toBe(true);
    expect(robotRepository.delete).toHaveBeenCalledWith('r1');
    // not cached => no agent/conversation cleanup
    expect(conversationManager.unregisterAgent).not.toHaveBeenCalled();
    expect(agentCardResolver.clearCache).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ type: 'robot_unregistered' })]);
  });

  it('removes a cached robot, cleans up A2A state and emits an event', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({
      robot: makeRobot({ id: 'r1' }),
      agentCard: makeAgentCard('My Agent'),
      baseUrl: 'http://robot.local',
    });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    robotRepository.delete.mockResolvedValue(true);
    conversationManager.unregisterAgent.mockResolvedValue(true);

    const result = await mgr.unregisterRobot('r1');

    expect(result).toBe(true);
    // when cached, the DB lookup short-circuit is skipped
    expect(robotRepository.getRegisteredRobot).not.toHaveBeenCalled();
    expect(robotRepository.delete).toHaveBeenCalledWith('r1');
    expect(conversationManager.unregisterAgent).toHaveBeenCalledWith('My Agent');
    expect(agentCardResolver.clearCache).toHaveBeenCalledWith('http://robot.local');

    // cache really removed: subsequent lookup falls through to the repository
    robotRepository.findById.mockResolvedValue(null);
    await mgr.getRobot('r1');
    expect(robotRepository.findById).toHaveBeenCalledWith('r1');
  });
});

// ===========================================================================
// listRobots / getRobot
// ===========================================================================

describe('listRobots', () => {
  it('presents unregistered online robots as offline, manual states untouched', async () => {
    const mgr = new RobotManager();
    // Neither robot is in the registered cache — a stored 'online' is stale
    // (nothing can be health-checking it) and is presented as 'offline';
    // manual states like 'maintenance' pass through untouched. No DB write.
    const robots = [
      makeRobot({ id: 'a', status: 'online' }),
      makeRobot({ id: 'b', status: 'maintenance' }),
    ];
    robotRepository.findAll.mockResolvedValue(robots);
    const result = await mgr.listRobots();
    expect(result.map((r) => ({ id: r.id, status: r.status }))).toEqual([
      { id: 'a', status: 'offline' },
      { id: 'b', status: 'maintenance' },
    ]);
    expect(robots[0].status).toBe('online'); // source object not mutated
  });

  it('keeps a registered, connected robot online', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({ robot: makeRobot({ id: 'r1', status: 'online' }) });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();
    robotRepository.findAll.mockResolvedValue([makeRobot({ id: 'r1', status: 'online' })]);
    const result = await mgr.listRobots();
    expect(result[0].status).toBe('online');
  });
});

describe('getRobot', () => {
  it('returns the cached robot without consulting the repository', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({ robot: makeRobot({ id: 'r1' }) });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    const result = await mgr.getRobot('r1');
    expect(result).toBe(registered.robot);
    expect(robotRepository.findById).not.toHaveBeenCalled();
  });

  it('falls back to the repository on a cache miss, normalizing stale online to offline', async () => {
    const mgr = new RobotManager();
    const robot = makeRobot({ id: 'r2', status: 'online' });
    robotRepository.findById.mockResolvedValue(robot);
    // Not registered → the stored 'online' is stale and presented as offline.
    await expect(mgr.getRobot('r2')).resolves.toMatchObject({ id: 'r2', status: 'offline' });
    expect(robotRepository.findById).toHaveBeenCalledWith('r2');
  });

  it('returns undefined (not null) when the repository has no match', async () => {
    const mgr = new RobotManager();
    robotRepository.findById.mockResolvedValue(null);
    await expect(mgr.getRobot('nope')).resolves.toBeUndefined();
  });
});

// ===========================================================================
// getRegisteredRobot
// ===========================================================================

describe('getRegisteredRobot', () => {
  it('returns from the cache when present', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({ robot: makeRobot({ id: 'r1' }) });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    await expect(mgr.getRegisteredRobot('r1')).resolves.toBe(registered);
    expect(robotRepository.getRegisteredRobot).not.toHaveBeenCalled();
  });

  it('loads from the repository on a miss and populates the cache', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({ robot: makeRobot({ id: 'r3' }) });
    robotRepository.getRegisteredRobot.mockResolvedValue(registered);

    await expect(mgr.getRegisteredRobot('r3')).resolves.toBe(registered);
    expect(robotRepository.getRegisteredRobot).toHaveBeenCalledWith('r3');

    // second call is served from cache
    robotRepository.getRegisteredRobot.mockClear();
    await mgr.getRegisteredRobot('r3');
    expect(robotRepository.getRegisteredRobot).not.toHaveBeenCalled();
  });

  it('returns undefined when neither cache nor repository has the robot', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(null);
    await expect(mgr.getRegisteredRobot('ghost')).resolves.toBeUndefined();
  });
});

// ===========================================================================
// getConnectedAgents
// ===========================================================================

describe('getConnectedAgents', () => {
  it('returns agent cards only for connected robots', async () => {
    const mgr = new RobotManager();
    const connected = makeRegistered({
      robot: makeRobot({ id: 'on' }),
      agentCard: makeAgentCard('Online Agent'),
      isConnected: true,
    });
    const disconnected = makeRegistered({
      robot: makeRobot({ id: 'off' }),
      agentCard: makeAgentCard('Offline Agent'),
      isConnected: false,
    });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([connected, disconnected]);
    await mgr.initialize();

    const cards = mgr.getConnectedAgents();
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Online Agent');
  });

  it('returns an empty array when nothing is cached', () => {
    const mgr = new RobotManager();
    expect(mgr.getConnectedAgents()).toEqual([]);
  });
});

// ===========================================================================
// sendCommand
// ===========================================================================

describe('sendCommand', () => {
  it('throws when the robot is not found', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(null);
    await expect(mgr.sendCommand('rX', { type: 'stop' })).rejects.toThrow('Robot rX not found');
  });

  it('throws when the robot is not connected', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(
      makeRegistered({ isConnected: false })
    );
    await expect(mgr.sendCommand('r1', { type: 'stop' })).rejects.toThrow(
      'Robot r1 is not connected'
    );
  });

  it('posts the command to the robot command endpoint and returns the result', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    const command = { type: 'move' as const, payload: { zone: 'Zone B' } };
    const response = { id: 'cmd1', robotId: 'r1', status: 'pending' };
    httpPost.mockResolvedValue(response);

    const result = await mgr.sendCommand('r1', command);

    expect(result).toBe(response);
    expect(httpPost).toHaveBeenCalledWith('http://robot.local/api/v1/command', command);
  });

  it('wraps outbound HTTP errors with a descriptive message', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    httpPost.mockRejectedValue(new Error('boom'));
    await expect(mgr.sendCommand('r1', { type: 'stop' })).rejects.toThrow(
      'Failed to send command: boom'
    );
  });
});

// ===========================================================================
// getTelemetry
// ===========================================================================

describe('getTelemetry', () => {
  it('throws when the robot is not found', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(null);
    await expect(mgr.getTelemetry('rX')).rejects.toThrow('Robot rX not found');
  });

  it('fetches telemetry from the robot telemetry endpoint', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    const telemetry = { robotId: 'r1', batteryLevel: 80, cpuUsage: 12 };
    httpGet.mockResolvedValue(telemetry);

    const result = await mgr.getTelemetry('r1');

    expect(result).toBe(telemetry);
    expect(httpGet).toHaveBeenCalledWith('http://robot.local/api/v1/telemetry');
  });

  it('wraps outbound HTTP errors', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    httpGet.mockRejectedValue(new Error('timeout'));
    await expect(mgr.getTelemetry('r1')).rejects.toThrow('Failed to get telemetry: timeout');
  });
});

// ===========================================================================
// Event subscriptions
// ===========================================================================

describe('onRobotEvent', () => {
  it('unsubscribes so the callback stops receiving events', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    robotRepository.delete.mockResolvedValue(true);

    const cb = vi.fn();
    const unsub = mgr.onRobotEvent(cb);

    await mgr.unregisterRobot('r1');
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    await mgr.unregisterRobot('r1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber from the others', async () => {
    const mgr = new RobotManager();
    robotRepository.getRegisteredRobot.mockResolvedValue(makeRegistered());
    robotRepository.delete.mockResolvedValue(true);

    const bad = vi.fn(() => {
      throw new Error('callback boom');
    });
    const good = vi.fn();
    mgr.onRobotEvent(bad);
    mgr.onRobotEvent(good);

    await expect(mgr.unregisterRobot('r1')).resolves.toBe(true);
    expect(good).toHaveBeenCalled();
  });
});

// ===========================================================================
// Health-check lifecycle
// ===========================================================================

describe('health-check lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('startHealthChecks runs an immediate check and schedules an interval; stop clears it', async () => {
    const mgr = new RobotManager();
    const setSpy = vi.spyOn(global, 'setInterval');
    const clearSpy = vi.spyOn(global, 'clearInterval');

    // empty cache => performHealthChecks does no HTTP work but still runs
    mgr.startHealthChecks(1000);
    expect(setSpy).toHaveBeenCalledTimes(1);

    mgr.stopHealthChecks();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('stopHealthChecks is a no-op when no interval is running', () => {
    const mgr = new RobotManager();
    expect(() => mgr.stopHealthChecks()).not.toThrow();
  });

  it('updates battery/status and persists when a cached robot reports new health', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({
      robot: makeRobot({ id: 'r1', status: 'online', batteryLevel: 90 }),
    });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    // first GET = /api/v1/health, second GET = robot data endpoint
    httpGet
      .mockResolvedValueOnce({ status: 'ok', robotStatus: 'busy', batteryLevel: 55 })
      .mockResolvedValueOnce(makeRobot({ id: 'r1', location: { x: 5, y: 6, zone: 'Zone Z' } }));
    robotRepository.updateHealthCheck.mockResolvedValue(undefined as never);

    const events: { type: string }[] = [];
    mgr.onRobotEvent((e) => events.push(e));

    mgr.startHealthChecks(1000);
    // allow the immediate performHealthChecks() promise chain to settle
    await vi.advanceTimersByTimeAsync(0);
    mgr.stopHealthChecks();

    expect(robotRepository.updateHealthCheck).toHaveBeenCalledWith(
      'r1',
      true,
      'busy',
      55,
      expect.objectContaining({ x: 5, y: 6, zone: 'Zone Z' })
    );
    expect(events.some((e) => e.type === 'robot_status_changed')).toBe(true);
  });

  it('marks a previously-connected robot offline when its health check fails', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered({
      robot: makeRobot({ id: 'r1', status: 'online' }),
      isConnected: true,
    });
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    httpGet.mockRejectedValue(new Error('unreachable'));
    robotRepository.updateHealthCheck.mockResolvedValue(undefined as never);

    const events: { type: string }[] = [];
    mgr.onRobotEvent((e) => events.push(e));

    mgr.startHealthChecks(1000);
    await vi.advanceTimersByTimeAsync(0);
    mgr.stopHealthChecks();

    expect(robotRepository.updateHealthCheck).toHaveBeenCalledWith('r1', false, 'offline');
    expect(events.some((e) => e.type === 'robot_status_changed')).toBe(true);
  });
});

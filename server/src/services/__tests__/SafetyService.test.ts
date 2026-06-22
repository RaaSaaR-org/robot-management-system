/**
 * @file SafetyService.test.ts
 * @description Unit tests for SafetyService — robot/zone/fleet E-stop, safety status, event log
 * @feature safety
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Robot, RegisteredRobot } from '../RobotManager.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

// Shared HttpClient instance method mocks (HttpClient is `new`-ed inside the service)
const httpPost = vi.fn();
const httpGet = vi.fn();

vi.mock('../HttpClient.js', () => ({
  HTTP_TIMEOUTS: { SHORT: 5000 },
  HttpClient: class {
    post = httpPost;
    get = httpGet;
  },
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    getRegisteredRobot: vi.fn(),
    listRobots: vi.fn(),
  },
}));

vi.mock('../ZoneService.js', () => ({
  zoneService: {
    getZone: vi.fn(),
  },
}));

vi.mock('../AlertService.js', () => ({
  alertService: {
    createAlert: vi.fn(),
  },
}));

import { safetyService } from '../SafetyService.js';
import { robotManager } from '../RobotManager.js';
import { zoneService } from '../ZoneService.js';
import { alertService } from '../AlertService.js';

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
    location: { zone: 'Zone A' } as Robot['location'],
    lastSeen: new Date().toISOString(),
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRegistered(overrides: Partial<RegisteredRobot> = {}): RegisteredRobot {
  return {
    robot: makeRobot(),
    baseUrl: 'http://robot.local',
    isConnected: true,
    lastHealthCheck: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    endpoints: {} as RegisteredRobot['endpoints'],
    agentCard: {} as RegisteredRobot['agentCard'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  httpPost.mockReset();
  httpGet.mockReset();
  vi.mocked(alertService.createAlert).mockResolvedValue({} as never);
});

// ===========================================================================
// triggerRobotEStop
// ===========================================================================

describe('triggerRobotEStop', () => {
  it('throws when robot is not registered', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(undefined as never);
    await expect(safetyService.triggerRobotEStop('rX', 'test')).rejects.toThrow(
      'Robot rX not found'
    );
  });

  it('throws when robot is not connected', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(
      makeRegistered({ isConnected: false })
    );
    await expect(safetyService.triggerRobotEStop('r1', 'test')).rejects.toThrow(
      'Robot r1 is not connected'
    );
  });

  it('posts to the robot estop endpoint and returns the status', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    const status = { robotId: 'r1', status: 'triggered' };
    httpPost.mockResolvedValue(status);

    const result = await safetyService.triggerRobotEStop('r1', 'overheating', 'operator');

    expect(result).toBe(status);
    expect(httpPost).toHaveBeenCalledWith('/api/v1/robots/r1/safety/estop', {
      reason: 'overheating',
      triggeredBy: 'operator',
    });
  });

  it('defaults triggeredBy to "server"', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue({});

    await safetyService.triggerRobotEStop('r1', 'reason');

    expect(httpPost).toHaveBeenCalledWith(
      '/api/v1/robots/r1/safety/estop',
      expect.objectContaining({ triggeredBy: 'server' })
    );
  });

  it('wraps HTTP errors with a descriptive message', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockRejectedValue(new Error('connection refused'));

    await expect(safetyService.triggerRobotEStop('r1', 'reason')).rejects.toThrow(
      'Failed to trigger E-stop: connection refused'
    );
  });

  it('does not fail the estop if alert creation rejects', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue({ ok: true });
    vi.mocked(alertService.createAlert).mockRejectedValue(new Error('alert down') as never);

    await expect(
      safetyService.triggerRobotEStop('r1', 'reason')
    ).resolves.toEqual({ ok: true });
  });
});

// ===========================================================================
// resetRobotEStop
// ===========================================================================

describe('resetRobotEStop', () => {
  it('throws when robot not found', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(undefined as never);
    await expect(safetyService.resetRobotEStop('rZ')).rejects.toThrow('Robot rZ not found');
  });

  it('posts to the reset endpoint and creates an info alert', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue({ status: 'armed' });

    const result = await safetyService.resetRobotEStop('r1');

    expect(result).toEqual({ status: 'armed' });
    expect(httpPost).toHaveBeenCalledWith('/api/v1/robots/r1/safety/estop/reset', {});
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info', source: 'robot', sourceId: 'r1' })
    );
  });

  it('wraps HTTP errors', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockRejectedValue(new Error('boom'));
    await expect(safetyService.resetRobotEStop('r1')).rejects.toThrow(
      'Failed to reset E-stop: boom'
    );
  });
});

// ===========================================================================
// getRobotSafetyStatus
// ===========================================================================

describe('getRobotSafetyStatus', () => {
  it('returns the status from the robot', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    const status = { robotId: 'r1', status: 'armed', currentSpeed: 1.2 };
    httpGet.mockResolvedValue(status);

    const result = await safetyService.getRobotSafetyStatus('r1');
    expect(result).toBe(status);
    expect(httpGet).toHaveBeenCalledWith('/api/v1/robots/r1/safety');
  });

  it('throws when not connected', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(
      makeRegistered({ isConnected: false })
    );
    await expect(safetyService.getRobotSafetyStatus('r1')).rejects.toThrow(
      'Robot r1 is not connected'
    );
  });

  it('wraps HTTP errors', async () => {
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpGet.mockRejectedValue(new Error('timeout'));
    await expect(safetyService.getRobotSafetyStatus('r1')).rejects.toThrow(
      'Failed to get safety status: timeout'
    );
  });
});

// ===========================================================================
// triggerFleetEStop
// ===========================================================================

describe('triggerFleetEStop', () => {
  it('skips offline robots and aggregates success/failure counts', async () => {
    const robots = [
      makeRobot({ id: 'a', name: 'A', status: 'online' }),
      makeRobot({ id: 'b', name: 'B', status: 'online' }),
      makeRobot({ id: 'c', name: 'C', status: 'offline' }),
    ];
    vi.mocked(robotManager.listRobots).mockResolvedValue(robots);

    // a succeeds, b fails
    vi.mocked(robotManager.getRegisteredRobot).mockImplementation(async (id: string) => {
      if (id === 'a') return makeRegistered({ robot: robots[0] });
      return makeRegistered({ robot: robots[1] });
    });
    httpPost.mockImplementation(async (url: string) => {
      if (url.includes('/robots/a/')) return { ok: true };
      throw new Error('b is down');
    });

    const result = await safetyService.triggerFleetEStop('emergency', 'admin');

    expect(result.scope).toBe('fleet');
    expect(result.triggeredBy).toBe('admin');
    expect(result.robotResults).toHaveLength(2); // offline robot excluded
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);

    const failed = result.robotResults.find((r) => r.robotId === 'b');
    expect(failed?.success).toBe(false);
    expect(failed?.error).toContain('b is down');
  });

  it('logs the event so it appears in the estop log', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'log1', status: 'online' }),
    ]);
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue({ ok: true });

    await safetyService.triggerFleetEStop('logged reason', 'tester');

    const log = safetyService.getEStopLog();
    const entry = log.find((e) => e.reason === 'logged reason' && e.scope === 'fleet');
    expect(entry).toBeDefined();
    expect(entry?.affectedRobots).toContain('log1');
  });

  it('handles empty fleet with zero counts', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([]);
    const result = await safetyService.triggerFleetEStop('nobody');
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.robotResults).toHaveLength(0);
  });
});

// ===========================================================================
// resetFleetEStop
// ===========================================================================

describe('resetFleetEStop', () => {
  it('resets connected robots and reports success', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'a', status: 'online' }),
      makeRobot({ id: 'b', status: 'offline' }),
    ]);
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue({ status: 'armed' });

    const result = await safetyService.resetFleetEStop();
    expect(result.scope).toBe('fleet');
    expect(result.robotResults).toHaveLength(1);
    expect(result.successCount).toBe(1);
    expect(result.triggeredBy).toBe('server');
  });
});

// ===========================================================================
// triggerZoneEStop
// ===========================================================================

describe('triggerZoneEStop', () => {
  it('throws when the zone does not exist', async () => {
    vi.mocked(zoneService.getZone).mockResolvedValue(null as never);
    await expect(safetyService.triggerZoneEStop('z1', 'reason')).rejects.toThrow(
      'Zone z1 not found'
    );
  });

  it('returns empty result when no robots are in the zone', async () => {
    vi.mocked(zoneService.getZone).mockResolvedValue({ id: 'z1', name: 'Zone A' } as never);
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'a', status: 'online', location: { zone: 'Zone B' } as Robot['location'] }),
    ]);

    const result = await safetyService.triggerZoneEStop('z1', 'reason');
    expect(result.scope).toBe('zone');
    expect(result.zoneId).toBe('z1');
    expect(result.zoneName).toBe('Zone A');
    expect(result.robotResults).toHaveLength(0);
    expect(result.successCount).toBe(0);
  });

  it('only triggers robots matching the zone name and excludes offline', async () => {
    vi.mocked(zoneService.getZone).mockResolvedValue({ id: 'z1', name: 'Zone A' } as never);
    const robots = [
      makeRobot({ id: 'in', status: 'online', location: { zone: 'Zone A' } as Robot['location'] }),
      makeRobot({ id: 'out', status: 'online', location: { zone: 'Zone B' } as Robot['location'] }),
      makeRobot({ id: 'off', status: 'offline', location: { zone: 'Zone A' } as Robot['location'] }),
    ];
    vi.mocked(robotManager.listRobots).mockResolvedValue(robots);
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue({ ok: true });

    const result = await safetyService.triggerZoneEStop('z1', 'spill', 'guard');

    expect(result.robotResults).toHaveLength(1);
    expect(result.robotResults[0].robotId).toBe('in');
    expect(result.successCount).toBe(1);
    // triggeredBy on the per-robot call is forced to 'zone' with prefixed reason
    expect(httpPost).toHaveBeenCalledWith(
      '/api/v1/robots/in/safety/estop',
      expect.objectContaining({
        triggeredBy: 'zone',
        reason: 'Zone E-stop (Zone A): spill',
      })
    );
    // top-level result still carries the original triggeredBy
    expect(result.triggeredBy).toBe('guard');
  });
});

// ===========================================================================
// getFleetSafetyStatus
// ===========================================================================

describe('getFleetSafetyStatus', () => {
  it('counts triggered robots and reports anyTriggered', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'a', name: 'A', status: 'online' }),
      makeRobot({ id: 'b', name: 'B', status: 'online' }),
    ]);
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpGet.mockImplementation(async (url: string) => {
      if (url.includes('/robots/a/')) return { status: 'triggered' };
      return { status: 'armed' };
    });

    const result = await safetyService.getFleetSafetyStatus();
    expect(result.anyTriggered).toBe(true);
    expect(result.triggeredCount).toBe(1);
    expect(result.robots).toHaveLength(2);
  });

  it('falls back to an unknown-status entry when fetching fails', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'a', name: 'A', status: 'online' }),
    ]);
    vi.mocked(robotManager.getRegisteredRobot).mockResolvedValue(makeRegistered());
    httpGet.mockRejectedValue(new Error('unreachable'));

    const result = await safetyService.getFleetSafetyStatus();
    expect(result.triggeredCount).toBe(0);
    expect(result.anyTriggered).toBe(false);
    expect(result.robots[0].status).toBe('unknown');
    expect(result.robots[0].warnings).toContain('Unable to fetch safety status');
  });
});

// ===========================================================================
// Event log + subscriptions
// ===========================================================================

describe('event log and subscriptions', () => {
  it('respects the limit argument of getEStopLog', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([]);
    await safetyService.triggerFleetEStop('a');
    await safetyService.triggerFleetEStop('b');

    const limited = safetyService.getEStopLog(1);
    expect(limited).toHaveLength(1);
    // most recent first (unshift)
    expect(limited[0].reason).toBe('b');
  });

  it('notifies subscribers on new events and unsubscribes', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([]);
    const cb = vi.fn();
    const unsubscribe = safetyService.onEStopEvent(cb);

    await safetyService.triggerFleetEStop('sub test');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].reason).toBe('sub test');

    unsubscribe();
    await safetyService.triggerFleetEStop('after unsub');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing callback from other subscribers', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([]);
    const bad = vi.fn(() => {
      throw new Error('callback boom');
    });
    const good = vi.fn();
    const u1 = safetyService.onEStopEvent(bad);
    const u2 = safetyService.onEStopEvent(good);

    await expect(safetyService.triggerFleetEStop('isolation')).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();

    u1();
    u2();
  });
});

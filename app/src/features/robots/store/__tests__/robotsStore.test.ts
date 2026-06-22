/**
 * @file robotsStore.test.ts
 * @description Tests for the robots Zustand store
 * @feature robots
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useRobotsStore,
  selectRobots,
  selectSelectedRobotId,
  selectRobotDetail,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectTelemetryCache,
  selectRobotById,
  selectRobotsByStatus,
  selectRobotsNeedingAttention,
  selectRobotTelemetry,
  selectSelectedRobot,
} from '../robotsStore';
import type { Robot, RobotTelemetry } from '../../types/robots.types';

vi.mock('../../api/robotsApi', () => ({
  robotsApi: {
    listRobots: vi.fn(),
    getRobot: vi.fn(),
    registerRobot: vi.fn(),
    unregisterRobot: vi.fn(),
    sendCommand: vi.fn(),
  },
}));

import { robotsApi } from '../../api/robotsApi';

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'robot-1',
    name: 'Robot One',
    model: 'SO-101',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0 },
    lastSeen: '2026-01-01T00:00:00.000Z',
    capabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTelemetry(robotId: string): RobotTelemetry {
  return {
    robotId,
    batteryLevel: 50,
    cpuUsage: 10,
    memoryUsage: 20,
    temperature: 30,
    sensors: {},
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

const INITIAL = {
  robots: [],
  selectedRobotId: null,
  filters: {},
  pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
  isLoading: false,
  error: null,
  robotDetail: null,
  telemetryCache: {},
};

describe('robotsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRobotsStore.setState({ ...INITIAL });
  });

  it('starts with initial state', () => {
    const s = useRobotsStore.getState();
    expect(s.robots).toEqual([]);
    expect(s.selectedRobotId).toBeNull();
    expect(s.filters).toEqual({});
    expect(s.pagination).toEqual({ page: 1, pageSize: 12, total: 0, totalPages: 0 });
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.robotDetail).toBeNull();
    expect(s.telemetryCache).toEqual({});
  });

  // --------------------------------------------------------------------------
  // fetchRobots
  // --------------------------------------------------------------------------
  describe('fetchRobots', () => {
    it('populates robots and pagination on success', async () => {
      const robots = [makeRobot({ id: 'a' }), makeRobot({ id: 'b' })];
      const pagination = { page: 1, pageSize: 12, total: 2, totalPages: 1 };
      (robotsApi.listRobots as any).mockResolvedValue({ robots, pagination });

      useRobotsStore.setState({ filters: { status: 'online' }, pagination: { page: 2, pageSize: 12, total: 0, totalPages: 0 } });
      await useRobotsStore.getState().fetchRobots();

      const s = useRobotsStore.getState();
      expect(robotsApi.listRobots).toHaveBeenCalledWith({ status: 'online', page: 2, pageSize: 12 });
      expect(s.robots).toEqual(robots);
      expect(s.pagination).toEqual(pagination);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('sets error message and clears loading on failure', async () => {
      (robotsApi.listRobots as any).mockRejectedValue({ code: 'NETWORK_ERROR' });

      await useRobotsStore.getState().fetchRobots();

      const s = useRobotsStore.getState();
      expect(s.isLoading).toBe(false);
      expect(s.error).toBe('Unable to connect to the server');
      expect(s.robots).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // fetchRobot
  // --------------------------------------------------------------------------
  describe('fetchRobot', () => {
    it('sets robotDetail and updates matching list entry on success', async () => {
      const existing = makeRobot({ id: 'a', name: 'Old' });
      useRobotsStore.setState({ robots: [existing] });
      const updated = makeRobot({ id: 'a', name: 'New' });
      (robotsApi.getRobot as any).mockResolvedValue(updated);

      await useRobotsStore.getState().fetchRobot('a');

      const s = useRobotsStore.getState();
      expect(s.robotDetail).toEqual(updated);
      expect(s.robots[0].name).toBe('New');
      expect(s.isLoading).toBe(false);
    });

    it('does not touch list when robot not present', async () => {
      const updated = makeRobot({ id: 'z' });
      (robotsApi.getRobot as any).mockResolvedValue(updated);

      await useRobotsStore.getState().fetchRobot('z');

      expect(useRobotsStore.getState().robots).toEqual([]);
      expect(useRobotsStore.getState().robotDetail).toEqual(updated);
    });

    it('sets error on failure (unknown error fallback)', async () => {
      (robotsApi.getRobot as any).mockRejectedValue({});

      await useRobotsStore.getState().fetchRobot('a');

      const s = useRobotsStore.getState();
      expect(s.error).toBe('An unexpected error occurred');
      expect(s.isLoading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // registerRobot
  // --------------------------------------------------------------------------
  describe('registerRobot', () => {
    it('adds a new robot and increments total', async () => {
      const robot = makeRobot({ id: 'new' });
      (robotsApi.registerRobot as any).mockResolvedValue({ robot });

      const returned = await useRobotsStore.getState().registerRobot('http://x');

      const s = useRobotsStore.getState();
      expect(returned).toEqual(robot);
      expect(s.robots).toHaveLength(1);
      expect(s.pagination.total).toBe(1);
      expect(s.isLoading).toBe(false);
    });

    it('replaces existing robot without changing total', async () => {
      const existing = makeRobot({ id: 'dup', name: 'Old' });
      useRobotsStore.setState({ robots: [existing], pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 } });
      const robot = makeRobot({ id: 'dup', name: 'New' });
      (robotsApi.registerRobot as any).mockResolvedValue({ robot });

      await useRobotsStore.getState().registerRobot('http://x');

      const s = useRobotsStore.getState();
      expect(s.robots).toHaveLength(1);
      expect(s.robots[0].name).toBe('New');
      expect(s.pagination.total).toBe(1);
    });

    it('throws translated error and sets error state on failure', async () => {
      (robotsApi.registerRobot as any).mockRejectedValue({ code: 'ROBOT_OFFLINE' });

      await expect(useRobotsStore.getState().registerRobot('http://x')).rejects.toThrow(
        'Robot is currently offline'
      );
      const s = useRobotsStore.getState();
      expect(s.error).toBe('Robot is currently offline');
      expect(s.isLoading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // unregisterRobot
  // --------------------------------------------------------------------------
  describe('unregisterRobot', () => {
    it('removes robot, clears detail/selection/telemetry and decrements total', async () => {
      const robot = makeRobot({ id: 'gone' });
      useRobotsStore.setState({
        robots: [robot, makeRobot({ id: 'keep' })],
        robotDetail: robot,
        selectedRobotId: 'gone',
        telemetryCache: { gone: makeTelemetry('gone') },
        pagination: { page: 1, pageSize: 12, total: 2, totalPages: 1 },
      });
      (robotsApi.unregisterRobot as any).mockResolvedValue(undefined);

      await useRobotsStore.getState().unregisterRobot('gone');

      const s = useRobotsStore.getState();
      expect(s.robots.map((r) => r.id)).toEqual(['keep']);
      expect(s.robotDetail).toBeNull();
      expect(s.selectedRobotId).toBeNull();
      expect(s.telemetryCache.gone).toBeUndefined();
      expect(s.pagination.total).toBe(1);
    });

    it('does not go negative on total', async () => {
      useRobotsStore.setState({ robots: [makeRobot({ id: 'x' })], pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 } });
      (robotsApi.unregisterRobot as any).mockResolvedValue(undefined);

      await useRobotsStore.getState().unregisterRobot('x');

      expect(useRobotsStore.getState().pagination.total).toBe(0);
    });

    it('throws and sets error on failure', async () => {
      (robotsApi.unregisterRobot as any).mockRejectedValue({ message: 'boom' });

      await expect(useRobotsStore.getState().unregisterRobot('x')).rejects.toThrow('boom');
      expect(useRobotsStore.getState().error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // selectRobot
  // --------------------------------------------------------------------------
  describe('selectRobot', () => {
    it('sets the selected id', () => {
      useRobotsStore.getState().selectRobot('r1');
      expect(useRobotsStore.getState().selectedRobotId).toBe('r1');
    });

    it('clears detail when deselecting with null', () => {
      useRobotsStore.setState({ selectedRobotId: 'r1', robotDetail: makeRobot({ id: 'r1' }) });
      useRobotsStore.getState().selectRobot(null);
      const s = useRobotsStore.getState();
      expect(s.selectedRobotId).toBeNull();
      expect(s.robotDetail).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // setFilters / clearFilters / setPage (auto-fetch)
  // --------------------------------------------------------------------------
  describe('filter and page setters trigger fetch', () => {
    beforeEach(() => {
      (robotsApi.listRobots as any).mockResolvedValue({
        robots: [],
        pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
      });
    });

    it('setFilters merges filters, resets page to 1 and fetches', () => {
      useRobotsStore.setState({ filters: { zone: 'A' }, pagination: { page: 3, pageSize: 12, total: 0, totalPages: 0 } });

      useRobotsStore.getState().setFilters({ status: 'online' });

      const s = useRobotsStore.getState();
      expect(s.filters).toEqual({ zone: 'A', status: 'online' });
      expect(s.pagination.page).toBe(1);
      expect(robotsApi.listRobots).toHaveBeenCalledTimes(1);
    });

    it('clearFilters empties filters, resets page and fetches', () => {
      useRobotsStore.setState({ filters: { zone: 'A' }, pagination: { page: 5, pageSize: 12, total: 0, totalPages: 0 } });

      useRobotsStore.getState().clearFilters();

      const s = useRobotsStore.getState();
      expect(s.filters).toEqual({});
      expect(s.pagination.page).toBe(1);
      expect(robotsApi.listRobots).toHaveBeenCalledTimes(1);
    });

    it('setPage updates page and fetches', () => {
      useRobotsStore.getState().setPage(4);

      expect(useRobotsStore.getState().pagination.page).toBe(4);
      expect(robotsApi.listRobots).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // sendCommand
  // --------------------------------------------------------------------------
  describe('sendCommand', () => {
    it('returns command result on success', async () => {
      const result = { id: 'cmd-1' } as any;
      (robotsApi.sendCommand as any).mockResolvedValue(result);

      const returned = await useRobotsStore.getState().sendCommand('r1', { type: 'move' });

      expect(returned).toEqual(result);
      expect(robotsApi.sendCommand).toHaveBeenCalledWith('r1', { type: 'move' });
      expect(useRobotsStore.getState().error).toBeNull();
    });

    it('throws translated error and sets error on failure', async () => {
      (robotsApi.sendCommand as any).mockRejectedValue({ code: 'COMMAND_FAILED' });

      await expect(useRobotsStore.getState().sendCommand('r1', { type: 'move' })).rejects.toThrow(
        'Command failed to execute'
      );
      expect(useRobotsStore.getState().error).toBe('Command failed to execute');
    });
  });

  // --------------------------------------------------------------------------
  // updateRobotStatus
  // --------------------------------------------------------------------------
  describe('updateRobotStatus', () => {
    it('updates status in list and detail when ids match', () => {
      const robot = makeRobot({ id: 'r1', status: 'online' });
      useRobotsStore.setState({ robots: [robot], robotDetail: makeRobot({ id: 'r1', status: 'online' }) });

      useRobotsStore.getState().updateRobotStatus('r1', 'error');

      const s = useRobotsStore.getState();
      expect(s.robots[0].status).toBe('error');
      expect(s.robotDetail?.status).toBe('error');
    });

    it('no-op when robot not found', () => {
      useRobotsStore.setState({ robots: [makeRobot({ id: 'r1' })] });
      useRobotsStore.getState().updateRobotStatus('missing', 'error');
      expect(useRobotsStore.getState().robots[0].status).toBe('online');
    });
  });

  // --------------------------------------------------------------------------
  // updateRobot
  // --------------------------------------------------------------------------
  describe('updateRobot', () => {
    it('merges partial updates into list and detail', () => {
      useRobotsStore.setState({
        robots: [makeRobot({ id: 'r1', name: 'Old', batteryLevel: 90 })],
        robotDetail: makeRobot({ id: 'r1', name: 'Old', batteryLevel: 90 }),
      });

      useRobotsStore.getState().updateRobot({ id: 'r1', name: 'New' });

      const s = useRobotsStore.getState();
      expect(s.robots[0].name).toBe('New');
      expect(s.robots[0].batteryLevel).toBe(90);
      expect(s.robotDetail?.name).toBe('New');
    });
  });

  // --------------------------------------------------------------------------
  // updateTelemetry
  // --------------------------------------------------------------------------
  describe('updateTelemetry', () => {
    it('caches telemetry by robot id', () => {
      const t = makeTelemetry('r1');
      useRobotsStore.getState().updateTelemetry('r1', t);
      expect(useRobotsStore.getState().telemetryCache.r1).toEqual(t);
    });
  });

  // --------------------------------------------------------------------------
  // addRobot / removeRobot (WebSocket)
  // --------------------------------------------------------------------------
  describe('addRobot', () => {
    it('appends new robot and increments total', () => {
      useRobotsStore.getState().addRobot(makeRobot({ id: 'r1' }));
      const s = useRobotsStore.getState();
      expect(s.robots).toHaveLength(1);
      expect(s.pagination.total).toBe(1);
    });

    it('replaces existing without changing total', () => {
      useRobotsStore.setState({ robots: [makeRobot({ id: 'r1', name: 'Old' })], pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 } });
      useRobotsStore.getState().addRobot(makeRobot({ id: 'r1', name: 'New' }));
      const s = useRobotsStore.getState();
      expect(s.robots).toHaveLength(1);
      expect(s.robots[0].name).toBe('New');
      expect(s.pagination.total).toBe(1);
    });
  });

  describe('removeRobot', () => {
    it('removes and clears related state', () => {
      const robot = makeRobot({ id: 'r1' });
      useRobotsStore.setState({
        robots: [robot],
        robotDetail: robot,
        selectedRobotId: 'r1',
        telemetryCache: { r1: makeTelemetry('r1') },
        pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      });

      useRobotsStore.getState().removeRobot('r1');

      const s = useRobotsStore.getState();
      expect(s.robots).toEqual([]);
      expect(s.robotDetail).toBeNull();
      expect(s.selectedRobotId).toBeNull();
      expect(s.telemetryCache.r1).toBeUndefined();
      expect(s.pagination.total).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // clearError / reset
  // --------------------------------------------------------------------------
  describe('clearError', () => {
    it('nulls out error', () => {
      useRobotsStore.setState({ error: 'oops' });
      useRobotsStore.getState().clearError();
      expect(useRobotsStore.getState().error).toBeNull();
    });
  });

  describe('reset', () => {
    it('restores initial state values', () => {
      useRobotsStore.setState({
        robots: [makeRobot({ id: 'r1' })],
        selectedRobotId: 'r1',
        error: 'boom',
        isLoading: true,
        telemetryCache: { r1: makeTelemetry('r1') },
      });

      useRobotsStore.getState().reset();

      const s = useRobotsStore.getState();
      expect(s.robots).toEqual([]);
      expect(s.selectedRobotId).toBeNull();
      expect(s.error).toBeNull();
      expect(s.isLoading).toBe(false);
      expect(s.telemetryCache).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // SELECTORS
  // --------------------------------------------------------------------------
  describe('selectors', () => {
    it('basic selectors return matching slices', () => {
      const robot = makeRobot({ id: 'r1' });
      const t = makeTelemetry('r1');
      useRobotsStore.setState({
        robots: [robot],
        selectedRobotId: 'r1',
        robotDetail: robot,
        filters: { zone: 'A' },
        pagination: { page: 2, pageSize: 12, total: 1, totalPages: 1 },
        isLoading: true,
        error: 'e',
        telemetryCache: { r1: t },
      });
      const s = useRobotsStore.getState();
      expect(selectRobots(s)).toEqual([robot]);
      expect(selectSelectedRobotId(s)).toBe('r1');
      expect(selectRobotDetail(s)).toEqual(robot);
      expect(selectFilters(s)).toEqual({ zone: 'A' });
      expect(selectPagination(s).page).toBe(2);
      expect(selectIsLoading(s)).toBe(true);
      expect(selectError(s)).toBe('e');
      expect(selectTelemetryCache(s)).toEqual({ r1: t });
    });

    it('selectRobotById finds robot or null', () => {
      const robot = makeRobot({ id: 'r1' });
      useRobotsStore.setState({ robots: [robot] });
      const s = useRobotsStore.getState();
      expect(selectRobotById('r1')(s)).toEqual(robot);
      expect(selectRobotById('nope')(s)).toBeNull();
    });

    it('selectRobotsByStatus filters by status', () => {
      useRobotsStore.setState({
        robots: [makeRobot({ id: 'a', status: 'online' }), makeRobot({ id: 'b', status: 'error' })],
      });
      const s = useRobotsStore.getState();
      expect(selectRobotsByStatus('error')(s).map((r) => r.id)).toEqual(['b']);
    });

    it('selectRobotsNeedingAttention catches errors and low battery, ignores AC-powered', () => {
      useRobotsStore.setState({
        robots: [
          makeRobot({ id: 'err', status: 'error', batteryLevel: 100 }),
          makeRobot({ id: 'low', status: 'online', batteryLevel: 10 }),
          makeRobot({ id: 'ok', status: 'online', batteryLevel: 80 }),
          makeRobot({ id: 'ac', status: 'online', batteryLevel: null }),
        ],
      });
      const s = useRobotsStore.getState();
      expect(selectRobotsNeedingAttention(s).map((r) => r.id).sort()).toEqual(['err', 'low']);
    });

    it('selectRobotTelemetry returns cached telemetry or null', () => {
      const t = makeTelemetry('r1');
      useRobotsStore.setState({ telemetryCache: { r1: t } });
      const s = useRobotsStore.getState();
      expect(selectRobotTelemetry('r1')(s)).toEqual(t);
      expect(selectRobotTelemetry('other')(s)).toBeNull();
    });

    it('selectSelectedRobot resolves selected id from list', () => {
      const robot = makeRobot({ id: 'r1' });
      useRobotsStore.setState({ robots: [robot], selectedRobotId: 'r1' });
      expect(selectSelectedRobot(useRobotsStore.getState())).toEqual(robot);

      useRobotsStore.setState({ selectedRobotId: null });
      expect(selectSelectedRobot(useRobotsStore.getState())).toBeNull();

      useRobotsStore.setState({ selectedRobotId: 'missing' });
      expect(selectSelectedRobot(useRobotsStore.getState())).toBeNull();
    });
  });
});

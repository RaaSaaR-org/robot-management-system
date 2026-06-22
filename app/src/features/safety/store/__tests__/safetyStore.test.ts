/**
 * @file safetyStore.test.ts
 * @description Tests for the safety Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useSafetyStore,
  selectFleetStatus,
  selectIsLoadingFleetStatus,
  selectFleetHasTriggeredEStop,
  selectTriggeredRobotCount,
  selectRobotStatus,
  selectIsRobotEStopTriggered,
  selectEvents,
  selectIsTriggering,
  selectIsResetting,
  selectLastActionError,
  selectHeartbeatsActive,
} from '../safetyStore';
import type {
  RobotSafetyStatus,
  FleetSafetyStatus,
  EStopEvent,
} from '../../types/safety.types';

vi.mock('../../api/safetyApi', () => ({
  safetyApi: {
    getRobotSafetyStatus: vi.fn(),
    triggerRobotEStop: vi.fn(),
    resetRobotEStop: vi.fn(),
    getFleetSafetyStatus: vi.fn(),
    triggerFleetEStop: vi.fn(),
    resetFleetEStop: vi.fn(),
    triggerZoneEStop: vi.fn(),
    getEStopEvents: vi.fn(),
    startHeartbeats: vi.fn(),
    stopHeartbeats: vi.fn(),
  },
}));

import { safetyApi } from '../../api/safetyApi';

const mockApi = safetyApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRobotStatus(over: Partial<RobotSafetyStatus> = {}): RobotSafetyStatus {
  return {
    robotId: 'r1',
    robotName: 'Robot 1',
    status: 'armed',
    stopCategory: 1,
    requiresManualReset: false,
    operatingMode: 'automatic',
    serverConnected: true,
    currentSpeed: 0,
    activeSpeedLimit: 250,
    activeForceLimit: 100,
    systemHealthy: true,
    warnings: [],
    lastCheckTimestamp: '2024-01-01T00:00:00.000Z',
    ...over,
  };
}

function makeFleetStatus(over: Partial<FleetSafetyStatus> = {}): FleetSafetyStatus {
  return {
    timestamp: '2024-01-01T00:00:00.000Z',
    robots: [],
    anyTriggered: false,
    triggeredCount: 0,
    ...over,
  };
}

function makeEvent(id: string): EStopEvent {
  return {
    id,
    scope: 'fleet',
    triggeredAt: '2024-01-01T00:00:00.000Z',
    triggeredBy: 'user',
    reason: 'r',
    affectedRobots: [],
    result: {} as never,
  };
}

function resetStore() {
  useSafetyStore.setState({
    fleetStatus: null,
    isLoadingFleetStatus: false,
    fleetStatusError: null,
    robotStatuses: new Map(),
    events: [],
    isLoadingEvents: false,
    isTriggering: false,
    isResetting: false,
    lastActionError: null,
    heartbeatsActive: false,
  });
}

describe('safetyStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('starts with the documented initial state', () => {
    const s = useSafetyStore.getState();
    expect(s.fleetStatus).toBeNull();
    expect(s.isLoadingFleetStatus).toBe(false);
    expect(s.fleetStatusError).toBeNull();
    expect(s.robotStatuses.size).toBe(0);
    expect(s.events).toEqual([]);
    expect(s.isTriggering).toBe(false);
    expect(s.isResetting).toBe(false);
    expect(s.lastActionError).toBeNull();
    expect(s.heartbeatsActive).toBe(false);
  });

  describe('fetchFleetStatus', () => {
    it('stores fleet status and populates robot cache on success', async () => {
      const robot = makeRobotStatus({ robotId: 'r1' });
      mockApi.getFleetSafetyStatus.mockResolvedValue(
        makeFleetStatus({ robots: [robot], anyTriggered: true, triggeredCount: 1 })
      );

      await useSafetyStore.getState().fetchFleetStatus();

      const s = useSafetyStore.getState();
      expect(s.fleetStatus?.triggeredCount).toBe(1);
      expect(s.isLoadingFleetStatus).toBe(false);
      expect(s.fleetStatusError).toBeNull();
      expect(s.robotStatuses.get('r1')).toEqual(robot);
    });

    it('sets error message and clears loading on failure', async () => {
      mockApi.getFleetSafetyStatus.mockRejectedValue(new Error('down'));

      await useSafetyStore.getState().fetchFleetStatus();

      const s = useSafetyStore.getState();
      expect(s.fleetStatusError).toBe('down');
      expect(s.isLoadingFleetStatus).toBe(false);
    });

    it('uses generic message for non-Error rejection', async () => {
      mockApi.getFleetSafetyStatus.mockRejectedValue('x');

      await useSafetyStore.getState().fetchFleetStatus();

      expect(useSafetyStore.getState().fleetStatusError).toBe('Failed to fetch fleet status');
    });
  });

  describe('clearFleetStatus', () => {
    it('nulls fleet status and error', () => {
      useSafetyStore.setState({ fleetStatus: makeFleetStatus(), fleetStatusError: 'e' });

      useSafetyStore.getState().clearFleetStatus();

      const s = useSafetyStore.getState();
      expect(s.fleetStatus).toBeNull();
      expect(s.fleetStatusError).toBeNull();
    });
  });

  describe('fetchRobotStatus', () => {
    it('caches and returns status on success', async () => {
      const robot = makeRobotStatus({ robotId: 'r9' });
      mockApi.getRobotSafetyStatus.mockResolvedValue(robot);

      const result = await useSafetyStore.getState().fetchRobotStatus('r9');

      expect(result).toEqual(robot);
      expect(useSafetyStore.getState().robotStatuses.get('r9')).toEqual(robot);
    });

    it('returns null on failure', async () => {
      mockApi.getRobotSafetyStatus.mockRejectedValue(new Error('x'));

      const result = await useSafetyStore.getState().fetchRobotStatus('r9');

      expect(result).toBeNull();
      expect(useSafetyStore.getState().robotStatuses.has('r9')).toBe(false);
    });
  });

  describe('clearRobotStatuses', () => {
    it('empties the robot cache', () => {
      const map = new Map<string, RobotSafetyStatus>();
      map.set('r1', makeRobotStatus());
      useSafetyStore.setState({ robotStatuses: map });

      useSafetyStore.getState().clearRobotStatuses();

      expect(useSafetyStore.getState().robotStatuses.size).toBe(0);
    });
  });

  describe('triggerRobotEStop', () => {
    it('caches returned status, refreshes fleet, returns true on success', async () => {
      const triggered = makeRobotStatus({ robotId: 'r1', status: 'triggered' });
      mockApi.triggerRobotEStop.mockResolvedValue(triggered);
      mockApi.getFleetSafetyStatus.mockResolvedValue(makeFleetStatus());

      const ok = await useSafetyStore.getState().triggerRobotEStop('r1', 'manual');

      const s = useSafetyStore.getState();
      expect(ok).toBe(true);
      expect(mockApi.triggerRobotEStop).toHaveBeenCalledWith('r1', {
        reason: 'manual',
        triggeredBy: 'user',
      });
      expect(s.robotStatuses.get('r1')?.status).toBe('triggered');
      expect(s.isTriggering).toBe(false);
      expect(mockApi.getFleetSafetyStatus).toHaveBeenCalled();
    });

    it('records error, returns false, leaves isTriggering false on failure', async () => {
      mockApi.triggerRobotEStop.mockRejectedValue(new Error('estop fail'));

      const ok = await useSafetyStore.getState().triggerRobotEStop('r1', 'manual');

      const s = useSafetyStore.getState();
      expect(ok).toBe(false);
      expect(s.lastActionError).toBe('estop fail');
      expect(s.isTriggering).toBe(false);
      expect(mockApi.getFleetSafetyStatus).not.toHaveBeenCalled();
    });
  });

  describe('resetRobotEStop', () => {
    it('caches status and returns true on success', async () => {
      const armed = makeRobotStatus({ robotId: 'r1', status: 'armed' });
      mockApi.resetRobotEStop.mockResolvedValue(armed);
      mockApi.getFleetSafetyStatus.mockResolvedValue(makeFleetStatus());

      const ok = await useSafetyStore.getState().resetRobotEStop('r1');

      const s = useSafetyStore.getState();
      expect(ok).toBe(true);
      expect(s.robotStatuses.get('r1')?.status).toBe('armed');
      expect(s.isResetting).toBe(false);
    });

    it('records error and returns false on failure', async () => {
      mockApi.resetRobotEStop.mockRejectedValue(new Error('reset fail'));

      const ok = await useSafetyStore.getState().resetRobotEStop('r1');

      const s = useSafetyStore.getState();
      expect(ok).toBe(false);
      expect(s.lastActionError).toBe('reset fail');
      expect(s.isResetting).toBe(false);
    });
  });

  describe('triggerFleetEStop', () => {
    it('returns true and refreshes fleet on success', async () => {
      mockApi.triggerFleetEStop.mockResolvedValue({} as never);
      mockApi.getFleetSafetyStatus.mockResolvedValue(makeFleetStatus());

      const ok = await useSafetyStore.getState().triggerFleetEStop('emergency');

      expect(ok).toBe(true);
      expect(mockApi.triggerFleetEStop).toHaveBeenCalledWith({
        reason: 'emergency',
        triggeredBy: 'user',
      });
      expect(useSafetyStore.getState().isTriggering).toBe(false);
      expect(mockApi.getFleetSafetyStatus).toHaveBeenCalled();
    });

    it('records error and returns false on failure', async () => {
      mockApi.triggerFleetEStop.mockRejectedValue(new Error('fleet fail'));

      const ok = await useSafetyStore.getState().triggerFleetEStop('emergency');

      expect(ok).toBe(false);
      expect(useSafetyStore.getState().lastActionError).toBe('fleet fail');
    });
  });

  describe('resetFleetEStop', () => {
    it('returns true on success', async () => {
      mockApi.resetFleetEStop.mockResolvedValue({} as never);
      mockApi.getFleetSafetyStatus.mockResolvedValue(makeFleetStatus());

      const ok = await useSafetyStore.getState().resetFleetEStop();

      expect(ok).toBe(true);
      expect(useSafetyStore.getState().isResetting).toBe(false);
    });

    it('records error and returns false on failure', async () => {
      mockApi.resetFleetEStop.mockRejectedValue(new Error('fleet reset fail'));

      const ok = await useSafetyStore.getState().resetFleetEStop();

      expect(ok).toBe(false);
      expect(useSafetyStore.getState().lastActionError).toBe('fleet reset fail');
    });
  });

  describe('triggerZoneEStop', () => {
    it('returns true and passes zone+reason on success', async () => {
      mockApi.triggerZoneEStop.mockResolvedValue({} as never);
      mockApi.getFleetSafetyStatus.mockResolvedValue(makeFleetStatus());

      const ok = await useSafetyStore.getState().triggerZoneEStop('zone-a', 'spill');

      expect(ok).toBe(true);
      expect(mockApi.triggerZoneEStop).toHaveBeenCalledWith('zone-a', {
        reason: 'spill',
        triggeredBy: 'user',
      });
    });

    it('records error and returns false on failure', async () => {
      mockApi.triggerZoneEStop.mockRejectedValue(new Error('zone fail'));

      const ok = await useSafetyStore.getState().triggerZoneEStop('zone-a', 'spill');

      expect(ok).toBe(false);
      expect(useSafetyStore.getState().lastActionError).toBe('zone fail');
    });
  });

  describe('fetchEvents', () => {
    it('stores events and uses default limit on success', async () => {
      const events = [makeEvent('e1')];
      mockApi.getEStopEvents.mockResolvedValue({ events, count: 1 });

      await useSafetyStore.getState().fetchEvents();

      expect(mockApi.getEStopEvents).toHaveBeenCalledWith(50);
      const s = useSafetyStore.getState();
      expect(s.events).toEqual(events);
      expect(s.isLoadingEvents).toBe(false);
    });

    it('honors a custom limit', async () => {
      mockApi.getEStopEvents.mockResolvedValue({ events: [], count: 0 });

      await useSafetyStore.getState().fetchEvents(10);

      expect(mockApi.getEStopEvents).toHaveBeenCalledWith(10);
    });

    it('clears loading on failure', async () => {
      mockApi.getEStopEvents.mockRejectedValue(new Error('x'));

      await useSafetyStore.getState().fetchEvents();

      expect(useSafetyStore.getState().isLoadingEvents).toBe(false);
    });
  });

  describe('addEvent', () => {
    it('prepends the event', () => {
      useSafetyStore.setState({ events: [makeEvent('old')] });

      useSafetyStore.getState().addEvent(makeEvent('new'));

      expect(useSafetyStore.getState().events.map((e) => e.id)).toEqual(['new', 'old']);
    });

    it('caps the list at 100 events', () => {
      const events = Array.from({ length: 100 }, (_, i) => makeEvent(`e${i}`));
      useSafetyStore.setState({ events });

      useSafetyStore.getState().addEvent(makeEvent('newest'));

      const s = useSafetyStore.getState();
      expect(s.events).toHaveLength(100);
      expect(s.events[0].id).toBe('newest');
      // oldest (last) was popped
      expect(s.events.some((e) => e.id === 'e99')).toBe(false);
    });
  });

  describe('startHeartbeats / stopHeartbeats', () => {
    it('start sets active true and passes interval on success', async () => {
      mockApi.startHeartbeats.mockResolvedValue({ message: 'ok' });

      const ok = await useSafetyStore.getState().startHeartbeats(1000);

      expect(ok).toBe(true);
      expect(mockApi.startHeartbeats).toHaveBeenCalledWith(1000);
      expect(useSafetyStore.getState().heartbeatsActive).toBe(true);
    });

    it('start returns false and leaves active false on failure', async () => {
      mockApi.startHeartbeats.mockRejectedValue(new Error('x'));

      const ok = await useSafetyStore.getState().startHeartbeats();

      expect(ok).toBe(false);
      expect(useSafetyStore.getState().heartbeatsActive).toBe(false);
    });

    it('stop sets active false on success', async () => {
      useSafetyStore.setState({ heartbeatsActive: true });
      mockApi.stopHeartbeats.mockResolvedValue({ message: 'ok' });

      const ok = await useSafetyStore.getState().stopHeartbeats();

      expect(ok).toBe(true);
      expect(useSafetyStore.getState().heartbeatsActive).toBe(false);
    });

    it('stop returns false on failure without changing active flag', async () => {
      useSafetyStore.setState({ heartbeatsActive: true });
      mockApi.stopHeartbeats.mockRejectedValue(new Error('x'));

      const ok = await useSafetyStore.getState().stopHeartbeats();

      expect(ok).toBe(false);
      expect(useSafetyStore.getState().heartbeatsActive).toBe(true);
    });
  });

  describe('clearError', () => {
    it('nulls lastActionError', () => {
      useSafetyStore.setState({ lastActionError: 'oops' });

      useSafetyStore.getState().clearError();

      expect(useSafetyStore.getState().lastActionError).toBeNull();
    });
  });

  describe('selectors', () => {
    it('fleet selectors derive triggered flags with safe defaults', () => {
      // default (null fleetStatus)
      expect(selectFleetHasTriggeredEStop(useSafetyStore.getState())).toBe(false);
      expect(selectTriggeredRobotCount(useSafetyStore.getState())).toBe(0);

      const fleet = makeFleetStatus({ anyTriggered: true, triggeredCount: 3 });
      useSafetyStore.setState({ fleetStatus: fleet, isLoadingFleetStatus: true });
      const s = useSafetyStore.getState();
      expect(selectFleetStatus(s)).toEqual(fleet);
      expect(selectIsLoadingFleetStatus(s)).toBe(true);
      expect(selectFleetHasTriggeredEStop(s)).toBe(true);
      expect(selectTriggeredRobotCount(s)).toBe(3);
    });

    it('robot selectors read from the cache', () => {
      const map = new Map<string, RobotSafetyStatus>();
      map.set('r1', makeRobotStatus({ robotId: 'r1', status: 'triggered' }));
      useSafetyStore.setState({ robotStatuses: map });
      const s = useSafetyStore.getState();

      expect(selectRobotStatus('r1')(s)?.robotId).toBe('r1');
      expect(selectIsRobotEStopTriggered('r1')(s)).toBe(true);
      expect(selectRobotStatus('missing')(s)).toBeUndefined();
      expect(selectIsRobotEStopTriggered('missing')(s)).toBe(false);
    });

    it('flag selectors return their slices', () => {
      useSafetyStore.setState({
        events: [makeEvent('e')],
        isTriggering: true,
        isResetting: true,
        lastActionError: 'err',
        heartbeatsActive: true,
      });
      const s = useSafetyStore.getState();
      expect(selectEvents(s)).toHaveLength(1);
      expect(selectIsTriggering(s)).toBe(true);
      expect(selectIsResetting(s)).toBe(true);
      expect(selectLastActionError(s)).toBe('err');
      expect(selectHeartbeatsActive(s)).toBe(true);
    });
  });
});

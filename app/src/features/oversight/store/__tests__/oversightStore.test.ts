/**
 * @file oversightStore.test.ts
 * @description Tests for the oversight Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOversightStore } from '../oversightStore';
import { oversightApi } from '../../api';

vi.mock('../../api', () => ({
  oversightApi: {
    getDashboardStats: vi.fn(),
    getManualSessions: vi.fn(),
    activateManualMode: vi.fn(),
    deactivateManualMode: vi.fn(),
    getAnomalies: vi.fn(),
    getActiveAnomalies: vi.fn(),
    acknowledgeAnomaly: vi.fn(),
    resolveAnomaly: vi.fn(),
    getVerificationSchedules: vi.fn(),
    getDueVerifications: vi.fn(),
    createVerificationSchedule: vi.fn(),
    completeVerification: vi.fn(),
    getFleetOverview: vi.fn(),
    getRobotCapabilities: vi.fn(),
    getOversightLogs: vi.fn(),
  },
}));

// Typed handle to the mocked api
const api = oversightApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const session = (robotId: string) => ({ id: `sess-${robotId}`, robotId }) as any;
const anomaly = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, ...extra }) as any;

describe('oversightStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useOversightStore.getState().reset();
  });

  it('starts with initial state', () => {
    const s = useOversightStore.getState();
    expect(s.dashboardStats).toBeNull();
    expect(s.dashboardLoading).toBe(false);
    expect(s.dashboardError).toBeNull();
    expect(s.activeManualSessions).toEqual([]);
    expect(s.manualSessionsLoading).toBe(false);
    expect(s.anomalies).toEqual([]);
    expect(s.activeAnomalies).toEqual([]);
    expect(s.anomaliesTotal).toBe(0);
    expect(s.anomaliesPage).toBe(1);
    expect(s.verificationSchedules).toEqual([]);
    expect(s.dueVerifications).toEqual([]);
    expect(s.fleetOverview).toBeNull();
    expect(s.selectedRobotId).toBeNull();
    expect(s.robotCapabilities).toBeNull();
    expect(s.oversightLogs).toEqual([]);
    expect(s.logsTotal).toBe(0);
    expect(s.logsPage).toBe(1);
  });

  // ---------------------------------------------------------------- DASHBOARD
  describe('fetchDashboardStats', () => {
    it('sets stats and clears loading on success', async () => {
      const stats = { totalRobots: 5 } as any;
      api.getDashboardStats.mockResolvedValue(stats);

      await useOversightStore.getState().fetchDashboardStats();

      const s = useOversightStore.getState();
      expect(s.dashboardStats).toBe(stats);
      expect(s.dashboardLoading).toBe(false);
      expect(s.dashboardError).toBeNull();
    });

    it('captures error message and clears loading on failure', async () => {
      api.getDashboardStats.mockRejectedValue(new Error('boom'));

      await useOversightStore.getState().fetchDashboardStats();

      const s = useOversightStore.getState();
      expect(s.dashboardStats).toBeNull();
      expect(s.dashboardError).toBe('boom');
      expect(s.dashboardLoading).toBe(false);
    });

    it('falls back to default message for non-Error rejection', async () => {
      api.getDashboardStats.mockRejectedValue('nope');

      await useOversightStore.getState().fetchDashboardStats();

      expect(useOversightStore.getState().dashboardError).toBe('Failed to fetch dashboard');
    });
  });

  // ----------------------------------------------------------- MANUAL CONTROL
  describe('manual control', () => {
    it('fetchActiveManualSessions stores sessions on success', async () => {
      const sessions = [session('r1'), session('r2')];
      api.getManualSessions.mockResolvedValue(sessions);

      await useOversightStore.getState().fetchActiveManualSessions();

      expect(api.getManualSessions).toHaveBeenCalledWith({ isActive: true });
      const s = useOversightStore.getState();
      expect(s.activeManualSessions).toBe(sessions);
      expect(s.manualSessionsLoading).toBe(false);
    });

    it('fetchActiveManualSessions clears loading on error', async () => {
      api.getManualSessions.mockRejectedValue(new Error('x'));

      await useOversightStore.getState().fetchActiveManualSessions();

      const s = useOversightStore.getState();
      expect(s.manualSessionsLoading).toBe(false);
      expect(s.activeManualSessions).toEqual([]);
    });

    it('activateManualMode appends session and returns response', async () => {
      const response = { session: session('r3') } as any;
      api.activateManualMode.mockResolvedValue(response);

      const result = await useOversightStore
        .getState()
        .activateManualMode({ robotId: 'r3' } as any);

      expect(result).toBe(response);
      expect(useOversightStore.getState().activeManualSessions).toEqual([response.session]);
    });

    it('deactivateManualMode removes only the matching session', async () => {
      useOversightStore.setState({
        activeManualSessions: [session('r1'), session('r2')],
      });
      api.deactivateManualMode.mockResolvedValue(undefined);

      await useOversightStore.getState().deactivateManualMode('r1');

      expect(api.deactivateManualMode).toHaveBeenCalledWith('r1');
      const remaining = useOversightStore.getState().activeManualSessions;
      expect(remaining.map((s) => s.robotId)).toEqual(['r2']);
    });
  });

  // ---------------------------------------------------------------- ANOMALIES
  describe('anomalies', () => {
    it('fetchAnomalies stores list, total and page on success', async () => {
      api.getAnomalies.mockResolvedValue({
        anomalies: [anomaly('a1')],
        total: 7,
        page: 2,
      });

      await useOversightStore.getState().fetchAnomalies({ page: 2 } as any);

      const s = useOversightStore.getState();
      expect(s.anomalies).toEqual([anomaly('a1')]);
      expect(s.anomaliesTotal).toBe(7);
      expect(s.anomaliesPage).toBe(2);
      expect(s.anomaliesLoading).toBe(false);
    });

    it('fetchAnomalies clears loading on error without throwing', async () => {
      api.getAnomalies.mockRejectedValue(new Error('fail'));

      await expect(useOversightStore.getState().fetchAnomalies()).resolves.toBeUndefined();
      expect(useOversightStore.getState().anomaliesLoading).toBe(false);
    });

    it('fetchActiveAnomalies stores active list on success', async () => {
      api.getActiveAnomalies.mockResolvedValue([anomaly('a2')]);

      await useOversightStore.getState().fetchActiveAnomalies('r1');

      expect(api.getActiveAnomalies).toHaveBeenCalledWith('r1');
      const s = useOversightStore.getState();
      expect(s.activeAnomalies).toEqual([anomaly('a2')]);
      expect(s.anomaliesLoading).toBe(false);
    });

    it('fetchActiveAnomalies clears loading on error', async () => {
      api.getActiveAnomalies.mockRejectedValue(new Error('e'));

      await useOversightStore.getState().fetchActiveAnomalies();

      expect(useOversightStore.getState().anomaliesLoading).toBe(false);
    });

    it('acknowledgeAnomaly updates matching anomaly in both lists', async () => {
      useOversightStore.setState({
        anomalies: [anomaly('a1', { acknowledged: false }), anomaly('a2')],
        activeAnomalies: [anomaly('a1', { acknowledged: false })],
      });
      const updated = anomaly('a1', { acknowledged: true });
      api.acknowledgeAnomaly.mockResolvedValue(updated);

      await useOversightStore.getState().acknowledgeAnomaly('a1');

      const s = useOversightStore.getState();
      expect(s.anomalies[0]).toEqual(updated);
      expect(s.anomalies[1]).toEqual(anomaly('a2'));
      expect(s.activeAnomalies[0]).toEqual(updated);
    });

    it('acknowledgeAnomaly is a no-op for unknown id', async () => {
      useOversightStore.setState({ anomalies: [anomaly('a1')], activeAnomalies: [] });
      api.acknowledgeAnomaly.mockResolvedValue(anomaly('zzz'));

      await useOversightStore.getState().acknowledgeAnomaly('zzz');

      expect(useOversightStore.getState().anomalies).toEqual([anomaly('a1')]);
    });

    it('resolveAnomaly updates list and removes from active anomalies', async () => {
      useOversightStore.setState({
        anomalies: [anomaly('a1', { resolved: false })],
        activeAnomalies: [anomaly('a1'), anomaly('a2')],
      });
      const updated = anomaly('a1', { resolved: true });
      api.resolveAnomaly.mockResolvedValue(updated);

      await useOversightStore.getState().resolveAnomaly('a1', 'fixed it');

      expect(api.resolveAnomaly).toHaveBeenCalledWith('a1', 'fixed it');
      const s = useOversightStore.getState();
      expect(s.anomalies[0]).toEqual(updated);
      expect(s.activeAnomalies.map((a) => a.id)).toEqual(['a2']);
    });
  });

  // ------------------------------------------------------------ VERIFICATIONS
  describe('verifications', () => {
    it('fetchVerificationSchedules stores schedules on success', async () => {
      api.getVerificationSchedules.mockResolvedValue([{ id: 'v1' }]);

      await useOversightStore.getState().fetchVerificationSchedules();

      const s = useOversightStore.getState();
      expect(s.verificationSchedules).toEqual([{ id: 'v1' }]);
      expect(s.verificationsLoading).toBe(false);
    });

    it('fetchVerificationSchedules clears loading on error', async () => {
      api.getVerificationSchedules.mockRejectedValue(new Error('e'));

      await useOversightStore.getState().fetchVerificationSchedules();

      expect(useOversightStore.getState().verificationsLoading).toBe(false);
    });

    it('fetchDueVerifications stores due list on success', async () => {
      api.getDueVerifications.mockResolvedValue([{ id: 'd1' }]);

      await useOversightStore.getState().fetchDueVerifications();

      const s = useOversightStore.getState();
      expect(s.dueVerifications).toEqual([{ id: 'd1' }]);
      expect(s.verificationsLoading).toBe(false);
    });

    it('fetchDueVerifications clears loading on error', async () => {
      api.getDueVerifications.mockRejectedValue(new Error('e'));

      await useOversightStore.getState().fetchDueVerifications();

      expect(useOversightStore.getState().verificationsLoading).toBe(false);
    });

    it('createVerificationSchedule appends schedule and returns it', async () => {
      const schedule = { id: 'v2' } as any;
      api.createVerificationSchedule.mockResolvedValue(schedule);

      const result = await useOversightStore
        .getState()
        .createVerificationSchedule({ robotId: 'r1' } as any);

      expect(result).toBe(schedule);
      expect(useOversightStore.getState().verificationSchedules).toEqual([schedule]);
    });

    it('completeVerification refreshes due verifications', async () => {
      api.completeVerification.mockResolvedValue(undefined);
      api.getDueVerifications.mockResolvedValue([{ id: 'due-fresh' }]);

      await useOversightStore.getState().completeVerification({ scheduleId: 'v1' } as any);

      expect(api.completeVerification).toHaveBeenCalledWith({ scheduleId: 'v1' });
      expect(useOversightStore.getState().dueVerifications).toEqual([{ id: 'due-fresh' }]);
    });
  });

  // ------------------------------------------------------ FLEET & CAPABILITIES
  describe('fleet & robot capabilities', () => {
    it('fetchFleetOverview stores overview on success', async () => {
      api.getFleetOverview.mockResolvedValue({ robots: 3 });

      await useOversightStore.getState().fetchFleetOverview();

      const s = useOversightStore.getState();
      expect(s.fleetOverview).toEqual({ robots: 3 });
      expect(s.fleetOverviewLoading).toBe(false);
    });

    it('fetchFleetOverview clears loading on error', async () => {
      api.getFleetOverview.mockRejectedValue(new Error('e'));

      await useOversightStore.getState().fetchFleetOverview();

      expect(useOversightStore.getState().fleetOverviewLoading).toBe(false);
    });

    it('fetchRobotCapabilities stores capabilities and selected id on success', async () => {
      api.getRobotCapabilities.mockResolvedValue({ canManual: true });

      await useOversightStore.getState().fetchRobotCapabilities('r9');

      expect(api.getRobotCapabilities).toHaveBeenCalledWith('r9');
      const s = useOversightStore.getState();
      expect(s.robotCapabilities).toEqual({ canManual: true });
      expect(s.selectedRobotId).toBe('r9');
      expect(s.robotCapabilitiesLoading).toBe(false);
    });

    it('fetchRobotCapabilities clears loading on error and leaves selectedRobotId', async () => {
      api.getRobotCapabilities.mockRejectedValue(new Error('e'));

      await useOversightStore.getState().fetchRobotCapabilities('r9');

      const s = useOversightStore.getState();
      expect(s.robotCapabilitiesLoading).toBe(false);
      expect(s.selectedRobotId).toBeNull();
    });

    it('setSelectedRobotId sets the id without clearing capabilities', () => {
      useOversightStore.setState({ robotCapabilities: { x: 1 } as any });

      useOversightStore.getState().setSelectedRobotId('r1');

      const s = useOversightStore.getState();
      expect(s.selectedRobotId).toBe('r1');
      expect(s.robotCapabilities).toEqual({ x: 1 });
    });

    it('setSelectedRobotId(null) clears capabilities', () => {
      useOversightStore.setState({
        selectedRobotId: 'r1',
        robotCapabilities: { x: 1 } as any,
      });

      useOversightStore.getState().setSelectedRobotId(null);

      const s = useOversightStore.getState();
      expect(s.selectedRobotId).toBeNull();
      expect(s.robotCapabilities).toBeNull();
    });
  });

  // ------------------------------------------------------------------- LOGS
  describe('oversight logs', () => {
    it('fetchOversightLogs stores logs, total and page on success', async () => {
      api.getOversightLogs.mockResolvedValue({
        logs: [{ id: 'l1' }],
        total: 12,
        page: 3,
      });

      await useOversightStore.getState().fetchOversightLogs({ page: 3 } as any);

      const s = useOversightStore.getState();
      expect(s.oversightLogs).toEqual([{ id: 'l1' }]);
      expect(s.logsTotal).toBe(12);
      expect(s.logsPage).toBe(3);
      expect(s.logsLoading).toBe(false);
    });

    it('fetchOversightLogs clears loading on error', async () => {
      api.getOversightLogs.mockRejectedValue(new Error('e'));

      await useOversightStore.getState().fetchOversightLogs();

      expect(useOversightStore.getState().logsLoading).toBe(false);
    });
  });

  // ------------------------------------------------------------------- RESET
  it('reset restores initial state', () => {
    useOversightStore.setState({
      dashboardStats: { x: 1 } as any,
      activeManualSessions: [session('r1')],
      anomaliesTotal: 99,
      selectedRobotId: 'r5',
    });

    useOversightStore.getState().reset();

    const s = useOversightStore.getState();
    expect(s.dashboardStats).toBeNull();
    expect(s.activeManualSessions).toEqual([]);
    expect(s.anomaliesTotal).toBe(0);
    expect(s.selectedRobotId).toBeNull();
  });
});

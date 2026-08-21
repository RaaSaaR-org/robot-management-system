/**
 * @file alertsStore.test.ts
 * @description Tests for the alerts Zustand store
 * @feature alerts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useAlertsStore,
  selectAlerts,
  selectIsLoading,
  selectError,
  selectUnacknowledgedAlerts,
  selectAcknowledgedAlerts,
  selectCriticalAlerts,
  selectUnacknowledgedCriticalAlerts,
  selectAlertsBySeverity,
  selectAlertsBySource,
  selectAlertById,
  selectUnacknowledgedCount,
  selectMostCriticalAlert,
  selectHistory,
  selectHistoryPagination,
  selectHistoryFilters,
  selectIsHistoryLoading,
  selectAlertCounts,
} from '../alertsStore';
import type { Alert, CreateAlertRequest } from '../../types/alerts.types';

vi.mock('../../api/alertsApi', () => ({
  alertsApi: {
    acknowledgeAlert: vi.fn(),
    deleteAlert: vi.fn(),
    getActiveAlerts: vi.fn(),
    getAlertHistory: vi.fn(),
    getAlertCounts: vi.fn(),
  },
}));

import { alertsApi } from '../../api/alertsApi';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    severity: 'info',
    title: 'Title',
    message: 'Message',
    source: 'system',
    timestamp: '2026-01-01T00:00:00.000Z',
    acknowledged: false,
    dismissable: true,
    ...overrides,
  };
}

const INITIAL_STATE = {
  alerts: [],
  isLoading: false,
  error: null,
  history: [],
  historyPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  historyFilters: {},
  isHistoryLoading: false,
  alertCounts: { critical: 0, error: 0, warning: 0, info: 0 },
};

describe('alertsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAlertsStore.setState({ ...INITIAL_STATE });
  });

  it('starts with initial state', () => {
    const s = useAlertsStore.getState();
    expect(s.alerts).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.historyPagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(s.historyFilters).toEqual({});
    expect(s.isHistoryLoading).toBe(false);
    expect(s.alertCounts).toEqual({ critical: 0, error: 0, warning: 0, info: 0 });
  });

  // --------------------------------------------------------------------------
  // addAlert
  // --------------------------------------------------------------------------
  describe('addAlert', () => {
    it('creates an alert with generated id and defaults, returns it', () => {
      const req: CreateAlertRequest = {
        severity: 'warning',
        title: 'W',
        message: 'm',
        source: 'robot',
      };
      const created = useAlertsStore.getState().addAlert(req);

      expect(created.id).toMatch(/^alert_/);
      expect(created.acknowledged).toBe(false);
      // warning -> dismissable true, autoDismiss 15000
      expect(created.dismissable).toBe(true);
      expect(created.autoDismissMs).toBe(15000);
      expect(useAlertsStore.getState().alerts).toContainEqual(created);
    });

    it('critical alerts are non-dismissable with no auto-dismiss', () => {
      const created = useAlertsStore.getState().addAlert({
        severity: 'critical',
        title: 'C',
        message: 'm',
        source: 'system',
      });
      expect(created.dismissable).toBe(false);
      expect(created.autoDismissMs).toBeUndefined();
    });

    it('respects explicit dismissable and autoDismissMs overrides', () => {
      const created = useAlertsStore.getState().addAlert({
        severity: 'critical',
        title: 'C',
        message: 'm',
        source: 'system',
        dismissable: true,
        autoDismissMs: 5000,
      });
      expect(created.dismissable).toBe(true);
      expect(created.autoDismissMs).toBe(5000);
    });

    it('keeps alerts sorted by severity priority', () => {
      useAlertsStore.getState().addAlert({ severity: 'info', title: 'i', message: 'm', source: 'system' });
      useAlertsStore.getState().addAlert({ severity: 'critical', title: 'c', message: 'm', source: 'system' });
      useAlertsStore.getState().addAlert({ severity: 'warning', title: 'w', message: 'm', source: 'system' });

      const severities = useAlertsStore.getState().alerts.map((a) => a.severity);
      expect(severities).toEqual(['critical', 'warning', 'info']);
    });
  });

  // --------------------------------------------------------------------------
  // addAlertFromServer
  // --------------------------------------------------------------------------
  describe('addAlertFromServer', () => {
    it('adds a server alert and sorts', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a', severity: 'info' })] });
      useAlertsStore.getState().addAlertFromServer(makeAlert({ id: 'b', severity: 'critical' }));
      const ids = useAlertsStore.getState().alerts.map((a) => a.id);
      expect(ids).toEqual(['b', 'a']);
    });

    it('ignores duplicates by id', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'dup' })] });
      useAlertsStore.getState().addAlertFromServer(makeAlert({ id: 'dup', title: 'Changed' }));
      const alerts = useAlertsStore.getState().alerts;
      expect(alerts).toHaveLength(1);
      expect(alerts[0].title).toBe('Title');
    });
  });

  // --------------------------------------------------------------------------
  // removeAlert
  // --------------------------------------------------------------------------
  describe('removeAlert', () => {
    it('removes the alert by id', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a' }), makeAlert({ id: 'b' })] });
      useAlertsStore.getState().removeAlert('a');
      expect(useAlertsStore.getState().alerts.map((x) => x.id)).toEqual(['b']);
    });
  });

  // --------------------------------------------------------------------------
  // acknowledgeAlert (local)
  // --------------------------------------------------------------------------
  describe('acknowledgeAlert', () => {
    it('marks alert acknowledged and stamps acknowledgedAt', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a', acknowledged: false })] });
      useAlertsStore.getState().acknowledgeAlert('a');
      const alert = useAlertsStore.getState().alerts[0];
      expect(alert.acknowledged).toBe(true);
      expect(alert.acknowledgedAt).toBeTruthy();
    });

    it('no-op when alert not found', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a' })] });
      useAlertsStore.getState().acknowledgeAlert('missing');
      expect(useAlertsStore.getState().alerts[0].acknowledged).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // acknowledgeAlertAsync
  // --------------------------------------------------------------------------
  describe('acknowledgeAlertAsync', () => {
    it('replaces alert with server response in both alerts and history on success', async () => {
      const acked = makeAlert({ id: 'a', acknowledged: true, acknowledgedAt: '2026-02-02T00:00:00.000Z' });
      (alertsApi.acknowledgeAlert as any).mockResolvedValue(acked);
      useAlertsStore.setState({
        alerts: [makeAlert({ id: 'a' })],
        history: [makeAlert({ id: 'a' })],
      });

      await useAlertsStore.getState().acknowledgeAlertAsync('a');

      const s = useAlertsStore.getState();
      expect(s.alerts[0]).toEqual(acked);
      expect(s.history[0]).toEqual(acked);
    });

    it('rolls the acknowledgement back and reports the failure on API error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (alertsApi.acknowledgeAlert as any).mockRejectedValue(new Error('down'));
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a', acknowledged: false })] });

      await useAlertsStore.getState().acknowledgeAlertAsync('a');

      // Keeping it acknowledged would claim something the server never
      // recorded — and /alerts/active would hand the alert back anyway.
      const alert = useAlertsStore.getState().alerts[0];
      expect(alert.acknowledged).toBe(false);
      expect(alert.acknowledgedAt).toBeUndefined();
      expect(useAlertsStore.getState().error).toBe('down');
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('skips the API for a locally raised alert but still flips it', async () => {
      const created = useAlertsStore.getState().addAlert({
        severity: 'critical',
        title: 'E-stop',
        message: 'engaged',
        source: 'robot',
      });

      await useAlertsStore.getState().acknowledgeAlertAsync(created.id);

      expect(alertsApi.acknowledgeAlert).not.toHaveBeenCalled();
      expect(useAlertsStore.getState().alerts[0].acknowledged).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // dismissAlertAsync
  // --------------------------------------------------------------------------
  describe('dismissAlertAsync', () => {
    it('deletes the alert on the server and drops it from state', async () => {
      (alertsApi.deleteAlert as any).mockResolvedValue(undefined);
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a' }), makeAlert({ id: 'b' })] });

      await useAlertsStore.getState().dismissAlertAsync('a');

      expect(alertsApi.deleteAlert).toHaveBeenCalledWith('a');
      expect(useAlertsStore.getState().alerts.map((x) => x.id)).toEqual(['b']);
    });

    it('puts the alert back and reports the failure when the delete fails', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (alertsApi.deleteAlert as any).mockRejectedValue(new Error('nope'));
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a' })] });

      await useAlertsStore.getState().dismissAlertAsync('a');

      expect(useAlertsStore.getState().alerts.map((x) => x.id)).toEqual(['a']);
      expect(useAlertsStore.getState().error).toBe('nope');
      errSpy.mockRestore();
    });

    it('skips the API for a locally raised alert', async () => {
      const created = useAlertsStore.getState().addAlert({
        severity: 'info',
        title: 'local',
        message: 'm',
        source: 'system',
      });

      await useAlertsStore.getState().dismissAlertAsync(created.id);

      expect(alertsApi.deleteAlert).not.toHaveBeenCalled();
      expect(useAlertsStore.getState().alerts).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // clearAllAlerts / clearAcknowledgedAlerts
  // --------------------------------------------------------------------------
  describe('clear actions', () => {
    it('clearAllAlerts empties the list', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a' })] });
      useAlertsStore.getState().clearAllAlerts();
      expect(useAlertsStore.getState().alerts).toEqual([]);
    });

    it('clearAcknowledgedAlerts keeps only unacknowledged', () => {
      useAlertsStore.setState({
        alerts: [makeAlert({ id: 'a', acknowledged: true }), makeAlert({ id: 'b', acknowledged: false })],
      });
      useAlertsStore.getState().clearAcknowledgedAlerts();
      expect(useAlertsStore.getState().alerts.map((x) => x.id)).toEqual(['b']);
    });
  });

  // --------------------------------------------------------------------------
  // fetchActiveAlerts
  // --------------------------------------------------------------------------
  describe('fetchActiveAlerts', () => {
    it('sorts and stores alerts, clears loading on success', async () => {
      (alertsApi.getActiveAlerts as any).mockResolvedValue([
        makeAlert({ id: 'i', severity: 'info' }),
        makeAlert({ id: 'c', severity: 'critical' }),
      ]);

      await useAlertsStore.getState().fetchActiveAlerts();

      const s = useAlertsStore.getState();
      expect(s.alerts.map((a) => a.id)).toEqual(['c', 'i']);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('sets error message on failure', async () => {
      (alertsApi.getActiveAlerts as any).mockRejectedValue(new Error('boom'));

      await useAlertsStore.getState().fetchActiveAlerts();

      const s = useAlertsStore.getState();
      expect(s.isLoading).toBe(false);
      expect(s.error).toBe('boom');
    });

    it('uses fallback message for non-Error rejections', async () => {
      (alertsApi.getActiveAlerts as any).mockRejectedValue('weird');
      await useAlertsStore.getState().fetchActiveAlerts();
      expect(useAlertsStore.getState().error).toBe('Failed to fetch alerts');
    });
  });

  // --------------------------------------------------------------------------
  // fetchAlertHistory
  // --------------------------------------------------------------------------
  describe('fetchAlertHistory', () => {
    it('stores history and pagination using current filters on success', async () => {
      const pagination = { page: 2, pageSize: 20, total: 1, totalPages: 1 };
      (alertsApi.getAlertHistory as any).mockResolvedValue({ data: [makeAlert({ id: 'h' })], pagination });
      useAlertsStore.setState({ historyFilters: { severity: ['critical'] } });

      await useAlertsStore.getState().fetchAlertHistory(2);

      const s = useAlertsStore.getState();
      expect(alertsApi.getAlertHistory).toHaveBeenCalledWith(
        { severity: ['critical'], source: undefined, acknowledged: undefined, startDate: undefined, endDate: undefined },
        { page: 2, pageSize: 20 }
      );
      expect(s.history.map((a) => a.id)).toEqual(['h']);
      expect(s.historyPagination).toEqual(pagination);
      expect(s.isHistoryLoading).toBe(false);
    });

    it('defaults to current pagination page when none provided', async () => {
      (alertsApi.getAlertHistory as any).mockResolvedValue({
        data: [],
        pagination: { page: 3, pageSize: 20, total: 0, totalPages: 0 },
      });
      useAlertsStore.setState({ historyPagination: { page: 3, pageSize: 20, total: 0, totalPages: 0 } });

      await useAlertsStore.getState().fetchAlertHistory();

      expect((alertsApi.getAlertHistory as any).mock.calls[0][1]).toEqual({ page: 3, pageSize: 20 });
    });

    it('clears loading flag on error without setting error string', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (alertsApi.getAlertHistory as any).mockRejectedValue(new Error('x'));

      await useAlertsStore.getState().fetchAlertHistory(1);

      const s = useAlertsStore.getState();
      expect(s.isHistoryLoading).toBe(false);
      expect(s.error).toBeNull();
      errSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // setHistoryFilters
  // --------------------------------------------------------------------------
  describe('setHistoryFilters', () => {
    it('stores filters, resets page and refetches page 1', () => {
      (alertsApi.getAlertHistory as any).mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
      useAlertsStore.setState({ historyPagination: { page: 5, pageSize: 20, total: 0, totalPages: 0 } });

      useAlertsStore.getState().setHistoryFilters({ source: ['robot'] });

      const s = useAlertsStore.getState();
      expect(s.historyFilters).toEqual({ source: ['robot'] });
      expect(s.historyPagination.page).toBe(1);
      expect((alertsApi.getAlertHistory as any).mock.calls[0][1]).toEqual({ page: 1, pageSize: 20 });
    });
  });

  // --------------------------------------------------------------------------
  // fetchAlertCounts
  // --------------------------------------------------------------------------
  describe('fetchAlertCounts', () => {
    it('stores counts on success', async () => {
      const counts = { critical: 1, error: 2, warning: 3, info: 4 };
      (alertsApi.getAlertCounts as any).mockResolvedValue(counts);

      await useAlertsStore.getState().fetchAlertCounts();

      expect(useAlertsStore.getState().alertCounts).toEqual(counts);
    });

    it('leaves counts unchanged on error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (alertsApi.getAlertCounts as any).mockRejectedValue(new Error('x'));

      await useAlertsStore.getState().fetchAlertCounts();

      expect(useAlertsStore.getState().alertCounts).toEqual({ critical: 0, error: 0, warning: 0, info: 0 });
      errSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------
  describe('reset', () => {
    it('restores initial state', () => {
      useAlertsStore.setState({
        alerts: [makeAlert({ id: 'a' })],
        error: 'e',
        isLoading: true,
        alertCounts: { critical: 5, error: 0, warning: 0, info: 0 },
      });

      useAlertsStore.getState().reset();

      const s = useAlertsStore.getState();
      expect(s.alerts).toEqual([]);
      expect(s.error).toBeNull();
      expect(s.isLoading).toBe(false);
      expect(s.alertCounts).toEqual({ critical: 0, error: 0, warning: 0, info: 0 });
    });
  });

  // --------------------------------------------------------------------------
  // SELECTORS
  // --------------------------------------------------------------------------
  describe('selectors', () => {
    beforeEach(() => {
      useAlertsStore.setState({
        alerts: [
          makeAlert({ id: 'c', severity: 'critical', source: 'robot', sourceId: 'r1', acknowledged: false }),
          makeAlert({ id: 'w', severity: 'warning', source: 'system', acknowledged: true }),
          makeAlert({ id: 'i', severity: 'info', source: 'robot', sourceId: 'r2', acknowledged: false }),
        ],
        history: [makeAlert({ id: 'h' })],
        historyPagination: { page: 2, pageSize: 20, total: 1, totalPages: 1 },
        historyFilters: { source: ['robot'] },
        isHistoryLoading: true,
        isLoading: true,
        error: 'err',
        alertCounts: { critical: 1, error: 0, warning: 1, info: 1 },
      });
    });

    it('basic selectors', () => {
      const s = useAlertsStore.getState();
      expect(selectAlerts(s)).toHaveLength(3);
      expect(selectIsLoading(s)).toBe(true);
      expect(selectError(s)).toBe('err');
      expect(selectHistory(s).map((a) => a.id)).toEqual(['h']);
      expect(selectHistoryPagination(s).page).toBe(2);
      expect(selectHistoryFilters(s)).toEqual({ source: ['robot'] });
      expect(selectIsHistoryLoading(s)).toBe(true);
      expect(selectAlertCounts(s)).toEqual({ critical: 1, error: 0, warning: 1, info: 1 });
    });

    it('acknowledged / unacknowledged partitioning', () => {
      const s = useAlertsStore.getState();
      expect(selectUnacknowledgedAlerts(s).map((a) => a.id).sort()).toEqual(['c', 'i']);
      expect(selectAcknowledgedAlerts(s).map((a) => a.id)).toEqual(['w']);
      expect(selectUnacknowledgedCount(s)).toBe(2);
    });

    it('critical selectors', () => {
      const s = useAlertsStore.getState();
      expect(selectCriticalAlerts(s).map((a) => a.id)).toEqual(['c']);
      expect(selectUnacknowledgedCriticalAlerts(s).map((a) => a.id)).toEqual(['c']);
    });

    it('selectAlertsBySeverity / BySource / ById', () => {
      const s = useAlertsStore.getState();
      expect(selectAlertsBySeverity('info')(s).map((a) => a.id)).toEqual(['i']);
      expect(selectAlertsBySource('robot')(s).map((a) => a.id).sort()).toEqual(['c', 'i']);
      expect(selectAlertsBySource('robot', 'r2')(s).map((a) => a.id)).toEqual(['i']);
      expect(selectAlertById('w')(s)?.id).toBe('w');
      expect(selectAlertById('nope')(s)).toBeUndefined();
    });

    it('selectMostCriticalAlert returns first unacknowledged (already sorted)', () => {
      const s = useAlertsStore.getState();
      expect(selectMostCriticalAlert(s)?.id).toBe('c');
    });

    it('selectMostCriticalAlert returns undefined when all acknowledged', () => {
      useAlertsStore.setState({ alerts: [makeAlert({ id: 'a', acknowledged: true })] });
      expect(selectMostCriticalAlert(useAlertsStore.getState())).toBeUndefined();
    });
  });
});

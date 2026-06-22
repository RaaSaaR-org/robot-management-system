/**
 * @file incidentsStore.test.ts
 * @description Tests for the incidents Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useIncidentsStore,
  selectIncidents,
  selectIsLoading,
  selectError,
  selectPagination,
  selectFilters,
  selectSelectedIncident,
  selectDashboardStats,
  selectTemplates,
  selectOpenIncidents,
  selectCriticalIncidents,
  selectOpenCriticalIncidents,
  selectIncidentById,
  selectOpenIncidentCount,
  selectIncidentsWithOverdueNotifications,
} from '../incidentsStore';
import type {
  Incident,
  IncidentSeverity,
  IncidentStatus,
} from '../../types/incidents.types';

// Mock the api module the store imports
vi.mock('../../api/incidentsApi', () => ({
  incidentsApi: {
    getIncidents: vi.fn(),
    getIncident: vi.fn(),
    createIncident: vi.fn(),
    updateIncident: vi.fn(),
    deleteIncident: vi.fn(),
    getDashboardStats: vi.fn(),
    markNotificationSent: vi.fn(),
    generateNotificationContent: vi.fn(),
    getTemplates: vi.fn(),
  },
}));

import { incidentsApi } from '../../api/incidentsApi';

const mockApi = incidentsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    incidentNumber: 'INC-001',
    type: 'safety',
    severity: 'low' as IncidentSeverity,
    status: 'detected' as IncidentStatus,
    title: 'Test incident',
    description: 'desc',
    rootCause: null,
    resolution: null,
    riskScore: null,
    affectedDataSubjects: null,
    dataCategories: [],
    detectedAt: '2024-01-01T00:00:00.000Z',
    containedAt: null,
    resolvedAt: null,
    closedAt: null,
    robotId: null,
    complianceLogIds: [],
    alertIds: [],
    systemSnapshot: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdBy: null,
    ...over,
  };
}

const INITIAL = {
  incidents: [],
  isLoading: false,
  error: null,
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  filters: {},
  selectedIncident: null,
  isLoadingDetails: false,
  dashboardStats: null,
  isLoadingDashboard: false,
  templates: [],
  isLoadingTemplates: false,
};

describe('incidentsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIncidentsStore.setState({ ...INITIAL });
  });

  it('starts with the documented initial state', () => {
    const s = useIncidentsStore.getState();
    expect(s.incidents).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    expect(s.filters).toEqual({});
    expect(s.selectedIncident).toBeNull();
    expect(s.dashboardStats).toBeNull();
    expect(s.templates).toEqual([]);
  });

  describe('fetchIncidents', () => {
    it('loads incidents and updates pagination on success', async () => {
      const incidents = [makeIncident({ id: 'a' }), makeIncident({ id: 'b' })];
      mockApi.getIncidents.mockResolvedValue({
        incidents,
        total: 2,
        page: 3,
        limit: 20,
        totalPages: 1,
      });

      await useIncidentsStore.getState().fetchIncidents(3);

      const s = useIncidentsStore.getState();
      expect(mockApi.getIncidents).toHaveBeenCalledTimes(1);
      // pagination target page is the explicit page arg
      expect(mockApi.getIncidents).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ page: 3, limit: 20 })
      );
      expect(s.incidents).toEqual(incidents);
      expect(s.pagination).toEqual({ page: 3, limit: 20, total: 2, totalPages: 1 });
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('falls back to current pagination page when no page arg given', async () => {
      useIncidentsStore.setState({ pagination: { page: 5, limit: 20, total: 0, totalPages: 0 } });
      mockApi.getIncidents.mockResolvedValue({
        incidents: [],
        total: 0,
        page: 5,
        limit: 20,
        totalPages: 0,
      });

      await useIncidentsStore.getState().fetchIncidents();

      expect(mockApi.getIncidents).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ page: 5 })
      );
    });

    it('sets error and clears loading on failure', async () => {
      mockApi.getIncidents.mockRejectedValue(new Error('boom'));

      await useIncidentsStore.getState().fetchIncidents();

      const s = useIncidentsStore.getState();
      expect(s.error).toBe('boom');
      expect(s.isLoading).toBe(false);
    });

    it('uses a generic error message for non-Error rejections', async () => {
      mockApi.getIncidents.mockRejectedValue('nope');

      await useIncidentsStore.getState().fetchIncidents();

      expect(useIncidentsStore.getState().error).toBe('Failed to fetch incidents');
    });
  });

  describe('setFilters', () => {
    it('stores filters, resets page to 1, and triggers a fetch', () => {
      mockApi.getIncidents.mockResolvedValue({
        incidents: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
      useIncidentsStore.setState({ pagination: { page: 7, limit: 20, total: 0, totalPages: 0 } });

      useIncidentsStore.getState().setFilters({ severity: ['critical'] });

      const s = useIncidentsStore.getState();
      expect(s.filters).toEqual({ severity: ['critical'] });
      expect(s.pagination.page).toBe(1);
      expect(mockApi.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ severity: ['critical'] }),
        expect.objectContaining({ page: 1 })
      );
    });
  });

  describe('fetchIncident', () => {
    it('loads the selected incident on success', async () => {
      const inc = makeIncident({ id: 'sel' });
      mockApi.getIncident.mockResolvedValue(inc);

      await useIncidentsStore.getState().fetchIncident('sel');

      const s = useIncidentsStore.getState();
      expect(s.selectedIncident).toEqual(inc);
      expect(s.isLoadingDetails).toBe(false);
    });

    it('clears loading and leaves selection null on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getIncident.mockRejectedValue(new Error('fail'));

      await useIncidentsStore.getState().fetchIncident('x');

      const s = useIncidentsStore.getState();
      expect(s.selectedIncident).toBeNull();
      expect(s.isLoadingDetails).toBe(false);
      spy.mockRestore();
    });
  });

  describe('createIncident', () => {
    it('prepends, sorts by severity, and bumps total', async () => {
      const existing = makeIncident({ id: 'low', severity: 'low' });
      useIncidentsStore.setState({
        incidents: [existing],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      const created = makeIncident({ id: 'crit', severity: 'critical' });
      mockApi.createIncident.mockResolvedValue(created);

      const result = await useIncidentsStore.getState().createIncident({
        type: 'safety',
        title: 't',
        description: 'd',
      });

      const s = useIncidentsStore.getState();
      expect(result).toEqual(created);
      // critical should sort before low
      expect(s.incidents.map((i) => i.id)).toEqual(['crit', 'low']);
      expect(s.pagination.total).toBe(2);
    });
  });

  describe('updateIncident', () => {
    it('replaces incident in list and updates selection if matching', async () => {
      const orig = makeIncident({ id: 'u', severity: 'low', title: 'old' });
      useIncidentsStore.setState({ incidents: [orig], selectedIncident: orig });
      const updated = makeIncident({ id: 'u', severity: 'low', title: 'new' });
      mockApi.updateIncident.mockResolvedValue(updated);

      const result = await useIncidentsStore.getState().updateIncident('u', { title: 'new' });

      const s = useIncidentsStore.getState();
      expect(result).toEqual(updated);
      expect(s.incidents[0].title).toBe('new');
      expect(s.selectedIncident?.title).toBe('new');
    });

    it('returns null and leaves state intact on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const orig = makeIncident({ id: 'u', title: 'old' });
      useIncidentsStore.setState({ incidents: [orig] });
      mockApi.updateIncident.mockRejectedValue(new Error('nope'));

      const result = await useIncidentsStore.getState().updateIncident('u', { title: 'new' });

      expect(result).toBeNull();
      expect(useIncidentsStore.getState().incidents[0].title).toBe('old');
      spy.mockRestore();
    });
  });

  describe('deleteIncident', () => {
    it('removes incident, decrements total, clears selection if matching', async () => {
      const inc = makeIncident({ id: 'del' });
      useIncidentsStore.setState({
        incidents: [inc],
        selectedIncident: inc,
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      mockApi.deleteIncident.mockResolvedValue(undefined);

      const ok = await useIncidentsStore.getState().deleteIncident('del');

      const s = useIncidentsStore.getState();
      expect(ok).toBe(true);
      expect(s.incidents).toEqual([]);
      expect(s.pagination.total).toBe(0);
      expect(s.selectedIncident).toBeNull();
    });

    it('returns false on failure without mutating state', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const inc = makeIncident({ id: 'del' });
      useIncidentsStore.setState({ incidents: [inc] });
      mockApi.deleteIncident.mockRejectedValue(new Error('fail'));

      const ok = await useIncidentsStore.getState().deleteIncident('del');

      expect(ok).toBe(false);
      expect(useIncidentsStore.getState().incidents).toHaveLength(1);
      spy.mockRestore();
    });
  });

  describe('fetchDashboardStats', () => {
    it('stores stats on success', async () => {
      const stats = { totalIncidents: 5, openIncidents: 2 } as never;
      mockApi.getDashboardStats.mockResolvedValue(stats);

      await useIncidentsStore.getState().fetchDashboardStats();

      const s = useIncidentsStore.getState();
      expect(s.dashboardStats).toEqual(stats);
      expect(s.isLoadingDashboard).toBe(false);
    });

    it('clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getDashboardStats.mockRejectedValue(new Error('x'));

      await useIncidentsStore.getState().fetchDashboardStats();

      expect(useIncidentsStore.getState().isLoadingDashboard).toBe(false);
      spy.mockRestore();
    });
  });

  describe('markNotificationSent', () => {
    it('refreshes the selected incident when it matches', async () => {
      const inc = makeIncident({ id: 'i1' });
      useIncidentsStore.setState({ selectedIncident: inc });
      mockApi.markNotificationSent.mockResolvedValue(undefined);
      mockApi.getIncident.mockResolvedValue(makeIncident({ id: 'i1', title: 'refreshed' }));

      await useIncidentsStore.getState().markNotificationSent('i1', 'n1');

      expect(mockApi.getIncident).toHaveBeenCalledWith('i1');
      expect(useIncidentsStore.getState().selectedIncident?.title).toBe('refreshed');
    });

    it('does not refresh when selected incident does not match', async () => {
      useIncidentsStore.setState({ selectedIncident: makeIncident({ id: 'other' }) });
      mockApi.markNotificationSent.mockResolvedValue(undefined);

      await useIncidentsStore.getState().markNotificationSent('i1', 'n1');

      expect(mockApi.getIncident).not.toHaveBeenCalled();
    });

    it('swallows errors', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.markNotificationSent.mockRejectedValue(new Error('fail'));

      await expect(
        useIncidentsStore.getState().markNotificationSent('i1', 'n1')
      ).resolves.toBeUndefined();
      spy.mockRestore();
    });
  });

  describe('generateNotificationContent', () => {
    it('returns content on success', async () => {
      mockApi.generateNotificationContent.mockResolvedValue('generated text');

      const out = await useIncidentsStore
        .getState()
        .generateNotificationContent('i1', 'n1', 'tpl');

      expect(mockApi.generateNotificationContent).toHaveBeenCalledWith('i1', 'n1', 'tpl');
      expect(out).toBe('generated text');
    });

    it('returns null on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.generateNotificationContent.mockRejectedValue(new Error('fail'));

      const out = await useIncidentsStore.getState().generateNotificationContent('i1', 'n1');

      expect(out).toBeNull();
      spy.mockRestore();
    });
  });

  describe('fetchTemplates', () => {
    it('stores templates on success', async () => {
      const templates = [{ id: 't1' }] as never;
      mockApi.getTemplates.mockResolvedValue(templates);

      await useIncidentsStore.getState().fetchTemplates();

      const s = useIncidentsStore.getState();
      expect(s.templates).toEqual(templates);
      expect(s.isLoadingTemplates).toBe(false);
    });

    it('clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getTemplates.mockRejectedValue(new Error('x'));

      await useIncidentsStore.getState().fetchTemplates();

      expect(useIncidentsStore.getState().isLoadingTemplates).toBe(false);
      spy.mockRestore();
    });
  });

  describe('websocket mutations', () => {
    it('addIncidentFromWebSocket adds new incident sorted and bumps total', () => {
      useIncidentsStore.setState({
        incidents: [makeIncident({ id: 'low', severity: 'low' })],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      useIncidentsStore
        .getState()
        .addIncidentFromWebSocket(makeIncident({ id: 'high', severity: 'high' }));

      const s = useIncidentsStore.getState();
      expect(s.incidents.map((i) => i.id)).toEqual(['high', 'low']);
      expect(s.pagination.total).toBe(2);
    });

    it('addIncidentFromWebSocket ignores duplicates', () => {
      useIncidentsStore.setState({
        incidents: [makeIncident({ id: 'dup' })],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      useIncidentsStore.getState().addIncidentFromWebSocket(makeIncident({ id: 'dup' }));

      const s = useIncidentsStore.getState();
      expect(s.incidents).toHaveLength(1);
      expect(s.pagination.total).toBe(1);
    });

    it('updateIncidentFromWebSocket replaces existing and selected', () => {
      const orig = makeIncident({ id: 'w', title: 'old' });
      useIncidentsStore.setState({ incidents: [orig], selectedIncident: orig });

      useIncidentsStore
        .getState()
        .updateIncidentFromWebSocket(makeIncident({ id: 'w', title: 'new' }));

      const s = useIncidentsStore.getState();
      expect(s.incidents[0].title).toBe('new');
      expect(s.selectedIncident?.title).toBe('new');
    });

    it('updateIncidentFromWebSocket is a no-op for unknown ids', () => {
      const orig = makeIncident({ id: 'w', title: 'old' });
      useIncidentsStore.setState({ incidents: [orig] });

      useIncidentsStore
        .getState()
        .updateIncidentFromWebSocket(makeIncident({ id: 'unknown', title: 'x' }));

      expect(useIncidentsStore.getState().incidents).toEqual([orig]);
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      useIncidentsStore.setState({
        incidents: [makeIncident()],
        error: 'err',
        isLoading: true,
      });

      useIncidentsStore.getState().reset();

      const s = useIncidentsStore.getState();
      expect(s.incidents).toEqual([]);
      expect(s.error).toBeNull();
      expect(s.isLoading).toBe(false);
    });
  });

  describe('selectors', () => {
    it('basic field selectors return their slice', () => {
      const inc = makeIncident();
      useIncidentsStore.setState({
        incidents: [inc],
        isLoading: true,
        error: 'e',
        pagination: { page: 2, limit: 20, total: 1, totalPages: 1 },
        filters: { robotId: 'r1' },
        selectedIncident: inc,
        dashboardStats: { totalIncidents: 1 } as never,
        templates: [{ id: 't' }] as never,
      });
      const s = useIncidentsStore.getState();
      expect(selectIncidents(s)).toEqual([inc]);
      expect(selectIsLoading(s)).toBe(true);
      expect(selectError(s)).toBe('e');
      expect(selectPagination(s)).toEqual({ page: 2, limit: 20, total: 1, totalPages: 1 });
      expect(selectFilters(s)).toEqual({ robotId: 'r1' });
      expect(selectSelectedIncident(s)).toEqual(inc);
      expect(selectDashboardStats(s)).toEqual({ totalIncidents: 1 });
      expect(selectTemplates(s)).toEqual([{ id: 't' }]);
    });

    it('derived selectors filter by status and severity', () => {
      const incidents = [
        makeIncident({ id: 'a', severity: 'critical', status: 'detected' }),
        makeIncident({ id: 'b', severity: 'critical', status: 'closed' }),
        makeIncident({ id: 'c', severity: 'low', status: 'investigating' }),
        makeIncident({ id: 'd', severity: 'low', status: 'closed' }),
      ];
      useIncidentsStore.setState({ incidents });
      const s = useIncidentsStore.getState();

      expect(selectOpenIncidents(s).map((i) => i.id)).toEqual(['a', 'c']);
      expect(selectCriticalIncidents(s).map((i) => i.id)).toEqual(['a', 'b']);
      expect(selectOpenCriticalIncidents(s).map((i) => i.id)).toEqual(['a']);
      expect(selectOpenIncidentCount(s)).toBe(2);
      expect(selectIncidentById('c')(s)?.id).toBe('c');
      expect(selectIncidentById('zzz')(s)).toBeUndefined();
    });

    it('selectIncidentsWithOverdueNotifications matches overdue notifications', () => {
      const incidents = [
        makeIncident({
          id: 'over',
          notifications: [{ isOverdue: true } as never],
        }),
        makeIncident({
          id: 'ok',
          notifications: [{ isOverdue: false } as never],
        }),
        makeIncident({ id: 'none' }),
      ];
      useIncidentsStore.setState({ incidents });

      const result = selectIncidentsWithOverdueNotifications(useIncidentsStore.getState());
      expect(result.map((i) => i.id)).toEqual(['over']);
    });
  });
});

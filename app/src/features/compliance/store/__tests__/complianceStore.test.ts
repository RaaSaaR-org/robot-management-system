/**
 * @file complianceStore.test.ts
 * @description Tests for the compliance Zustand store
 * @feature compliance
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { useComplianceStore } from '../complianceStore';

vi.mock('../../api', () => ({
  complianceApi: {
    getLogs: vi.fn(),
    getLog: vi.fn(),
    verifyIntegrity: vi.fn(),
    getMetrics: vi.fn(),
    getRetentionPolicies: vi.fn(),
    getRetentionStats: vi.fn(),
    setRetentionPolicy: vi.fn(),
    triggerCleanup: vi.fn(),
    getLegalHolds: vi.fn(),
    createLegalHold: vi.fn(),
    releaseLegalHold: vi.fn(),
    addLogsToHold: vi.fn(),
    getRopaEntries: vi.fn(),
    getRopaEntry: vi.fn(),
    createRopaEntry: vi.fn(),
    updateRopaEntry: vi.fn(),
    deleteRopaEntry: vi.fn(),
    generateRopaReport: vi.fn(),
    exportLogs: vi.fn(),
    getProviders: vi.fn(),
    getProviderDocs: vi.fn(),
    getAllDocumentation: vi.fn(),
  },
}));

import { complianceApi } from '../../api';

const api = complianceApi as unknown as Record<string, Mock>;

const INITIAL = {
  logs: [],
  selectedLog: null,
  integrityResult: null,
  metrics: null,
  retentionPolicies: [],
  retentionStats: null,
  legalHolds: [],
  selectedLegalHold: null,
  ropaEntries: [],
  selectedRopaEntry: null,
  ropaReport: null,
  lastExportResult: null,
  providers: [],
  providerDocs: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  filters: {},
  isLoading: false,
  isLoadingLog: false,
  isVerifying: false,
  isLoadingMetrics: false,
  isLoadingRetention: false,
  isLoadingLegalHolds: false,
  isLoadingRopa: false,
  isExporting: false,
  isLoadingProviders: false,
  isCleaningUp: false,
  error: null,
};

describe('complianceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useComplianceStore.setState(INITIAL);
  });

  it('starts with the documented initial state', () => {
    const s = useComplianceStore.getState();
    expect(s.logs).toEqual([]);
    expect(s.page).toBe(1);
    expect(s.limit).toBe(20);
    expect(s.total).toBe(0);
    expect(s.filters).toEqual({});
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  // --- fetchLogs ---
  it('fetchLogs merges pagination + filters into query and stores response', async () => {
    api.getLogs.mockResolvedValue({ logs: [{ id: 'l1' }], total: 1, page: 2, totalPages: 5 });
    useComplianceStore.setState({ page: 2, limit: 10, filters: { robotId: 'r1' } });

    await useComplianceStore.getState().fetchLogs({ severity: 'high' as any });

    expect(api.getLogs).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      robotId: 'r1',
      severity: 'high',
    });
    const s = useComplianceStore.getState();
    expect(s.logs).toEqual([{ id: 'l1' }]);
    expect(s.total).toBe(1);
    expect(s.page).toBe(2);
    expect(s.totalPages).toBe(5);
    expect(s.isLoading).toBe(false);
  });

  it('fetchLogs sets error on failure and clears loading', async () => {
    api.getLogs.mockRejectedValue(new Error('boom'));
    await useComplianceStore.getState().fetchLogs();
    const s = useComplianceStore.getState();
    expect(s.error).toBe('boom');
    expect(s.isLoading).toBe(false);
    expect(s.logs).toEqual([]);
  });

  it('fetchLogs falls back to default message for non-Error throws', async () => {
    api.getLogs.mockRejectedValue('weird');
    await useComplianceStore.getState().fetchLogs();
    expect(useComplianceStore.getState().error).toBe('Failed to fetch logs');
  });

  // --- fetchLog ---
  it('fetchLog stores selected log on success', async () => {
    api.getLog.mockResolvedValue({ id: 'log-1' });
    await useComplianceStore.getState().fetchLog('log-1');
    const s = useComplianceStore.getState();
    expect(s.selectedLog).toEqual({ id: 'log-1' });
    expect(s.isLoadingLog).toBe(false);
  });

  it('fetchLog sets error on failure', async () => {
    api.getLog.mockRejectedValue(new Error('nope'));
    await useComplianceStore.getState().fetchLog('x');
    expect(useComplianceStore.getState().error).toBe('nope');
    expect(useComplianceStore.getState().isLoadingLog).toBe(false);
  });

  // --- verifyIntegrity ---
  it('verifyIntegrity stores result and passes dates', async () => {
    api.verifyIntegrity.mockResolvedValue({ valid: true } as any);
    await useComplianceStore.getState().verifyIntegrity('2024-01-01', '2024-02-01');
    expect(api.verifyIntegrity).toHaveBeenCalledWith('2024-01-01', '2024-02-01');
    expect(useComplianceStore.getState().integrityResult).toEqual({ valid: true });
    expect(useComplianceStore.getState().isVerifying).toBe(false);
  });

  it('verifyIntegrity sets error on failure', async () => {
    api.verifyIntegrity.mockRejectedValue(new Error('bad'));
    await useComplianceStore.getState().verifyIntegrity();
    expect(useComplianceStore.getState().error).toBe('bad');
    expect(useComplianceStore.getState().isVerifying).toBe(false);
  });

  // --- fetchMetrics ---
  it('fetchMetrics stores metrics on success', async () => {
    api.getMetrics.mockResolvedValue({ count: 7 } as any);
    await useComplianceStore.getState().fetchMetrics();
    expect(useComplianceStore.getState().metrics).toEqual({ count: 7 });
  });

  it('fetchMetrics sets error on failure', async () => {
    api.getMetrics.mockRejectedValue(new Error('m-err'));
    await useComplianceStore.getState().fetchMetrics();
    expect(useComplianceStore.getState().error).toBe('m-err');
    expect(useComplianceStore.getState().isLoadingMetrics).toBe(false);
  });

  // --- pagination / filter setters (trigger fetchLogs) ---
  it('setPage updates page and triggers a refetch', () => {
    api.getLogs.mockResolvedValue({ logs: [], total: 0, page: 3, totalPages: 0 });
    useComplianceStore.getState().setPage(3);
    expect(useComplianceStore.getState().page).toBe(3);
    expect(api.getLogs).toHaveBeenCalledTimes(1);
  });

  it('setLimit updates limit, resets page to 1, and refetches', () => {
    api.getLogs.mockResolvedValue({ logs: [], total: 0, page: 1, totalPages: 0 });
    useComplianceStore.setState({ page: 5 });
    useComplianceStore.getState().setLimit(50);
    expect(useComplianceStore.getState().limit).toBe(50);
    expect(useComplianceStore.getState().page).toBe(1);
    expect(api.getLogs).toHaveBeenCalledTimes(1);
  });

  it('setFilters merges filters, resets page, and refetches', () => {
    api.getLogs.mockResolvedValue({ logs: [], total: 0, page: 1, totalPages: 0 });
    useComplianceStore.setState({ filters: { robotId: 'r1' }, page: 4 });
    useComplianceStore.getState().setFilters({ severity: 'high' as any });
    const s = useComplianceStore.getState();
    expect(s.filters).toEqual({ robotId: 'r1', severity: 'high' });
    expect(s.page).toBe(1);
    expect(api.getLogs).toHaveBeenCalledTimes(1);
  });

  it('clearFilters empties filters, resets page, and refetches', () => {
    api.getLogs.mockResolvedValue({ logs: [], total: 0, page: 1, totalPages: 0 });
    useComplianceStore.setState({ filters: { robotId: 'r1' }, page: 3 });
    useComplianceStore.getState().clearFilters();
    expect(useComplianceStore.getState().filters).toEqual({});
    expect(useComplianceStore.getState().page).toBe(1);
    expect(api.getLogs).toHaveBeenCalledTimes(1);
  });

  it('clearSelectedLog and clearError reset their slices', () => {
    useComplianceStore.setState({ selectedLog: { id: 'x' } as any, error: 'e' });
    useComplianceStore.getState().clearSelectedLog();
    expect(useComplianceStore.getState().selectedLog).toBeNull();
    useComplianceStore.getState().clearError();
    expect(useComplianceStore.getState().error).toBeNull();
  });

  // --- retention ---
  it('fetchRetentionPolicies stores policies array', async () => {
    api.getRetentionPolicies.mockResolvedValue({ policies: [{ eventType: 'a' }] });
    await useComplianceStore.getState().fetchRetentionPolicies();
    expect(useComplianceStore.getState().retentionPolicies).toEqual([{ eventType: 'a' }]);
  });

  it('fetchRetentionStats sets error on failure', async () => {
    api.getRetentionStats.mockRejectedValue(new Error('rs'));
    await useComplianceStore.getState().fetchRetentionStats();
    expect(useComplianceStore.getState().error).toBe('rs');
  });

  it('setRetentionPolicy appends when eventType is new', async () => {
    api.setRetentionPolicy.mockResolvedValue({ eventType: 'b', retentionDays: 5 });
    useComplianceStore.setState({ retentionPolicies: [{ eventType: 'a' } as any] });
    await useComplianceStore.getState().setRetentionPolicy('b', 5);
    expect(api.setRetentionPolicy).toHaveBeenCalledWith('b', { retentionDays: 5, description: undefined });
    expect(useComplianceStore.getState().retentionPolicies).toEqual([
      { eventType: 'a' },
      { eventType: 'b', retentionDays: 5 },
    ]);
  });

  it('setRetentionPolicy replaces existing eventType in place', async () => {
    api.setRetentionPolicy.mockResolvedValue({ eventType: 'a', retentionDays: 99 });
    useComplianceStore.setState({
      retentionPolicies: [{ eventType: 'a', retentionDays: 1 } as any, { eventType: 'b' } as any],
    });
    await useComplianceStore.getState().setRetentionPolicy('a', 99, 'desc');
    expect(useComplianceStore.getState().retentionPolicies).toEqual([
      { eventType: 'a', retentionDays: 99 },
      { eventType: 'b' },
    ]);
  });

  it('triggerCleanup returns result and refreshes stats', async () => {
    api.triggerCleanup.mockResolvedValue({ logsDeleted: 3, logsSkipped: 1 });
    api.getRetentionStats.mockResolvedValue({ total: 10 } as any);
    const result = await useComplianceStore.getState().triggerCleanup();
    expect(result).toEqual({ logsDeleted: 3, logsSkipped: 1 });
    expect(useComplianceStore.getState().isCleaningUp).toBe(false);
    expect(api.getRetentionStats).toHaveBeenCalled();
  });

  it('triggerCleanup rethrows and sets error on failure', async () => {
    api.triggerCleanup.mockRejectedValue(new Error('cleanup-fail'));
    await expect(useComplianceStore.getState().triggerCleanup()).rejects.toThrow('cleanup-fail');
    expect(useComplianceStore.getState().error).toBe('cleanup-fail');
    expect(useComplianceStore.getState().isCleaningUp).toBe(false);
  });

  // --- legal holds ---
  it('fetchLegalHolds passes activeOnly and stores holds', async () => {
    api.getLegalHolds.mockResolvedValue({ holds: [{ id: 'h1' }] });
    await useComplianceStore.getState().fetchLegalHolds(true);
    expect(api.getLegalHolds).toHaveBeenCalledWith(true);
    expect(useComplianceStore.getState().legalHolds).toEqual([{ id: 'h1' }]);
  });

  it('createLegalHold appends hold and returns it', async () => {
    api.createLegalHold.mockResolvedValue({ id: 'h2' });
    useComplianceStore.setState({ legalHolds: [{ id: 'h1' } as any] });
    const hold = await useComplianceStore.getState().createLegalHold({} as any);
    expect(hold).toEqual({ id: 'h2' });
    expect(useComplianceStore.getState().legalHolds).toEqual([{ id: 'h1' }, { id: 'h2' }]);
  });

  it('createLegalHold rethrows on failure', async () => {
    api.createLegalHold.mockRejectedValue(new Error('clh'));
    await expect(useComplianceStore.getState().createLegalHold({} as any)).rejects.toThrow('clh');
    expect(useComplianceStore.getState().error).toBe('clh');
  });

  it('releaseLegalHold replaces matching hold with response.hold', async () => {
    api.releaseLegalHold.mockResolvedValue({ message: 'ok', hold: { id: 'h1', active: false } });
    useComplianceStore.setState({ legalHolds: [{ id: 'h1', active: true } as any, { id: 'h2' } as any] });
    await useComplianceStore.getState().releaseLegalHold('h1');
    expect(useComplianceStore.getState().legalHolds).toEqual([
      { id: 'h1', active: false },
      { id: 'h2' },
    ]);
  });

  it('addLogsToHold replaces matching hold', async () => {
    api.addLogsToHold.mockResolvedValue({ id: 'h1', logCount: 2 });
    useComplianceStore.setState({ legalHolds: [{ id: 'h1', logCount: 0 } as any] });
    await useComplianceStore.getState().addLogsToHold('h1', ['l1', 'l2']);
    expect(api.addLogsToHold).toHaveBeenCalledWith('h1', ['l1', 'l2']);
    expect(useComplianceStore.getState().legalHolds).toEqual([{ id: 'h1', logCount: 2 }]);
  });

  // --- RoPA ---
  it('fetchRopaEntries stores entries', async () => {
    api.getRopaEntries.mockResolvedValue({ entries: [{ id: 'e1' }] });
    await useComplianceStore.getState().fetchRopaEntries();
    expect(useComplianceStore.getState().ropaEntries).toEqual([{ id: 'e1' }]);
  });

  it('createRopaEntry appends entry and returns it', async () => {
    api.createRopaEntry.mockResolvedValue({ id: 'e2' });
    useComplianceStore.setState({ ropaEntries: [{ id: 'e1' } as any] });
    const entry = await useComplianceStore.getState().createRopaEntry({} as any);
    expect(entry).toEqual({ id: 'e2' });
    expect(useComplianceStore.getState().ropaEntries).toEqual([{ id: 'e1' }, { id: 'e2' }]);
  });

  it('updateRopaEntry replaces entry and updates selected when matching', async () => {
    api.updateRopaEntry.mockResolvedValue({ id: 'e1', name: 'new' });
    useComplianceStore.setState({
      ropaEntries: [{ id: 'e1', name: 'old' } as any],
      selectedRopaEntry: { id: 'e1', name: 'old' } as any,
    });
    await useComplianceStore.getState().updateRopaEntry('e1', {});
    expect(useComplianceStore.getState().ropaEntries).toEqual([{ id: 'e1', name: 'new' }]);
    expect(useComplianceStore.getState().selectedRopaEntry).toEqual({ id: 'e1', name: 'new' });
  });

  it('updateRopaEntry leaves selected untouched when ids differ', async () => {
    api.updateRopaEntry.mockResolvedValue({ id: 'e1', name: 'new' });
    useComplianceStore.setState({
      ropaEntries: [{ id: 'e1' } as any],
      selectedRopaEntry: { id: 'e9' } as any,
    });
    await useComplianceStore.getState().updateRopaEntry('e1', {});
    expect(useComplianceStore.getState().selectedRopaEntry).toEqual({ id: 'e9' });
  });

  it('deleteRopaEntry removes entry and clears selected when matching', async () => {
    api.deleteRopaEntry.mockResolvedValue(undefined);
    useComplianceStore.setState({
      ropaEntries: [{ id: 'e1' } as any, { id: 'e2' } as any],
      selectedRopaEntry: { id: 'e1' } as any,
    });
    await useComplianceStore.getState().deleteRopaEntry('e1');
    expect(useComplianceStore.getState().ropaEntries).toEqual([{ id: 'e2' }]);
    expect(useComplianceStore.getState().selectedRopaEntry).toBeNull();
  });

  it('deleteRopaEntry rethrows on failure', async () => {
    api.deleteRopaEntry.mockRejectedValue(new Error('del'));
    useComplianceStore.setState({ ropaEntries: [{ id: 'e1' } as any] });
    await expect(useComplianceStore.getState().deleteRopaEntry('e1')).rejects.toThrow('del');
    expect(useComplianceStore.getState().ropaEntries).toEqual([{ id: 'e1' }]);
  });

  it('generateRopaReport stores report', async () => {
    api.generateRopaReport.mockResolvedValue({ org: 'Acme' } as any);
    await useComplianceStore.getState().generateRopaReport('Acme');
    expect(api.generateRopaReport).toHaveBeenCalledWith('Acme');
    expect(useComplianceStore.getState().ropaReport).toEqual({ org: 'Acme' });
  });

  it('clearSelectedRopaEntry resets selected entry', () => {
    useComplianceStore.setState({ selectedRopaEntry: { id: 'e1' } as any });
    useComplianceStore.getState().clearSelectedRopaEntry();
    expect(useComplianceStore.getState().selectedRopaEntry).toBeNull();
  });

  // --- export ---
  it('exportLogs stores result and returns it', async () => {
    api.exportLogs.mockResolvedValue({ url: 'x' });
    const r = await useComplianceStore.getState().exportLogs({} as any);
    expect(r).toEqual({ url: 'x' });
    expect(useComplianceStore.getState().lastExportResult).toEqual({ url: 'x' });
    expect(useComplianceStore.getState().isExporting).toBe(false);
  });

  it('exportLogs rethrows and sets error on failure', async () => {
    api.exportLogs.mockRejectedValue(new Error('exp'));
    await expect(useComplianceStore.getState().exportLogs({} as any)).rejects.toThrow('exp');
    expect(useComplianceStore.getState().error).toBe('exp');
  });

  it('clearExportResult resets last export result', () => {
    useComplianceStore.setState({ lastExportResult: { url: 'x' } as any });
    useComplianceStore.getState().clearExportResult();
    expect(useComplianceStore.getState().lastExportResult).toBeNull();
  });

  // --- providers ---
  it('fetchProviders stores providers', async () => {
    api.getProviders.mockResolvedValue({ providers: [{ name: 'p1' }] });
    await useComplianceStore.getState().fetchProviders();
    expect(useComplianceStore.getState().providers).toEqual([{ name: 'p1' }]);
  });

  it('fetchProviderDocs stores documentation for provider', async () => {
    api.getProviderDocs.mockResolvedValue({ documentation: [{ id: 'd1' }] });
    await useComplianceStore.getState().fetchProviderDocs('p1');
    expect(api.getProviderDocs).toHaveBeenCalledWith('p1');
    expect(useComplianceStore.getState().providerDocs).toEqual([{ id: 'd1' }]);
  });

  it('fetchAllDocumentation stores all documentation', async () => {
    api.getAllDocumentation.mockResolvedValue({ documentation: [{ id: 'd1' }, { id: 'd2' }] });
    await useComplianceStore.getState().fetchAllDocumentation();
    expect(useComplianceStore.getState().providerDocs).toHaveLength(2);
  });

  it('fetchAllDocumentation sets error on failure', async () => {
    api.getAllDocumentation.mockRejectedValue(new Error('docs'));
    await useComplianceStore.getState().fetchAllDocumentation();
    expect(useComplianceStore.getState().error).toBe('docs');
    expect(useComplianceStore.getState().isLoadingProviders).toBe(false);
  });
});

/**
 * @file complianceTrackerStore.test.ts
 * @description Tests for the compliance tracker Zustand store
 * @feature compliance
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { useComplianceTrackerStore } from '../complianceTrackerStore';

vi.mock('../../api', () => ({
  complianceTrackerApi: {
    getDashboardStats: vi.fn(),
    getRegulatoryDeadlines: vi.fn(),
    getGaps: vi.fn(),
    getGapSummary: vi.fn(),
    getExpiringDocuments: vi.fn(),
    getTrainingRecords: vi.fn(),
    getTrainingSummary: vi.fn(),
    getInspectionSchedules: vi.fn(),
    getInspectionSummary: vi.fn(),
    getRiskAssessments: vi.fn(),
    getRecentActivity: vi.fn(),
    closeGap: vi.fn(),
    updateDeadlineProgress: vi.fn(),
  },
}));

import { complianceTrackerApi } from '../../api';

const api = complianceTrackerApi as unknown as Record<string, Mock>;

const INITIAL = {
  dashboardStats: null,
  isLoadingDashboard: false,
  deadlines: [],
  isLoadingDeadlines: false,
  gaps: [],
  gapSummary: null,
  isLoadingGaps: false,
  gapFilters: {},
  expiringDocuments: [],
  isLoadingDocuments: false,
  trainingRecords: [],
  trainingSummary: null,
  isLoadingTraining: false,
  inspectionSchedules: [],
  inspectionSummary: null,
  isLoadingInspections: false,
  riskAssessments: [],
  isLoadingRiskAssessments: false,
  recentActivity: [],
  isLoadingActivity: false,
  error: null,
};

describe('complianceTrackerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useComplianceTrackerStore.setState(INITIAL);
  });

  it('starts with initial state', () => {
    const s = useComplianceTrackerStore.getState();
    expect(s.dashboardStats).toBeNull();
    expect(s.deadlines).toEqual([]);
    expect(s.gaps).toEqual([]);
    expect(s.gapFilters).toEqual({});
    expect(s.error).toBeNull();
  });

  it('fetchDashboardStats stores stats and clears loading', async () => {
    api.getDashboardStats.mockResolvedValue({ score: 90 });
    await useComplianceTrackerStore.getState().fetchDashboardStats();
    expect(useComplianceTrackerStore.getState().dashboardStats).toEqual({ score: 90 });
    expect(useComplianceTrackerStore.getState().isLoadingDashboard).toBe(false);
  });

  it('fetchDashboardStats sets error on failure', async () => {
    api.getDashboardStats.mockRejectedValue(new Error('ds'));
    await useComplianceTrackerStore.getState().fetchDashboardStats();
    expect(useComplianceTrackerStore.getState().error).toBe('ds');
    expect(useComplianceTrackerStore.getState().isLoadingDashboard).toBe(false);
  });

  it('fetchRegulatoryDeadlines stores deadlines', async () => {
    api.getRegulatoryDeadlines.mockResolvedValue([{ id: 'd1' }]);
    await useComplianceTrackerStore.getState().fetchRegulatoryDeadlines();
    expect(useComplianceTrackerStore.getState().deadlines).toEqual([{ id: 'd1' }]);
  });

  it('fetchRegulatoryDeadlines sets error on failure', async () => {
    api.getRegulatoryDeadlines.mockRejectedValue('x');
    await useComplianceTrackerStore.getState().fetchRegulatoryDeadlines();
    expect(useComplianceTrackerStore.getState().error).toBe('Failed to fetch deadlines');
  });

  it('fetchGaps uses provided filters and persists them', async () => {
    api.getGaps.mockResolvedValue([{ id: 'g1' }]);
    await useComplianceTrackerStore.getState().fetchGaps({ severity: 'high' as any });
    expect(api.getGaps).toHaveBeenCalledWith({ severity: 'high' });
    expect(useComplianceTrackerStore.getState().gaps).toEqual([{ id: 'g1' }]);
    expect(useComplianceTrackerStore.getState().gapFilters).toEqual({ severity: 'high' });
  });

  it('fetchGaps falls back to existing gapFilters when none provided', async () => {
    api.getGaps.mockResolvedValue([]);
    useComplianceTrackerStore.setState({ gapFilters: { framework: 'eu_ai_act' as any } });
    await useComplianceTrackerStore.getState().fetchGaps();
    expect(api.getGaps).toHaveBeenCalledWith({ framework: 'eu_ai_act' });
  });

  it('fetchGaps sets error on failure', async () => {
    api.getGaps.mockRejectedValue(new Error('g-err'));
    await useComplianceTrackerStore.getState().fetchGaps();
    expect(useComplianceTrackerStore.getState().error).toBe('g-err');
    expect(useComplianceTrackerStore.getState().isLoadingGaps).toBe(false);
  });

  it('fetchGapSummary stores summary on success', async () => {
    api.getGapSummary.mockResolvedValue({ eu_ai_act: { total: 2 } });
    await useComplianceTrackerStore.getState().fetchGapSummary();
    expect(useComplianceTrackerStore.getState().gapSummary).toEqual({ eu_ai_act: { total: 2 } });
  });

  it('fetchGapSummary swallows errors (logs, no throw, no error state)', async () => {
    api.getGapSummary.mockRejectedValue(new Error('silent'));
    await useComplianceTrackerStore.getState().fetchGapSummary();
    expect(useComplianceTrackerStore.getState().gapSummary).toBeNull();
    expect(useComplianceTrackerStore.getState().error).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('setGapFilters merges filters and refetches gaps with merged value', async () => {
    api.getGaps.mockResolvedValue([]);
    useComplianceTrackerStore.setState({ gapFilters: { framework: 'eu_ai_act' as any } });
    useComplianceTrackerStore.getState().setGapFilters({ severity: 'low' as any });
    expect(useComplianceTrackerStore.getState().gapFilters).toEqual({
      framework: 'eu_ai_act',
      severity: 'low',
    });
    expect(api.getGaps).toHaveBeenCalledWith({ framework: 'eu_ai_act', severity: 'low' });
  });

  it('fetchExpiringDocuments defaults withinDays to 90', async () => {
    api.getExpiringDocuments.mockResolvedValue([{ id: 'doc1' }]);
    await useComplianceTrackerStore.getState().fetchExpiringDocuments();
    expect(api.getExpiringDocuments).toHaveBeenCalledWith(90);
    expect(useComplianceTrackerStore.getState().expiringDocuments).toEqual([{ id: 'doc1' }]);
  });

  it('fetchExpiringDocuments passes custom withinDays', async () => {
    api.getExpiringDocuments.mockResolvedValue([]);
    await useComplianceTrackerStore.getState().fetchExpiringDocuments(30);
    expect(api.getExpiringDocuments).toHaveBeenCalledWith(30);
  });

  it('fetchExpiringDocuments sets error on failure', async () => {
    api.getExpiringDocuments.mockRejectedValue(new Error('doc-err'));
    await useComplianceTrackerStore.getState().fetchExpiringDocuments();
    expect(useComplianceTrackerStore.getState().error).toBe('doc-err');
    expect(useComplianceTrackerStore.getState().isLoadingDocuments).toBe(false);
  });

  it('fetchTrainingRecords stores records', async () => {
    api.getTrainingRecords.mockResolvedValue([{ id: 't1' }]);
    await useComplianceTrackerStore.getState().fetchTrainingRecords();
    expect(useComplianceTrackerStore.getState().trainingRecords).toEqual([{ id: 't1' }]);
  });

  it('fetchTrainingSummary swallows errors', async () => {
    api.getTrainingSummary.mockRejectedValue(new Error('ts'));
    await useComplianceTrackerStore.getState().fetchTrainingSummary();
    expect(useComplianceTrackerStore.getState().trainingSummary).toBeNull();
    expect(useComplianceTrackerStore.getState().error).toBeNull();
  });

  it('fetchInspectionSchedules stores schedules', async () => {
    api.getInspectionSchedules.mockResolvedValue([{ id: 'i1' }]);
    await useComplianceTrackerStore.getState().fetchInspectionSchedules();
    expect(useComplianceTrackerStore.getState().inspectionSchedules).toEqual([{ id: 'i1' }]);
  });

  it('fetchInspectionSummary swallows errors', async () => {
    api.getInspectionSummary.mockRejectedValue(new Error('is'));
    await useComplianceTrackerStore.getState().fetchInspectionSummary();
    expect(useComplianceTrackerStore.getState().inspectionSummary).toBeNull();
  });

  it('fetchRiskAssessments stores assessments', async () => {
    api.getRiskAssessments.mockResolvedValue([{ id: 'ra1' }]);
    await useComplianceTrackerStore.getState().fetchRiskAssessments();
    expect(useComplianceTrackerStore.getState().riskAssessments).toEqual([{ id: 'ra1' }]);
  });

  it('fetchRecentActivity defaults limit to 20', async () => {
    api.getRecentActivity.mockResolvedValue([{ id: 'a1' }]);
    await useComplianceTrackerStore.getState().fetchRecentActivity();
    expect(api.getRecentActivity).toHaveBeenCalledWith(20);
    expect(useComplianceTrackerStore.getState().recentActivity).toEqual([{ id: 'a1' }]);
  });

  it('fetchRecentActivity passes custom limit and sets error on failure', async () => {
    api.getRecentActivity.mockRejectedValue(new Error('act'));
    await useComplianceTrackerStore.getState().fetchRecentActivity(5);
    expect(api.getRecentActivity).toHaveBeenCalledWith(5);
    expect(useComplianceTrackerStore.getState().error).toBe('act');
  });

  it('closeGap refreshes gaps, summary, and dashboard on success', async () => {
    api.closeGap.mockResolvedValue(undefined);
    api.getGaps.mockResolvedValue([]);
    api.getGapSummary.mockResolvedValue({});
    api.getDashboardStats.mockResolvedValue({});
    await useComplianceTrackerStore.getState().closeGap('g1', 'alice');
    expect(api.closeGap).toHaveBeenCalledWith('g1', 'alice');
    expect(api.getGaps).toHaveBeenCalled();
    expect(api.getGapSummary).toHaveBeenCalled();
    expect(api.getDashboardStats).toHaveBeenCalled();
  });

  it('closeGap sets error and rethrows on failure', async () => {
    api.closeGap.mockRejectedValue(new Error('close-fail'));
    await expect(useComplianceTrackerStore.getState().closeGap('g1', 'bob')).rejects.toThrow('close-fail');
    expect(useComplianceTrackerStore.getState().error).toBe('close-fail');
    expect(api.getGaps).not.toHaveBeenCalled();
  });

  it('updateDeadlineProgress refreshes deadlines and dashboard on success', async () => {
    api.updateDeadlineProgress.mockResolvedValue(undefined);
    api.getRegulatoryDeadlines.mockResolvedValue([]);
    api.getDashboardStats.mockResolvedValue({});
    await useComplianceTrackerStore.getState().updateDeadlineProgress('d1', ['r1']);
    expect(api.updateDeadlineProgress).toHaveBeenCalledWith('d1', ['r1']);
    expect(api.getRegulatoryDeadlines).toHaveBeenCalled();
    expect(api.getDashboardStats).toHaveBeenCalled();
  });

  it('updateDeadlineProgress sets error and rethrows on failure', async () => {
    api.updateDeadlineProgress.mockRejectedValue(new Error('upd-fail'));
    await expect(
      useComplianceTrackerStore.getState().updateDeadlineProgress('d1', [])
    ).rejects.toThrow('upd-fail');
    expect(useComplianceTrackerStore.getState().error).toBe('upd-fail');
  });

  it('refreshAll invokes all the parallel fetchers', async () => {
    api.getDashboardStats.mockResolvedValue({});
    api.getRegulatoryDeadlines.mockResolvedValue([]);
    api.getGaps.mockResolvedValue([]);
    api.getGapSummary.mockResolvedValue({});
    api.getExpiringDocuments.mockResolvedValue([]);
    api.getTrainingSummary.mockResolvedValue({});
    api.getInspectionSummary.mockResolvedValue({});
    api.getRecentActivity.mockResolvedValue([]);

    await useComplianceTrackerStore.getState().refreshAll();

    expect(api.getDashboardStats).toHaveBeenCalled();
    expect(api.getRegulatoryDeadlines).toHaveBeenCalled();
    expect(api.getGaps).toHaveBeenCalled();
    expect(api.getGapSummary).toHaveBeenCalled();
    expect(api.getExpiringDocuments).toHaveBeenCalled();
    expect(api.getTrainingSummary).toHaveBeenCalled();
    expect(api.getInspectionSummary).toHaveBeenCalled();
    expect(api.getRecentActivity).toHaveBeenCalled();
  });

  it('clearError resets error', () => {
    useComplianceTrackerStore.setState({ error: 'boom' });
    useComplianceTrackerStore.getState().clearError();
    expect(useComplianceTrackerStore.getState().error).toBeNull();
  });
});

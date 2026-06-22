/**
 * @file approvalsStore.test.ts
 * @description Tests for the approvals Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useApprovalsStore } from '../approvalsStore';
import type { ApprovalRequest, DecisionContest } from '../../types';

vi.mock('../../api', () => ({
  approvalsApi: {
    getApprovalRequests: vi.fn(),
    getApprovalRequest: vi.fn(),
    createApprovalRequest: vi.fn(),
    getPendingApprovalsForMe: vi.fn(),
    getPendingApprovalsByRole: vi.fn(),
    getOverdueApprovals: vi.fn(),
    getApprovalsNearingDeadline: vi.fn(),
    processApproval: vi.fn(),
    cancelApprovalRequest: vi.fn(),
    escalateApprovalRequest: vi.fn(),
    submitWorkerViewpoint: vi.fn(),
    acknowledgeViewpoint: vi.fn(),
    getContests: vi.fn(),
    contestDecision: vi.fn(),
    processContest: vi.fn(),
    getMetrics: vi.fn(),
    getSLAComplianceReport: vi.fn(),
    getMeaningfulOversightMetrics: vi.fn(),
  },
}));

import { approvalsApi } from '../../api';

const mockApi = approvalsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRequest(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req-1',
    status: 'pending',
    ...over,
  } as ApprovalRequest;
}

function makeContest(over: Partial<DecisionContest> = {}): DecisionContest {
  return {
    id: 'c-1',
    status: 'pending',
    ...over,
  } as DecisionContest;
}

const INITIAL = {
  approvalRequests: [],
  approvalRequestsLoading: false,
  approvalRequestsError: null,
  approvalRequestsTotal: 0,
  approvalRequestsPage: 1,
  pendingApprovals: [],
  pendingApprovalsLoading: false,
  overdueApprovals: [],
  nearingDeadlineApprovals: [],
  selectedRequest: null,
  selectedRequestLoading: false,
  metrics: null,
  metricsLoading: false,
  slaReport: null,
  slaReportLoading: false,
  oversightMetrics: null,
  oversightMetricsLoading: false,
  contests: [],
  contestsLoading: false,
  contestsTotal: 0,
  contestsPage: 1,
  filters: {},
};

describe('approvalsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApprovalsStore.setState({ ...INITIAL });
  });

  it('starts with the documented initial state', () => {
    const s = useApprovalsStore.getState();
    expect(s.approvalRequests).toEqual([]);
    expect(s.approvalRequestsTotal).toBe(0);
    expect(s.approvalRequestsPage).toBe(1);
    expect(s.pendingApprovals).toEqual([]);
    expect(s.selectedRequest).toBeNull();
    expect(s.metrics).toBeNull();
    expect(s.contests).toEqual([]);
    expect(s.filters).toEqual({});
  });

  describe('fetchApprovalRequests', () => {
    it('merges stored filters, stores results on success', async () => {
      useApprovalsStore.setState({ filters: { workerId: 'w1' } as never });
      mockApi.getApprovalRequests.mockResolvedValue({
        requests: [makeRequest({ id: 'a' })],
        total: 1,
        page: 2,
        limit: 20,
      });

      await useApprovalsStore.getState().fetchApprovalRequests({ status: 'pending' } as never);

      expect(mockApi.getApprovalRequests).toHaveBeenCalledWith(
        expect.objectContaining({ workerId: 'w1', status: 'pending' })
      );
      const s = useApprovalsStore.getState();
      expect(s.approvalRequests.map((r) => r.id)).toEqual(['a']);
      expect(s.approvalRequestsTotal).toBe(1);
      expect(s.approvalRequestsPage).toBe(2);
      expect(s.approvalRequestsLoading).toBe(false);
      expect(s.approvalRequestsError).toBeNull();
    });

    it('sets error and clears loading on failure', async () => {
      mockApi.getApprovalRequests.mockRejectedValue(new Error('boom'));

      await useApprovalsStore.getState().fetchApprovalRequests();

      const s = useApprovalsStore.getState();
      expect(s.approvalRequestsError).toBe('boom');
      expect(s.approvalRequestsLoading).toBe(false);
    });

    it('uses generic message for non-Error rejection', async () => {
      mockApi.getApprovalRequests.mockRejectedValue('nope');

      await useApprovalsStore.getState().fetchApprovalRequests();

      expect(useApprovalsStore.getState().approvalRequestsError).toBe('Failed to fetch approvals');
    });
  });

  describe('fetchPendingApprovals', () => {
    it('stores pending approvals on success', async () => {
      mockApi.getPendingApprovalsForMe.mockResolvedValue([makeRequest({ id: 'p' })]);

      await useApprovalsStore.getState().fetchPendingApprovals('user-1');

      expect(mockApi.getPendingApprovalsForMe).toHaveBeenCalledWith('user-1');
      const s = useApprovalsStore.getState();
      expect(s.pendingApprovals.map((r) => r.id)).toEqual(['p']);
      expect(s.pendingApprovalsLoading).toBe(false);
    });

    it('clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getPendingApprovalsForMe.mockRejectedValue(new Error('x'));

      await useApprovalsStore.getState().fetchPendingApprovals();

      expect(useApprovalsStore.getState().pendingApprovalsLoading).toBe(false);
      spy.mockRestore();
    });
  });

  describe('fetchPendingApprovalsByRole', () => {
    it('stores by role on success', async () => {
      mockApi.getPendingApprovalsByRole.mockResolvedValue([makeRequest({ id: 'role' })]);

      await useApprovalsStore.getState().fetchPendingApprovalsByRole('safety_officer' as never);

      expect(mockApi.getPendingApprovalsByRole).toHaveBeenCalledWith('safety_officer');
      expect(useApprovalsStore.getState().pendingApprovals.map((r) => r.id)).toEqual(['role']);
    });

    it('clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getPendingApprovalsByRole.mockRejectedValue(new Error('x'));

      await useApprovalsStore.getState().fetchPendingApprovalsByRole('safety_officer' as never);

      expect(useApprovalsStore.getState().pendingApprovalsLoading).toBe(false);
      spy.mockRestore();
    });
  });

  describe('fetchOverdueApprovals / fetchNearingDeadlineApprovals', () => {
    it('stores overdue approvals on success', async () => {
      mockApi.getOverdueApprovals.mockResolvedValue([makeRequest({ id: 'o' })]);

      await useApprovalsStore.getState().fetchOverdueApprovals();

      expect(useApprovalsStore.getState().overdueApprovals.map((r) => r.id)).toEqual(['o']);
    });

    it('swallows overdue failure without throwing', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getOverdueApprovals.mockRejectedValue(new Error('x'));

      await expect(useApprovalsStore.getState().fetchOverdueApprovals()).resolves.toBeUndefined();
      expect(useApprovalsStore.getState().overdueApprovals).toEqual([]);
      spy.mockRestore();
    });

    it('stores nearing deadline approvals with default window', async () => {
      mockApi.getApprovalsNearingDeadline.mockResolvedValue([makeRequest({ id: 'n' })]);

      await useApprovalsStore.getState().fetchNearingDeadlineApprovals();

      expect(mockApi.getApprovalsNearingDeadline).toHaveBeenCalledWith(4);
      expect(useApprovalsStore.getState().nearingDeadlineApprovals.map((r) => r.id)).toEqual(['n']);
    });

    it('honors custom window and swallows failures', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getApprovalsNearingDeadline.mockRejectedValue(new Error('x'));

      await useApprovalsStore.getState().fetchNearingDeadlineApprovals(8);

      expect(mockApi.getApprovalsNearingDeadline).toHaveBeenCalledWith(8);
      spy.mockRestore();
    });
  });

  describe('selectRequest / refreshSelectedRequest', () => {
    it('clears selection when id is null without calling api', async () => {
      useApprovalsStore.setState({ selectedRequest: makeRequest({ id: 'x' }) });

      await useApprovalsStore.getState().selectRequest(null);

      expect(useApprovalsStore.getState().selectedRequest).toBeNull();
      expect(mockApi.getApprovalRequest).not.toHaveBeenCalled();
    });

    it('loads the request on success', async () => {
      mockApi.getApprovalRequest.mockResolvedValue(makeRequest({ id: 'sel' }));

      await useApprovalsStore.getState().selectRequest('sel');

      const s = useApprovalsStore.getState();
      expect(s.selectedRequest?.id).toBe('sel');
      expect(s.selectedRequestLoading).toBe(false);
    });

    it('clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getApprovalRequest.mockRejectedValue(new Error('x'));

      await useApprovalsStore.getState().selectRequest('sel');

      expect(useApprovalsStore.getState().selectedRequestLoading).toBe(false);
      spy.mockRestore();
    });

    it('refreshSelectedRequest reloads the current id', async () => {
      useApprovalsStore.setState({ selectedRequest: makeRequest({ id: 'cur' }) });
      mockApi.getApprovalRequest.mockResolvedValue(makeRequest({ id: 'cur', status: 'approved' }));

      await useApprovalsStore.getState().refreshSelectedRequest();

      expect(mockApi.getApprovalRequest).toHaveBeenCalledWith('cur');
      expect(useApprovalsStore.getState().selectedRequest?.status).toBe('approved');
    });

    it('refreshSelectedRequest is a no-op with no selection', async () => {
      await useApprovalsStore.getState().refreshSelectedRequest();
      expect(mockApi.getApprovalRequest).not.toHaveBeenCalled();
    });
  });

  describe('createApprovalRequest', () => {
    it('prepends new request and increments total', async () => {
      useApprovalsStore.setState({
        approvalRequests: [makeRequest({ id: 'old' })],
        approvalRequestsTotal: 1,
      });
      const created = makeRequest({ id: 'new' });
      mockApi.createApprovalRequest.mockResolvedValue(created);

      const result = await useApprovalsStore.getState().createApprovalRequest({} as never);

      const s = useApprovalsStore.getState();
      expect(result).toEqual(created);
      expect(s.approvalRequests.map((r) => r.id)).toEqual(['new', 'old']);
      expect(s.approvalRequestsTotal).toBe(2);
    });
  });

  describe('processApproval', () => {
    it('updates list and removes from pending when resolved', async () => {
      const req = makeRequest({ id: 'pr', status: 'pending' });
      useApprovalsStore.setState({
        approvalRequests: [req],
        pendingApprovals: [req],
        selectedRequest: req,
      });
      const updated = makeRequest({ id: 'pr', status: 'approved' });
      mockApi.processApproval.mockResolvedValue(updated);

      const result = await useApprovalsStore
        .getState()
        .processApproval('pr', 'step-1', {} as never);

      const s = useApprovalsStore.getState();
      expect(result).toEqual(updated);
      expect(s.approvalRequests[0].status).toBe('approved');
      // approved -> removed from pending
      expect(s.pendingApprovals).toEqual([]);
      expect(s.selectedRequest?.status).toBe('approved');
    });

    it('keeps request in pending when still in_progress', async () => {
      const req = makeRequest({ id: 'pr', status: 'pending' });
      useApprovalsStore.setState({ approvalRequests: [req], pendingApprovals: [req] });
      mockApi.processApproval.mockResolvedValue(makeRequest({ id: 'pr', status: 'in_progress' }));

      await useApprovalsStore.getState().processApproval('pr', 'step-1', {} as never);

      expect(useApprovalsStore.getState().pendingApprovals.map((r) => r.id)).toEqual(['pr']);
    });
  });

  describe('cancelApprovalRequest', () => {
    it('updates list, removes from pending, updates selection', async () => {
      const req = makeRequest({ id: 'cr', status: 'pending' });
      useApprovalsStore.setState({
        approvalRequests: [req],
        pendingApprovals: [req],
        selectedRequest: req,
      });
      mockApi.cancelApprovalRequest.mockResolvedValue(makeRequest({ id: 'cr', status: 'cancelled' }));

      await useApprovalsStore.getState().cancelApprovalRequest('cr', 'me', 'reason');

      expect(mockApi.cancelApprovalRequest).toHaveBeenCalledWith('cr', 'me', 'reason');
      const s = useApprovalsStore.getState();
      expect(s.approvalRequests[0].status).toBe('cancelled');
      expect(s.pendingApprovals).toEqual([]);
      expect(s.selectedRequest?.status).toBe('cancelled');
    });
  });

  describe('escalateApprovalRequest', () => {
    it('updates list and selection', async () => {
      const req = makeRequest({ id: 'er', status: 'pending' });
      useApprovalsStore.setState({ approvalRequests: [req], selectedRequest: req });
      mockApi.escalateApprovalRequest.mockResolvedValue(makeRequest({ id: 'er', status: 'escalated' }));

      const result = await useApprovalsStore.getState().escalateApprovalRequest('er', 'me', 'why');

      expect(mockApi.escalateApprovalRequest).toHaveBeenCalledWith('er', 'me', 'why');
      expect(result.status).toBe('escalated');
      const s = useApprovalsStore.getState();
      expect(s.approvalRequests[0].status).toBe('escalated');
      expect(s.selectedRequest?.status).toBe('escalated');
    });
  });

  describe('worker rights', () => {
    it('submitWorkerViewpoint refreshes selected request when it matches', async () => {
      useApprovalsStore.setState({ selectedRequest: makeRequest({ id: 'wr' }) });
      mockApi.submitWorkerViewpoint.mockResolvedValue({ id: 'vp' } as never);
      mockApi.getApprovalRequest.mockResolvedValue(makeRequest({ id: 'wr', status: 'in_progress' }));

      const vp = await useApprovalsStore.getState().submitWorkerViewpoint('wr', {} as never);

      expect(vp).toEqual({ id: 'vp' });
      expect(mockApi.getApprovalRequest).toHaveBeenCalledWith('wr');
    });

    it('submitWorkerViewpoint skips refresh when selection differs', async () => {
      useApprovalsStore.setState({ selectedRequest: makeRequest({ id: 'other' }) });
      mockApi.submitWorkerViewpoint.mockResolvedValue({ id: 'vp' } as never);

      await useApprovalsStore.getState().submitWorkerViewpoint('wr', {} as never);

      expect(mockApi.getApprovalRequest).not.toHaveBeenCalled();
    });

    it('acknowledgeViewpoint refreshes matching selection', async () => {
      useApprovalsStore.setState({ selectedRequest: makeRequest({ id: 'ack' }) });
      mockApi.acknowledgeViewpoint.mockResolvedValue({ id: 'vp' } as never);
      mockApi.getApprovalRequest.mockResolvedValue(makeRequest({ id: 'ack' }));

      const vp = await useApprovalsStore.getState().acknowledgeViewpoint('ack', 'mgr');

      expect(vp).toEqual({ id: 'vp' });
      expect(mockApi.acknowledgeViewpoint).toHaveBeenCalledWith('ack', 'mgr');
      expect(mockApi.getApprovalRequest).toHaveBeenCalledWith('ack');
    });
  });

  describe('contests', () => {
    it('fetchContests stores list on success', async () => {
      mockApi.getContests.mockResolvedValue({
        contests: [makeContest({ id: 'k' })],
        total: 1,
        page: 3,
        limit: 20,
      });

      await useApprovalsStore.getState().fetchContests();

      const s = useApprovalsStore.getState();
      expect(s.contests.map((c) => c.id)).toEqual(['k']);
      expect(s.contestsTotal).toBe(1);
      expect(s.contestsPage).toBe(3);
      expect(s.contestsLoading).toBe(false);
    });

    it('fetchContests clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getContests.mockRejectedValue(new Error('x'));

      await useApprovalsStore.getState().fetchContests();

      expect(useApprovalsStore.getState().contestsLoading).toBe(false);
      spy.mockRestore();
    });

    it('contestDecision prepends contest and bumps total', async () => {
      useApprovalsStore.setState({
        contests: [makeContest({ id: 'old' })],
        contestsTotal: 1,
      });
      mockApi.contestDecision.mockResolvedValue(makeContest({ id: 'new' }));

      const result = await useApprovalsStore.getState().contestDecision('dec-1', {} as never);

      const s = useApprovalsStore.getState();
      expect(result.id).toBe('new');
      expect(s.contests.map((c) => c.id)).toEqual(['new', 'old']);
      expect(s.contestsTotal).toBe(2);
    });

    it('processContest updates the matching contest', async () => {
      useApprovalsStore.setState({
        contests: [makeContest({ id: 'pc', status: 'submitted' })],
      });
      mockApi.processContest.mockResolvedValue(makeContest({ id: 'pc', status: 'decision_upheld' }));

      const result = await useApprovalsStore.getState().processContest('pc', {} as never);

      expect(result.status).toBe('decision_upheld');
      expect(useApprovalsStore.getState().contests[0].status).toBe('decision_upheld');
    });
  });

  describe('metrics', () => {
    it('fetchMetrics stores metrics on success', async () => {
      mockApi.getMetrics.mockResolvedValue({ totalRequests: 7 } as never);

      await useApprovalsStore.getState().fetchMetrics();

      const s = useApprovalsStore.getState();
      expect(s.metrics).toEqual({ totalRequests: 7 });
      expect(s.metricsLoading).toBe(false);
    });

    it('fetchMetrics clears loading on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getMetrics.mockRejectedValue(new Error('x'));

      await useApprovalsStore.getState().fetchMetrics();

      expect(useApprovalsStore.getState().metricsLoading).toBe(false);
      spy.mockRestore();
    });

    it('fetchSLAReport stores report on success and clears loading on failure', async () => {
      mockApi.getSLAComplianceReport.mockResolvedValue({ ok: true } as never);
      await useApprovalsStore.getState().fetchSLAReport();
      expect(useApprovalsStore.getState().slaReport).toEqual({ ok: true });
      expect(useApprovalsStore.getState().slaReportLoading).toBe(false);

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getSLAComplianceReport.mockRejectedValue(new Error('x'));
      await useApprovalsStore.getState().fetchSLAReport();
      expect(useApprovalsStore.getState().slaReportLoading).toBe(false);
      spy.mockRestore();
    });

    it('fetchOversightMetrics stores metrics on success and clears loading on failure', async () => {
      mockApi.getMeaningfulOversightMetrics.mockResolvedValue({ score: 9 } as never);
      await useApprovalsStore.getState().fetchOversightMetrics();
      expect(useApprovalsStore.getState().oversightMetrics).toEqual({ score: 9 });
      expect(useApprovalsStore.getState().oversightMetricsLoading).toBe(false);

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApi.getMeaningfulOversightMetrics.mockRejectedValue(new Error('x'));
      await useApprovalsStore.getState().fetchOversightMetrics();
      expect(useApprovalsStore.getState().oversightMetricsLoading).toBe(false);
      spy.mockRestore();
    });
  });

  describe('filters', () => {
    it('setFilters merges into existing filters', () => {
      useApprovalsStore.setState({ filters: { workerId: 'w1' } as never });

      useApprovalsStore.getState().setFilters({ status: 'pending' } as never);

      expect(useApprovalsStore.getState().filters).toEqual({ workerId: 'w1', status: 'pending' });
    });

    it('clearFilters resets to empty object', () => {
      useApprovalsStore.setState({ filters: { workerId: 'w1' } as never });

      useApprovalsStore.getState().clearFilters();

      expect(useApprovalsStore.getState().filters).toEqual({});
    });
  });

  describe('reset', () => {
    it('restores the initial state', () => {
      useApprovalsStore.setState({
        approvalRequests: [makeRequest()],
        approvalRequestsTotal: 5,
        contests: [makeContest()],
        filters: { workerId: 'w' } as never,
      });

      useApprovalsStore.getState().reset();

      const s = useApprovalsStore.getState();
      expect(s.approvalRequests).toEqual([]);
      expect(s.approvalRequestsTotal).toBe(0);
      expect(s.contests).toEqual([]);
      expect(s.filters).toEqual({});
    });
  });
});

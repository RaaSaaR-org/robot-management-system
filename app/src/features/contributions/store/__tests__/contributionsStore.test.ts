/**
 * @file contributionsStore.test.ts
 * @description Tests for the contributions Zustand store
 * @feature contributions
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  useContributionsStore,
  selectContributionById,
  selectContributionsByStatus,
  selectAffordableRewards,
} from '../contributionsStore';

vi.mock('../../api/contributionsApi', () => ({
  contributionsApi: {
    listContributions: vi.fn(),
    getContribution: vi.fn(),
    initiateContribution: vi.fn(),
    uploadContributionData: vi.fn(),
    submitForReview: vi.fn(),
    revokeContribution: vi.fn(),
    getImpact: vi.fn(),
    getCreditBalance: vi.fn(),
    getCreditHistory: vi.fn(),
    redeemCredits: vi.fn(),
    getRewards: vi.fn(),
    getRedemptionHistory: vi.fn(),
    getLeaderboard: vi.fn(),
    getContributorStats: vi.fn(),
  },
}));

import { contributionsApi } from '../../api/contributionsApi';

const api = contributionsApi as unknown as Record<string, Mock>;

const contribution = (over: Record<string, unknown> = {}) =>
  ({ id: 'c1', status: 'draft', ...over }) as never;

describe('contributionsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContributionsStore.getState().reset();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('starts with the initial state', () => {
    const s = useContributionsStore.getState();
    expect(s.contributions).toEqual([]);
    expect(s.selectedContribution).toBeNull();
    expect(s.creditBalance).toBeNull();
    expect(s.creditHistory).toEqual([]);
    expect(s.stats).toBeNull();
    expect(s.leaderboard).toEqual([]);
    expect(s.rewards).toEqual([]);
    expect(s.redemptions).toEqual([]);
    expect(s.filters).toEqual({});
    expect(s.pagination).toEqual({ limit: 20, offset: 0, total: 0 });
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.wizardStep).toBe(0);
    expect(s.wizardData).toEqual({});
  });

  // -------------------------------------------------------------------------
  // fetchContributions
  // -------------------------------------------------------------------------
  describe('fetchContributions', () => {
    it('loads contributions and total, forwarding filters + pagination (success)', async () => {
      useContributionsStore.setState({
        filters: { status: 'submitted', licenseType: 'cc-by' } as never,
        pagination: { limit: 5, offset: 10, total: 0 },
      } as never);
      api.listContributions.mockResolvedValue({
        contributions: [contribution()],
        total: 42,
      });

      await useContributionsStore.getState().fetchContributions();

      expect(api.listContributions).toHaveBeenCalledWith({
        status: 'submitted',
        licenseType: 'cc-by',
        limit: 5,
        offset: 10,
      });
      const s = useContributionsStore.getState();
      expect(s.contributions).toHaveLength(1);
      expect(s.pagination.total).toBe(42);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('maps a known error code to its friendly message (error)', async () => {
      api.listContributions.mockRejectedValue({ code: 'NETWORK_ERROR' });
      await useContributionsStore.getState().fetchContributions();
      const s = useContributionsStore.getState();
      expect(s.error).toBe('Unable to connect to the server');
      expect(s.isLoading).toBe(false);
    });

    it('falls back to UNKNOWN_ERROR message for opaque errors', async () => {
      api.listContributions.mockRejectedValue(12345);
      await useContributionsStore.getState().fetchContributions();
      expect(useContributionsStore.getState().error).toBe('An unexpected error occurred');
    });

    it('uses the message property when no code matches', async () => {
      api.listContributions.mockRejectedValue({ message: 'plain message' });
      await useContributionsStore.getState().fetchContributions();
      expect(useContributionsStore.getState().error).toBe('plain message');
    });

    it('reads axios-style response.data.message', async () => {
      api.listContributions.mockRejectedValue({ response: { data: { message: 'axios fail' } } });
      await useContributionsStore.getState().fetchContributions();
      expect(useContributionsStore.getState().error).toBe('axios fail');
    });
  });

  // -------------------------------------------------------------------------
  // fetchContribution
  // -------------------------------------------------------------------------
  describe('fetchContribution', () => {
    it('sets selected and updates in-list copy when present', async () => {
      useContributionsStore.setState({ contributions: [contribution({ id: 'x', status: 'draft' })] } as never);
      api.getContribution.mockResolvedValue(contribution({ id: 'x', status: 'submitted' }));

      await useContributionsStore.getState().fetchContribution('x');

      const s = useContributionsStore.getState();
      expect(s.selectedContribution!.status).toBe('submitted');
      expect(s.contributions[0].status).toBe('submitted');
      expect(s.isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      api.getContribution.mockRejectedValue({ code: 'CONTRIBUTION_NOT_FOUND' });
      await useContributionsStore.getState().fetchContribution('nope');
      expect(useContributionsStore.getState().error).toBe('Contribution not found');
    });
  });

  // -------------------------------------------------------------------------
  // initiateContribution
  // -------------------------------------------------------------------------
  describe('initiateContribution', () => {
    it('unshifts new contribution, selects it, returns it', async () => {
      useContributionsStore.setState({ contributions: [contribution({ id: 'old' })] } as never);
      api.initiateContribution.mockResolvedValue(contribution({ id: 'new' }));

      const result = await useContributionsStore.getState().initiateContribution({} as never);

      expect(result.id).toBe('new');
      const s = useContributionsStore.getState();
      expect(s.contributions.map((c) => c.id)).toEqual(['new', 'old']);
      expect(s.selectedContribution!.id).toBe('new');
    });

    it('sets error and throws on failure', async () => {
      api.initiateContribution.mockRejectedValue({ code: 'INVALID_STATUS' });
      await expect(useContributionsStore.getState().initiateContribution({} as never)).rejects.toThrow(
        'Invalid contribution status for this operation'
      );
      expect(useContributionsStore.getState().error).toBe('Invalid contribution status for this operation');
      expect(useContributionsStore.getState().isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // uploadContributionData
  // -------------------------------------------------------------------------
  describe('uploadContributionData', () => {
    it('updates selected + in-list and returns the response', async () => {
      useContributionsStore.setState({ contributions: [contribution({ id: 'u', status: 'draft' })] } as never);
      const response = { contribution: contribution({ id: 'u', status: 'uploaded' }), uploadUrls: [] };
      api.uploadContributionData.mockResolvedValue(response);

      const res = await useContributionsStore.getState().uploadContributionData('u', {} as never);

      expect(res).toBe(response);
      const s = useContributionsStore.getState();
      expect(s.selectedContribution!.status).toBe('uploaded');
      expect(s.contributions[0].status).toBe('uploaded');
    });

    it('sets error and throws on failure', async () => {
      api.uploadContributionData.mockRejectedValue(new Error('upload boom'));
      await expect(
        useContributionsStore.getState().uploadContributionData('u', {} as never)
      ).rejects.toThrow('upload boom');
      expect(useContributionsStore.getState().error).toBe('upload boom');
    });
  });

  // -------------------------------------------------------------------------
  // submitForReview / revokeContribution (unwrap { contribution })
  // -------------------------------------------------------------------------
  describe('submitForReview', () => {
    it('unwraps contribution, updates state, returns it', async () => {
      useContributionsStore.setState({ contributions: [contribution({ id: 's', status: 'uploaded' })] } as never);
      api.submitForReview.mockResolvedValue({ contribution: contribution({ id: 's', status: 'submitted' }), message: 'ok' });

      const c = await useContributionsStore.getState().submitForReview('s');

      expect(c.status).toBe('submitted');
      expect(useContributionsStore.getState().contributions[0].status).toBe('submitted');
      expect(useContributionsStore.getState().selectedContribution!.status).toBe('submitted');
    });

    it('sets error and throws on failure', async () => {
      api.submitForReview.mockRejectedValue({ code: 'INVALID_STATUS' });
      await expect(useContributionsStore.getState().submitForReview('s')).rejects.toThrow(
        'Invalid contribution status for this operation'
      );
    });
  });

  describe('revokeContribution', () => {
    it('passes the reason, updates state, returns contribution', async () => {
      useContributionsStore.setState({ contributions: [contribution({ id: 'r', status: 'submitted' })] } as never);
      api.revokeContribution.mockResolvedValue({ contribution: contribution({ id: 'r', status: 'revoked' }), message: 'ok' });

      const c = await useContributionsStore.getState().revokeContribution('r', 'mistake');

      expect(api.revokeContribution).toHaveBeenCalledWith('r', 'mistake');
      expect(c.status).toBe('revoked');
      expect(useContributionsStore.getState().contributions[0].status).toBe('revoked');
    });

    it('sets error and throws on failure', async () => {
      api.revokeContribution.mockRejectedValue(new Error('revoke fail'));
      await expect(useContributionsStore.getState().revokeContribution('r')).rejects.toThrow('revoke fail');
      expect(useContributionsStore.getState().error).toBe('revoke fail');
    });
  });

  // -------------------------------------------------------------------------
  // selectContribution (sync)
  // -------------------------------------------------------------------------
  it('selectContribution sets and clears the selection', () => {
    const c = contribution({ id: 'sel' });
    useContributionsStore.getState().selectContribution(c);
    expect(useContributionsStore.getState().selectedContribution).toBe(c);
    useContributionsStore.getState().selectContribution(null);
    expect(useContributionsStore.getState().selectedContribution).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Credit balance / history (non-throwing fetchers)
  // -------------------------------------------------------------------------
  it('fetchCreditBalance stores the balance / sets error on failure', async () => {
    api.getCreditBalance.mockResolvedValue({ available: 100, total: 120 });
    await useContributionsStore.getState().fetchCreditBalance();
    expect(useContributionsStore.getState().creditBalance).toEqual({ available: 100, total: 120 });

    api.getCreditBalance.mockRejectedValue({ code: 'NETWORK_ERROR' });
    await useContributionsStore.getState().fetchCreditBalance();
    expect(useContributionsStore.getState().error).toBe('Unable to connect to the server');
  });

  it('fetchCreditHistory stores history / sets error on failure', async () => {
    api.getCreditHistory.mockResolvedValue({ history: [{ id: 'h1' }] });
    await useContributionsStore.getState().fetchCreditHistory();
    expect(api.getCreditHistory).toHaveBeenCalledWith({ limit: 100 });
    expect(useContributionsStore.getState().creditHistory).toHaveLength(1);

    api.getCreditHistory.mockRejectedValue(new Error('hist'));
    await useContributionsStore.getState().fetchCreditHistory();
    expect(useContributionsStore.getState().error).toBe('hist');
  });

  // -------------------------------------------------------------------------
  // redeemCredits — triggers balance refresh
  // -------------------------------------------------------------------------
  describe('redeemCredits', () => {
    it('unshifts redemption, returns it, and refreshes balance', async () => {
      api.redeemCredits.mockResolvedValue({ redemption: { id: 'red1' } });
      api.getCreditBalance.mockResolvedValue({ available: 50, total: 50 });

      const redemption = await useContributionsStore.getState().redeemCredits('reward-1');

      expect(api.redeemCredits).toHaveBeenCalledWith({ rewardId: 'reward-1' });
      expect(redemption).toEqual({ id: 'red1' });
      expect(useContributionsStore.getState().redemptions[0]).toEqual({ id: 'red1' });
      expect(useContributionsStore.getState().isLoading).toBe(false);
      // balance refresh was triggered
      expect(api.getCreditBalance).toHaveBeenCalled();
    });

    it('maps INSUFFICIENT_CREDITS and throws', async () => {
      api.redeemCredits.mockRejectedValue({ code: 'INSUFFICIENT_CREDITS' });
      await expect(useContributionsStore.getState().redeemCredits('r')).rejects.toThrow(
        'Insufficient credits for this redemption'
      );
      expect(useContributionsStore.getState().error).toBe('Insufficient credits for this redemption');
      expect(useContributionsStore.getState().isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // rewards / redemptions / leaderboard
  // -------------------------------------------------------------------------
  it('fetchRewards stores rewards / sets error', async () => {
    api.getRewards.mockResolvedValue({ rewards: [{ id: 'rw' }] });
    await useContributionsStore.getState().fetchRewards();
    expect(useContributionsStore.getState().rewards).toHaveLength(1);

    api.getRewards.mockRejectedValue(new Error('rw fail'));
    await useContributionsStore.getState().fetchRewards();
    expect(useContributionsStore.getState().error).toBe('rw fail');
  });

  it('fetchRedemptionHistory stores redemptions / sets error', async () => {
    api.getRedemptionHistory.mockResolvedValue({ redemptions: [{ id: 'rd' }] });
    await useContributionsStore.getState().fetchRedemptionHistory();
    expect(useContributionsStore.getState().redemptions).toHaveLength(1);

    api.getRedemptionHistory.mockRejectedValue(new Error('rd fail'));
    await useContributionsStore.getState().fetchRedemptionHistory();
    expect(useContributionsStore.getState().error).toBe('rd fail');
  });

  it('fetchLeaderboard forwards params, stores leaderboard / sets error', async () => {
    api.getLeaderboard.mockResolvedValue({ leaderboard: [{ rank: 1 }] });
    await useContributionsStore.getState().fetchLeaderboard({ period: 'all-time' } as never);
    expect(api.getLeaderboard).toHaveBeenCalledWith({ period: 'all-time' });
    expect(useContributionsStore.getState().leaderboard).toHaveLength(1);

    api.getLeaderboard.mockRejectedValue(new Error('lb fail'));
    await useContributionsStore.getState().fetchLeaderboard();
    expect(useContributionsStore.getState().error).toBe('lb fail');
  });

  // -------------------------------------------------------------------------
  // fetchStats — special null handling
  // -------------------------------------------------------------------------
  describe('fetchStats', () => {
    it('stores stats object when present', async () => {
      api.getContributorStats.mockResolvedValue({ totalContributions: 3 });
      await useContributionsStore.getState().fetchStats();
      expect(useContributionsStore.getState().stats).toEqual({ totalContributions: 3 });
    });

    it('keeps stats null when api returns the null-sentinel response', async () => {
      api.getContributorStats.mockResolvedValue({ message: 'no stats', stats: null });
      await useContributionsStore.getState().fetchStats();
      expect(useContributionsStore.getState().stats).toBeNull();
    });

    it('sets error on failure', async () => {
      api.getContributorStats.mockRejectedValue(new Error('stats fail'));
      await useContributionsStore.getState().fetchStats();
      expect(useContributionsStore.getState().error).toBe('stats fail');
    });
  });

  // -------------------------------------------------------------------------
  // fetchImpact — returns value, does not store
  // -------------------------------------------------------------------------
  describe('fetchImpact', () => {
    it('returns the impact summary', async () => {
      api.getImpact.mockResolvedValue({ impact: { trainingRuns: 2 } });
      const impact = await useContributionsStore.getState().fetchImpact('c1');
      expect(impact).toEqual({ trainingRuns: 2 });
    });

    it('sets error and throws on failure', async () => {
      api.getImpact.mockRejectedValue(new Error('impact fail'));
      await expect(useContributionsStore.getState().fetchImpact('c1')).rejects.toThrow('impact fail');
      expect(useContributionsStore.getState().error).toBe('impact fail');
    });
  });

  // -------------------------------------------------------------------------
  // Filters / pagination — these trigger fetchContributions
  // -------------------------------------------------------------------------
  describe('filters and pagination', () => {
    beforeEach(() => {
      api.listContributions.mockResolvedValue({ contributions: [], total: 0 });
    });

    it('setFilters merges filters, resets offset, and refetches', async () => {
      useContributionsStore.setState({ pagination: { limit: 20, offset: 40, total: 0 } } as never);
      useContributionsStore.getState().setFilters({ status: 'submitted' } as never);

      const s = useContributionsStore.getState();
      expect(s.filters).toEqual({ status: 'submitted' });
      expect(s.pagination.offset).toBe(0);
      expect(api.listContributions).toHaveBeenCalledTimes(1);
    });

    it('clearFilters empties filters, resets offset, and refetches', async () => {
      useContributionsStore.setState({
        filters: { status: 'submitted' } as never,
        pagination: { limit: 20, offset: 60, total: 0 },
      } as never);
      useContributionsStore.getState().clearFilters();

      const s = useContributionsStore.getState();
      expect(s.filters).toEqual({});
      expect(s.pagination.offset).toBe(0);
      expect(api.listContributions).toHaveBeenCalledTimes(1);
    });

    it('setPage updates offset and refetches', async () => {
      useContributionsStore.getState().setPage(20);
      expect(useContributionsStore.getState().pagination.offset).toBe(20);
      expect(api.listContributions).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Wizard management
  // -------------------------------------------------------------------------
  describe('wizard', () => {
    it('setWizardStep sets the step', () => {
      useContributionsStore.getState().setWizardStep(3);
      expect(useContributionsStore.getState().wizardStep).toBe(3);
    });

    it('setWizardData merges across calls', () => {
      useContributionsStore.getState().setWizardData({ name: 'a' } as never);
      useContributionsStore.getState().setWizardData({ description: 'b' } as never);
      expect(useContributionsStore.getState().wizardData).toEqual({ name: 'a', description: 'b' });
    });

    it('resetWizard restores defaults', () => {
      useContributionsStore.getState().setWizardStep(2);
      useContributionsStore.getState().setWizardData({ name: 'a' } as never);
      useContributionsStore.getState().resetWizard();
      const s = useContributionsStore.getState();
      expect(s.wizardStep).toBe(0);
      expect(s.wizardData).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // clearError / reset
  // -------------------------------------------------------------------------
  it('clearError clears the error field', () => {
    useContributionsStore.setState({ error: 'boom' } as never);
    useContributionsStore.getState().clearError();
    expect(useContributionsStore.getState().error).toBeNull();
  });

  it('reset returns the store to its initial state', () => {
    useContributionsStore.setState({
      contributions: [contribution()],
      error: 'x',
      wizardStep: 4,
      creditBalance: { available: 1, total: 1 } as never,
    } as never);
    useContributionsStore.getState().reset();
    const s = useContributionsStore.getState();
    expect(s.contributions).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.wizardStep).toBe(0);
    expect(s.creditBalance).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Selectors / derived getters
  // -------------------------------------------------------------------------
  describe('selectors', () => {
    it('selectContributionById finds or returns null', () => {
      useContributionsStore.setState({
        contributions: [contribution({ id: 'a' }), contribution({ id: 'b' })],
      } as never);
      expect(selectContributionById('b')(useContributionsStore.getState())!.id).toBe('b');
      expect(selectContributionById('z')(useContributionsStore.getState())).toBeNull();
    });

    it('selectContributionsByStatus filters by status', () => {
      useContributionsStore.setState({
        contributions: [
          contribution({ id: 'a', status: 'draft' }),
          contribution({ id: 'b', status: 'submitted' }),
          contribution({ id: 'c', status: 'submitted' }),
        ],
      } as never);
      const ids = selectContributionsByStatus('submitted')(useContributionsStore.getState()).map((c) => c.id);
      expect(ids).toEqual(['b', 'c']);
    });

    it('selectAffordableRewards returns [] when no balance', () => {
      useContributionsStore.setState({
        creditBalance: null,
        rewards: [{ id: 'r', available: true, creditCost: 5 } as never],
      } as never);
      expect(selectAffordableRewards(useContributionsStore.getState())).toEqual([]);
    });

    it('selectAffordableRewards filters by availability and affordability', () => {
      useContributionsStore.setState({
        creditBalance: { available: 10, total: 10 } as never,
        rewards: [
          { id: 'cheap', available: true, creditCost: 5 } as never,
          { id: 'exact', available: true, creditCost: 10 } as never,
          { id: 'tooExpensive', available: true, creditCost: 11 } as never,
          { id: 'unavailable', available: false, creditCost: 1 } as never,
        ],
      } as never);
      const ids = selectAffordableRewards(useContributionsStore.getState()).map((r) => r.id);
      expect(ids).toEqual(['cheap', 'exact']);
    });
  });
});

/**
 * @file explainabilityStore.test.ts
 * @description Tests for the explainability Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useExplainabilityStore,
  selectDecisions,
  selectSelectedDecision,
  selectFormattedExplanation,
  selectMetrics,
  selectDocumentation,
  selectPagination,
  selectIsLoading,
  selectIsLoadingExplanation,
  selectIsLoadingMetrics,
  selectIsLoadingDocumentation,
  selectError,
} from '../explainabilityStore';
import { explainabilityApi } from '../../api';

vi.mock('../../api', () => ({
  explainabilityApi: {
    getDecisions: vi.fn(),
    getDecision: vi.fn(),
    getExplanation: vi.fn(),
    getMetrics: vi.fn(),
    getDocumentation: vi.fn(),
  },
}));

const api = explainabilityApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const INITIAL_PAGINATION = { page: 1, pageSize: 20, total: 0, totalPages: 0 };

describe('explainabilityStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExplainabilityStore.getState().reset();
  });

  it('starts with initial state', () => {
    const s = useExplainabilityStore.getState();
    expect(s.decisions).toEqual([]);
    expect(s.selectedDecision).toBeNull();
    expect(s.formattedExplanation).toBeNull();
    expect(s.metrics).toBeNull();
    expect(s.documentation).toBeNull();
    expect(s.pagination).toEqual(INITIAL_PAGINATION);
    expect(s.isLoading).toBe(false);
    expect(s.isLoadingExplanation).toBe(false);
    expect(s.isLoadingMetrics).toBe(false);
    expect(s.isLoadingDocumentation).toBe(false);
    expect(s.error).toBeNull();
  });

  // ---------------------------------------------------------- fetchDecisions
  describe('fetchDecisions', () => {
    it('stores decisions + pagination and clears loading on success', async () => {
      const pagination = { page: 2, pageSize: 20, total: 40, totalPages: 2 };
      api.getDecisions.mockResolvedValue({
        decisions: [{ id: 'd1' }],
        pagination,
      });

      await useExplainabilityStore
        .getState()
        .fetchDecisions({ page: 2, robotId: 'r1', decisionType: 'navigation' as any });

      expect(api.getDecisions).toHaveBeenCalledWith({
        page: 2,
        pageSize: 20,
        robotId: 'r1',
        decisionType: 'navigation',
      });
      const s = useExplainabilityStore.getState();
      expect(s.decisions).toEqual([{ id: 'd1' }]);
      expect(s.pagination).toEqual(pagination);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('defaults page to 1 when no params given', async () => {
      api.getDecisions.mockResolvedValue({
        decisions: [],
        pagination: INITIAL_PAGINATION,
      });

      await useExplainabilityStore.getState().fetchDecisions();

      expect(api.getDecisions).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        robotId: undefined,
        decisionType: undefined,
      });
    });

    it('sets error and clears loading on failure', async () => {
      api.getDecisions.mockRejectedValue(new Error('list failed'));

      await useExplainabilityStore.getState().fetchDecisions();

      const s = useExplainabilityStore.getState();
      expect(s.error).toBe('list failed');
      expect(s.isLoading).toBe(false);
      expect(s.decisions).toEqual([]);
    });

    it('falls back to default error message for non-Error rejection', async () => {
      api.getDecisions.mockRejectedValue('weird');

      await useExplainabilityStore.getState().fetchDecisions();

      expect(useExplainabilityStore.getState().error).toBe('Failed to fetch decisions');
    });

    it('clears a previous error when starting a new fetch', async () => {
      useExplainabilityStore.setState({ error: 'old error' });
      api.getDecisions.mockResolvedValue({
        decisions: [],
        pagination: INITIAL_PAGINATION,
      });

      await useExplainabilityStore.getState().fetchDecisions();

      expect(useExplainabilityStore.getState().error).toBeNull();
    });
  });

  // ----------------------------------------------------------- fetchDecision
  describe('fetchDecision', () => {
    it('stores selected decision on success', async () => {
      api.getDecision.mockResolvedValue({ id: 'd5' });

      await useExplainabilityStore.getState().fetchDecision('d5');

      expect(api.getDecision).toHaveBeenCalledWith('d5');
      const s = useExplainabilityStore.getState();
      expect(s.selectedDecision).toEqual({ id: 'd5' });
      expect(s.isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      api.getDecision.mockRejectedValue(new Error('not found'));

      await useExplainabilityStore.getState().fetchDecision('x');

      const s = useExplainabilityStore.getState();
      expect(s.error).toBe('not found');
      expect(s.isLoading).toBe(false);
      expect(s.selectedDecision).toBeNull();
    });
  });

  // -------------------------------------------------------- fetchExplanation
  describe('fetchExplanation', () => {
    it('stores explanation and toggles its own loading flag', async () => {
      api.getExplanation.mockResolvedValue({ text: 'because' });

      await useExplainabilityStore.getState().fetchExplanation('d1');

      expect(api.getExplanation).toHaveBeenCalledWith('d1');
      const s = useExplainabilityStore.getState();
      expect(s.formattedExplanation).toEqual({ text: 'because' });
      expect(s.isLoadingExplanation).toBe(false);
    });

    it('sets error and clears explanation loading on failure', async () => {
      api.getExplanation.mockRejectedValue(new Error('exp fail'));

      await useExplainabilityStore.getState().fetchExplanation('d1');

      const s = useExplainabilityStore.getState();
      expect(s.error).toBe('exp fail');
      expect(s.isLoadingExplanation).toBe(false);
    });
  });

  // ------------------------------------------------------------ fetchMetrics
  describe('fetchMetrics', () => {
    it('uses weekly default period and passes robotId', async () => {
      api.getMetrics.mockResolvedValue({ count: 1 });

      await useExplainabilityStore.getState().fetchMetrics(undefined, 'r1');

      expect(api.getMetrics).toHaveBeenCalledWith('weekly', 'r1');
      const s = useExplainabilityStore.getState();
      expect(s.metrics).toEqual({ count: 1 });
      expect(s.isLoadingMetrics).toBe(false);
    });

    it('passes explicit period', async () => {
      api.getMetrics.mockResolvedValue({ count: 2 });

      await useExplainabilityStore.getState().fetchMetrics('daily' as any);

      expect(api.getMetrics).toHaveBeenCalledWith('daily', undefined);
    });

    it('sets error on failure', async () => {
      api.getMetrics.mockRejectedValue(new Error('metrics fail'));

      await useExplainabilityStore.getState().fetchMetrics();

      const s = useExplainabilityStore.getState();
      expect(s.error).toBe('metrics fail');
      expect(s.isLoadingMetrics).toBe(false);
    });
  });

  // ------------------------------------------------------ fetchDocumentation
  describe('fetchDocumentation', () => {
    it('stores documentation on success', async () => {
      api.getDocumentation.mockResolvedValue({ doc: 'md' });

      await useExplainabilityStore.getState().fetchDocumentation();

      const s = useExplainabilityStore.getState();
      expect(s.documentation).toEqual({ doc: 'md' });
      expect(s.isLoadingDocumentation).toBe(false);
    });

    it('sets error on failure', async () => {
      api.getDocumentation.mockRejectedValue(new Error('doc fail'));

      await useExplainabilityStore.getState().fetchDocumentation();

      const s = useExplainabilityStore.getState();
      expect(s.error).toBe('doc fail');
      expect(s.isLoadingDocumentation).toBe(false);
    });
  });

  // ------------------------------------------------------- sync mutations
  describe('synchronous mutations', () => {
    it('clearSelectedDecision clears decision and explanation', () => {
      useExplainabilityStore.setState({
        selectedDecision: { id: 'd1' } as any,
        formattedExplanation: { text: 'x' } as any,
      });

      useExplainabilityStore.getState().clearSelectedDecision();

      const s = useExplainabilityStore.getState();
      expect(s.selectedDecision).toBeNull();
      expect(s.formattedExplanation).toBeNull();
    });

    it('reset restores initial state', () => {
      useExplainabilityStore.setState({
        decisions: [{ id: 'd1' }] as any,
        metrics: { count: 9 } as any,
        error: 'boom',
        isLoading: true,
        pagination: { page: 5, pageSize: 20, total: 100, totalPages: 5 },
      });

      useExplainabilityStore.getState().reset();

      const s = useExplainabilityStore.getState();
      expect(s.decisions).toEqual([]);
      expect(s.metrics).toBeNull();
      expect(s.error).toBeNull();
      expect(s.isLoading).toBe(false);
      expect(s.pagination).toEqual(INITIAL_PAGINATION);
    });
  });

  // -------------------------------------------------------------- selectors
  describe('selectors', () => {
    it('return their corresponding slice of state', () => {
      useExplainabilityStore.setState({
        decisions: [{ id: 'd1' }] as any,
        selectedDecision: { id: 'd1' } as any,
        formattedExplanation: { text: 't' } as any,
        metrics: { count: 3 } as any,
        documentation: { doc: 'd' } as any,
        pagination: { page: 2, pageSize: 20, total: 5, totalPages: 1 },
        isLoading: true,
        isLoadingExplanation: true,
        isLoadingMetrics: true,
        isLoadingDocumentation: true,
        error: 'err',
      });

      const s = useExplainabilityStore.getState();
      expect(selectDecisions(s)).toEqual([{ id: 'd1' }]);
      expect(selectSelectedDecision(s)).toEqual({ id: 'd1' });
      expect(selectFormattedExplanation(s)).toEqual({ text: 't' });
      expect(selectMetrics(s)).toEqual({ count: 3 });
      expect(selectDocumentation(s)).toEqual({ doc: 'd' });
      expect(selectPagination(s)).toEqual({ page: 2, pageSize: 20, total: 5, totalPages: 1 });
      expect(selectIsLoading(s)).toBe(true);
      expect(selectIsLoadingExplanation(s)).toBe(true);
      expect(selectIsLoadingMetrics(s)).toBe(true);
      expect(selectIsLoadingDocumentation(s)).toBe(true);
      expect(selectError(s)).toBe('err');
    });
  });
});

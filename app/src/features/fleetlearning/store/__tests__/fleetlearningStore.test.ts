/**
 * @file fleetlearningStore.test.ts
 * @description Tests for the fleet learning Zustand store
 * @feature fleetlearning
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useFleetLearningStore,
  selectRounds,
  selectSelectedRound,
  selectParticipants,
  selectPrivacyBudgets,
  selectROHEMetrics,
  selectConvergenceData,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectRoundById,
  selectActiveRounds,
  selectCompletedRounds,
  selectLowPrivacyBudgetRobots,
} from '../fleetlearningStore';
import { fleetlearningApi } from '../../api/fleetlearningApi';
import type {
  FederatedRound,
  FederatedParticipant,
  RobotPrivacyBudget,
  ROHEMetrics,
  ConvergenceDataPoint,
  FederatedRoundStatus,
} from '../../types/fleetlearning.types';

vi.mock('../../api/fleetlearningApi');

const mockedApi = vi.mocked(fleetlearningApi);

// ----------------------------------------------------------------------------
// FIXTURES
// ----------------------------------------------------------------------------

function makeRound(overrides: Partial<FederatedRound> = {}): FederatedRound {
  return {
    id: 'round-1',
    status: 'created',
    globalModelVersion: 'v1',
    config: {
      minParticipants: 3,
      maxParticipants: 50,
      trainingTimeout: 3600,
      uploadTimeout: 600,
      aggregationMethod: 'fedavg',
      selectionStrategy: 'random',
      localEpochs: 1,
      localLearningRate: 0.001,
      minLocalSamples: 10,
      secureAggregation: false,
    },
    participantCount: 0,
    completedParticipants: 0,
    failedParticipants: 0,
    totalLocalSamples: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<FederatedParticipant> = {}): FederatedParticipant {
  return {
    id: 'p-1',
    roundId: 'round-1',
    robotId: 'robot-1',
    status: 'selected',
    ...overrides,
  };
}

function makeBudget(overrides: Partial<RobotPrivacyBudget> = {}): RobotPrivacyBudget {
  return {
    robotId: 'robot-1',
    totalEpsilon: 10,
    usedEpsilon: 5,
    remainingEpsilon: 5,
    lastUpdated: '2024-01-01T00:00:00.000Z',
    roundsParticipated: 2,
    ...overrides,
  };
}

const initialState = {
  rounds: [],
  selectedRound: null,
  participants: [],
  privacyBudgets: [],
  roheMetrics: null,
  convergenceData: [],
  filters: {},
  pagination: { limit: 20, offset: 0, total: 0 },
  isLoading: false,
  error: null,
};

describe('fleetlearningStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFleetLearningStore.setState({ ...initialState });
  });

  // --------------------------------------------------------------------------
  // INITIAL STATE
  // --------------------------------------------------------------------------

  it('starts with the expected initial state', () => {
    const state = useFleetLearningStore.getState();
    expect(state.rounds).toEqual([]);
    expect(state.selectedRound).toBeNull();
    expect(state.participants).toEqual([]);
    expect(state.privacyBudgets).toEqual([]);
    expect(state.roheMetrics).toBeNull();
    expect(state.convergenceData).toEqual([]);
    expect(state.filters).toEqual({});
    expect(state.pagination).toEqual({ limit: 20, offset: 0, total: 0 });
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // --------------------------------------------------------------------------
  // fetchRounds
  // --------------------------------------------------------------------------

  it('fetchRounds populates rounds + total and passes filters/pagination', async () => {
    useFleetLearningStore.setState({
      filters: { status: 'training', globalModelVersion: 'v2' },
      pagination: { limit: 5, offset: 10, total: 0 },
    });
    const rounds = [makeRound({ id: 'r-a' }), makeRound({ id: 'r-b' })];
    mockedApi.listRounds.mockResolvedValue({ rounds, total: 42, limit: 5, offset: 10 });

    await useFleetLearningStore.getState().fetchRounds();

    expect(mockedApi.listRounds).toHaveBeenCalledWith({
      status: 'training',
      globalModelVersion: 'v2',
      limit: 5,
      offset: 10,
    });
    const state = useFleetLearningStore.getState();
    expect(state.rounds).toEqual(rounds);
    expect(state.pagination.total).toBe(42);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchRounds sets error message and clears loading on failure', async () => {
    mockedApi.listRounds.mockRejectedValue(new Error('boom'));

    await useFleetLearningStore.getState().fetchRounds();

    const state = useFleetLearningStore.getState();
    expect(state.error).toBe('boom');
    expect(state.isLoading).toBe(false);
    expect(state.rounds).toEqual([]);
  });

  it('fetchRounds uses fallback message for non-Error rejections', async () => {
    mockedApi.listRounds.mockRejectedValue('string failure');

    await useFleetLearningStore.getState().fetchRounds();

    expect(useFleetLearningStore.getState().error).toBe('Failed to fetch rounds');
  });

  // --------------------------------------------------------------------------
  // fetchRound
  // --------------------------------------------------------------------------

  it('fetchRound sets selectedRound and participants', async () => {
    const round = makeRound({ id: 'r-x' });
    const participants = [makeParticipant({ id: 'pp' })];
    mockedApi.getRound.mockResolvedValue({ round, participants });

    await useFleetLearningStore.getState().fetchRound('r-x');

    expect(mockedApi.getRound).toHaveBeenCalledWith('r-x');
    const state = useFleetLearningStore.getState();
    expect(state.selectedRound).toEqual(round);
    expect(state.participants).toEqual(participants);
    expect(state.isLoading).toBe(false);
  });

  it('fetchRound sets error on failure', async () => {
    mockedApi.getRound.mockRejectedValue(new Error('not found'));

    await useFleetLearningStore.getState().fetchRound('missing');

    expect(useFleetLearningStore.getState().error).toBe('not found');
    expect(useFleetLearningStore.getState().isLoading).toBe(false);
  });

  // --------------------------------------------------------------------------
  // createRound
  // --------------------------------------------------------------------------

  it('createRound prepends the new round and returns it', async () => {
    const existing = makeRound({ id: 'old' });
    useFleetLearningStore.setState({ rounds: [existing] });
    const created = makeRound({ id: 'new' });
    mockedApi.createRound.mockResolvedValue(created);

    const result = await useFleetLearningStore.getState().createRound({ globalModelVersion: 'v1' });

    expect(result).toEqual(created);
    const state = useFleetLearningStore.getState();
    expect(state.rounds.map((r) => r.id)).toEqual(['new', 'old']);
    expect(state.isLoading).toBe(false);
  });

  it('createRound rethrows and records error on failure', async () => {
    mockedApi.createRound.mockRejectedValue(new Error('create failed'));

    await expect(
      useFleetLearningStore.getState().createRound({ globalModelVersion: 'v1' })
    ).rejects.toThrow('create failed');

    const state = useFleetLearningStore.getState();
    expect(state.error).toBe('create failed');
    expect(state.isLoading).toBe(false);
    expect(state.rounds).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // startRound
  // --------------------------------------------------------------------------

  it('startRound replaces the matching round and syncs selectedRound', async () => {
    const round = makeRound({ id: 'r1', status: 'created' });
    useFleetLearningStore.setState({ rounds: [round], selectedRound: round });
    const started = makeRound({ id: 'r1', status: 'selecting' });
    mockedApi.startRound.mockResolvedValue(started);

    await useFleetLearningStore.getState().startRound('r1');

    const state = useFleetLearningStore.getState();
    expect(state.rounds[0].status).toBe('selecting');
    expect(state.selectedRound?.status).toBe('selecting');
  });

  it('startRound leaves selectedRound untouched when ids differ', async () => {
    const inList = makeRound({ id: 'r1', status: 'created' });
    const selected = makeRound({ id: 'other', status: 'created' });
    useFleetLearningStore.setState({ rounds: [inList], selectedRound: selected });
    mockedApi.startRound.mockResolvedValue(makeRound({ id: 'r1', status: 'selecting' }));

    await useFleetLearningStore.getState().startRound('r1');

    expect(useFleetLearningStore.getState().selectedRound).toEqual(selected);
  });

  it('startRound rethrows and records error on failure', async () => {
    mockedApi.startRound.mockRejectedValue(new Error('cannot start'));

    await expect(useFleetLearningStore.getState().startRound('r1')).rejects.toThrow('cannot start');
    expect(useFleetLearningStore.getState().error).toBe('cannot start');
    expect(useFleetLearningStore.getState().isLoading).toBe(false);
  });

  // --------------------------------------------------------------------------
  // cancelRound
  // --------------------------------------------------------------------------

  it('cancelRound replaces the matching round and syncs selectedRound', async () => {
    const round = makeRound({ id: 'r1', status: 'training' });
    useFleetLearningStore.setState({ rounds: [round], selectedRound: round });
    const cancelled = makeRound({ id: 'r1', status: 'cancelled' });
    mockedApi.cancelRound.mockResolvedValue(cancelled);

    await useFleetLearningStore.getState().cancelRound('r1');

    const state = useFleetLearningStore.getState();
    expect(state.rounds[0].status).toBe('cancelled');
    expect(state.selectedRound?.status).toBe('cancelled');
  });

  it('cancelRound rethrows and records error on failure', async () => {
    mockedApi.cancelRound.mockRejectedValue(new Error('cannot cancel'));

    await expect(useFleetLearningStore.getState().cancelRound('r1')).rejects.toThrow(
      'cannot cancel'
    );
    expect(useFleetLearningStore.getState().error).toBe('cannot cancel');
  });

  // --------------------------------------------------------------------------
  // selectRound
  // --------------------------------------------------------------------------

  it('selectRound sets the round and resets participants', () => {
    useFleetLearningStore.setState({ participants: [makeParticipant()] });
    const round = makeRound({ id: 'sel' });

    useFleetLearningStore.getState().selectRound(round);

    const state = useFleetLearningStore.getState();
    expect(state.selectedRound).toEqual(round);
    expect(state.participants).toEqual([]);
  });

  it('selectRound(null) clears the selection', () => {
    useFleetLearningStore.setState({ selectedRound: makeRound() });
    useFleetLearningStore.getState().selectRound(null);
    expect(useFleetLearningStore.getState().selectedRound).toBeNull();
  });

  // --------------------------------------------------------------------------
  // fetchParticipants
  // --------------------------------------------------------------------------

  it('fetchParticipants sets participants on success', async () => {
    const participants = [makeParticipant({ id: 'a' }), makeParticipant({ id: 'b' })];
    mockedApi.getParticipants.mockResolvedValue(participants);

    await useFleetLearningStore.getState().fetchParticipants('round-1');

    expect(mockedApi.getParticipants).toHaveBeenCalledWith('round-1');
    expect(useFleetLearningStore.getState().participants).toEqual(participants);
    expect(useFleetLearningStore.getState().isLoading).toBe(false);
  });

  it('fetchParticipants sets error on failure', async () => {
    mockedApi.getParticipants.mockRejectedValue(new Error('no participants'));

    await useFleetLearningStore.getState().fetchParticipants('round-1');

    expect(useFleetLearningStore.getState().error).toBe('no participants');
  });

  // --------------------------------------------------------------------------
  // fetchPrivacyBudgets
  // --------------------------------------------------------------------------

  it('fetchPrivacyBudgets sets budgets on success', async () => {
    const budgets = [makeBudget({ robotId: 'r1' })];
    mockedApi.listPrivacyBudgets.mockResolvedValue({ budgets, totalRobots: 1 });

    await useFleetLearningStore.getState().fetchPrivacyBudgets();

    expect(useFleetLearningStore.getState().privacyBudgets).toEqual(budgets);
    expect(useFleetLearningStore.getState().isLoading).toBe(false);
  });

  it('fetchPrivacyBudgets sets error on failure', async () => {
    mockedApi.listPrivacyBudgets.mockRejectedValue(new Error('budgets fail'));

    await useFleetLearningStore.getState().fetchPrivacyBudgets();

    expect(useFleetLearningStore.getState().error).toBe('budgets fail');
  });

  // --------------------------------------------------------------------------
  // fetchROHEMetrics
  // --------------------------------------------------------------------------

  it('fetchROHEMetrics sets metrics and forwards params', async () => {
    const metrics: ROHEMetrics = {
      period: { start: 's', end: 'e' },
      totalInterventions: 3,
      performanceImprovement: 0.5,
      improvementPerIntervention: 0.16,
      byRobot: {},
      byTask: {},
    };
    mockedApi.getROHEMetrics.mockResolvedValue(metrics);

    await useFleetLearningStore.getState().fetchROHEMetrics({ robotId: 'r1' });

    expect(mockedApi.getROHEMetrics).toHaveBeenCalledWith({ robotId: 'r1' });
    expect(useFleetLearningStore.getState().roheMetrics).toEqual(metrics);
  });

  it('fetchROHEMetrics sets error on failure', async () => {
    mockedApi.getROHEMetrics.mockRejectedValue(new Error('rohe fail'));

    await useFleetLearningStore.getState().fetchROHEMetrics();

    expect(useFleetLearningStore.getState().error).toBe('rohe fail');
  });

  // --------------------------------------------------------------------------
  // fetchConvergenceData
  // --------------------------------------------------------------------------

  it('fetchConvergenceData sets data and forwards modelVersion', async () => {
    const data: ConvergenceDataPoint[] = [
      { roundNumber: 1, roundId: 'r1', loss: 0.5, participants: 3, timestamp: 't' },
    ];
    mockedApi.getConvergenceData.mockResolvedValue(data);

    await useFleetLearningStore.getState().fetchConvergenceData('v3');

    expect(mockedApi.getConvergenceData).toHaveBeenCalledWith('v3');
    expect(useFleetLearningStore.getState().convergenceData).toEqual(data);
  });

  it('fetchConvergenceData sets error on failure', async () => {
    mockedApi.getConvergenceData.mockRejectedValue(new Error('conv fail'));

    await useFleetLearningStore.getState().fetchConvergenceData();

    expect(useFleetLearningStore.getState().error).toBe('conv fail');
  });

  // --------------------------------------------------------------------------
  // FILTER ACTIONS
  // --------------------------------------------------------------------------

  it('setFilters merges filters and resets offset to 0', () => {
    useFleetLearningStore.setState({
      filters: { status: 'training' },
      pagination: { limit: 20, offset: 40, total: 100 },
    });

    useFleetLearningStore.getState().setFilters({ globalModelVersion: 'v9' });

    const state = useFleetLearningStore.getState();
    expect(state.filters).toEqual({ status: 'training', globalModelVersion: 'v9' });
    expect(state.pagination.offset).toBe(0);
    expect(state.pagination.limit).toBe(20);
  });

  it('clearFilters empties filters and resets offset', () => {
    useFleetLearningStore.setState({
      filters: { status: 'completed' },
      pagination: { limit: 20, offset: 60, total: 100 },
    });

    useFleetLearningStore.getState().clearFilters();

    const state = useFleetLearningStore.getState();
    expect(state.filters).toEqual({});
    expect(state.pagination.offset).toBe(0);
  });

  it('setPage updates pagination offset only', () => {
    useFleetLearningStore.getState().setPage(80);
    const state = useFleetLearningStore.getState();
    expect(state.pagination.offset).toBe(80);
    expect(state.pagination.limit).toBe(20);
  });

  // --------------------------------------------------------------------------
  // ERROR / RESET
  // --------------------------------------------------------------------------

  it('clearError resets the error', () => {
    useFleetLearningStore.setState({ error: 'something' });
    useFleetLearningStore.getState().clearError();
    expect(useFleetLearningStore.getState().error).toBeNull();
  });

  it('reset restores the full initial state', () => {
    useFleetLearningStore.setState({
      rounds: [makeRound()],
      selectedRound: makeRound(),
      error: 'oops',
      isLoading: true,
      pagination: { limit: 20, offset: 99, total: 5 },
    });

    useFleetLearningStore.getState().reset();

    const state = useFleetLearningStore.getState();
    expect(state.rounds).toEqual([]);
    expect(state.selectedRound).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.pagination).toEqual({ limit: 20, offset: 0, total: 0 });
  });

  // --------------------------------------------------------------------------
  // SELECTORS
  // --------------------------------------------------------------------------

  it('plain selectors return the corresponding slice', () => {
    const round = makeRound({ id: 'r1' });
    const participant = makeParticipant();
    const budget = makeBudget();
    useFleetLearningStore.setState({
      rounds: [round],
      selectedRound: round,
      participants: [participant],
      privacyBudgets: [budget],
      convergenceData: [],
      filters: { status: 'training' },
      pagination: { limit: 20, offset: 0, total: 1 },
      isLoading: true,
      error: 'e',
    });
    const state = useFleetLearningStore.getState();

    expect(selectRounds(state)).toEqual([round]);
    expect(selectSelectedRound(state)).toEqual(round);
    expect(selectParticipants(state)).toEqual([participant]);
    expect(selectPrivacyBudgets(state)).toEqual([budget]);
    expect(selectROHEMetrics(state)).toBeNull();
    expect(selectConvergenceData(state)).toEqual([]);
    expect(selectFilters(state)).toEqual({ status: 'training' });
    expect(selectPagination(state)).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(selectIsLoading(state)).toBe(true);
    expect(selectError(state)).toBe('e');
  });

  it('selectRoundById finds the matching round or returns undefined', () => {
    const round = makeRound({ id: 'find-me' });
    useFleetLearningStore.setState({ rounds: [round] });
    const state = useFleetLearningStore.getState();

    expect(selectRoundById('find-me')(state)).toEqual(round);
    expect(selectRoundById('nope')(state)).toBeUndefined();
  });

  it('selectActiveRounds returns only in-progress statuses', () => {
    const statuses: FederatedRoundStatus[] = [
      'created',
      'selecting',
      'distributing',
      'training',
      'collecting',
      'aggregating',
      'completed',
      'failed',
      'cancelled',
    ];
    const rounds = statuses.map((status, i) => makeRound({ id: `r${i}`, status }));
    useFleetLearningStore.setState({ rounds });

    const active = selectActiveRounds(useFleetLearningStore.getState());
    expect(active.map((r) => r.status).sort()).toEqual(
      ['aggregating', 'collecting', 'distributing', 'selecting', 'training'].sort()
    );
  });

  it('selectCompletedRounds returns only completed rounds', () => {
    useFleetLearningStore.setState({
      rounds: [
        makeRound({ id: 'a', status: 'completed' }),
        makeRound({ id: 'b', status: 'training' }),
        makeRound({ id: 'c', status: 'completed' }),
      ],
    });

    const completed = selectCompletedRounds(useFleetLearningStore.getState());
    expect(completed.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('selectLowPrivacyBudgetRobots filters by threshold (default 1.0)', () => {
    useFleetLearningStore.setState({
      privacyBudgets: [
        makeBudget({ robotId: 'low', remainingEpsilon: 0.5 }),
        makeBudget({ robotId: 'mid', remainingEpsilon: 1.0 }),
        makeBudget({ robotId: 'high', remainingEpsilon: 5 }),
      ],
    });
    const state = useFleetLearningStore.getState();

    expect(selectLowPrivacyBudgetRobots()(state).map((b) => b.robotId)).toEqual(['low']);
    expect(selectLowPrivacyBudgetRobots(2)(state).map((b) => b.robotId)).toEqual(['low', 'mid']);
  });
});

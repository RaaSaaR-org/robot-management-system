/**
 * @file datacollectionStore.test.ts
 * @description Tests for the data collection Zustand store
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useDataCollectionStore,
  selectSessions,
  selectSelectedSession,
  selectActiveSession,
  selectQualityFeedback,
  selectSessionFilters,
  selectSessionPagination,
  selectUncertaintyAnalysis,
  selectCollectionPriorities,
  selectIsLoading,
  selectError,
  selectSessionById,
  selectHighPriorityTargets,
} from '../datacollectionStore';
import { DEFAULT_SESSION_PAGINATION } from '../../types/datacollection.types';
import type {
  TeleoperationSession,
  UncertaintyAnalysis,
  CollectionPriority,
  QualityFeedback,
  SessionPagination,
} from '../../types/datacollection.types';

// Mock the api module the store imports
vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: {
    listSessions: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    startSession: vi.fn(),
    pauseSession: vi.fn(),
    resumeSession: vi.fn(),
    endSession: vi.fn(),
    annotateSession: vi.fn(),
    exportSession: vi.fn(),
    getUncertainty: vi.fn(),
    getPriorities: vi.fn(),
    logPrediction: vi.fn(),
  },
}));

import { datacollectionApi } from '../../api/datacollectionApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeSession(overrides: Partial<TeleoperationSession> = {}): TeleoperationSession {
  return {
    id: 'sess-1',
    operatorId: 'op-1',
    robotId: 'rob-1',
    type: 'gamepad',
    status: 'created',
    startedAt: null,
    endedAt: null,
    frameCount: 0,
    duration: null,
    fps: 30,
    languageInstr: null,
    qualityScore: null,
    exportedDatasetId: null,
    errorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePriority(overrides: Partial<CollectionPriority> = {}): CollectionPriority {
  return {
    target: 'pick cube',
    targetType: 'task',
    priorityScore: 0.7,
    uncertaintyComponent: 0.5,
    diversityComponent: 0.5,
    progressComponent: 0.5,
    estimatedDemosNeeded: 10,
    currentDemoCount: 2,
    recommendation: 'collect more',
    reasoning: ['high uncertainty'],
    ...overrides,
  };
}

function resetStore() {
  useDataCollectionStore.setState({
    sessions: [],
    selectedSession: null,
    activeSession: null,
    qualityFeedback: null,
    sessionFilters: {},
    sessionPagination: { ...DEFAULT_SESSION_PAGINATION },
    uncertaintyAnalysis: null,
    collectionPriorities: [],
    collectionTargets: [],
    isLoading: false,
    error: null,
  });
}

describe('datacollectionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('starts with the expected initial state', () => {
    const s = useDataCollectionStore.getState();
    expect(s.sessions).toEqual([]);
    expect(s.selectedSession).toBeNull();
    expect(s.activeSession).toBeNull();
    expect(s.qualityFeedback).toBeNull();
    expect(s.sessionFilters).toEqual({});
    expect(s.sessionPagination).toEqual(DEFAULT_SESSION_PAGINATION);
    expect(s.uncertaintyAnalysis).toBeNull();
    expect(s.collectionPriorities).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  // --------------------------------------------------------------------------
  // fetchSessions
  // --------------------------------------------------------------------------

  describe('fetchSessions', () => {
    it('loads sessions, sends filters + pagination, and stores pagination (success)', async () => {
      const session = makeSession();
      const pagination: SessionPagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
      vi.mocked(datacollectionApi.listSessions).mockResolvedValue({
        sessions: [session],
        pagination,
      });

      useDataCollectionStore.setState({
        sessionFilters: { robotId: 'rob-1' },
        sessionPagination: { page: 2, limit: 20, total: 0, totalPages: 0 },
      });

      await useDataCollectionStore.getState().fetchSessions();

      expect(datacollectionApi.listSessions).toHaveBeenCalledWith({
        robotId: 'rob-1',
        page: 2,
        limit: 20,
      });
      const s = useDataCollectionStore.getState();
      expect(s.sessions).toEqual([session]);
      expect(s.sessionPagination).toEqual(pagination);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('maps an error code to a friendly message (error)', async () => {
      vi.mocked(datacollectionApi.listSessions).mockRejectedValue({ code: 'NETWORK_ERROR' });

      await useDataCollectionStore.getState().fetchSessions();

      const s = useDataCollectionStore.getState();
      expect(s.error).toBe('Unable to connect to the server');
      expect(s.isLoading).toBe(false);
    });

    it('falls back to UNKNOWN_ERROR message for opaque errors', async () => {
      vi.mocked(datacollectionApi.listSessions).mockRejectedValue(42);
      await useDataCollectionStore.getState().fetchSessions();
      expect(useDataCollectionStore.getState().error).toBe('An unexpected error occurred');
    });
  });

  // --------------------------------------------------------------------------
  // fetchSession
  // --------------------------------------------------------------------------

  describe('fetchSession', () => {
    it('sets selectedSession and updates the matching list entry', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', frameCount: 0 })],
      });
      const updated = makeSession({ id: 'sess-1', frameCount: 99 });
      vi.mocked(datacollectionApi.getSession).mockResolvedValue(updated);

      await useDataCollectionStore.getState().fetchSession('sess-1');

      const s = useDataCollectionStore.getState();
      expect(s.selectedSession).toEqual(updated);
      expect(s.sessions[0].frameCount).toBe(99);
      expect(s.isLoading).toBe(false);
    });

    it('does not add a list entry when session not already present', async () => {
      const fetched = makeSession({ id: 'new' });
      vi.mocked(datacollectionApi.getSession).mockResolvedValue(fetched);

      await useDataCollectionStore.getState().fetchSession('new');

      expect(useDataCollectionStore.getState().sessions).toEqual([]);
      expect(useDataCollectionStore.getState().selectedSession).toEqual(fetched);
    });

    it('records error message (error)', async () => {
      vi.mocked(datacollectionApi.getSession).mockRejectedValue({ message: 'gone' });
      await useDataCollectionStore.getState().fetchSession('x');
      expect(useDataCollectionStore.getState().error).toBe('gone');
      expect(useDataCollectionStore.getState().isLoading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // createSession
  // --------------------------------------------------------------------------

  describe('createSession', () => {
    it('prepends the session, selects it, returns it (success)', async () => {
      useDataCollectionStore.setState({ sessions: [makeSession({ id: 'old' })] });
      const created = makeSession({ id: 'new' });
      vi.mocked(datacollectionApi.createSession).mockResolvedValue(created);

      const result = await useDataCollectionStore
        .getState()
        .createSession({ robotId: 'rob-1', type: 'gamepad' } as never);

      expect(result).toEqual(created);
      const s = useDataCollectionStore.getState();
      expect(s.sessions.map((x) => x.id)).toEqual(['new', 'old']);
      expect(s.selectedSession).toEqual(created);
      expect(s.isLoading).toBe(false);
    });

    it('throws with mapped message and sets error (error)', async () => {
      vi.mocked(datacollectionApi.createSession).mockRejectedValue({ code: 'ROBOT_NOT_AVAILABLE' });

      await expect(
        useDataCollectionStore.getState().createSession({ robotId: 'r' } as never)
      ).rejects.toThrow('Robot is not available for teleoperation');

      const s = useDataCollectionStore.getState();
      expect(s.error).toBe('Robot is not available for teleoperation');
      expect(s.isLoading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // startSession
  // --------------------------------------------------------------------------

  describe('startSession', () => {
    it('sets active + selected session and updates list', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', status: 'created' })],
      });
      const started = makeSession({ id: 'sess-1', status: 'recording' });
      vi.mocked(datacollectionApi.startSession).mockResolvedValue(started);

      await useDataCollectionStore.getState().startSession('sess-1');

      const s = useDataCollectionStore.getState();
      expect(s.activeSession).toEqual(started);
      expect(s.selectedSession).toEqual(started);
      expect(s.sessions[0].status).toBe('recording');
    });

    it('throws mapped message on error', async () => {
      vi.mocked(datacollectionApi.startSession).mockRejectedValue({ code: 'SESSION_ALREADY_STARTED' });
      await expect(useDataCollectionStore.getState().startSession('x')).rejects.toThrow(
        'Session has already been started'
      );
      expect(useDataCollectionStore.getState().error).toBe('Session has already been started');
    });
  });

  // --------------------------------------------------------------------------
  // pauseSession
  // --------------------------------------------------------------------------

  describe('pauseSession', () => {
    it('updates active session only when ids match', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', status: 'recording' })],
        activeSession: makeSession({ id: 'sess-1', status: 'recording' }),
      });
      const paused = makeSession({ id: 'sess-1', status: 'paused' });
      vi.mocked(datacollectionApi.pauseSession).mockResolvedValue(paused);

      await useDataCollectionStore.getState().pauseSession('sess-1');

      const s = useDataCollectionStore.getState();
      expect(s.activeSession?.status).toBe('paused');
      expect(s.selectedSession?.status).toBe('paused');
      expect(s.sessions[0].status).toBe('paused');
    });

    it('leaves active session unchanged when active id differs', async () => {
      useDataCollectionStore.setState({
        activeSession: makeSession({ id: 'other', status: 'recording' }),
      });
      vi.mocked(datacollectionApi.pauseSession).mockResolvedValue(
        makeSession({ id: 'sess-1', status: 'paused' })
      );

      await useDataCollectionStore.getState().pauseSession('sess-1');

      expect(useDataCollectionStore.getState().activeSession?.status).toBe('recording');
    });
  });

  // --------------------------------------------------------------------------
  // resumeSession
  // --------------------------------------------------------------------------

  describe('resumeSession', () => {
    it('sets active + selected and updates list', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', status: 'paused' })],
      });
      const resumed = makeSession({ id: 'sess-1', status: 'recording' });
      vi.mocked(datacollectionApi.resumeSession).mockResolvedValue(resumed);

      await useDataCollectionStore.getState().resumeSession('sess-1');

      const s = useDataCollectionStore.getState();
      expect(s.activeSession).toEqual(resumed);
      expect(s.sessions[0].status).toBe('recording');
    });
  });

  // --------------------------------------------------------------------------
  // endSession
  // --------------------------------------------------------------------------

  describe('endSession', () => {
    it('clears active session, quality feedback, sets selected + list', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', status: 'recording' })],
        activeSession: makeSession({ id: 'sess-1', status: 'recording' }),
        qualityFeedback: { sessionId: 'sess-1', currentSmoothnessScore: 0.5, isJerky: false },
      });
      const ended = makeSession({ id: 'sess-1', status: 'completed' });
      vi.mocked(datacollectionApi.endSession).mockResolvedValue(ended);

      await useDataCollectionStore.getState().endSession('sess-1');

      const s = useDataCollectionStore.getState();
      expect(s.activeSession).toBeNull();
      expect(s.qualityFeedback).toBeNull();
      expect(s.selectedSession?.status).toBe('completed');
      expect(s.sessions[0].status).toBe('completed');
    });

    it('keeps active session when ending a different session', async () => {
      useDataCollectionStore.setState({
        activeSession: makeSession({ id: 'other', status: 'recording' }),
      });
      vi.mocked(datacollectionApi.endSession).mockResolvedValue(
        makeSession({ id: 'sess-1', status: 'completed' })
      );

      await useDataCollectionStore.getState().endSession('sess-1');

      expect(useDataCollectionStore.getState().activeSession?.id).toBe('other');
    });

    it('throws mapped message on error', async () => {
      vi.mocked(datacollectionApi.endSession).mockRejectedValue({ code: 'SESSION_NOT_RECORDING' });
      await expect(useDataCollectionStore.getState().endSession('x')).rejects.toThrow(
        'Session is not currently recording'
      );
    });
  });

  // --------------------------------------------------------------------------
  // annotateSession
  // --------------------------------------------------------------------------

  describe('annotateSession', () => {
    it('updates selected session and list', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', languageInstr: null })],
      });
      const annotated = makeSession({ id: 'sess-1', languageInstr: 'pick the cube' });
      vi.mocked(datacollectionApi.annotateSession).mockResolvedValue(annotated);

      await useDataCollectionStore.getState().annotateSession('sess-1', 'pick the cube');

      expect(datacollectionApi.annotateSession).toHaveBeenCalledWith('sess-1', {
        languageInstr: 'pick the cube',
      });
      const s = useDataCollectionStore.getState();
      expect(s.selectedSession?.languageInstr).toBe('pick the cube');
      expect(s.sessions[0].languageInstr).toBe('pick the cube');
    });
  });

  // --------------------------------------------------------------------------
  // exportSession
  // --------------------------------------------------------------------------

  describe('exportSession', () => {
    it('exports, refetches session, updates state, returns result (success)', async () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'sess-1', exportedDatasetId: null })],
      });
      const exportResult = { datasetId: 'ds-9', episodeCount: 3 } as never;
      const refreshed = makeSession({ id: 'sess-1', exportedDatasetId: 'ds-9' });
      vi.mocked(datacollectionApi.exportSession).mockResolvedValue(exportResult);
      vi.mocked(datacollectionApi.getSession).mockResolvedValue(refreshed);

      const result = await useDataCollectionStore
        .getState()
        .exportSession('sess-1', { format: 'lerobot' } as never);

      expect(result).toBe(exportResult);
      const s = useDataCollectionStore.getState();
      expect(s.selectedSession?.exportedDatasetId).toBe('ds-9');
      expect(s.sessions[0].exportedDatasetId).toBe('ds-9');
      expect(s.isLoading).toBe(false);
    });

    it('throws mapped message and clears loading on error', async () => {
      vi.mocked(datacollectionApi.exportSession).mockRejectedValue({ code: 'EXPORT_FAILED' });

      await expect(
        useDataCollectionStore.getState().exportSession('sess-1', {} as never)
      ).rejects.toThrow('Failed to export session');
      expect(useDataCollectionStore.getState().isLoading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Synchronous setters
  // --------------------------------------------------------------------------

  describe('synchronous setters', () => {
    it('selectSession sets selectedSession', () => {
      const session = makeSession();
      useDataCollectionStore.getState().selectSession(session);
      expect(useDataCollectionStore.getState().selectedSession).toEqual(session);
      useDataCollectionStore.getState().selectSession(null);
      expect(useDataCollectionStore.getState().selectedSession).toBeNull();
    });

    it('setActiveSession sets activeSession', () => {
      const session = makeSession();
      useDataCollectionStore.getState().setActiveSession(session);
      expect(useDataCollectionStore.getState().activeSession).toEqual(session);
    });

    it('setQualityFeedback sets qualityFeedback', () => {
      const fb: QualityFeedback = { sessionId: 'sess-1', currentSmoothnessScore: 0.8, isJerky: false };
      useDataCollectionStore.getState().setQualityFeedback(fb);
      expect(useDataCollectionStore.getState().qualityFeedback).toEqual(fb);
    });

    it('clearError resets error', () => {
      useDataCollectionStore.setState({ error: 'boom' });
      useDataCollectionStore.getState().clearError();
      expect(useDataCollectionStore.getState().error).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Filter + pagination setters (these call fetchSessions internally)
  // --------------------------------------------------------------------------

  describe('filter and pagination setters', () => {
    beforeEach(() => {
      vi.mocked(datacollectionApi.listSessions).mockResolvedValue({
        sessions: [],
        pagination: { ...DEFAULT_SESSION_PAGINATION },
      });
    });

    it('setSessionFilters merges filters, resets page to 1, and fetches', () => {
      useDataCollectionStore.setState({
        sessionFilters: { robotId: 'rob-1' },
        sessionPagination: { page: 3, limit: 20, total: 0, totalPages: 0 },
      });

      useDataCollectionStore.getState().setSessionFilters({ status: 'recording' });

      const s = useDataCollectionStore.getState();
      expect(s.sessionFilters).toEqual({ robotId: 'rob-1', status: 'recording' });
      expect(s.sessionPagination.page).toBe(1);
      expect(datacollectionApi.listSessions).toHaveBeenCalled();
    });

    it('clearSessionFilters empties filters, resets page, and fetches', () => {
      useDataCollectionStore.setState({
        sessionFilters: { robotId: 'rob-1' },
        sessionPagination: { page: 4, limit: 20, total: 0, totalPages: 0 },
      });

      useDataCollectionStore.getState().clearSessionFilters();

      const s = useDataCollectionStore.getState();
      expect(s.sessionFilters).toEqual({});
      expect(s.sessionPagination.page).toBe(1);
      expect(datacollectionApi.listSessions).toHaveBeenCalled();
    });

    it('setSessionPage updates the page and fetches', () => {
      useDataCollectionStore.getState().setSessionPage(5);
      expect(useDataCollectionStore.getState().sessionPagination.page).toBe(5);
      expect(datacollectionApi.listSessions).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Active learning
  // --------------------------------------------------------------------------

  describe('fetchUncertainty', () => {
    it('stores analysis on success', async () => {
      const analysis: UncertaintyAnalysis = {
        modelId: 'm-1',
        analysisDate: '2026-01-01',
        byTask: {},
        byEnvironment: {},
        overallUncertainty: 0.4,
        totalPredictions: 100,
        highUncertaintyCount: 5,
        highUncertaintyThreshold: 0.8,
      };
      vi.mocked(datacollectionApi.getUncertainty).mockResolvedValue(analysis);

      await useDataCollectionStore.getState().fetchUncertainty({ modelId: 'm-1' } as never);

      const s = useDataCollectionStore.getState();
      expect(s.uncertaintyAnalysis).toEqual(analysis);
      expect(s.isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.mocked(datacollectionApi.getUncertainty).mockRejectedValue({ message: 'bad' });
      await useDataCollectionStore.getState().fetchUncertainty({ modelId: 'm-1' } as never);
      expect(useDataCollectionStore.getState().error).toBe('bad');
      expect(useDataCollectionStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchPriorities', () => {
    it('stores priorities on success', async () => {
      const priorities = [makePriority({ target: 'a' })];
      vi.mocked(datacollectionApi.getPriorities).mockResolvedValue({ priorities } as never);

      await useDataCollectionStore.getState().fetchPriorities();

      const s = useDataCollectionStore.getState();
      expect(s.collectionPriorities).toEqual(priorities);
      expect(s.isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.mocked(datacollectionApi.getPriorities).mockRejectedValue({ code: 'UNKNOWN_ERROR' });
      await useDataCollectionStore.getState().fetchPriorities();
      expect(useDataCollectionStore.getState().error).toBe('An unexpected error occurred');
    });
  });

  describe('logPrediction', () => {
    it('does nothing visible on success', async () => {
      vi.mocked(datacollectionApi.logPrediction).mockResolvedValue({ id: 'p1', logged: true });
      await useDataCollectionStore.getState().logPrediction({} as never);
      expect(useDataCollectionStore.getState().error).toBeNull();
    });

    it('swallows the error into state.error (does not throw)', async () => {
      vi.mocked(datacollectionApi.logPrediction).mockRejectedValue({ message: 'log failed' });
      await expect(useDataCollectionStore.getState().logPrediction({} as never)).resolves.toBeUndefined();
      expect(useDataCollectionStore.getState().error).toBe('log failed');
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('restores initial state', () => {
      useDataCollectionStore.setState({
        sessions: [makeSession()],
        selectedSession: makeSession(),
        error: 'err',
        isLoading: true,
        collectionPriorities: [makePriority()],
      });

      useDataCollectionStore.getState().reset();

      const s = useDataCollectionStore.getState();
      expect(s.sessions).toEqual([]);
      expect(s.selectedSession).toBeNull();
      expect(s.error).toBeNull();
      expect(s.isLoading).toBe(false);
      expect(s.collectionPriorities).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Selectors
  // --------------------------------------------------------------------------

  describe('selectors', () => {
    it('plain selectors read through state', () => {
      const session = makeSession({ id: 's1' });
      const active = makeSession({ id: 's2', status: 'recording' });
      useDataCollectionStore.setState({
        sessions: [session],
        selectedSession: session,
        activeSession: active,
        qualityFeedback: { sessionId: 's1', currentSmoothnessScore: 0.5, isJerky: true },
        sessionFilters: { robotId: 'r' },
        isLoading: true,
        error: 'e',
      });
      const s = useDataCollectionStore.getState();
      expect(selectSessions(s)).toEqual([session]);
      expect(selectSelectedSession(s)).toEqual(session);
      expect(selectActiveSession(s)).toEqual(active);
      expect(selectQualityFeedback(s)?.isJerky).toBe(true);
      expect(selectSessionFilters(s)).toEqual({ robotId: 'r' });
      expect(selectSessionPagination(s)).toEqual(DEFAULT_SESSION_PAGINATION);
      expect(selectIsLoading(s)).toBe(true);
      expect(selectError(s)).toBe('e');
      expect(selectUncertaintyAnalysis(s)).toBeNull();
      expect(selectCollectionPriorities(s)).toEqual([]);
    });

    it('selectSessionById finds a session or returns null', () => {
      useDataCollectionStore.setState({
        sessions: [makeSession({ id: 'a' }), makeSession({ id: 'b' })],
      });
      const s = useDataCollectionStore.getState();
      expect(selectSessionById('b')(s)?.id).toBe('b');
      expect(selectSessionById('missing')(s)).toBeNull();
    });

    it('selectHighPriorityTargets filters by priorityScore >= 0.6', () => {
      useDataCollectionStore.setState({
        collectionPriorities: [
          makePriority({ target: 'hi', priorityScore: 0.6 }),
          makePriority({ target: 'higher', priorityScore: 0.9 }),
          makePriority({ target: 'lo', priorityScore: 0.59 }),
        ],
      });
      const result = selectHighPriorityTargets(useDataCollectionStore.getState());
      expect(result.map((p) => p.target)).toEqual(['hi', 'higher']);
    });
  });
});

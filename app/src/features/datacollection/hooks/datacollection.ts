/**
 * @file datacollection.ts
 * @description React hooks for data collection feature functionality
 * @feature datacollection
 * @dependencies @/features/datacollection/store
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
} from '../store/datacollectionStore';
import type {
  TeleoperationSession,
  CollectionPriority,
  SessionFilters,
  CreateSessionRequest,
  ExportSessionRequest,
  GetUncertaintyParams,
  GetPrioritiesParams,
} from '../types/datacollection.types';

// ============================================================================
// RETURN TYPE INTERFACES
// ============================================================================

export interface UseTeleoperationSessionsReturn {
  sessions: TeleoperationSession[];
  filters: SessionFilters;
  pagination: ReturnType<typeof selectSessionPagination>;
  isLoading: boolean;
  error: string | null;
  fetchSessions: () => Promise<void>;
  setFilters: (filters: Partial<SessionFilters>) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
  clearError: () => void;
}

export interface UseActiveSessionReturn {
  session: TeleoperationSession | null;
  qualityFeedback: ReturnType<typeof selectQualityFeedback>;
  isLoading: boolean;
  error: string | null;
  createSession: (data: CreateSessionRequest) => Promise<TeleoperationSession>;
  startSession: () => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  endSession: () => Promise<void>;
  annotateSession: (languageInstr: string) => Promise<void>;
  exportSession: (data: ExportSessionRequest) => Promise<void>;
}

export interface UseSessionDetailReturn {
  session: TeleoperationSession | null;
  isLoading: boolean;
  error: string | null;
  fetchSession: () => Promise<void>;
  annotateSession: (languageInstr: string) => Promise<void>;
  exportSession: (data: ExportSessionRequest) => Promise<void>;
}

export interface UseCollectionPrioritiesReturn {
  priorities: ReturnType<typeof selectCollectionPriorities>;
  highPriorityTargets: CollectionPriority[];
  isLoading: boolean;
  error: string | null;
  fetchPriorities: (params?: GetPrioritiesParams) => Promise<void>;
}

export interface UseUncertaintyAnalysisReturn {
  analysis: ReturnType<typeof selectUncertaintyAnalysis>;
  isLoading: boolean;
  error: string | null;
  fetchUncertainty: (params: GetUncertaintyParams) => Promise<void>;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for managing teleoperation sessions list
 */
export function useTeleoperationSessions(): UseTeleoperationSessionsReturn {
  const sessions = useDataCollectionStore(selectSessions);
  const filters = useDataCollectionStore(selectSessionFilters);
  const pagination = useDataCollectionStore(selectSessionPagination);
  const isLoading = useDataCollectionStore(selectIsLoading);
  const error = useDataCollectionStore(selectError);

  const storeFetchSessions = useDataCollectionStore((state) => state.fetchSessions);
  const storeSetFilters = useDataCollectionStore((state) => state.setSessionFilters);
  const storeClearFilters = useDataCollectionStore((state) => state.clearSessionFilters);
  const storeSetPage = useDataCollectionStore((state) => state.setSessionPage);
  const storeClearError = useDataCollectionStore((state) => state.clearError);

  const fetchSessions = useCallback(async () => {
    await storeFetchSessions();
  }, [storeFetchSessions]);

  const setFilters = useCallback(
    (newFilters: Partial<SessionFilters>) => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  const clearFilters = useCallback(() => {
    storeClearFilters();
  }, [storeClearFilters]);

  const setPage = useCallback(
    (page: number) => {
      storeSetPage(page);
    },
    [storeSetPage]
  );

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return useMemo(
    () => ({
      sessions,
      filters,
      pagination,
      isLoading,
      error,
      fetchSessions,
      setFilters,
      clearFilters,
      setPage,
      clearError,
    }),
    [
      sessions,
      filters,
      pagination,
      isLoading,
      error,
      fetchSessions,
      setFilters,
      clearFilters,
      setPage,
      clearError,
    ]
  );
}

/**
 * Hook for managing the active teleoperation session
 */
export function useActiveSession(): UseActiveSessionReturn {
  const session = useDataCollectionStore(selectActiveSession);
  const qualityFeedback = useDataCollectionStore(selectQualityFeedback);
  const isLoading = useDataCollectionStore(selectIsLoading);
  const error = useDataCollectionStore(selectError);

  const storeCreateSession = useDataCollectionStore((state) => state.createSession);
  const storeStartSession = useDataCollectionStore((state) => state.startSession);
  const storePauseSession = useDataCollectionStore((state) => state.pauseSession);
  const storeResumeSession = useDataCollectionStore((state) => state.resumeSession);
  const storeEndSession = useDataCollectionStore((state) => state.endSession);
  const storeAnnotateSession = useDataCollectionStore((state) => state.annotateSession);
  const storeExportSession = useDataCollectionStore((state) => state.exportSession);

  const createSession = useCallback(
    async (data: CreateSessionRequest) => {
      return storeCreateSession(data);
    },
    [storeCreateSession]
  );

  const startSession = useCallback(async () => {
    if (session?.id) {
      await storeStartSession(session.id);
    }
  }, [session?.id, storeStartSession]);

  const pauseSession = useCallback(async () => {
    if (session?.id) {
      await storePauseSession(session.id);
    }
  }, [session?.id, storePauseSession]);

  const resumeSession = useCallback(async () => {
    if (session?.id) {
      await storeResumeSession(session.id);
    }
  }, [session?.id, storeResumeSession]);

  const endSession = useCallback(async () => {
    if (session?.id) {
      await storeEndSession(session.id);
    }
  }, [session?.id, storeEndSession]);

  const annotateSession = useCallback(
    async (languageInstr: string) => {
      if (session?.id) {
        await storeAnnotateSession(session.id, languageInstr);
      }
    },
    [session?.id, storeAnnotateSession]
  );

  const exportSession = useCallback(
    async (data: ExportSessionRequest) => {
      if (session?.id) {
        await storeExportSession(session.id, data);
      }
    },
    [session?.id, storeExportSession]
  );

  return useMemo(
    () => ({
      session,
      qualityFeedback,
      isLoading,
      error,
      createSession,
      startSession,
      pauseSession,
      resumeSession,
      endSession,
      annotateSession,
      exportSession,
    }),
    [
      session,
      qualityFeedback,
      isLoading,
      error,
      createSession,
      startSession,
      pauseSession,
      resumeSession,
      endSession,
      annotateSession,
      exportSession,
    ]
  );
}

/**
 * Hook for viewing session details
 */
export function useSessionDetail(id: string): UseSessionDetailReturn {
  const selectedSession = useDataCollectionStore(selectSelectedSession);
  const sessions = useDataCollectionStore(selectSessions);
  const isLoading = useDataCollectionStore(selectIsLoading);
  const error = useDataCollectionStore(selectError);

  // Derive session from list via useMemo instead of selectSessionById(id) which
  // creates a new selector function on every render, violating useSyncExternalStore's contract.
  const sessionFromList = useMemo(
    () => sessions.find((s) => s.id === id) ?? null,
    [sessions, id]
  );

  const session = selectedSession?.id === id ? selectedSession : sessionFromList;

  const storeFetchSession = useDataCollectionStore((state) => state.fetchSession);
  const storeAnnotateSession = useDataCollectionStore((state) => state.annotateSession);
  const storeExportSession = useDataCollectionStore((state) => state.exportSession);

  const fetchSession = useCallback(async () => {
    await storeFetchSession(id);
  }, [id, storeFetchSession]);

  const annotateSession = useCallback(
    async (languageInstr: string) => {
      await storeAnnotateSession(id, languageInstr);
    },
    [id, storeAnnotateSession]
  );

  const exportSession = useCallback(
    async (data: ExportSessionRequest) => {
      await storeExportSession(id, data);
    },
    [id, storeExportSession]
  );

  // Only fetch once on mount; do not re-fetch on session change to avoid
  // infinite loop (fetch fails → session stays null → re-fetch → ...)
  const hasFetched = useRef(false);
  useEffect(() => {
    if (!session && !hasFetched.current) {
      hasFetched.current = true;
      fetchSession();
    }
  }, [session, fetchSession]);

  return useMemo(
    () => ({
      session,
      isLoading,
      error,
      fetchSession,
      annotateSession,
      exportSession,
    }),
    [session, isLoading, error, fetchSession, annotateSession, exportSession]
  );
}

/**
 * Hook for collection priorities
 */
export function useCollectionPriorities(
  modelId?: string
): UseCollectionPrioritiesReturn {
  const priorities = useDataCollectionStore(selectCollectionPriorities);
  const isLoading = useDataCollectionStore(selectIsLoading);
  const error = useDataCollectionStore(selectError);

  // Derive highPriorityTargets via useMemo instead of store selector.
  // Using .filter() directly in a Zustand selector violates useSyncExternalStore's
  // contract (must return same reference for unchanged state) and causes infinite re-renders.
  const highPriorityTargets = useMemo(
    () => priorities.filter((p) => p.priorityScore >= 0.6),
    [priorities]
  );

  const storeFetchPriorities = useDataCollectionStore((state) => state.fetchPriorities);

  const fetchPriorities = useCallback(
    async (params?: GetPrioritiesParams) => {
      await storeFetchPriorities(params);
    },
    [storeFetchPriorities]
  );

  useEffect(() => {
    fetchPriorities({ modelId });
  }, [fetchPriorities, modelId]);

  return useMemo(
    () => ({
      priorities,
      highPriorityTargets,
      isLoading,
      error,
      fetchPriorities,
    }),
    [priorities, highPriorityTargets, isLoading, error, fetchPriorities]
  );
}

/**
 * Hook for uncertainty analysis
 */
export function useUncertaintyAnalysis(
  modelId: string
): UseUncertaintyAnalysisReturn {
  const analysis = useDataCollectionStore(selectUncertaintyAnalysis);
  const isLoading = useDataCollectionStore(selectIsLoading);
  const error = useDataCollectionStore(selectError);

  const storeFetchUncertainty = useDataCollectionStore((state) => state.fetchUncertainty);

  const fetchUncertainty = useCallback(
    async (params: GetUncertaintyParams) => {
      await storeFetchUncertainty(params);
    },
    [storeFetchUncertainty]
  );

  useEffect(() => {
    if (modelId) {
      fetchUncertainty({ modelId, groupBy: 'both' });
    }
  }, [fetchUncertainty, modelId]);

  return useMemo(
    () => ({
      analysis,
      isLoading,
      error,
      fetchUncertainty,
    }),
    [analysis, isLoading, error, fetchUncertainty]
  );
}

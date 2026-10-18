/**
 * @file datacollectionStore.ts
 * @description Zustand store for data collection state management
 * @feature datacollection
 * @dependencies @/store, @/features/datacollection/api, @/features/datacollection/types
 * @stateAccess Creates: useDataCollectionStore
 */

import { createStore } from '@/store';
import { toast } from '@/shared/components/ui/toast';
import { errorMessage } from '@/shared/components/ui/errorMessage';
import { playCue } from '@/shared/utils/sessionCues';
import { datacollectionApi } from '../api/datacollectionApi';
import { DEFAULT_SESSION_PAGINATION } from '../types/datacollection.types';
import { describeConflict, describeRemoteAction, takeLabel } from '../utils/takeFormat';
import { forgetThumbnail } from '../utils/takeThumbnailCache';
import { streakFromLive, type TakeStreak } from '../utils/takeStreak';
import type {
  DataCollectionStore,
  TeleoperationSession,
  UncertaintyAnalysis,
  CollectionPriority,
  CollectionTarget,
  QualityFeedback,
  EpisodeSummary,
  TeleopRecordingProgress,
  TeleopWsEvent,
  SessionFilters,
  SessionPagination,
  DataCollectionErrorCode,
  CreateSessionRequest,
  ExportSessionRequest,
  ExportResultResponse,
  LogPredictionRequest,
  GetUncertaintyParams,
  GetPrioritiesParams,
  EpisodeActionBody,
  EpisodeActionResult,
  EpisodeActor,
  EpisodeSource,
  EpisodeStopReason,
  LiveState,
  QuickCheck,
  TakeAction,
  OperatorSnapshot,
  PresenceViewer,
} from '../types/datacollection.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

/** One id per tab, so this tab can tell its own events from everyone else's. */
export const CLIENT_ID: string = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* insecure context: fall through */
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
})();

const initialState = {
  // Teleoperation
  sessions: [] as TeleoperationSession[],
  selectedSession: null as TeleoperationSession | null,
  activeSession: null as TeleoperationSession | null,
  qualityFeedback: null as QualityFeedback | null,
  episodes: [] as EpisodeSummary[],
  recordingProgress: null as TeleopRecordingProgress | null,
  live: null as LiveState | null,
  liveClockOffsetMs: 0,
  lastQuickCheck: null as QuickCheck | null,
  takePending: null as TakeAction | null,
  presence: null as { sessionId: string; viewers: PresenceViewer[] } | null,
  operator: null as OperatorSnapshot | null,
  streak: null as TakeStreak | null,
  clientId: CLIENT_ID,
  sessionFilters: {} as SessionFilters,
  sessionPagination: { ...DEFAULT_SESSION_PAGINATION } as SessionPagination,
  // Active Learning
  uncertaintyAnalysis: null as UncertaintyAnalysis | null,
  collectionPriorities: [] as CollectionPriority[],
  collectionTargets: [] as CollectionTarget[],
  // UI State
  isLoading: false,
  error: null as string | null,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const ERROR_MESSAGES: Record<DataCollectionErrorCode, string> = {
  SESSION_NOT_FOUND: 'Session not found',
  SESSION_ALREADY_STARTED: 'Session has already been started',
  SESSION_NOT_RECORDING: 'Session is not currently recording',
  ROBOT_NOT_AVAILABLE: 'Robot is not available for teleoperation',
  EXPORT_FAILED: 'Failed to export session',
  NETWORK_ERROR: 'Unable to connect to the server',
  UNKNOWN_ERROR: 'An unexpected error occurred',
};

// ============================================================================
// STORE
// ============================================================================

export const useDataCollectionStore = createStore<DataCollectionStore>(
  (set, get) => {
    /**
     * Take the server's live state as the truth, and the clock offset with it
     * (D5: both clients count from the server's stamp, not their own clocks).
     */
    const adoptLive = (live: LiveState) => {
      const before = get().live;
      // Only the session on screen: events for every other session also arrive here.
      if (get().selectedSession?.id !== live.sessionId) return;
      const at = Date.parse(live.at);
      set((state) => {
        state.live = live;
        if (Number.isFinite(at)) state.liveClockOffsetMs = at - Date.now();
        // TASK-414: the take streak follows the server's counts, so a take the
        // recorder did not keep (no frames) never extends it, and the same
        // state adopted twice (REST answer + WebSocket echo) counts once.
        state.streak = streakFromLive(state.streak, live);
      });
      // The link to the robot just went bad: one double-low cue on the edge.
      if (live.degraded && before?.sessionId === live.sessionId && !before.degraded) playCue('problem');
    };

    /** An episode event without a live state (an older server): patch what it says. */
    const patchLive = (sessionId: string, kind: EpisodeEventKind, take: number, startedAt?: string) => {
      set((state) => {
        const live = state.live;
        if (!live || live.sessionId !== sessionId) return;
        if (kind === 'started') {
          live.phase = 'capturing';
          live.take = take;
          live.takeStartedAt = startedAt ?? new Date(Date.now() + state.liveClockOffsetMs).toISOString();
          live.takeFrames = 0;
        } else if (kind === 'stopped' && live.take === take) {
          live.phase = 'between';
          live.takeStartedAt = null;
        } else if (kind === 'discarded') {
          live.discarded += 1;
          live.kept = Math.max(0, live.kept - 1);
        }
      });
    };

    /**
     * The cue, toast and quick check for one episode event, exactly once —
     * whichever of the REST answer and the WebSocket event arrives first.
     */
    const announce = (
      sessionId: string,
      kind: EpisodeEventKind,
      take: number,
      by: EpisodeActor | null,
      extra: { quickCheck?: QuickCheck | null; reason?: EpisodeStopReason; startedAt?: string | null }
    ) => {
      if (by) actors.set(`${sessionId}:${kind}:${take}`, by);
      const key = kind === 'started' ? `${sessionId}:started:${take}:${extra.startedAt ?? ''}` : `${sessionId}:${kind}:${take}`;
      if (kind === 'stopped' && extra.quickCheck && get().lastQuickCheck?.take !== take) {
        const quickCheck = extra.quickCheck;
        set((state) => {
          state.lastQuickCheck = quickCheck;
        });
      }
      // TASK-418 (D3): the quick check stays until the next Start — on the
      // desktop card and the headset board alike.
      if (kind === 'started' && get().lastQuickCheck) {
        set((state) => {
          state.lastQuickCheck = null;
        });
      }
      if (kind === 'discarded') {
        set((state) => {
          state.episodes = state.episodes.filter((e) => e.episodeIndex !== take);
          if (state.lastQuickCheck?.take === take) state.lastQuickCheck = null;
        });
      }
      if (announced.has(key)) return;
      announced.add(key);
      if (announced.size > 200) announced.delete(announced.values().next().value as string);
      // The number is reused (a restart, or the take after a discard): drop the old frame.
      // Once per event, so a late WebSocket echo cannot drop a frame loaded since.
      if (kind === 'started' || kind === 'discarded') forgetThumbnail(sessionId, take);

      playCue(kind);
      const own = !by || by.clientId === CLIENT_ID;
      if (own) {
        if (kind === 'discarded') toast.success(`You discarded ${takeLabel(take).toLowerCase()}`, { id: `take-${sessionId}-${take}` });
        return;
      }
      const title = describeRemoteAction(kind, take, by);
      const description = kind === 'stopped' && extra.reason === 'time_limit' ? 'The auto-stop time was reached.' : undefined;
      toast.info(title, { description, id: `take-${sessionId}-${kind}-${take}` });
    };

    /** Shared path of start / stop / next / discard-last. */
    const runTake = async (
      id: string,
      action: TakeAction,
      source: EpisodeSource,
      expectedOverride: number | null | undefined,
      call: (body: EpisodeActionBody) => Promise<EpisodeActionResult>
    ): Promise<boolean> => {
      if (get().takePending) return false;
      const before = get().live?.sessionId === id ? get().live : null;
      const expectedTake = expectedOverride !== undefined ? expectedOverride : before ? before.take : undefined;
      set((state) => {
        state.takePending = action;
      });
      try {
        const result = await call({
          ...(expectedTake !== undefined ? { expectedTake } : {}),
          clientId: CLIENT_ID,
          source,
        });
        if (!result.ok) {
          if (result.live) adoptLive(result.live);
          const take = result.live?.take;
          const kind: EpisodeEventKind = result.code === 'not_capturing' ? 'stopped' : result.code === 'already_discarded' ? 'discarded' : 'started';
          const by = typeof take === 'number' ? actors.get(`${id}:${kind}:${take}`) : undefined;
          toast.info(describeConflict(result.code, result.live, by), { id: `take-conflict-${id}` });
          return false;
        }
        const live = result.live;
        adoptLive(live);
        const own = ownActor(source);
        if (action === 'start' && live.take !== null) {
          announce(id, 'started', live.take, own, { startedAt: live.takeStartedAt });
        } else if (action === 'stop') {
          const quickCheck = result.quickCheck ?? live.lastTake;
          const take = quickCheck?.take ?? before?.take ?? live.take;
          if (typeof take === 'number') announce(id, 'stopped', take, own, { quickCheck, reason: 'operator' });
        } else if (action === 'next') {
          if (before?.phase === 'capturing' && typeof before.take === 'number') {
            announce(id, 'stopped', before.take, own, { quickCheck: live.lastTake?.take === before.take ? live.lastTake : null, reason: 'next' });
          }
          if (live.take !== null) announce(id, 'started', live.take, own, { startedAt: live.takeStartedAt });
        } else if (action === 'discard') {
          const take = result.take ?? before?.take;
          if (typeof take === 'number') announce(id, 'discarded', take, own, {});
        }
        void get().fetchEpisodes(id);
        return true;
      } catch (error) {
        toast.error(`Couldn't ${TAKE_VERB[action]}`, { description: errorMessage(error) });
        return false;
      } finally {
        set((state) => {
          state.takePending = null;
        });
      }
    };

    return ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Fetch Sessions
    // --------------------------------------------------------------------------
    fetchSessions: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const { sessionFilters, sessionPagination } = get();
        const response = await datacollectionApi.listSessions({
          ...sessionFilters,
          page: sessionPagination.page,
          limit: sessionPagination.limit,
        });

        set((state) => {
          state.sessions = response.sessions;
          state.sessionPagination = response.pagination;
          state.isLoading = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Single Session
    // --------------------------------------------------------------------------
    fetchSession: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const session = await datacollectionApi.getSession(id);

        set((state) => {
          state.selectedSession = session;
          state.isLoading = false;
          // Update in list if present
          const index = state.sessions.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.sessions[index] = session;
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Create Session
    // --------------------------------------------------------------------------
    createSession: async (data: CreateSessionRequest) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const session = await datacollectionApi.createSession(data);

        set((state) => {
          state.sessions.unshift(session);
          state.selectedSession = session;
          state.isLoading = false;
        });

        return session;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Start Session
    // --------------------------------------------------------------------------
    startSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.startSession(id);

        set((state) => {
          state.activeSession = session;
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Pause Session
    // --------------------------------------------------------------------------
    pauseSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.pauseSession(id);

        set((state) => {
          if (state.activeSession?.id === id) {
            state.activeSession = session;
          }
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Resume Session
    // --------------------------------------------------------------------------
    resumeSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.resumeSession(id);

        set((state) => {
          state.activeSession = session;
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // End Session
    // --------------------------------------------------------------------------
    endSession: async (id: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.endSession(id);

        set((state) => {
          if (state.activeSession?.id === id) {
            state.activeSession = null;
          }
          state.selectedSession = session;
          state.qualityFeedback = null;
          state.recordingProgress = null;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Annotate Session
    // --------------------------------------------------------------------------
    annotateSession: async (id: string, languageInstr: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        const session = await datacollectionApi.annotateSession(id, { languageInstr });

        set((state) => {
          state.selectedSession = session;
          updateSessionInList(state, session);
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Export Session
    // --------------------------------------------------------------------------
    exportSession: async (
      id: string,
      data: ExportSessionRequest
    ): Promise<ExportResultResponse> => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const result = await datacollectionApi.exportSession(id, data);

        // Refresh session to get updated exportedDatasetId
        const session = await datacollectionApi.getSession(id);

        set((state) => {
          state.selectedSession = session;
          state.isLoading = false;
          updateSessionInList(state, session);
        });

        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Select Session
    // --------------------------------------------------------------------------
    selectSession: (session: TeleoperationSession | null) => {
      set((state) => {
        state.selectedSession = session;
      });
    },

    // --------------------------------------------------------------------------
    // Set Active Session
    // --------------------------------------------------------------------------
    setActiveSession: (session: TeleoperationSession | null) => {
      set((state) => {
        state.activeSession = session;
      });
    },

    // --------------------------------------------------------------------------
    // Set Quality Feedback
    // --------------------------------------------------------------------------
    setQualityFeedback: (feedback: QualityFeedback | null) => {
      set((state) => {
        state.qualityFeedback = feedback;
      });
    },

    // --------------------------------------------------------------------------
    // Episodes
    // --------------------------------------------------------------------------
    fetchEpisodes: async (id: string) => {
      try {
        const episodes = await datacollectionApi.listEpisodes(id);
        set((state) => {
          state.episodes = episodes;
        });
      } catch {
        // Episode summaries are auxiliary — keep the last known list on error
      }
    },

    nextEpisode: async (id: string) => {
      try {
        const episodeIndex = await datacollectionApi.nextEpisode(id);
        set((state) => {
          state.recordingProgress = {
            ...(state.recordingProgress ?? {}),
            currentEpisode: episodeIndex,
          };
        });
        await get().fetchEpisodes(id);
        return episodeIndex;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    discardEpisode: async (id: string, episodeIndex: number) => {
      try {
        await datacollectionApi.discardEpisode(id, episodeIndex);
        await get().fetchEpisodes(id);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Takes (TASK-410): explicit start / stop / next / discard, guarded by
    // the take this tab believes is live. A 409 adopts the server's state.
    // --------------------------------------------------------------------------
    fetchLive: async (id: string) => {
      try {
        adoptLive(await datacollectionApi.getLive(id));
      } catch {
        // Older server, or a blip: the page keeps its last known state.
      }
    },

    startTake: (id, source = 'desktop') =>
      runTake(id, 'start', source, undefined, (body) => datacollectionApi.startEpisode(id, body)),

    stopTake: (id, source = 'desktop') =>
      runTake(id, 'stop', source, undefined, (body) => datacollectionApi.stopEpisode(id, body)),

    nextTake: (id, source = 'desktop') =>
      runTake(id, 'next', source, undefined, (body) => datacollectionApi.nextEpisodeGuarded(id, body)),

    discardLastTake: (id, source = 'desktop', expectedTake) =>
      runTake(id, 'discard', source, expectedTake, (body) => datacollectionApi.discardLast(id, body)),

    discardTake: async (id, take, source = 'desktop') => {
      try {
        const result = await datacollectionApi.discardTake(id, take, { clientId: CLIENT_ID, source });
        if (!result.ok) {
          if (result.live) adoptLive(result.live);
          toast.info(describeConflict(result.code, result.live), { id: `take-conflict-${id}` });
          return false;
        }
        adoptLive(result.live);
        if (result.restarted) {
          toast.info(`${takeLabel(take)} restarted`, { description: 'Its frames were dropped; the take keeps recording.' });
        } else {
          announce(id, 'discarded', take, ownActor(source), {});
        }
        void get().fetchEpisodes(id);
        return true;
      } catch (error) {
        toast.error(`Couldn't discard ${takeLabel(take).toLowerCase()}`, { description: errorMessage(error) });
        return false;
      }
    },

    dismissQuickCheck: () => {
      set((state) => {
        state.lastQuickCheck = null;
      });
    },

    // --------------------------------------------------------------------------
    // WebSocket-driven updates (teleop:* events from /api/a2a/ws)
    // --------------------------------------------------------------------------
    handleTeleopEvent: (event: TeleopWsEvent) => {
      const { sessionId, session, recordingProgress, qualityFeedback } = event.data;

      switch (event.type) {
        // TASK-414: who watches, and the operator's relayed state — the session on screen only.
        case 'teleop:session:presence':
          if (get().selectedSession?.id !== sessionId || !Array.isArray(event.data.viewers)) break;
          set((state) => {
            state.presence = { sessionId, viewers: event.data.viewers! };
          });
          break;

        case 'teleop:operator':
          if (get().selectedSession?.id !== sessionId || !event.data.state) break;
          set((state) => {
            state.operator = {
              sessionId,
              robotId: event.data.robotId ?? null,
              state: event.data.state!,
              receivedAt: Date.now(),
            };
          });
          break;

        case 'teleop:session:live':
          if (event.data.live) adoptLive(event.data.live);
          break;

        case 'teleop:episode:started':
        case 'teleop:episode:stopped':
        case 'teleop:episode:discarded': {
          if (get().selectedSession?.id !== sessionId) break;
          const kind = event.type.slice('teleop:episode:'.length) as EpisodeEventKind;
          const take = typeof event.data.take === 'number' ? event.data.take : event.data.live?.take;
          if (event.data.live) adoptLive(event.data.live);
          else if (typeof take === 'number') patchLive(sessionId, kind, take, event.data.startedAt);
          if (typeof take === 'number') {
            announce(sessionId, kind, take, event.data.by ?? null, {
              quickCheck: event.data.quickCheck ?? null,
              reason: event.data.reason,
              startedAt: event.data.startedAt ?? event.data.live?.takeStartedAt ?? null,
            });
          }
          void get().fetchEpisodes(sessionId);
          break;
        }

        case 'teleop:session:progress':
          set((state) => {
            if (state.selectedSession?.id === sessionId || state.activeSession?.id === sessionId) {
              // Merged, never replaced: an event that carries only some
              // counters must not wipe the others (the "next" wipe, TASK-408).
              state.recordingProgress = mergeProgress(state.recordingProgress, recordingProgress);
              if (qualityFeedback) state.qualityFeedback = normalizeQualityFeedback(qualityFeedback);
              // Keep the visible frame count in sync with the live recorder —
              // while it records. TASK-418: the server emits one last live
              // state AFTER `session:completed`, and an ended session's live
              // state counts 0 frames; copying that over the final count is
              // what made the completed summary read FRAMES 0 until a reload.
              if (
                state.selectedSession?.id === sessionId &&
                (state.selectedSession.status === 'recording' || state.selectedSession.status === 'paused') &&
                typeof recordingProgress?.frameCount === 'number'
              ) {
                state.selectedSession.frameCount = recordingProgress.frameCount;
              }
            }
          });
          break;

        case 'teleop:quality':
          set((state) => {
            if (state.selectedSession?.id === sessionId || state.activeSession?.id === sessionId) {
              if (qualityFeedback) state.qualityFeedback = normalizeQualityFeedback(qualityFeedback);
            }
          });
          break;

        case 'teleop:session:completed':
        case 'teleop:session:started':
        case 'teleop:session:paused':
        case 'teleop:session:resumed':
        case 'teleop:session:failed':
          if (event.type === 'teleop:session:failed' && get().selectedSession?.id === sessionId) {
            playCue('problem');
          }
          if (session) {
            set((state) => {
              if (state.selectedSession?.id === sessionId) state.selectedSession = session;
              if (state.activeSession?.id === sessionId) {
                state.activeSession = session.status === 'completed' ? null : session;
              }
              if (event.type === 'teleop:session:completed') {
                state.recordingProgress = null;
                state.lastQuickCheck = null;
              }
              if (state.live?.sessionId === sessionId) state.live.status = session.status;
              updateSessionInList(state, session);
            });
          }
          break;

        case 'teleop:session:exported':
          // Export carries no session payload — refetch to pick up exportedDatasetId
          if (get().selectedSession?.id === sessionId) {
            void get().fetchSession(sessionId);
          }
          break;
      }
    },

    // --------------------------------------------------------------------------
    // Set Session Filters
    // --------------------------------------------------------------------------
    setSessionFilters: (filters: Partial<SessionFilters>) => {
      set((state) => {
        state.sessionFilters = { ...state.sessionFilters, ...filters };
        state.sessionPagination.page = 1;
      });
      get().fetchSessions();
    },

    // --------------------------------------------------------------------------
    // Clear Session Filters
    // --------------------------------------------------------------------------
    clearSessionFilters: () => {
      set((state) => {
        state.sessionFilters = {};
        state.sessionPagination.page = 1;
      });
      get().fetchSessions();
    },

    // --------------------------------------------------------------------------
    // Set Session Page
    // --------------------------------------------------------------------------
    setSessionPage: (page: number) => {
      set((state) => {
        state.sessionPagination.page = page;
      });
      get().fetchSessions();
    },

    // --------------------------------------------------------------------------
    // Fetch Uncertainty
    // --------------------------------------------------------------------------
    fetchUncertainty: async (params: GetUncertaintyParams) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const analysis = await datacollectionApi.getUncertainty(params);

        set((state) => {
          state.uncertaintyAnalysis = analysis;
          state.isLoading = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Priorities
    // --------------------------------------------------------------------------
    fetchPriorities: async (params?: GetPrioritiesParams) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await datacollectionApi.getPriorities(params);

        set((state) => {
          state.collectionPriorities = response.priorities;
          state.isLoading = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Log Prediction
    // --------------------------------------------------------------------------
    logPrediction: async (data: LogPredictionRequest) => {
      try {
        await datacollectionApi.logPrediction(data);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Clear Error
    // --------------------------------------------------------------------------
    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    // --------------------------------------------------------------------------
    // Reset Store
    // --------------------------------------------------------------------------
    reset: () => {
      announced.clear();
      actors.clear();
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  });
  },
  {
    name: 'DataCollectionStore',
    persist: false,
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================


type EpisodeEventKind = 'started' | 'stopped' | 'discarded';

const TAKE_VERB: Record<TakeAction, string> = {
  start: 'start the take',
  stop: 'stop the take',
  next: 'move to the next take',
  discard: 'discard the last take',
};

/** Events already announced (cue + toast), so REST and WebSocket do not both play. */
const announced = new Set<string>();
/** Who caused each recent episode event, for "Already started from the headset". */
const actors = new Map<string, EpisodeActor>();

function ownActor(source: EpisodeSource): EpisodeActor {
  return { userId: null, displayName: null, source, clientId: CLIENT_ID };
}

/** Progress fields an event carries replace the old ones; absent fields keep theirs. */
function mergeProgress(
  current: TeleopRecordingProgress | null,
  incoming: TeleopRecordingProgress | undefined
): TeleopRecordingProgress | null {
  if (!incoming) return current;
  const merged: TeleopRecordingProgress = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(incoming) as [keyof TeleopRecordingProgress, unknown][]) {
    if (value !== undefined && value !== null) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

// The server emits currentSmoothnessScore on a 0–100 scale; the UI renders 0–1.
function normalizeQualityFeedback(fb: QualityFeedback): QualityFeedback {
  return fb.currentSmoothnessScore > 1
    ? { ...fb, currentSmoothnessScore: fb.currentSmoothnessScore / 100 }
    : fb;
}

function updateSessionInList(
  state: DataCollectionStore,
  session: TeleoperationSession
) {
  const index = state.sessions.findIndex((s) => s.id === session.id);
  if (index !== -1) {
    state.sessions[index] = session;
  }
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('code' in error && typeof error.code === 'string') {
      const code = error.code as DataCollectionErrorCode;
      // The API client files every unclassified server error under
      // UNKNOWN_ERROR but keeps the server's own text ("Cannot export
      // session with no frames"); that text beats the generic one.
      const serverText = 'message' in error && typeof error.message === 'string' ? error.message.trim() : '';
      if (code === 'UNKNOWN_ERROR' && serverText) {
        return serverText;
      }
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if ('response' in error) {
      const response = error.response as { data?: { message?: string } };
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

// ============================================================================
// SELECTORS
// ============================================================================

export const selectSessions = (state: DataCollectionStore) => state.sessions;
export const selectSelectedSession = (state: DataCollectionStore) => state.selectedSession;
export const selectActiveSession = (state: DataCollectionStore) => state.activeSession;
export const selectQualityFeedback = (state: DataCollectionStore) => state.qualityFeedback;
export const selectEpisodes = (state: DataCollectionStore) => state.episodes;
export const selectRecordingProgress = (state: DataCollectionStore) => state.recordingProgress;
export const selectSessionFilters = (state: DataCollectionStore) => state.sessionFilters;
export const selectSessionPagination = (state: DataCollectionStore) => state.sessionPagination;
export const selectUncertaintyAnalysis = (state: DataCollectionStore) => state.uncertaintyAnalysis;
export const selectCollectionPriorities = (state: DataCollectionStore) => state.collectionPriorities;
export const selectCollectionTargets = (state: DataCollectionStore) => state.collectionTargets;
export const selectIsLoading = (state: DataCollectionStore) => state.isLoading;
export const selectError = (state: DataCollectionStore) => state.error;

export const selectSessionById = (id: string) => (state: DataCollectionStore) =>
  state.sessions.find((s) => s.id === id) ?? null;

export const selectHighPriorityTargets = (state: DataCollectionStore) =>
  state.collectionPriorities.filter((p) => p.priorityScore >= 0.6);

// ----------------------------------------------------------------------------
// Session state selectors (TASK-410): one reading of the live state for the
// session page, the VR panel (TASK-413) and the robot side (TASK-414).
// ----------------------------------------------------------------------------

export const selectLive = (state: DataCollectionStore) => state.live;

/** Now, on the server's clock. */
export const selectServerNowMs = (state: DataCollectionStore, nowMs: number = Date.now()) =>
  nowMs + state.liveClockOffsetMs;

/**
 * Seconds the live take has been recording at server time `nowServerMs`, or
 * null between takes. Two clients given the same live state agree to the
 * server clock, not their own.
 */
export const selectTakeElapsedS = (nowServerMs: number) => (state: Pick<DataCollectionStore, 'live'>): number | null => {
  const live = state.live;
  if (!live || live.phase !== 'capturing') return null;
  if (live.takeStartedAt) {
    const started = Date.parse(live.takeStartedAt);
    if (Number.isFinite(started)) return Math.max(0, (nowServerMs - started) / 1000);
  }
  return live.takeElapsedS;
};

/** Takes kept so far: the server's count, else the listed episodes that are not discarded. */
export const selectKept = (state: DataCollectionStore): number =>
  state.live?.kept ?? state.episodes.filter((e) => !e.discarded).length;

// ----------------------------------------------------------------------------
// Two-person session (TASK-414)
// ----------------------------------------------------------------------------

/** An operator state older than this is not shown as live. */
export const OPERATOR_STALE_MS = 2_000;

/** The operator of `sessionId` while fresh at `nowMs` (this tab's clock), else null. */
export const selectOperatorFor = (sessionId: string | undefined, nowMs: number = Date.now()) =>
  (state: Pick<DataCollectionStore, 'operator'>): OperatorSnapshot | null => {
    const op = state.operator;
    if (!op || !sessionId || op.sessionId !== sessionId) return null;
    return nowMs - op.receivedAt <= OPERATOR_STALE_MS ? op : null;
  };

/** Who watches `sessionId`; empty when nobody (or another session). */
export const selectViewersFor = (sessionId: string | undefined) =>
  (state: Pick<DataCollectionStore, 'presence'>): PresenceViewer[] =>
    state.presence && sessionId && state.presence.sessionId === sessionId ? state.presence.viewers : EMPTY_VIEWERS;

const EMPTY_VIEWERS: PresenceViewer[] = [];

/** The take streak of `sessionId` (current and best), zero when none. */
export const selectStreakFor = (sessionId: string | undefined) =>
  (state: Pick<DataCollectionStore, 'streak'>): { current: number; best: number } =>
    state.streak && sessionId && state.streak.sessionId === sessionId ? state.streak : NO_STREAK;

const NO_STREAK = { current: 0, best: 0 } as const;

export const sessionStateSelectors = {
  selectLive,
  selectServerNowMs,
  selectTakeElapsedS,
  selectKept,
} as const;

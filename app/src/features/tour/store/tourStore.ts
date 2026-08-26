/**
 * @file tourStore.ts
 * @description Zustand store for tour routes and runs (TASK-213). Routes and
 *              history come from the server (source of record); live progress
 *              arrives as `agent:tour:*` events and is folded in by `applyEvent`.
 * @feature tour
 */

import { createStore } from '@/store/createStore';
import { getErrorMessage } from '@/shared/utils/error';
import { tourApi } from '../api/tourApi';
import type {
  AgentModeEvent,
  TourLeg,
  TourLoadStatus,
  TourPlace,
  TourRoute,
  TourRouteInput,
  TourRun,
  TourRunQuery,
  TourSkillOption,
  TourStartResult,
  TourTurn,
} from '../types/tour.types';

// ============================================================================
// TYPES
// ============================================================================

export interface TourStore {
  // Routes
  routes: TourRoute[];
  routesStatus: TourLoadStatus;
  routesError: string | null;

  // Runs (list, newest first) + detail cache
  runs: TourRun[];
  runsStatus: TourLoadStatus;
  runsError: string | null;
  runsById: Record<string, TourRun>;
  runDetailStatus: Record<string, TourLoadStatus>;

  // Live: per robot, the running run and the last run seen (from events or fetch)
  activeRunByRobot: Record<string, TourRun>;
  /** Per robot, the tick at which the active slot above was last filled — see `nextTick`. */
  activeRunSeenTick: Record<string, number>;
  lastRunByRobot: Record<string, TourRun>;

  // Places per robot and the skill library (for the editor)
  placesByRobot: Record<string, TourPlace[]>;
  placesStatus: Record<string, TourLoadStatus>;
  skills: TourSkillOption[];
  skillsStatus: TourLoadStatus;

  // Transient
  startingRouteId: string | null;
  lastStartResult: (TourStartResult & { routeId: string }) | null;
  error: string | null;

  // Actions — routes
  fetchRoutes: (robotId?: string | null) => Promise<void>;
  fetchRoute: (id: string) => Promise<TourRoute | null>;
  saveRoute: (input: TourRouteInput, id?: string | null) => Promise<TourRoute | null>;
  deleteRoute: (id: string) => Promise<boolean>;
  startRun: (routeId: string, robotId?: string | null) => Promise<TourStartResult | null>;
  abortRun: (routeId: string, robotId?: string | null) => Promise<boolean>;

  // Actions — runs
  fetchRuns: (query?: TourRunQuery) => Promise<void>;
  fetchRun: (runId: string) => Promise<TourRun | null>;

  // Actions — editor inputs
  fetchPlaces: (robotId: string) => Promise<TourPlace[]>;
  fetchSkills: () => Promise<TourSkillOption[]>;

  // Live
  applyEvent: (event: AgentModeEvent) => void;

  clearError: () => void;
  clearStartResult: () => void;
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  routes: [] as TourRoute[],
  routesStatus: 'idle' as TourLoadStatus,
  routesError: null as string | null,
  runs: [] as TourRun[],
  runsStatus: 'idle' as TourLoadStatus,
  runsError: null as string | null,
  runsById: {} as Record<string, TourRun>,
  runDetailStatus: {} as Record<string, TourLoadStatus>,
  activeRunByRobot: {} as Record<string, TourRun>,
  activeRunSeenTick: {} as Record<string, number>,
  lastRunByRobot: {} as Record<string, TourRun>,
  placesByRobot: {} as Record<string, TourPlace[]>,
  placesStatus: {} as Record<string, TourLoadStatus>,
  skills: [] as TourSkillOption[],
  skillsStatus: 'idle' as TourLoadStatus,
  startingRouteId: null as string | null,
  lastStartResult: null as (TourStartResult & { routeId: string }) | null,
  error: null as string | null,
};

/** Runs kept in the list — the page shows the recent ones, not the archive. */
const MAX_RUNS_IN_LIST = 100;

// ============================================================================
// HELPERS
// ============================================================================

/** Every status except `running`; a tour that ended never runs again. */
const TERMINAL_RUN_STATUSES: ReadonlySet<TourRun['status']> = new Set<TourRun['status']>([
  'done',
  'declined',
  'abandoned',
  'aborted',
  'failed',
  'skipped',
]);
const SETTLED_LEG_STATUSES: ReadonlySet<TourLeg['status']> = new Set(['done', 'failed', 'skipped']);

function settledLegCount(legs: TourLeg[] | undefined): number {
  return (legs ?? []).filter((l) => SETTLED_LEG_STATUSES.has(l.status)).length;
}

/**
 * How many legs have been STARTED — the count that orders a leg-start snapshot
 * against the settle immediately before it.
 *
 * `startedAt` is stamped once, when the leg begins, and never cleared, so this
 * only ever grows within a run. A leg the runner skipped never starts and never
 * stamps it, so a skipped leg does not inflate the count on either side.
 */
function startedLegCount(legs: TourLeg[] | undefined): number {
  return (legs ?? []).filter((l) => l.startedAt).length;
}

/**
 * True when `incoming` is an OLDER snapshot of the run than the one we hold: it
 * would move a terminal run back to 'running', drop `finishedAt`, report fewer
 * settled legs, or SHORTEN the transcript. Same guard patrol needed (see
 * `isRunDowngrade` in patrolStore) — every `agent:tour:*` event carries the whole
 * run, the robot pushes them fire-and-forget and the server broadcasts them raw,
 * so a `leg` (or a `turn`'s embedded run) can land after the `finished` it
 * preceded.
 *
 * The turns clause is host mode's own: the transcript only ever grows during a
 * run, so a snapshot with fewer turns is by definition older — without it a late
 * `leg` event silently deleted questions the operator was reading. A SWEPT run
 * (turns cleared by retention) never arrives over this path; it comes from a
 * fetch, which does not go through the guard.
 */
function isRunDowngrade(stored: TourRun | null | undefined, incoming: TourRun): boolean {
  if (!stored) return false;
  if (incoming.turns.length < stored.turns.length) return true;
  return isProgressDowngrade(stored, incoming);
}

/**
 * `isRunDowngrade` without the transcript clause: would `incoming` walk the run's
 * PROGRESS backwards — status, finish, settled legs?
 *
 * Split out for the detail fetch, which is the one caller that must answer the
 * two halves differently. A fetched run legitimately carries fewer turns than
 * the events did (the retention sweep removed them), so its transcript always
 * wins; but the same response may still be a snapshot read before the finish
 * committed, and taking that pinned the page at "running" with a `—` duration
 * for good and put the run back into `activeRunByRobot`.
 */
function isProgressDowngrade(stored: TourRun, incoming: TourRun): boolean {
  if (TERMINAL_RUN_STATUSES.has(stored.status) && !TERMINAL_RUN_STATUSES.has(incoming.status)) return true;
  if (stored.finishedAt && !incoming.finishedAt) return true;
  if (settledLegCount(incoming.legs) < settledLegCount(stored.legs)) return true;
  // Settled legs alone stopped being enough when TASK-222 added the leg-START
  // event. `settle(leg i-1)` and `start(leg i)` are pushed a few lines apart and
  // settle the same number of legs — [done, pending, …] vs [done, running, …] —
  // so the clause above cannot order them. A reordered `settle(i-1)` landing
  // second walked leg i back to `pending` and dropped its `startedAt`, which put
  // the banner on `· walking` for the whole of leg i: the exact symptom
  // TASK-222 exists to remove.
  return startedLegCount(incoming.legs) < startedLegCount(stored.legs);
}

/**
 * Strictly increasing counter used to order things the store did against each
 * other — adopting an active run vs. issuing the fetch whose answer may
 * contradict it. Never reset: only the relative order of two ticks means anything.
 */
let tick = 0;
const nextTick = (): number => ++tick;

/** The two maps that together answer "what is this robot running, and since when did we think so". */
type ActiveSlots = Pick<TourStore, 'activeRunByRobot' | 'activeRunSeenTick'>;

/** Put a running run in the robot's active slot, stamped with the tick we learned of it. */
function markActiveRun(state: ActiveSlots, run: TourRun): void {
  state.activeRunByRobot[run.robotId] = run;
  state.activeRunSeenTick[run.robotId] = nextTick();
}

/** Empty the robot's active slot — stamp included, so a stale one cannot outlive the run. */
function clearActiveRun(state: ActiveSlots, robotId: string): void {
  delete state.activeRunByRobot[robotId];
  delete state.activeRunSeenTick[robotId];
}

/** Keep `activeRunByRobot` honest against a server-fetched run: add while running, drop once it is not. */
function reconcileActiveRun(state: ActiveSlots, run: TourRun): void {
  if (run.status === 'running') {
    markActiveRun(state, run);
  } else if (state.activeRunByRobot[run.robotId]?.runId === run.runId) {
    clearActiveRun(state, run.robotId);
  }
}

/** Insert-or-replace a run in the newest-first list. */
function upsertRunInList(list: TourRun[], run: TourRun): void {
  const idx = list.findIndex((r) => r.runId === run.runId);
  if (idx === -1) {
    list.unshift(run);
    if (list.length > MAX_RUNS_IN_LIST) list.length = MAX_RUNS_IN_LIST;
  } else {
    list[idx] = run;
  }
}

/** Newer-first ordering by `startedAt`. */
function newestFirst(a: TourRun, b: TourRun): number {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

/**
 * The transcript with `turn` appended, deduplicated. A turn has no id, so
 * (timestamp, question) is the key — the robot re-sends the whole run on every
 * event, so the same question would otherwise appear once per following event.
 */
function withTurn(turns: TourTurn[], turn: TourTurn | undefined): TourTurn[] {
  if (!turn) return turns;
  if (turns.some((t) => t.at === turn.at && t.question === turn.question)) return turns;
  return [...turns, turn];
}

/**
 * Write one run snapshot everywhere the store keeps runs. Takes the finished
 * object rather than mutating in place: `runsById`, `runs` and `activeRunByRobot`
 * all hold the SAME reference, so patching one of them after the fact would let
 * the three views drift apart.
 */
function storeRun(
  state: Pick<TourStore, 'runsById' | 'runs' | 'lastRunByRobot' | 'activeRunByRobot' | 'activeRunSeenTick'>,
  run: TourRun
): void {
  state.runsById[run.runId] = run;
  upsertRunInList(state.runs, run);
  state.lastRunByRobot[run.robotId] = run;
  reconcileActiveRun(state, run);
}

// ============================================================================
// STORE
// ============================================================================

export const useTourStore = createStore<TourStore>(
  (set, get) => ({
    ...initialState,

    // ------------------------------------------------------------------------
    // Routes
    // ------------------------------------------------------------------------
    fetchRoutes: async (robotId) => {
      set((state) => {
        state.routesStatus = 'loading';
        state.routesError = null;
      });
      try {
        const routes = await tourApi.listRoutes(robotId);
        set((state) => {
          state.routes = routes;
          state.routesStatus = 'ok';
        });
      } catch (err) {
        set((state) => {
          state.routesStatus = 'error';
          state.routesError = getErrorMessage(err, 'Failed to load tour routes');
        });
      }
    },

    fetchRoute: async (id) => {
      try {
        const route = await tourApi.getRoute(id);
        set((state) => {
          const idx = state.routes.findIndex((r) => r.id === route.id);
          if (idx === -1) state.routes.push(route);
          else state.routes[idx] = route;
        });
        return route;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to load the tour');
        });
        return null;
      }
    },

    saveRoute: async (input, id) => {
      try {
        const route = id ? await tourApi.updateRoute(id, input) : await tourApi.createRoute(input);
        set((state) => {
          const idx = state.routes.findIndex((r) => r.id === route.id);
          if (idx === -1) state.routes.push(route);
          else state.routes[idx] = route;
          state.error = null;
        });
        return route;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to save the tour');
        });
        return null;
      }
    },

    deleteRoute: async (id) => {
      try {
        await tourApi.deleteRoute(id);
        set((state) => {
          state.routes = state.routes.filter((r) => r.id !== id);
        });
        return true;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to delete the tour');
        });
        return false;
      }
    },

    startRun: async (routeId, robotId) => {
      set((state) => {
        state.startingRouteId = routeId;
        state.lastStartResult = null;
      });
      try {
        const result = await tourApi.startRoute(routeId, robotId);
        set((state) => {
          state.startingRouteId = null;
          state.lastStartResult = { ...result, routeId };
        });
        return result;
      } catch (err) {
        set((state) => {
          state.startingRouteId = null;
          state.error = getErrorMessage(err, 'Failed to start the tour');
        });
        return null;
      }
    },

    abortRun: async (routeId, robotId) => {
      try {
        const res = await tourApi.abortRoute(routeId, robotId);
        const ok = Boolean(res?.ok);
        // A refusal is a normal answer, not an exception — the robot replies
        // `{ ok: false }` when it has no tour to stop. Reported like every other
        // failure: an operator who pressed Stop while a visitor is being walked
        // around must not be left believing the robot stopped.
        if (!ok) {
          set((state) => {
            state.error = 'The robot did not end the tour — it reported no tour in progress.';
          });
        }
        return ok;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to end the tour');
        });
        return false;
      }
    },

    // ------------------------------------------------------------------------
    // Runs
    // ------------------------------------------------------------------------
    fetchRuns: async (query = {}) => {
      set((state) => {
        state.runsStatus = 'loading';
        state.runsError = null;
      });
      // Taken before the request goes out so the answer can be dated against what
      // we learn while it is in flight — see the prune loop below.
      const requestedAt = nextTick();
      try {
        const runs = await tourApi.listRuns({ limit: 50, ...query });
        set((state) => {
          // The poll and the robot's events race on separate connections, so a row
          // read here can be older than what `applyEvent` already folded in. Keep
          // whichever snapshot is further along; a poll must never walk a run back
          // (press "End tour" and the list answer, computed before the finish
          // committed, would otherwise re-raise the banner over a dead Stop button).
          const merged = runs.map((run) => {
            const stored = state.runsById[run.runId];
            return stored && isRunDowngrade(stored, run) ? stored : run;
          });
          state.runs = [...merged].sort(newestFirst);
          state.runsStatus = 'ok';
          for (const run of merged) {
            state.runsById[run.runId] = run;
            reconcileActiveRun(state, run);
            const last = state.lastRunByRobot[run.robotId];
            if (!last || newestFirst(run, last) < 0) state.lastRunByRobot[run.robotId] = run;
          }
          // An unfiltered fetch is authoritative: any "running" entry the
          // newest-first list no longer knows about ended while we were not
          // listening — but only about runs that already existed when we asked. A
          // run adopted after that (the visitor said yes, or the operator pressed
          // "Start tour", while this poll was in flight) is simply younger than the
          // answer; dropping it took the live banner and the End-tour button away
          // from a tour the robot was actually walking.
          if (!query.robotId && !query.routeId) {
            const seen = new Set(merged.map((r) => r.runId));
            for (const [robotId, active] of Object.entries(state.activeRunByRobot)) {
              if (seen.has(active.runId)) continue;
              if ((state.activeRunSeenTick[robotId] ?? 0) > requestedAt) continue;
              clearActiveRun(state, robotId);
            }
          }
        });
      } catch (err) {
        set((state) => {
          state.runsStatus = 'error';
          state.runsError = getErrorMessage(err, 'Failed to load tour runs');
        });
      }
    },

    fetchRun: async (runId) => {
      set((state) => {
        state.runDetailStatus[runId] = 'loading';
      });
      try {
        const run = await tourApi.getRun(runId);
        // The server's transcript, our progress — see `isProgressDowngrade`.
        const stored = get().runsById[run.runId];
        const fresh = stored && isProgressDowngrade(stored, run) ? { ...stored, turns: run.turns } : run;
        set((state) => {
          storeRun(state, fresh);
          state.runDetailStatus[runId] = 'ok';
        });
        return fresh;
      } catch (err) {
        set((state) => {
          state.runDetailStatus[runId] = 'error';
          state.error = getErrorMessage(err, 'Failed to load the tour run');
        });
        return null;
      }
    },

    // ------------------------------------------------------------------------
    // Editor inputs
    // ------------------------------------------------------------------------
    fetchPlaces: async (robotId) => {
      set((state) => {
        state.placesStatus[robotId] = 'loading';
      });
      try {
        const places = await tourApi.listPlaces(robotId);
        set((state) => {
          state.placesByRobot[robotId] = places;
          state.placesStatus[robotId] = 'ok';
        });
        return places;
      } catch {
        set((state) => {
          state.placesStatus[robotId] = 'error';
        });
        return [];
      }
    },

    fetchSkills: async () => {
      set((state) => {
        state.skillsStatus = 'loading';
      });
      try {
        const skills = await tourApi.listSkills();
        set((state) => {
          state.skills = skills;
          state.skillsStatus = 'ok';
        });
        return skills;
      } catch {
        // The editor stays usable without the library: a stop simply cannot be
        // given a demo until the skills come back.
        set((state) => {
          state.skillsStatus = 'error';
        });
        return [];
      }
    },

    // ------------------------------------------------------------------------
    // Live events
    // ------------------------------------------------------------------------
    applyEvent: (event) => {
      switch (event.type) {
        case 'agent:tour:started':
        case 'agent:tour:leg':
        case 'agent:tour:finished': {
          const run = event.tour;
          if (!run) return;
          set((state) => {
            if (isRunDowngrade(state.runsById[run.runId], run)) return;
            storeRun(state, run);
          });
          return;
        }
        case 'agent:tour:turn': {
          const turn = event.turn;
          set((state) => {
            // The run snapshot may have been taken before the turn was folded
            // into it, so the turn itself is the authority for its own row and
            // is merged in either way. With no snapshot at all we still append
            // to the robot's active run — a question asked mid-tour is exactly
            // what this page exists to show.
            const base = event.tour ?? state.activeRunByRobot[event.robotId];
            if (!base) return;
            const stored = state.runsById[base.runId];
            if (event.tour && isRunDowngrade(stored, event.tour)) {
              if (!stored || !turn) return;
              storeRun(state, { ...stored, turns: withTurn(stored.turns, turn) });
              return;
            }
            storeRun(state, { ...base, turns: withTurn(base.turns, turn) });
          });
          return;
        }
        default:
          return;
      }
    },

    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    clearStartResult: () => {
      set((state) => {
        state.lastStartResult = null;
      });
    },

    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  { name: 'TourStore', persist: false }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectRoutes = (state: TourStore) => state.routes;
export const selectRuns = (state: TourStore) => state.runs;
export const selectSkills = (state: TourStore) => state.skills;
export const selectRouteById = (id: string | null | undefined) => (state: TourStore) =>
  id ? (state.routes.find((r) => r.id === id) ?? null) : null;
export const selectRunById = (runId: string | null | undefined) => (state: TourStore) =>
  runId ? (state.runsById[runId] ?? null) : null;

export const selectActiveRun = (robotId: string | null | undefined) => (state: TourStore) =>
  robotId ? (state.activeRunByRobot[robotId] ?? null) : null;

/**
 * All running tours (any robot) — the page's active-run banner. Memoised on a
 * signature, like patrol's: `Object.values` builds a new array on every store
 * read, which would re-render the banner (and restart its 1 s clock) constantly.
 */
let cachedActiveSig = '';
let cachedActive: TourRun[] = [];
export const selectActiveRuns = (state: TourStore): TourRun[] => {
  const runs = Object.values(state.activeRunByRobot);
  // The signature carries every leg's STATUS, not a count of the settled ones:
  // a leg going `running` → `done` leaves that count unchanged, so the banner
  // went on naming a stop the robot had already left. One character per leg.
  const sig = runs
    .map((r) => `${r.runId}:${r.status}:${r.legs.map((l) => l.status[0]).join('')}:${r.turns.length}`)
    .join('|');
  if (sig === cachedActiveSig) return cachedActive;
  cachedActiveSig = sig;
  cachedActive = runs;
  return runs;
};

export const selectPlacesForRobot = (robotId: string | null | undefined) => (state: TourStore) =>
  robotId ? (state.placesByRobot[robotId] ?? null) : null;

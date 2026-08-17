/**
 * @file patrolStore.ts
 * @description Zustand store for patrol routes, runs and findings (TASK-212).
 *              Routes and history come from the server (source of record);
 *              live progress arrives as `agent:patrol:*` / `agent:finding:*`
 *              events and is folded in by `applyEvent`.
 * @feature patrol
 */

import { createStore } from '@/store/createStore';
import { getErrorMessage } from '@/shared/utils/error';
import { patrolApi } from '../api/patrolApi';
import type {
  AgentModeEvent,
  PatrolBaselineInfo,
  PatrolFinding,
  PatrolLeg,
  PatrolLoadStatus,
  PatrolPlace,
  PatrolRoute,
  PatrolRouteInput,
  PatrolRun,
  PatrolRunMode,
  PatrolRunQuery,
  PatrolStartResult,
} from '../types/patrol.types';

// ============================================================================
// TYPES
// ============================================================================

export interface PatrolStore {
  // Routes
  routes: PatrolRoute[];
  routesStatus: PatrolLoadStatus;
  routesError: string | null;

  // Runs (list, newest first) + detail cache
  runs: PatrolRun[];
  runsStatus: PatrolLoadStatus;
  runsError: string | null;
  runsById: Record<string, PatrolRun>;
  findingsByRun: Record<string, PatrolFinding[]>;
  runDetailStatus: Record<string, PatrolLoadStatus>;
  baselineByRoute: Record<string, PatrolBaselineInfo>;

  // Live: per robot, the running run and the last run seen (from events or fetch)
  activeRunByRobot: Record<string, PatrolRun>;
  lastRunByRobot: Record<string, PatrolRun>;
  /** The most recent `skipped` run per robot — what the announcer reads. */
  lastSkippedByRobot: Record<string, PatrolRun>;
  /**
   * Per robot, WHEN we adopted the run now sitting in `activeRunByRobot`, on the
   * store's own tick. Read by `fetchRuns` to date its own answer: a poll that was
   * already in flight when the operator pressed "Patrol now" comes back with a
   * list that predates the new run, and must not mistake it for a run that quietly
   * ended. A tick rather than a clock, because `startedAt` is the robot's clock
   * (which disagrees with ours) and `Date.now()` cannot order two things that
   * happen in the same millisecond — which is exactly the case here.
   */
  activeRunSeenTick: Record<string, number>;

  // Places per robot (for the editor)
  placesByRobot: Record<string, PatrolPlace[]>;
  placesStatus: Record<string, PatrolLoadStatus>;

  // Transient
  startingRouteId: string | null;
  lastStartResult: (PatrolStartResult & { routeId: string }) | null;
  busyFindingId: string | null;
  /**
   * Per finding id: whether the robot took the "This is normal" lesson.
   * `false` means the finding was dismissed on the server only — the robot was
   * unreachable, its baseline was not updated and it will flag this again.
   */
  findingRobotNotified: Record<string, boolean>;
  error: string | null;

  // Actions — routes
  fetchRoutes: (robotId?: string | null) => Promise<void>;
  fetchRoute: (id: string) => Promise<PatrolRoute | null>;
  saveRoute: (input: PatrolRouteInput, id?: string | null) => Promise<PatrolRoute | null>;
  deleteRoute: (id: string) => Promise<boolean>;
  startRun: (routeId: string, mode: PatrolRunMode, robotId?: string | null) => Promise<PatrolStartResult | null>;
  abortRun: (routeId: string, robotId?: string | null) => Promise<boolean>;

  // Actions — runs
  fetchRuns: (query?: PatrolRunQuery) => Promise<void>;
  fetchRun: (runId: string) => Promise<PatrolRun | null>;
  fetchLatestRun: (robotId: string) => Promise<void>;
  fetchBaseline: (routeId: string, window?: string | null) => Promise<PatrolBaselineInfo | null>;
  promoteRun: (runId: string) => Promise<boolean>;

  // Actions — findings
  acknowledgeFinding: (id: string) => Promise<boolean>;
  markFindingNormal: (id: string) => Promise<boolean>;
  escalateFinding: (id: string) => Promise<boolean>;

  // Actions — places
  fetchPlaces: (robotId: string) => Promise<PatrolPlace[]>;

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
  routes: [] as PatrolRoute[],
  routesStatus: 'idle' as PatrolLoadStatus,
  routesError: null as string | null,
  runs: [] as PatrolRun[],
  runsStatus: 'idle' as PatrolLoadStatus,
  runsError: null as string | null,
  runsById: {} as Record<string, PatrolRun>,
  findingsByRun: {} as Record<string, PatrolFinding[]>,
  runDetailStatus: {} as Record<string, PatrolLoadStatus>,
  baselineByRoute: {} as Record<string, PatrolBaselineInfo>,
  activeRunByRobot: {} as Record<string, PatrolRun>,
  lastRunByRobot: {} as Record<string, PatrolRun>,
  lastSkippedByRobot: {} as Record<string, PatrolRun>,
  activeRunSeenTick: {} as Record<string, number>,
  placesByRobot: {} as Record<string, PatrolPlace[]>,
  placesStatus: {} as Record<string, PatrolLoadStatus>,
  startingRouteId: null as string | null,
  lastStartResult: null as (PatrolStartResult & { routeId: string }) | null,
  busyFindingId: null as string | null,
  findingRobotNotified: {} as Record<string, boolean>,
  error: null as string | null,
};

/** Runs kept in the list — the page shows the recent ones, not the archive. */
const MAX_RUNS_IN_LIST = 100;

// ============================================================================
// HELPERS
// ============================================================================

const TERMINAL_RUN_STATUSES: ReadonlySet<PatrolRun['status']> = new Set(['done', 'aborted', 'failed', 'skipped']);
const SETTLED_LEG_STATUSES: ReadonlySet<PatrolLeg['status']> = new Set(['done', 'failed', 'skipped']);

function settledLegCount(legs: PatrolLeg[] | undefined): number {
  return (legs ?? []).filter((l) => SETTLED_LEG_STATUSES.has(l.status)).length;
}

/**
 * True when `incoming` is an OLDER snapshot of the run than the one we hold: it
 * would move a terminal run back to 'running', drop `finishedAt`, or report fewer
 * settled legs. Mirrors `isRunDowngrade` in server/src/services/PatrolService.ts —
 * every `agent:patrol:*` event carries the whole run and the robot pushes them
 * fire-and-forget over separate connections, so a `leg` (or a finding's embedded
 * run) can land after the `finished` it preceded. The server guards its own rows
 * but broadcasts the RAW event, so without this the map overlay — which has no
 * polling to heal it — keeps claiming a parked robot is still patrolling.
 */
function isRunDowngrade(stored: PatrolRun | null | undefined, incoming: PatrolRun): boolean {
  if (!stored) return false;
  if (TERMINAL_RUN_STATUSES.has(stored.status) && !TERMINAL_RUN_STATUSES.has(incoming.status)) return true;
  if (stored.finishedAt && !incoming.finishedAt) return true;
  return settledLegCount(incoming.legs) < settledLegCount(stored.legs);
}

/**
 * Strictly increasing counter used to order things the store did against each
 * other — adopting an active run vs. issuing the fetch whose answer may contradict
 * it. Never reset: only the relative order of two ticks ever means anything.
 */
let tick = 0;
const nextTick = (): number => ++tick;

/** The two maps that together answer "what is this robot running, and since when did we think so". */
type ActiveSlots = Pick<PatrolStore, 'activeRunByRobot' | 'activeRunSeenTick'>;

/** Put a running run in the robot's active slot, stamped with the tick we learned of it. */
function markActiveRun(state: ActiveSlots, run: PatrolRun): void {
  state.activeRunByRobot[run.robotId] = run;
  state.activeRunSeenTick[run.robotId] = nextTick();
}

/** Empty the robot's active slot — stamp included, so a stale one cannot outlive the run. */
function clearActiveRun(state: ActiveSlots, robotId: string): void {
  delete state.activeRunByRobot[robotId];
  delete state.activeRunSeenTick[robotId];
}

/** Keep `activeRunByRobot` honest against a server-fetched run: add while running, drop once it is not. */
function reconcileActiveRun(state: ActiveSlots, run: PatrolRun): void {
  if (run.status === 'running') {
    markActiveRun(state, run);
  } else if (state.activeRunByRobot[run.robotId]?.runId === run.runId) {
    clearActiveRun(state, run.robotId);
  }
}

/** Insert-or-replace a run in the newest-first list. */
function upsertRunInList(list: PatrolRun[], run: PatrolRun): void {
  const idx = list.findIndex((r) => r.runId === run.runId);
  if (idx === -1) {
    list.unshift(run);
    if (list.length > MAX_RUNS_IN_LIST) list.length = MAX_RUNS_IN_LIST;
  } else {
    list[idx] = run;
  }
}

/** Insert-or-replace a finding by id (server treats both events idempotently; so do we). */
function upsertFinding(list: PatrolFinding[], finding: PatrolFinding): void {
  const idx = list.findIndex((f) => f.id === finding.id);
  if (idx === -1) list.push(finding);
  else list[idx] = finding;
}

/** Newer-first ordering by `startedAt`. */
function newestFirst(a: PatrolRun, b: PatrolRun): number {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

/** Replace a finding wherever the store keeps it. */
function replaceFinding(state: PatrolStore, finding: PatrolFinding): void {
  const list = state.findingsByRun[finding.runId];
  if (list) upsertFinding(list, finding);
}

// ============================================================================
// STORE
// ============================================================================

export const usePatrolStore = createStore<PatrolStore>(
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
        const routes = await patrolApi.listRoutes(robotId);
        set((state) => {
          state.routes = routes;
          state.routesStatus = 'ok';
        });
      } catch (err) {
        set((state) => {
          state.routesStatus = 'error';
          state.routesError = getErrorMessage(err, 'Failed to load patrol routes');
        });
      }
    },

    fetchRoute: async (id) => {
      try {
        const route = await patrolApi.getRoute(id);
        set((state) => {
          const idx = state.routes.findIndex((r) => r.id === route.id);
          if (idx === -1) state.routes.push(route);
          else state.routes[idx] = route;
        });
        return route;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to load the route');
        });
        return null;
      }
    },

    saveRoute: async (input, id) => {
      try {
        const route = id ? await patrolApi.updateRoute(id, input) : await patrolApi.createRoute(input);
        set((state) => {
          const idx = state.routes.findIndex((r) => r.id === route.id);
          if (idx === -1) state.routes.push(route);
          else state.routes[idx] = route;
          state.error = null;
        });
        return route;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to save the route');
        });
        return null;
      }
    },

    deleteRoute: async (id) => {
      try {
        await patrolApi.deleteRoute(id);
        set((state) => {
          state.routes = state.routes.filter((r) => r.id !== id);
        });
        return true;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to delete the route');
        });
        return false;
      }
    },

    startRun: async (routeId, mode, robotId) => {
      set((state) => {
        state.startingRouteId = routeId;
        state.lastStartResult = null;
      });
      try {
        const result = await patrolApi.startRoute(routeId, mode, robotId);
        set((state) => {
          state.startingRouteId = null;
          state.lastStartResult = { ...result, routeId };
        });
        return result;
      } catch (err) {
        set((state) => {
          state.startingRouteId = null;
          state.error = getErrorMessage(err, 'Failed to start the run');
        });
        return null;
      }
    },

    abortRun: async (routeId, robotId) => {
      try {
        const res = await patrolApi.abortRoute(routeId, robotId);
        const ok = Boolean(res?.ok);
        // A refusal is a normal answer, not an exception: the robot replies
        // `{ ok: false }` when it has no run to stop (already finished, or the
        // request reached the wrong robot). Reported like every other failure
        // here — silently returning false left the operator watching a robot
        // that kept walking with nothing to tell them the abort did not land.
        if (!ok) {
          set((state) => {
            state.error = 'The robot did not stop the run — it reported no active patrol to abort.';
          });
        }
        return ok;
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to abort the run');
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
      // we learn while it is in flight — see the delete loop below.
      const requestedAt = nextTick();
      try {
        const runs = await patrolApi.listRuns({ limit: 50, ...query });
        set((state) => {
          // The poll and the robot's events race on separate connections, so a row
          // read here can be older than what `applyEvent` already folded in. Keep
          // whichever snapshot is further along; a poll must never walk a run back.
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
          // An unfiltered fetch is authoritative: any "running" entry the newest-first
          // list no longer knows about was finished while we were not listening — but
          // only about runs that already existed when we asked. A run we adopted after
          // that (the operator pressed "Patrol now" while this poll was in flight) is
          // simply younger than the answer; dropping it took the live rail and the
          // Abort button away from an operator whose robot was walking the route.
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
          state.runsError = getErrorMessage(err, 'Failed to load patrol runs');
        });
      }
    },

    fetchRun: async (runId) => {
      set((state) => {
        state.runDetailStatus[runId] = 'loading';
      });
      try {
        const { findings, ...run } = await patrolApi.getRun(runId);
        // The findings list is always the freshest word on findings, but the run row
        // beside it can be an older snapshot than the events already gave us.
        const stored = get().runsById[run.runId];
        const fresh = stored && isRunDowngrade(stored, run) ? stored : run;
        set((state) => {
          state.runsById[fresh.runId] = fresh;
          state.findingsByRun[fresh.runId] = findings;
          state.runDetailStatus[runId] = 'ok';
          upsertRunInList(state.runs, fresh);
          reconcileActiveRun(state, fresh);
        });
        return fresh;
      } catch (err) {
        set((state) => {
          state.runDetailStatus[runId] = 'error';
          state.error = getErrorMessage(err, 'Failed to load the run');
        });
        return null;
      }
    },

    fetchLatestRun: async (robotId) => {
      try {
        const runs = await patrolApi.listRuns({ robotId, limit: 1 });
        const run = runs[0];
        if (!run) return;
        const stored = get().runsById[run.runId];
        const fresh = stored && isRunDowngrade(stored, run) ? stored : run;
        set((state) => {
          state.runsById[fresh.runId] = fresh;
          reconcileActiveRun(state, fresh);
          const last = state.lastRunByRobot[robotId];
          if (!last || newestFirst(fresh, last) <= 0) state.lastRunByRobot[robotId] = fresh;
        });
        if (fresh.findingCount > 0 && !get().findingsByRun[fresh.runId]) {
          await get().fetchRun(fresh.runId);
        }
      } catch {
        // Overlay only — a failed read leaves the map as it was.
      }
    },

    fetchBaseline: async (routeId, window) => {
      try {
        const info = await patrolApi.getBaseline(routeId, window);
        set((state) => {
          state.baselineByRoute[`${routeId}|${window ?? ''}`] = info;
        });
        return info;
      } catch {
        return null;
      }
    },

    promoteRun: async (runId) => {
      try {
        const res = await patrolApi.promoteRun(runId);
        return Boolean(res?.ok);
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err, 'Failed to promote the run');
        });
        return false;
      }
    },

    // ------------------------------------------------------------------------
    // Findings
    // ------------------------------------------------------------------------
    acknowledgeFinding: async (id) => {
      set((state) => {
        state.busyFindingId = id;
      });
      try {
        const finding = await patrolApi.acknowledgeFinding(id);
        set((state) => {
          replaceFinding(state, finding);
          state.busyFindingId = null;
        });
        return true;
      } catch (err) {
        set((state) => {
          state.busyFindingId = null;
          state.error = getErrorMessage(err, 'Failed to acknowledge the finding');
        });
        return false;
      }
    },

    markFindingNormal: async (id) => {
      set((state) => {
        state.busyFindingId = id;
      });
      try {
        const { finding, robotNotified } = await patrolApi.markFindingNormal(id);
        set((state) => {
          if (finding && finding.id) replaceFinding(state, finding);
          // Keep the server's answer: `false` = dismissed here, robot not taught.
          if (typeof robotNotified === 'boolean') state.findingRobotNotified[finding?.id ?? id] = robotNotified;
          state.busyFindingId = null;
        });
        return true;
      } catch (err) {
        set((state) => {
          state.busyFindingId = null;
          state.error = getErrorMessage(err, 'Failed to mark the finding as normal');
        });
        return false;
      }
    },

    escalateFinding: async (id) => {
      set((state) => {
        state.busyFindingId = id;
      });
      try {
        const finding = await patrolApi.escalateFinding(id);
        set((state) => {
          replaceFinding(state, finding);
          state.busyFindingId = null;
        });
        return true;
      } catch (err) {
        set((state) => {
          state.busyFindingId = null;
          state.error = getErrorMessage(err, 'Failed to escalate the finding');
        });
        return false;
      }
    },

    // ------------------------------------------------------------------------
    // Places
    // ------------------------------------------------------------------------
    fetchPlaces: async (robotId) => {
      set((state) => {
        state.placesStatus[robotId] = 'loading';
      });
      try {
        const places = await patrolApi.listPlaces(robotId);
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

    // ------------------------------------------------------------------------
    // Live events
    // ------------------------------------------------------------------------
    applyEvent: (event) => {
      const run = event.patrol;
      const finding = event.finding;
      switch (event.type) {
        case 'agent:patrol:started':
        case 'agent:patrol:leg':
        case 'agent:patrol:finished': {
          if (!run) return;
          set((state) => {
            // A late `leg` must not resurrect a run we already saw finish — that
            // also protects the `lastSkippedByRobot` delete below from erasing a
            // legitimately announced skip.
            if (isRunDowngrade(state.runsById[run.runId], run)) return;
            state.runsById[run.runId] = run;
            upsertRunInList(state.runs, run);
            state.lastRunByRobot[run.robotId] = run;
            reconcileActiveRun(state, run);
            // A skip is only worth announcing until the robot's next run supersedes it.
            if (run.status === 'skipped') state.lastSkippedByRobot[run.robotId] = run;
            else delete state.lastSkippedByRobot[run.robotId];
          });
          return;
        }
        case 'agent:finding:detected':
        case 'agent:finding:confirmed': {
          if (!finding) return;
          set((state) => {
            const list = state.findingsByRun[finding.runId] ?? [];
            upsertFinding(list, finding);
            state.findingsByRun[finding.runId] = list;
            // The finding itself is always recorded (as on the server), but its
            // embedded run snapshot may be older than what we hold — a late
            // finding must not put a finished run back on the map as "running".
            if (run && !isRunDowngrade(state.runsById[run.runId], run)) {
              state.runsById[run.runId] = run;
              upsertRunInList(state.runs, run);
              state.lastRunByRobot[run.robotId] = run;
              if (run.status === 'running') markActiveRun(state, run);
            }
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
  { name: 'PatrolStore', persist: false }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectRoutes = (state: PatrolStore) => state.routes;
export const selectRuns = (state: PatrolStore) => state.runs;
export const selectRouteById = (id: string | null | undefined) => (state: PatrolStore) =>
  id ? (state.routes.find((r) => r.id === id) ?? null) : null;
export const selectRunById = (runId: string | null | undefined) => (state: PatrolStore) =>
  runId ? (state.runsById[runId] ?? null) : null;

const NO_FINDINGS: readonly PatrolFinding[] = Object.freeze([]);
export const selectFindingsForRun = (runId: string | null | undefined) => (state: PatrolStore) =>
  (runId ? state.findingsByRun[runId] : undefined) ?? (NO_FINDINGS as PatrolFinding[]);

/** The run the map overlay/banner shows for a robot: the running one, else the last seen. */
export const selectOverlayRun = (robotId: string | null | undefined) => (state: PatrolStore) =>
  robotId ? (state.activeRunByRobot[robotId] ?? state.lastRunByRobot[robotId] ?? null) : null;

export const selectActiveRun = (robotId: string | null | undefined) => (state: PatrolStore) =>
  robotId ? (state.activeRunByRobot[robotId] ?? null) : null;

/**
 * All running runs (any robot) — the page's active-run rail.
 *
 * Builds a fresh array every call, so components must subscribe through
 * `useShallow` (as PatrolPage does) instead of relying on reference equality.
 * It used to memoise on a hand-written signature that counted "legs that are not
 * pending" — which lumps the leg being walked in with the finished ones. The leg
 * that settles checkpoint i produces the same count as the finding snapshot that
 * showed checkpoint i as 'running', so the rail stayed frozen on the checkpoint
 * where a finding was raised, and on the last checkpoint for the whole walk home.
 */
export const selectActiveRuns = (state: PatrolStore): PatrolRun[] => Object.values(state.activeRunByRobot);

export const selectLastSkipped = (robotId: string | null | undefined) => (state: PatrolStore) =>
  robotId ? (state.lastSkippedByRobot[robotId] ?? null) : null;

export const selectPlacesForRobot = (robotId: string | null | undefined) => (state: PatrolStore) =>
  robotId ? (state.placesByRobot[robotId] ?? null) : null;

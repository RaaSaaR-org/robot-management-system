/**
 * @file TourPage.tsx
 * @description /tour — KPI strip, the live rail of tours in progress (over the
 *              WebSocket), the tour cards with Start / End, and the run history
 *              with the questions each visit produced.
 * @feature tour
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import {
  KpiTile,
  PATROL_FADE_IN,
  PATROL_INSET,
  PATROL_MOTION,
  SectionHeader,
  StatusDot,
} from '@/features/patrol/components/patrolUi';
import type { TourRoute, TourRun } from '../types/tour.types';
import { useTourStore, selectActiveRuns, selectRoutes, selectRuns } from '../store/tourStore';
import { useTourEvents } from '../hooks/useTourEvents';
import { RouteList } from '../components/RouteList';
import { RunHistory } from '../components/RunHistory';
import { ActiveRunBanner } from '../components/ActiveRunBanner';
import { declinedTurns } from '../utils/tourFormat';

/** Refresh cadence for the lists while the page is open (events cover the live part). */
const REFRESH_MS = 30_000;
/** Window of the "Tours · 24 h" tile. */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TourPageProps {
  className?: string;
}

export const TourPage = memo(function TourPage({ className }: TourPageProps) {
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);

  const routes = useTourStore(selectRoutes);
  const routesStatus = useTourStore((s) => s.routesStatus);
  const routesError = useTourStore((s) => s.routesError);
  const runs = useTourStore(selectRuns);
  const runsStatus = useTourStore((s) => s.runsStatus);
  const runsError = useTourStore((s) => s.runsError);
  const activeRuns = useTourStore(selectActiveRuns);
  const startingRouteId = useTourStore((s) => s.startingRouteId);
  const lastStartResult = useTourStore((s) => s.lastStartResult);
  const error = useTourStore((s) => s.error);

  const fetchRoutes = useTourStore((s) => s.fetchRoutes);
  const fetchRuns = useTourStore((s) => s.fetchRuns);
  const startRun = useTourStore((s) => s.startRun);
  const abortRun = useTourStore((s) => s.abortRun);
  const clearStartResult = useTourStore((s) => s.clearStartResult);
  const clearError = useTourStore((s) => s.clearError);

  const { isConnected } = useTourEvents();

  // Robot used for tours that are not bound to one.
  const [fallbackRobotId, setFallbackRobotId] = useState('');

  useEffect(() => {
    void fetchRobots();
    void fetchRoutes();
    void fetchRuns();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchRoutes();
      void fetchRuns();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchRobots, fetchRoutes, fetchRuns]);

  useEffect(() => {
    if (!fallbackRobotId && robots.length > 0) setFallbackRobotId(robots[0].id);
  }, [robots, fallbackRobotId]);

  const robotNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of robots) m[r.id] = r.name;
    return m;
  }, [robots]);

  const lastRunByRoute = useMemo(() => {
    const m: Record<string, TourRun | undefined> = {};
    for (const run of runs) {
      if (!m[run.routeId] || Date.parse(run.startedAt) > Date.parse(m[run.routeId]!.startedAt)) m[run.routeId] = run;
    }
    for (const run of activeRuns) m[run.routeId] = run;
    return m;
  }, [runs, activeRuns]);

  const kpis = useMemo(() => {
    const now = Date.now();
    const enabled = routes.filter((r) => r.enabled).length;
    const greeting = routes.filter((r) => r.enabled && r.autoGreet).length;
    const recent = runs.filter((r) => now - Date.parse(r.startedAt) <= DAY_MS);
    const recentDeclined = recent.filter((r) => r.status === 'declined').length;
    let questions = 0;
    let declined = 0;
    for (const r of runs) {
      questions += r.turns.length;
      declined += declinedTurns(r).length;
    }
    return { enabled, greeting, recent: recent.length, recentDeclined, questions, declined };
  }, [routes, runs]);
  // With no history in hand a failed run fetch would render "0 tours / 0
  // questions", which reads as "nobody visited" instead of "we could not ask".
  const runsUnknown = runsStatus === 'error' && runs.length === 0;
  const linkName = fallbackRobotId ? (robotNames[fallbackRobotId] ?? fallbackRobotId) : 'WS';

  const handleStart = useCallback(
    async (route: TourRoute) => {
      const robotId = route.robotId ?? fallbackRobotId ?? null;
      const result = await startRun(route.id, robotId);
      if (result) void fetchRuns();
    },
    [startRun, fallbackRobotId, fetchRuns]
  );

  const handleAbortRoute = useCallback(
    async (route: TourRoute) => {
      const run = lastRunByRoute[route.id];
      await abortRun(route.id, run?.robotId ?? route.robotId ?? fallbackRobotId ?? null);
      void fetchRuns();
    },
    [abortRun, lastRunByRoute, fallbackRobotId, fetchRuns]
  );

  const handleAbortRun = useCallback(
    async (run: TourRun) => {
      await abortRun(run.routeId, run.robotId);
      void fetchRuns();
    },
    [abortRun, fetchRuns]
  );

  return (
    <div className={cn('min-h-screen', className)} data-testid="tour-page">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Guide"
          subtitle="The robot greets a visitor, walks them through the site, says a prepared piece at every stop and answers their questions from facts you authored."
          meta={
            <span
              className={cn(
                'inline-flex items-center gap-1.5 glass-subtle rounded-full px-2 py-0.5 text-[11px]',
                PATROL_MOTION,
                isConnected ? 'text-turquoise-700 dark:text-turquoise-400' : 'text-theme-muted'
              )}
              data-testid="tour-live"
            >
              <StatusDot tone={isConnected ? 'accent' : 'neutral'} pulse={isConnected} />
              {isConnected ? 'live' : 'offline'}
            </span>
          }
          actions={
            <>
              <label className="sr-only" htmlFor="tour-fallback-robot">
                Robot for tours that are not bound to one
              </label>
              <select
                id="tour-fallback-robot"
                data-testid="tour-fallback-robot"
                title="Robot used for tours that are not bound to one"
                value={fallbackRobotId}
                onChange={(e) => setFallbackRobotId(e.target.value)}
                className="glass-subtle min-w-0 max-w-full truncate px-3 py-2 text-sm text-theme-primary rounded-brand border border-glass-subtle focus:outline-none focus:ring-2 focus:ring-cobalt-500/40"
              >
                {robots.length === 0 && <option value="">No robots</option>}
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <Link to="/tour/routes/new">
                <Button size="sm" data-testid="tour-new-route">
                  New tour
                </Button>
              </Link>
            </>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 min-w-0" data-testid="tour-kpis">
          <KpiTile
            label="Tours armed"
            value={`${kpis.enabled}/${routes.length}`}
            sub={`${kpis.greeting} greet on sight`}
            tone={kpis.enabled > 0 ? 'primary' : 'neutral'}
            data-testid="tour-kpi-routes"
          />
          <KpiTile
            label="Visits · 24 h"
            value={runsUnknown ? '—' : kpis.recent}
            sub={runsUnknown ? 'history unavailable' : `${kpis.recentDeclined} offer${kpis.recentDeclined === 1 ? '' : 's'} declined`}
            data-testid="tour-kpi-runs"
          />
          <KpiTile
            label="Questions asked"
            value={runsUnknown ? '—' : kpis.questions}
            // The declined count is the number that turns into work: each one
            // is a fact the tour does not carry yet.
            sub={runsUnknown ? 'history unavailable' : `${kpis.declined} the facts did not cover`}
            tone={!runsUnknown && kpis.declined > 0 ? 'attention' : 'neutral'}
            data-testid="tour-kpi-questions"
          />
          <KpiTile
            label="Link"
            value={
              <span className="truncate min-w-0 text-lg leading-tight" title={isConnected ? linkName : undefined}>
                {isConnected ? linkName : 'offline'}
              </span>
            }
            sub={isConnected ? 'events over WebSocket' : 'no live events'}
            tone={isConnected ? 'accent' : 'neutral'}
            live={isConnected}
            className={isConnected ? undefined : 'opacity-80'}
            data-testid="tour-kpi-link"
          />
        </div>

        <ActiveRunBanner runs={activeRuns} robotNames={robotNames} onAbort={(run) => void handleAbortRun(run)} />

        {lastStartResult && (
          <div
            className={cn(
              PATROL_INSET,
              PATROL_FADE_IN,
              'text-sm flex items-start gap-2 border-l-[3px]',
              lastStartResult.accepted ? 'text-theme-secondary border-l-turquoise-500' : 'text-amber-700 dark:text-amber-400 border-l-amber-500'
            )}
            role="status"
            data-testid="tour-start-result"
          >
            <span className="flex-1 min-w-0 break-words">
              {lastStartResult.accepted
                ? `Tour started${lastStartResult.runId ? ` (${lastStartResult.runId})` : ''}.`
                : `Refused${lastStartResult.reason ? ` (${lastStartResult.reason})` : ''}: ${lastStartResult.message}`}
            </span>
            <button type="button" className={cn('text-xs underline shrink-0 min-h-9 sm:min-h-0 hover:text-theme-primary', PATROL_MOTION)} onClick={clearStartResult}>
              dismiss
            </button>
          </div>
        )}
        {error && (
          <div className={cn(PATROL_INSET, PATROL_FADE_IN, 'text-sm text-red-700 dark:text-red-400 flex items-start gap-2 border-l-[3px] border-l-red-500')} role="alert">
            <span className="flex-1 min-w-0 break-words">{error}</span>
            <button type="button" className={cn('text-xs underline shrink-0 min-h-9 sm:min-h-0 hover:text-theme-primary', PATROL_MOTION)} onClick={clearError}>
              dismiss
            </button>
          </div>
        )}

        <section className="flex flex-col gap-2 min-w-0">
          <SectionHeader title="Tours" count={routes.length} />
          {/* Data wins over status: the 30 s poll fails on any server restart,
              and replacing the cards with a red line would take End tour away
              from an operator watching a robot walk a visitor around. */}
          {routesStatus === 'error' && routes.length === 0 ? (
            <div className={cn(PATROL_INSET, 'text-sm text-red-700 dark:text-red-400 border-l-[3px] border-l-red-500')} role="alert" data-testid="tour-routes-error">
              {routesError ?? 'Failed to load tours'}
            </div>
          ) : routesStatus === 'loading' && routes.length === 0 ? (
            <div className="grid gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading tours">
              <div className="glass-card rounded-brand-lg animate-pulse h-28" />
              <div className="glass-card rounded-brand-lg animate-pulse h-28" />
            </div>
          ) : (
            <>
              {routesStatus === 'error' && (
                <div className={cn(PATROL_INSET, 'text-sm text-amber-700 dark:text-amber-400 border-l-[3px] border-l-amber-500')} role="status" data-testid="tour-routes-stale">
                  {routesError ?? 'Could not refresh the tours'} — showing the last known state.
                </div>
              )}
              <RouteList
                routes={routes}
                lastRunByRoute={lastRunByRoute}
                robotNames={robotNames}
                startingRouteId={startingRouteId}
                onStart={(route) => void handleStart(route)}
                onAbort={(route) => void handleAbortRoute(route)}
              />
            </>
          )}
        </section>

        <section className="flex flex-col gap-2 min-w-0">
          <SectionHeader title="Visits" count={runs.length} />
          {/* Without this branch a failed fetch fell through to RunHistory's
              "No tours yet" — a read failure read as "nobody came". */}
          {runsStatus === 'error' && runs.length === 0 ? (
            <div className={cn(PATROL_INSET, 'text-sm text-red-700 dark:text-red-400 border-l-[3px] border-l-red-500')} role="alert" data-testid="tour-runs-error">
              {runsError ?? 'Failed to load tour runs'}
            </div>
          ) : runsStatus === 'loading' && runs.length === 0 ? (
            <div className="glass-card rounded-brand-lg animate-pulse h-40" aria-busy="true" aria-label="Loading tours" />
          ) : (
            <>
              {runsStatus === 'error' && (
                <div className={cn(PATROL_INSET, 'text-sm text-amber-700 dark:text-amber-400 border-l-[3px] border-l-amber-500')} role="status" data-testid="tour-runs-stale">
                  {runsError ?? 'Could not refresh the history'} — showing the last known history.
                </div>
              )}
              <RunHistory runs={runs} robotNames={robotNames} />
            </>
          )}
        </section>
      </div>
    </div>
  );
});

/**
 * @file PatrolPage.tsx
 * @description /patrol — routes list with Baseline run / Patrol now / Abort,
 *              the active-run banner (live over the WebSocket) and the run
 *              history.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import type { PatrolRoute, PatrolRun } from '../types/patrol.types';
import { usePatrolStore, selectActiveRuns, selectRoutes, selectRuns } from '../store/patrolStore';
import { usePatrolEvents } from '../hooks/usePatrolEvents';
import { RouteList } from '../components/RouteList';
import { RunHistory } from '../components/RunHistory';
import { ActiveRunBanner } from '../components/ActiveRunBanner';

/** Refresh cadence for the lists while the page is open (events cover the live part). */
const REFRESH_MS = 30_000;

export interface PatrolPageProps {
  className?: string;
}

export const PatrolPage = memo(function PatrolPage({ className }: PatrolPageProps) {
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);

  const routes = usePatrolStore(selectRoutes);
  const routesStatus = usePatrolStore((s) => s.routesStatus);
  const routesError = usePatrolStore((s) => s.routesError);
  const runs = usePatrolStore(selectRuns);
  const runsStatus = usePatrolStore((s) => s.runsStatus);
  const activeRuns = usePatrolStore(selectActiveRuns);
  const startingRouteId = usePatrolStore((s) => s.startingRouteId);
  const lastStartResult = usePatrolStore((s) => s.lastStartResult);
  const error = usePatrolStore((s) => s.error);

  const fetchRoutes = usePatrolStore((s) => s.fetchRoutes);
  const fetchRuns = usePatrolStore((s) => s.fetchRuns);
  const startRun = usePatrolStore((s) => s.startRun);
  const abortRun = usePatrolStore((s) => s.abortRun);
  const clearStartResult = usePatrolStore((s) => s.clearStartResult);
  const clearError = usePatrolStore((s) => s.clearError);

  const { isConnected } = usePatrolEvents();

  // Robot used for routes that are not bound to one.
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
    const m: Record<string, PatrolRun | undefined> = {};
    for (const run of runs) {
      if (!m[run.routeId] || Date.parse(run.startedAt) > Date.parse(m[run.routeId]!.startedAt)) m[run.routeId] = run;
    }
    for (const run of activeRuns) m[run.routeId] = run;
    return m;
  }, [runs, activeRuns]);

  const handleStart = useCallback(
    async (route: PatrolRoute, mode: 'baseline' | 'patrol') => {
      const robotId = route.robotId ?? fallbackRobotId ?? null;
      const result = await startRun(route.id, mode, robotId);
      if (result) void fetchRuns();
    },
    [startRun, fallbackRobotId, fetchRuns]
  );

  const handleAbortRoute = useCallback(
    async (route: PatrolRoute) => {
      const run = lastRunByRoute[route.id];
      await abortRun(route.id, run?.robotId ?? route.robotId ?? fallbackRobotId ?? null);
      void fetchRuns();
    },
    [abortRun, lastRunByRoute, fallbackRobotId, fetchRuns]
  );

  const handleAbortRun = useCallback(
    async (run: PatrolRun) => {
      await abortRun(run.routeId, run.robotId);
      void fetchRuns();
    },
    [abortRun, fetchRuns]
  );

  return (
    <div className={cn('min-h-screen', className)} data-testid="patrol-page">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Patrol"
          subtitle="Routes the robot walks on a schedule, control photos at every checkpoint, and what was not normal along the way."
          meta={
            <span className={cn('text-xs', isConnected ? 'text-turquoise-600 dark:text-turquoise-400' : 'text-theme-muted')} data-testid="patrol-live">
              {isConnected ? 'live' : 'offline'}
            </span>
          }
          actions={
            <>
              <label className="sr-only" htmlFor="patrol-fallback-robot">
                Robot for unbound routes
              </label>
              <select
                id="patrol-fallback-robot"
                data-testid="patrol-fallback-robot"
                title="Robot used for routes that are not bound to one"
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
              <Link to="/patrol/routes/new">
                <Button size="sm" data-testid="patrol-new-route">
                  New route
                </Button>
              </Link>
            </>
          }
        />

        <ActiveRunBanner runs={activeRuns} robotNames={robotNames} onAbort={(run) => void handleAbortRun(run)} />

        {lastStartResult && (
          <div
            className={cn(
              'glass-card px-3 py-2 text-sm flex items-start gap-2',
              lastStartResult.accepted ? 'text-theme-secondary' : 'text-amber-600 dark:text-amber-400 border border-amber-500/30'
            )}
            role="status"
            data-testid="patrol-start-result"
          >
            <span className="flex-1 min-w-0 break-words">
              {lastStartResult.accepted
                ? `Run started${lastStartResult.runId ? ` (${lastStartResult.runId})` : ''}.`
                : `Refused${lastStartResult.reason ? ` (${lastStartResult.reason})` : ''}: ${lastStartResult.message}`}
            </span>
            <button type="button" className="text-xs underline shrink-0" onClick={clearStartResult}>
              dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="glass-card px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-start gap-2" role="alert">
            <span className="flex-1 min-w-0 break-words">{error}</span>
            <button type="button" className="text-xs underline shrink-0" onClick={clearError}>
              dismiss
            </button>
          </div>
        )}

        <section className="flex flex-col gap-2 min-w-0">
          <h2 className="card-title text-sm">Routes</h2>
          {routesStatus === 'error' ? (
            <div className="glass-card p-4 text-sm text-red-600 dark:text-red-400">{routesError ?? 'Failed to load routes'}</div>
          ) : routesStatus === 'loading' && routes.length === 0 ? (
            <div className="glass-card p-4 card-meta text-sm">Loading routes…</div>
          ) : (
            <RouteList
              routes={routes}
              lastRunByRoute={lastRunByRoute}
              robotNames={robotNames}
              startingRouteId={startingRouteId}
              onStart={(route, mode) => void handleStart(route, mode)}
              onAbort={(route) => void handleAbortRoute(route)}
            />
          )}
        </section>

        <section className="flex flex-col gap-2 min-w-0">
          <h2 className="card-title text-sm">Run history</h2>
          {runsStatus === 'loading' && runs.length === 0 ? (
            <div className="glass-card p-4 card-meta text-sm">Loading runs…</div>
          ) : (
            <RunHistory runs={runs} robotNames={robotNames} />
          )}
        </section>
      </div>
    </div>
  );
});

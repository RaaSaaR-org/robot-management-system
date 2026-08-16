/**
 * @file PatrolPage.tsx
 * @description /patrol — KPI strip, the live run rail (over the WebSocket),
 *              route cards with Baseline run / Patrol now / Abort, and the
 *              run history.
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
import { KpiTile, PATROL_FADE_IN, PATROL_INSET, PATROL_MOTION, SectionHeader, StatusDot } from '../components/patrolUi';

/** Refresh cadence for the lists while the page is open (events cover the live part). */
const REFRESH_MS = 30_000;
/** Window of the "Runs · 24 h" tile. */
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const runsError = usePatrolStore((s) => s.runsError);
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

  const kpis = useMemo(() => {
    const now = Date.now();
    const enabled = routes.filter((r) => r.enabled).length;
    const scheduled = routes.filter((r) => r.enabled && r.cronExpression).length;
    const recent = runs.filter((r) => now - Date.parse(r.startedAt) <= DAY_MS);
    const recentBaseline = recent.filter((r) => r.mode === 'baseline').length;
    let findings = 0;
    let runsWithFindings = 0;
    for (const r of runs) {
      if (r.findingCount > 0) {
        findings += r.findingCount;
        runsWithFindings += 1;
      }
    }
    return { enabled, scheduled, recent: recent.length, recentBaseline, findings, runsWithFindings };
  }, [routes, runs]);
  // With no history in hand a failed run fetch would render "0 runs / 0 findings",
  // which reads as "the night patrol never ran" instead of "we could not ask".
  const runsUnknown = runsStatus === 'error' && runs.length === 0;
  const linkName = fallbackRobotId ? (robotNames[fallbackRobotId] ?? fallbackRobotId) : 'WS';

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
      <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Patrol"
          subtitle="Routes the robot walks on a schedule, control photos at every checkpoint, and what was not normal along the way."
          meta={
            <span
              className={cn(
                'inline-flex items-center gap-1.5 glass-subtle rounded-full px-2 py-0.5 text-[11px]',
                PATROL_MOTION,
                isConnected ? 'text-turquoise-700 dark:text-turquoise-400' : 'text-theme-muted'
              )}
              data-testid="patrol-live"
            >
              <StatusDot tone={isConnected ? 'accent' : 'neutral'} pulse={isConnected} />
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 min-w-0" data-testid="patrol-kpis">
          <KpiTile
            label="Routes armed"
            value={`${kpis.enabled}/${routes.length}`}
            sub={`${kpis.scheduled} scheduled`}
            tone={kpis.enabled > 0 ? 'primary' : 'neutral'}
            data-testid="patrol-kpi-routes"
          />
          <KpiTile
            label="Runs · 24 h"
            value={runsUnknown ? '—' : kpis.recent}
            sub={runsUnknown ? 'history unavailable' : `${kpis.recentBaseline} baseline`}
            data-testid="patrol-kpi-runs"
          />
          <KpiTile
            label="Findings raised"
            value={runsUnknown ? '—' : kpis.findings}
            sub={runsUnknown ? 'history unavailable' : `across ${kpis.runsWithFindings} run${kpis.runsWithFindings === 1 ? '' : 's'}`}
            tone={!runsUnknown && kpis.findings > 0 ? 'attention' : 'neutral'}
            data-testid="patrol-kpi-findings"
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
            data-testid="patrol-kpi-link"
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
            data-testid="patrol-start-result"
          >
            <span className="flex-1 min-w-0 break-words">
              {lastStartResult.accepted
                ? `Run started${lastStartResult.runId ? ` (${lastStartResult.runId})` : ''}.`
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
          <SectionHeader title="Routes" count={routes.length} />
          {/* Data wins over status: the 30 s poll fails on any server restart, and
              replacing the cards with a red line would take the steppers and the
              Abort buttons away from an operator watching a live patrol. */}
          {routesStatus === 'error' && routes.length === 0 ? (
            <div className={cn(PATROL_INSET, 'text-sm text-red-700 dark:text-red-400 border-l-[3px] border-l-red-500')} role="alert" data-testid="patrol-routes-error">
              {routesError ?? 'Failed to load routes'}
            </div>
          ) : routesStatus === 'loading' && routes.length === 0 ? (
            <div className="grid gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading routes">
              <div className="glass-card rounded-brand-lg animate-pulse h-28" />
              <div className="glass-card rounded-brand-lg animate-pulse h-28" />
            </div>
          ) : (
            <>
              {routesStatus === 'error' && (
                <div className={cn(PATROL_INSET, 'text-sm text-amber-700 dark:text-amber-400 border-l-[3px] border-l-amber-500')} role="status" data-testid="patrol-routes-stale">
                  {routesError ?? 'Could not refresh the routes'} — showing the last known state.
                </div>
              )}
              <RouteList
                routes={routes}
                lastRunByRoute={lastRunByRoute}
                robotNames={robotNames}
                startingRouteId={startingRouteId}
                onStart={(route, mode) => void handleStart(route, mode)}
                onAbort={(route) => void handleAbortRoute(route)}
              />
            </>
          )}
        </section>

        <section className="flex flex-col gap-2 min-w-0">
          <SectionHeader title="Run history" count={runs.length} />
          {/* Without this branch a failed fetch fell through to RunHistory's
              "No runs yet" — the operator read a read failure as "the scheduled
              patrol never ran". */}
          {runsStatus === 'error' && runs.length === 0 ? (
            <div className={cn(PATROL_INSET, 'text-sm text-red-700 dark:text-red-400 border-l-[3px] border-l-red-500')} role="alert" data-testid="patrol-runs-error">
              {runsError ?? 'Failed to load patrol runs'}
            </div>
          ) : runsStatus === 'loading' && runs.length === 0 ? (
            <div className="glass-card rounded-brand-lg animate-pulse h-40" aria-busy="true" aria-label="Loading runs" />
          ) : (
            <>
              {runsStatus === 'error' && (
                <div className={cn(PATROL_INSET, 'text-sm text-amber-700 dark:text-amber-400 border-l-[3px] border-l-amber-500')} role="status" data-testid="patrol-runs-stale">
                  {runsError ?? 'Could not refresh the run history'} — showing the last known history.
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

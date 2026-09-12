/**
 * @file PatrolPage.tsx
 * @description /patrol — header with the live link, a three-tile summary, the
 *              live runs, and two tabs in the URL: Routes (table with start,
 *              abort, export and delete) and Runs (the run history).
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Plus } from 'lucide-react';
import { LinkButton, PageHeader, StatRow, StatTile, Tabs, confirm, errorMessage, toast } from '@/shared/components/ui';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import type { PatrolRoute, PatrolRun, PatrolRunMode } from '../types/patrol.types';
import { usePatrolStore, selectActiveRuns, selectRoutes, selectRuns } from '../store/patrolStore';
import { usePatrolEvents } from '../hooks/usePatrolEvents';
import { RouteList } from '../components/RouteList';
import { RunHistory } from '../components/RunHistory';
import { ActiveRunBanner } from '../components/ActiveRunBanner';
import { RunStartModal } from '../components/RunStartModal';
import { LiveTag } from '../components/opsUi';
import { exportRouteVda5050 } from '../utils/routeExport';

/** Refresh cadence for the lists while the page is open (events cover the live part). */
const REFRESH_MS = 30_000;
/** Window of the "Runs · 24 h" tile. */
const DAY_MS = 24 * 60 * 60 * 1000;
const TABS = [
  { id: 'routes', label: 'Routes' },
  { id: 'runs', label: 'Runs' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export interface PatrolPageProps {
  className?: string;
}

export const PatrolPage = memo(function PatrolPage({ className }: PatrolPageProps) {
  const { can } = useAuth();
  const canWrite = can('tasks:write');
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);

  const routes = usePatrolStore(selectRoutes);
  const routesStatus = usePatrolStore((s) => s.routesStatus);
  const routesError = usePatrolStore((s) => s.routesError);
  const runs = usePatrolStore(selectRuns);
  const runsStatus = usePatrolStore((s) => s.runsStatus);
  const runsError = usePatrolStore((s) => s.runsError);
  // `selectActiveRuns` derives a new array each call, so compare its contents:
  // the run objects are replaced whenever a patrol event moves the robot on.
  const activeRuns = usePatrolStore(useShallow(selectActiveRuns));
  const fetchRoutes = usePatrolStore((s) => s.fetchRoutes);
  const fetchRuns = usePatrolStore((s) => s.fetchRuns);
  const abortRun = usePatrolStore((s) => s.abortRun);
  const deleteRoute = usePatrolStore((s) => s.deleteRoute);
  const clearError = usePatrolStore((s) => s.clearError);

  const { isConnected } = usePatrolEvents();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'routes';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === TABS[0].id) p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true },
    );

  const [starting, setStarting] = useState<{ route: PatrolRoute; mode: PatrolRunMode } | null>(null);

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

  // A failed poll keeps the data on screen; one toast (reused id) says so.
  const staleRoutes = routesStatus === 'error' && routes.length > 0;
  const staleRuns = runsStatus === 'error' && runs.length > 0;
  const warned = useRef(false);
  useEffect(() => {
    if ((staleRoutes || staleRuns) && !warned.current) {
      warned.current = true;
      toast.warning("Couldn't refresh patrol data", {
        id: 'patrol-stale',
        description: `${(staleRoutes ? routesError : runsError) ?? 'Network error'} — showing the last known state.`,
      });
    }
    if (!staleRoutes && !staleRuns) warned.current = false;
  }, [staleRoutes, staleRuns, routesError, runsError]);

  const robotNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of robots) m[r.id] = r.name;
    return m;
  }, [robots]);
  const robotOptions = useMemo(() => robots.map((r) => ({ id: r.id, name: r.name })), [robots]);

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

  const abort = useCallback(
    async (routeId: string, routeName: string, robotId: string | null) => {
      const ok = await confirm({
        title: `Abort the run on ${routeName}?`,
        description: 'The robot stops where it is and the run is marked aborted. Photos taken so far are kept.',
        confirmLabel: 'Abort run',
        tone: 'danger',
      });
      if (!ok) return;
      const done = await abortRun(routeId, robotId);
      if (done) toast.success('Run aborted', { description: routeName });
      else {
        toast.error("Couldn't abort the run", { description: usePatrolStore.getState().error ?? undefined });
        clearError();
      }
      void fetchRuns();
    },
    [abortRun, clearError, fetchRuns],
  );

  const handleAbortRoute = useCallback(
    (route: PatrolRoute) => {
      const run = lastRunByRoute[route.id];
      void abort(route.id, route.name, run?.robotId ?? route.robotId ?? robots[0]?.id ?? null);
    },
    [abort, lastRunByRoute, robots],
  );

  const handleDelete = useCallback(
    async (route: PatrolRoute) => {
      const ok = await confirm({ title: `Delete ${route.name}?`, description: 'Scheduled runs stop. Its run history stays.', tone: 'danger' });
      if (!ok) return;
      try {
        const done = await deleteRoute(route.id);
        if (!done) throw new Error(usePatrolStore.getState().error ?? 'The server refused.');
        toast.success('Route deleted', { description: route.name });
      } catch (err) {
        toast.error("Couldn't delete route", { description: errorMessage(err) });
      } finally {
        clearError();
      }
    },
    [deleteRoute, clearError],
  );

  const hasRoutes = routes.length > 0;
  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'} data-testid="patrol-page">
      <PageHeader
        eyebrow="Operate"
        title="Patrol"
        description="Routes a robot walks on its own, with control photos and what was not normal."
        meta={<LiveTag connected={isConnected} data-testid="patrol-live" />}
        actions={
          canWrite ? (
            <LinkButton to="/patrol/routes/new" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} data-testid="patrol-new-route">
              New route
            </LinkButton>
          ) : undefined
        }
      />

      {/* A viewer reads this page. Saying so beats a row of dead buttons. */}
      {!canWrite && (
        <p className="text-[13px] text-ink-secondary" data-testid="patrol-read-only">
          Read-only access. A member role or higher is required to manage routes and runs.
        </p>
      )}

      {hasRoutes && (
        <StatRow columns={3}>
          <div data-testid="patrol-kpi-routes" className="contents">
            <StatTile label="Routes armed" value={kpis.enabled} unit={`/ ${routes.length}`} hint={`${kpis.scheduled} scheduled`} tone={kpis.enabled > 0 ? 'live' : 'neutral'} />
          </div>
          <div data-testid="patrol-kpi-runs" className="contents">
            <StatTile label="Runs · 24 h" value={runsUnknown ? '—' : kpis.recent} hint={runsUnknown ? 'History unavailable' : `${kpis.recentBaseline} baseline`} />
          </div>
          <div data-testid="patrol-kpi-findings" className="contents">
            <StatTile
              label="Findings raised"
              value={runsUnknown ? '—' : kpis.findings}
              tone={!runsUnknown && kpis.findings > 0 ? 'gated' : 'neutral'}
              hint={runsUnknown ? 'History unavailable' : `Across ${kpis.runsWithFindings} run${kpis.runsWithFindings === 1 ? '' : 's'}`}
            />
          </div>
        </StatRow>
      )}

      <ActiveRunBanner runs={activeRuns} robotNames={robotNames} onAbort={(run) => void abort(run.routeId, run.routeName || run.routeId, run.robotId)} />

      <Tabs
        label="Patrol sections"
        tabs={[
          { id: 'routes', label: 'Routes', count: routes.length },
          { id: 'runs', label: 'Runs', count: runs.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'routes' && (
        <RouteList
          routes={routes}
          lastRunByRoute={lastRunByRoute}
          robotNames={robotNames}
          isLoading={routesStatus === 'loading' || routesStatus === 'idle'}
          error={routesStatus === 'error' && routes.length === 0 ? (routesError ?? 'Failed to load routes') : null}
          onRetry={() => void fetchRoutes()}
          onStart={(route, mode) => setStarting({ route, mode })}
          onAbort={handleAbortRoute}
          onExport={(route) => void exportRouteVda5050(route)}
          onDelete={(route) => void handleDelete(route)}
        />
      )}
      {tab === 'runs' && (
        <RunHistory
          runs={runs}
          robotNames={robotNames}
          isLoading={runsStatus === 'loading' || runsStatus === 'idle'}
          error={runsUnknown ? (runsError ?? 'Failed to load patrol runs') : null}
          onRetry={() => void fetchRuns()}
        />
      )}

      <RunStartModal
        route={starting?.route ?? null}
        initialMode={starting?.mode}
        robots={robotOptions}
        onClose={() => setStarting(null)}
        onStarted={() => void fetchRuns()}
      />
    </div>
  );
});

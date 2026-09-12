/**
 * @file TourPage.tsx
 * @description /tour — header with the live link, a three-tile summary, the
 *              tours in progress, and two tabs in the URL: Tours (table with
 *              start, end and delete) and Visits (the visit history). The
 *              structural twin of /patrol.
 * @feature tour
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { LinkButton, PageHeader, StatRow, StatTile, Tabs, confirm, errorMessage, toast } from '@/shared/components/ui';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { LiveTag } from '@/features/patrol/components/opsUi';
import type { TourRoute, TourRun } from '../types/tour.types';
import { useTourStore, selectActiveRuns, selectRoutes, selectRuns } from '../store/tourStore';
import { useTourEvents } from '../hooks/useTourEvents';
import { RouteList } from '../components/RouteList';
import { RunHistory } from '../components/RunHistory';
import { ActiveRunBanner } from '../components/ActiveRunBanner';
import { TourStartModal } from '../components/TourStartModal';
import { declinedTurns } from '../utils/tourFormat';

/** Refresh cadence for the lists while the page is open (events cover the live part). */
const REFRESH_MS = 30_000;
/** Window of the "Visits · 24 h" tile. */
const DAY_MS = 24 * 60 * 60 * 1000;
const TABS = [
  { id: 'tours', label: 'Tours' },
  { id: 'visits', label: 'Visits' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export interface TourPageProps {
  className?: string;
}

export const TourPage = memo(function TourPage({ className }: TourPageProps) {
  const { can } = useAuth();
  const canWrite = can('tasks:write');
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);

  const routes = useTourStore(selectRoutes);
  const routesStatus = useTourStore((s) => s.routesStatus);
  const routesError = useTourStore((s) => s.routesError);
  const runs = useTourStore(selectRuns);
  const runsStatus = useTourStore((s) => s.runsStatus);
  const runsError = useTourStore((s) => s.runsError);
  const activeRuns = useTourStore(selectActiveRuns);
  const fetchRoutes = useTourStore((s) => s.fetchRoutes);
  const fetchRuns = useTourStore((s) => s.fetchRuns);
  const abortRun = useTourStore((s) => s.abortRun);
  const deleteRoute = useTourStore((s) => s.deleteRoute);
  const clearError = useTourStore((s) => s.clearError);

  const { isConnected } = useTourEvents();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'tours';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === TABS[0].id) p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true },
    );

  const [starting, setStarting] = useState<TourRoute | null>(null);

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
      toast.warning("Couldn't refresh guide data", {
        id: 'tour-stale',
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
  // With no history in hand a failed run fetch would render "0 visits / 0
  // questions", which reads as "nobody visited" instead of "we could not ask".
  const runsUnknown = runsStatus === 'error' && runs.length === 0;

  const abort = useCallback(
    async (routeId: string, routeName: string, robotId: string | null) => {
      const ok = await confirm({
        title: `End the tour ${routeName}?`,
        description: 'The robot says goodbye, stops the tour and walks back to its greeting place.',
        confirmLabel: 'End tour',
        tone: 'danger',
      });
      if (!ok) return;
      const done = await abortRun(routeId, robotId);
      if (done) toast.success('Tour ended', { description: routeName });
      else {
        toast.error("Couldn't end the tour", { description: useTourStore.getState().error ?? undefined });
        clearError();
      }
      void fetchRuns();
    },
    [abortRun, clearError, fetchRuns],
  );

  const handleAbortRoute = useCallback(
    (route: TourRoute) => {
      const run = lastRunByRoute[route.id];
      void abort(route.id, route.name, run?.robotId ?? route.robotId ?? robots[0]?.id ?? null);
    },
    [abort, lastRunByRoute, robots],
  );

  const handleDelete = useCallback(
    async (route: TourRoute) => {
      const ok = await confirm({ title: `Delete ${route.name}?`, description: 'The robot stops offering it. Its visit history stays.', tone: 'danger' });
      if (!ok) return;
      try {
        const done = await deleteRoute(route.id);
        if (!done) throw new Error(useTourStore.getState().error ?? 'The server refused.');
        toast.success('Tour deleted', { description: route.name });
      } catch (err) {
        toast.error("Couldn't delete tour", { description: errorMessage(err) });
      } finally {
        clearError();
      }
    },
    [deleteRoute, clearError],
  );

  const hasRoutes = routes.length > 0;
  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'} data-testid="tour-page">
      <PageHeader
        eyebrow="Automate"
        title="Guide"
        description="Tours the robot gives visitors, and the questions they asked."
        meta={<LiveTag connected={isConnected} data-testid="tour-live" />}
        actions={
          canWrite ? (
            <LinkButton to="/tour/routes/new" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} data-testid="tour-new-route">
              New tour
            </LinkButton>
          ) : undefined
        }
      />

      {/* A viewer reads this page. Saying so beats a row of dead buttons. */}
      {!canWrite && (
        <p className="text-[13px] text-ink-secondary" data-testid="tour-read-only">
          Read-only access. A member role or higher is required to manage routes and runs.
        </p>
      )}

      {hasRoutes && (
        <StatRow columns={3}>
          <div data-testid="tour-kpi-routes" className="contents">
            <StatTile label="Tours armed" value={kpis.enabled} unit={`/ ${routes.length}`} hint={`${kpis.greeting} greet on sight`} tone={kpis.enabled > 0 ? 'live' : 'neutral'} />
          </div>
          <div data-testid="tour-kpi-runs" className="contents">
            <StatTile
              label="Visits · 24 h"
              value={runsUnknown ? '—' : kpis.recent}
              hint={runsUnknown ? 'History unavailable' : `${kpis.recentDeclined} offer${kpis.recentDeclined === 1 ? '' : 's'} declined`}
            />
          </div>
          <div data-testid="tour-kpi-questions" className="contents">
            {/* The declined count turns into work: each one is a fact the tour does not carry yet. */}
            <StatTile
              label="Questions asked"
              value={runsUnknown ? '—' : kpis.questions}
              tone={!runsUnknown && kpis.declined > 0 ? 'gated' : 'neutral'}
              hint={runsUnknown ? 'History unavailable' : `${kpis.declined} the facts did not cover`}
            />
          </div>
        </StatRow>
      )}

      <ActiveRunBanner runs={activeRuns} robotNames={robotNames} onAbort={(run) => void abort(run.routeId, run.routeName || run.routeId, run.robotId)} />

      <Tabs
        label="Guide sections"
        tabs={[
          { id: 'tours', label: 'Tours', count: routes.length },
          { id: 'visits', label: 'Visits', count: runs.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'tours' && (
        <RouteList
          routes={routes}
          lastRunByRoute={lastRunByRoute}
          robotNames={robotNames}
          isLoading={routesStatus === 'loading' || routesStatus === 'idle'}
          error={routesStatus === 'error' && routes.length === 0 ? (routesError ?? 'Failed to load tours') : null}
          onRetry={() => void fetchRoutes()}
          onStart={setStarting}
          onAbort={handleAbortRoute}
          onDelete={(route) => void handleDelete(route)}
        />
      )}
      {tab === 'visits' && (
        <RunHistory
          runs={runs}
          robotNames={robotNames}
          isLoading={runsStatus === 'loading' || runsStatus === 'idle'}
          error={runsUnknown ? (runsError ?? 'Failed to load visits') : null}
          onRetry={() => void fetchRuns()}
        />
      )}

      <TourStartModal route={starting} robots={robotOptions} onClose={() => setStarting(null)} onStarted={() => void fetchRuns()} />
    </div>
  );
});

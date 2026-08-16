/**
 * @file RouteEditorPage.tsx
 * @description /patrol/routes/new and /patrol/routes/:id — the route editor
 *              with the route's own run history underneath.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import type { PatrolRoute } from '../types/patrol.types';
import { usePatrolStore, selectRouteById, selectRuns } from '../store/patrolStore';
import { RouteEditor } from '../components/RouteEditor';
import { RunHistory } from '../components/RunHistory';
import { PATROL_PANEL, SectionHeader } from '../components/patrolUi';

export interface RouteEditorPageProps {
  className?: string;
}

export const RouteEditorPage = memo(function RouteEditorPage({ className }: RouteEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  const route = usePatrolStore(selectRouteById(isNew ? null : id));
  const runs = usePatrolStore(selectRuns);
  const fetchRoute = usePatrolStore((s) => s.fetchRoute);
  const fetchRuns = usePatrolStore((s) => s.fetchRuns);
  const deleteRoute = usePatrolStore((s) => s.deleteRoute);
  const error = usePatrolStore((s) => s.error);

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  useEffect(() => {
    if (!isNew && id) {
      void fetchRoute(id);
      void fetchRuns({ routeId: id, limit: 20 });
    }
  }, [isNew, id, fetchRoute, fetchRuns]);

  const robotOptions = useMemo(() => robots.map((r) => ({ id: r.id, name: `${r.name} · ${r.model}` })), [robots]);
  const robotNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of robots) m[r.id] = r.name;
    return m;
  }, [robots]);
  const routeRuns = useMemo(() => (isNew ? [] : runs.filter((r) => r.routeId === id)), [runs, id, isNew]);

  const handleSaved = useCallback(
    (saved: PatrolRoute) => {
      if (isNew) navigate(`/patrol/routes/${encodeURIComponent(saved.id)}`, { replace: true });
    },
    [isNew, navigate]
  );

  const handleDelete = useCallback(
    async (r: PatrolRoute) => {
      if (typeof window !== 'undefined' && !window.confirm(`Delete route "${r.name}"? Its run history stays.`)) return;
      const ok = await deleteRoute(r.id);
      if (ok) navigate('/patrol', { replace: true });
    },
    [deleteRoute, navigate]
  );

  return (
    <div className={cn('min-h-screen', className)} data-testid="patrol-route-page">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 pb-32 lg:pb-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title={isNew ? 'New patrol route' : (route?.name ?? 'Patrol route')}
          subtitle={
            <Link to="/patrol" className="text-cobalt-500 hover:underline">
              ← All routes
            </Link>
          }
        />
        {!isNew && !route ? (
          <div className={cn(PATROL_PANEL, 'card-meta text-sm', !error && 'animate-pulse')}>{error ? `Route not found: ${error}` : 'Loading route…'}</div>
        ) : (
          <RouteEditor
            key={route?.id ?? 'new'}
            route={route}
            robots={robotOptions}
            onSaved={handleSaved}
            onCancel={() => navigate('/patrol')}
            onDelete={(r) => void handleDelete(r)}
          />
        )}
        {!isNew && route && (
          <section className="flex flex-col gap-2 min-w-0">
            <SectionHeader title="Runs of this route" count={routeRuns.length} />
            <RunHistory runs={routeRuns} robotNames={robotNames} hideRoute />
          </section>
        )}
      </div>
    </div>
  );
});

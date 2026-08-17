/**
 * @file TourEditorPage.tsx
 * @description /tour/routes/new and /tour/routes/:id — the tour editor with
 *              the tour's own visit history underneath.
 * @feature tour
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { PATROL_PANEL, SectionHeader } from '@/features/patrol/components/patrolUi';
import type { TourRoute } from '../types/tour.types';
import { useTourStore, selectRouteById, selectRuns } from '../store/tourStore';
import { RouteEditor } from '../components/RouteEditor';
import { RunHistory } from '../components/RunHistory';

export interface TourEditorPageProps {
  className?: string;
}

export const TourEditorPage = memo(function TourEditorPage({ className }: TourEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  const route = useTourStore(selectRouteById(isNew ? null : id));
  const runs = useTourStore(selectRuns);
  const fetchRoute = useTourStore((s) => s.fetchRoute);
  const fetchRuns = useTourStore((s) => s.fetchRuns);
  const deleteRoute = useTourStore((s) => s.deleteRoute);
  const error = useTourStore((s) => s.error);

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
    (saved: TourRoute) => {
      if (isNew) navigate(`/tour/routes/${encodeURIComponent(saved.id)}`, { replace: true });
    },
    [isNew, navigate]
  );

  const handleDelete = useCallback(
    async (r: TourRoute) => {
      // The visits survive the tour, exactly as patrol runs survive a route —
      // the operator has to know that before they confirm.
      if (typeof window !== 'undefined' && !window.confirm(`Delete the tour "${r.name}"? Its visit history stays.`)) return;
      const ok = await deleteRoute(r.id);
      if (ok) navigate('/tour', { replace: true });
    },
    [deleteRoute, navigate]
  );

  return (
    <div className={cn('min-h-screen', className)} data-testid="tour-route-page">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 pb-32 lg:pb-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title={isNew ? 'New tour' : (route?.name ?? 'Tour')}
          subtitle={
            <Link to="/tour" className="text-cobalt-500 hover:underline">
              ← All tours
            </Link>
          }
        />
        {!isNew && !route ? (
          <div className={cn(PATROL_PANEL, 'card-meta text-sm', !error && 'animate-pulse')}>{error ? `Tour not found: ${error}` : 'Loading tour…'}</div>
        ) : (
          <RouteEditor
            key={route?.id ?? 'new'}
            route={route}
            robots={robotOptions}
            onSaved={handleSaved}
            onCancel={() => navigate('/tour')}
            onDelete={(r) => void handleDelete(r)}
          />
        )}
        {!isNew && route && (
          <section className="flex flex-col gap-2 min-w-0">
            <SectionHeader title="Visits of this tour" count={routeRuns.length} />
            <RunHistory runs={routeRuns} robotNames={robotNames} hideRoute />
          </section>
        )}
      </div>
    </div>
  );
});

/**
 * @file TourEditorPage.tsx
 * @description /tour/routes/new and /tour/routes/:id — the tour editor (one
 *              form with a sticky Cancel/Save footer), the header menu with
 *              Delete, and the tour's own visits underneath. The structural twin
 *              of the patrol route editor page.
 * @feature tour
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, Trash2 } from 'lucide-react';
import { EmptyState, ErrorState, LinkButton, PageHeader, Panel, RowActions, SkeletonText, confirm, toast } from '@/shared/components/ui';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { ArmedTag } from '@/features/patrol/components/opsUi';
import type { TourRoute } from '../types/tour.types';
import { useTourStore, selectRouteById, selectRuns } from '../store/tourStore';
import { RouteEditor } from '../components/RouteEditor';
import { RunHistory } from '../components/RunHistory';

const BACK = { to: '/tour', label: 'Guide' };

export interface TourEditorPageProps {
  className?: string;
}

export const TourEditorPage = memo(function TourEditorPage({ className }: TourEditorPageProps) {
  const { can } = useAuth();
  const canWrite = can('tasks:write');
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  const route = useTourStore(selectRouteById(isNew ? null : id));
  const runs = useTourStore(selectRuns);
  const runsStatus = useTourStore((s) => s.runsStatus);
  const fetchRoute = useTourStore((s) => s.fetchRoute);
  const fetchRuns = useTourStore((s) => s.fetchRuns);
  const deleteRoute = useTourStore((s) => s.deleteRoute);
  const clearError = useTourStore((s) => s.clearError);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    setLoadError(null);
    const found = await fetchRoute(id);
    if (!found) {
      setLoadError(useTourStore.getState().error ?? 'Tour not found');
      clearError();
    }
    void fetchRuns({ routeId: id, limit: 20 });
  }, [isNew, id, fetchRoute, fetchRuns, clearError]);

  useEffect(() => {
    void load();
  }, [load]);

  const robotOptions = useMemo(() => robots.map((r) => ({ id: r.id, name: r.name })), [robots]);
  const robotNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of robots) m[r.id] = r.name;
    return m;
  }, [robots]);
  const routeRuns = useMemo(() => (isNew ? [] : runs.filter((r) => r.routeId === id)), [runs, id, isNew]);

  const handleSaved = useCallback(
    (saved: TourRoute) => {
      if (isNew) {
        toast.success('Tour created', { description: saved.name });
        navigate(`/tour/routes/${encodeURIComponent(saved.id)}`, { replace: true });
      } else {
        toast.success('Tour updated', { description: saved.name });
      }
    },
    [isNew, navigate],
  );

  const handleDelete = useCallback(
    async (r: TourRoute) => {
      // The visits survive the tour, exactly as patrol runs survive a route.
      const ok = await confirm({ title: `Delete ${r.name}?`, description: 'The robot stops offering it. Its visit history stays.', tone: 'danger' });
      if (!ok) return;
      const done = await deleteRoute(r.id);
      if (done) {
        toast.success('Tour deleted', { description: r.name });
        navigate('/tour', { replace: true });
      } else {
        toast.error("Couldn't delete tour", { description: useTourStore.getState().error ?? undefined });
        clearError();
      }
    },
    [deleteRoute, navigate, clearError],
  );

  const root = className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6';

  if (isNew && !canWrite) {
    return (
      <div className={root} data-testid="tour-route-page">
        <PageHeader eyebrow="Operate" back={BACK} title="New tour" />
        <Panel>
          <EmptyState
            icon={<Lock />}
            title="Read-only access"
            description="A member role or higher is required to create a tour."
            action={<LinkButton to="/tour" variant="secondary">Back to tours</LinkButton>}
          />
        </Panel>
      </div>
    );
  }

  if (!isNew && !route) {
    return (
      <div className={root} data-testid="tour-route-page">
        <PageHeader eyebrow="Operate" back={BACK} title={loadError ? 'Tour' : 'Loading…'} />
        <Panel>
          {loadError ? <ErrorState title="Couldn't load this tour" message={loadError} onRetry={() => void load()} /> : <SkeletonText lines={4} />}
        </Panel>
      </div>
    );
  }

  return (
    <div className={root} data-testid="tour-route-page">
      <PageHeader
        eyebrow="Operate"
        back={BACK}
        title={isNew ? 'New tour' : route!.name}
        description={isNew ? 'A tour is the ordered list of places the robot walks a visitor to, with what it says at each one.' : undefined}
        meta={route ? <ArmedTag enabled={route.enabled} /> : undefined}
        actions={
          route ? (
            <RowActions
              label="More actions"
              items={[{ label: 'Delete', icon: <Trash2 />, tone: 'danger', disabled: !canWrite, onSelect: () => void handleDelete(route) }]}
            />
          ) : undefined
        }
      />
      <RouteEditor readOnly={!canWrite} key={route?.id ?? 'new'} route={route} robots={robotOptions} onSaved={handleSaved} onCancel={() => navigate('/tour')} />
      {route && (
        <Panel>
          <Panel.Header title="Visits of this tour" description="The last 20 visits, newest first." />
          <RunHistory runs={routeRuns} robotNames={robotNames} hideRoute isLoading={runsStatus === 'loading' && routeRuns.length === 0} />
        </Panel>
      )}
    </div>
  );
});

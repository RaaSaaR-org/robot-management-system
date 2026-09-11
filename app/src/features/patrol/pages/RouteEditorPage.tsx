/**
 * @file RouteEditorPage.tsx
 * @description /patrol/routes/new and /patrol/routes/:id — the route editor
 *              (one form with a sticky Cancel/Save footer), the header menu with
 *              Export VDA5050 and Delete, and the route's own runs underneath.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { ErrorState, PageHeader, Panel, RowActions, SkeletonText, confirm, toast } from '@/shared/components/ui';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import type { PatrolRoute } from '../types/patrol.types';
import { usePatrolStore, selectRouteById, selectRuns } from '../store/patrolStore';
import { RouteEditor } from '../components/RouteEditor';
import { RunHistory } from '../components/RunHistory';
import { ArmedTag } from '../components/opsUi';
import { exportRouteVda5050 } from '../utils/routeExport';

const BACK = { to: '/patrol', label: 'Patrol' };

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
  const runsStatus = usePatrolStore((s) => s.runsStatus);
  const fetchRoute = usePatrolStore((s) => s.fetchRoute);
  const fetchRuns = usePatrolStore((s) => s.fetchRuns);
  const deleteRoute = usePatrolStore((s) => s.deleteRoute);
  const clearError = usePatrolStore((s) => s.clearError);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    setLoadError(null);
    const found = await fetchRoute(id);
    if (!found) {
      setLoadError(usePatrolStore.getState().error ?? 'Route not found');
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
    (saved: PatrolRoute) => {
      if (isNew) {
        toast.success('Route created', { description: saved.name });
        navigate(`/patrol/routes/${encodeURIComponent(saved.id)}`, { replace: true });
      } else {
        toast.success('Route updated', { description: saved.name });
      }
    },
    [isNew, navigate],
  );

  const handleDelete = useCallback(
    async (r: PatrolRoute) => {
      const ok = await confirm({ title: `Delete ${r.name}?`, description: 'Scheduled runs stop. Its run history stays.', tone: 'danger' });
      if (!ok) return;
      const done = await deleteRoute(r.id);
      if (done) {
        toast.success('Route deleted', { description: r.name });
        navigate('/patrol', { replace: true });
      } else {
        toast.error("Couldn't delete route", { description: usePatrolStore.getState().error ?? undefined });
        clearError();
      }
    },
    [deleteRoute, navigate, clearError],
  );

  const root = className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6';

  if (!isNew && !route) {
    return (
      <div className={root} data-testid="patrol-route-page">
        <PageHeader eyebrow="Operate" back={BACK} title={loadError ? 'Route' : 'Loading…'} />
        <Panel>
          {loadError ? <ErrorState title="Couldn't load this route" message={loadError} onRetry={() => void load()} /> : <SkeletonText lines={4} />}
        </Panel>
      </div>
    );
  }

  return (
    <div className={root} data-testid="patrol-route-page">
      <PageHeader
        eyebrow="Operate"
        back={BACK}
        title={isNew ? 'New route' : route!.name}
        description={isNew ? 'A route is the ordered list of places a robot walks, with a schedule and a baseline of what is normal.' : undefined}
        meta={route ? <ArmedTag enabled={route.enabled} /> : undefined}
        actions={
          route ? (
            <RowActions
              label="More actions"
              items={[
                { label: 'Export VDA5050', icon: <Download />, onSelect: () => void exportRouteVda5050(route) },
                { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void handleDelete(route) },
              ]}
            />
          ) : undefined
        }
      />
      <RouteEditor key={route?.id ?? 'new'} route={route} robots={robotOptions} onSaved={handleSaved} onCancel={() => navigate('/patrol')} />
      {route && (
        <Panel>
          <Panel.Header title="Runs of this route" description="The last 20 runs, newest first." />
          <RunHistory
            runs={routeRuns}
            robotNames={robotNames}
            hideRoute
            isLoading={runsStatus === 'loading' && routeRuns.length === 0}
          />
        </Panel>
      )}
    </div>
  );
});

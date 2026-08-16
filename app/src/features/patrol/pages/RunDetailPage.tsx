/**
 * @file RunDetailPage.tsx
 * @description /patrol/runs/:runId — one run with legs, photo pairs and
 *              findings; stays live over the WebSocket while the run runs.
 * @feature patrol
 */

import { memo, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { usePatrolEvents } from '../hooks/usePatrolEvents';
import { RunDetail } from '../components/RunDetail';

export interface RunDetailPageProps {
  className?: string;
}

export const RunDetailPage = memo(function RunDetailPage({ className }: RunDetailPageProps) {
  const { runId } = useParams<{ runId: string }>();
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  usePatrolEvents();

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  const robotNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of robots) m[r.id] = r.name;
    return m;
  }, [robots]);

  return (
    <div className={cn('min-h-screen', className)} data-testid="patrol-run-page">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Patrol run"
          subtitle={
            <Link to="/patrol" className="text-cobalt-500 hover:underline">
              ← All routes and runs
            </Link>
          }
        />
        {runId ? <RunDetail runId={runId} robotNames={robotNames} /> : <div className="glass-card p-4 card-meta">No run selected.</div>}
      </div>
    </div>
  );
});

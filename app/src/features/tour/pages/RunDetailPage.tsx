/**
 * @file RunDetailPage.tsx
 * @description /tour/runs/:runId — one visit: the stop timeline and the Q&A
 *              transcript; stays live over the WebSocket while the tour runs.
 * @feature tour
 */

import { memo, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { PATROL_MOTION, PATROL_PANEL } from '@/features/patrol/components/patrolUi';
import { useTourEvents } from '../hooks/useTourEvents';
import { RunDetail } from '../components/RunDetail';

export interface RunDetailPageProps {
  className?: string;
}

export const RunDetailPage = memo(function RunDetailPage({ className }: RunDetailPageProps) {
  const { runId } = useParams<{ runId: string }>();
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  useTourEvents();

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  const robotNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of robots) m[r.id] = r.name;
    return m;
  }, [robots]);

  return (
    <div className={cn('min-h-screen', className)} data-testid="tour-run-page">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Visit"
          subtitle={
            <Link to="/tour" className={cn('text-cobalt-600 dark:text-cobalt-400 hover:underline', PATROL_MOTION)}>
              ← All tours and visits
            </Link>
          }
        />
        {runId ? <RunDetail runId={runId} robotNames={robotNames} /> : <div className={cn(PATROL_PANEL, 'card-meta')}>No visit selected.</div>}
      </div>
    </div>
  );
});

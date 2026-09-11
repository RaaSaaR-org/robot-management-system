/**
 * @file RunDetailPage.tsx
 * @description /tour/runs/:runId — one visit: questions, facts to add and the
 *              stop timeline; stays live over the WebSocket while the tour
 *              runs. RunDetail renders the page header because it owns the run.
 * @feature tour
 */

import { memo, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
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
    <div className={cn('min-w-0', className)} data-testid="tour-run-page">
      <RunDetail runId={runId ?? ''} robotNames={robotNames} />
    </div>
  );
});

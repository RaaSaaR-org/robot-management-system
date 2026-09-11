/**
 * @file RunDetailPage.tsx
 * @description /patrol/runs/:runId — one run with findings, checkpoints and
 *              photo pairs; stays live over the WebSocket while the run runs.
 *              RunDetail renders the page header because it owns the run.
 * @feature patrol
 */

import { memo, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
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
    <div className={cn('min-w-0', className)} data-testid="patrol-run-page">
      <RunDetail runId={runId ?? ''} robotNames={robotNames} />
    </div>
  );
});

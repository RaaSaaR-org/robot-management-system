/**
 * @file ActiveRunBanner.tsx
 * @description The live runs above the tabs on /patrol: one highlighted panel
 *              per running run (fed by `agent:patrol:*` events) with the route
 *              as a stepper, the current checkpoint, an elapsed clock and
 *              "Abort run". Renders nothing when no run is active.
 * @feature patrol
 */

import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { PatrolRun } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { runProgressText } from '../utils/patrolFormat';
import { RoutePath, RunStatusTag, formatElapsed } from './opsUi';

export interface ActiveRunBannerProps {
  runs: PatrolRun[];
  robotNames: Record<string, string>;
  onAbort: (run: PatrolRun) => void;
  className?: string;
}

/** Ticks once a second while mounted (only mounted while a run is active). */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const ActiveRunCard = memo(function ActiveRunCard({
  run,
  robotNames,
  onAbort,
  now,
}: {
  run: PatrolRun;
  robotNames: Record<string, string>;
  onAbort: (run: PatrolRun) => void;
  now: number;
}) {
  const { can } = useAuth();
  const canWrite = can('tasks:write');
  const current = run.legs.find((l) => l.status === 'running');
  const legs = run.legs.map((l) => ({
    index: l.index,
    label: l.name || l.placeId,
    status: l.status,
    findingCount: l.findingIds.length,
  }));
  return (
    <Panel variant="highlight" padding="sm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusTag status="running" />
            <Link
              to={`/patrol/runs/${encodeURIComponent(run.runId)}`}
              className="min-w-0 truncate text-sm font-semibold text-ink-primary hover:text-primary"
            >
              {PATROL_RUN_MODE_LABELS[run.mode]} run · {run.routeName || run.routeId}
            </Link>
          </div>
          <span className="text-[13px] text-ink-secondary">
            {robotNames[run.robotId] ?? run.robotId}
            {current ? ` · at leg ${current.index + 1}: ${current.name || current.placeId}` : ''} · {runProgressText(run)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Ticks every second — kept out of the live region so it is not announced 60× a minute. */}
          <span className="text-sm tabular-nums text-ink-primary" title="Elapsed" aria-hidden="true">
            {formatElapsed(run.startedAt, now)}
          </span>
          <Button variant="secondary" size="sm" leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />} data-testid="patrol-abort" disabled={!canWrite} onClick={() => onAbort(run)}>
            Abort run
          </Button>
        </div>
      </div>
      {legs.length > 0 && <RoutePath size="md" legs={legs} activeIndex={current?.index} className="max-w-3xl" />}
    </Panel>
  );
});

/** Split so the 1-s clock only exists (and re-renders) while a run is active. */
const ActiveRunRail = memo(function ActiveRunRail({ runs, robotNames, onAbort, className }: ActiveRunBannerProps) {
  const now = useClock();
  return (
    <div className={className ?? 'flex flex-col gap-3'} data-testid="patrol-active-banner" role="status" aria-live="polite">
      {runs.map((run) => (
        <ActiveRunCard key={run.runId} run={run} robotNames={robotNames} onAbort={onAbort} now={now} />
      ))}
    </div>
  );
});

export const ActiveRunBanner = memo(function ActiveRunBanner({ runs, robotNames, onAbort, className }: ActiveRunBannerProps) {
  if (runs.length === 0) return null;
  return <ActiveRunRail runs={runs} robotNames={robotNames} onAbort={onAbort} className={className} />;
});

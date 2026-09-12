/**
 * @file ActiveRunBanner.tsx
 * @description The tours in progress above the tabs on /tour: one highlighted
 *              panel per running visit (fed by `agent:tour:*` events) with the
 *              stops as a stepper, the current stop, an elapsed clock and "End
 *              tour". Renders nothing when no tour is running. Mirrors patrol.
 * @feature tour
 */

import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { RoutePath, RunStatusTag, formatElapsed } from '@/features/patrol/components/opsUi';
import type { TourRun } from '../types/tour.types';
import { currentLeg, currentStopText, runProgressText } from '../utils/tourFormat';

export interface ActiveRunBannerProps {
  runs: TourRun[];
  robotNames: Record<string, string>;
  onAbort: (run: TourRun) => void;
  className?: string;
}

/** Ticks once a second while mounted (only mounted while a tour is running). */
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
  run: TourRun;
  robotNames: Record<string, string>;
  onAbort: (run: TourRun) => void;
  now: number;
}) {
  const { can } = useAuth();
  const canWrite = can('tasks:write');
  const current = currentLeg(run);
  // Shared with the Agent Mode rail's tour chip — see `currentStopText`.
  const stopText = currentStopText(current ? { index: current.index + 1, name: current.name || current.placeId } : null);
  const legs = run.legs.map((l) => ({ index: l.index, label: l.name || l.placeId, status: l.status }));
  return (
    <Panel variant="highlight" padding="sm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusTag status="running" />
            <Link to={`/tour/runs/${encodeURIComponent(run.runId)}`} className="min-w-0 truncate text-sm font-semibold text-ink-primary hover:text-primary">
              {run.routeName || run.routeId}
            </Link>
          </div>
          {/* The stop's headline, not its index: it is what the operator can match against what the robot is saying. */}
          <span className="text-[13px] text-ink-secondary" data-testid="tour-banner-stop">
            {robotNames[run.robotId] ?? run.robotId}
            {stopText ? ` · ${stopText}` : ' · walking'} · {runProgressText(run)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Ticks every second — kept out of the live region so it is not announced 60× a minute. */}
          <span className="text-sm tabular-nums text-ink-primary" title="Elapsed" aria-hidden="true">
            {formatElapsed(run.startedAt, now)}
          </span>
          <Button variant="secondary" size="sm" leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />} data-testid="tour-abort" disabled={!canWrite} onClick={() => onAbort(run)}>
            End tour
          </Button>
        </div>
      </div>
      {legs.length > 0 && <RoutePath size="md" legs={legs} activeIndex={current?.index} className="max-w-3xl" />}
    </Panel>
  );
});

/** Split so the 1-s clock only exists (and re-renders) while a tour is running. */
const ActiveRunRail = memo(function ActiveRunRail({ runs, robotNames, onAbort, className }: ActiveRunBannerProps) {
  const now = useClock();
  return (
    <div className={className ?? 'flex flex-col gap-3'} data-testid="tour-active-banner" role="status" aria-live="polite">
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

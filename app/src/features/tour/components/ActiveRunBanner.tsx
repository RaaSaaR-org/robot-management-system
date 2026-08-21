/**
 * @file ActiveRunBanner.tsx
 * @description The /tour page's live rail: one glowing card per running tour
 *              (fed by `agent:tour:*` events) with the stops as a numbered
 *              stepper, the headline of the stop the robot is standing at, an
 *              elapsed clock, the question count and an End tour button.
 *              Renders nothing when no tour is running.
 * @feature tour
 */

import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import {
  PATROL_FADE_IN,
  PATROL_GLOW_LIVE,
  PATROL_LIVE_BORDER,
  PATROL_MICRO,
  PATROL_MONO,
  RoutePath,
  StatusDot,
} from '@/features/patrol/components/patrolUi';
import type { TourRun } from '../types/tour.types';
import { currentLeg, runProgressText } from '../utils/tourFormat';

export interface ActiveRunBannerProps {
  runs: TourRun[];
  robotNames: Record<string, string>;
  onAbort: (run: TourRun) => void;
  className?: string;
}

/** `mm:ss` (or `h:mm:ss` past an hour) since `iso`; never negative. */
function formatElapsed(iso: string, now: number): string {
  const started = Date.parse(iso);
  const total = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
  const current = currentLeg(run);
  const legs = run.legs.map((l) => ({ index: l.index, label: l.name || l.placeId, status: l.status }));
  return (
    <div
      className={cn(
        'glass-elevated rounded-brand-lg px-4 py-3 grid gap-3 sm:grid-cols-[auto_1fr_auto] items-center min-w-0',
        PATROL_LIVE_BORDER,
        PATROL_GLOW_LIVE,
        PATROL_FADE_IN
      )}
    >
      <div className="flex items-center gap-2 shrink-0">
        <StatusDot tone="primary" pulse />
        <span className={cn(PATROL_MICRO, 'text-cobalt-700 dark:text-cobalt-300')}>With a visitor</span>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0">
        <Link
          to={`/tour/runs/${encodeURIComponent(run.runId)}`}
          className="font-display font-semibold text-theme-primary hover:text-cobalt-500 truncate transition-colors duration-200"
        >
          {run.routeName || run.routeId}
        </Link>
        {legs.length > 0 && <RoutePath size="sm" legs={legs} activeIndex={current?.index} className="max-w-md" />}
        {/* The stop's headline, not its index: it is the thing the operator can
            match against what the robot is saying out loud right now. */}
        <span className="text-xs text-theme-secondary truncate" data-testid="tour-banner-stop">
          {robotNames[run.robotId] ?? run.robotId}
          {current ? ` · at stop ${current.index + 1}: ${current.name || current.placeId}` : ' · walking'} · {runProgressText(run)}
        </span>
      </div>

      <div className="flex items-center gap-3 sm:justify-end min-w-0">
        {/* Ticks every second — kept out of the live region so it is not announced 60× a minute. */}
        <span className={cn(PATROL_MONO, 'text-sm text-theme-primary')} title="Elapsed" aria-hidden="true">
          {formatElapsed(run.startedAt, now)}
        </span>
        <Button size="sm" variant="destructive" className="flex-1 sm:flex-none min-h-9" data-testid="tour-abort" onClick={() => onAbort(run)}>
          End tour
        </Button>
      </div>
    </div>
  );
});

/** Split so the 1-s clock only exists (and re-renders) while a tour is running. */
const ActiveRunRail = memo(function ActiveRunRail({ runs, robotNames, onAbort, className }: ActiveRunBannerProps) {
  const now = useClock();
  return (
    <div className={cn('flex flex-col gap-2 min-w-0', className)} data-testid="tour-active-banner" role="status" aria-live="polite">
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

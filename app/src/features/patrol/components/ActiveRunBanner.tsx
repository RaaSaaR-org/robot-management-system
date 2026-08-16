/**
 * @file ActiveRunBanner.tsx
 * @description The patrol page's live run rail: one glowing card per running
 *              run (fed by `agent:patrol:*` events) with the route as a
 *              numbered node→node stepper, the current leg, an elapsed clock
 *              and an Abort. Renders nothing when no run is active.
 * @feature patrol
 */

import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import type { PatrolRun } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { runProgressText } from '../utils/patrolFormat';
import {
  PATROL_FADE_IN,
  PATROL_GLOW_LIVE,
  PATROL_LIVE_BORDER,
  PATROL_MICRO,
  PATROL_MONO,
  RoutePath,
  StatusDot,
} from './patrolUi';

export interface ActiveRunBannerProps {
  runs: PatrolRun[];
  robotNames: Record<string, string>;
  onAbort: (run: PatrolRun) => void;
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
  const current = run.legs.find((l) => l.status === 'running');
  const legs = run.legs.map((l) => ({
    index: l.index,
    label: l.name || l.placeId,
    status: l.status,
    findingCount: l.findingIds.length,
  }));
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
        <span className={cn(PATROL_MICRO, 'text-cobalt-700 dark:text-cobalt-300')}>Running</span>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0">
        <Link
          to={`/patrol/runs/${encodeURIComponent(run.runId)}`}
          className="font-display font-semibold text-theme-primary hover:text-cobalt-500 truncate transition-colors duration-200"
        >
          {PATROL_RUN_MODE_LABELS[run.mode]} run · {run.routeName || run.routeId}
        </Link>
        {legs.length > 0 && <RoutePath size="sm" legs={legs} activeIndex={current?.index} className="max-w-md" />}
        <span className="text-xs text-theme-secondary truncate">
          {robotNames[run.robotId] ?? run.robotId}
          {current ? ` · at leg ${current.index + 1}: ${current.name || current.placeId}` : ''} · {runProgressText(run)}
        </span>
      </div>

      <div className="flex items-center gap-3 sm:justify-end min-w-0">
        {/* Ticks every second — kept out of the live region so it is not announced 60× a minute. */}
        <span className={cn(PATROL_MONO, 'text-sm text-theme-primary')} title="Elapsed" aria-hidden="true">
          {formatElapsed(run.startedAt, now)}
        </span>
        <Button
          size="sm"
          variant="destructive"
          className="flex-1 sm:flex-none min-h-9"
          data-testid="patrol-abort"
          onClick={() => onAbort(run)}
        >
          Abort
        </Button>
      </div>
    </div>
  );
});

/** Split so the 1-s clock only exists (and re-renders) while a run is active. */
const ActiveRunRail = memo(function ActiveRunRail({ runs, robotNames, onAbort, className }: ActiveRunBannerProps) {
  const now = useClock();
  return (
    <div className={cn('flex flex-col gap-2 min-w-0', className)} data-testid="patrol-active-banner" role="status" aria-live="polite">
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

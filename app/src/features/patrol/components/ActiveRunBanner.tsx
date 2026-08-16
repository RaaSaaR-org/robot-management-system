/**
 * @file ActiveRunBanner.tsx
 * @description The patrol page's live strip: one line per running run (fed by
 *              `agent:patrol:*` events), with progress and an Abort. Renders
 *              nothing when no run is active.
 * @feature patrol
 */

import { memo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import type { PatrolRun } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { runProgressText } from '../utils/patrolFormat';

export interface ActiveRunBannerProps {
  runs: PatrolRun[];
  robotNames: Record<string, string>;
  onAbort: (run: PatrolRun) => void;
  className?: string;
}

export const ActiveRunBanner = memo(function ActiveRunBanner({ runs, robotNames, onAbort, className }: ActiveRunBannerProps) {
  if (runs.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="patrol-active-banner" role="status" aria-live="polite">
      {runs.map((run) => {
        const current = run.legs.find((l) => l.status === 'running');
        return (
          <div
            key={run.runId}
            className="glass-card border border-cobalt-500/30 bg-cobalt-500/5 px-3 py-2 flex flex-wrap items-center gap-2 min-w-0"
          >
            <span className="w-2 h-2 rounded-full bg-cobalt-500 animate-pulse shrink-0" aria-hidden="true" />
            <Link to={`/patrol/runs/${encodeURIComponent(run.runId)}`} className="font-medium text-theme-primary hover:text-cobalt-500 truncate">
              {PATROL_RUN_MODE_LABELS[run.mode]} run · {run.routeName || run.routeId}
            </Link>
            <span className="text-xs text-theme-secondary truncate">
              {robotNames[run.robotId] ?? run.robotId}
              {current ? ` · at leg ${current.index + 1}: ${current.name || current.placeId}` : ''} · {runProgressText(run)}
            </span>
            <Button size="sm" variant="destructive" className="ml-auto" data-testid="patrol-abort" onClick={() => onAbort(run)}>
              Abort
            </Button>
          </div>
        );
      })}
    </div>
  );
});

/**
 * @file RunHistory.tsx
 * @description Run history: a sticky-headed table on ≥ md (status first, then
 *              when, route, robot, mode, a per-leg mini bar and the finding
 *              count) and a stacked card list on phones. Rows link to RunDetail.
 * @feature patrol
 */

import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import type { PatrolLegStatus, PatrolRun } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { RunStatusChip } from './FindingBadge';
import { formatWhen, runProgressText } from '../utils/patrolFormat';
import {
  PATROL_ATTENTION_TEXT,
  PATROL_INSET_HOVER,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
} from './patrolUi';

export interface RunHistoryProps {
  runs: PatrolRun[];
  robotNames: Record<string, string>;
  /** Hide the route column when the table is scoped to one route. */
  hideRoute?: boolean;
  className?: string;
}

const SEGMENT: Record<PatrolLegStatus, string> = {
  pending: 'bg-surface-light-300 dark:bg-surface-500',
  running: 'bg-cobalt-500 animate-pulse',
  done: 'bg-turquoise-600 dark:bg-turquoise-500',
  failed: 'bg-red-500',
  skipped: 'bg-surface-light-400 dark:bg-surface-400',
};

/** One segment per leg, coloured by leg status — the run at a glance. */
const LegBar = memo(function LegBar({ run, className }: { run: PatrolRun; className?: string }) {
  if (run.legs.length === 0) return null;
  return (
    <div className={cn('flex gap-0.5 h-1.5 w-full max-w-[7rem]', className)} aria-hidden="true">
      {run.legs.map((leg) => (
        <span key={leg.index} className={cn('flex-1 rounded-sm', PATROL_MOTION, SEGMENT[leg.status])} />
      ))}
    </div>
  );
});

/** Amber pill when there is something to look at, muted `0` otherwise. */
const FindingsPill = memo(function FindingsPill({ count }: { count: number }) {
  return count > 0 ? (
    <span className={cn('inline-flex items-center justify-center glass-subtle rounded-full px-2 py-px font-mono tabular-nums text-xs font-medium min-w-6', PATROL_ATTENTION_TEXT)}>
      {count}
    </span>
  ) : (
    <span className="font-mono tabular-nums text-xs text-theme-muted px-2">{count}</span>
  );
});

function showReason(run: PatrolRun): boolean {
  return Boolean(run.reason) && (run.status === 'skipped' || run.status === 'aborted' || run.status === 'failed');
}

export const RunHistory = memo(function RunHistory({ runs, robotNames, hideRoute, className }: RunHistoryProps) {
  const navigate = useNavigate();
  if (runs.length === 0) {
    return (
      <div className={cn('glass-card rounded-brand-lg p-4', className)} data-testid="patrol-run-history">
        <EmptyState size="sm" title="No runs yet" description="Baseline and patrol runs show up here as the robot reports them." />
      </div>
    );
  }
  const th = cn('px-3 py-2.5 text-left font-medium', PATROL_MICRO);
  return (
    <div className={cn('min-w-0', className)} data-testid="patrol-run-history">
      {/* ≥ md: table (carries the row testids) */}
      <div className="hidden md:block glass-card rounded-brand-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 z-10 bg-glass-elevated backdrop-blur">
              <tr className="border-b border-glass-subtle">
                <th className={th}>Status</th>
                <th className={th}>Started</th>
                {!hideRoute && <th className={th}>Route</th>}
                <th className={th}>Robot</th>
                <th className={th}>Mode</th>
                <th className={th}>Progress</th>
                <th className={cn(th, 'text-right')}>Findings</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.runId}
                  className={cn(
                    'border-b border-glass-subtle last:border-b-0 hover:bg-theme-hover cursor-pointer',
                    PATROL_MOTION,
                  )}
                  data-testid="patrol-run-row"
                  data-run-id={run.runId}
                  data-status={run.status}
                  // The row already highlights under the pointer, so it has to
                  // do what that promises. The timestamp stays a real <Link>:
                  // it is what keyboard and screen-reader users tab to, and
                  // what "open in a new tab" needs.
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a,button')) return;
                    navigate(`/patrol/runs/${encodeURIComponent(run.runId)}`);
                  }}
                >
                  <td className="px-3 py-2 min-w-0">
                    <RunStatusChip status={run.status} />
                    {showReason(run) && (
                      <span className="block text-[11px] text-theme-tertiary max-w-[16rem] truncate" title={run.reason ?? undefined}>
                        {run.reason}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/patrol/runs/${encodeURIComponent(run.runId)}`}
                      className={cn(PATROL_MONO, 'text-theme-primary hover:text-cobalt-500 whitespace-nowrap', PATROL_MOTION)}
                    >
                      {formatWhen(run.startedAt)}
                    </Link>
                  </td>
                  {!hideRoute && (
                    <td className="px-3 py-2 text-theme-secondary truncate max-w-[14rem]" title={run.routeName}>
                      {run.routeName}
                    </td>
                  )}
                  <td className="px-3 py-2 text-theme-secondary truncate max-w-[10rem]">{robotNames[run.robotId] ?? run.robotId}</td>
                  <td className="px-3 py-2 text-xs text-theme-secondary whitespace-nowrap">
                    {PATROL_RUN_MODE_LABELS[run.mode]} · {run.origin}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1 min-w-[7rem]">
                      <LegBar run={run} />
                      <span className={PATROL_MONO}>{runProgressText(run)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <FindingsPill count={run.findingCount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* < md: stacked cards */}
      <ul className="md:hidden flex flex-col gap-2 min-w-0">
        {runs.map((run) => (
          <li key={run.runId} className={cn(PATROL_INSET_HOVER, 'relative')} data-testid="patrol-run-card" data-run-id={run.runId} data-status={run.status}>
            <div className="flex items-center gap-2 min-w-0">
              <RunStatusChip status={run.status} />
              <Link
                to={`/patrol/runs/${encodeURIComponent(run.runId)}`}
                className={cn(PATROL_MONO, 'text-theme-primary ml-auto whitespace-nowrap after:absolute after:inset-0')}
              >
                {formatWhen(run.startedAt)}
              </Link>
            </div>
            <div className="mt-1.5 text-xs text-theme-secondary flex flex-wrap gap-x-1.5 min-w-0">
              {!hideRoute && <span className="truncate max-w-full">{run.routeName}</span>}
              {!hideRoute && <span aria-hidden="true">·</span>}
              <span className="truncate max-w-full">{robotNames[run.robotId] ?? run.robotId}</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                {PATROL_RUN_MODE_LABELS[run.mode]} · {run.origin}
              </span>
            </div>
            {showReason(run) && <span className="block mt-1 text-[11px] text-theme-tertiary break-words">{run.reason}</span>}
            <div className="mt-2 flex items-center gap-3 min-w-0">
              <LegBar run={run} className="max-w-none flex-1" />
              <span className={cn(PATROL_MONO, 'whitespace-nowrap')}>{runProgressText(run)}</span>
              <FindingsPill count={run.findingCount} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});

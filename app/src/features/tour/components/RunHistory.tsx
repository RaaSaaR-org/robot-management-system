/**
 * @file RunHistory.tsx
 * @description Tour run history: a sticky-headed table on ≥ md (status, when,
 *              tour, robot, who started it, a per-stop mini bar, and the number
 *              of questions with the declined ones called out) and a stacked
 *              card list on phones. Rows link to RunDetail.
 * @feature tour
 */

import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import {
  PATROL_ATTENTION_TEXT,
  PATROL_INSET_HOVER,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
} from '@/features/patrol/components/patrolUi';
import type { TourLegStatus, TourRun } from '../types/tour.types';
import { TourRunStatusChip } from './TourBadge';
import { declinedTurns, formatWhen, runProgressText } from '../utils/tourFormat';

export interface RunHistoryProps {
  runs: TourRun[];
  robotNames: Record<string, string>;
  /** Hide the tour column when the table is scoped to one route. */
  hideRoute?: boolean;
  className?: string;
}

const SEGMENT: Record<TourLegStatus, string> = {
  pending: 'bg-surface-light-300 dark:bg-surface-500',
  running: 'bg-cobalt-500 animate-pulse',
  done: 'bg-turquoise-600 dark:bg-turquoise-500',
  failed: 'bg-red-500',
  skipped: 'bg-surface-light-400 dark:bg-surface-400',
};

/** One segment per stop, coloured by leg status — the tour at a glance. */
const LegBar = memo(function LegBar({ run, className }: { run: TourRun; className?: string }) {
  if (run.legs.length === 0) return null;
  return (
    <div className={cn('flex gap-0.5 h-1.5 w-full max-w-[7rem]', className)} aria-hidden="true">
      {run.legs.map((leg) => (
        <span key={leg.index} className={cn('flex-1 rounded-sm', PATROL_MOTION, SEGMENT[leg.status])} />
      ))}
    </div>
  );
});

/**
 * Questions asked, with the declined ones in amber. Declined is the number an
 * operator acts on — each one is a fact the tour does not carry yet.
 */
const QuestionsPill = memo(function QuestionsPill({ run }: { run: TourRun }) {
  const declined = declinedTurns(run).length;
  if (run.turns.length === 0) return <span className="font-mono tabular-nums text-xs text-theme-muted px-2">0</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="glass-subtle rounded-full px-2 py-px font-mono tabular-nums text-xs text-theme-secondary">{run.turns.length}</span>
      {declined > 0 && (
        <span className={cn('font-mono tabular-nums text-[11px]', PATROL_ATTENTION_TEXT)} title={`${declined} question(s) the facts did not cover`}>
          {declined} declined
        </span>
      )}
    </span>
  );
});

/**
 * Patrol hides the reason on a `done` run because there is nothing to explain
 * there. A tour is different: a visit the visitor ended after one stop, or one
 * that skipped a stop it could not reach, is ALSO `done` — the robot did what
 * it could and nothing failed — and the reason is the only place that says so.
 * Hiding it is how "1/4 stops shown" ends up with no explanation next to it.
 */
function showReason(run: TourRun): boolean {
  return Boolean(run.reason);
}

export const RunHistory = memo(function RunHistory({ runs, robotNames, hideRoute, className }: RunHistoryProps) {
  const navigate = useNavigate();
  if (runs.length === 0) {
    return (
      <div className={cn('glass-card rounded-brand-lg p-4', className)} data-testid="tour-run-history">
        <EmptyState size="sm" title="No tours yet" description="Tours show up here as the robot reports them — including the offers a visitor declined." />
      </div>
    );
  }
  const th = cn('px-3 py-2.5 text-left font-medium', PATROL_MICRO);
  return (
    <div className={cn('min-w-0', className)} data-testid="tour-run-history">
      {/* ≥ md: table (carries the row testids) */}
      <div className="hidden md:block glass-card rounded-brand-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 z-10 bg-glass-elevated backdrop-blur">
              <tr className="border-b border-glass-subtle">
                <th className={th}>Status</th>
                <th className={th}>Started</th>
                {!hideRoute && <th className={th}>Tour</th>}
                <th className={th}>Robot</th>
                <th className={th}>Started by</th>
                <th className={th}>Progress</th>
                <th className={cn(th, 'text-right')}>Questions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.runId}
                  className={cn('border-b border-glass-subtle last:border-b-0 hover:bg-theme-hover cursor-pointer', PATROL_MOTION)}
                  data-testid="tour-run-row"
                  data-run-id={run.runId}
                  data-status={run.status}
                  // The row highlights under the pointer, so it has to do what
                  // that promises. The timestamp stays a real <Link>: it is what
                  // keyboard and screen-reader users tab to.
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a,button')) return;
                    navigate(`/tour/runs/${encodeURIComponent(run.runId)}`);
                  }}
                >
                  <td className="px-3 py-2 min-w-0">
                    <TourRunStatusChip status={run.status} />
                    {showReason(run) && (
                      <span className="block text-[11px] text-theme-tertiary max-w-[16rem] truncate" title={run.reason ?? undefined}>
                        {run.reason}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/tour/runs/${encodeURIComponent(run.runId)}`}
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
                    {run.origin} · {run.language}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1 min-w-[7rem]">
                      <LegBar run={run} />
                      <span className={PATROL_MONO}>{runProgressText(run, { questions: false })}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <QuestionsPill run={run} />
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
          <li key={run.runId} className={cn(PATROL_INSET_HOVER, 'relative')} data-testid="tour-run-card" data-run-id={run.runId} data-status={run.status}>
            <div className="flex items-center gap-2 min-w-0">
              <TourRunStatusChip status={run.status} />
              <Link
                to={`/tour/runs/${encodeURIComponent(run.runId)}`}
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
                {run.origin} · {run.language}
              </span>
            </div>
            {showReason(run) && <span className="block mt-1 text-[11px] text-theme-tertiary break-words">{run.reason}</span>}
            <div className="mt-2 flex items-center gap-3 min-w-0">
              <LegBar run={run} className="max-w-none flex-1" />
              <span className={cn(PATROL_MONO, 'min-w-0 truncate')}>{runProgressText(run, { questions: false })}</span>
              <QuestionsPill run={run} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});

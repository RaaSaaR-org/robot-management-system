/**
 * @file RunHistory.tsx
 * @description Run history table: when, route, robot, mode, origin, status
 *              chip, progress and finding count. Rows link to RunDetail.
 * @feature patrol
 */

import { memo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import type { PatrolRun } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { RunStatusChip } from './FindingBadge';
import { formatWhen, runProgressText } from '../utils/patrolFormat';

export interface RunHistoryProps {
  runs: PatrolRun[];
  robotNames: Record<string, string>;
  /** Hide the route column when the table is scoped to one route. */
  hideRoute?: boolean;
  className?: string;
}

export const RunHistory = memo(function RunHistory({ runs, robotNames, hideRoute, className }: RunHistoryProps) {
  if (runs.length === 0) {
    return (
      <div className={cn('glass-card p-4', className)} data-testid="patrol-run-history">
        <EmptyState size="sm" title="No runs yet" description="Baseline and patrol runs show up here as the robot reports them." />
      </div>
    );
  }
  return (
    <div className={cn('glass-card overflow-hidden', className)} data-testid="patrol-run-history">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left card-meta text-[11px] uppercase tracking-wide border-b border-glass-subtle">
              <th className="px-3 py-2 font-medium">Started</th>
              {!hideRoute && <th className="px-3 py-2 font-medium">Route</th>}
              <th className="px-3 py-2 font-medium">Robot</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 font-medium text-right">Findings</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.runId}
                className="border-b border-glass-subtle last:border-b-0 hover:bg-theme-hover"
                data-testid="patrol-run-row"
                data-run-id={run.runId}
                data-status={run.status}
              >
                <td className="px-3 py-2 tabular-nums text-xs">
                  <Link to={`/patrol/runs/${encodeURIComponent(run.runId)}`} className="text-theme-primary hover:text-cobalt-500">
                    {formatWhen(run.startedAt)}
                  </Link>
                </td>
                {!hideRoute && (
                  <td className="px-3 py-2 text-theme-secondary truncate max-w-[14rem]" title={run.routeName}>
                    {run.routeName}
                  </td>
                )}
                <td className="px-3 py-2 text-theme-secondary truncate max-w-[10rem]">
                  {robotNames[run.robotId] ?? run.robotId}
                </td>
                <td className="px-3 py-2 text-theme-secondary text-xs">
                  {PATROL_RUN_MODE_LABELS[run.mode]} · {run.origin}
                </td>
                <td className="px-3 py-2">
                  <RunStatusChip status={run.status} />
                  {run.reason && (run.status === 'skipped' || run.status === 'aborted' || run.status === 'failed') && (
                    <span className="block text-[11px] text-theme-tertiary max-w-[16rem] truncate" title={run.reason}>
                      {run.reason}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-theme-secondary tabular-nums">{runProgressText(run)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', run.findingCount > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-theme-muted')}>
                  {run.findingCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

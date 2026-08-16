/**
 * @file RouteList.tsx
 * @description The routes table on the patrol page: name, robot, checkpoints,
 *              schedule, enabled, next run, last run — with Baseline run /
 *              Patrol now / Abort per row. Scrolls inside itself on a phone.
 * @feature patrol
 */

import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import type { PatrolRoute, PatrolRun } from '../types/patrol.types';
import { patrolApi } from '../api/patrolApi';
import { RunStatusChip } from './FindingBadge';
import { formatWhen, isRunActive } from '../utils/patrolFormat';

export interface RouteListProps {
  routes: PatrolRoute[];
  /** Last run per route id (newest), for the "last run" column. */
  lastRunByRoute: Record<string, PatrolRun | undefined>;
  /** Robot id → display name. */
  robotNames: Record<string, string>;
  /** Route currently being started (disables its buttons). */
  startingRouteId: string | null;
  onStart: (route: PatrolRoute, mode: 'baseline' | 'patrol') => void;
  onAbort: (route: PatrolRoute) => void;
  className?: string;
}

/** Ask the server for the next fire time of each scheduled route (one call per distinct cron). */
function useNextRuns(routes: PatrolRoute[]): Record<string, string | null> {
  const [next, setNext] = useState<Record<string, string | null>>({});
  const key = routes
    .filter((r) => r.enabled && r.cronExpression)
    .map((r) => `${r.id}=${r.cronExpression}`)
    .join(';');
  useEffect(() => {
    let cancelled = false;
    const scheduled = routes.filter((r) => r.enabled && r.cronExpression);
    if (scheduled.length === 0) {
      setNext({});
      return;
    }
    void (async () => {
      const out: Record<string, string | null> = {};
      await Promise.all(
        scheduled.map(async (r) => {
          try {
            const v = await patrolApi.validateCron(r.cronExpression as string);
            out[r.id] = v.valid ? (v.nextRuns[0] ?? null) : null;
          } catch {
            out[r.id] = null;
          }
        })
      );
      if (!cancelled) setNext(out);
    })();
    return () => {
      cancelled = true;
    };
    // `key` folds every (id, cron) pair; `routes` identity churn must not refetch.
  }, [key]);
  return next;
}

export const RouteList = memo(function RouteList({
  routes,
  lastRunByRoute,
  robotNames,
  startingRouteId,
  onStart,
  onAbort,
  className,
}: RouteListProps) {
  const nextRuns = useNextRuns(routes);

  if (routes.length === 0) {
    return (
      <div className={cn('glass-card p-4', className)} data-testid="patrol-route-list">
        <EmptyState
          size="sm"
          title="No patrol routes yet"
          description="A route is an ordered list of places the robot walks, with a schedule and a baseline of what is normal."
          action={
            <Link to="/patrol/routes/new">
              <Button size="sm" data-testid="patrol-new-route-empty">
                New route
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={cn('glass-card overflow-hidden', className)} data-testid="patrol-route-list">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left card-meta text-[11px] uppercase tracking-wide border-b border-glass-subtle">
              <th className="px-3 py-2 font-medium">Route</th>
              <th className="px-3 py-2 font-medium">Robot</th>
              <th className="px-3 py-2 font-medium">Checkpoints</th>
              <th className="px-3 py-2 font-medium">Schedule</th>
              <th className="px-3 py-2 font-medium">Next run</th>
              <th className="px-3 py-2 font-medium">Last run</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const last = lastRunByRoute[route.id];
              const active = isRunActive(last);
              const busy = startingRouteId === route.id;
              const robotLabel = route.robotId ? (robotNames[route.robotId] ?? route.robotId) : 'any';
              return (
                <tr
                  key={route.id}
                  className="border-b border-glass-subtle last:border-b-0 hover:bg-theme-hover"
                  data-testid="patrol-route-row"
                  data-route-id={route.id}
                >
                  <td className="px-3 py-2 min-w-0">
                    <Link
                      to={`/patrol/routes/${encodeURIComponent(route.id)}`}
                      className="font-medium text-theme-primary hover:text-cobalt-500 truncate block max-w-[16rem]"
                      title={route.name}
                    >
                      {route.name}
                    </Link>
                    <span
                      className={cn(
                        'text-[11px]',
                        route.enabled ? 'text-turquoise-600 dark:text-turquoise-400' : 'text-theme-muted'
                      )}
                    >
                      {route.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-theme-secondary truncate max-w-[10rem]" title={robotLabel}>
                    {robotLabel}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-theme-secondary">{route.checkpoints.length}</td>
                  <td className="px-3 py-2 font-mono text-xs text-theme-secondary">
                    {route.cronExpression ?? <span className="text-theme-muted">manual</span>}
                  </td>
                  <td className="px-3 py-2 text-theme-secondary tabular-nums text-xs">
                    {route.enabled && route.cronExpression
                      ? nextRuns[route.id] === undefined
                        ? '…'
                        : nextRuns[route.id]
                          ? formatWhen(nextRuns[route.id])
                          : 'invalid schedule'
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {last ? (
                      <Link
                        to={`/patrol/runs/${encodeURIComponent(last.runId)}`}
                        className="inline-flex items-center gap-2 hover:underline"
                      >
                        <RunStatusChip status={last.status} />
                        <span className="text-xs text-theme-tertiary tabular-nums">{formatWhen(last.startedAt)}</span>
                      </Link>
                    ) : (
                      <span className="text-theme-muted text-xs">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {active ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          data-testid="patrol-abort"
                          onClick={() => onAbort(route)}
                        >
                          Abort
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="patrol-run-baseline"
                            disabled={busy || route.checkpoints.length === 0}
                            isLoading={busy}
                            title="Walk the route supervised and record what is normal"
                            onClick={() => onStart(route, 'baseline')}
                          >
                            Baseline run
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            data-testid="patrol-run-now"
                            disabled={busy || route.checkpoints.length === 0}
                            isLoading={busy}
                            title="Walk the route now and compare against the baseline"
                            onClick={() => onStart(route, 'patrol')}
                          >
                            Patrol now
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

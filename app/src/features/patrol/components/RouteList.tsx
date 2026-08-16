/**
 * @file RouteList.tsx
 * @description The route cards on the patrol page: name, enabled state, robot,
 *              the route as a numbered node→node stepper coloured by the last
 *              run, schedule / next / last facts — with Baseline run /
 *              Patrol now / Abort per card. Single column on a phone.
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
import {
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
  PATROL_PANEL,
  RoutePath,
  SEVERITY_RAIL,
  type RoutePathLeg,
} from './patrolUi';

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
      <div className={cn('glass-card rounded-brand-lg p-4', className)} data-testid="patrol-route-list">
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
    <div className={cn('grid gap-3 lg:grid-cols-2 min-w-0', className)} data-testid="patrol-route-list">
      {routes.map((route) => {
        const last = lastRunByRoute[route.id];
        const active = isRunActive(last);
        const busy = startingRouteId === route.id;
        const robotLabel = route.robotId ? (robotNames[route.robotId] ?? route.robotId) : 'any';
        // Rail: cobalt while running, amber when the last run raised findings, else quiet.
        const rail = active
          ? 'border-l-[3px] border-l-cobalt-500'
          : last && last.findingCount > 0
            ? SEVERITY_RAIL.medium
            : 'border-l-[3px] border-l-transparent';
        const legs: RoutePathLeg[] = route.checkpoints.map((c, i) => ({
          index: i,
          label: c.name || c.placeId,
          status: last?.legs[i]?.status ?? 'route',
          findingCount: last?.legs[i]?.findingIds.length ?? 0,
        }));
        const next =
          route.enabled && route.cronExpression
            ? nextRuns[route.id] === undefined
              ? '…'
              : nextRuns[route.id]
                ? formatWhen(nextRuns[route.id])
                : 'invalid schedule'
            : '—';
        return (
          <article
            key={route.id}
            className={cn(PATROL_PANEL, 'flex flex-col gap-3', PATROL_MOTION, rail)}
            data-testid="patrol-route-row"
            data-route-id={route.id}
          >
            {/* Row 1: name · enabled · robot */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <Link
                to={`/patrol/routes/${encodeURIComponent(route.id)}`}
                className={cn('font-display text-base font-semibold text-theme-primary hover:text-cobalt-500 truncate min-w-0', PATROL_MOTION)}
                title={route.name}
              >
                {route.name}
              </Link>
              <span
                className={cn(
                  'text-[11px] shrink-0',
                  route.enabled ? 'text-turquoise-700 dark:text-turquoise-400' : 'text-theme-muted'
                )}
              >
                {route.enabled ? 'enabled' : 'disabled'}
              </span>
              <span className={cn(PATROL_MONO, 'basis-full sm:basis-auto sm:ml-auto truncate max-w-full sm:max-w-[12rem]')} title={robotLabel}>
                {robotLabel}
              </span>
            </div>

            {/* Row 2: the route as a stepper */}
            {legs.length > 0 ? (
              <RoutePath size="md" legs={legs} />
            ) : (
              <span className="text-xs text-theme-muted">No checkpoints yet</span>
            )}

            {/* Row 3: mono facts */}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 min-w-0">
              <div className="min-w-0">
                <dt className={PATROL_MICRO}>Schedule</dt>
                <dd className={cn(PATROL_MONO, 'truncate')} title={route.cronExpression ?? 'manual'}>
                  {route.cronExpression ?? <span className="text-theme-muted">manual</span>}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className={PATROL_MICRO}>Next</dt>
                <dd className={cn(PATROL_MONO, 'truncate')}>{next}</dd>
              </div>
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <dt className={PATROL_MICRO}>Last</dt>
                <dd className="min-w-0">
                  {last ? (
                    <Link
                      to={`/patrol/runs/${encodeURIComponent(last.runId)}`}
                      className="inline-flex items-center gap-1.5 max-w-full hover:underline"
                    >
                      <RunStatusChip status={last.status} />
                      <span className={cn(PATROL_MONO, 'text-theme-tertiary truncate')}>{formatWhen(last.startedAt)}</span>
                    </Link>
                  ) : (
                    <span className={cn(PATROL_MONO, 'text-theme-muted')}>never</span>
                  )}
                </dd>
              </div>
            </dl>

            {/* Row 4: actions */}
            <div className="flex items-center justify-end gap-1.5 flex-wrap">
              {active ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="min-h-9"
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
                    className="min-h-9"
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
                    className="min-h-9 hover:shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]"
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
          </article>
        );
      })}
    </div>
  );
});

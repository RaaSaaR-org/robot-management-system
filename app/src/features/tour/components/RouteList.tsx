/**
 * @file RouteList.tsx
 * @description The tour cards on the /tour page: name, enabled state, robot,
 *              the stops as a numbered node→node stepper coloured by the last
 *              run, and the facts an operator decides on — how long it takes,
 *              which language it is held in, and whether the robot may offer it
 *              to a visitor on its own. Start tour / End tour per card.
 * @feature tour
 */

import { memo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import {
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
  PATROL_PANEL,
  RoutePath,
  type RoutePathLeg,
} from '@/features/patrol/components/patrolUi';
import type { TourRoute, TourRun } from '../types/tour.types';
import { TourRunStatusChip } from './TourBadge';
import { estimateTourSeconds, formatEstimate, formatWhen, isRunActive } from '../utils/tourFormat';

export interface RouteListProps {
  routes: TourRoute[];
  /** Last run per route id (newest), for the "last run" column. */
  lastRunByRoute: Record<string, TourRun | undefined>;
  /** Robot id → display name. */
  robotNames: Record<string, string>;
  /** Route currently being started (disables its buttons). */
  startingRouteId: string | null;
  onStart: (route: TourRoute) => void;
  onAbort: (route: TourRoute) => void;
  className?: string;
}

const LANGUAGE_LABEL: Record<TourRoute['language'], string> = {
  de: 'German',
  en: 'English',
};

export const RouteList = memo(function RouteList({
  routes,
  lastRunByRoute,
  robotNames,
  startingRouteId,
  onStart,
  onAbort,
  className,
}: RouteListProps) {
  if (routes.length === 0) {
    return (
      <div className={cn('glass-card rounded-brand-lg p-4', className)} data-testid="tour-route-list">
        <EmptyState
          size="sm"
          title="No tours yet"
          description="A tour is an ordered list of places the robot walks a visitor to, with the sentence it says at each one and the facts it may answer from."
          action={
            <Link to="/tour/routes/new">
              <Button size="sm" data-testid="tour-new-route-empty">
                New tour
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={cn('grid gap-3 lg:grid-cols-2 min-w-0', className)} data-testid="tour-route-list">
      {routes.map((route) => {
        const last = lastRunByRoute[route.id];
        const active = isRunActive(last);
        const busy = startingRouteId === route.id;
        const robotLabel = route.robotId ? (robotNames[route.robotId] ?? route.robotId) : 'any';
        // Rail: cobalt while a visitor is being walked around, otherwise quiet.
        // Host mode has no "attention" state on a card — a declined offer is a
        // normal outcome, not something to flag.
        const rail = active ? 'border-l-[3px] border-l-cobalt-500' : 'border-l-[3px] border-l-transparent';
        // Matched by stopId, NOT by position. A route the operator has since
        // reordered or had a stop removed from would otherwise paint the last
        // run's outcomes onto whichever stops now sit at those indices — the
        // card would show "done" against a stop that visit never saw.
        const legs: RoutePathLeg[] = route.stops.map((stop, i) => ({
          index: i,
          label: stop.headline || stop.placeId,
          status: last?.legs.find((l) => l.stopId === stop.id)?.status ?? 'route',
        }));
        return (
          <article
            key={route.id}
            className={cn(PATROL_PANEL, 'flex flex-col gap-3', PATROL_MOTION, rail)}
            data-testid="tour-route-row"
            data-route-id={route.id}
          >
            {/* Row 1: name · enabled · robot */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <Link
                to={`/tour/routes/${encodeURIComponent(route.id)}`}
                className={cn('font-display text-base font-semibold text-theme-primary hover:text-cobalt-500 truncate min-w-0', PATROL_MOTION)}
                title={route.name}
              >
                {route.name}
              </Link>
              <span className={cn('text-[11px] shrink-0', route.enabled ? 'text-turquoise-700 dark:text-turquoise-400' : 'text-theme-muted')}>
                {route.enabled ? 'enabled' : 'disabled'}
              </span>
              <span className={cn(PATROL_MONO, 'basis-full sm:basis-auto sm:ml-auto truncate max-w-full sm:max-w-[12rem]')} title={robotLabel}>
                {robotLabel}
              </span>
            </div>

            {/* Row 2: the stops as a stepper */}
            {legs.length > 0 ? <RoutePath size="md" legs={legs} /> : <span className="text-xs text-theme-muted">No stops yet</span>}

            {/* Row 3: mono facts */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0">
              <div className="min-w-0">
                <dt className={PATROL_MICRO}>Stops</dt>
                <dd className={cn(PATROL_MONO, 'truncate')} data-testid="tour-route-stops">
                  {route.stops.length}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className={PATROL_MICRO}>Takes</dt>
                <dd className={cn(PATROL_MONO, 'truncate')} data-testid="tour-route-duration">
                  {formatEstimate(estimateTourSeconds(route))}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className={PATROL_MICRO}>Language</dt>
                <dd className={cn(PATROL_MONO, 'truncate')}>{LANGUAGE_LABEL[route.language] ?? route.language}</dd>
              </div>
              <div className="min-w-0">
                <dt className={PATROL_MICRO}>Greets on sight</dt>
                {/* The one setting that decides whether the robot talks to a
                    stranger unasked, so it is a fact on the card, not a detail
                    buried in the editor. */}
                <dd
                  className={cn(PATROL_MONO, 'truncate', route.autoGreet && route.enabled && 'text-cobalt-700 dark:text-cobalt-300')}
                  data-testid="tour-route-autogreet"
                >
                  {route.autoGreet ? 'on' : 'off'}
                </dd>
              </div>
              <div className="min-w-0 col-span-2 sm:col-span-4">
                <dt className={PATROL_MICRO}>Last</dt>
                <dd className="min-w-0">
                  {last ? (
                    <Link to={`/tour/runs/${encodeURIComponent(last.runId)}`} className="inline-flex items-center gap-1.5 max-w-full hover:underline">
                      <TourRunStatusChip status={last.status} />
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
                <Button size="sm" variant="destructive" className="min-h-9" data-testid="tour-abort" onClick={() => onAbort(route)}>
                  End tour
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  className="min-h-9 hover:shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]"
                  data-testid="tour-start"
                  disabled={busy || route.stops.length === 0}
                  isLoading={busy}
                  title="Walk this tour now, as if a visitor had accepted the offer"
                  onClick={() => onStart(route)}
                >
                  Start tour
                </Button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
});

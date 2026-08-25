/**
 * @file TourStopChip.tsx
 * @description The rail's host-mode chip (TASK-213): while the robot is walking
 *              a visitor around, which stop it is standing at.
 * @feature agentmode
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils';
import { currentStopText } from '@/features/tour/utils/tourFormat';
import { useAgentModeStore, selectPlan } from '../store/agentmodeStore';
import { blockKindGlyph } from '../utils/blockFormat';
import { tourContextOfPlan } from '../utils/planQuery';

export interface TourStopChipProps {
  className?: string;
}

/**
 * Where the robot is in a tour, on the one strip the operator is already
 * watching (TASK-213).
 *
 * The rail's other chips answer "who is this robot" and "where does it think it
 * is". During a visit there is a third question, and it is the one an operator
 * is actually asked over the shoulder: *which stop is it at?* The block chips
 * beside this one say what the robot is doing — `Say “…”`, `Walk` — but a
 * spoken sentence does not tell you which station of the tour it belongs to.
 * The /tour page answers it, on a page nobody watching Agent Mode is looking at.
 *
 * Renders NOTHING when no tour is running, which is the overwhelmingly common
 * case: this rail's own contract is that `leading` must survive a 390px
 * viewport without pushing STOPP off screen, and a permanently mounted chip
 * would spend that width on "no tour" every day of the week. It is deliberately
 * the opposite rule from `PlaceChip`, which always renders because "where am I"
 * is never not applicable — "which stop" genuinely is not, outside a visit.
 *
 * The stop headline is the visible text and the route name is the qualifier,
 * not the other way round: a console bound to one robot shows at most one tour,
 * so *which* tour matters far less than where in it the robot has got to. The
 * route name still rides along for screen readers and on hover, because a chip
 * that says only "at stop 2: Reception" leaves an operator who just walked up
 * to the screen without the name of the thing being walked.
 */
export const TourStopChip = memo(function TourStopChip({ className }: TourStopChipProps) {
  const plan = useAgentModeStore(selectPlan);
  // Derived from `plan`, not subscribed — `tourContextOfPlan` allocates and
  // zustand v5 compares snapshots by identity (same reason as BlockTimeline's).
  const tour = useMemo(() => tourContextOfPlan(plan), [plan]);

  if (!tour) return null;

  const stopText = currentStopText(tour.stop);
  const route = tour.routeName ?? 'a tour';
  const length = tour.stops !== null ? `${tour.stops} ${tour.stops === 1 ? 'stop' : 'stops'}` : null;
  // "Between stops" is the honest reading of a plan that names no stop: the
  // robot has not reached the first one, or it is walking back to the door.
  const prose = [`Tour “${route}” is running`, length, stopText ?? 'between stops']
    .filter(Boolean)
    .join(' · ');
  // What hover says MINUS what is already on the chip — a screen reader reads
  // both, and hearing the same clause twice is how a chip this small becomes
  // noise. `title` alone would not do: the trigger is a plain span with no tab
  // stop, so hover is the only way anyone reaches it and no way at all for
  // someone not using a pointer.
  const unsaid = stopText
    ? [`Tour “${route}”`, length].filter(Boolean).join(' · ')
    : ['Tour is running', length, 'between stops'].filter(Boolean).join(' · ');

  return (
    <div
      data-testid="agent-tour-stop"
      data-tour-stop={tour.stop ? (tour.stop.index ?? 'unknown') : 'none'}
      // `min-w-0` and a truncating label, never `shrink-0 whitespace-nowrap`: a
      // long headline has to give way inside the `leading` group rather than
      // push the rail's stop button towards the right edge.
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-brand glass-subtle min-w-0',
        className
      )}
      title={prose}
    >
      <span aria-hidden="true">{blockKindGlyph('tour')}</span>
      <span className="card-value truncate min-w-0 text-cobalt-600 dark:text-cobalt-400">
        {stopText ?? route}
      </span>
      <span className="sr-only">{unsaid}</span>
    </div>
  );
});

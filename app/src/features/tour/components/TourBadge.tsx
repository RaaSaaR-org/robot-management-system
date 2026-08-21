/**
 * @file TourBadge.tsx
 * @description Small pills for host mode: run status, stop (leg) status, how a
 *              visitor's question was answered, and the mode a stop's demo ran
 *              in. One renderer per value so the cards, the run detail and the
 *              banner can never disagree.
 * @feature tour
 */

import { memo } from 'react';
import { cn } from '@/shared/utils/cn';
// The visual vocabulary is patrol's (TASK-212) and stays shared on purpose:
// tours and patrols sit next to each other in Operations, and an operator must
// not have to learn two chip languages for the same five leg states.
import { PATROL_MOTION } from '@/features/patrol/components/patrolUi';
import type { TourDemoMode, TourLegStatus, TourRunStatus, TourTurnAnswer } from '../types/tour.types';
import { legStatusStyle, runStatusStyle, turnAnswerStyle } from '../utils/tourFormat';

const PILL = cn(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
  PATROL_MOTION
);

export interface TourRunStatusChipProps {
  status: TourRunStatus;
  className?: string;
}

/** Run status pill; the running one pulses. */
export const TourRunStatusChip = memo(function TourRunStatusChip({ status, className }: TourRunStatusChipProps) {
  const style = runStatusStyle(status);
  return (
    <span className={cn(PILL, style.className, className)} data-status={status} data-testid="tour-run-status">
      {style.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />}
      {style.label}
    </span>
  );
});

export interface TourLegStatusChipProps {
  status: TourLegStatus;
  className?: string;
}

/** Stop status pill. */
export const TourLegStatusChip = memo(function TourLegStatusChip({ status, className }: TourLegStatusChipProps) {
  const style = legStatusStyle(status);
  return (
    <span className={cn(PILL, style.className, className)} data-status={status}>
      {style.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />}
      {style.label}
    </span>
  );
});

export interface TurnAnswerBadgeProps {
  answered: TourTurnAnswer;
  className?: string;
}

/**
 * How the robot answered — the one label on this page that has to be exact.
 * "Declined" says the facts did not cover the question and the robot said so;
 * it is never dressed up as an answer.
 */
export const TurnAnswerBadge = memo(function TurnAnswerBadge({ answered, className }: TurnAnswerBadgeProps) {
  const style = turnAnswerStyle(answered);
  return (
    <span className={cn(PILL, style.className, className)} data-answered={answered} data-testid="tour-turn-answer">
      {style.label}
    </span>
  );
});

export interface DemoModeBadgeProps {
  mode: TourDemoMode;
  className?: string;
}

/**
 * `narrate` is a full outcome and says so in words: the robot described the
 * skill, it did not run it. Anything vaguer here would let a timeline imply a
 * grasp that never happened.
 */
export const DemoModeBadge = memo(function DemoModeBadge({ mode, className }: DemoModeBadgeProps) {
  return (
    <span
      className={cn(
        PILL,
        mode === 'execute'
          ? 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300'
          : 'glass-subtle text-theme-secondary',
        className
      )}
      data-mode={mode}
      data-testid="tour-demo-mode"
    >
      {mode === 'execute' ? 'Ran the skill' : 'Described only'}
    </span>
  );
});

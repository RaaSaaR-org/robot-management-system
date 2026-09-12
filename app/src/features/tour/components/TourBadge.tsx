/**
 * @file TourBadge.tsx
 * @description Status tags for host mode: run status, stop (leg) status, how a
 *              visitor's question was answered, and the mode a stop's demo ran
 *              in. One renderer per value so the cards, the run detail and the
 *              banner can never disagree. All of them render the kit's StatusTag.
 * @feature tour
 */

import { memo } from 'react';
import { StatusTag, type StatusTagTone } from '@/shared/components/ui';
import type { TourDemoMode, TourLegStatus, TourRunStatus, TourTurnAnswer } from '../types/tour.types';
import { TOUR_RUN_STATUS_LABELS, TOUR_TURN_ANSWER_LABELS } from '../types/tour.types';

/** `declined` is neutral: the visitor said no to the offer — a normal end. */
const RUN_TONE: Record<TourRunStatus, StatusTagTone> = {
  running: 'live',
  done: 'success',
  declined: 'neutral',
  abandoned: 'neutral',
  aborted: 'warning',
  failed: 'danger',
  skipped: 'neutral',
};

const LEG_TONE: Record<TourLegStatus, StatusTagTone> = {
  pending: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

const LEG_LABEL: Record<TourLegStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

/**
 * `declined` is a warning — the operator's cue to add a fact; the robot did the
 * right thing with facts it does not have. `unanswered` is neutral "Not
 * answered": the robot never got an answer out.
 */
const ANSWER_TONE: Record<TourTurnAnswer, StatusTagTone> = {
  grounded: 'success',
  from_camera: 'info',
  declined: 'warning',
  unanswered: 'neutral',
};

export interface TourRunStatusChipProps {
  status: TourRunStatus;
  className?: string;
}

/** Run status tag; the running one pulses. */
export const TourRunStatusChip = memo(function TourRunStatusChip({ status, className }: TourRunStatusChipProps) {
  return (
    <StatusTag
      tone={RUN_TONE[status] ?? 'neutral'}
      dot
      pulse={status === 'running'}
      className={className}
      data-status={status}
      data-testid="tour-run-status"
    >
      {TOUR_RUN_STATUS_LABELS[status] ?? status}
    </StatusTag>
  );
});

export interface TourLegStatusChipProps {
  status: TourLegStatus;
  className?: string;
}

/** Stop status tag. */
export const TourLegStatusChip = memo(function TourLegStatusChip({ status, className }: TourLegStatusChipProps) {
  return (
    <StatusTag
      tone={LEG_TONE[status] ?? 'neutral'}
      size="sm"
      dot={status === 'running'}
      pulse={status === 'running'}
      className={className}
      data-status={status}
    >
      {LEG_LABEL[status] ?? status}
    </StatusTag>
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
  return (
    <StatusTag
      tone={ANSWER_TONE[answered] ?? 'neutral'}
      className={className}
      data-answered={answered}
      data-testid="tour-turn-answer"
    >
      {TOUR_TURN_ANSWER_LABELS[answered] ?? answered}
    </StatusTag>
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
    <StatusTag
      tone={mode === 'execute' ? 'info' : 'neutral'}
      size="sm"
      className={className}
      data-mode={mode}
      data-testid="tour-demo-mode"
    >
      {mode === 'execute' ? 'Ran the skill' : 'Described only'}
    </StatusTag>
  );
});

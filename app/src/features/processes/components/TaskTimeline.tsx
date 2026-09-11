/**
 * @file TaskTimeline.tsx
 * @description Vertical timeline of an automation's steps, on tokens (a dot per
 *              step in its status tone, a StatusTag, times in tertiary ink)
 * @feature processes
 */

import { StatusTag, statusTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { PROCESS_STEP_STATUS_LABELS, type ProcessStep as TaskStep } from '../types';

export interface TaskTimelineProps {
  steps: TaskStep[];
  currentStepIndex?: number;
  /** Hide descriptions and times */
  compact?: boolean;
  className?: string;
}

const DOT_TONE: Record<string, string> = {
  success: 'bg-signal-measured border-signal-measured',
  info: 'bg-signal-estimated border-signal-estimated',
  warning: 'bg-signal-unknown border-signal-unknown',
  danger: 'bg-signal-stopped border-signal-stopped',
  neutral: 'bg-transparent border-line-strong',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(UI_DATE_LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function TaskTimeline({ steps, currentStepIndex, compact = false, className }: TaskTimelineProps) {
  if (steps.length === 0) {
    return <p className={cn('text-sm text-ink-tertiary', className)}>This automation has no steps.</p>;
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isCurrent = index === currentStepIndex && step.status === 'in_progress';
        const tone = statusTone(step.status);
        return (
          <li key={step.id} className={cn('relative flex gap-3', !isLast && 'pb-5')}>
            {!isLast && <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px bg-line" />}
            <span
              aria-hidden="true"
              className={cn(
                'relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2',
                DOT_TONE[tone] ?? DOT_TONE.neutral,
                isCurrent && 'animate-pulse',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={cn(
                    'text-sm font-medium text-ink-primary',
                    step.status === 'skipped' && 'text-ink-tertiary line-through',
                  )}
                >
                  <span className="mr-1.5 text-ink-muted">{index + 1}.</span>
                  {step.name}
                </span>
                <StatusTag status={step.status} size="sm">
                  {PROCESS_STEP_STATUS_LABELS[step.status]}
                </StatusTag>
              </div>
              {!compact && step.description && (
                <p className="mt-0.5 text-[13px] text-ink-secondary">{step.description}</p>
              )}
              {!compact && (step.startedAt || step.completedAt) && (
                <p className="mt-1 text-xs text-ink-tertiary">
                  {step.startedAt && <>Started {formatTime(step.startedAt)}</>}
                  {step.startedAt && step.completedAt && ' · '}
                  {step.completedAt && <>Finished {formatTime(step.completedAt)}</>}
                </p>
              )}
              {step.error && <p className="mt-1 text-[13px] text-signal-stopped">{step.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact horizontal progress strip for a task's steps. */
export function TaskStepProgress({ steps, className }: { steps: TaskStep[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {steps.map((step) => (
        <div
          key={step.id}
          className={cn('h-1.5 flex-1 rounded-full', (DOT_TONE[statusTone(step.status)] ?? DOT_TONE.neutral).split(' ')[0], statusTone(step.status) === 'neutral' && 'bg-line')}
          title={`${step.name}: ${PROCESS_STEP_STATUS_LABELS[step.status]}`}
        />
      ))}
    </div>
  );
}

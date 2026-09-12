/**
 * @file SessionStepIndicator.tsx
 * @description Step indicator for the recording lifecycle of a teleoperation
 *              session: Connect input → Record episodes → Review → Export.
 *              The active step is derived from the session status.
 * @feature datacollection
 */

import { Check } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { TeleoperationSession } from '../types/datacollection.types';

const STEPS = ['Connect input', 'Record episodes', 'Review', 'Export'] as const;

/**
 * Map a session to the active step (1-based).
 * Completed sessions jump straight to Review (3) or Export (4).
 */
export function getActiveStep(session: TeleoperationSession): number {
  if (session.status === 'completed' || session.status === 'failed') {
    return session.exportedDatasetId ? 4 : 3;
  }
  if (session.status === 'recording' || session.status === 'paused') {
    return 2;
  }
  return 1; // created
}

export interface SessionStepIndicatorProps {
  session: TeleoperationSession;
}

export function SessionStepIndicator({ session }: SessionStepIndicatorProps) {
  const activeStep = getActiveStep(session);

  return (
    <nav aria-label="Session progress" data-testid="session-steps">
      <ol className="flex flex-wrap items-center gap-y-2">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const isDone = step < activeStep;
          const isActive = step === activeStep;
          return (
            <li key={label} className="flex items-center" data-testid={`session-step-${step}`}>
              <div className="flex items-center gap-2" aria-current={isActive ? 'step' : undefined}>
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                    isDone && 'border-primary/40 bg-primary/10 text-primary',
                    isActive && 'border-primary bg-primary text-on-primary',
                    !isDone && !isActive && 'border-line text-ink-tertiary',
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : step}
                </span>
                <span
                  className={cn(
                    'text-[13px] font-medium',
                    isActive ? 'text-ink-primary' : isDone ? 'text-ink-secondary' : 'text-ink-tertiary',
                    !isActive && 'hidden sm:inline',
                  )}
                >
                  {label}
                </span>
              </div>
              {step < STEPS.length && (
                <span className={cn('mx-3 h-px w-6 sm:w-10', isDone ? 'bg-primary/40' : 'bg-line')} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

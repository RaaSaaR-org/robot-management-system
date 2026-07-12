/**
 * @file SessionStepIndicator.tsx
 * @description Step indicator for the recording lifecycle of a teleoperation
 *              session: Connect input → Record episodes → Review → Export.
 *              The active step is derived from the session status.
 * @feature datacollection
 */

import { Check } from 'lucide-react';
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
      <ol className="flex items-center gap-0">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const isDone = step < activeStep;
          const isActive = step === activeStep;
          return (
            <li key={label} className="flex items-center" data-testid={`session-step-${step}`}>
              <div
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-brand transition-colors ${
                  isActive ? 'bg-cobalt-500/15' : ''
                }`}
                aria-current={isActive ? 'step' : undefined}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold shrink-0 ${
                    isDone
                      ? 'bg-green-500/20 text-green-400'
                      : isActive
                        ? 'bg-cobalt-500 text-white'
                        : 'bg-glass-subtle text-theme-muted'
                  }`}
                >
                  {isDone ? <Check size={12} /> : step}
                </span>
                <span
                  className={`text-xs font-medium hidden sm:inline ${
                    isActive
                      ? 'text-cobalt-400'
                      : isDone
                        ? 'text-theme-secondary'
                        : 'text-theme-muted'
                  }`}
                >
                  {label}
                </span>
              </div>
              {step < STEPS.length && (
                <span
                  className={`w-6 h-px mx-1 ${isDone ? 'bg-green-500/40' : 'bg-glass-subtle'}`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

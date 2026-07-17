/**
 * @file OrchestrationTimeline.tsx
 * @description Real-time orchestration progress display showing agent selection steps
 * @feature a2a
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';

type OrchestrationStep = 'analyzing' | 'agent_selected' | 'forwarding' | 'waiting';

interface OrchestrationTimelineProps {
  steps: Array<{
    step: OrchestrationStep;
    agentName?: string;
    agentCount?: number;
    timestamp?: string;
  }>;
  className?: string;
}

const STEP_CONFIG: Record<OrchestrationStep, { label: string; icon: string; color: string }> = {
  analyzing: {
    label: 'Analyzing request',
    icon: '◉',
    color: '#2A5FFF',
  },
  agent_selected: {
    label: 'Agent selected',
    icon: '◉',
    color: '#22c55e',
  },
  forwarding: {
    label: 'Forwarding to agent',
    icon: '◉',
    color: '#2A5FFF',
  },
  waiting: {
    label: 'Waiting for response',
    icon: '◉',
    color: '#2A5FFF',
  },
};

export const OrchestrationTimeline = memo(function OrchestrationTimeline({
  steps,
  className,
}: OrchestrationTimelineProps) {
  if (steps.length === 0) return null;

  const lastStep = steps[steps.length - 1];
  const isComplete = steps.some((s) => s.step === 'forwarding');

  return (
    <div className={cn('flex justify-start', className)}>
      <div
        className="rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%]"
        style={{
          background: 'rgba(42, 95, 255, 0.06)',
          border: '1px solid rgba(42, 95, 255, 0.15)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-3.5 h-3.5 text-cobalt-500 dark:text-cobalt-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <span className="text-[10px] font-semibold tracking-wider uppercase text-cobalt-500 dark:text-cobalt-300">
            Orchestrator
          </span>
        </div>

        {/* Steps */}
        <div className="space-y-1.5">
          {steps.map((s, i) => {
            const config = STEP_CONFIG[s.step];
            const isLast = i === steps.length - 1;

            return (
              <div key={`${s.step}-${i}`} className="flex items-start gap-2">
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center pt-0.5">
                  <span
                    className={cn('w-2 h-2 rounded-full flex-shrink-0', isLast && !isComplete && 'animate-pulse')}
                    style={{ background: config.color }}
                  />
                  {i < steps.length - 1 && (
                    <div className="w-px h-3 mt-0.5" style={{ background: 'rgba(42, 95, 255, 0.2)' }} />
                  )}
                </div>

                {/* Step content */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-theme-tertiary">
                    {config.label}
                  </span>
                  {s.step === 'analyzing' && s.agentCount && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-theme-tertiary">
                      {s.agentCount} agent{s.agentCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {s.step === 'agent_selected' && s.agentName && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' }}
                    >
                      {s.agentName}
                    </span>
                  )}
                  {s.step === 'forwarding' && s.agentName && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cobalt-50 dark:bg-cobalt-900/20 text-cobalt-500 dark:text-cobalt-300">
                      → {s.agentName}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Waiting indicator if still in progress */}
          {!isComplete && lastStep.step !== 'forwarding' && (
            <div className="flex items-center gap-2 pt-0.5">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {/* Waiting for agent response */}
          {isComplete && (
            <div className="flex items-start gap-2">
              <div className="flex flex-col items-center pt-0.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: '#2A5FFF' }} />
              </div>
              <span className="text-xs text-theme-tertiary">
                Waiting for response...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

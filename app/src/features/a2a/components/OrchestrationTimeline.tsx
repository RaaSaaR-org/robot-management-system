/**
 * @file OrchestrationTimeline.tsx
 * @description Live orchestration progress: analyzing, agent selected, forwarding, waiting
 * @feature a2a
 */

import { Sparkles } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

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

const STEP_LABEL: Record<OrchestrationStep, string> = {
  analyzing: 'Analyzing request',
  agent_selected: 'Agent selected',
  forwarding: 'Forwarding to agent',
  waiting: 'Waiting for response',
};

/**
 * Inset card listing the orchestration steps so far; the current step pulses.
 */
export function OrchestrationTimeline({ steps, className }: OrchestrationTimelineProps) {
  if (steps.length === 0) return null;
  const isForwarded = steps.some((s) => s.step === 'forwarding');
  const all = isForwarded ? [...steps, { step: 'waiting' as const }] : steps;

  return (
    <div className={cn('flex justify-start', className)}>
      <div className="max-w-[85%] rounded-control border border-line-subtle bg-inset px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-tertiary">
          <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
          Orchestrator
        </div>
        <ol className="flex flex-col gap-1.5">
          {all.map((s, i) => {
            const isCurrent = i === all.length - 1;
            const agentName = 'agentName' in s ? s.agentName : undefined;
            return (
              <li key={`${s.step}-${i}`} className="flex items-center gap-2 text-xs text-ink-secondary">
                <span
                  className={cn(
                    'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                    isCurrent ? 'animate-pulse bg-primary' : 'bg-signal-measured',
                  )}
                />
                <span>{STEP_LABEL[s.step]}</span>
                {s.step === 'analyzing' && 'agentCount' in s && s.agentCount ? (
                  <span className="text-ink-muted">
                    {s.agentCount} agent{s.agentCount !== 1 ? 's' : ''}
                  </span>
                ) : null}
                {s.step !== 'analyzing' && agentName ? (
                  <span className="font-medium text-ink-primary">{agentName}</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

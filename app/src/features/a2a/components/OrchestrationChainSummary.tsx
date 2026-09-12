/**
 * @file OrchestrationChainSummary.tsx
 * @description Collapsible summary of how the orchestrator routed a message
 * @feature a2a
 */

import { useState } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface OrchestrationChain {
  selectionMethod: 'llm' | 'keyword';
  consideredAgents: Array<{ name: string; selected: boolean }>;
  timings: { selectionMs: number; forwardingMs: number; totalMs: number };
}

interface OrchestrationChainSummaryProps {
  agentName: string;
  chain: OrchestrationChain;
  className?: string;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * One line ("Routed to X · LLM · 1.2 s") that expands into the steps and considered agents.
 */
export function OrchestrationChainSummary({ agentName, chain, className }: OrchestrationChainSummaryProps) {
  const [open, setOpen] = useState(false);
  const method = chain.selectionMethod === 'llm' ? 'LLM' : 'Keyword';

  return (
    <div className={cn('mb-1', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-xs text-ink-tertiary transition-colors hover:bg-ink-primary/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" strokeWidth={1.75} />
        <span className="truncate">
          Routed to <span className="font-medium text-ink-secondary">{agentName}</span> · {method} ·{' '}
          {formatMs(chain.timings.totalMs)}
        </span>
        <ChevronDown
          className={cn('ml-auto h-3.5 w-3.5 flex-shrink-0 transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="mt-1 flex flex-col gap-2 rounded-control border border-line-subtle bg-inset px-3 py-2.5 text-xs text-ink-secondary">
          <div>
            Evaluated {chain.consideredAgents.length} agent{chain.consideredAgents.length !== 1 ? 's' : ''} in{' '}
            {formatMs(chain.timings.selectionMs)}
          </div>
          {chain.consideredAgents.length > 0 && (
            <ul className="flex flex-col gap-0.5 border-l border-line pl-2">
              {chain.consideredAgents.map((a) => (
                <li
                  key={a.name}
                  className={cn('flex items-center gap-1.5', a.selected ? 'text-signal-measured' : 'text-ink-muted')}
                >
                  {a.selected ? <Check className="h-3 w-3" strokeWidth={2} /> : <span className="w-3 text-center">·</span>}
                  {a.name}
                  {a.selected && <span>(selected)</span>}
                </li>
              ))}
            </ul>
          )}
          <div>
            Forwarded to {agentName}, answered in {formatMs(chain.timings.forwardingMs)}
          </div>
          <div className="flex justify-between border-t border-line-subtle pt-1.5 text-ink-muted">
            <span>Selection: {chain.selectionMethod === 'llm' ? 'LLM (OpenRouter)' : 'keyword matching'}</span>
            <span>Total {formatMs(chain.timings.totalMs)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

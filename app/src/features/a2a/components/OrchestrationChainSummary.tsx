/**
 * @file OrchestrationChainSummary.tsx
 * @description Collapsible orchestration chain detail view shown on completed orchestrated messages
 * @feature a2a
 */

import { memo, useState } from 'react';
import { cn } from '@/shared/utils';

interface ConsideredAgent {
  name: string;
  selected: boolean;
}

interface OrchestrationChain {
  selectionMethod: 'llm' | 'keyword';
  consideredAgents: ConsideredAgent[];
  timings: {
    selectionMs: number;
    forwardingMs: number;
    totalMs: number;
  };
}

interface OrchestrationChainSummaryProps {
  agentName: string;
  chain: OrchestrationChain;
  className?: string;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const OrchestrationChainSummary = memo(function OrchestrationChainSummary({
  agentName,
  chain,
  className,
}: OrchestrationChainSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={cn('mb-1', className)}>
      {/* Collapsed bar — always visible */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 rounded-brand text-left',
          'transition-all duration-150',
          'hover:bg-cobalt-500/10',
          isExpanded
            ? 'bg-cobalt-500/10 border border-cobalt-500/30'
            : 'bg-transparent'
        )}
      >
        <svg className="w-3 h-3 text-cobalt-500 dark:text-cobalt-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span className="text-[10px] text-cobalt-500 dark:text-cobalt-300 font-semibold tracking-wider uppercase">
          Orchestrated
        </span>
        <span className="text-[10px] text-theme-tertiary">
          via {agentName}
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded ml-auto flex-shrink-0"
          style={{
            background: chain.selectionMethod === 'llm' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
            color: chain.selectionMethod === 'llm' ? '#22c55e' : '#eab308',
          }}
        >
          {chain.selectionMethod.toUpperCase()}
        </span>
        <span className="text-[10px] text-theme-muted font-mono flex-shrink-0">
          {formatMs(chain.timings.totalMs)}
        </span>
        <svg
          className={cn('w-3 h-3 text-theme-muted transition-transform flex-shrink-0', isExpanded && 'rotate-180')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div
          className="mt-1 px-3 py-2.5 rounded-lg text-xs space-y-2"
          style={{
            background: 'rgba(42, 95, 255, 0.04)',
            border: '1px solid rgba(42, 95, 255, 0.1)',
          }}
        >
          {/* Steps */}
          <div className="space-y-1.5">
            {/* Analyzed */}
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cobalt-500" />
              <span className="text-theme-tertiary">Analyzed request</span>
            </div>

            {/* Evaluated agents */}
            <div className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] mt-1" />
              <div className="flex-1">
                <span className="text-theme-tertiary">
                  Evaluated {chain.consideredAgents.length} agent{chain.consideredAgents.length !== 1 ? 's' : ''}
                </span>
                <span className="text-theme-muted font-mono ml-2">{formatMs(chain.timings.selectionMs)}</span>

                {/* Agent list */}
                {chain.consideredAgents.length > 0 && (
                  <div className="mt-1 pl-2 border-l border-cobalt-500/30 space-y-0.5">
                    {chain.consideredAgents.map((a) => (
                      <div key={a.name} className="flex items-center gap-1.5">
                        {a.selected ? (
                          <svg className="w-3 h-3 text-[#22c55e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <span className="w-3 h-3 flex items-center justify-center text-theme-muted">·</span>
                        )}
                        <span className={cn(
                          'text-[10px]',
                          a.selected ? 'text-[#22c55e] font-semibold' : 'text-theme-muted'
                        )}>
                          {a.name}
                        </span>
                        {a.selected && (
                          <span className="text-[9px] text-[#22c55e]">selected</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Forwarded */}
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cobalt-500" />
              <span className="text-theme-tertiary">Forwarded to {agentName}</span>
            </div>

            {/* Response received */}
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
              <span className="text-theme-tertiary">Response received</span>
              <span className="text-theme-muted font-mono">{formatMs(chain.timings.forwardingMs)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1.5 border-t border-cobalt-500/20">
            <span className="text-[10px] text-theme-muted">
              Selection: {chain.selectionMethod === 'llm' ? 'LLM (OpenRouter)' : 'Keyword matching'}
            </span>
            <span className="text-[10px] text-theme-muted font-mono">
              Total: {formatMs(chain.timings.totalMs)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

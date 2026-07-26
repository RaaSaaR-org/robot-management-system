/**
 * @file BlockCard.tsx
 * @description Card for a single agent block: kind, params, status, duration, reasoning
 * @feature agentmode
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import {
  blockDurationMs,
  blockKindGlyph,
  blockKindLabel,
  blockStatusStyle,
  formatBlockParams,
  formatDuration,
} from '../utils/blockFormat';
import type { AgentBlock } from '../types/agentmode.types';

export interface BlockCardProps {
  block: AgentBlock;
  /** Position within the plan, rendered as `1.`, `2.`, … */
  index?: number;
  className?: string;
}

/**
 * One block of a plan. Durations are only shown once the block actually
 * finished — a running block has no honest duration to report.
 */
export const BlockCard = memo(function BlockCard({ block, index, className }: BlockCardProps) {
  const status = blockStatusStyle(block.status);
  const params = formatBlockParams(block);
  const duration = block.finishedAt ? blockDurationMs(block) : null;

  return (
    <div
      data-testid="agent-block-card"
      data-block-kind={block.kind}
      data-block-status={block.status}
      className={cn(
        'glass-card p-3 flex items-start gap-3',
        block.status === 'running' && 'border-cobalt-500/60',
        (block.status === 'skipped' || block.status === 'pending') && 'opacity-70',
        className
      )}
    >
      <div
        className={cn(
          'glass-subtle w-8 h-8 flex items-center justify-center shrink-0 text-sm leading-none',
          block.status === 'running' ? 'text-cobalt-400' : 'text-theme-tertiary'
        )}
        aria-hidden="true"
      >
        {blockKindGlyph(block.kind)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {typeof index === 'number' && (
            <span className="card-meta tabular-nums">{index + 1}.</span>
          )}
          <span className="card-value">{blockKindLabel(block.kind)}</span>
          {params && <span className="card-meta">{params}</span>}

          <span className="ml-auto flex items-center gap-2">
            {duration !== null && (
              <span className="card-meta tabular-nums">{formatDuration(duration)}</span>
            )}
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap',
                status.className
              )}
            >
              {status.pulse && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1 align-middle" />
              )}
              {status.label}
            </span>
          </span>
        </div>

        {block.reasoning && <p className="card-meta mt-1 leading-snug">{block.reasoning}</p>}

        {block.result && (
          <p className="text-xs text-turquoise-700 dark:text-turquoise-400 mt-1 leading-snug">
            {block.result}
          </p>
        )}

        {block.error && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 leading-snug">{block.error}</p>
        )}
      </div>
    </div>
  );
});

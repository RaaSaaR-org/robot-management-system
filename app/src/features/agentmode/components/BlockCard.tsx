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
  demoMode,
  formatBlockParams,
  formatDuration,
  presentProgress,
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
  // Host mode (TASK-213): a `present` block is one part of an authored talk
  // track, and where the robot is in that track is what tells an operator it is
  // mid-explanation rather than stuck. A `demo` block's mode is louder still —
  // `narrate` means the robot DESCRIBED the skill, and the card has to say so in
  // words, because a "Done" pill next to "Demo" otherwise reads as a grasp that
  // happened.
  const chunk = presentProgress(block);
  const demo = demoMode(block);

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
          {chunk && (
            <span
              className="glass-subtle rounded-full px-2 py-0.5 text-[10px] font-mono tabular-nums text-theme-secondary whitespace-nowrap"
              data-testid="agent-block-chunk"
            >
              part {chunk.chunk} of {chunk.of}
            </span>
          )}
          {/* `demo` is the block's MODE, which is known before it runs — so the
              label has to follow the block's status, not the mode alone. A
              pending `execute` demo badged "Ran the skill" is the same class of
              claim the narrate/execute split exists to prevent. */}
          {demo && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
                demo === 'execute' ? 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300' : 'glass-subtle text-theme-secondary'
              )}
              data-testid="agent-block-demo-mode"
            >
              {demo === 'execute'
                ? block.status === 'done'
                  ? 'Ran the skill'
                  : block.status === 'failed'
                    ? 'Tried to run the skill'
                    : 'Running the skill'
                : 'Described only — not executed'}
            </span>
          )}
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

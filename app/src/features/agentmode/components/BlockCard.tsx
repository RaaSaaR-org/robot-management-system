/**
 * @file BlockCard.tsx
 * @description One block of a plan as an inset panel: kind, params, status,
 *              duration, reasoning, result or error.
 * @feature agentmode
 */

import { memo } from 'react';
import { StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
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
 * The label a `demo` block carries. Its MODE is known before it runs, so the
 * words follow the block's status: a pending `execute` demo labelled "Ran the
 * skill" is the claim the narrate/execute split exists to prevent.
 */
function demoLabel(mode: 'execute' | 'narrate', status: AgentBlock['status']): string {
  if (mode === 'narrate') return 'Described only — not executed';
  if (status === 'done') return 'Ran the skill';
  if (status === 'failed') return 'Tried to run the skill';
  return 'Running the skill';
}

/**
 * One block of a plan. Durations are only shown once the block actually
 * finished — a running block has no honest duration to report.
 */
export const BlockCard = memo(function BlockCard({ block, index, className }: BlockCardProps) {
  const status = blockStatusStyle(block.status);
  const params = formatBlockParams(block);
  const duration = block.finishedAt ? blockDurationMs(block) : null;
  // Host mode (TASK-213): where the robot is in an authored talk track tells an
  // operator it is mid-explanation rather than stuck.
  const chunk = presentProgress(block);
  const demo = demoMode(block);
  const running = block.status === 'running';

  return (
    <div
      data-testid="agent-block-card"
      data-block-kind={block.kind}
      data-block-status={block.status}
      className={cn(
        'flex items-start gap-3 rounded-control border bg-inset p-3',
        running ? 'border-primary/40' : 'border-line-subtle',
        (block.status === 'skipped' || block.status === 'pending') && 'opacity-70',
        className
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line-subtle bg-panel text-sm leading-none',
          running ? 'text-primary' : 'text-ink-tertiary'
        )}
      >
        {blockKindGlyph(block.kind)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {typeof index === 'number' && (
            <span className="text-xs tabular-nums text-ink-muted">{index + 1}.</span>
          )}
          <span className="text-sm font-medium text-ink-primary">{blockKindLabel(block.kind)}</span>
          {chunk && (
            <span
              data-testid="agent-block-chunk"
              className="whitespace-nowrap text-xs tabular-nums text-ink-secondary"
            >
              part {chunk.chunk} of {chunk.of}
            </span>
          )}
          {demo && (
            <span
              data-testid="agent-block-demo-mode"
              className={cn(
                'whitespace-nowrap text-xs font-medium',
                demo === 'execute' ? 'text-signal-estimated' : 'text-ink-secondary'
              )}
            >
              {demoLabel(demo, block.status)}
            </span>
          )}
          {params && <span className="min-w-0 text-xs text-ink-tertiary">{params}</span>}

          <span className="ml-auto flex items-center gap-2">
            {duration !== null && (
              <span className="text-xs tabular-nums text-ink-muted">{formatDuration(duration)}</span>
            )}
            <StatusTag tone={status.tone} dot={status.pulse} pulse={status.pulse}>
              {status.label}
            </StatusTag>
          </span>
        </div>

        {block.reasoning && (
          <p className="mt-1 text-xs leading-snug text-ink-tertiary">{block.reasoning}</p>
        )}
        {block.result && (
          <p className="mt-1 text-xs leading-snug text-signal-measured">{block.result}</p>
        )}
        {block.error && (
          <p className="mt-1 text-xs leading-snug text-signal-stopped">{block.error}</p>
        )}
      </div>
    </div>
  );
});

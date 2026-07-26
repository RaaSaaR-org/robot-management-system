/**
 * @file BlockTimeline.tsx
 * @description Narrow bar with the running block, the queued blocks and STOPP
 * @feature agentmode
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils';
import { useAgentModeStore, selectPlan, selectEstopActive } from '../store/agentmodeStore';
import {
  blockKindGlyph,
  blockKindLabel,
  formatBlockParams,
  planStatusStyle,
} from '../utils/blockFormat';
import { currentBlockOfPlan, upcomingBlocksOfPlan } from '../utils/planQuery';
import type { AgentBlock } from '../types/agentmode.types';

export interface BlockTimelineProps {
  /** Latch the E-Stop. Wired to the store's `estop` by the page. */
  onStop: () => void;
  /** Disable STOPP when no robot is bound. */
  disabled?: boolean;
  className?: string;
}

/** Max queued blocks rendered before the bar collapses into a `+n` chip. */
const MAX_UPCOMING = 3;

function BlockChip({
  block,
  variant,
}: {
  block: AgentBlock;
  variant: 'current' | 'upcoming';
}) {
  const params = formatBlockParams(block);
  return (
    <span
      data-testid={variant === 'current' ? 'agent-current-block' : 'agent-upcoming-block'}
      data-block-kind={block.kind}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap',
        variant === 'current'
          ? 'bg-cobalt-500/15 text-cobalt-400 border border-cobalt-500/40'
          : 'glass-subtle text-theme-tertiary'
      )}
    >
      <span aria-hidden="true">{blockKindGlyph(block.kind)}</span>
      <span className="font-medium">{blockKindLabel(block.kind)}</span>
      {params && <span className="opacity-70 hidden sm:inline">{params}</span>}
      {variant === 'current' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
    </span>
  );
}

/**
 * The always-visible execution bar: what the robot is doing right now, what
 * comes next, and the one control that always works — STOPP.
 */
export const BlockTimeline = memo(function BlockTimeline({
  onStop,
  disabled,
  className,
}: BlockTimelineProps) {
  const plan = useAgentModeStore(selectPlan);
  const estopActive = useAgentModeStore(selectEstopActive);

  // Derived from `plan`, not subscribed: `upcomingBlocksOfPlan` allocates and
  // zustand v5 compares snapshots by identity.
  const currentBlock = useMemo(() => currentBlockOfPlan(plan), [plan]);
  const upcoming = useMemo(() => upcomingBlocksOfPlan(plan), [plan]);

  const status = plan ? planStatusStyle(plan.status) : null;
  const shown = upcoming.slice(0, MAX_UPCOMING);
  const overflow = upcoming.length - shown.length;

  return (
    <div
      data-testid="agent-block-timeline"
      data-plan-status={plan?.status ?? 'none'}
      className={cn(
        'glass-card px-3 py-2 flex items-center gap-3 overflow-x-auto scrollbar-hide',
        className
      )}
    >
      {status && (
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap shrink-0',
            status.className
          )}
        >
          {status.label}
        </span>
      )}

      <div className="flex items-center gap-2 min-w-0 flex-1">
        {currentBlock ? (
          <BlockChip block={currentBlock} variant="current" />
        ) : (
          <span className="card-meta whitespace-nowrap">
            {plan ? 'No block running' : 'No active plan'}
          </span>
        )}

        {shown.length > 0 && <span className="card-meta shrink-0">→</span>}

        {shown.map((block) => (
          <BlockChip key={block.id} block={block} variant="upcoming" />
        ))}

        {overflow > 0 && (
          <span className="card-meta whitespace-nowrap shrink-0">+{overflow} more</span>
        )}
      </div>

      <button
        type="button"
        data-testid="agent-stop-button"
        onClick={onStop}
        disabled={disabled}
        aria-label="Emergency stop"
        className={cn(
          // Safety control: >=44px touch target on coarse pointers (Apple HIG /
          // WCAG 2.5.5); fine-pointer desktops keep the compact bar.
          'shrink-0 px-4 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-5',
          'rounded-brand font-bold text-xs tracking-wider',
          'bg-red-600 text-white transition-all duration-150',
          'hover:bg-red-700 active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500/50',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-600',
          estopActive && 'bg-red-800 animate-pulse'
        )}
      >
        STOPP
      </button>
    </div>
  );
});

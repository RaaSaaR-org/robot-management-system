/**
 * @file BlockTimeline.tsx
 * @description The Agent Mode status rail: who the robot is and where it thinks
 *              it is (passed in as `leading`), what it is executing right now,
 *              what comes next — and STOPP.
 * @feature agentmode
 */

import { memo, useMemo, type ReactNode } from 'react';
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
  /**
   * Chips rendered at the head of the rail, before the block group — the page
   * passes the robot identity and the place belief.
   *
   * They ride in HERE rather than in rows of their own because the rail is the
   * one strip the operator is guaranteed to be looking at: who the robot is,
   * where it thinks it is, and what it is doing belong on the same line as the
   * button that stops it. Everything in here must survive a 390px viewport
   * without pushing STOPP off screen — see the wrap rules below.
   */
  leading?: ReactNode;
  className?: string;
}

/** Max queued blocks rendered before the bar collapses into a `+n` chip. */
const MAX_UPCOMING = 3;

/**
 * The rail sticks BELOW the app's top bar, not at the viewport edge.
 *
 * `AppLayout` is `min-h-screen` with no overflow container and `<main>` only
 * sets padding, so THE DOCUMENT is the scroller and `position: sticky` genuinely
 * works here. But `TopBar` is `fixed top-0 h-14 z-40` — a rail pinned at `top-0`
 * would slide underneath it and vanish exactly while the operator is scrolling
 * through a long conversation. `top-14` parks it against the bar's bottom edge,
 * and `z-20` deliberately stays below the bar (z-40) and below modals.
 */
const RAIL_STICKY = 'sticky top-14 z-20';

/**
 * `.glass-card` sets `overflow: hidden` (src/index.css), and on THIS card that
 * is a safety bug, not a rounding detail.
 *
 * The rail is a flex row that ends in STOPP. Anything wider than the card would
 * be silently cut off at the right edge — with no scrollbar, because `hidden`
 * is not `auto` — and the thing at the right edge is the emergency stop. It
 * would be invisible AND unclickable, with nothing on the page hinting that it
 * was ever there. `overflow-visible` removes the clipper outright; the collapse
 * rules below then make sure there is nothing to clip in the first place.
 *
 * It also buys back the tooltips: `Tooltip` is CSS-positioned and NOT portalled
 * (shared/components/ui/Tooltip.tsx), so inside a 44px clipping box every
 * `side="bottom"` panel in this rail — the place chip's honesty sentence, the
 * freshness clause's server-mirror caveat — was cut a few pixels after it
 * started.
 */
const RAIL_NOT_A_CLIPPER = 'overflow-visible';

/**
 * How much of the rail the `leading` group may claim.
 *
 * Flex line-breaking uses each item's hypothetical main size CLAMPED BY ITS
 * MAX-WIDTH, so capping this group is what keeps STOPP on the first flex line
 * however long the robot's name, its badges and its place name get: the cap
 * leaves at least this much room for the button beside it. 6.5rem = 104px is
 * the widest STOPP gets (`pointer-coarse:px-5`, ~90px) plus the rail's `gap-2`.
 *
 * Over the cap the group wraps INTERNALLY (it is a wrapping flex container of
 * its own) and the rail grows a second text row — `min-h-11`, never a fixed
 * height. Wrapping is the specified degradation; clipping and sideways
 * scrolling are the two that lose the badges the operator has to act on.
 */
const LEADING_MAX_WIDTH = 'max-w-[calc(100%-6.5rem)]';

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
 * The always-visible status rail: who the robot is, what it is doing right now,
 * what comes next, and the one control that always works — STOPP.
 *
 * The collapse order is encoded in classes rather than left to chance, and the
 * order is: the block group scrolls sideways first, then `leading` wraps to a
 * second text row, and STOPP never moves. Three separate mechanisms hold that
 * up, and all three are load-bearing:
 *
 * 1. the root is `overflow-visible`, so nothing on this rail can be cut off
 *    without a scrollbar to get it back (see RAIL_NOT_A_CLIPPER);
 * 2. `leading` is capped by max-width, so flex line-breaking always leaves room
 *    for STOPP on the first line (see LEADING_MAX_WIDTH);
 * 3. STOPP itself is `shrink-0` and ordered onto that first line at every width.
 *
 * The failure being guarded against is an operator reaching for the stop button
 * and finding it clipped, scrolled away or wrapped below the fold. For the same
 * reason the muted 'No active plan' text stays even when there is nothing to
 * show — a rail that renders empty is indistinguishable from a rail that broke.
 */
export const BlockTimeline = memo(function BlockTimeline({
  onStop,
  disabled,
  leading,
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
        'glass-card px-3 py-1.5',
        // One 44px line whenever the content fits; `min-h-11` and NOT `h-11`,
        // because a fixed height turns "too much content" into "content nobody
        // can see" the moment anything wraps.
        'flex items-center gap-2 sm:gap-3 min-h-11 flex-wrap',
        RAIL_NOT_A_CLIPPER,
        RAIL_STICKY,
        className
      )}
    >
      {leading && (
        // Capped and internally wrapping (see LEADING_MAX_WIDTH). It must NOT
        // be `shrink-0 whitespace-nowrap`: an unshrinkable, unwrappable group
        // is exactly what pushes STOPP past the right edge of the rail.
        <div
          className={cn(
            'order-1 flex items-center gap-2 min-w-0 flex-wrap',
            LEADING_MAX_WIDTH
          )}
        >
          {leading}
        </div>
      )}

      {/* The elastic middle: the only part allowed to scroll sideways. Below
          `sm` it takes a full row of its own (`basis-full`, ordered last) so it
          can never compete with STOPP for the first row; from `sm` its flex
          BASIS IS ZERO, which is what keeps it out of the line-breaking
          calculation — an `auto` basis would let a long block queue claim the
          whole line and push STOPP onto the next one.

          Written as `grow` + `basis-0` rather than `flex-1` on purpose: the
          `flex` shorthand and `basis-*` land in different utility groups, and
          which of the two wins then depends on the order Tailwind happens to
          emit them in. This spells out both halves in one group. */}
      <div
        className={cn(
          'flex items-center gap-2 min-w-0 overflow-x-auto scrollbar-hide',
          'order-3 basis-full sm:order-2 sm:basis-0 sm:grow'
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
        // A SUPERSET of the visible text, never a replacement for it (WCAG
        // 2.5.3, Label in Name): a voice-control user says the word they can
        // see — "click STOPP" — and an accessible name of "Emergency stop"
        // simply does not match. On this button of all buttons.
        aria-label="STOPP — emergency stop"
        className={cn(
          // Safety control: >=44px touch target on coarse pointers (Apple HIG /
          // WCAG 2.5.5); fine-pointer desktops keep the compact bar.
          'shrink-0 px-4 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-5',
          // Pinned to the FIRST row at every width. `ml-auto` right-aligns it
          // while the block group is on a row of its own; from `sm` the elastic
          // middle does that job and the margin is dropped again.
          'order-2 ml-auto sm:order-3 sm:ml-0',
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

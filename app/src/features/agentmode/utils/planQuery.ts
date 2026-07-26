/**
 * @file planQuery.ts
 * @description Pure plan queries shared by the store selectors and components.
 *              Kept plain (not store-bound) so components can memoize them on
 *              `plan` — a selector returning a fresh array on every call breaks
 *              zustand v5's snapshot caching.
 * @feature agentmode
 */

import type { AgentBlock, AgentPlan } from '../types/agentmode.types';

/** Shared empty result so callers never see a fresh array identity. */
export const NO_BLOCKS: readonly AgentBlock[] = Object.freeze([]);

/**
 * The block the robot is executing right now.
 *
 * A `goto` stays `running` while the navigator's generated look/turn/walk
 * blocks execute *inside* it, so more than one block can report `running` at
 * the same time. The cursor is the agent's own answer to "which block is
 * executing"; prefer it whenever it points at a running block, and only scan
 * for a running block (or fall back to the cursor) when it does not.
 */
export function currentBlockOfPlan(plan: AgentPlan | null | undefined): AgentBlock | null {
  if (!plan) return null;
  const atCursor = plan.cursor >= 0 ? plan.blocks[plan.cursor] ?? null : null;
  if (atCursor?.status === 'running') return atCursor;
  const running = plan.blocks.find((b) => b.status === 'running');
  if (running) return running;
  return atCursor;
}

/** Blocks still queued after the current one. */
export function upcomingBlocksOfPlan(plan: AgentPlan | null | undefined): AgentBlock[] {
  if (!plan) return NO_BLOCKS as AgentBlock[];
  const current = currentBlockOfPlan(plan);
  const start = current ? plan.blocks.indexOf(current) + 1 : 0;
  return plan.blocks.slice(start).filter((b) => b.status === 'pending');
}

/** How many blocks reached a terminal state, for progress readouts. */
export function planProgress(plan: AgentPlan | null | undefined): { done: number; total: number } {
  if (!plan) return { done: 0, total: 0 };
  const done = plan.blocks.filter(
    (b) => b.status === 'done' || b.status === 'failed' || b.status === 'skipped' || b.status === 'aborted'
  ).length;
  return { done, total: plan.blocks.length };
}

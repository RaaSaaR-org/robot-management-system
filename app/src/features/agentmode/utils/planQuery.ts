/**
 * @file planQuery.ts
 * @description Pure plan queries shared by the store selectors and components.
 *              Kept plain (not store-bound) so components can memoize them on
 *              `plan` — a selector returning a fresh array on every call breaks
 *              zustand v5's snapshot caching.
 * @feature agentmode
 */

import type { AgentBlock, AgentPlan, AgentPlanStatus } from '../types/agentmode.types';

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

// ============================================================================
// HOST MODE (TASK-213)
// ============================================================================

/** A plan that has ended says nothing about where the robot is standing now. */
const FINISHED_PLAN_STATUSES: ReadonlySet<AgentPlanStatus> = new Set<AgentPlanStatus>([
  'done',
  'failed',
  'aborted',
]);

/** What a plan in flight says about the tour it is walking (TASK-213). */
export interface PlanTourContext {
  /** The route's name, or its id when the runner had no name for it; null when neither. */
  routeName: string | null;
  /** How many stops the route has, when the `tour` block said; null otherwise. */
  stops: number | null;
  /**
   * The stop the robot is at right now, or null — it has not reached the first
   * one yet, or it is on its way back to the greeting place.
   */
  stop: { index: number | null; name: string } | null;
}

function textParam(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function countParam(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read the tour out of a running plan: which route, and which stop the robot is
 * at right now (TASK-213).
 *
 * The plan is the LIVE answer on this page, and deliberately not the tour run:
 * a run snapshot only reaches the console when a leg SETTLES
 * (`agent:tour:leg` is emitted after a stop is finished, `host.ts` `drive`), so
 * for most of a visit its legs read pending-then-done and no leg is `running`.
 * The blocks, by contrast, are reported one at a time as they start and finish
 * — and since every block of a stop carries `stopName`, the plan can name the
 * stop the robot is standing at the whole time it is standing there. It also
 * survives a page reload, because the plan is part of `AgentModeState`.
 *
 * The scan keeps the LAST stop a started block named, rather than only looking
 * at the block in flight: a `goto` stays `running` while the navigator's
 * generated look/turn/walk blocks execute inside it, and those carry no stop.
 * Reading only the current block would blink the stop away and back several
 * times per leg. A started `goto` with NO stop is the one thing that clears it
 * — that is the walk home, and the robot has left the last stop behind.
 */
export function tourContextOfPlan(plan: AgentPlan | null | undefined): PlanTourContext | null {
  if (!plan || FINISHED_PLAN_STATUSES.has(plan.status)) return null;
  const tourBlock = plan.blocks.find((b) => b.kind === 'tour');
  if (!tourBlock) return null;

  let stop: PlanTourContext['stop'] = null;
  for (const block of plan.blocks) {
    // Pending blocks are the route's future, not its present.
    if (block.status === 'pending') continue;
    const name = textParam(block.params.stopName);
    if (name) {
      stop = { index: countParam(block.params.stopIndex), name };
    } else if (block.kind === 'goto') {
      stop = null;
    }
  }

  return {
    routeName: textParam(tourBlock.params.routeName) ?? textParam(tourBlock.params.routeId),
    stops: countParam(tourBlock.params.stops),
    stop,
  };
}

/** How many blocks reached a terminal state, for progress readouts. */
export function planProgress(plan: AgentPlan | null | undefined): { done: number; total: number } {
  if (!plan) return { done: 0, total: 0 };
  const done = plan.blocks.filter(
    (b) => b.status === 'done' || b.status === 'failed' || b.status === 'skipped' || b.status === 'aborted'
  ).length;
  return { done, total: plan.blocks.length };
}

/**
 * @file experiments.ts
 * @description Formatting for the experiment loop (TASK-242): percentages that
 *   always carry their count, and what each arm varies.
 * @feature experiments
 */

import type { ArmResult, ExperimentArm } from '../types/experiment.types';

export function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}

/** "17/30 (56.7%)" — a rate is never shown without the count behind it. */
export function rateWithCount(r: Pick<ArmResult, 'successCount' | 'episodeCount' | 'successRate'>): string {
  return `${r.successCount}/${r.episodeCount} (${pct(r.successRate)})`;
}

/** "+3.3 pts" */
export function deltaPts(delta: number): string {
  const v = Math.round(delta * 1000) / 10;
  return `${v >= 0 ? '+' : ''}${v} pts`;
}

/**
 * The 95% interval half-width of a success rate from n rollouts (normal
 * approximation), so a chart can draw how wide 12 rollouts really are.
 */
export function halfWidth95(rate: number, n: number): number {
  if (n <= 0) return 0;
  return 1.96 * Math.sqrt((rate * (1 - rate)) / n);
}

/** What an arm varies against the baseline, in one line. */
export function armVaries(arm: ExperimentArm): string {
  if (arm.isBaseline) return 'baseline';
  return arm.varies.length > 0 ? arm.varies.join('; ') : arm.label ?? '—';
}

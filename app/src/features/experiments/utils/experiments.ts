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
 * The 95% Wilson score interval of a success rate from n rollouts, so a chart
 * can draw how wide 12 rollouts really are. Wilson rather than the normal
 * approximation because the normal one collapses to zero width at 0/n and n/n
 * — exactly where a small sample most needs to look uncertain.
 */
export function interval95(rate: number, n: number): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const z2n = (z * z) / n;
  const centre = (rate + z2n / 2) / (1 + z2n);
  const half = (z * Math.sqrt((rate * (1 - rate)) / n + z2n / (4 * n))) / (1 + z2n);
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** What an arm varies against the baseline, in one line. */
export function armVaries(arm: ExperimentArm): string {
  if (arm.isBaseline) return 'baseline';
  return arm.varies.length > 0 ? arm.varies.join('; ') : arm.label ?? '—';
}

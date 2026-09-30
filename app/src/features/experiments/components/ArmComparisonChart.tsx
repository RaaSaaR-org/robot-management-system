/**
 * @file ArmComparisonChart.tsx
 * @description Success rate per arm as horizontal bars, each labelled with the
 *   count behind it and drawn with its 95% interval — so a bar built from 12
 *   rollouts cannot be read as one built from 400 (TASK-242).
 * @feature experiments
 */

import { chartColors } from '@/shared/components/ui';
import type { ExperimentArm } from '../types/experiment.types';
import { interval95, pct, rateWithCount } from '../utils/experiments';

export interface ArmComparisonChartProps {
  arms: ExperimentArm[];
  winnerArmId?: string | null;
}

export function ArmComparisonChart({ arms, winnerArmId }: ArmComparisonChartProps) {
  const scored = arms.filter((a) => a.result);
  if (scored.length === 0) {
    return <p className="text-sm text-ink-secondary">No arm has been scored yet.</p>;
  }
  return (
    <figure className="flex flex-col gap-3" aria-label="Success rate per arm" data-testid="arm-comparison-chart">
      <ul className="flex flex-col gap-3">
        {scored.map((arm) => {
          const r = arm.result!;
          const { lo, hi } = interval95(r.successRate, r.episodeCount);
          const tip = `${arm.name}: ${rateWithCount(r)} — 95% interval ${pct(lo)}–${pct(hi)} from ${r.episodeCount} rollouts`;
          return (
            <li key={arm.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-center sm:gap-3" title={tip}>
              <div className="min-w-0 truncate text-[13px] text-ink-primary">
                {arm.name}
                {arm.isBaseline && <span className="ml-1 text-ink-tertiary">· baseline</span>}
                {arm.id === winnerArmId && <span className="ml-1 font-semibold text-ink-primary">· winner</span>}
              </div>
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-4 flex-1 rounded-sm" style={{ background: chartColors.grid }} aria-hidden>
                  <div
                    className="absolute inset-y-0 left-0 rounded-r"
                    style={{
                      width: `${r.successRate * 100}%`,
                      background: chartColors.primary,
                      opacity: arm.isBaseline ? 0.55 : 1,
                    }}
                  />
                  <div
                    className="absolute top-1/2 h-0.5 -translate-y-1/2"
                    style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, background: chartColors.tooltipText }}
                  />
                </div>
                <span className="shrink-0 text-right font-mono text-[12px] text-ink-secondary" data-testid="arm-episode-count">
                  {rateWithCount(r)} · n={r.episodeCount}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <figcaption className="text-[12px] text-ink-tertiary">
        Bar: sim success rate. Line: 95% interval — the wider it is, the fewer rollouts stand behind the bar.
      </figcaption>
    </figure>
  );
}

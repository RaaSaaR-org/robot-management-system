/**
 * @file SuccessRateChart.tsx
 * @description Daily success rate per model version, on the kit's chart theme
 * @feature evaluation
 */

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartSeriesColor, chartTheme } from '@/shared/components/ui';
import type { EvaluationEpisode } from '../types';

export interface SuccessRateChartProps {
  episodes: EvaluationEpisode[];
  height?: number;
}

/** Groups episodes by day and model version, then computes each day's success rate. */
function computeChartData(episodes: EvaluationEpisode[]) {
  const modelVersions = [...new Set(episodes.map((e) => e.modelVersion))].sort();
  const byDate = new Map<string, EvaluationEpisode[]>();
  for (const ep of episodes) {
    const date = new Date(ep.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    byDate.set(date, [...(byDate.get(date) ?? []), ep]);
  }
  const sorted = [...byDate.entries()].sort(
    (a, b) => new Date(a[1][0].createdAt).getTime() - new Date(b[1][0].createdAt).getTime()
  );
  const data = sorted.map(([date, eps]) => {
    const point: Record<string, string | number> = { date };
    for (const mv of modelVersions) {
      const mvEps = eps.filter((e) => e.modelVersion === mv);
      if (mvEps.length > 0) point[mv] = Math.round((mvEps.filter((e) => e.success).length / mvEps.length) * 100);
    }
    return point;
  });
  return { data, modelVersions };
}

export function SuccessRateChart({ episodes, height = 280 }: SuccessRateChartProps) {
  if (episodes.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-tertiary">No evaluation data in this period.</p>;
  }
  const { data, modelVersions } = computeChartData(episodes);

  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="date" {...chartTheme.xAxis} />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...chartTheme.yAxis} width={44} />
          <Tooltip {...chartTheme.tooltip} formatter={(value, name) => [`${value}%`, String(name)]} />
          <Legend {...chartTheme.legend} />
          {modelVersions.map((mv, i) => (
            <Line key={mv} type="monotone" dataKey={mv} name={mv} stroke={chartSeriesColor(i)} strokeWidth={1.75} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

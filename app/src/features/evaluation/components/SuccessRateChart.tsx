/**
 * @file SuccessRateChart.tsx
 * @description Line chart showing success rate over time per model version
 * @feature evaluation
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { EvaluationEpisode } from '../types';

export interface SuccessRateChartProps {
  episodes: EvaluationEpisode[];
  height?: number;
}

const MODEL_COLORS: Record<string, string> = {
  'smolvla-v0.3.1': '#ef4444',
  'smolvla-v0.4.0': '#f59e0b',
  'smolvla-v0.4.1': '#22c55e',
};

const DEFAULT_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6'];

/**
 * Groups episodes by date and model version, computes daily success rate
 */
function computeChartData(episodes: EvaluationEpisode[]) {
  // Get unique model versions
  const modelVersions = [...new Set(episodes.map((e) => e.modelVersion))].sort();

  // Group by date
  const byDate = new Map<string, EvaluationEpisode[]>();
  for (const ep of episodes) {
    const date = new Date(ep.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const existing = byDate.get(date) ?? [];
    existing.push(ep);
    byDate.set(date, existing);
  }

  // Build chart data sorted by date
  const sortedDates = [...byDate.entries()].sort(
    (a, b) => new Date(a[1][0].createdAt).getTime() - new Date(b[1][0].createdAt).getTime()
  );

  const data = sortedDates.map(([date, eps]) => {
    const point: Record<string, string | number> = { date };
    for (const mv of modelVersions) {
      const mvEps = eps.filter((e) => e.modelVersion === mv);
      if (mvEps.length > 0) {
        const rate = (mvEps.filter((e) => e.success).length / mvEps.length) * 100;
        point[mv] = Math.round(rate);
      }
    }
    return point;
  });

  return { data, modelVersions };
}

export function SuccessRateChart({ episodes, height = 300 }: SuccessRateChartProps) {
  if (episodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">No evaluation data available</p>
      </div>
    );
  }

  const { data, modelVersions } = computeChartData(episodes);

  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" stroke="#6b7280" />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            stroke="#6b7280"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
            formatter={(value, name) => [`${value}%`, String(name)]}
          />
          <Legend />
          {modelVersions.map((mv, i) => (
            <Line
              key={mv}
              type="monotone"
              dataKey={mv}
              name={mv}
              stroke={MODEL_COLORS[mv] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * @file ErrorAnalysisPanel.tsx
 * @description Why evaluation episodes failed, as a donut of error types
 * @feature evaluation
 */

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { chartSeriesColor, chartTheme } from '@/shared/components/ui';
import type { ErrorBreakdownItem } from '../types';

export interface ErrorAnalysisPanelProps {
  errors: ErrorBreakdownItem[];
  height?: number;
}

export const ERROR_LABELS: Record<string, string> = {
  grasp_failure: 'Grasp failure',
  collision_detected: 'Collision',
  timeout: 'Timeout',
  pose_estimation_error: 'Pose error',
  joint_limit_exceeded: 'Joint limit',
  unknown: 'Unknown',
};

export function ErrorAnalysisPanel({ errors, height = 280 }: ErrorAnalysisPanelProps) {
  if (errors.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-tertiary">No failed episodes in this period.</p>;
  }

  const data = errors.map((e) => ({
    name: ERROR_LABELS[e.errorType] ?? e.errorType,
    value: e.count,
    percentage: e.percentage,
  }));

  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
        <PieChart>
          <Pie data={data} cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value" stroke="none">
            {data.map((_entry, index) => (
              <Cell key={index} fill={chartSeriesColor(index)} />
            ))}
          </Pie>
          <Tooltip {...chartTheme.tooltip} formatter={(value, name) => [`${String(value)} episodes`, String(name)]} />
          <Legend
            {...chartTheme.legend}
            formatter={(value, entry) => {
              const pct = (entry as { payload?: { percentage?: number } }).payload?.percentage;
              return pct !== undefined ? `${value} (${pct.toFixed(0)}%)` : value;
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

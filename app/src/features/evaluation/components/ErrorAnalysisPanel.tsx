/**
 * @file ErrorAnalysisPanel.tsx
 * @description Pie chart showing error type distribution
 * @feature evaluation
 */

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import type { ErrorBreakdownItem } from '../types';

export interface ErrorAnalysisPanelProps {
  errors: ErrorBreakdownItem[];
  height?: number;
}

const COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

const ERROR_LABELS: Record<string, string> = {
  grasp_failure: 'Grasp Failure',
  collision_detected: 'Collision',
  timeout: 'Timeout',
  pose_estimation_error: 'Pose Error',
  joint_limit_exceeded: 'Joint Limit',
  unknown: 'Unknown',
};

export function ErrorAnalysisPanel({ errors, height = 300 }: ErrorAnalysisPanelProps) {
  if (errors.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">No errors in this period</p>
      </div>
    );
  }

  const data = errors.map((e) => ({
    name: ERROR_LABELS[e.errorType] ?? e.errorType,
    value: e.count,
    percentage: e.percentage,
  }));

  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            label={(props: PieLabelRenderProps) => {
              const name = String(props.name ?? '');
              const pct = typeof props.percent === 'number' ? (props.percent * 100).toFixed(0) : '0';
              return `${name} (${pct}%)`;
            }}
          >
            {data.map((_entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [String(value), '']}
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

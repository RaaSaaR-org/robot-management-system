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
    <div className="w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }: PieLabelRenderProps) => {
              const RADIAN = Math.PI / 180;
              const cxN = typeof cx === 'number' ? cx : 0;
              const cyN = typeof cy === 'number' ? cy : 0;
              const innerR = typeof innerRadius === 'number' ? innerRadius : 0;
              const outerR = typeof outerRadius === 'number' ? outerRadius : 0;
              const angle = typeof midAngle === 'number' ? midAngle : 0;
              const radius = innerR + (outerR - innerR) * 0.5;
              const x = cxN + radius * Math.cos(-angle * RADIAN);
              const y = cyN + radius * Math.sin(-angle * RADIAN);
              const pct = typeof percent === 'number' ? (percent * 100).toFixed(0) : '0';
              if (Number(pct) < 5) return null;
              return (
                <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="bold">
                  {`${pct}%`}
                </text>
              );
            }}
            labelLine={false}
          >
            {data.map((_entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`${String(value)} errors`, String(name)]}
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
          />
          <Legend
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

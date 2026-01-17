/**
 * @file MetricsComparisonChart.tsx
 * @description Bar chart for comparing metrics across model versions
 * @feature training
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface MetricData {
  name: string;
  runId: string;
  metrics: Record<string, number>;
}

export interface MetricsComparisonChartProps {
  data: MetricData[];
  metricKey: string;
  height?: number;
  lowerIsBetter?: boolean;
}

const colors = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6'];

/**
 * Bar chart comparing a single metric across multiple runs
 */
export function MetricsComparisonChart({
  data,
  metricKey,
  height = 300,
  lowerIsBetter = true,
}: MetricsComparisonChartProps) {
  const chartData = data.map((item, index) => ({
    name: item.name || `Run ${index + 1}`,
    value: item.metrics[metricKey] ?? 0,
    runId: item.runId,
  }));

  // Find best value
  const values = chartData.map((d) => d.value).filter((v) => v !== 0);
  const bestValue = lowerIsBetter ? Math.min(...values) : Math.max(...values);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">No data to compare</p>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            stroke="#6b7280"
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            stroke="#6b7280"
            tick={{ fontSize: 12 }}
            tickLine={false}
            label={{
              value: formatMetricName(metricKey),
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: '#6b7280' },
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
            formatter={(value) => {
              const numValue = typeof value === 'number' ? value : 0;
              return [formatMetricValue(numValue), formatMetricName(metricKey)];
            }}
            labelFormatter={(label) => `Model: ${label}`}
          />
          <Legend />
          <Bar
            dataKey="value"
            name={formatMetricName(metricKey)}
            fill="#2563eb"
            radius={[4, 4, 0, 0]}
            // Highlight best value
            shape={(props: any) => {
              const isBest = props.payload.value === bestValue;
              return (
                <rect
                  {...props}
                  fill={isBest ? '#16a34a' : '#2563eb'}
                  stroke={isBest ? '#15803d' : 'none'}
                  strokeWidth={isBest ? 2 : 0}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface MultiMetricComparisonChartProps {
  data: MetricData[];
  metricKeys: string[];
  height?: number;
}

/**
 * Grouped bar chart comparing multiple metrics across runs
 */
export function MultiMetricComparisonChart({
  data,
  metricKeys,
  height = 400,
}: MultiMetricComparisonChartProps) {
  const chartData = data.map((item, index) => {
    const entry: Record<string, string | number> = {
      name: item.name || `Run ${index + 1}`,
    };
    metricKeys.forEach((key) => {
      entry[key] = item.metrics[key] ?? 0;
    });
    return entry;
  });

  if (chartData.length === 0 || metricKeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">No data to compare</p>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            stroke="#6b7280"
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
            formatter={(value, name) => {
              const numValue = typeof value === 'number' ? value : 0;
              const strName = typeof name === 'string' ? name : String(name);
              return [formatMetricValue(numValue), formatMetricName(strName)];
            }}
          />
          <Legend formatter={(value) => formatMetricName(value)} />
          {metricKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              fill={colors[index % colors.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatMetricName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Loss', 'Loss')
    .replace('Lr', 'LR');
}

function formatMetricValue(value: number): string {
  if (Math.abs(value) < 0.001) return value.toExponential(2);
  if (Math.abs(value) < 1) return value.toFixed(4);
  if (Math.abs(value) < 100) return value.toFixed(2);
  return value.toLocaleString();
}

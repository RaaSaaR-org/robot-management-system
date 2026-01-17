/**
 * @file ConvergenceChart.tsx
 * @description Chart component for visualizing model convergence over federated rounds
 * @feature fleetlearning
 */

import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { TrendingDown, Users, Loader2 } from 'lucide-react';
import type { ConvergenceDataPoint } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ConvergenceChartProps {
  data: ConvergenceDataPoint[];
  isLoading?: boolean;
  height?: number;
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ConvergenceChart({
  data,
  isLoading = false,
  height = 300,
  className,
}: ConvergenceChartProps) {
  // Calculate chart bounds and paths
  const chartData = useMemo(() => {
    if (data.length === 0) return null;

    const losses = data.map((d) => d.loss);
    const minLoss = Math.min(...losses);
    const maxLoss = Math.max(...losses);
    const lossRange = maxLoss - minLoss || 1;

    // Padding for chart
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = 600;
    const chartHeight = height - padding.top - padding.bottom;

    // Scale functions
    const xScale = (index: number) =>
      padding.left + (index / (data.length - 1 || 1)) * (chartWidth - padding.left - padding.right);
    const yScale = (loss: number) =>
      padding.top + (1 - (loss - minLoss) / lossRange) * chartHeight;

    // Generate path
    const pathPoints = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.loss)}`);
    const linePath = pathPoints.join(' ');

    // Generate area path
    const areaPath =
      linePath +
      ` L ${xScale(data.length - 1)} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

    // Y-axis ticks
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const value = minLoss + (lossRange * i) / 4;
      return {
        value,
        y: yScale(value),
        label: value.toFixed(4),
      };
    }).reverse();

    // X-axis labels (show a few round numbers)
    const xLabels = data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0);

    return {
      linePath,
      areaPath,
      points: data.map((d, i) => ({
        x: xScale(i),
        y: yScale(d.loss),
        data: d,
      })),
      yTicks,
      xLabels: xLabels.map((d) => ({
        x: xScale(data.indexOf(d)),
        label: `R${d.roundNumber}`,
      })),
      padding,
      chartWidth,
      chartHeight: height,
    };
  }, [data, height]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700',
          className
        )}
        style={{ height }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Empty state
  if (!chartData || data.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700',
          className
        )}
        style={{ height }}
      >
        <TrendingDown className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-gray-500 dark:text-gray-400">No convergence data available</p>
      </div>
    );
  }

  const latestLoss = data[data.length - 1]?.loss;
  const initialLoss = data[0]?.loss;
  const improvement = initialLoss && latestLoss ? ((initialLoss - latestLoss) / initialLoss) * 100 : 0;

  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Model Convergence</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Loss over {data.length} federated rounds
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Improvement</p>
          <p
            className={cn(
              'text-lg font-bold',
              improvement > 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            )}
          >
            {improvement > 0 ? '-' : '+'}
            {Math.abs(improvement).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${chartData.chartWidth} ${chartData.chartHeight}`}
        className="w-full"
        style={{ height }}
      >
        {/* Grid lines */}
        {chartData.yTicks.map((tick) => (
          <line
            key={tick.value}
            x1={chartData.padding.left}
            y1={tick.y}
            x2={chartData.chartWidth - chartData.padding.right}
            y2={tick.y}
            stroke="currentColor"
            className="text-gray-200 dark:text-gray-700"
            strokeDasharray="4,4"
          />
        ))}

        {/* Area fill */}
        <path
          d={chartData.areaPath}
          fill="url(#convergence-gradient)"
          opacity={0.3}
        />

        {/* Line */}
        <path
          d={chartData.linePath}
          fill="none"
          stroke="currentColor"
          className="text-primary-500"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {chartData.points.map((point, i) => (
          <g key={i}>
            <circle
              cx={point.x}
              cy={point.y}
              r={4}
              fill="currentColor"
              className="text-primary-500"
            />
            <title>
              Round {point.data.roundNumber}: Loss {point.data.loss.toFixed(4)} ({point.data.participants} participants)
            </title>
          </g>
        ))}

        {/* Y-axis labels */}
        {chartData.yTicks.map((tick) => (
          <text
            key={tick.value}
            x={chartData.padding.left - 8}
            y={tick.y + 4}
            textAnchor="end"
            className="text-xs fill-gray-500 dark:fill-gray-400"
          >
            {tick.label}
          </text>
        ))}

        {/* X-axis labels */}
        {chartData.xLabels.map((label, i) => (
          <text
            key={i}
            x={label.x}
            y={chartData.chartHeight - 10}
            textAnchor="middle"
            className="text-xs fill-gray-500 dark:fill-gray-400"
          >
            {label.label}
          </text>
        ))}

        {/* Y-axis title */}
        <text
          x={15}
          y={chartData.chartHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90, 15, ${chartData.chartHeight / 2})`}
          className="text-xs fill-gray-500 dark:fill-gray-400"
        >
          Loss
        </text>

        {/* Gradient definition */}
        <defs>
          <linearGradient id="convergence-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" className="text-primary-500" />
            <stop offset="100%" stopColor="currentColor" className="text-primary-500" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <TrendingDown className="w-4 h-4 text-primary-500" />
          <span>Training Loss</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          <span>Avg {Math.round(data.reduce((sum, d) => sum + d.participants, 0) / data.length)} participants/round</span>
        </div>
      </div>
    </div>
  );
}

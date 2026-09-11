/**
 * @file LossCurveChart.tsx
 * @description Training and validation loss per epoch, on the kit's chart theme
 * @feature training
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
import { chartColors, chartTheme } from '@/shared/components/ui';
import type { TrainingMetrics } from '../types';

export interface LossCurveChartProps {
  metrics: TrainingMetrics;
  height?: number;
  showLearningRate?: boolean;
  bestEpoch?: number;
}

const SERIES_LABELS: Record<string, string> = {
  trainLoss: 'Training loss',
  valLoss: 'Validation loss',
  learningRate: 'Learning rate',
  bestEpochMarker: 'Best epoch',
};

export function LossCurveChart({ metrics, height = 260, showLearningRate = false, bestEpoch }: LossCurveChartProps) {
  // The best-epoch marker is a fixed field on the data row (a function dataKey
  // can't be stringified by recharts → duplicate-key warnings).
  const data =
    metrics.training_loss?.map((loss, index) => {
      const epoch = index + 1;
      return {
        epoch,
        trainLoss: loss,
        valLoss: metrics.validation_loss?.[index],
        learningRate: metrics.learning_rate?.[index],
        bestEpochMarker: bestEpoch !== undefined && epoch === bestEpoch ? loss : null,
      };
    }) ?? [];

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-control bg-inset text-sm text-ink-tertiary">
        No loss reported yet.
      </div>
    );
  }

  const hasLr = showLearningRate && (metrics.learning_rate?.length ?? 0) > 0;

  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: hasLr ? 8 : 16, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="epoch" {...chartTheme.xAxis} />
          <YAxis yAxisId="loss" {...chartTheme.yAxis} width={48} />
          {hasLr && <YAxis yAxisId="lr" orientation="right" {...chartTheme.yAxis} width={56} />}
          <Tooltip
            {...chartTheme.tooltip}
            labelFormatter={(v) => `Epoch ${v}`}
            formatter={(value, name) => [
              typeof value === 'number' ? value.toPrecision(4) : String(value),
              SERIES_LABELS[String(name)] ?? String(name),
            ]}
          />
          <Legend {...chartTheme.legend} formatter={(v) => SERIES_LABELS[String(v)] ?? String(v)} />
          <Line yAxisId="loss" type="monotone" dataKey="trainLoss" stroke={chartColors.series[0]} strokeWidth={1.75} dot={false} />
          {(metrics.validation_loss?.length ?? 0) > 0 && (
            <Line yAxisId="loss" type="monotone" dataKey="valLoss" stroke={chartColors.series[1]} strokeWidth={1.75} dot={false} />
          )}
          {hasLr && (
            <Line yAxisId="lr" type="monotone" dataKey="learningRate" stroke={chartColors.muted} strokeWidth={1} strokeDasharray="4 4" dot={false} />
          )}
          {bestEpoch !== undefined && (
            <Line
              yAxisId="loss"
              dataKey="bestEpochMarker"
              stroke={chartColors.estimated}
              strokeWidth={0}
              dot={{ r: 5, fill: chartColors.estimated, stroke: chartColors.surface, strokeWidth: 2 }}
              connectNulls={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

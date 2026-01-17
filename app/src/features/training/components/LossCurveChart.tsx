/**
 * @file LossCurveChart.tsx
 * @description Recharts line chart for training loss visualization
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
import type { TrainingMetrics } from '../types';

export interface LossCurveChartProps {
  metrics: TrainingMetrics;
  height?: number;
  showLearningRate?: boolean;
  bestEpoch?: number;
}

/**
 * Line chart showing training and validation loss curves
 */
export function LossCurveChart({
  metrics,
  height = 300,
  showLearningRate = false,
  bestEpoch,
}: LossCurveChartProps) {
  // Transform metrics into chart data
  const data = metrics.training_loss?.map((loss, index) => ({
    epoch: index + 1,
    trainLoss: loss,
    valLoss: metrics.validation_loss?.[index],
    learningRate: metrics.learning_rate?.[index],
  })) || [];

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">No training data available</p>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="epoch"
            label={{ value: 'Epoch', position: 'insideBottom', offset: -5 }}
            stroke="#6b7280"
          />
          <YAxis
            yAxisId="loss"
            label={{ value: 'Loss', angle: -90, position: 'insideLeft' }}
            stroke="#6b7280"
          />
          {showLearningRate && (
            <YAxis
              yAxisId="lr"
              orientation="right"
              label={{ value: 'Learning Rate', angle: 90, position: 'insideRight' }}
              stroke="#6b7280"
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
            formatter={(value, name) => {
              const numValue = typeof value === 'number' ? value : 0;
              const label =
                name === 'trainLoss'
                  ? 'Training Loss'
                  : name === 'valLoss'
                    ? 'Validation Loss'
                    : 'Learning Rate';
              return [numValue.toFixed(6), label];
            }}
          />
          <Legend />

          {/* Training loss line */}
          <Line
            yAxisId="loss"
            type="monotone"
            dataKey="trainLoss"
            name="Training Loss"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />

          {/* Validation loss line */}
          {metrics.validation_loss && metrics.validation_loss.length > 0 && (
            <Line
              yAxisId="loss"
              type="monotone"
              dataKey="valLoss"
              name="Validation Loss"
              stroke="#dc2626"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}

          {/* Learning rate line */}
          {showLearningRate && metrics.learning_rate && metrics.learning_rate.length > 0 && (
            <Line
              yAxisId="lr"
              type="monotone"
              dataKey="learningRate"
              name="Learning Rate"
              stroke="#16a34a"
              strokeWidth={1}
              strokeDasharray="5 5"
              dot={false}
            />
          )}

          {/* Best epoch marker */}
          {bestEpoch !== undefined && (
            <Line
              yAxisId="loss"
              type="monotone"
              dataKey={(entry: { epoch: number }) =>
                entry.epoch === bestEpoch ? metrics.training_loss?.[bestEpoch - 1] : null
              }
              name="Best Epoch"
              stroke="#f59e0b"
              strokeWidth={0}
              dot={{ r: 6, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

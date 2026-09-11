/**
 * @file ConvergenceChart.tsx
 * @description Panel with the global model's loss (and accuracy) per
 *              federated round
 * @feature fleetlearning
 */

import { TrendingDown } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorState, Panel, Skeleton, chartColors, chartTheme } from '@/shared/components/ui';
import type { ConvergenceDataPoint } from '../types/fleetlearning.types';

export interface ConvergenceChartProps {
  data: ConvergenceDataPoint[];
  isLoading?: boolean;
  /** Convergence-fetch error; shown when there is no data to fall back on. */
  error?: string | null;
  onRetry?: () => void;
  height?: number;
  className?: string;
}

export function ConvergenceChart({ data, isLoading = false, error = null, onRetry, height = 320, className }: ConvergenceChartProps) {
  const hasAccuracy = data.some((d) => typeof d.accuracy === 'number');
  const first = data[0]?.loss;
  const last = data[data.length - 1]?.loss;
  const change = first && last ? ((first - last) / first) * 100 : null;
  const avgParticipants = data.length ? Math.round(data.reduce((s, d) => s + d.participants, 0) / data.length) : 0;

  const description = data.length
    ? `Loss over ${data.length} rounds${change !== null ? ` · ${change >= 0 ? 'down' : 'up'} ${Math.abs(change).toFixed(1)} %` : ''} · ${avgParticipants} robots per round on average`
    : 'Loss and accuracy per round';

  return (
    <Panel className={className}>
      <Panel.Header title="Convergence" description={description} />
      <Panel.Body>
        {isLoading && data.length === 0 ? (
          <div style={{ height }}><Skeleton className="h-full w-full" /></div>
        ) : error && data.length === 0 ? (
          <ErrorState title="Couldn't load convergence data" message={error} onRetry={onRetry} />
        ) : data.length === 0 ? (
          <EmptyState icon={<TrendingDown />} title="No convergence data yet"
            description="Each completed round adds a point for the global model's loss." />
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...chartTheme.grid} />
                <XAxis dataKey="roundNumber" tickFormatter={(n) => `R${n}`} {...chartTheme.xAxis} />
                <YAxis yAxisId="loss" {...chartTheme.yAxis} width={56} tickFormatter={(v: number) => v.toFixed(3)} />
                {hasAccuracy && (
                  <YAxis yAxisId="acc" {...chartTheme.yAxis} orientation="right" width={44} domain={[0, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                )}
                <Tooltip {...chartTheme.tooltip} labelFormatter={(n) => `Round ${n}`} />
                <Line yAxisId="loss" type="monotone" dataKey="loss" name="Loss" stroke={chartColors.series[0]}
                  strokeWidth={1.75} dot={false} />
                {hasAccuracy && (
                  <Line yAxisId="acc" type="monotone" dataKey="accuracy" name="Accuracy" stroke={chartColors.series[1]}
                    strokeWidth={1.75} dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}

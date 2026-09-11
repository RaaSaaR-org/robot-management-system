/**
 * @file PerformanceDashboard.tsx
 * @description AI performance: stat row, model quality bars, safety distribution chart
 * @feature explainability
 */

import { BarChart3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  EmptyState,
  ErrorState,
  Panel,
  ProgressBar,
  SkeletonText,
  StatRow,
  StatTile,
  chartColors,
  chartTheme,
} from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { METRICS_PERIOD_LABELS, type AIPerformanceMetrics } from '../types';

export interface PerformanceDashboardProps {
  metrics: AIPerformanceMetrics | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const pct = (v: number) => Math.round(v * 100);

export function PerformanceDashboard({ metrics, isLoading, error, onRetry }: PerformanceDashboardProps) {
  if (isLoading && !metrics) {
    return (
      <div className="flex flex-col gap-4">
        <StatRow>
          {[0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" value="" isLoading />)}
        </StatRow>
        <Panel><SkeletonText lines={4} /></Panel>
      </div>
    );
  }
  if (error && !metrics) {
    return <Panel><ErrorState title="Couldn't load performance metrics" message={error} onRetry={onRetry} /></Panel>;
  }
  if (!metrics) {
    return (
      <Panel>
        <EmptyState icon={<BarChart3 />} title="No performance data yet" description="Metrics appear after the AI processes its first command." />
      </Panel>
    );
  }

  const range = `${new Date(metrics.startDate).toLocaleDateString(UI_DATE_LOCALE)} – ${new Date(metrics.endDate).toLocaleDateString(UI_DATE_LOCALE)}`;
  const none = metrics.totalDecisions === 0;
  const safety = [
    { name: 'Safe', value: metrics.safetyDistribution.safe, color: chartColors.measured },
    { name: 'Caution', value: metrics.safetyDistribution.caution, color: chartColors.unknown },
    { name: 'Dangerous', value: metrics.safetyDistribution.dangerous, color: chartColors.stopped },
  ];

  return (
    <div className="flex flex-col gap-4">
      <StatRow columns={4}>
        <StatTile label="Decisions" value={metrics.totalDecisions} hint={METRICS_PERIOD_LABELS[metrics.period]} />
        <StatTile
          label="Accuracy"
          value={none ? '—' : pct(metrics.accuracy)}
          unit={none ? undefined : '%'}
          tone={none ? 'neutral' : metrics.accuracy >= 0.8 ? 'live' : metrics.accuracy >= 0.6 ? 'gated' : 'stopped'}
          hint="Validated as correct"
        />
        <StatTile
          label="Avg confidence"
          value={none ? '—' : pct(metrics.avgConfidence)}
          unit={none ? undefined : '%'}
          tone={none ? 'neutral' : metrics.avgConfidence >= 0.8 ? 'live' : metrics.avgConfidence >= 0.5 ? 'gated' : 'stopped'}
          hint="Across all decisions"
        />
        <StatTile
          label="Drift"
          value={none ? '—' : pct(metrics.driftIndicator)}
          unit={none ? undefined : '%'}
          tone={none ? 'neutral' : metrics.driftIndicator < 0.1 ? 'live' : metrics.driftIndicator < 0.3 ? 'gated' : 'stopped'}
          hint="Below 10% is stable"
        />
      </StatRow>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <Panel.Header title="Model quality" description={range} />
          <Panel.Body className="flex flex-col gap-4">
            <ProgressBar label="Precision" value={pct(metrics.precision)} />
            <ProgressBar label="Recall" value={pct(metrics.recall)} />
            <ProgressBar label="Error rate" value={pct(metrics.errorRate)} variant={metrics.errorRate > 0.1 ? 'error' : 'default'} />
          </Panel.Body>
        </Panel>
        <Panel>
          <Panel.Header title="Safety distribution" description="Decisions by safety classification" />
          <Panel.Body>
            {none ? (
              <EmptyState size="sm" icon={<BarChart3 />} title="No decisions in this period" />
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={safety} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid {...chartTheme.grid} />
                    <XAxis dataKey="name" {...chartTheme.xAxis} />
                    <YAxis allowDecimals={false} {...chartTheme.yAxis} />
                    <Tooltip {...chartTheme.tooltip} />
                    <Bar dataKey="value" name="Decisions" radius={[4, 4, 0, 0]}>
                      {safety.map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}

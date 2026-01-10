/**
 * @file PerformanceDashboard.tsx
 * @description Dashboard for AI performance metrics
 * @feature explainability
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import {
  type AIPerformanceMetrics,
  type MetricsPeriod,
  METRICS_PERIOD_LABELS,
} from '../types';

export interface PerformanceDashboardProps {
  metrics: AIPerformanceMetrics | null;
  isLoading?: boolean;
  onPeriodChange?: (period: MetricsPeriod) => void;
  className?: string;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

function MetricCard({ label, value, subtext, variant = 'default' }: MetricCardProps) {
  const variantColors = {
    default: 'text-theme-primary',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <Card className="glass-card p-4">
      <p className="text-theme-tertiary text-sm mb-1">{label}</p>
      <p className={cn('text-2xl font-bold', variantColors[variant])}>{value}</p>
      {subtext && <p className="text-theme-tertiary text-xs mt-1">{subtext}</p>}
    </Card>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Dashboard showing AI performance metrics
 *
 * @example
 * ```tsx
 * <PerformanceDashboard
 *   metrics={metrics}
 *   onPeriodChange={(period) => fetchMetrics(period)}
 * />
 * ```
 */
export function PerformanceDashboard({
  metrics,
  isLoading,
  onPeriodChange,
  className,
}: PerformanceDashboardProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<MetricsPeriod>('weekly');

  const handlePeriodChange = (period: MetricsPeriod) => {
    setSelectedPeriod(period);
    onPeriodChange?.(period);
  };

  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-48 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="glass-card p-4">
                <div className="h-3 bg-gray-700 rounded w-20 mb-2" />
                <div className="h-8 bg-gray-700 rounded w-16" />
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <Card className={cn('glass-card p-6 text-center', className)}>
        <p className="text-theme-secondary font-medium">No performance data yet</p>
        <p className="text-theme-tertiary text-sm mt-2">
          Metrics will appear after the AI processes its first command.
        </p>
      </Card>
    );
  }

  const getDriftVariant = (drift: number): 'success' | 'warning' | 'error' => {
    if (drift < 0.1) return 'success';
    if (drift < 0.3) return 'warning';
    return 'error';
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Period Selector */}
      <div className="flex items-center gap-2">
        {(Object.keys(METRICS_PERIOD_LABELS) as MetricsPeriod[]).map((period) => (
          <Button
            key={period}
            variant={selectedPeriod === period ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePeriodChange(period)}
          >
            {METRICS_PERIOD_LABELS[period]}
          </Button>
        ))}
      </div>

      {/* Main Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Decisions"
          value={metrics.totalDecisions}
          subtext={`${METRICS_PERIOD_LABELS[metrics.period]}`}
        />
        <MetricCard
          label="Accuracy"
          value={formatPercent(metrics.accuracy)}
          subtext="% of decisions validated as correct"
          variant={metrics.accuracy >= 0.8 ? 'success' : metrics.accuracy >= 0.6 ? 'warning' : 'error'}
        />
        <MetricCard
          label="Avg Confidence"
          value={formatPercent(metrics.avgConfidence)}
          subtext="How certain the AI is on average"
          variant={metrics.avgConfidence >= 0.7 ? 'success' : 'warning'}
        />
        <MetricCard
          label="Drift Indicator"
          value={formatPercent(metrics.driftIndicator)}
          subtext={metrics.driftIndicator < 0.1 ? 'Stable - below 10% is healthy' : 'Monitoring needed'}
          variant={getDriftVariant(metrics.driftIndicator)}
        />
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Precision & Recall */}
        <Card className="glass-card p-4">
          <h4 className="font-medium text-theme-primary mb-3">Model Performance</h4>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-theme-secondary">Precision</span>
                <span className="text-theme-primary">{formatPercent(metrics.precision)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${metrics.precision * 100}%` }}
                />
              </div>
              <p className="text-theme-tertiary text-xs mt-1">When AI says 'yes', how often is it right?</p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-theme-secondary">Recall</span>
                <span className="text-theme-primary">{formatPercent(metrics.recall)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full"
                  style={{ width: `${metrics.recall * 100}%` }}
                />
              </div>
              <p className="text-theme-tertiary text-xs mt-1">Of all correct actions, how many did AI find?</p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-theme-secondary">Error Rate</span>
                <span className="text-red-400">{formatPercent(metrics.errorRate)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full"
                  style={{ width: `${metrics.errorRate * 100}%` }}
                />
              </div>
              <p className="text-theme-tertiary text-xs mt-1">% of decisions that caused issues</p>
            </div>
          </div>
        </Card>

        {/* Safety Distribution */}
        <Card className="glass-card p-4">
          <h4 className="font-medium text-theme-primary mb-3">Safety Distribution</h4>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-green-400">Safe</span>
                <span className="text-theme-primary">{metrics.safetyDistribution.safe}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{
                    width: `${
                      (metrics.safetyDistribution.safe / Math.max(metrics.totalDecisions, 1)) * 100
                    }%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-yellow-400">Caution</span>
                <span className="text-theme-primary">{metrics.safetyDistribution.caution}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className="h-full bg-yellow-500 rounded-full"
                  style={{
                    width: `${
                      (metrics.safetyDistribution.caution / Math.max(metrics.totalDecisions, 1)) * 100
                    }%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-red-400">Dangerous</span>
                <span className="text-theme-primary">{metrics.safetyDistribution.dangerous}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full"
                  style={{
                    width: `${
                      (metrics.safetyDistribution.dangerous / Math.max(metrics.totalDecisions, 1)) *
                      100
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Time Range */}
      <Card className="glass-card p-3">
        <p className="text-theme-tertiary text-sm text-center">
          Data from {new Date(metrics.startDate).toLocaleDateString()} to{' '}
          {new Date(metrics.endDate).toLocaleDateString()}
        </p>
      </Card>
    </div>
  );
}

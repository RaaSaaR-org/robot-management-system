/**
 * @file ImpactVisualization.tsx
 * @description Visualization component for contribution impact
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import {
  TrendingUp,
  BarChart3,
  Cpu,
  Database,
  Calendar,
  Loader2,
} from 'lucide-react';
import type { ImpactSummary, PerformanceImprovement } from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ImpactVisualizationProps {
  impact: ImpactSummary | null;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getImprovementColor(improvement: number): string {
  if (improvement >= 10) return 'text-green-600 dark:text-green-400';
  if (improvement >= 5) return 'text-emerald-600 dark:text-emerald-400';
  if (improvement > 0) return 'text-teal-600 dark:text-teal-400';
  return 'text-gray-500 dark:text-gray-400';
}

function getImprovementBgColor(improvement: number): string {
  if (improvement >= 10) return 'bg-green-100 dark:bg-green-900/30';
  if (improvement >= 5) return 'bg-emerald-100 dark:bg-emerald-900/30';
  if (improvement > 0) return 'bg-teal-100 dark:bg-teal-900/30';
  return 'bg-gray-100 dark:bg-gray-800';
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface StatCardProps {
  icon: typeof TrendingUp;
  label: string;
  value: string | number;
  subtext?: string;
  className?: string;
}

function StatCard({ icon: Icon, label, value, subtext, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
          <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {value}
          </p>
          {subtext && (
            <p className="text-xs text-gray-400 dark:text-gray-500">{subtext}</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ImprovementBarProps {
  improvement: PerformanceImprovement;
}

function ImprovementBar({ improvement }: ImprovementBarProps) {
  const changePercent = ((improvement.after - improvement.before) / improvement.before) * 100;
  const isPositive = changePercent > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
          {improvement.metric.replace(/_/g, ' ')}
        </span>
        <span
          className={cn(
            'text-sm font-semibold',
            getImprovementColor(changePercent)
          )}
        >
          {isPositive ? '+' : ''}
          {changePercent.toFixed(1)}%
        </span>
      </div>
      <div className="relative h-8 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
        {/* Before bar */}
        <div
          className="absolute inset-y-0 left-0 bg-gray-300 dark:bg-gray-600 rounded-l-lg"
          style={{ width: `${(improvement.before / Math.max(improvement.before, improvement.after)) * 50}%` }}
        >
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-600 dark:text-gray-300">
            {improvement.before.toFixed(1)}
          </span>
        </div>
        {/* After bar */}
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 rounded-r-lg',
            getImprovementBgColor(changePercent)
          )}
          style={{ width: `${(improvement.after / Math.max(improvement.before, improvement.after)) * 50}%` }}
        >
          <span
            className={cn(
              'absolute left-2 top-1/2 -translate-y-1/2 text-xs font-medium',
              getImprovementColor(changePercent)
            )}
          >
            {improvement.after.toFixed(1)}
          </span>
        </div>
        {/* Divider */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-gray-400 dark:bg-gray-500" />
      </div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>Before</span>
        <span>After</span>
      </div>
      {improvement.attributionPercent > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Your data attributed {improvement.attributionPercent.toFixed(1)}% of this improvement
        </p>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ImpactVisualization({
  impact,
  isLoading,
  className,
}: ImpactVisualizationProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center py-12',
          className
        )}
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!impact) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400',
          className
        )}
      >
        <BarChart3 className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg">No impact data available</p>
        <p className="text-sm">Impact data will appear once your contribution is used in training</p>
      </div>
    );
  }

  const hasNoImpact = impact.totalModelsUsedIn === 0;

  if (hasNoImpact) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-xl',
          className
        )}
      >
        <Database className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg">Data not yet used</p>
        <p className="text-sm text-center max-w-md">
          Your contribution has not yet been used in any model training.
          Check back later to see the impact of your data!
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Cpu}
          label="Models Using Data"
          value={impact.totalModelsUsedIn}
          subtext="trained models"
        />
        <StatCard
          icon={Database}
          label="Trajectories Used"
          value={impact.totalTrajectoriesUsed.toLocaleString()}
          subtext="data points"
        />
        <StatCard
          icon={TrendingUp}
          label="Impact Score"
          value={impact.averageImpactScore.toFixed(1)}
          subtext="average contribution"
        />
      </div>

      {/* Last Used */}
      {impact.lastUsedAt && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Calendar className="w-4 h-4" />
          <span>Last used in training: {formatDate(impact.lastUsedAt)}</span>
        </div>
      )}

      {/* Performance Improvements */}
      {impact.improvements.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            Performance Improvements
          </h3>
          <div className="space-y-6">
            {impact.improvements.map((improvement, idx) => (
              <ImprovementBar key={idx} improvement={improvement} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

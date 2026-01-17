/**
 * @file UncertaintyHeatmap.tsx
 * @description Heatmap visualization for model uncertainty by task/environment
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Loader2 } from 'lucide-react';
import type { UncertaintyAnalysis, CategoryUncertainty } from '../types/datacollection.types';
import { TREND_COLORS } from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UncertaintyHeatmapProps {
  analysis: UncertaintyAnalysis | null;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getUncertaintyColor(uncertainty: number): string {
  if (uncertainty >= 0.7) return 'bg-red-500';
  if (uncertainty >= 0.5) return 'bg-orange-500';
  if (uncertainty >= 0.3) return 'bg-yellow-500';
  return 'bg-green-500';
}

function getUncertaintyTextColor(uncertainty: number): string {
  if (uncertainty >= 0.7) return 'text-red-600 dark:text-red-400';
  if (uncertainty >= 0.5) return 'text-orange-600 dark:text-orange-400';
  if (uncertainty >= 0.3) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-green-600 dark:text-green-400';
}

function getTrendIcon(trend: 'improving' | 'stable' | 'degrading') {
  switch (trend) {
    case 'improving':
      return <TrendingDown className="w-4 h-4" />;
    case 'degrading':
      return <TrendingUp className="w-4 h-4" />;
    default:
      return <Minus className="w-4 h-4" />;
  }
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface UncertaintyCellProps {
  category: string;
  data: CategoryUncertainty;
  onClick?: () => void;
}

function UncertaintyCell({ category, data, onClick }: UncertaintyCellProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4',
        'transition-all',
        onClick && 'cursor-pointer hover:shadow-md'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate pr-2">
          {category}
        </h4>
        <div className={cn('flex items-center gap-1', TREND_COLORS[data.recentTrend])}>
          {getTrendIcon(data.recentTrend)}
          <span className="text-xs capitalize">{data.recentTrend}</span>
        </div>
      </div>

      {/* Uncertainty Bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Uncertainty</span>
          <span className={cn('text-sm font-semibold', getUncertaintyTextColor(data.meanUncertainty))}>
            {(data.meanUncertainty * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', getUncertaintyColor(data.meanUncertainty))}
            style={{ width: `${data.meanUncertainty * 100}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500 dark:text-gray-400">Samples</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {data.sampleCount.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">Confidence Range</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {(data.minConfidence * 100).toFixed(0)}-{(data.maxConfidence * 100).toFixed(0)}%
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function UncertaintyHeatmap({
  analysis,
  isLoading,
  className,
}: UncertaintyHeatmapProps) {
  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400',
          className
        )}
      >
        <AlertTriangle className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg">No uncertainty data</p>
        <p className="text-sm">Uncertainty analysis requires prediction logs</p>
      </div>
    );
  }

  const taskCategories = Object.entries(analysis.byTask);
  const environmentCategories = Object.entries(analysis.byEnvironment);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Overall Stats */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Overall Uncertainty</p>
            <p className={cn('text-2xl font-bold', getUncertaintyTextColor(analysis.overallUncertainty))}>
              {(analysis.overallUncertainty * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Predictions</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {analysis.totalPredictions.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">High Uncertainty</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {analysis.highUncertaintyCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Threshold</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {(analysis.highUncertaintyThreshold * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      </div>

      {/* By Task */}
      {taskCategories.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            By Task Category
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {taskCategories.map(([category, data]) => (
              <UncertaintyCell key={category} category={category} data={data} />
            ))}
          </div>
        </div>
      )}

      {/* By Environment */}
      {environmentCategories.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            By Environment
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {environmentCategories.map(([category, data]) => (
              <UncertaintyCell key={category} category={category} data={data} />
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>Low (&lt;30%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-yellow-500" />
          <span>Medium (30-50%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-orange-500" />
          <span>High (50-70%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span>Critical (&gt;70%)</span>
        </div>
      </div>
    </div>
  );
}

/**
 * @file UncertaintyHeatmap.tsx
 * @description Heatmap visualization for model uncertainty by task/environment
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, BarChart3 } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import { ModelSelector } from './ModelSelector';
import { useUncertaintyAnalysis } from '../hooks/datacollection';
import type { CategoryUncertainty } from '../types/datacollection.types';
import { TREND_COLORS } from '../types/datacollection.types';
import type { RegisteredModel } from '@/features/training/types';

// ============================================================================
// TYPES
// ============================================================================

export interface UncertaintyHeatmapProps {
  models: RegisteredModel[];
  selectedModelId: string | null;
  onModelChange: (modelId: string | null) => void;
  modelsLoading?: boolean;
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
  if (uncertainty >= 0.7) return 'text-red-400';
  if (uncertainty >= 0.5) return 'text-orange-400';
  if (uncertainty >= 0.3) return 'text-yellow-400';
  return 'text-green-400';
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
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className="!p-4"
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-theme-primary truncate pr-2">
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
          <span className="text-xs text-theme-muted">Uncertainty</span>
          <span className={cn('text-sm font-semibold', getUncertaintyTextColor(data.meanUncertainty))}>
            {(data.meanUncertainty * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-3 bg-glass-subtle rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', getUncertaintyColor(data.meanUncertainty))}
            style={{ width: `${data.meanUncertainty * 100}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-theme-muted">Samples</p>
          <p className="font-medium text-theme-primary">
            {data.sampleCount.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-theme-muted">Confidence Range</p>
          <p className="font-medium text-theme-primary">
            {(data.minConfidence * 100).toFixed(0)}-{(data.maxConfidence * 100).toFixed(0)}%
          </p>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function UncertaintyHeatmap({
  models,
  selectedModelId,
  onModelChange,
  modelsLoading,
  className,
}: UncertaintyHeatmapProps) {
  // Use the hook with the selected model, or empty string to skip fetch
  const { analysis, isLoading } = useUncertaintyAnalysis(selectedModelId || '');

  return (
    <div className={cn('space-y-6', className)}>
      {/* Model Selector */}
      <ModelSelector
        models={models}
        selectedModelId={selectedModelId}
        onChange={onModelChange}
        loading={modelsLoading}
      />

      {/* No model selected */}
      {!selectedModelId && !modelsLoading && models.length > 0 && (
        <Card variant="subtle" className="py-12">
          <div className="flex flex-col items-center justify-center text-theme-muted">
            <BarChart3 className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm font-medium text-theme-secondary">No model selected</p>
            <p className="text-xs mt-1 max-w-sm text-center">
              Select a model above to view uncertainty analysis across task categories and environments.
            </p>
          </div>
        </Card>
      )}

      {isLoading && selectedModelId && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" color="cobalt" />
        </div>
      )}

      {!isLoading && selectedModelId && !analysis && (
        <Card variant="subtle" className="py-12">
          <div className="flex flex-col items-center justify-center text-theme-muted">
            <AlertTriangle className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm font-medium text-theme-secondary">No uncertainty data</p>
            <p className="text-xs mt-1 max-w-sm text-center">
              Uncertainty analysis requires prediction logs from the selected model.
              Deploy the model and run predictions to generate data.
            </p>
          </div>
        </Card>
      )}

      {!isLoading && analysis && (
        <>
          {/* Overall Stats */}
          <Card className="!p-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-theme-muted">Overall Uncertainty</p>
                  <InfoIcon content="Average prediction uncertainty across all task categories and environments. Lower is better." size={12} />
                </div>
                <p className={cn('text-2xl font-bold', getUncertaintyTextColor(analysis.overallUncertainty))}>
                  {(analysis.overallUncertainty * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-sm text-theme-muted">Total Predictions</p>
                <p className="text-2xl font-bold text-theme-primary">
                  {analysis.totalPredictions.toLocaleString()}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-theme-muted">High Uncertainty</p>
                  <InfoIcon content="Number of predictions where the model was highly uncertain (above threshold). These indicate areas needing more training data." size={12} />
                </div>
                <p className="text-2xl font-bold text-red-400">
                  {analysis.highUncertaintyCount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-theme-muted">Threshold</p>
                <p className="text-2xl font-bold text-theme-primary">
                  {(analysis.highUncertaintyThreshold * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </Card>

          {/* By Task */}
          {Object.entries(analysis.byTask).length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-theme-primary mb-3">
                By Task Category
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(analysis.byTask).map(([category, data]) => (
                  <UncertaintyCell key={category} category={category} data={data} />
                ))}
              </div>
            </div>
          )}

          {/* By Environment */}
          {Object.entries(analysis.byEnvironment).length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-theme-primary mb-3">
                By Environment
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(analysis.byEnvironment).map(([category, data]) => (
                  <UncertaintyCell key={category} category={category} data={data} />
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center justify-center gap-6 text-xs text-theme-muted">
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
        </>
      )}
    </div>
  );
}

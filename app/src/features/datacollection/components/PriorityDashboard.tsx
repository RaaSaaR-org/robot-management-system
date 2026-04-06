/**
 * @file PriorityDashboard.tsx
 * @description Dashboard component showing collection priorities
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import {
  Target,
  AlertCircle,
  TrendingUp,
  Info,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import type { CollectionPriority } from '../types/datacollection.types';
import {
  TARGET_TYPE_LABELS,
  getPriorityColor,
  getPriorityLabel,
} from '../types/datacollection.types';
import type { RegisteredModel } from '@/features/training/types';
import { ModelSelector } from './ModelSelector';

// ============================================================================
// TYPES
// ============================================================================

export interface PriorityDashboardProps {
  priorities: CollectionPriority[];
  isLoading?: boolean;
  onTargetClick?: (priority: CollectionPriority) => void;
  models?: RegisteredModel[];
  selectedModelId?: string | null;
  onModelChange?: (modelId: string | null) => void;
  modelsLoading?: boolean;
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface PriorityCardProps {
  priority: CollectionPriority;
  onClick?: () => void;
}

function PriorityCard({ priority, onClick }: PriorityCardProps) {
  const priorityColor = getPriorityColor(priority.priorityScore);
  const priorityLabel = getPriorityLabel(priority.priorityScore);
  const progressPercent = Math.min(
    100,
    (priority.currentDemoCount / priority.estimatedDemosNeeded) * 100
  );

  return (
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className="!p-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-theme-muted">
              {TARGET_TYPE_LABELS[priority.targetType]}
            </span>
            <span className={cn('text-xs font-semibold', priorityColor)}>
              {priorityLabel} Priority
            </span>
          </div>
          <h3 className="font-semibold text-theme-primary truncate">
            {priority.target}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('text-2xl font-bold', priorityColor)}>
            {(priority.priorityScore * 100).toFixed(0)}
          </span>
          <span className="text-xs text-theme-muted">%</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-theme-muted mb-1">
          <span>{priority.currentDemoCount} collected</span>
          <span>{priority.estimatedDemosNeeded} estimated needed</span>
        </div>
        <div className="h-2 bg-glass-subtle rounded-full overflow-hidden">
          <div
            className="h-full bg-cobalt-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Component Breakdown */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="text-center p-2 rounded-brand bg-glass-bg border border-glass-subtle">
          <p className="text-theme-muted">Uncertainty</p>
          <p className="font-medium text-theme-primary">
            {(priority.uncertaintyComponent * 100).toFixed(0)}%
          </p>
        </div>
        <div className="text-center p-2 rounded-brand bg-glass-bg border border-glass-subtle">
          <p className="text-theme-muted">Diversity</p>
          <p className="font-medium text-theme-primary">
            {(priority.diversityComponent * 100).toFixed(0)}%
          </p>
        </div>
        <div className="text-center p-2 rounded-brand bg-glass-bg border border-glass-subtle">
          <p className="text-theme-muted">Progress</p>
          <p className="font-medium text-theme-primary">
            {(priority.progressComponent * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Recommendation */}
      <div className="flex items-start gap-2 p-2 rounded-brand bg-cobalt-500/5 border border-cobalt-500/10 text-xs">
        <Info className="w-4 h-4 text-cobalt-400 mt-0.5 flex-shrink-0" />
        <p className="text-theme-secondary">{priority.recommendation}</p>
      </div>

      {onClick && (
        <div className="flex items-center justify-end mt-3 text-cobalt-400 text-sm">
          <span>View Details</span>
          <ChevronRight size={16} />
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PriorityDashboard({
  priorities,
  isLoading,
  onTargetClick,
  models,
  selectedModelId,
  onModelChange,
  modelsLoading,
  className,
}: PriorityDashboardProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Model Selector */}
      {models && onModelChange && (
        <ModelSelector
          models={models}
          selectedModelId={selectedModelId ?? null}
          onChange={onModelChange}
          loading={modelsLoading}
        />
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" color="cobalt" />
        </div>
      )}

      {!isLoading && priorities.length === 0 && (
        <Card variant="subtle" className="py-12">
          <div className="flex flex-col items-center justify-center text-theme-muted">
            <Target className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm font-medium text-theme-secondary">No collection priorities</p>
            <p className="text-xs mt-1 max-w-sm text-center">
              {selectedModelId
                ? 'No priorities found for the selected model. Priorities are generated based on model uncertainty.'
                : 'Select a model above to view collection priorities based on its uncertainty analysis.'}
            </p>
          </div>
        </Card>
      )}

      {!isLoading && priorities.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="!p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-brand bg-red-500/10">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm text-theme-muted">High Priority</p>
                    <InfoIcon content="Targets with priority score >= 60%. These need the most additional demonstrations." size={12} />
                  </div>
                  <p className="text-2xl font-bold text-theme-primary">
                    {priorities.filter((p) => p.priorityScore >= 0.6).length}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="!p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-brand bg-cobalt-500/10">
                  <Target className="w-5 h-5 text-cobalt-400" />
                </div>
                <div>
                  <p className="text-sm text-theme-muted">Total Targets</p>
                  <p className="text-2xl font-bold text-theme-primary">
                    {priorities.length}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="!p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-brand bg-green-500/10">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-theme-muted">Progress</p>
                  <p className="text-2xl font-bold text-theme-primary">
                    {(() => {
                      const totalNeeded = priorities.reduce((sum, p) => sum + p.estimatedDemosNeeded, 0);
                      const totalCollected = priorities.reduce((sum, p) => sum + p.currentDemoCount, 0);
                      return totalNeeded > 0 ? Math.round((totalCollected / totalNeeded) * 100) : 0;
                    })()}%
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Priority Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {priorities.map((priority, idx) => (
              <PriorityCard
                key={`${priority.targetType}-${priority.target}-${idx}`}
                priority={priority}
                onClick={onTargetClick ? () => onTargetClick(priority) : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

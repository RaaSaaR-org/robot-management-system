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
  Loader2,
} from 'lucide-react';
import type { CollectionPriority } from '../types/datacollection.types';
import {
  TARGET_TYPE_LABELS,
  getPriorityColor,
  getPriorityLabel,
} from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface PriorityDashboardProps {
  priorities: CollectionPriority[];
  isLoading?: boolean;
  onTargetClick?: (priority: CollectionPriority) => void;
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
    <div
      onClick={onClick}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4',
        'transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {TARGET_TYPE_LABELS[priority.targetType]}
            </span>
            <span className={cn('text-xs font-semibold', priorityColor)}>
              {priorityLabel} Priority
            </span>
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
            {priority.target}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('text-2xl font-bold', priorityColor)}>
            {(priority.priorityScore * 100).toFixed(0)}
          </span>
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>{priority.currentDemoCount} collected</span>
          <span>{priority.estimatedDemosNeeded} estimated needed</span>
        </div>
        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Component Breakdown */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded">
          <p className="text-gray-500 dark:text-gray-400">Uncertainty</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {(priority.uncertaintyComponent * 100).toFixed(0)}%
          </p>
        </div>
        <div className="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded">
          <p className="text-gray-500 dark:text-gray-400">Diversity</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {(priority.diversityComponent * 100).toFixed(0)}%
          </p>
        </div>
        <div className="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded">
          <p className="text-gray-500 dark:text-gray-400">Progress</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {(priority.progressComponent * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Recommendation */}
      <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-blue-700 dark:text-blue-300">{priority.recommendation}</p>
      </div>

      {onClick && (
        <div className="flex items-center justify-end mt-3 text-primary-600 dark:text-primary-400 text-sm">
          <span>View Details</span>
          <ChevronRight size={16} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PriorityDashboard({
  priorities,
  isLoading,
  onTargetClick,
  className,
}: PriorityDashboardProps) {
  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (priorities.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400',
          className
        )}
      >
        <Target className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg">No collection priorities</p>
        <p className="text-sm">Collection priorities will appear based on model uncertainty</p>
      </div>
    );
  }

  const highPriority = priorities.filter((p) => p.priorityScore >= 0.6);
  const totalNeeded = priorities.reduce((sum, p) => sum + p.estimatedDemosNeeded, 0);
  const totalCollected = priorities.reduce((sum, p) => sum + p.currentDemoCount, 0);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">High Priority</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {highPriority.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Target className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Targets</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {priorities.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Progress</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {totalNeeded > 0 ? Math.round((totalCollected / totalNeeded) * 100) : 0}%
              </p>
            </div>
          </div>
        </div>
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
    </div>
  );
}

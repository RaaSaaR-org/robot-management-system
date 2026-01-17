/**
 * @file QualityIndicator.tsx
 * @description Real-time quality feedback indicator for teleoperation sessions
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { AlertTriangle, CheckCircle, Gauge, Info } from 'lucide-react';
import type { QualityFeedback } from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface QualityIndicatorProps {
  feedback: QualityFeedback | null;
  compact?: boolean;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getQualityColor(score: number): string {
  if (score >= 0.8) return 'text-green-500';
  if (score >= 0.6) return 'text-yellow-500';
  if (score >= 0.4) return 'text-orange-500';
  return 'text-red-500';
}

function getQualityBgColor(score: number): string {
  if (score >= 0.8) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 0.6) return 'bg-yellow-100 dark:bg-yellow-900/30';
  if (score >= 0.4) return 'bg-orange-100 dark:bg-orange-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

function getQualityLabel(score: number): string {
  if (score >= 0.8) return 'Excellent';
  if (score >= 0.6) return 'Good';
  if (score >= 0.4) return 'Fair';
  return 'Poor';
}

// ============================================================================
// COMPONENT
// ============================================================================

export function QualityIndicator({
  feedback,
  compact = false,
  className,
}: QualityIndicatorProps) {
  if (!feedback) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400',
          className
        )}
      >
        <Gauge className="w-4 h-4" />
        <span className="text-sm">Quality feedback unavailable</span>
      </div>
    );
  }

  const score = feedback.currentSmoothnessScore;
  const qualityColor = getQualityColor(score);
  const qualityBgColor = getQualityBgColor(score);
  const qualityLabel = getQualityLabel(score);

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full',
          qualityBgColor,
          className
        )}
      >
        {feedback.isJerky ? (
          <AlertTriangle className={cn('w-4 h-4', qualityColor)} />
        ) : (
          <CheckCircle className={cn('w-4 h-4', qualityColor)} />
        )}
        <span className={cn('text-sm font-medium', qualityColor)}>
          {(score * 100).toFixed(0)}%
        </span>
      </div>
    );
  }

  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-gray-100">Quality Score</span>
        </div>
        <div className={cn('flex items-center gap-1', qualityColor)}>
          {feedback.isJerky ? (
            <AlertTriangle className="w-5 h-5" />
          ) : (
            <CheckCircle className="w-5 h-5" />
          )}
          <span className="font-semibold">{qualityLabel}</span>
        </div>
      </div>

      {/* Score Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-500 dark:text-gray-400">Smoothness</span>
          <span className={cn('font-bold', qualityColor)}>{(score * 100).toFixed(0)}%</span>
        </div>
        <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              score >= 0.8 ? 'bg-green-500' :
              score >= 0.6 ? 'bg-yellow-500' :
              score >= 0.4 ? 'bg-orange-500' : 'bg-red-500'
            )}
            style={{ width: `${score * 100}%` }}
          />
        </div>
      </div>

      {/* Warning Message */}
      {feedback.warningMessage && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg mb-3">
          <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">{feedback.warningMessage}</p>
        </div>
      )}

      {/* Suggestions */}
      {feedback.suggestions && feedback.suggestions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <Info className="w-4 h-4" />
            <span>Suggestions</span>
          </div>
          <ul className="space-y-1">
            {feedback.suggestions.map((suggestion, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400"
              >
                <span className="text-primary-500 mt-1">•</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

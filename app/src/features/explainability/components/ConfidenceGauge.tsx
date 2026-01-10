/**
 * @file ConfidenceGauge.tsx
 * @description Visual gauge for displaying AI confidence scores
 * @feature explainability
 */

import { cn } from '@/shared/utils/cn';
import {
  formatConfidence,
  getConfidenceLevel,
  CONFIDENCE_LEVEL_LABELS,
  type ConfidenceLevel,
} from '../types';

export interface ConfidenceGaugeProps {
  confidence: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-2',
  md: 'h-3',
  lg: 'h-4',
};

const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: 'bg-green-500',
  medium: 'bg-yellow-500',
  low: 'bg-red-500',
};

/**
 * Visual gauge component showing confidence level
 *
 * @example
 * ```tsx
 * <ConfidenceGauge confidence={0.85} showLabel />
 * ```
 */
export function ConfidenceGauge({
  confidence,
  size = 'md',
  showLabel = false,
  className,
}: ConfidenceGaugeProps) {
  const level = getConfidenceLevel(confidence);
  const percentage = Math.round(confidence * 100);

  return (
    <div className={cn('space-y-1', className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-theme-secondary">{CONFIDENCE_LEVEL_LABELS[level]}</span>
          <span className="font-medium text-theme-primary">{formatConfidence(confidence)}</span>
        </div>
      )}
      <div className={cn('w-full rounded-full bg-gray-700/50 overflow-hidden', SIZE_CLASSES[size])}>
        <div
          className={cn('h-full rounded-full transition-all duration-300', CONFIDENCE_COLORS[level])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

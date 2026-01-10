/**
 * @file SafetyBadge.tsx
 * @description Badge component for displaying safety classification
 * @feature explainability
 */

import { cn } from '@/shared/utils/cn';
import { SAFETY_CLASSIFICATION_LABELS, type SafetyClassification } from '../types';

export interface SafetyBadgeProps {
  classification: SafetyClassification;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
};

const CLASSIFICATION_STYLES: Record<SafetyClassification, string> = {
  safe: 'bg-green-500/20 text-green-400 border-green-500/30',
  caution: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  dangerous: 'bg-red-500/20 text-red-400 border-red-500/30',
};

/**
 * Badge component for safety classification
 *
 * @example
 * ```tsx
 * <SafetyBadge classification="safe" />
 * ```
 */
export function SafetyBadge({ classification, size = 'md', className }: SafetyBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        SIZE_CLASSES[size],
        CLASSIFICATION_STYLES[classification],
        className
      )}
    >
      {SAFETY_CLASSIFICATION_LABELS[classification]}
    </span>
  );
}

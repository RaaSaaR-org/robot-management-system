/**
 * @file ProgressBar.tsx
 * @description Reusable progress bar component with variants
 * @feature shared
 */

import { cn } from '@/shared/utils';

export type ProgressBarVariant = 'default' | 'warning' | 'error' | 'success';

export interface ProgressBarProps {
  /** Current value (0-max) */
  value: number;
  /** Maximum value (default: 100) */
  max?: number;
  /** Visual variant */
  variant?: ProgressBarVariant;
  /** Optional label to display above the bar */
  label?: string;
  /** Show percentage value */
  showValue?: boolean;
  /** Additional class names */
  className?: string;
}

const variantStyles: Record<ProgressBarVariant, string> = {
  default: 'bg-gradient-to-r from-cobalt-400 to-cobalt-500',
  success: 'bg-gradient-to-r from-green-400 to-turquoise-400',
  warning: 'bg-gradient-to-r from-yellow-400 to-orange-400',
  error: 'bg-gradient-to-r from-red-400 to-red-500',
};

/**
 * Progress bar component with support for different variants and labels
 *
 * @example
 * ```tsx
 * <ProgressBar value={75} label="CPU Usage" variant="warning" />
 * ```
 */
export function ProgressBar({
  value,
  max = 100,
  variant = 'default',
  label,
  showValue = true,
  className,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="flex justify-between mb-1">
          {label && <span className="card-label">{label}</span>}
          {showValue && (
            <span className="text-sm font-medium text-theme-primary">
              {value.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div className="h-1.5 glass-subtle rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-500 rounded-full',
            variantStyles[variant]
          )}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={label}
        />
      </div>
    </div>
  );
}

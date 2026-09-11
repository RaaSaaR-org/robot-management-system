/**
 * @file ProgressBar.tsx
 * @description Thin progress bar with an optional label and percentage.
 *              Fill is primary by default, or a signal tone.
 * @feature shared
 */

import { cn } from '@/shared/utils';

export type ProgressBarVariant = 'default' | 'success' | 'info' | 'warning' | 'error';

export interface ProgressBarProps {
  /** Current value (0-max) */
  value: number;
  /** Maximum value (default: 100) */
  max?: number;
  /** Fill tone (default primary) */
  variant?: ProgressBarVariant;
  /** Optional label to display above the bar */
  label?: string;
  /** Show percentage value */
  showValue?: boolean;
  /** sm 4px · md 6px tall (default md) */
  size?: 'sm' | 'md';
  /** Additional class names */
  className?: string;
}

const variantStyles: Record<ProgressBarVariant, string> = {
  default: 'bg-primary',
  success: 'bg-signal-measured',
  info: 'bg-signal-estimated',
  warning: 'bg-signal-unknown',
  error: 'bg-signal-stopped',
};

/**
 * @example
 * ```tsx
 * <ProgressBar value={75} label="Upload" />
 * <ProgressBar value={battery} variant={battery < 20 ? 'warning' : 'default'} showValue={false} size="sm" />
 * ```
 */
export function ProgressBar({
  value,
  max = 100,
  variant = 'default',
  label,
  showValue = true,
  size = 'md',
  className,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="text-[13px] text-ink-secondary">{label}</span>}
          {showValue && (
            <span className="ml-auto text-[13px] font-medium tabular-nums text-ink-primary">{percentage.toFixed(0)}%</span>
          )}
        </div>
      )}
      <div className={cn('overflow-hidden rounded-full bg-line-subtle', size === 'sm' ? 'h-1' : 'h-1.5')}>
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-[var(--ease-instrument)]', variantStyles[variant])}
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

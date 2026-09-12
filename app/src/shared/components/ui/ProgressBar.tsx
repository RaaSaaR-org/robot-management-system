/**
 * @file ProgressBar.tsx
 * @description Thin progress bar with an optional label and percentage.
 *              Fill is primary by default, or a signal tone. `indeterminate`
 *              draws a sliding segment for work with no known end (a job
 *              starting, an upload waiting for the server).
 * @feature shared
 */

import { cn } from '@/shared/utils';

export type ProgressBarVariant = 'default' | 'success' | 'info' | 'warning' | 'error';

export interface ProgressBarProps {
  /** Current value (0-max). Ignored when `indeterminate`. */
  value?: number;
  /** Maximum value (default: 100) */
  max?: number;
  /** Fill tone (default primary) */
  variant?: ProgressBarVariant;
  /** Optional label to display above the bar */
  label?: string;
  /** Show percentage value (never shown when indeterminate) */
  showValue?: boolean;
  /** sm 4px · md 6px tall (default md) */
  size?: 'sm' | 'md';
  /** Unknown progress: a segment slides across instead of a fill */
  indeterminate?: boolean;
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

const INDETERMINATE_KEYFRAMES =
  '@keyframes kit-progress-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}';

/**
 * @example
 * ```tsx
 * <ProgressBar value={75} label="Upload" />
 * <ProgressBar value={battery} variant={battery < 20 ? 'warning' : 'default'} showValue={false} size="sm" />
 * <ProgressBar indeterminate label="Starting job" />
 * ```
 */
export function ProgressBar({
  value = 0,
  max = 100,
  variant = 'default',
  label,
  showValue = true,
  size = 'md',
  indeterminate = false,
  className,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const showPercent = showValue && !indeterminate;
  const track = cn('overflow-hidden rounded-full bg-line-subtle', size === 'sm' ? 'h-1' : 'h-1.5');

  return (
    <div className={className}>
      {(label || showPercent) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="text-[13px] text-ink-secondary">{label}</span>}
          {showPercent && (
            <span className="ml-auto text-[13px] font-medium tabular-nums text-ink-primary">{percentage.toFixed(0)}%</span>
          )}
        </div>
      )}
      {indeterminate ? (
        <div
          className={cn(track, 'relative')}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-busy="true"
          data-indeterminate=""
        >
          {/* React 19 hoists and de-duplicates this, so many bars share one rule. */}
          <style href="kit-progress-indeterminate" precedence="default">
            {INDETERMINATE_KEYFRAMES}
          </style>
          <div
            className={cn(
              'absolute inset-y-0 left-0 w-2/5 rounded-full',
              'motion-safe:animate-[kit-progress-indeterminate_1.4s_ease-in-out_infinite]',
              'motion-reduce:w-full motion-reduce:opacity-60',
              variantStyles[variant],
            )}
          />
        </div>
      ) : (
        <div className={track}>
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
      )}
    </div>
  );
}

/**
 * @file Badge.tsx
 * @description Small label or count, on the same tones as StatusTag. For a
 *              status use StatusTag; Badge is for counts and neutral labels.
 *              Older variant names map onto tones: default → neutral,
 *              error → danger, purple → info.
 * @feature shared
 * @dependencies shared/utils/cn
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { toneFill, toneTag, type BaseTone } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export type BadgeVariant =
  | 'default'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'danger'
  | 'info'
  | 'accent'
  | 'purple';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Badge content */
  children: ReactNode;
  /** Color variant */
  variant?: BadgeVariant;
  /** Badge size */
  size?: BadgeSize;
  /** Pill shape (fully rounded) */
  pill?: boolean;
  /** Show dot indicator */
  dot?: boolean;
  /** Dot animation (pulse effect) */
  dotPulse?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const VARIANT_TONE: Record<BadgeVariant, BaseTone> = {
  default: 'neutral',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  error: 'danger',
  danger: 'danger',
  info: 'info',
  accent: 'accent',
  purple: 'info',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-px text-[11px] leading-4',
  md: 'px-2 py-0.5 text-xs leading-4',
  lg: 'px-2.5 py-1 text-[13px] leading-4',
};

const dotSizeStyles: Record<BadgeSize, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-1.5 h-1.5',
  lg: 'w-2 h-2',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <Badge>Beta</Badge>
 * <Badge variant="accent" pill>3</Badge>
 * <Badge variant="warning" dot>Stale</Badge>
 * ```
 */
export function Badge({
  children,
  variant = 'default',
  size = 'md',
  pill = false,
  dot = false,
  dotPulse = false,
  className,
  ...props
}: BadgeProps) {
  const tone = VARIANT_TONE[variant] ?? 'neutral';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap border font-medium tabular-nums',
        toneTag[tone],
        sizeStyles[size],
        pill ? 'rounded-full' : 'rounded-tag',
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('shrink-0 rounded-full', dotSizeStyles[size], toneFill[tone], dotPulse && 'motion-safe:animate-pulse')}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

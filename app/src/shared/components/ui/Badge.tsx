/**
 * @file Badge.tsx
 * @description Status indicator badges with color variants
 * @feature shared
 * @dependencies shared/utils/cn
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'cobalt' | 'turquoise';
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

// Glass-compatible badge styles with translucent backgrounds and subtle borders
const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-500/10 text-gray-600 dark:text-gray-300 border border-gray-500/20',
  success: 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
  cobalt: 'bg-cobalt-500/10 text-cobalt-600 dark:text-cobalt-400 border border-cobalt-500/20',
  turquoise: 'bg-turquoise-500/10 text-turquoise-600 dark:text-turquoise-400 border border-turquoise-500/20',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-gray-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  cobalt: 'bg-cobalt-500',
  turquoise: 'bg-turquoise-500',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-1 text-xs',
  lg: 'px-2.5 py-1.5 text-sm',
};

const dotSizeStyles: Record<BadgeSize, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A badge component for displaying status, labels, or counts with various styles.
 *
 * @example
 * ```tsx
 * <Badge variant="success">Active</Badge>
 * <Badge variant="error" dot dotPulse>Error</Badge>
 * <Badge variant="cobalt" pill>3</Badge>
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
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        variantStyles[variant],
        sizeStyles[size],
        pill ? 'rounded-full' : 'rounded-brand',
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'rounded-full',
            dotSizeStyles[size],
            dotColors[variant],
            dotPulse && 'animate-pulse'
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

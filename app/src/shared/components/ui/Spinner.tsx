/**
 * @file Spinner.tsx
 * @description Loading indicator component with size and color variants
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerColor = 'current' | 'cobalt' | 'turquoise' | 'white';

export interface SpinnerProps {
  /** Spinner size */
  size?: SpinnerSize;
  /** Spinner color */
  color?: SpinnerColor;
  /** Accessible label for screen readers */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const sizeStyles: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3 border',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-2',
  xl: 'w-12 h-12 border-3',
};

const colorStyles: Record<SpinnerColor, string> = {
  current: 'border-current border-t-transparent',
  cobalt: 'border-cobalt border-t-transparent',
  turquoise: 'border-turquoise border-t-transparent',
  white: 'border-white border-t-transparent',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A loading spinner component with customizable size and color.
 *
 * @example
 * ```tsx
 * <Spinner size="md" color="cobalt" />
 * <Spinner size="lg" color="turquoise" label="Loading robots..." />
 * ```
 */
export function Spinner({
  size = 'md',
  color = 'current',
  label = 'Loading...',
  className,
}: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full',
        sizeStyles[size],
        colorStyles[color],
        className
      )}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * @file Spinner.tsx
 * @description Small inline loading indicator. For content areas use Skeleton;
 *              the spinner is for short inline waits (a button, a cell).
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
/**
 * `current` · `primary` · `accent`.
 * @deprecated values `cobalt` / `turquoise` / `white` map to primary / accent /
 * current. They stay only while unmigrated code (auth, a2a, processes) still
 * passes them; new code never does.
 */
export type SpinnerColor = 'current' | 'primary' | 'accent' | 'cobalt' | 'turquoise' | 'white';

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
  primary: 'border-primary border-t-transparent',
  accent: 'border-accent border-t-transparent',
  cobalt: 'border-primary border-t-transparent',
  turquoise: 'border-accent border-t-transparent',
  // "white" was only ever used on coloured fills; the fill's own text colour is right there.
  white: 'border-current border-t-transparent',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A loading spinner.
 *
 * @example
 * ```tsx
 * <Spinner size="sm" />
 * <Spinner size="lg" color="primary" label="Loading robots…" />
 * ```
 */
export function Spinner({ size = 'md', color = 'current', label = 'Loading...', className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        'inline-block shrink-0 rounded-full motion-safe:animate-spin',
        sizeStyles[size],
        colorStyles[color],
        className,
      )}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

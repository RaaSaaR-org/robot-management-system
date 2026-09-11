/**
 * @file Eyebrow.tsx
 * @description Eyebrow (11px uppercase tracked label, optionally led by the
 *              landing's 22×2px accent dash) and Divider (a hairline rule).
 * @feature shared
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { labelCaps } from './styles';

// ============================================================================
// EYEBROW
// ============================================================================

export interface EyebrowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Lead with the 22×2px accent dash (as on the landing's section rails) */
  dash?: boolean;
}

/**
 * @example
 * ```tsx
 * <Eyebrow dash>Operate</Eyebrow>
 * ```
 */
export function Eyebrow({ children, dash = false, className, ...props }: EyebrowProps) {
  return (
    <div className={cn('flex items-center gap-3', labelCaps, className)} {...props}>
      {dash && <span aria-hidden="true" className="h-0.5 w-[22px] shrink-0 bg-accent" />}
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

// ============================================================================
// DIVIDER
// ============================================================================

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  /** Vertical rule for toolbars and inline groups */
  orientation?: 'horizontal' | 'vertical';
  /** Optional centred label ("or", "Advanced") */
  label?: ReactNode;
  /** Use the stronger border colour */
  strong?: boolean;
}

/**
 * @example
 * ```tsx
 * <Divider />
 * <Divider label="Advanced" />
 * <Divider orientation="vertical" className="h-6" />
 * ```
 */
export function Divider({ orientation = 'horizontal', label, strong = false, className, ...props }: DividerProps) {
  const line = strong ? 'bg-line' : 'bg-line-subtle';
  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn('w-px self-stretch shrink-0', line, className)}
        {...props}
      />
    );
  }
  if (label) {
    return (
      <div role="separator" className={cn('flex items-center gap-3', className)} {...props}>
        <span className={cn('h-px flex-1', line)} />
        <span className={labelCaps}>{label}</span>
        <span className={cn('h-px flex-1', line)} />
      </div>
    );
  }
  return <div role="separator" className={cn('h-px w-full', line, className)} {...props} />;
}

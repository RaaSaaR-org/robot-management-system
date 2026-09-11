/**
 * @file EmptyState.tsx
 * @description Shared empty-state block (icon tile + title + description +
 *              action) so list pages never hand-roll their own spacing or copy.
 *              "No ‹things› yet" + the page's primary action; filtered to
 *              nothing: "No ‹things› match" + Clear filters.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface EmptyStateProps {
  /** Icon shown in a 40px tile (any lucide icon; it is sized for you) */
  icon?: ReactNode;
  title: ReactNode;
  /** One line on what these things are / how to get the first one */
  description?: ReactNode;
  /** Primary call-to-action (the same one as the page header) */
  action?: ReactNode;
  /** Optional second action (e.g. "Import", "Read the docs") */
  secondaryAction?: ReactNode;
  /** Vertical padding preset (default 'md') */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles: Record<NonNullable<EmptyStateProps['size']>, string> = {
  sm: 'py-8',
  md: 'py-12',
  lg: 'py-20',
};

/**
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<Route />}
 *   title="No routes yet"
 *   description="A route is the path a robot walks on patrol."
 *   action={<Button leftIcon={<Plus className="w-4 h-4" />}>New route</Button>}
 * />
 * ```
 */
export function EmptyState({ icon, title, description, action, secondaryAction, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 text-center', sizeStyles[size], className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-control border border-line-subtle bg-inset text-ink-tertiary [&_svg]:!h-5 [&_svg]:!w-5"
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink-primary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-tertiary">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {secondaryAction}
          {action}
        </div>
      )}
    </div>
  );
}

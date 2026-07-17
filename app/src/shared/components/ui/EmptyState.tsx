/**
 * @file EmptyState.tsx
 * @description Shared empty-state block (icon + title + description + optional
 *              action) so list pages stop hand-rolling their own spacing/copy.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface EmptyStateProps {
  /** Icon rendered above the title (typically a lucide icon, w-10 h-10) */
  icon?: ReactNode;
  title: ReactNode;
  /** Short explanation or hint about how to populate this view */
  description?: ReactNode;
  /** Primary call-to-action (a Button or Link) */
  action?: ReactNode;
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
 * Centered empty state for lists and detail sections.
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<Database className="w-10 h-10" />}
 *   title="No datasets yet"
 *   description="Record a data-collection session or import a LeRobot dataset."
 *   action={<Button size="sm">Import dataset</Button>}
 * />
 * ```
 */
export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6', sizeStyles[size], className)}>
      {icon && <div className="text-theme-muted mb-3">{icon}</div>}
      <p className="text-sm font-medium text-theme-primary">{title}</p>
      {description && <p className="text-sm text-theme-tertiary mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

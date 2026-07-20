/**
 * @file PageHeader.tsx
 * @description Standard page header: title + optional subtitle, badges and actions.
 *              Every page should lead with this instead of hand-rolled h1 markup
 *              so titles, spacing and action placement stay identical app-wide.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface PageHeaderProps {
  /** Page title (rendered as the page's single h1) */
  title: ReactNode;
  /** One-line description under the title */
  subtitle?: ReactNode;
  /** Inline status elements next to the title (badges, live dots) */
  meta?: ReactNode;
  /** Right-aligned action buttons */
  actions?: ReactNode;
  className?: string;
}

/**
 * Canonical page header.
 *
 * @example
 * ```tsx
 * <PageHeader
 *   title="Fleet Management"
 *   subtitle="Monitor robots and manage facility zones"
 *   actions={<Button size="sm">Draw Zone</Button>}
 * />
 * ```
 */
export function PageHeader({ title, subtitle, meta, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight text-theme-primary">{title}</h1>
          {meta}
        </div>
        {subtitle && <p className="text-sm text-theme-secondary mt-1">{subtitle}</p>}
      </div>
      {/* min-w-0 (not shrink-0): a wide action row must be allowed to shrink
          below its max-content width so flex-wrap can break it onto new lines
          on narrow viewports instead of overflowing the page. */}
      {actions && <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>}
    </div>
  );
}

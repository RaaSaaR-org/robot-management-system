/**
 * @file PageHeader.tsx
 * @description The top of every page: optional back link, eyebrow (the sidebar
 *              group), the page's single h1, a description, a status meta slot
 *              and right-aligned actions that wrap under the title on narrow
 *              screens.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Eyebrow } from './Eyebrow';
import { focusRing } from './styles';

export interface PageHeaderProps {
  /** Page title (rendered as the page's single h1) */
  title: ReactNode;
  /** One line under the title (max ~70ch) */
  description?: ReactNode;
  /** Legacy alias of `description` */
  subtitle?: ReactNode;
  /** Nav group label above the title: Operate · Automate · Build · System · Admin */
  eyebrow?: ReactNode;
  /** Detail pages: renders "← label" linking back to the list */
  back?: { to: string; label: string };
  /** Inline status next to the title (a StatusTag) */
  meta?: ReactNode;
  /** Right-aligned action buttons; the primary one goes last */
  actions?: ReactNode;
  /** Extra content under the header row (e.g. a PipelineBreadcrumb) */
  children?: ReactNode;
  className?: string;
}

/**
 * @example
 * ```tsx
 * <PageHeader
 *   eyebrow="Automate"
 *   title="Patrol"
 *   description="Routes the robots walk, when they run and what they found."
 *   actions={<Button leftIcon={<Plus className="w-4 h-4" />}>New route</Button>}
 * />
 *
 * <PageHeader back={{ to: '/fleet', label: 'Fleet' }} title={robot.name} meta={<StatusTag status={robot.status} dot />} />
 * ```
 */
export function PageHeader({
  title,
  description,
  subtitle,
  eyebrow,
  back,
  meta,
  actions,
  children,
  className,
}: PageHeaderProps) {
  const lede = description ?? subtitle;

  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {back && (
        <Link
          to={back.to}
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-control text-[13px] font-medium text-ink-tertiary',
            'transition-colors duration-150 hover:text-ink-primary',
            focusRing,
          )}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-[1_1_20rem]">
          {eyebrow && (
            <Eyebrow dash className="mb-2.5">
              {eyebrow}
            </Eyebrow>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words font-display text-2xl font-semibold leading-tight tracking-[-0.03em] text-ink-primary sm:text-[28px]">
              {title}
            </h1>
            {meta}
          </div>
          {lede && <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-ink-secondary">{lede}</p>}
        </div>
        {/* min-w-0 (not shrink-0): a wide action row must be allowed to shrink
            below its max-content width so flex-wrap can break it onto new lines
            on narrow viewports instead of overflowing the page. */}
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

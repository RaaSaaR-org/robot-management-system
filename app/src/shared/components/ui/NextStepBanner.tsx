/**
 * @file NextStepBanner.tsx
 * @description Thin call-to-action banner linking to the next stage in the
 * training pipeline. Designed to sit at the top or bottom of feature pages
 * to give users forward momentum through the workflow.
 * @feature shared
 */

import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { LinkButton } from './LinkButton';

export interface NextStepBannerProps {
  /** Short hint ("Done collecting demos?") */
  title: string;
  /** Longer one-line description of what the next step does */
  description: string;
  /** Button label */
  ctaLabel: string;
  /** Route to navigate to */
  ctaHref: string;
  /** Optional icon to show on the left */
  icon?: ReactNode;
  /** default = panel · subtle = inset */
  variant?: 'default' | 'subtle';
  className?: string;
}

/**
 * @example
 * ```tsx
 * <NextStepBanner title="Done collecting demos?" description="Turn them into a dataset." ctaLabel="Open datasets" ctaHref="/datasets" />
 * ```
 */
export function NextStepBanner({
  title,
  description,
  ctaLabel,
  ctaHref,
  icon,
  variant = 'default',
  className,
}: NextStepBannerProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 border px-4 py-3',
        variant === 'default' ? 'rounded-panel border-line bg-panel' : 'rounded-control border-line-subtle bg-inset',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="text-sm font-semibold text-ink-primary">{title}</div>
        <div className="mt-0.5 text-[13px] text-ink-tertiary">{description}</div>
      </div>
      <LinkButton
        to={ctaHref}
        variant="secondary"
        size="sm"
        rightIcon={<ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />}
      >
        {ctaLabel}
      </LinkButton>
    </div>
  );
}

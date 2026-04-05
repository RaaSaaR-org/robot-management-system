/**
 * @file NextStepBanner.tsx
 * @description Thin call-to-action banner linking to the next stage in the
 * training pipeline. Designed to sit at the top or bottom of feature pages
 * to give users forward momentum through the workflow.
 * @feature shared
 */

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// COMPONENT
// ============================================================================

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
  /** Visual variant */
  variant?: 'default' | 'subtle';
  className?: string;
}

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
        'flex items-center gap-4 px-4 py-3 rounded-brand-lg border',
        variant === 'default'
          ? 'bg-cobalt-500/5 border-cobalt-500/20'
          : 'bg-glass-bg border-glass-subtle',
        className
      )}
    >
      {icon && (
        <div className="p-2 rounded-brand bg-cobalt-500/10 shrink-0 text-cobalt-400">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-theme-primary">{title}</div>
        <div className="text-xs text-theme-muted mt-0.5">{description}</div>
      </div>
      <Link
        to={ctaHref}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-brand text-xs font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all shrink-0 whitespace-nowrap"
      >
        {ctaLabel}
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

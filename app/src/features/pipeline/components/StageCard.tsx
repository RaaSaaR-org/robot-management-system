/**
 * @file StageCard.tsx
 * @description One stage in the training pipeline — status + next-action CTA
 * @feature pipeline
 */

import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/shared/components/ui/Card';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export type StageStatus = 'empty' | 'active' | 'running' | 'done' | 'blocked';

export interface StageCardProps {
  /** Step number (1-5) */
  number: number;
  /** Stage title */
  title: string;
  /** Short one-line description of what this stage does */
  description: string;
  /** Lucide icon component */
  icon: ReactNode;
  /** Current status */
  status: StageStatus;
  /** Top stat line (e.g. "3 datasets · 1 ready") */
  statLine?: string;
  /** Secondary hint line (e.g. "Last activity: 2h ago") */
  hintLine?: string;
  /** CTA button label */
  ctaLabel: string;
  /** Route the CTA navigates to */
  ctaHref: string;
  /** Optional "view all" link below CTA */
  viewAllHref?: string;
}

// ============================================================================
// VISUAL TOKENS
// ============================================================================

const STATUS_META: Record<
  StageStatus,
  { label: string; badgeClass: string; ringClass: string; iconColor: string }
> = {
  empty: {
    label: 'Not started',
    badgeClass: 'bg-glass-subtle text-theme-muted border-glass-subtle',
    ringClass: 'border-glass-subtle',
    iconColor: 'text-theme-muted',
  },
  active: {
    label: 'Ready',
    badgeClass: 'bg-cobalt-500/10 text-cobalt-400 border-cobalt-500/20',
    ringClass: 'border-cobalt-500/30',
    iconColor: 'text-cobalt-400',
  },
  running: {
    label: 'In progress',
    badgeClass: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    ringClass: 'border-yellow-500/30',
    iconColor: 'text-yellow-400',
  },
  done: {
    label: 'Done',
    badgeClass: 'bg-green-500/10 text-green-400 border-green-500/20',
    ringClass: 'border-green-500/20',
    iconColor: 'text-green-400',
  },
  blocked: {
    label: 'Waiting',
    badgeClass: 'bg-glass-subtle text-theme-muted border-glass-subtle',
    ringClass: 'border-glass-subtle opacity-60',
    iconColor: 'text-theme-muted',
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function StageCard({
  number,
  title,
  description,
  icon,
  status,
  statLine,
  hintLine,
  ctaLabel,
  ctaHref,
  viewAllHref,
}: StageCardProps) {
  const meta = STATUS_META[status];
  const isBlocked = status === 'blocked';

  const StatusIcon =
    status === 'done'
      ? CheckCircle2
      : status === 'running'
      ? Loader2
      : status === 'blocked'
      ? Lock
      : Circle;

  return (
    <Card className={cn('h-full border-2 transition-all', meta.ringClass)}>
      <div className="flex flex-col h-full gap-4">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={cn(
                  'w-9 h-9 rounded-brand flex items-center justify-center shrink-0',
                  status === 'empty' || status === 'blocked'
                    ? 'bg-glass-subtle'
                    : 'bg-cobalt-500/10'
                )}
              >
                <span className={cn(meta.iconColor)}>{icon}</span>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wide text-theme-muted">
                  Step {number}
                </div>
                <h3 className="text-base font-semibold text-theme-primary leading-tight">
                  {title}
                </h3>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-brand border shrink-0 whitespace-nowrap',
                meta.badgeClass
              )}
            >
              <StatusIcon
                className={cn('w-3 h-3', status === 'running' && 'animate-spin')}
              />
              {meta.label}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-theme-secondary leading-relaxed">{description}</p>

        {/* Stats */}
        <div className="flex-1 space-y-1">
          {statLine && (
            <div className="text-sm font-medium text-theme-primary">{statLine}</div>
          )}
          {hintLine && <div className="text-xs text-theme-muted">{hintLine}</div>}
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-2 pt-2 border-t border-glass-subtle">
          {isBlocked ? (
            <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-theme-muted rounded-brand bg-glass-subtle">
              <Lock className="w-3.5 h-3.5" />
              Complete previous step first
            </div>
          ) : (
            <Link
              to={ctaHref}
              className={cn(
                'flex items-center justify-center gap-2 px-3 py-2 rounded-brand',
                'text-sm font-medium transition-all',
                'bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20'
              )}
            >
              {ctaLabel}
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
          {viewAllHref && !isBlocked && (
            <Link
              to={viewAllHref}
              className="text-xs text-theme-muted hover:text-theme-secondary text-center transition-colors"
            >
              View all →
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

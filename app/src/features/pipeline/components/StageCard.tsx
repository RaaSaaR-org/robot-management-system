/**
 * @file StageCard.tsx
 * @description One stage of the training pipeline, rendered as a row of the
 *              vertical stepper on /pipeline: number (or check), title,
 *              description, live summary, status and a link to the stage page.
 *              Locked stages say "Complete previous step first" and link nowhere.
 * @feature pipeline
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, RotateCw } from 'lucide-react';
import { Button, LinkButton, StatusTag, type StatusTagTone as Tone } from '@/shared/components/ui';
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
  /** Current status */
  status: StageStatus;
  /** True for the first stage that still needs work */
  isNext?: boolean;
  /** Live summary (e.g. "3 datasets · 1 ready") */
  statLine?: string;
  /** Secondary hint (e.g. "Last activity 2h ago") */
  hintLine?: string;
  /** Label of the link to the stage page */
  ctaLabel: string;
  /** Route of the stage page */
  ctaHref: string;
  /** The stage's data could not be loaded */
  loadError?: boolean;
  /** Retry loading after an error */
  onRetry?: () => void;
}

// ============================================================================
// STATUS
// ============================================================================

const STATUS_META: Record<StageStatus, { label: string; tone: Tone }> = {
  empty: { label: 'Not started', tone: 'neutral' },
  active: { label: 'Ready', tone: 'neutral' },
  running: { label: 'In progress', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  blocked: { label: 'Waiting', tone: 'neutral' },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function StageCard({
  number,
  title,
  description,
  status,
  isNext = false,
  statLine,
  hintLine,
  ctaLabel,
  ctaHref,
  loadError = false,
  onRetry,
}: StageCardProps) {
  const navigate = useNavigate();
  const isBlocked = status === 'blocked';
  const isDone = status === 'done';
  const meta = isNext && !isDone && status !== 'running'
    ? { label: 'Up next', tone: 'accent' as Tone }
    : STATUS_META[status];

  const open = () => {
    if (!isBlocked) navigate(ctaHref);
  };

  return (
    <li
      data-testid={`pipeline-stage-${number}`}
      className={cn(
        'flex gap-4 px-5 py-4',
        !isBlocked && 'cursor-pointer transition-colors hover:bg-ink-primary/[0.035]',
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button')) return;
        open();
      }}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
          isDone && 'border-primary/40 bg-primary/10 text-primary',
          !isDone && isNext && 'border-primary bg-primary text-on-primary',
          !isDone && !isNext && 'border-line text-ink-tertiary',
        )}
      >
        {isDone ? <Check className="h-4 w-4" strokeWidth={2} /> : number}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className={cn('text-sm font-semibold', isBlocked ? 'text-ink-tertiary' : 'text-ink-primary')}>
              <span className="sr-only">Step {number}: </span>
              {title}
            </h3>
            <StatusTag tone={meta.tone} dot>{meta.label}</StatusTag>
          </div>
          <p className="mt-1 text-[13px] text-ink-tertiary">{description}</p>
        </div>

        <div className="min-w-0 sm:w-56 sm:shrink-0">
          {loadError ? (
            <div className="flex items-center gap-2 text-[13px] text-signal-unknown">
              Couldn&apos;t load
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<RotateCw className="h-4 w-4" strokeWidth={1.75} />}
                  onClick={onRetry}
                >
                  Retry
                </Button>
              )}
            </div>
          ) : isBlocked ? (
            <p className="text-[13px] text-ink-tertiary">Complete previous step first</p>
          ) : (
            <>
              {statLine && <p className="text-[13px] font-medium text-ink-secondary">{statLine}</p>}
              {hintLine && <p className="text-xs text-ink-muted">{hintLine}</p>}
            </>
          )}
        </div>

        <div className="sm:w-44 sm:shrink-0 sm:text-right">
          {!isBlocked && (
            <LinkButton
              to={ctaHref}
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
            >
              {ctaLabel}
            </LinkButton>
          )}
        </div>
      </div>
    </li>
  );
}

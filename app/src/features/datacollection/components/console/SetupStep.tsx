/**
 * @file SetupStep.tsx
 * @description One step of the Set up rail (TASK-427): a row with its node,
 *              title and one-line summary that opens an accordion body, and the
 *              body in a fixed order — the readiness problem this step owns,
 *              one line of what to do, the step's own content (the mode track),
 *              the actions, a note, and a Details disclosure with the step's
 *              readiness rows. The current step is lit: a primary-tinted
 *              container and a node whose ring breathes. Bodies stay mounted
 *              while collapsed, so the controls keep their state and test ids.
 * @feature datacollection
 */

import { useId, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Lock, TriangleAlert, XCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { SetupStep as SetupStepModel } from '../../utils/setupSteps';

export interface SetupStepProps {
  step: SetupStepModel;
  expanded: boolean;
  onToggle: () => void;
  /** The last step draws no connector below its node. */
  last?: boolean;
  /** One line of what to do (max 62ch). */
  lead?: ReactNode;
  /** The step's own content between the line and the actions (the mode track). */
  children?: ReactNode;
  /** The step's actions, laid out in one row with Details. */
  actions?: ReactNode;
  /** A note under the actions ("Later the operator takes control…"). */
  note?: ReactNode;
  /** The step's readiness rows; null hides Details. */
  details?: ReactNode;
}

const SUMMARY_TONE: Record<SetupStepModel['tone'], string> = {
  ok: 'text-signal-measured',
  warn: 'text-signal-unknown',
  fail: 'text-signal-stopped',
  idle: 'text-ink-tertiary',
};

function Node({ step }: { step: SetupStepModel }) {
  const base = 'relative z-[1] grid h-7 w-7 flex-none place-items-center rounded-full border font-display text-[12.5px] font-semibold tabular-nums';
  switch (step.state) {
    case 'done':
      return (
        <span className={cn(base, 'border-signal-measured/45 bg-signal-measured/10 text-signal-measured')} aria-label="Done">
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      );
    case 'current':
      return (
        <span
          className={cn(
            base,
            'border-primary bg-primary/10 text-primary',
            "before:absolute before:-inset-[5px] before:animate-breathe before:rounded-full before:border before:border-primary/45 before:content-['']",
          )}
          aria-label={`Step ${step.n}, current`}
        >
          {step.n}
        </span>
      );
    case 'waits':
      return (
        <span className={cn(base, 'border-line bg-inset text-ink-muted')} aria-label={`Step ${step.n}, waits`}>
          <Lock className="h-3 w-3" strokeWidth={1.75} />
        </span>
      );
    case 'fault':
      return (
        <span className={cn(base, 'border-signal-stopped/60 bg-signal-stopped/10 text-signal-stopped')} aria-label={`Step ${step.n}, failed`}>
          {step.n}
        </span>
      );
    default:
      return <span className={cn(base, 'border-line bg-inset text-ink-muted')}>{step.n}</span>;
  }
}

export function SetupStep({ step, expanded, onToggle, last = false, lead, children, actions, note, details }: SetupStepProps) {
  const bodyId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const lit = step.state === 'current';
  const reason = step.reason;
  const reasonRed = step.tone === 'fail';
  const hasDetails = details !== undefined && details !== null;

  return (
    <li
      className={cn(
        'relative mt-0.5 rounded-control border transition-colors duration-150 ease-[var(--ease-instrument)] first:mt-0',
        expanded ? (lit ? 'border-primary/20 bg-primary/[0.04]' : 'border-line bg-inset') : 'border-transparent',
        // The connector to the next node.
        !last && "after:absolute after:-bottom-2 after:left-[25px] after:top-[44px] after:w-px after:content-['']",
        !last && (step.state === 'done' ? 'after:bg-signal-measured/40' : 'after:bg-line'),
      )}
      data-testid={`setup-step-${step.id}`}
      data-state={step.state}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        type="button"
        className="grid w-full grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3.5 rounded-control px-3 py-2.5 text-left sm:grid-cols-[28px_minmax(0,1fr)_auto_16px]"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
        data-testid={`setup-step-${step.id}-toggle`}
      >
        <Node step={step} />
        <span
          className={cn(
            "truncate font-display text-[15px] font-semibold leading-tight [font-variation-settings:'wdth'_104] [word-spacing:.05em]",
            step.state === 'done' || lit ? 'text-ink-primary' : 'text-ink-secondary',
          )}
        >
          {step.title}
        </span>
        <span
          className={cn('hidden items-center gap-[7px] whitespace-nowrap text-[13px] sm:inline-flex', SUMMARY_TONE[step.tone])}
          data-testid={`setup-step-${step.id}-summary`}
        >
          {step.tone !== 'ok' && (
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 flex-none rounded-full',
                step.tone === 'idle' ? 'border border-current' : 'bg-current',
              )}
            />
          )}
          {step.summary}
        </span>
        <ChevronDown
          aria-hidden
          strokeWidth={1.75}
          className={cn('h-4 w-4 text-ink-muted transition-transform duration-150 ease-[var(--ease-instrument)]', expanded && 'rotate-180')}
        />
      </button>

      <div id={bodyId} hidden={!expanded} className="pb-4 pl-[54px] pr-4" data-testid={`setup-step-${step.id}-body`}>
        {/* Phones have no room for the summary on the row; a problem line says it already. */}
        {!reason && <p className={cn('mb-2 text-[13px] sm:hidden', SUMMARY_TONE[step.tone])}>{step.summary}</p>}
        {reason && (
          <p
            className={cn('mb-3 flex max-w-[62ch] items-start gap-2 text-[14px] font-medium', reasonRed ? 'text-signal-stopped' : 'text-signal-unknown')}
            role="status"
            data-testid="setup-step-reason"
            data-code={reason.code}
          >
            {reasonRed ? (
              <XCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.75} aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.75} aria-hidden />
            )}
            {reason.text}
          </p>
        )}
        {lead && <p className="mb-3 max-w-[62ch] text-[14px] leading-relaxed text-ink-secondary">{lead}</p>}
        {children}
        {(actions || hasDetails) && (
          <div className={cn('flex flex-wrap items-center gap-2', children ? 'mt-3' : undefined)}>
            {actions}
            {hasDetails && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', detailsOpen && 'rotate-180')} strokeWidth={1.75} />}
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((v) => !v)}
                data-testid={`setup-step-${step.id}-details-toggle`}
              >
                Details
              </Button>
            )}
          </div>
        )}
        {note && <div className="mt-3 flex max-w-[62ch] items-start gap-2 text-[13px] text-ink-tertiary">{note}</div>}
        {hasDetails && detailsOpen && (
          <div className="mt-3" data-testid={`setup-step-${step.id}-details`}>
            {details}
          </div>
        )}
      </div>
    </li>
  );
}

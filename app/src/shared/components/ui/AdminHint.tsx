/**
 * @file AdminHint.tsx
 * @description The setup detail behind a state a visitor cannot fix — an
 *              environment variable, a command, a file path — folded away under
 *              "For administrators". The sentence above it says what is going
 *              on in words anyone understands; this is for the person who runs
 *              the instance (TASK-486). Native <details>, so it needs no state
 *              and works inside a dialog, a notice or an empty state.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

export interface AdminHintProps {
  /** The toggle's label (default "For administrators") */
  label?: ReactNode;
  /** The technical detail: what to set, run or install */
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * @example
 * ```tsx
 * <p>Synthetic data generation is not set up on this instance.</p>
 * <AdminHint>Install the generator at <AdminCode>server/curation/…</AdminCode>.</AdminHint>
 * ```
 */
export function AdminHint({ label = 'For administrators', children, className, 'data-testid': testId }: AdminHintProps) {
  return (
    <details className={cn('group text-left text-[13px] text-ink-tertiary', className)} data-testid={testId}>
      <summary className={cn('inline-flex cursor-pointer list-none items-center gap-1 rounded-control text-ink-secondary hover:text-ink-primary [&::-webkit-details-marker]:hidden', focusRing)}>
        <span aria-hidden className="inline-block transition-transform duration-150 group-open:rotate-90">›</span>
        {label}
      </summary>
      <div className="mt-1.5 leading-relaxed">{children}</div>
    </details>
  );
}

/** An env var, command or path inside an admin hint. */
export function AdminCode({ children }: { children: ReactNode }) {
  return <code className="rounded-tag bg-inset px-1.5 py-0.5 font-mono text-xs text-ink-primary [overflow-wrap:anywhere]">{children}</code>;
}

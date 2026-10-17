/**
 * @file Disclosure.tsx
 * @description A section that opens and closes under a header button — for
 *              optional settings a normal user never needs to see ("Advanced
 *              options"). While closed it can show a one-line summary of what
 *              is set inside, so nothing hidden is also unknown. Controlled
 *              (`open` + `onOpenChange`) or uncontrolled (`defaultOpen`).
 *              Never put a safety control (the E-stop) behind one.
 * @feature shared
 */

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

export interface DisclosureProps {
  /** Header text ("Advanced options") */
  title: ReactNode;
  /** One line shown under the title while closed ("Frame rate 30 fps · Dataset g1/pick") */
  summary?: ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Uncontrolled initial state (default closed) */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** Classes for the content wrapper */
  contentClassName?: string;
  'data-testid'?: string;
}

/**
 * @example
 * ```tsx
 * <Disclosure title="Advanced options" summary="Frame rate 30 fps">
 *   <FormField label="Frame rate">…</FormField>
 * </Disclosure>
 * ```
 */
export function Disclosure({
  title,
  summary,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
  contentClassName,
  'data-testid': testId,
}: DisclosureProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const contentId = useId();

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <div className={cn('flex flex-col', className)} data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
        className={cn(
          'group flex w-full items-start gap-2 rounded-control py-1 text-left',
          focusRing,
        )}
      >
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary transition-transform duration-150 group-hover:text-ink-primary',
            open && 'rotate-90',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-ink-primary">{title}</span>
          {!open && summary && <span className="truncate text-xs text-ink-tertiary">{summary}</span>}
        </span>
      </button>
      <div id={contentId} hidden={!open} className={cn('pt-4', contentClassName)}>
        {open && children}
      </div>
    </div>
  );
}

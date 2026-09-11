/**
 * @file ChoiceCard.tsx
 * @description Single choice between a few rich options (a title, a line of
 *              explanation, an optional tag) as selectable cards — where a
 *              Select would hide what each option means. ChoiceCardGroup lays
 *              them out as a labelled group; each card is an aria-pressed
 *              button. For two to four short options use SegmentedControl.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

export interface ChoiceCardProps {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned next to the title (a StatusTag: Beta, Ready) */
  aside?: ReactNode;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** The card surface: primary border and tint when selected. For custom selectable rows. */
export function choiceSurface(selected: boolean): string {
  return cn(
    'rounded-control border transition-colors duration-150',
    selected ? 'border-primary bg-primary/10' : 'border-line bg-field hover:border-line-strong',
  );
}

/**
 * @example
 * ```tsx
 * <ChoiceCardGroup label="Training type" columns={2}>
 *   <ChoiceCard selected={kind === 'supervised'} onSelect={() => setKind('supervised')} title="Supervised fine-tune" description="…" />
 *   <ChoiceCard selected={kind === 'sim_rl'} onSelect={() => setKind('sim_rl')} title="Sim-RL policy" aside={<StatusTag tone="sim" size="sm">Beta</StatusTag>} />
 * </ChoiceCardGroup>
 * ```
 */
export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  aside,
  disabled = false,
  className,
  'data-testid': testId,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        choiceSurface(selected),
        'flex w-full flex-col gap-1 p-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
        focusRing,
        className,
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-primary">{title}</span>
        {aside}
      </span>
      {description && <span className="text-xs text-ink-secondary">{description}</span>}
    </button>
  );
}

export interface ChoiceCardGroupProps {
  /** Accessible name of the group ("Training type") */
  label: string;
  /** Columns from 640px (one column on phones); default 2 */
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}

const GROUP_COLUMNS: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

/** A labelled grid of ChoiceCards. */
export function ChoiceCardGroup({ label, columns = 2, children, className }: ChoiceCardGroupProps) {
  return (
    <div role="group" aria-label={label} className={cn('grid gap-2', GROUP_COLUMNS[columns], className)}>
      {children}
    </div>
  );
}

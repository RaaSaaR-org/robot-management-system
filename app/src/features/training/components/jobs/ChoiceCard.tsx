/**
 * @file ChoiceCard.tsx
 * @description A selectable card (aria-pressed button) for the training wizard's single-choice groups
 * @feature training
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface ChoiceCardProps {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned tag next to the title (e.g. Beta, Ready). */
  aside?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export const choiceSurface = (selected: boolean) =>
  cn(
    'rounded-control border transition-colors duration-150',
    selected ? 'border-primary bg-primary/10' : 'border-line bg-field hover:border-line-strong'
  );

export function ChoiceCard({ selected, onSelect, title, description, aside, className, ...rest }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={rest['data-testid']}
      className={cn(
        choiceSurface(selected),
        'flex w-full flex-col gap-1 p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className
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

/**
 * @file SegmentedControl.tsx
 * @description SegmentedControl (single-select segmented switch — view modes,
 *              time ranges, filters) and ToggleChip (an independent on/off
 *              chip). Same ground and active state as the pills Tabs.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

// ============================================================================
// SEGMENTED CONTROL (single-select)
// ============================================================================

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional tooltip */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group */
  label?: string;
  /** sm 32px · md 38px tall (default md, matching inputs) */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * @example
 * ```tsx
 * <SegmentedControl
 *   label="View"
 *   options={[{ value: 'grid', label: 'Grid' }, { value: 'table', label: 'Table' }]}
 *   value={view}
 *   onChange={setView}
 * />
 * ```
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control border border-line-subtle bg-inset p-[2px] scrollbar-hide',
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium',
              'transition-colors duration-150 ease-[var(--ease-instrument)] disabled:cursor-not-allowed disabled:opacity-50',
              '[&_svg]:h-4 [&_svg]:w-4',
              focusRing,
              size === 'sm' ? 'h-[26px] px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active
                ? 'bg-raised text-ink-primary shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
                : 'text-ink-tertiary hover:text-ink-primary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// TOGGLE CHIP (independent on/off)
// ============================================================================

export interface ToggleChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Optional tooltip */
  title?: string;
  disabled?: boolean;
  /** sm 28px · md 32px (default sm) */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Independent on/off chip (e.g. "Robot model", "Clip room").
 *
 * @example
 * ```tsx
 * <ToggleChip active={showModel} onClick={() => setShowModel((v) => !v)}>Robot model</ToggleChip>
 * ```
 */
export function ToggleChip({ active, onClick, children, title, disabled, size = 'sm', className }: ToggleChipProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border font-medium',
        'transition-colors duration-150 ease-[var(--ease-instrument)] [&_svg]:h-3.5 [&_svg]:w-3.5',
        focusRing,
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-line text-ink-secondary hover:border-line-strong hover:text-ink-primary',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}
